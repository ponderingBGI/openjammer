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

use alloc::sync::Arc;
use alloc::vec;
use alloc::vec::Vec;

use ojproto::{NodeIdx, PrimitiveKind, RtCommand};

use crate::compile::CompiledProgram;
use crate::dsp::ProcessCtx;
use crate::meter::MeterBank;
use crate::resilience::{sanitize, NodeBudget};
use crate::tempo::{MetricCursor, TempoMapRt};
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
    /// Authoritative transport FSM, sample clock, and loop/punch state.
    pub(crate) transport: Transport,
    /// Immutable tempo/meter snapshot used when no native RCU receiver is attached.
    tempo_map: Arc<TempoMapRt>,
    /// Native swap-whole tempo publication handle. Loaded once per process block.
    #[cfg(feature = "std")]
    tempo_map_rx: Option<crate::swap::RtCellRx<TempoMapRt>>,
    metric_cursor: MetricCursor,
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
    /// Optional RT -> control event ring for compact fault events. Separate from
    /// meters so a fault storm cannot evict level frames.
    #[cfg(feature = "std")]
    pub(crate) event_ring: Option<alloc::sync::Arc<crate::meter::EventRing>>,
}

// The raw pointers in the scratch are only ever populated and consumed within a
// single `process_block` call (never observed across calls or threads), and the
// `Engine` is owned by a single (audio) thread. The `CompiledProgram` it holds
// is itself `Send`.
unsafe impl Send for Engine {}

impl Engine {
    /// Wrap a freshly [`crate::compile()`]d program. Sizes the pointer scratch to
    /// the program's widest port counts (one allocation, off the hot path).
    pub fn new(program: CompiledProgram) -> Self {
        let in_ptrs = vec![core::ptr::null(); program.max_in];
        let out_ptrs = vec![core::ptr::null_mut(); program.max_out];
        let n = program.len();
        let sample_rate = program.sample_rate.max(1);
        Self {
            program,
            in_ptrs,
            out_ptrs,
            transport: Transport::new(sample_rate as f32),
            tempo_map: Arc::new(TempoMapRt::one_point(sample_rate, 120.0, 4, 4)),
            #[cfg(feature = "std")]
            tempo_map_rx: None,
            metric_cursor: MetricCursor::default(),
            meters: MeterBank::with_nodes(n),
            budget: NodeBudget::with_nodes(n),
            #[cfg(feature = "std")]
            watchdog: None,
            #[cfg(feature = "std")]
            meter_ring: None,
            #[cfg(feature = "std")]
            event_ring: None,
        }
    }

    /// Whether the transport clock is running.
    pub fn is_playing(&self) -> bool {
        self.transport.is_playing()
    }

    /// Current transport sample position.
    pub fn sample_pos(&self) -> u64 {
        self.transport.sample_pos()
    }

    // --- U12 musical transport (additive) ----------------------------------

    /// Set the musical tempo in BPM. Off-RT or RT-safe (a single field write);
    /// takes effect on the next position read. Non-positive values are ignored.
    pub fn set_tempo(&mut self, bpm: f32) {
        if bpm.is_finite() && bpm > 0.0 {
            self.tempo_map = Arc::new(TempoMapRt::one_point(
                self.transport.sample_rate() as u32,
                bpm,
                4,
                4,
            ));
        }
    }

    /// Set the time signature `numerator/denominator` (e.g. `4, 4`). RT-safe.
    pub fn set_time_signature(&mut self, numerator: u32, denominator: u32) {
        self.tempo_map = Arc::new(TempoMapRt::one_point(
            self.transport.sample_rate() as u32,
            120.0,
            numerator.clamp(1, u8::MAX as u32) as u8,
            denominator.clamp(1, u8::MAX as u32) as u8,
        ));
    }

    /// Set the transport sample rate (Hz) used to convert the sample playhead
    /// into musical time. Call once after compiling for a given graph.
    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.transport.set_sample_rate(sample_rate);
        self.tempo_map = Arc::new(TempoMapRt::one_point(
            self.transport.sample_rate() as u32,
            120.0,
            4,
            4,
        ));
    }

    /// Install an immutable tempo map directly (wasm and single-threaded hosts).
    pub fn install_tempo_map(&mut self, map: TempoMapRt) {
        self.transport.set_sample_rate(map.sample_rate() as f32);
        self.tempo_map = Arc::new(map);
        self.metric_cursor = MetricCursor::default();
    }

    /// Attach the native swap-whole tempo-map reader.
    #[cfg(feature = "std")]
    pub fn attach_tempo_map(&mut self, rx: Option<crate::swap::RtCellRx<TempoMapRt>>) {
        self.tempo_map_rx = rx;
        self.metric_cursor = MetricCursor::default();
    }

    /// Install loop and punch ranges from the current timeline document.
    pub fn set_transport_ranges(
        &mut self,
        loop_range: Option<(u64, u64)>,
        punch_range: Option<(u64, u64)>,
    ) {
        self.transport.set_ranges(loop_range, punch_range);
    }

    /// Install the transport-owned ranges from a published timeline document.
    pub fn set_timeline_transport(&mut self, timeline: &ojproto::Timeline) {
        self.set_transport_ranges(timeline.loop_range, timeline.punch_range);
    }

    /// The current musical position (bar / beat / phase) derived from the live
    /// sample playhead — enough to emit an [`ojproto::EngineFrame::Beat`].
    /// RT-safe: pure arithmetic, no allocation.
    pub fn transport_pos(&self) -> TransportPos {
        let map = self.tempo_snapshot();
        self.transport.position(&map, &mut MetricCursor::default())
    }

    /// Borrow the musical transport snapshot (tempo / time signature / playhead).
    pub fn transport(&self) -> Transport {
        self.transport
    }

    fn tempo_snapshot(&self) -> Arc<TempoMapRt> {
        #[cfg(feature = "std")]
        if let Some(rx) = self.tempo_map_rx.as_ref() {
            return rx.load_full();
        }
        Arc::clone(&self.tempo_map)
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

    /// Attach a dedicated RT -> control event ring so detected node faults can
    /// surface to DevLog/diagnostics without allocating on the audio thread.
    #[cfg(feature = "std")]
    pub fn attach_event_ring(&mut self, ring: Option<alloc::sync::Arc<crate::meter::EventRing>>) {
        self.event_ring = ring;
    }

    /// Non-blocking publish of the current meter snapshot + transport beat onto
    /// the attached return ring. Called at block end from `process_block` when
    /// metering is on; safe to call directly too. Allocation-free: it encodes
    /// into a stack buffer and `push`es into the pre-allocated ring, dropping
    /// frames rather than blocking when the ring is full.
    #[cfg(feature = "std")]
    fn publish_levels(&mut self, map: &TempoMapRt) {
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
        let pos = self.transport.position(map, &mut self.metric_cursor);
        let n = return_frame::encode_beat(pos.bar, pos.beat, pos.phase, &mut buf);
        let _ = ring.push(&buf[..n]);
        let n = return_frame::encode_transport(
            pos.sample,
            pos.tick,
            pos.bar,
            pos.beat.min(u16::MAX as u32) as u16,
            pos.phase,
            self.transport.motion() as u8,
            self.transport.record_armed(),
            self.transport.loop_on(),
            &mut buf,
        );
        let _ = ring.push(&buf[..n]);
    }

    /// UNGATED looper return path: published every block regardless of the
    /// metering toggle, because the looper's transport state (the row, the
    /// playhead) must surface even when level meters are off. For each
    /// looper-kind slot it pushes a control-rate [`ojproto::EngineFrame::Looper`]
    /// snapshot onto the (lossy) meter ring AND drains any state-transition edge
    /// onto the (loss-proof) EVENT ring as [`ojproto::RtEvent::LooperEdge`] —
    /// exactly like [`Self::emit_node_fault`], so a commit transition is never
    /// dropped. Allocation-free: stack-buffer encode + ring `push`; non-looper
    /// nodes inherit `looper_snapshot()/take_looper_edge() == None` and are skipped.
    #[cfg(feature = "std")]
    fn publish_looper(&mut self) {
        use crate::meter::{event_frame, return_frame};
        let n_slots = self.program.instances.len();
        for slot in 0..n_slots {
            if self.program.kinds[slot] != PrimitiveKind::Looper {
                continue;
            }
            let id = self.program.ids[slot];

            // Snapshot -> Looper frame on the meter ring (always, ungated).
            if let Some((state, pos, loop_len, peak)) =
                self.program.instances[slot].looper_snapshot()
            {
                if let Some(ring) = self.meter_ring.as_ref() {
                    let mut buf = [0u8; return_frame::MAX_LEN];
                    let n = return_frame::encode_looper(id, state, pos, loop_len, peak, &mut buf);
                    let _ = ring.push(&buf[..n]);
                }
            }

            // Transition edge -> LooperEdge on the loss-proof EVENT ring.
            if let Some((from, to)) = self.program.instances[slot].take_looper_edge() {
                if let Some(ring) = self.event_ring.as_ref() {
                    let ev = ojproto::RtEvent::LooperEdge { node: id, from, to };
                    let _ = event_frame::emit(ring, ev);
                }
            }
        }
    }

    /// Emit a compact, RT-safe node fault event onto the attached event ring.
    #[cfg(feature = "std")]
    fn emit_node_fault(&self, slot: usize, fault: ojproto::FaultKind) {
        if let Some(ring) = self.event_ring.as_ref() {
            let node = self.program.ids[slot];
            let ev = ojproto::RtEvent::NodeFault { node, fault };
            let _ = crate::meter::event_frame::emit(ring, ev);
        }
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

    // --- Command application (no_std SINGLE source of truth) ----------------

    /// Apply a single [`RtCommand`] to the running program. The ONE
    /// implementation of command application, shared by BOTH hosts: the native
    /// std [`crate::CommandQueue`] drain (`command.rs`) and the wasm
    /// AudioWorklet's own SAB-ring drain delegate here, so there is exactly one
    /// per-variant routing. **`no_std`** (not behind the `std` feature) and
    /// RT-safe: a bounded amount of work, no allocation, no locking — callable
    /// directly on the audio thread.
    ///
    /// * `SetParam`  -> resolve node slot, call `set_param(param, value)`.
    /// * `NoteOn`/`NoteOff` -> resolve node slot, drive the target instance's
    ///   [`crate::DspInstance::note_on`] / [`crate::DspInstance::note_off`].
    ///   Effect-only nodes inherit the trait's default no-op, so the event is
    ///   harmlessly ignored there; instrument/voice nodes consume it.
    /// * `Bypass`    -> toggle the node's bypass flag.
    /// * `TransportPlay`/`TransportPause`/`Seek` -> drive the minimal
    ///   sample-counting clock (`playing` / `sample_pos`).
    /// * `Looper`    -> resolve node slot, drive the target instance's
    ///   [`crate::DspInstance::looper_action`]. Non-looper nodes inherit the
    ///   trait's default no-op; a [`crate::LooperNode`] consumes it.
    pub fn apply_rt(&mut self, cmd: RtCommand) {
        match cmd {
            RtCommand::SetParam { node, param, value } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.instances[slot].set_param(param, value);
                }
            }
            RtCommand::NoteOn { node, note, vel } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.instances[slot].note_on(note, vel);
                }
            }
            RtCommand::NoteOff { node, note } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.instances[slot].note_off(note);
                }
            }
            RtCommand::Bypass { node, on } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.bypassed[slot] = on;
                }
            }
            RtCommand::TransportPlay => self.transport.play(),
            RtCommand::TransportPause => self.transport.pause(),
            RtCommand::Seek { samples } => self.transport.locate(samples),
            RtCommand::TransportSet { flag, on } => self.transport.set_flag(flag, on),
            RtCommand::Looper { node, action, arg } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.instances[slot].looper_action(action, arg);
                }
            }
        }
    }

    /// Mutable view of a source node's output buffer, so the host can inject
    /// external input (e.g. a `GraphIn`/`MicIn` block) before `process_block`.
    /// The executor leaves source-node output buffers intact, so whatever is
    /// written here flows downstream this block. `None` if the node id or port
    /// is unknown.
    pub fn input_mut(&mut self, node: NodeIdx, port: usize) -> Option<&mut [f32]> {
        let slot = self.program.slot_of_id(node)?;
        self.program
            .out_bufs
            .get_mut(slot)?
            .get_mut(port)
            .map(|b| b.as_mut_slice())
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

    /// Render one block of `nframes` into `out` (a single mono device channel).
    /// Thin wrapper over [`Engine::process_block_into`] — kept so every existing
    /// mono caller (the native host, the wasm worklet, the render/loopback bins)
    /// compiles unchanged and stays byte-identical.
    pub fn process_block(&mut self, out: &mut [f32], nframes: usize) {
        let mut outs: [&mut [f32]; 1] = [out];
        self.process_block_into(&mut outs, nframes);
    }

    /// Render one block of `nframes` into `outs.len()` device channels (the master
    /// node's resolved input, mapped across the channels — see docs/CHANNELS.md).
    /// A single channel is bit-identical to the historical mono path.
    ///
    /// RT-SAFETY: NO heap allocation, NO locks. It walks the pre-computed,
    /// cycle-free schedule; for each node it mixes the node's inputs into the
    /// pre-sized `in_scratch`, points reusable channel-pointer arrays at the
    /// pre-sized buffers, and calls the node's `process`. Then it emits the
    /// master-output node's resolved input into every device channel, per-channel
    /// gained / guarded / limited / metered.
    pub fn process_block_into(&mut self, outs: &mut [&mut [f32]], nframes: usize) {
        debug_assert!(nframes <= self.program.block_size, "block overrun");
        let dev_len = outs.iter().map(|o| o.len()).min().unwrap_or(0);
        let nframes = nframes.min(self.program.block_size).min(dev_len);
        #[cfg(feature = "std")]
        let map = self.tempo_snapshot();

        let mut offset = 0;
        while offset < nframes {
            let remaining = nframes - offset;
            let edge = self.transport.frames_until_edge(remaining);
            if edge == 0 {
                let before = self.transport.sample_pos();
                self.transport.finish_edge();
                if self.transport.sample_pos() == before {
                    // Invalid/stale edge state must never spin the audio thread.
                    self.render_audio_span(outs, offset, remaining);
                    self.apply_declick(outs, offset, remaining);
                    self.transport.advance(remaining);
                    offset = nframes;
                }
                continue;
            }

            self.render_audio_span(outs, offset, edge);
            self.apply_declick(outs, offset, edge);
            self.transport.advance(edge);
            offset += edge;
            self.transport.finish_edge();
        }

        for out in outs.iter_mut() {
            for sample in out.iter_mut().skip(nframes) {
                *sample = 0.0;
            }
        }

        // Control-rate publishing happens once per caller block, from the same
        // position/map read for both Beat and Transport.
        #[cfg(feature = "std")]
        if self.meters.enabled {
            self.publish_levels(&map);
        }
        #[cfg(feature = "std")]
        self.publish_looper();
        #[cfg(feature = "std")]
        self.publish_faults();
    }

    /// Render one event-free span into caller output starting at `output_offset`.
    /// Internal DSP scratch intentionally starts at zero for each span; only
    /// external source buffers use the caller offset.
    fn render_audio_span(&mut self, outs: &mut [&mut [f32]], output_offset: usize, nframes: usize) {
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
                self.passthrough(node, output_offset, nframes);
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

            self.render_node(node, output_offset, nframes);

            #[cfg(feature = "std")]
            if timed {
                // `as_mut` again to release the earlier borrow across `render_node`.
                let over = self.watchdog.as_mut().map(|w| w.check()).unwrap_or(false);
                if over {
                    self.budget.over_budget[node] = true;
                    self.emit_node_fault(node, ojproto::FaultKind::OverBudget);
                    if self.watchdog.map(|w| w.auto_bypass).unwrap_or(false) {
                        // Auto-bypass the offender: zero its output this block so a
                        // runaway node degrades to silence rather than xrunning.
                        self.program.bypassed[node] = true;
                        self.emit_node_fault(node, ojproto::FaultKind::AutoBypassed);
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

        // Emit the master node's RESOLVED INPUT into EVERY device channel. The
        // master sink (SpeakerOut / GraphOut) produces no audio of its own; the
        // engine's output IS the mix feeding its input port 0. A mono master
        // upmixes that mix to every device channel (centred); a true stereo master
        // mapping lane->channel arrives with the adaptation step. Per channel:
        // master gain, NaN/denormal guard, brickwall limiter. A SINGLE device
        // channel is bit-identical to the historical mono path.
        let master = self.program.master_out;
        // Master volume / mute: a single field read; default unity, so graphs whose
        // SpeakerOut never set a volume stay bit-identical.
        let mg = self.program.instances[master].master_gain();
        let mut master_dirty = false;
        for (ch, out) in outs.iter_mut().enumerate() {
            let out = &mut out[output_offset..output_offset + nframes];
            for o in out.iter_mut() {
                *o = 0.0;
            }
            if let Some(port0) = self
                .program
                .routing
                .get(master)
                .and_then(|r| r.inputs.first())
            {
                // Borrow split: read sources from `out_bufs` (on `self`), write the
                // caller's `out` (disjoint). No allocation.
                //
                // CHANNEL ADAPTATION (docs/CHANNELS.md §4): a source PORT `p` owns the
                // `out_bufs` lanes `[p*oc .. p*oc+oc)`. A MONO source (oc == 1) feeds
                // its one lane to EVERY device channel (centred upmix); a STEREO source
                // maps lane->channel (clamped to its last lane), so stereo content
                // plays true stereo. At oc == 1 this is `lane == src.port` — byte-
                // identical to the historical mono path.
                for k in 0..port0.len() {
                    let src = self.program.routing[master].inputs[0][k];
                    let src_oc = self.program.out_channels[src.node].max(1) as usize;
                    let lane = src.port as usize * src_oc + ch.min(src_oc - 1);
                    if let Some(src_buf) = self.program.out_bufs[src.node].get(lane) {
                        let source_offset = if matches!(
                            self.program.kinds[src.node],
                            PrimitiveKind::GraphIn | PrimitiveKind::MicIn
                        ) {
                            output_offset
                        } else {
                            0
                        };
                        for (o, &s) in out.iter_mut().zip(src_buf.iter().skip(source_offset)) {
                            *o += s;
                        }
                    }
                }
            }
            if mg != 1.0 {
                for o in out.iter_mut() {
                    *o *= mg;
                }
            }
            // U16: guard the master output (a non-finite source would otherwise reach
            // the device). Flag if ANY channel produced non-finite.
            if sanitize(&mut out[..nframes]) {
                master_dirty = true;
            }
            // Master brickwall limiter — AFTER sanitize (so a master-level NaN/Inf is
            // still flagged, not swallowed) and BEFORE metering (so the meter reflects
            // what is heard). Reuses the shared `ojcore-dsp` soft knee; its linear
            // region passes through untouched, so quiet/normal graphs stay
            // bit-identical (the committed golden fingerprints hold).
            for o in out.iter_mut() {
                *o = ojcore_dsp::guards::soft_limit(*o);
            }
            // U15 metering: only the FIRST device channel folds into the single master
            // meter, so a mono graph is byte-identical to the pre-stereo path.
            if ch == 0 && self.meters.enabled {
                self.meters.master.accumulate(out);
            }
        }
        if master_dirty {
            // Flag the master node so the control plane sees the garbage.
            self.budget.non_finite[self.program.master_out] = true;
            #[cfg(feature = "std")]
            self.emit_node_fault(self.program.master_out, ojproto::FaultKind::NonFinite);
        }
    }

    fn apply_declick(&mut self, outs: &mut [&mut [f32]], offset: usize, nframes: usize) {
        for frame in 0..nframes {
            let gain = self.transport.next_master_gain();
            if gain != 1.0 {
                for out in outs.iter_mut() {
                    out[offset + frame] *= gain;
                }
            }
        }
    }

    /// Emit a [`ojproto::FaultKind::Crashed`] node fault for every node that has
    /// LATCHED to a dry passthrough at runtime ([`DspInstance::runtime_degraded`] —
    /// a crashed hosted plugin or a trapped code node). Re-emitted every block it
    /// stays degraded, so a frame dropped on a full ring re-sends next block
    /// (naturally loss-proof) and is coalesced off-RT exactly like a persistently
    /// non-finite node. Alloc-free: a `bool` read per node + the stack-buffer
    /// `emit_node_fault`. Skips healthy nodes (default `runtime_degraded() == false`).
    #[cfg(feature = "std")]
    fn publish_faults(&self) {
        if self.event_ring.is_none() {
            return;
        }
        for slot in 0..self.program.instances.len() {
            if self.program.instances[slot].runtime_degraded() {
                self.emit_node_fault(slot, ojproto::FaultKind::Crashed);
            }
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
    fn render_node(&mut self, node: usize, source_offset: usize, nframes: usize) {
        let n_in = self.program.routing[node].inputs.len();
        let n_out = self.program.out_bufs[node].len();

        // --- mix step: fold every source of each input port's CHANNELS into its
        // `in_scratch` LANES (lane = port*in_ch + channel), with the §4 adaptation,
        // then publish a pointer to each lane. At in_ch == 1 this is one lane per
        // port — byte-identical to the historical mono mix (docs/CHANNELS.md).
        let in_ch = self.program.in_channels[node].max(1) as usize;
        let n_in_lanes = (n_in * in_ch).min(MAX_CH);
        for port in 0..n_in {
            for c in 0..in_ch {
                let lane = port * in_ch + c;
                self.mix_input_lane(node, port, c, in_ch, source_offset, nframes);
                if lane < self.in_ptrs.len() {
                    self.in_ptrs[lane] = self.program.in_scratch[lane].as_ptr();
                }
            }
        }
        // --- point outputs at the node's own buffers (already per-lane).
        for port in 0..n_out {
            self.out_ptrs[port] = self.program.out_bufs[node][port].as_mut_ptr();
        }

        let n_out_ch = n_out.min(MAX_CH);
        let mut ins: [&[f32]; MAX_CH] = [&[]; MAX_CH];
        let mut outs: [&mut [f32]; MAX_CH] = Default::default();
        // SAFETY: every pointer was just set from a live `nframes`-long buffer;
        // the input rows (`in_scratch`) and output rows (`out_bufs[node]`) are
        // disjoint allocations, so these views never alias.
        unsafe {
            for (i, &p) in self.in_ptrs.iter().take(n_in_lanes).enumerate() {
                ins[i] = core::slice::from_raw_parts(p, nframes);
            }
            for (i, &p) in self.out_ptrs.iter().take(n_out_ch).enumerate() {
                outs[i] = core::slice::from_raw_parts_mut(p, nframes);
            }
        }
        let mut ctx = ProcessCtx {
            inputs: &ins[..n_in_lanes],
            outputs: &mut outs[..n_out_ch],
            nframes,
        };
        self.program.instances[node].process(&mut ctx);
    }

    /// Sum every source feeding `(node, port)` channel 0 into the port's first
    /// input lane — the mono / bypass-passthrough path. Thin wrapper over
    /// [`Engine::mix_input_lane`] so there is one mix implementation.
    fn mix_input(&mut self, node: usize, port: usize, source_offset: usize, nframes: usize) {
        let in_ch = self.program.in_channels[node].max(1) as usize;
        self.mix_input_lane(node, port, 0, in_ch, source_offset, nframes);
    }

    /// Sum every source feeding `(node, port)` CHANNEL `channel` into the input
    /// scratch LANE `port*in_ch + channel`, applying the §4 channel adaptation: a
    /// mono source (out_channels == 1) contributes its one lane to every dest
    /// channel; a stereo source maps lane->channel (clamped to its last lane). At
    /// `in_ch == 1` this is one lane per port — byte-identical to the historical
    /// mono mix (docs/CHANNELS.md).
    ///
    /// `in_scratch`, `routing`, `out_bufs`, `out_channels` are DISTINCT fields, so
    /// this needs no raw pointers: the program's borrows split by field, and the
    /// destination row (`in_scratch`) never aliases the producer rows (`out_bufs`)
    /// — the Kahn schedule guarantees a node is never its own source. Alloc-free.
    fn mix_input_lane(
        &mut self,
        node: usize,
        port: usize,
        channel: usize,
        in_ch: usize,
        source_offset: usize,
        nframes: usize,
    ) {
        let dest_lane = port * in_ch + channel;
        let prog = &mut self.program;
        if dest_lane >= prog.in_scratch.len() {
            return;
        }
        let dst = &mut prog.in_scratch[dest_lane][..nframes];
        for d in dst.iter_mut() {
            *d = 0.0;
        }
        for src in &prog.routing[node].inputs[port] {
            let src_oc = prog.out_channels[src.node].max(1) as usize;
            let src_lane = src.port as usize * src_oc + channel.min(src_oc - 1);
            if let Some(src_buf) = prog.out_bufs[src.node].get(src_lane) {
                let offset = if matches!(
                    prog.kinds[src.node],
                    PrimitiveKind::GraphIn | PrimitiveKind::MicIn
                ) {
                    source_offset
                } else {
                    0
                };
                for (d, &s) in dst.iter_mut().zip(src_buf.iter().skip(offset)) {
                    *d += s;
                }
            }
        }
    }

    /// Bypass passthrough: copy `node`'s first resolved input into its first
    /// output buffer. Allocation-free; no-op if the node has no output port.
    fn passthrough(&mut self, node: usize, source_offset: usize, nframes: usize) {
        if self.program.out_bufs[node].is_empty() {
            return;
        }
        let has_in = !self.program.routing[node].inputs.is_empty();
        if has_in {
            self.mix_input(node, 0, source_offset, nframes);
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
            #[cfg(feature = "std")]
            self.emit_node_fault(node, ojproto::FaultKind::NonFinite);
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

#[cfg(test)]
mod apply_rt_tests {
    //! `no_std` unit tests for [`Engine::apply_rt`] — the SINGLE shared
    //! command-routing surface both hosts delegate to. These build a minimal
    //! [`CompiledProgram`] over a mock [`DspInstance`] that records the last
    //! note/param/looper call, so each variant is checked in isolation without
    //! the full compiler. (Std-side `Engine::apply` / `drain` parity is covered
    //! by the `tests/engine.rs` integration suite, which still drives the same
    //! `apply_rt` underneath.)
    use super::*;
    use crate::compile::{CompiledProgram, NodeRouting};
    use crate::dsp::{DspInstance, ProcessCtx};
    use alloc::boxed::Box;
    use alloc::rc::Rc;
    use core::cell::Cell;
    use ojproto::{looper_action, NodeIdx, PrimitiveKind, RtCommand};

    /// Shared sink the test keeps a handle to while the same handle lives inside
    /// the boxed mock instance — so a test can read back which RT method
    /// `apply_rt` drove (and with what payload) without downcasting the trait
    /// object. `Rc<Cell<_>>` is single-thread (the test thread) and `alloc`-only,
    /// keeping the module `no_std`.
    #[derive(Default)]
    struct ProbeState {
        last_note_on: Cell<Option<(u8, u8)>>,
        last_note_off: Cell<Option<u8>>,
        last_set_param: Cell<Option<(u16, f32)>>,
        last_looper: Cell<Option<(u8, u32)>>,
    }

    /// A mock node that records every RT call it receives into a shared
    /// [`ProbeState`].
    struct ProbeNode {
        state: Rc<ProbeState>,
    }

    // The probe never crosses threads in tests; `Send` only satisfies the trait
    // bound. SAFETY: it is constructed and read on the single test thread.
    unsafe impl Send for ProbeNode {}

    impl DspInstance for ProbeNode {
        fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}
        fn process(&mut self, _ctx: &mut ProcessCtx<'_, '_>) {}
        fn set_param(&mut self, id: u16, value: f32) {
            self.state.last_set_param.set(Some((id, value)));
        }
        fn note_on(&mut self, note: u8, vel: u8) {
            self.state.last_note_on.set(Some((note, vel)));
        }
        fn note_off(&mut self, note: u8) {
            self.state.last_note_off.set(Some(note));
        }
        fn looper_action(&mut self, action: u8, arg: u32) {
            self.state.last_looper.set(Some((action, arg)));
        }
    }

    /// Build a trivial two-node engine: one `ProbeNode` instrument (IR id `7`)
    /// feeding a `SpeakerOut` master (IR id `0`). Returns the engine plus a
    /// handle to the probe's state so the caller can assert what `apply_rt`
    /// routed. Enough for `apply_rt` to resolve a slot, route
    /// notes/params/looper, and toggle bypass.
    fn probe_engine() -> (Engine, Rc<ProbeState>) {
        let state = Rc::new(ProbeState::default());
        // Slots: 0 = ProbeNode (id 7), 1 = SpeakerOut master (id 0).
        let instances: Vec<Box<dyn DspInstance>> = vec![
            Box::new(ProbeNode {
                state: state.clone(),
            }),
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
        ];
        let ids = vec![NodeIdx(7), NodeIdx(0)];
        // Sorted-by-id index used by `slot_of_id`'s binary search.
        let id_index = vec![(NodeIdx(0), 1), (NodeIdx(7), 0)];
        let program = CompiledProgram {
            sample_rate: 48_000,
            instances,
            routing: vec![NodeRouting::default(), NodeRouting::default()],
            out_bufs: vec![vec![vec![0.0; 4]], vec![]],
            out_channels: vec![1, 1],
            in_channels: vec![1, 1],
            bypassed: vec![false, false],
            kinds: vec![PrimitiveKind::Osc, PrimitiveKind::SpeakerOut],
            ids,
            id_index,
            master_out: 1,
            block_size: 4,
            in_scratch: vec![vec![0.0; 4]],
            max_in: 1,
            max_out: 1,
            schedule: vec![0, 1],
        };
        (Engine::new(program), state)
    }

    #[test]
    fn note_on_reaches_instance() {
        let (mut engine, probe) = probe_engine();
        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(7),
            note: 64,
            vel: 100,
        });
        assert_eq!(probe.last_note_on.get(), Some((64, 100)));
        assert_eq!(probe.last_note_off.get(), None);
    }

    #[test]
    fn note_off_reaches_instance() {
        let (mut engine, probe) = probe_engine();
        engine.apply_rt(RtCommand::NoteOff {
            node: NodeIdx(7),
            note: 64,
        });
        assert_eq!(probe.last_note_off.get(), Some(64));
    }

    #[test]
    fn publish_faults_emits_node_fault_crashed_for_a_runtime_degraded_node() {
        use crate::meter::{event_frame, EventRing};
        use alloc::sync::Arc;
        use ojproto::{FaultKind, RtEvent};

        /// A stub that reports it LATCHED to passthrough at runtime (a crashed
        /// hosted plugin / trapped code node) — what `runtime_degraded()` returns.
        struct DegradedNode {
            degraded: bool,
        }
        unsafe impl Send for DegradedNode {}
        impl DspInstance for DegradedNode {
            fn activate(&mut self, _sr: f32, _mb: usize) {}
            fn process(&mut self, _ctx: &mut ProcessCtx<'_, '_>) {}
            fn set_param(&mut self, _id: u16, _v: f32) {}
            fn runtime_degraded(&self) -> bool {
                self.degraded
            }
        }

        // Slot 0 = a runtime-degraded node (id 7); slot 1 = a healthy master (id 0).
        let instances: Vec<Box<dyn DspInstance>> = vec![
            Box::new(DegradedNode { degraded: true }),
            Box::new(DegradedNode { degraded: false }),
        ];
        let program = CompiledProgram {
            sample_rate: 48_000,
            instances,
            routing: vec![NodeRouting::default(), NodeRouting::default()],
            out_bufs: vec![vec![vec![0.0; 4]], vec![]],
            out_channels: vec![1, 1],
            in_channels: vec![1, 1],
            bypassed: vec![false, false],
            kinds: vec![PrimitiveKind::Osc, PrimitiveKind::SpeakerOut],
            ids: vec![NodeIdx(7), NodeIdx(0)],
            id_index: vec![(NodeIdx(0), 1), (NodeIdx(7), 0)],
            master_out: 1,
            block_size: 4,
            in_scratch: vec![vec![0.0; 4]],
            max_in: 1,
            max_out: 1,
            schedule: vec![0, 1],
        };
        let mut engine = Engine::new(program);
        let ring = Arc::new(EventRing::new());
        engine.attach_event_ring(Some(ring.clone()));

        let mut out = vec![0.0f32; 4];
        engine.process_block(&mut out, 4);

        let mut faults = Vec::new();
        event_frame::drain_events(&ring, |ev| faults.push(ev));
        assert!(
            faults.iter().any(|ev| matches!(
                ev,
                RtEvent::NodeFault {
                    node: NodeIdx(7),
                    fault: FaultKind::Crashed,
                }
            )),
            "the degraded node emits NodeFault{{Crashed}}; got {faults:?}"
        );
        assert!(
            !faults.iter().any(|ev| matches!(
                ev,
                RtEvent::NodeFault {
                    node: NodeIdx(0),
                    ..
                }
            )),
            "a healthy node emits no fault"
        );
    }

    #[test]
    fn set_param_reaches_instance() {
        let (mut engine, probe) = probe_engine();
        engine.apply_rt(RtCommand::SetParam {
            node: NodeIdx(7),
            param: 3,
            value: 0.75,
        });
        assert_eq!(probe.last_set_param.get(), Some((3, 0.75)));
    }

    #[test]
    fn looper_action_reaches_instance() {
        let (mut engine, probe) = probe_engine();
        engine.apply_rt(RtCommand::Looper {
            node: NodeIdx(7),
            action: looper_action::RECORD,
            arg: 0,
        });
        assert_eq!(probe.last_looper.get(), Some((looper_action::RECORD, 0)));

        // An indexed action carries its layer index (and packed flags) verbatim
        // through to the instance.
        engine.apply_rt(RtCommand::Looper {
            node: NodeIdx(7),
            action: looper_action::SET_MUTE,
            arg: 3 | looper_action::MUTE_FLAG,
        });
        assert_eq!(
            probe.last_looper.get(),
            Some((looper_action::SET_MUTE, 3 | looper_action::MUTE_FLAG))
        );
    }

    #[test]
    fn bypass_toggles_the_flag() {
        let (mut engine, _probe) = probe_engine();
        assert!(!engine.program().bypassed[0]);
        engine.apply_rt(RtCommand::Bypass {
            node: NodeIdx(7),
            on: true,
        });
        assert!(engine.program().bypassed[0]);
        engine.apply_rt(RtCommand::Bypass {
            node: NodeIdx(7),
            on: false,
        });
        assert!(!engine.program().bypassed[0]);
    }

    #[test]
    fn transport_play_pause_arm_the_clock() {
        let (mut engine, _probe) = probe_engine();
        assert!(!engine.is_playing());
        engine.apply_rt(RtCommand::TransportPlay);
        assert!(engine.is_playing());
        engine.apply_rt(RtCommand::TransportPause);
        assert_eq!(engine.transport().motion(), crate::Motion::DeclickToStop);
        let mut out = vec![0.0; 4];
        for _ in 0..(crate::DeclickAmp::length(48_000.0) / 4) {
            engine.process_block(&mut out, 4);
        }
        assert!(!engine.is_playing());
    }

    #[test]
    fn seek_moves_the_playhead() {
        let (mut engine, _probe) = probe_engine();
        assert_eq!(engine.sample_pos(), 0);
        engine.apply_rt(RtCommand::Seek { samples: 48_000 });
        assert_eq!(engine.sample_pos(), 48_000);
    }

    #[test]
    fn unknown_node_is_ignored() {
        let (mut engine, probe) = probe_engine();
        // No slot for id 999: routing must be a harmless no-op (no panic).
        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(999),
            note: 60,
            vel: 64,
        });
        assert_eq!(probe.last_note_on.get(), None);
    }

    /// `process_block_into` emits the mono master mix into EVERY device channel
    /// (the mono->N upmix). Slot 0 is a `GraphIn` source the executor leaves intact,
    /// so its pre-filled buffer reaches the `SpeakerOut` master at slot 1.
    #[test]
    fn process_block_into_upmixes_master_mix_to_every_channel() {
        use crate::compile::{CompiledProgram, NodeRouting, Source};
        let instances: Vec<Box<dyn DspInstance>> = vec![
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
        ];
        let program = CompiledProgram {
            sample_rate: 48_000,
            instances,
            // Master (slot 1) input port 0 is fed by the source (slot 0).
            routing: vec![
                NodeRouting::default(),
                NodeRouting {
                    inputs: vec![vec![Source { node: 0, port: 0 }]],
                },
            ],
            out_bufs: vec![vec![vec![0.1f32; 4]], vec![]], // source emits 0.1
            out_channels: vec![1, 1],
            in_channels: vec![1, 1],
            bypassed: vec![false, false],
            // GraphIn => the executor leaves slot 0's buffer intact (no process call).
            kinds: vec![PrimitiveKind::GraphIn, PrimitiveKind::SpeakerOut],
            ids: vec![NodeIdx(1), NodeIdx(2)],
            id_index: vec![(NodeIdx(1), 0), (NodeIdx(2), 1)],
            master_out: 1,
            block_size: 4,
            in_scratch: vec![vec![0.0; 4]],
            max_in: 1,
            max_out: 1,
            schedule: vec![0, 1],
        };
        let mut engine = Engine::new(program);

        let mut l = [0.0f32; 4];
        let mut r = [0.0f32; 4];
        {
            let mut outs: [&mut [f32]; 2] = [&mut l, &mut r];
            engine.process_block_into(&mut outs, 4);
        }
        // Both device channels receive the same mono master mix (0.1), upmixed.
        // (0.1 is below the limiter's linear-region ceiling, so it passes through.)
        assert!(l.iter().all(|&x| (x - 0.1).abs() < 1e-6), "left = mono mix");
        assert!(
            r.iter().all(|&x| (x - 0.1).abs() < 1e-6),
            "right = mono mix (upmixed)"
        );

        // And the mono wrapper still yields exactly one channel of the same mix.
        let mut mono = [0.0f32; 4];
        engine.process_block(&mut mono, 4);
        assert!(mono.iter().all(|&x| (x - 0.1).abs() < 1e-6));
    }

    #[test]
    fn loop_wrap_splits_at_the_exact_output_sample() {
        use crate::compile::{CompiledProgram, NodeRouting, Source};
        let instances: Vec<Box<dyn DspInstance>> = vec![
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
        ];
        let fixture = vec![0.0, 0.1, 0.0, 0.2, 0.0, 0.3];
        let program = CompiledProgram {
            sample_rate: 48_000,
            instances,
            routing: vec![
                NodeRouting::default(),
                NodeRouting {
                    inputs: vec![vec![Source { node: 0, port: 0 }]],
                },
            ],
            out_bufs: vec![vec![fixture.clone()], vec![]],
            out_channels: vec![1, 1],
            in_channels: vec![1, 1],
            bypassed: vec![false, false],
            kinds: vec![PrimitiveKind::GraphIn, PrimitiveKind::SpeakerOut],
            ids: vec![NodeIdx(1), NodeIdx(2)],
            id_index: vec![(NodeIdx(1), 0), (NodeIdx(2), 1)],
            master_out: 1,
            block_size: 6,
            in_scratch: vec![vec![0.0; 6]],
            max_in: 1,
            max_out: 1,
            schedule: vec![0, 1],
        };
        let mut engine = Engine::new(program);
        engine.set_transport_ranges(Some((10, 14)), None);
        engine.apply_rt(RtCommand::Seek { samples: 12 });
        engine.apply_rt(RtCommand::TransportSet {
            flag: ojproto::transport_flag::LOOP_ENABLE,
            on: true,
        });
        engine.apply_rt(RtCommand::TransportPlay);

        let mut out = [0.0; 6];
        engine.process_block(&mut out, 6);

        assert_eq!(out.as_slice(), fixture.as_slice());
        assert_eq!(engine.sample_pos(), 10);
    }

    /// A STEREO source (one output port, two channels) maps lane->channel: its left
    /// lane reaches device channel 0, its right lane device channel 1. (The §4
    /// adaptation — true stereo, not an upmix.)
    #[test]
    fn process_block_into_maps_stereo_source_lanes_to_channels() {
        use crate::compile::{CompiledProgram, NodeRouting, Source};
        let instances: Vec<Box<dyn DspInstance>> = vec![
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }),
        ];
        let program = CompiledProgram {
            sample_rate: 48_000,
            instances,
            routing: vec![
                NodeRouting::default(),
                NodeRouting {
                    // Master input port 0 fed by the stereo source's PORT 0.
                    inputs: vec![vec![Source { node: 0, port: 0 }]],
                },
            ],
            // Slot 0: ONE output port × 2 channels = 2 lanes: L=0.1, R=0.2.
            out_bufs: vec![vec![vec![0.1f32; 4], vec![0.2f32; 4]], vec![]],
            out_channels: vec![2, 1],
            in_channels: vec![1, 1],
            bypassed: vec![false, false],
            kinds: vec![PrimitiveKind::GraphIn, PrimitiveKind::SpeakerOut],
            ids: vec![NodeIdx(1), NodeIdx(2)],
            id_index: vec![(NodeIdx(1), 0), (NodeIdx(2), 1)],
            master_out: 1,
            block_size: 4,
            in_scratch: vec![vec![0.0; 4]],
            max_in: 1,
            max_out: 2,
            schedule: vec![0, 1],
        };
        let mut engine = Engine::new(program);

        let mut l = [0.0f32; 4];
        let mut r = [0.0f32; 4];
        {
            let mut outs: [&mut [f32]; 2] = [&mut l, &mut r];
            engine.process_block_into(&mut outs, 4);
        }
        assert!(
            l.iter().all(|&x| (x - 0.1).abs() < 1e-6),
            "left = source L lane"
        );
        assert!(
            r.iter().all(|&x| (x - 0.2).abs() < 1e-6),
            "right = source R lane (true stereo, not upmix)"
        );

        // A mono (1-channel) call folds the stereo source to its LEFT lane (clamp).
        let mut mono = [0.0f32; 4];
        engine.process_block(&mut mono, 4);
        assert!(
            mono.iter().all(|&x| (x - 0.1).abs() < 1e-6),
            "mono = left lane"
        );
    }

    /// A STEREO signal flows THROUGH a mid-graph node: a stereo source feeds a node
    /// with a 2-channel input+output port (a per-lane copy), which feeds the master.
    /// Proves `mix_input_lane` hands the mid node TWO distinct input lanes (L != R)
    /// and the §4 adaptation carries them end to end. (The general lane-aware mix.)
    #[test]
    fn stereo_signal_flows_through_a_mid_graph_node() {
        use crate::compile::{CompiledProgram, NodeRouting, Source};

        /// Copies each input lane to the matching output lane.
        struct CopyNode;
        unsafe impl Send for CopyNode {}
        impl DspInstance for CopyNode {
            fn activate(&mut self, _sr: f32, _mb: usize) {}
            fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
                let n = ctx.inputs.len().min(ctx.outputs.len());
                let frames = ctx.nframes;
                for i in 0..n {
                    let len = frames.min(ctx.inputs[i].len()).min(ctx.outputs[i].len());
                    for f in 0..len {
                        ctx.outputs[i][f] = ctx.inputs[i][f];
                    }
                }
            }
            fn set_param(&mut self, _id: u16, _v: f32) {}
        }

        let instances: Vec<Box<dyn DspInstance>> = vec![
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }), // slot 0: stereo source (GraphIn — buffer left intact)
            Box::new(CopyNode), // slot 1: stereo-in/out copy (rendered)
            Box::new(ProbeNode {
                state: Rc::new(ProbeState::default()),
            }), // slot 2: SpeakerOut master
        ];
        let program = CompiledProgram {
            sample_rate: 48_000,
            instances,
            routing: vec![
                NodeRouting::default(),
                // copy node input port 0 fed by the source's port 0.
                NodeRouting {
                    inputs: vec![vec![Source { node: 0, port: 0 }]],
                },
                // master input port 0 fed by the copy node's port 0.
                NodeRouting {
                    inputs: vec![vec![Source { node: 1, port: 0 }]],
                },
            ],
            // Source: 2 lanes L=0.1/R=0.2. Copy: 2 output lanes. Master: none.
            out_bufs: vec![
                vec![vec![0.1f32; 4], vec![0.2f32; 4]],
                vec![vec![0.0f32; 4], vec![0.0f32; 4]],
                vec![],
            ],
            out_channels: vec![2, 2, 1],
            in_channels: vec![1, 2, 1], // the copy node takes a 2-channel input port
            bypassed: vec![false, false, false],
            kinds: vec![
                PrimitiveKind::GraphIn,
                PrimitiveKind::Gain,
                PrimitiveKind::SpeakerOut,
            ],
            ids: vec![NodeIdx(1), NodeIdx(2), NodeIdx(3)],
            id_index: vec![(NodeIdx(1), 0), (NodeIdx(2), 1), (NodeIdx(3), 2)],
            master_out: 2,
            block_size: 4,
            in_scratch: vec![vec![0.0; 4], vec![0.0; 4]], // 2 input lanes for the copy node
            max_in: 2,
            max_out: 2,
            schedule: vec![0, 1, 2],
        };
        let mut engine = Engine::new(program);

        let mut l = [0.0f32; 4];
        let mut r = [0.0f32; 4];
        {
            let mut outs: [&mut [f32]; 2] = [&mut l, &mut r];
            engine.process_block_into(&mut outs, 4);
        }
        // The stereo signal survived the trip through the mid node, lane-distinct.
        assert!(
            l.iter().all(|&x| (x - 0.1).abs() < 1e-6),
            "L carried through"
        );
        assert!(
            r.iter().all(|&x| (x - 0.2).abs() < 1e-6),
            "R carried through"
        );
    }
}
