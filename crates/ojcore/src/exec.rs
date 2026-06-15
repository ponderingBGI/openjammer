//! The real-time executor (the ON-RT half of the engine).
//!
//! [`Engine`] owns a [`CompiledProgram`] and runs it one block at a time.
//! [`Engine::process_block`] is the audio-thread hot path and is held to a hard
//! contract: **no heap allocation, no locks, no blocking.** Every buffer it
//! touches was pre-sized by `compile.rs`; this loop only mixes, points, and
//! renders.
//!
//! `no_std`: this module is `alloc`-only (it never names `std`), so it compiles
//! unchanged for the `wasm32` AudioWorklet.

use alloc::vec;
use alloc::vec::Vec;

use ojproto::{NodeIdx, PrimitiveKind};

use crate::compile::CompiledProgram;
use crate::dsp::ProcessCtx;

/// Hard cap on channels materialized on the stack per node, so the render step
/// allocates nothing. Real nodes are mono/stereo; this is comfortably above any
/// node's port count and extra channels degrade gracefully (are ignored).
const MAX_CH: usize = 32;

/// A runnable engine: a compiled program plus the RT-thread-local channel
/// pointer scratch its `process_block` re-points each block.
///
/// The pointer scratch lives on the `Engine` (RT-thread-local) rather than in
/// the `CompiledProgram` so the program stays `Send` for the graph-swap seam.
pub struct Engine {
    program: CompiledProgram,
    /// Reusable input channel-pointer scratch (len >= `program.max_in`).
    in_ptrs: Vec<*const f32>,
    /// Reusable output channel-pointer scratch (len >= `program.max_out`).
    out_ptrs: Vec<*mut f32>,
    /// Minimal transport clock: sample position + play/pause. Full transport
    /// (bars/beats/tempo) is a later unit; this is enough to honour
    /// `TransportPlay/Pause/Seek` commands. `pub(crate)` so the std-gated
    /// `command.rs` can drive it.
    pub(crate) playing: bool,
    pub(crate) sample_pos: u64,
}

// The raw pointers in the scratch are only ever populated and consumed within a
// single `process_block` call (never observed across calls or threads), and the
// `Engine` is owned by a single (audio) thread. The `CompiledProgram` it holds
// is itself `Send`.
unsafe impl Send for Engine {}

impl Engine {
    /// Wrap a freshly [`crate::compile`]d program. Sizes the pointer scratch to
    /// the program's widest port counts (one allocation, off the hot path).
    pub fn new(program: CompiledProgram) -> Self {
        let in_ptrs = vec![core::ptr::null(); program.max_in];
        let out_ptrs = vec![core::ptr::null_mut(); program.max_out];
        Self { program, in_ptrs, out_ptrs, playing: false, sample_pos: 0 }
    }

    /// Whether the transport clock is running.
    pub fn is_playing(&self) -> bool {
        self.playing
    }

    /// Current transport sample position.
    pub fn sample_pos(&self) -> u64 {
        self.sample_pos
    }

    /// Borrow the current program (e.g. to inspect node count in tests).
    pub fn program(&self) -> &CompiledProgram {
        &self.program
    }

    /// Mutably borrow the current program (used by command application to set
    /// params / toggle bypass on the live instances). RT-safe: no allocation.
    pub fn program_mut(&mut self) -> &mut CompiledProgram {
        &mut self.program
    }

    /// Mutable view of a source node's output buffer, so the host can inject
    /// external input (e.g. a `GraphIn`/`MicIn` block) before `process_block`.
    /// The executor leaves source-node output buffers intact, so whatever is
    /// written here flows downstream this block. `None` if the node id or port
    /// is unknown.
    pub fn input_mut(&mut self, node: NodeIdx, port: usize) -> Option<&mut [f32]> {
        let slot = self.program.slot_of_id(node)?;
        self.program.out_bufs.get_mut(slot)?.get_mut(port).map(|b| b.as_mut_slice())
    }

    /// Replace the running program, returning the old one so the caller can
    /// hand it to a deferred (RT-safe) dropper. The pointer-scratch grow path
    /// is the only branch that may allocate and only runs when the new program
    /// is wider; call this at a block boundary, never mid-block.
    pub fn install(&mut self, program: CompiledProgram) -> CompiledProgram {
        if program.max_in > self.in_ptrs.len() {
            self.in_ptrs.resize(program.max_in, core::ptr::null());
        }
        if program.max_out > self.out_ptrs.len() {
            self.out_ptrs.resize(program.max_out, core::ptr::null_mut());
        }
        core::mem::replace(&mut self.program, program)
    }

    /// Render one block of `nframes` into `out` (mono master output).
    ///
    /// RT-SAFETY: this path performs NO heap allocation and takes NO locks. It
    /// walks the pre-computed, cycle-free schedule; for each node it mixes the
    /// node's inputs into the pre-sized `in_scratch`, points reusable
    /// channel-pointer arrays at the pre-sized buffers, and calls the node's
    /// `process`. Finally it sums the master-output node's resolved input into
    /// `out`.
    pub fn process_block(&mut self, out: &mut [f32], nframes: usize) {
        debug_assert!(nframes <= self.program.block_size, "block overrun");
        let nframes = nframes.min(self.program.block_size).min(out.len());

        for si in 0..self.program.schedule.len() {
            let node = self.program.schedule[si];

            match self.program.kinds[node] {
                // External sources: the host fills their output buffer (see
                // `input_mut`); the executor leaves it intact (no process, no
                // zeroing) so injected input flows downstream untouched.
                PrimitiveKind::GraphIn | PrimitiveKind::MicIn => continue,
                // Master sinks have no DSP; their resolved input is emitted to
                // `out` after the loop. Nothing to render here.
                PrimitiveKind::SpeakerOut | PrimitiveKind::GraphOut => continue,
                _ => {}
            }

            if self.program.bypassed[node] {
                // Passthrough: bypassed nodes copy input 0 -> output 0 so signal
                // still reaches downstream nodes.
                self.passthrough(node, nframes);
                continue;
            }
            self.render_node(node, nframes);
        }

        // Emit the master node's RESOLVED INPUT. The master sink (SpeakerOut /
        // GraphOut) does not itself produce audio; the engine's output IS the
        // mix feeding its input port 0.
        for o in out.iter_mut().take(nframes) {
            *o = 0.0;
        }
        let master = self.program.master_out;
        if let Some(port0) = self.program.routing.get(master).and_then(|r| r.inputs.first()) {
            // Borrow split: read sources from `out_bufs`, write `out` (caller's
            // buffer, disjoint). No allocation.
            for k in 0..port0.len() {
                let src = self.program.routing[master].inputs[0][k];
                let src_buf = &self.program.out_bufs[src.node][src.port as usize];
                for (o, &s) in out.iter_mut().zip(src_buf.iter()).take(nframes) {
                    *o += s;
                }
            }
        }
        // Zero any trailing frames beyond our valid range.
        for o in out.iter_mut().skip(nframes) {
            *o = 0.0;
        }

        // Advance the minimal transport clock once per block while playing.
        if self.playing {
            self.sample_pos = self.sample_pos.wrapping_add(nframes as u64);
        }
    }

    /// Mix `node`'s inputs into `in_scratch`, then render it into its own
    /// `out_bufs`. Allocation-free.
    ///
    /// SAFETY INVARIANT: the schedule is Kahn-verified acyclic in `compile`, so
    /// a node is never one of its own input sources. Hence the producer buffers
    /// read during the mix step and the node's own output buffers written
    /// during the render step are ALWAYS disjoint allocations — which is what
    /// makes the raw-pointer read/write borrow split below sound (no aliasing).
    fn render_node(&mut self, node: usize, nframes: usize) {
        let n_in = self.program.routing[node].inputs.len();
        let n_out = self.program.out_bufs[node].len();

        // --- mix step: fold every source of each input port into its row of
        // `in_scratch`, then publish a pointer to that row.
        for port in 0..n_in {
            self.mix_input(node, port, nframes);
            self.in_ptrs[port] = self.program.in_scratch[port].as_ptr();
        }
        // --- point outputs at the node's own buffers.
        for port in 0..n_out {
            self.out_ptrs[port] = self.program.out_bufs[node][port].as_mut_ptr();
        }

        let n_in_ch = n_in.min(MAX_CH);
        let n_out_ch = n_out.min(MAX_CH);
        let mut ins: [&[f32]; MAX_CH] = [&[]; MAX_CH];
        let mut outs: [&mut [f32]; MAX_CH] = Default::default();
        // SAFETY: every pointer was just set from a live `nframes`-long buffer;
        // the input rows (`in_scratch`) and output rows (`out_bufs[node]`) are
        // disjoint allocations, so these views never alias.
        unsafe {
            for (i, &p) in self.in_ptrs.iter().take(n_in_ch).enumerate() {
                ins[i] = core::slice::from_raw_parts(p, nframes);
            }
            for (i, &p) in self.out_ptrs.iter().take(n_out_ch).enumerate() {
                outs[i] = core::slice::from_raw_parts_mut(p, nframes);
            }
        }
        let mut ctx = ProcessCtx {
            inputs: &ins[..n_in_ch],
            outputs: &mut outs[..n_out_ch],
            nframes,
        };
        self.program.instances[node].process(&mut ctx);
    }

    /// Sum every source feeding `(node, port)` into `in_scratch[port]`.
    ///
    /// `in_scratch` and `out_bufs` are DISTINCT fields, so this needs no raw
    /// pointers: we split the program's borrows by field. The destination row
    /// (`in_scratch`) and the producer rows (`out_bufs`) never alias.
    fn mix_input(&mut self, node: usize, port: usize, nframes: usize) {
        let prog = &mut self.program;
        let dst = &mut prog.in_scratch[port][..nframes];
        for d in dst.iter_mut() {
            *d = 0.0;
        }
        for src in &prog.routing[node].inputs[port] {
            let src_buf = &prog.out_bufs[src.node][src.port as usize];
            for (d, &s) in dst.iter_mut().zip(src_buf.iter()).take(nframes) {
                *d += s;
            }
        }
    }

    /// Bypass passthrough: copy `node`'s first resolved input into its first
    /// output buffer. Allocation-free; no-op if the node has no output port.
    fn passthrough(&mut self, node: usize, nframes: usize) {
        if self.program.out_bufs[node].is_empty() {
            return;
        }
        let has_in = !self.program.routing[node].inputs.is_empty();
        if has_in {
            self.mix_input(node, 0, nframes);
            // `in_scratch` and `out_bufs` are distinct fields -> safe split.
            let prog = &mut self.program;
            let (src, _) = prog.in_scratch.split_at(1);
            let dst = &mut prog.out_bufs[node][0][..nframes];
            for (d, &s) in dst.iter_mut().zip(src[0].iter()).take(nframes) {
                *d = s;
            }
        } else {
            for s in self.program.out_bufs[node][0].iter_mut().take(nframes) {
                *s = 0.0;
            }
        }
    }
}
