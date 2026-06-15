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
use crate::meter::MeterBank;
use crate::resilience::{sanitize, NodeBudget};
use crate::transport::{Transport, TransportPos};

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
    /// U12: musical interpretation (tempo/time-signature -> bar/beat/phase) laid
    /// over the same sample playhead above. Kept in lockstep with `playing` /
    /// `sample_pos`; tempo + time signature are configured via the additive
    /// `set_tempo` / `set_time_signature` methods.
    pub(crate) transport: Transport,
    /// U15: per-node + master RMS/peak meters, behind a cheap enable toggle.
    /// Sized to the program's node count; the render loop only accumulates.
    pub(crate) meters: MeterBank,
    /// U16: per-node resilience flags (non-finite output, watchdog auto-bypass).
    pub(crate) budget: NodeBudget,
    /// U16: optional per-block CPU watchdog (std-only). `None` => disarmed (the
    /// wasm worklet never arms it).
    #[cfg(feature = "std")]
    pub(crate) watchdog: Option<crate::resilience::Watchdog>,
    /// U15: optional RT -> control return ring for `Meter` / `Beat` frames. The
    /// control thread holds the other handle and drains it. `None` => the engine
    /// computes meters but publishes nothing (host-side return path, std-only).
    #[cfg(feature = "std")]
    pub(crate) meter_ring: Option<alloc::sync::Arc<crate::meter::MeterRing>>,
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
        let n = program.len();
        Self {
            program,
            in_ptrs,
            out_ptrs,
            playing: false,
            sample_pos: 0,
            transport: Transport::default(),
            meters: MeterBank::with_nodes(n),
            budget: NodeBudget::with_nodes(n),
            #[cfg(feature = "std")]
            watchdog: None,
            #[cfg(feature = "std")]
            meter_ring: None,
        }
    }

    /// Whether the transport clock is running.
    pub fn is_playing(&self) -> bool {
        self.playing
    }

    /// Current transport sample position.
    pub fn sample_pos(&self) -> u64 {
        self.sample_pos
    }

    // --- U12 musical transport (additive) ----------------------------------

    /// Set the musical tempo in BPM. Off-RT or RT-safe (a single field write);
    /// takes effect on the next position read. Non-positive values are ignored.
    pub fn set_tempo(&mut self, bpm: f32) {
        self.transport.set_tempo(bpm);
    }

    /// Set the time signature `numerator/denominator` (e.g. `4, 4`). RT-safe.
    pub fn set_time_signature(&mut self, numerator: u32, denominator: u32) {
        self.transport.set_time_signature(numerator, denominator);
    }

    /// Set the transport sample rate (Hz) used to convert the sample playhead
    /// into musical time. Call once after compiling for a given graph.
    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.transport.sample_rate = sample_rate;
    }

    /// The current musical position (bar / beat / phase) derived from the live
    /// sample playhead — enough to emit an [`ojproto::EngineFrame::Beat`].
    /// RT-safe: pure arithmetic, no allocation.
    pub fn transport_pos(&self) -> TransportPos {
        // Mirror the authoritative minimal clock into the musical transport so
        // the derived position always tracks `sample_pos` / `playing`.
        let mut t = self.transport;
        t.sample_pos = self.sample_pos;
        t.playing = self.playing;
        t.position()
    }

    /// Borrow the musical transport snapshot (tempo / time signature / playhead).
    pub fn transport(&self) -> Transport {
        let mut t = self.transport;
        t.sample_pos = self.sample_pos;
        t.playing = self.playing;
        t
    }

    // --- U15 metering (additive) -------------------------------------------

    /// Enable or disable level metering. Cheap: a single bool. When disabled the
    /// render loop skips all `accumulate` calls, so metering is truly zero-cost
    /// while off.
    pub fn set_metering(&mut self, on: bool) {
        self.meters.enabled = on;
        if !on {
            self.meters.reset();
        }
    }

    /// Whether metering is currently enabled.
    pub fn metering_enabled(&self) -> bool {
        self.meters.enabled
    }

    /// Borrow the meter bank (per-node + master RMS/peak). Read the windows with
    /// [`crate::Meter::rms`] / [`crate::Meter::peak`].
    pub fn meters(&self) -> &MeterBank {
        &self.meters
    }

    /// Mutably borrow the meter bank (e.g. to `take`/reset windows after a read).
    pub fn meters_mut(&mut self) -> &mut MeterBank {
        &mut self.meters
    }

    // --- U16 resilience (additive) -----------------------------------------

    /// Borrow the per-node resilience flags (non-finite output / over-budget).
    pub fn budget(&self) -> &NodeBudget {
        &self.budget
    }

    /// Mutably borrow the resilience flags (e.g. to clear after surfacing them).
    pub fn budget_mut(&mut self) -> &mut NodeBudget {
        &mut self.budget
    }

    /// Arm the per-block CPU watchdog (std-only). Each node gets `budget_ns`
    /// nanoseconds per block; if `auto_bypass` is set, an over-budget node is
    /// flagged AND bypassed so a runaway node degrades to silence instead of
    /// xrunning the whole stream. Pass `None` to disarm.
    #[cfg(feature = "std")]
    pub fn set_watchdog(&mut self, watchdog: Option<crate::resilience::Watchdog>) {
        self.watchdog = watchdog;
    }

    /// Attach a RT -> control return ring so the engine publishes `Meter` /
    /// `Beat` frames at each block end (std-only). The caller keeps a clone of
    /// the same `Arc` and drains it on the control thread. Pass `None` to detach.
    /// The publish itself is non-blocking and allocation-free; if the ring is
    /// full, frames are simply dropped (last-value-wins is fine for metering).
    #[cfg(feature = "std")]
    pub fn attach_meter_ring(&mut self, ring: Option<alloc::sync::Arc<crate::meter::MeterRing>>) {
        self.meter_ring = ring;
    }

    /// Non-blocking publish of the current meter snapshot + transport beat onto
    /// the attached return ring. Called at block end from `process_block` when
    /// metering is on; safe to call directly too. Allocation-free: it encodes
    /// into a stack buffer and `push`es into the pre-allocated ring, dropping
    /// frames rather than blocking when the ring is full.
    #[cfg(feature = "std")]
    fn publish_meters(&mut self) {
        let Some(ring) = self.meter_ring.as_ref() else {
            return;
        };
        use crate::meter::return_frame;
        let mut buf = [0u8; return_frame::MAX_LEN];

        // Master level.
        let (rms, peak) = self.meters.master.take();
        let master_id = self.program.ids[self.program.master_out];
        let n = return_frame::encode_meter(master_id, rms, peak, &mut buf);
        let _ = ring.push(&buf[..n]);

        // Per-node levels (only nodes that actually have an output meter).
        for slot in 0..self.meters.nodes.len() {
            let (rms, peak) = self.meters.nodes[slot].take();
            let id = self.program.ids[slot];
            let n = return_frame::encode_meter(id, rms, peak, &mut buf);
            let _ = ring.push(&buf[..n]);
        }

        // Transport beat.
        let pos = self.transport_pos();
        let n = return_frame::encode_beat(pos.bar, pos.beat, pos.phase, &mut buf);
        let _ = ring.push(&buf[..n]);
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
        // Resize the per-node meter / resilience tables to the new node count.
        // Off the hot path (block boundary), so allocation here is allowed — the
        // same contract as the pointer-scratch grow above.
        let n = program.len();
        self.meters.resize(n);
        self.budget.resize(n);
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
                self.meter_node(node, nframes);
                continue;
            }

            // U16 watchdog: time the render (std-only; disarmed => no timing).
            #[cfg(feature = "std")]
            let timed = {
                if let Some(w) = self.watchdog.as_mut() {
                    w.start();
                    true
                } else {
                    false
                }
            };

            self.render_node(node, nframes);

            #[cfg(feature = "std")]
            if timed {
                // `as_mut` again to release the earlier borrow across `render_node`.
                let over = self.watchdog.as_mut().map(|w| w.check()).unwrap_or(false);
                if over {
                    self.budget.over_budget[node] = true;
                    if self.watchdog.map(|w| w.auto_bypass).unwrap_or(false) {
                        // Auto-bypass the offender: zero its output this block so a
                        // runaway node degrades to silence rather than xrunning.
                        self.program.bypassed[node] = true;
                        for buf in self.program.out_bufs[node].iter_mut() {
                            for s in buf.iter_mut().take(nframes) {
                                *s = 0.0;
                            }
                        }
                    }
                }
            }

            // U16 NaN/denormal guard: flush any non-finite/denormal output to
            // silence and flag the node so the control plane can surface it.
            self.sanitize_node(node, nframes);
            // U15 metering: fold the node's output into its per-node meter.
            self.meter_node(node, nframes);
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

        // U16: guard the master output too (a non-finite source would otherwise
        // reach the device). U15: fold it into the master meter.
        if sanitize(&mut out[..nframes]) {
            // Flag the master node so the control plane sees the garbage.
            self.budget.non_finite[self.program.master_out] = true;
        }
        if self.meters.enabled {
            self.meters.master.accumulate(&out[..nframes]);
        }

        // Advance the minimal transport clock once per block while playing.
        if self.playing {
            self.sample_pos = self.sample_pos.wrapping_add(nframes as u64);
        }
        // Keep the musical transport's playhead in lockstep with the minimal
        // clock so `transport_pos` reflects the just-rendered block.
        self.transport.sample_pos = self.sample_pos;
        self.transport.playing = self.playing;

        // U15: non-blocking publish of the meter snapshot + beat at block end.
        // Only when metering is on (and a ring is attached); alloc-free.
        #[cfg(feature = "std")]
        if self.meters.enabled {
            self.publish_meters();
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

    /// U16: flush any non-finite/denormal sample in every output buffer of
    /// `node` to silence; raise the node's `non_finite` flag if it had to.
    /// Alloc-free; runs on the audio thread.
    fn sanitize_node(&mut self, node: usize, nframes: usize) {
        let mut dirty = false;
        for buf in self.program.out_bufs[node].iter_mut() {
            let n = nframes.min(buf.len());
            if sanitize(&mut buf[..n]) {
                dirty = true;
            }
        }
        if dirty {
            self.budget.non_finite[node] = true;
        }
    }

    /// U15: fold `node`'s primary output (port 0) into its per-node meter, only
    /// when metering is enabled. A single bool test when off. Alloc-free.
    fn meter_node(&mut self, node: usize, nframes: usize) {
        if !self.meters.enabled {
            return;
        }
        if let Some(buf) = self.program.out_bufs[node].first() {
            let n = nframes.min(buf.len());
            self.meters.nodes[node].accumulate(&buf[..n]);
        }
    }
}
