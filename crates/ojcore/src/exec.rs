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

use alloc::collections::VecDeque;
use alloc::sync::Arc;
use alloc::vec;
use alloc::vec::Vec;

use ojproto::{
    sched_event_kind, sched_param, NodeIdx, PrimitiveKind, RtCommand, SchedEvent, TimedCommand,
};

use crate::compile::CompiledProgram;
use crate::dsp::ProcessCtx;
use crate::meter::MeterBank;
use crate::resilience::{sanitize, NodeBudget};
use crate::tempo::{MetricCursor, TempoMapRt};
use crate::timeline::TimelineRt;
use crate::transport::{Transport, TransportPos};

/// Hard cap on channels materialized on the stack per node, so the render step
/// allocates nothing. Real nodes are mono/stereo; this is comfortably above any
/// node's port count and extra channels degrade gracefully (are ignored).
const MAX_CH: usize = 32;
/// Maximum event/transport subdivisions performed in one caller block.
pub const MAX_SPLITS: usize = 32;
const TIMED_CAPACITY: usize = 1024;

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
    /// Current immutable authored timeline snapshot and engine-local cursor.
    timeline: Arc<TimelineRt>,
    #[cfg(feature = "std")]
    timeline_rx: Option<crate::swap::RtCellRx<TimelineRt>>,
    timeline_cursors: Vec<usize>,
    timeline_cursor_pos: u64,
    timeline_controls_ranges: bool,
    /// Live timestamped commands drained from the second host ring. Capacity is
    /// reserved at construction; the RT path never grows it.
    timed: VecDeque<TimedCommand>,
    last_timed_at: u64,
    /// Exactly the currently sounding MIDI notes for each program slot.
    held: Vec<u128>,
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
    /// Consecutive watchdog overruns, and the latched automatic bypass state.
    /// Sized off-RT and only mutated by the audio thread.
    watchdog_streak: Vec<u8>,
    auto_bypassed: Vec<bool>,
    auto_bypass_fade: Vec<usize>,
    auto_bypass_tail: Vec<f32>,
    /// U15: optional RT -> control return ring for `Meter` / `Beat` frames. The
    /// control thread holds the other handle and drains it. `None` => the engine
    /// computes meters but publishes nothing (host-side return path, std-only).
    #[cfg(feature = "std")]
    pub(crate) meter_ring: Option<alloc::sync::Arc<crate::meter::MeterRing>>,
    /// Optional RT -> control event ring for compact fault events. Separate from
    /// meters so a fault storm cannot evict level frames.
    #[cfg(feature = "std")]
    pub(crate) event_ring: Option<alloc::sync::Arc<crate::meter::EventRing>>,
    #[cfg(feature = "std")]
    capture_sink: Option<crate::capture::CaptureSink>,
    #[cfg(feature = "std")]
    capture_active: bool,
    #[cfg(feature = "std")]
    accumulated_capture_offset: u64,
    applying_timeline_event: bool,
    count_in_remaining: u64,
    count_in_cursor: u64,
    click_remaining: u8,
    click_accent: bool,
    click_gain: f32,
    #[cfg(test)]
    unsplit_fast_path_hits: usize,
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
            timeline: Arc::new(TimelineRt::empty(sample_rate)),
            #[cfg(feature = "std")]
            timeline_rx: None,
            timeline_cursors: vec![0; n],
            timeline_cursor_pos: 0,
            timeline_controls_ranges: false,
            timed: VecDeque::with_capacity(TIMED_CAPACITY),
            last_timed_at: 0,
            held: vec![0; n],
            metric_cursor: MetricCursor::default(),
            meters: MeterBank::with_nodes(n),
            budget: NodeBudget::with_nodes(n),
            #[cfg(feature = "std")]
            watchdog: None,
            watchdog_streak: vec![0; n],
            auto_bypassed: vec![false; n],
            auto_bypass_fade: vec![0; n],
            auto_bypass_tail: vec![0.0; n],
            #[cfg(feature = "std")]
            meter_ring: None,
            #[cfg(feature = "std")]
            event_ring: None,
            #[cfg(feature = "std")]
            capture_sink: None,
            #[cfg(feature = "std")]
            capture_active: false,
            #[cfg(feature = "std")]
            accumulated_capture_offset: 0,
            applying_timeline_event: false,
            count_in_remaining: 0,
            count_in_cursor: 0,
            click_remaining: 0,
            click_accent: false,
            click_gain: 0.2,
            #[cfg(test)]
            unsplit_fast_path_hits: 0,
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

    /// Listener-facing timeline clock (`engine_sample - preroll`).
    pub fn timeline_sample(&self) -> u64 {
        self.transport
            .sample_pos()
            .saturating_sub(u64::from(self.program.preroll))
    }

    /// Set the post-master metronome gain. Non-finite values become silence.
    pub fn set_click_gain(&mut self, gain: f32) {
        self.click_gain = if gain.is_finite() { gain.max(0.0) } else { 0.0 };
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

    /// Install a compiled timeline directly (offline and wasm hosts).
    pub fn install_timeline(&mut self, timeline: TimelineRt) {
        self.timeline = Arc::new(timeline);
        self.timeline_controls_ranges = true;
        self.sync_timeline_cursor();
    }

    /// Attach the native swap-whole timeline reader.
    #[cfg(feature = "std")]
    pub fn attach_timeline(&mut self, rx: Option<crate::swap::RtCellRx<TimelineRt>>) {
        self.timeline_controls_ranges = rx.is_some();
        self.timeline_rx = rx;
        self.sync_timeline_snapshot();
    }

    /// Queue one live timestamped command without allocating. Returns `false`
    /// when the fixed pending capacity is exhausted.
    pub fn enqueue_timed(&mut self, timed: TimedCommand) -> bool {
        if timed.at == 0 {
            self.apply_rt(timed.cmd);
            return true;
        }
        debug_assert!(self.timed.is_empty() || timed.at >= self.last_timed_at);
        if self.timed.len() >= TIMED_CAPACITY {
            return false;
        }
        self.last_timed_at = timed.at;
        self.timed.push_back(timed);
        true
    }

    fn sync_timeline_snapshot(&mut self) {
        #[cfg(feature = "std")]
        if let Some(rx) = self.timeline_rx.as_ref() {
            let next = rx.load_full();
            if !Arc::ptr_eq(&next, &self.timeline) {
                self.timeline = next;
                self.sync_timeline_cursor();
                return;
            }
        }
        if self.timeline_cursor_pos != self.transport.sample_pos() {
            self.sync_timeline_cursor();
        }
    }

    fn sync_timeline_cursor(&mut self) {
        let at = self.transport.sample_pos();
        for slot in 0..self.timeline_cursors.len() {
            let shift = u64::from(
                self.program
                    .preroll
                    .saturating_sub(self.program.to_master[slot]),
            );
            let timeline_at = at.saturating_sub(shift);
            self.timeline_cursors[slot] =
                self.timeline.seek_node(self.program.ids[slot], timeline_at);
        }
        self.timeline_cursor_pos = at;
        if self.timeline_controls_ranges {
            self.transport.set_ranges(
                self.timeline.loop_range().map(|(start, end)| {
                    (
                        start.saturating_add(u64::from(self.program.preroll)),
                        end.saturating_add(u64::from(self.program.preroll)),
                    )
                }),
                self.timeline.punch_range().map(|(start, end)| {
                    (
                        start.saturating_add(u64::from(self.program.preroll)),
                        end.saturating_add(u64::from(self.program.preroll)),
                    )
                }),
            );
        }
    }

    fn shifted_event_at(&self, slot: usize, event: &SchedEvent) -> u64 {
        event.at.saturating_add(u64::from(
            self.program
                .preroll
                .saturating_sub(self.program.to_master[slot]),
        ))
    }

    fn next_timeline_event(&self) -> Option<(usize, SchedEvent, u64)> {
        let mut next: Option<(usize, SchedEvent, u64)> = None;
        for slot in 0..self.program.len() {
            let events = self.timeline.node_events(self.program.ids[slot]);
            let Some(event) = events.get(self.timeline_cursors[slot]).copied() else {
                continue;
            };
            let at = self.shifted_event_at(slot, &event);
            if next.as_ref().is_none_or(|(_, prior, prior_at)| {
                (at, event.at, event.kind, event.node.0)
                    < (*prior_at, prior.at, prior.kind, prior.node.0)
            }) {
                next = Some((slot, event, at));
            }
        }
        next
    }

    /// Install loop and punch ranges from the current timeline document.
    pub fn set_transport_ranges(
        &mut self,
        loop_range: Option<(u64, u64)>,
        punch_range: Option<(u64, u64)>,
    ) {
        let shift = u64::from(self.program.preroll);
        self.transport.set_ranges(
            loop_range.map(|(start, end)| (start.saturating_add(shift), end.saturating_add(shift))),
            punch_range
                .map(|(start, end)| (start.saturating_add(shift), end.saturating_add(shift))),
        );
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
        self.transport
            .position_at(self.timeline_sample(), &map, &mut MetricCursor::default())
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

    /// Whether `node` is latched into watchdog bypass for this program.
    pub fn is_auto_bypassed(&self, node: ojproto::NodeIdx) -> bool {
        self.program
            .slot_of_id(node)
            .and_then(|slot| self.auto_bypassed.get(slot))
            .copied()
            .unwrap_or(false)
    }

    /// Off-RT diagnostic mask of notes currently owned by `node`.
    pub fn held_notes_mask(&self, node: ojproto::NodeIdx) -> u128 {
        self.program
            .slot_of_id(node)
            .and_then(|slot| self.held.get(slot))
            .copied()
            .unwrap_or(0)
    }

    /// Arm the hosted-plugin CPU watchdog (std-only). Each PluginHost node gets
    /// `budget_ns` per block; if `auto_bypass` is set, an over-budget node is
    /// flagged AND bypassed so a runaway node degrades to silence instead of
    /// xrunning the whole stream. Pass `None` to disarm.
    #[cfg(feature = "std")]
    pub fn set_watchdog(&mut self, watchdog: Option<crate::resilience::Watchdog>) {
        self.watchdog = watchdog;
        self.watchdog_streak.fill(0);
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

    /// Attach the generalized timeline/looper capture producer to the RT thread.
    #[cfg(feature = "std")]
    pub fn attach_capture_sink(&mut self, sink: Option<crate::capture::CaptureSink>) {
        self.capture_sink = sink;
        self.capture_active = false;
        self.accumulated_capture_offset = 0;
    }

    /// Stamp an input overrun into every armed track.
    #[cfg(feature = "std")]
    pub fn mark_capture_xrun(&mut self, dropped: u32) {
        let at = self.timeline_sample();
        if let Some(sink) = self.capture_sink.as_mut() {
            for arm in self.timeline.armed_tracks() {
                sink.mark(arm.node.0, ojproto::capture_mark_kind::XRUN, at, dropped);
            }
        }
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
        let pos = self
            .transport
            .position_at(self.timeline_sample(), map, &mut self.metric_cursor);
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
        if self.meter_ring.is_none() && self.event_ring.is_none() {
            return;
        }
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
                    if note < 128 {
                        self.held[slot] |= 1u128 << note;
                    }
                }
                #[cfg(feature = "std")]
                if !self.applying_timeline_event && self.capture_active {
                    let at = self.timeline_sample();
                    if let Some(sink) = self.capture_sink.as_mut() {
                        sink.mark(
                            node.0,
                            ojproto::capture_mark_kind::NOTE_ON,
                            at,
                            u32::from(note) | (u32::from(vel) << 8),
                        );
                    }
                }
            }
            RtCommand::NoteOff { node, note } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.instances[slot].note_off(note);
                    if note < 128 {
                        self.held[slot] &= !(1u128 << note);
                    }
                }
                #[cfg(feature = "std")]
                if !self.applying_timeline_event && self.capture_active {
                    let at = self.timeline_sample();
                    if let Some(sink) = self.capture_sink.as_mut() {
                        sink.mark(
                            node.0,
                            ojproto::capture_mark_kind::NOTE_OFF,
                            at,
                            u32::from(note),
                        );
                    }
                }
            }
            RtCommand::Bypass { node, on } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.bypassed[slot] = on;
                }
            }
            RtCommand::TransportPlay => {
                if self.transport.count_in_on() && self.timeline.count_in_beats() != 0 {
                    let map = self.tempo_snapshot();
                    let start = self.timeline_sample();
                    let start_tick = map.tick_at_sample(start);
                    let end_tick = start_tick.saturating_add(
                        u64::from(self.timeline.count_in_beats()) * u64::from(ojproto::PPQ),
                    );
                    let frames = map.sample_at_tick(end_tick).saturating_sub(start).max(1);
                    self.count_in_remaining = frames;
                    self.count_in_cursor = start.saturating_sub(frames);
                    self.transport.begin_count_in();
                } else {
                    self.transport.play();
                }
            }
            RtCommand::TransportPause => {
                #[cfg(feature = "std")]
                self.stop_capture_marks(self.transport.sample_pos());
                self.count_in_remaining = 0;
                self.release_held();
                self.transport.pause();
            }
            RtCommand::Seek { samples } => {
                self.count_in_remaining = 0;
                self.release_held();
                self.program.delay_bank.reset();
                self.transport
                    .locate(samples.saturating_add(u64::from(self.program.preroll)));
                self.sync_timeline_cursor();
            }
            RtCommand::TransportSet { flag, on } => {
                #[cfg(feature = "std")]
                if flag == ojproto::transport_flag::RECORD_ARM && !on {
                    self.stop_capture_marks(self.transport.sample_pos());
                }
                self.transport.set_flag(flag, on);
            }
            RtCommand::Looper { node, action, arg } => {
                if let Some(slot) = self.program.slot_of_id(node) {
                    self.program.instances[slot].looper_action(action, arg);
                }
            }
        }
    }

    /// Release exactly the notes recorded as sounding, bounded by
    /// `program.len() * 128` and allocation-free.
    fn release_held(&mut self) {
        for slot in 0..self.held.len() {
            let mut mask = self.held[slot];
            while mask != 0 {
                let note = mask.trailing_zeros() as u8;
                self.program.instances[slot].note_off(note);
                mask &= mask - 1;
            }
            self.held[slot] = 0;
        }
    }

    fn apply_sched_event(&mut self, event: SchedEvent) {
        self.applying_timeline_event = true;
        match event.kind {
            sched_event_kind::SET_PARAM => self.apply_rt(RtCommand::SetParam {
                node: event.node,
                param: u16::from_le_bytes([event.a, event.b]),
                value: event.value,
            }),
            sched_event_kind::NOTE_OFF => self.apply_rt(RtCommand::NoteOff {
                node: event.node,
                note: event.a,
            }),
            sched_event_kind::NOTE_ON => self.apply_rt(RtCommand::NoteOn {
                node: event.node,
                note: event.a,
                vel: event.b,
            }),
            sched_event_kind::SAMPLER_START => {
                let offset = ((event.value.max(0.0) as u64 & 0x00ff_ffff) << 16)
                    | u16::from_le_bytes([event.a, event.b]) as u64;
                if let Some(slot) = self.program.slot_of_id(event.node) {
                    self.program.instances[slot].set_param(
                        sched_param::SAMPLER_OFFSET_LOW,
                        (offset & 0x00ff_ffff) as f32,
                    );
                    self.program.instances[slot].set_param(
                        sched_param::SAMPLER_OFFSET_HIGH,
                        ((offset >> 24) & 0x00ff_ffff) as f32,
                    );
                    self.program.instances[slot].note_on(u8::MAX, 127);
                    self.held[slot] |= 1u128 << 127;
                }
            }
            _ => {}
        }
        self.applying_timeline_event = false;
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
        let timeline_sample = self.timeline_sample();
        let next_engine_sample = timeline_sample.saturating_add(u64::from(program.preroll));
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
        self.held.clear();
        self.held.resize(n, 0);
        self.watchdog_streak.clear();
        self.watchdog_streak.resize(n, 0);
        self.auto_bypassed.clear();
        self.auto_bypassed.resize(n, false);
        self.auto_bypass_fade.clear();
        self.auto_bypass_fade.resize(n, 0);
        self.auto_bypass_tail.clear();
        self.auto_bypass_tail.resize(n, 0.0);
        self.timeline_cursors.clear();
        self.timeline_cursors.resize(n, 0);
        let old = core::mem::replace(&mut self.program, program);
        self.transport.rebase_engine_sample(next_engine_sample);
        self.sync_timeline_cursor();
        old
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
        self.sync_timeline_snapshot();

        // A stopped graph with no live commands cannot reach an event or FSM
        // edge. Keep this common pre-DAW case to one render call: no tempo Arc
        // clone, split loop, capture gate, timeline scan, or transport advance.
        if self.transport.motion() == crate::transport::Motion::Stopped
            && self.timed.is_empty()
            && self.count_in_remaining == 0
            && !self.transport.click_on()
            && !self.meters.enabled
        {
            #[cfg(test)]
            {
                self.unsplit_fast_path_hits += 1;
            }
            self.render_audio_span(outs, 0, nframes);
            Self::clear_output_tail(outs, nframes);
            #[cfg(feature = "std")]
            self.publish_looper();
            #[cfg(feature = "std")]
            self.publish_faults();
            #[cfg(feature = "std")]
            self.capture_looper_blocks();
            return;
        }

        let map =
            (self.transport.click_on() || self.count_in_remaining != 0 || self.meters.enabled)
                .then(|| self.tempo_snapshot());

        let mut offset = 0;
        let mut splits = 0;
        while offset < nframes {
            let remaining = nframes - offset;
            let now = self.transport.sample_pos();

            // Apply every overdue/current event before rendering the sample at
            // `now`. Timeline events advance only with a rolling transport;
            // live timed commands share the same absolute playhead.
            let mut applied = false;
            if self.transport.is_playing() {
                while let Some((slot, event, at)) = self.next_timeline_event() {
                    if at > now {
                        break;
                    }
                    self.timeline_cursors[slot] += 1;
                    self.apply_sched_event(event);
                    applied = true;
                }
            }
            while self.timed.front().is_some_and(|event| event.at <= now) {
                if let Some(event) = self.timed.pop_front() {
                    self.apply_rt(event.cmd);
                    applied = true;
                }
            }
            if self.timed.is_empty() {
                self.last_timed_at = 0;
            }
            if self.transport.sample_pos() != now {
                self.sync_timeline_cursor();
                splits += 1;
                continue;
            }

            if splits >= MAX_SPLITS {
                self.render_audio_span(outs, offset, remaining);
                #[cfg(feature = "std")]
                self.capture_span(now, offset, remaining);
                self.apply_declick(outs, offset, remaining);
                self.transport.advance(remaining);
                break;
            }

            let mut edge = self.transport.frames_until_edge(remaining);
            if self.count_in_remaining != 0 {
                edge = edge.min(self.count_in_remaining as usize);
            }
            if self.transport.is_playing() {
                if let Some((_, _, at)) = self.next_timeline_event() {
                    edge = edge.min(at.saturating_sub(now) as usize);
                }
            }
            if let Some(event) = self.timed.front() {
                edge = edge.min(event.at.saturating_sub(now) as usize);
            }

            if edge == 0 {
                let before = self.transport.sample_pos();
                self.transport.finish_edge();
                if self.transport.sample_pos() != before {
                    self.sync_timeline_cursor();
                } else if !applied {
                    // Invalid/stale edge state must never spin the audio thread.
                    edge = remaining;
                } else {
                    splits += 1;
                    continue;
                }
            }

            self.render_audio_span(outs, offset, edge);
            #[cfg(feature = "std")]
            self.capture_span(now, offset, edge);
            if let Some(map) = map.as_deref() {
                self.mix_click(outs, offset, edge, map);
            }
            self.apply_declick(outs, offset, edge);
            self.transport.advance(edge);
            if self.count_in_remaining != 0 {
                let used = (edge as u64).min(self.count_in_remaining);
                self.count_in_remaining -= used;
                self.count_in_cursor = self.count_in_cursor.saturating_add(used);
                if self.count_in_remaining == 0 {
                    self.transport.finish_count_in();
                }
            }
            offset += edge;
            let before_edge = self.transport.sample_pos();
            self.transport.finish_edge();
            if self.transport.sample_pos() != before_edge {
                #[cfg(feature = "std")]
                self.mark_loop_wrap(before_edge);
                self.sync_timeline_cursor();
            } else {
                self.timeline_cursor_pos = self.transport.sample_pos();
            }
            splits += 1;
        }

        Self::clear_output_tail(outs, nframes);

        // Control-rate publishing happens once per caller block, from the same
        // position/map read for both Beat and Transport.
        #[cfg(feature = "std")]
        if self.meters.enabled {
            self.publish_levels(map.as_deref().expect("metering loads tempo snapshot"));
        }
        #[cfg(feature = "std")]
        self.publish_looper();
        #[cfg(feature = "std")]
        self.publish_faults();
        #[cfg(feature = "std")]
        self.capture_looper_blocks();
    }

    #[inline]
    fn clear_output_tail(outs: &mut [&mut [f32]], nframes: usize) {
        for out in outs.iter_mut() {
            for sample in out.iter_mut().skip(nframes) {
                *sample = 0.0;
            }
        }
    }

    fn mix_click(
        &mut self,
        outs: &mut [&mut [f32]],
        offset: usize,
        nframes: usize,
        map: &TempoMapRt,
    ) {
        if !self.transport.click_on() && self.count_in_remaining == 0 {
            return;
        }
        let base = if self.count_in_remaining != 0 {
            self.count_in_cursor
        } else {
            self.timeline_sample()
        };
        for frame in 0..nframes {
            let sample = base.saturating_add(frame as u64);
            let tick = map.tick_at_sample(sample);
            let prior = sample
                .checked_sub(1)
                .map_or(tick, |s| map.tick_at_sample(s));
            let beat = tick / u64::from(ojproto::PPQ);
            if sample == 0 || beat != prior / u64::from(ojproto::PPQ) {
                self.click_remaining = 24;
                self.click_accent = map
                    .meter_at_sample_with_cursor(sample, &mut MetricCursor::default())
                    .beat
                    == 1;
            }
            if self.click_remaining != 0 {
                let envelope = f32::from(self.click_remaining) / 24.0;
                let polarity = if self.click_remaining.is_multiple_of(2) {
                    1.0
                } else {
                    -1.0
                };
                let accent = if self.click_accent { 1.0 } else { 0.65 };
                let value = polarity * envelope * accent * self.click_gain;
                for out in outs.iter_mut() {
                    out[offset + frame] += value;
                }
                self.click_remaining -= 1;
            }
        }
    }

    #[cfg(feature = "std")]
    fn capture_looper_blocks(&mut self) {
        let Some(sink) = self.capture_sink.as_mut() else {
            return;
        };
        for slot in 0..self.program.instances.len() {
            if self.program.kinds[slot] == PrimitiveKind::Looper {
                if let Some(block) = self.program.instances[slot].last_captured_block() {
                    sink.capture(self.program.ids[slot].0, block);
                }
            }
        }
    }

    #[cfg(feature = "std")]
    fn capture_span(&mut self, at: u64, output_offset: usize, nframes: usize) {
        if nframes == 0 || !self.transport.is_playing() || !self.transport.record_armed() {
            return;
        }
        let span_end = at.saturating_add(nframes as u64);
        let (capture_start, capture_end) = if self.transport.punch_on() {
            let Some((punch_start, punch_end)) = self.transport.punch_range() else {
                self.accumulated_capture_offset = self
                    .accumulated_capture_offset
                    .saturating_add(nframes as u64);
                return;
            };
            (at.max(punch_start), span_end.min(punch_end))
        } else {
            (at, span_end)
        };
        if capture_start >= capture_end {
            self.accumulated_capture_offset = self
                .accumulated_capture_offset
                .saturating_add(nframes as u64);
            return;
        }

        let local = (capture_start - at) as usize;
        let len = (capture_end - capture_start) as usize;
        let first = !self.capture_active;
        self.capture_active = true;
        let Some(sink) = self.capture_sink.as_mut() else {
            return;
        };
        for arm in self.timeline.armed_tracks() {
            let Some(slot) = self.program.slot_of_id(arm.node) else {
                continue;
            };
            if first {
                let kind = if self.transport.punch_on() {
                    ojproto::capture_mark_kind::PUNCH_IN
                } else {
                    ojproto::capture_mark_kind::RECORD_START
                };
                sink.mark(
                    arm.node.0,
                    kind,
                    capture_timeline_frame(capture_start, self.program.preroll),
                    u32::from(arm.align),
                );
            }
            let source_offset = if matches!(
                self.program.kinds[slot],
                PrimitiveKind::GraphIn | PrimitiveKind::MicIn
            ) {
                output_offset + local
            } else {
                local
            };
            if let Some(buf) = self.program.out_bufs[slot].first() {
                let end = source_offset.saturating_add(len).min(buf.len());
                if source_offset < end {
                    sink.capture(arm.node.0, &buf[source_offset..end]);
                }
            }
        }
        if self.transport.punch_on()
            && self
                .transport
                .punch_range()
                .is_some_and(|(_, end)| capture_end == end)
        {
            self.stop_capture_marks(capture_end);
        }
    }

    #[cfg(feature = "std")]
    fn stop_capture_marks(&mut self, at: u64) {
        if !self.capture_active {
            return;
        }
        let at = capture_timeline_frame(at, self.program.preroll);
        if let Some(sink) = self.capture_sink.as_mut() {
            for arm in self.timeline.armed_tracks() {
                let kind = if self.transport.punch_on() {
                    ojproto::capture_mark_kind::PUNCH_OUT
                } else {
                    ojproto::capture_mark_kind::RECORD_STOP
                };
                sink.mark(arm.node.0, kind, at, 0);
            }
        }
        self.capture_active = false;
    }

    #[cfg(feature = "std")]
    fn mark_loop_wrap(&mut self, at: u64) {
        if !self.capture_active {
            return;
        }
        if let Some((start, end)) = self.transport.loop_range() {
            self.accumulated_capture_offset = self
                .accumulated_capture_offset
                .saturating_add(end.saturating_sub(start));
        }
        let at = capture_timeline_frame(at, self.program.preroll);
        if let Some(sink) = self.capture_sink.as_mut() {
            for arm in self.timeline.armed_tracks() {
                sink.mark(
                    arm.node.0,
                    ojproto::capture_mark_kind::LOOP_WRAP,
                    at,
                    self.accumulated_capture_offset.min(u64::from(u32::MAX)) as u32,
                );
            }
        }
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
                PrimitiveKind::GraphIn | PrimitiveKind::MicIn => {
                    self.advance_node_delays(node, output_offset, nframes);
                    continue;
                }
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
                self.advance_node_delays(node, 0, nframes);
                continue;
            }

            if self.auto_bypassed[node] {
                self.render_auto_bypass(node, output_offset, nframes);
                self.meter_node(node, nframes);
                self.advance_node_delays(node, 0, nframes);
                continue;
            }

            // Foreign-plugin resilience is confined to PluginHost nodes.
            // Built-ins take the direct call below: no watchdog clock read,
            // runtime-fault query, or output scan.
            if self.program.kinds[node] == PrimitiveKind::PluginHost {
                #[cfg(feature = "std")]
                let timed = if let Some(w) = self.watchdog.as_mut() {
                    w.start();
                    true
                } else {
                    false
                };

                self.render_node(node, output_offset, nframes);

                #[cfg(feature = "std")]
                if let Some(fault) = self.program.instances[node].runtime_fault() {
                    if fault == ojproto::FaultKind::NonFinite {
                        self.budget.non_finite[node] = true;
                    }
                    self.emit_node_fault(node, fault);
                }

                #[cfg(feature = "std")]
                if timed {
                    let over = self.watchdog.as_mut().map(|w| w.check()).unwrap_or(false);
                    if over {
                        self.budget.over_budget[node] = true;
                        self.emit_node_fault(node, ojproto::FaultKind::OverBudget);
                        self.watchdog_streak[node] = self.watchdog_streak[node].saturating_add(1);
                        let should_bypass = self.watchdog.is_some_and(|w| {
                            w.auto_bypass && self.watchdog_streak[node] >= w.consecutive_limit
                        });
                        if should_bypass {
                            self.auto_bypassed[node] = true;
                            self.auto_bypass_fade[node] =
                                ((self.transport.sample_rate() * 0.012 + 0.5) as usize).max(1);
                            self.release_held_node(node);
                            self.emit_node_fault(node, ojproto::FaultKind::AutoBypassed);
                            self.crossfade_to_bypass(node, output_offset, nframes);
                        }
                    } else {
                        self.watchdog_streak[node] = 0;
                    }
                }

                // The ojhost bridge already guards foreign output. This final
                // hosted-only boundary also covers scaffold/test host nodes.
                self.sanitize_node(node, nframes);
            } else {
                self.render_node(node, output_offset, nframes);
            }
            // U15 metering: fold the node's output into its per-node meter.
            self.meter_node(node, nframes);
            self.advance_node_delays(node, 0, nframes);
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
                    let delay = self.program.delay_routing[master][0][k];
                    let src_oc = self.program.out_channels[src.node].max(1) as usize;
                    let lane = src.port as usize * src_oc + ch.min(src_oc - 1);
                    let delayed = delay
                        .and_then(|edge| self.program.delay_bank.output(edge, ch.min(src_oc - 1)));
                    if let Some(src_buf) = delayed
                        .or_else(|| self.program.out_bufs[src.node].get(lane).map(Vec::as_slice))
                    {
                        let source_offset = if matches!(
                            self.program.kinds[src.node],
                            PrimitiveKind::GraphIn | PrimitiveKind::MicIn
                        ) && delay.is_none()
                        {
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

    fn advance_node_delays(&mut self, node: usize, source_offset: usize, nframes: usize) {
        let program = &mut self.program;
        program.delay_bank.advance_from(
            node,
            source_offset,
            nframes,
            &program.out_bufs,
            &program.out_channels,
        );
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
        for (source_index, src) in prog.routing[node].inputs[port].iter().enumerate() {
            let delay = prog.delay_routing[node][port][source_index];
            let src_oc = prog.out_channels[src.node].max(1) as usize;
            let src_lane = src.port as usize * src_oc + channel.min(src_oc - 1);
            let delayed =
                delay.and_then(|edge| prog.delay_bank.output(edge, channel.min(src_oc - 1)));
            if let Some(src_buf) =
                delayed.or_else(|| prog.out_bufs[src.node].get(src_lane).map(Vec::as_slice))
            {
                let offset = if matches!(
                    prog.kinds[src.node],
                    PrimitiveKind::GraphIn | PrimitiveKind::MicIn
                ) && delay.is_none()
                {
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

    /// Fade the just-rendered wet output into the same dry path steady bypass
    /// uses. The fade may span blocks; no allocation or graph mutation occurs.
    #[cfg(feature = "std")]
    fn crossfade_to_bypass(&mut self, node: usize, source_offset: usize, nframes: usize) {
        if self.program.out_bufs[node].is_empty() {
            return;
        }
        let total = ((self.transport.sample_rate() * 0.012 + 0.5) as usize).max(1);
        let remaining = self.auto_bypass_fade[node];
        let done = total.saturating_sub(remaining);
        if !self.program.routing[node].inputs.is_empty() {
            self.mix_input(node, 0, source_offset, nframes);
        } else {
            self.program.in_scratch[0][..nframes].fill(0.0);
        }
        let dry = &self.program.in_scratch[0][..nframes];
        let wet = &mut self.program.out_bufs[node][0][..nframes];
        self.auto_bypass_tail[node] = wet.last().copied().unwrap_or(0.0);
        for (frame, (out, &input)) in wet.iter_mut().zip(dry).enumerate() {
            let t = ((done + frame).min(total) as f32) / total as f32;
            *out = *out * (1.0 - t) + input * t;
        }
        self.auto_bypass_fade[node] = remaining.saturating_sub(nframes);
    }

    /// Continue the 12 ms release after the faulting block without re-entering
    /// foreign code. The last trustworthy wet sample supplies a bounded tail;
    /// the dry continuity path rises over the same envelope.
    fn render_auto_bypass(&mut self, node: usize, source_offset: usize, nframes: usize) {
        self.passthrough(node, source_offset, nframes);
        let remaining = self.auto_bypass_fade[node];
        if remaining == 0 || self.program.out_bufs[node].is_empty() {
            return;
        }
        let total = ((self.transport.sample_rate() * 0.012 + 0.5) as usize).max(1);
        let done = total.saturating_sub(remaining);
        let tail = self.auto_bypass_tail[node];
        for (frame, out) in self.program.out_bufs[node][0][..nframes]
            .iter_mut()
            .enumerate()
        {
            let t = ((done + frame).min(total) as f32) / total as f32;
            *out = tail * (1.0 - t) + *out * t;
        }
        self.auto_bypass_fade[node] = remaining.saturating_sub(nframes);
    }

    /// Release only notes owned by one failed node. Note-off is deliberate:
    /// choke would truncate the instrument's own release stage.
    #[cfg(feature = "std")]
    fn release_held_node(&mut self, slot: usize) {
        let mut mask = self.held[slot];
        while mask != 0 {
            let note = mask.trailing_zeros() as u8;
            self.program.instances[slot].note_off(note);
            mask &= mask - 1;
        }
        self.held[slot] = 0;
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

/// Contiguous captured-frame formula used for audio/MIDI loop passes.
pub fn accumulated_capture_frame(
    start: u64,
    loop_offset: u64,
    accumulated_capture_offset: u64,
    event_frame: u64,
) -> u64 {
    start
        .saturating_add(loop_offset)
        .saturating_add(event_frame)
        .saturating_sub(accumulated_capture_offset)
}

/// Place captured material on the listener-facing timeline (D9): capture marks
/// are generated on the engine clock, which runs `preroll` samples ahead.
pub const fn capture_timeline_frame(engine_sample: u64, preroll: u32) -> u64 {
    engine_sample.saturating_sub(preroll as u64)
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
    use core::cell::{Cell, RefCell};
    use ojproto::{looper_action, NodeIdx, PrimitiveKind, RtCommand, SchedEvent, Timeline};
    use proptest::prelude::*;

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
        note_on_count: Cell<u32>,
        value: Cell<f32>,
        spans: RefCell<Vec<usize>>,
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
        fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
            self.state.spans.borrow_mut().push(ctx.nframes);
            for out in ctx.outputs.iter_mut() {
                out[..ctx.nframes].fill(self.state.value.get());
            }
        }
        fn set_param(&mut self, id: u16, value: f32) {
            self.state.last_set_param.set(Some((id, value)));
            self.state.value.set(value);
        }
        fn note_on(&mut self, note: u8, vel: u8) {
            self.state.last_note_on.set(Some((note, vel)));
            self.state
                .note_on_count
                .set(self.state.note_on_count.get() + 1);
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
        probe_engine_with_block(4)
    }

    fn probe_engine_with_block(block: usize) -> (Engine, Rc<ProbeState>) {
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
            routing: vec![
                NodeRouting::default(),
                NodeRouting {
                    inputs: vec![vec![crate::compile::Source { node: 0, port: 0 }]],
                },
            ],
            out_bufs: vec![vec![vec![0.0; block]], vec![]],
            out_channels: vec![1, 1],
            in_channels: vec![1, 1],
            bypassed: vec![false, false],
            kinds: vec![PrimitiveKind::Osc, PrimitiveKind::SpeakerOut],
            ids,
            id_index,
            master_out: 1,
            block_size: block,
            in_scratch: vec![vec![0.0; block]],
            max_in: 1,
            max_out: 1,
            schedule: vec![0, 1],
            latency: vec![0, 0].into_boxed_slice(),
            arrival: vec![0, 0].into_boxed_slice(),
            to_master: vec![0, 0].into_boxed_slice(),
            edge_delay: vec![0].into_boxed_slice(),
            preroll: 0,
            delay_bank: crate::compile::DelayBank::with_nodes(2),
            delay_routing: vec![vec![], vec![vec![None]]],
        };
        (Engine::new(program), state)
    }

    fn timeline(events: Vec<SchedEvent>, loop_range: Option<(u64, u64)>) -> TimelineRt {
        let wire = Timeline {
            sample_rate: 48_000,
            events,
            loop_range,
            punch_range: None,
            armed_tracks: vec![],
            count_in_beats: 0,
            end: 64,
        };
        TimelineRt::from_wire(&wire, &TempoMapRt::one_point(48_000, 120.0, 4, 4))
    }

    #[test]
    fn plain_stopped_graph_takes_unsplit_fast_path() {
        let (mut engine, probe) = probe_engine_with_block(8);
        engine.process_block(&mut [0.0; 8], 8);
        assert_eq!(engine.unsplit_fast_path_hits, 1);
        assert_eq!(&*probe.spans.borrow(), &[8], "exactly one DSP span");

        // Metering needs the tempo publication path and must leave the guarded
        // fast-path counter unchanged.
        engine.set_metering(true);
        engine.process_block(&mut [0.0; 8], 8);
        assert_eq!(engine.unsplit_fast_path_hits, 1);
    }

    #[test]
    fn timeline_event_splits_at_exact_frame() {
        let (mut engine, probe) = probe_engine();
        engine.install_timeline(timeline(
            vec![SchedEvent {
                at: 2,
                node: NodeIdx(7),
                kind: sched_event_kind::NOTE_ON,
                a: 64,
                b: 100,
                value: 0.0,
            }],
            None,
        ));
        engine.apply_rt(RtCommand::TransportPlay);
        engine.process_block(&mut [0.0; 4], 4);
        assert_eq!(&*probe.spans.borrow(), &[2, 2]);
        assert_eq!(probe.note_on_count.get(), 1);
    }

    #[test]
    fn timed_command_applies_at_exact_frame() {
        let (mut engine, probe) = probe_engine();
        let (mut tx, mut rx) = crate::TimedCommandQueue::split(4);
        tx.push(TimedCommand {
            at: 3,
            cmd: RtCommand::NoteOn {
                node: NodeIdx(7),
                note: 61,
                vel: 90,
            },
        })
        .expect("timed ring has capacity");
        engine.drain_timed(&mut rx);
        engine.apply_rt(RtCommand::TransportPlay);
        engine.process_block(&mut [0.0; 4], 4);
        assert_eq!(&*probe.spans.borrow(), &[3, 1]);
        assert_eq!(probe.last_note_on.get(), Some((61, 90)));
    }

    #[test]
    fn scheduled_event_uses_node_pdc_shift_but_live_note_is_immediate() {
        let (mut engine, probe) = probe_engine_with_block(8);
        engine.program_mut().preroll = 8;
        engine.program_mut().to_master[0] = 3;
        engine.install_timeline(timeline(
            vec![SchedEvent {
                at: 2,
                node: NodeIdx(7),
                kind: sched_event_kind::NOTE_ON,
                a: 64,
                b: 100,
                value: 0.0,
            }],
            None,
        ));

        // Live input bypasses the timeline scheduler entirely: delivery happens
        // synchronously, even though this program has eight samples of preroll.
        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(7),
            note: 60,
            vel: 90,
        });
        assert_eq!(probe.note_on_count.get(), 1, "live note is never shifted");

        engine.apply_rt(RtCommand::TransportPlay);
        engine.process_block(&mut [0.0; 8], 8);
        assert_eq!(&*probe.spans.borrow(), &[7, 1]);
        assert_eq!(probe.note_on_count.get(), 2, "T=2 dispatches at E=2+8-3=7");
        assert_eq!(
            engine.sample_pos(),
            8,
            "internal engine clock includes preroll"
        );
        assert_eq!(
            engine.transport_pos().sample,
            0,
            "reported clock is E-preroll"
        );
    }

    #[test]
    fn loop_wrap_repeats_loop_start_event() {
        let (mut engine, probe) = probe_engine();
        engine.install_timeline(timeline(
            vec![SchedEvent {
                at: 1,
                node: NodeIdx(7),
                kind: sched_event_kind::NOTE_ON,
                a: 60,
                b: 100,
                value: 0.0,
            }],
            Some((1, 3)),
        ));
        engine.apply_rt(RtCommand::TransportSet {
            flag: ojproto::transport_flag::LOOP_ENABLE,
            on: true,
        });
        engine.apply_rt(RtCommand::TransportPlay);
        engine.process_block(&mut [0.0; 4], 4);
        assert_eq!(probe.note_on_count.get(), 2);
        assert_eq!(engine.sample_pos(), 2);
    }

    #[test]
    fn stop_and_locate_release_only_held_notes() {
        let (mut engine, probe) = probe_engine();
        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(7),
            note: 60,
            vel: 100,
        });
        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(7),
            note: 64,
            vel: 100,
        });
        engine.apply_rt(RtCommand::NoteOff {
            node: NodeIdx(7),
            note: 60,
        });
        assert_eq!(engine.held[0], 1u128 << 64);
        engine.apply_rt(RtCommand::TransportPause);
        assert_eq!(probe.last_note_off.get(), Some(64));
        assert_eq!(engine.held[0], 0);

        engine.apply_rt(RtCommand::NoteOn {
            node: NodeIdx(7),
            note: 67,
            vel: 100,
        });
        engine.apply_rt(RtCommand::Seek { samples: 12 });
        assert_eq!(probe.last_note_off.get(), Some(67));
        assert_eq!(engine.held[0], 0);
    }

    proptest! {
        /// Named W3 gate: one timeline-driven block is bit-identical to the same
        /// state changes rendered as explicit spans at every event boundary.
        #[test]
        fn split_determinism(
            raw in prop::collection::vec((0u8..64, -0.5f32..0.5), 0..20)
        ) {
            let mut changes = raw;
            changes.sort_by_key(|(at, _)| *at);
            changes.dedup_by_key(|(at, _)| *at);

            let (mut scheduled, _) = probe_engine_with_block(64);
            let events = changes.iter().map(|&(at, value)| SchedEvent {
                at: at as u64,
                node: NodeIdx(7),
                kind: sched_event_kind::SET_PARAM,
                a: 0,
                b: 0,
                value,
            }).collect();
            scheduled.install_timeline(timeline(events, None));
            scheduled.apply_rt(RtCommand::TransportPlay);
            let mut whole = [0.0f32; 64];
            scheduled.process_block(&mut whole, 64);

            let (mut explicit, _) = probe_engine_with_block(64);
            let mut split = [0.0f32; 64];
            let mut cursor = 0usize;
            for &(at, value) in &changes {
                let at = at as usize;
                if at > cursor {
                    explicit.process_block(&mut split[cursor..at], at - cursor);
                }
                explicit.apply_rt(RtCommand::SetParam { node: NodeIdx(7), param: 0, value });
                cursor = at;
            }
            if cursor < 64 {
                explicit.process_block(&mut split[cursor..], 64 - cursor);
            }
            prop_assert_eq!(whole, split);
        }
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
            latency: vec![0, 0].into_boxed_slice(),
            arrival: vec![0, 0].into_boxed_slice(),
            to_master: vec![0, 0].into_boxed_slice(),
            edge_delay: Box::new([]),
            preroll: 0,
            delay_bank: crate::compile::DelayBank::with_nodes(2),
            delay_routing: vec![vec![], vec![]],
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
            latency: vec![0, 0].into_boxed_slice(),
            arrival: vec![0, 0].into_boxed_slice(),
            to_master: vec![0, 0].into_boxed_slice(),
            edge_delay: vec![0].into_boxed_slice(),
            preroll: 0,
            delay_bank: crate::compile::DelayBank::with_nodes(2),
            delay_routing: vec![vec![], vec![vec![None]]],
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
            latency: vec![0, 0].into_boxed_slice(),
            arrival: vec![0, 0].into_boxed_slice(),
            to_master: vec![0, 0].into_boxed_slice(),
            edge_delay: vec![0].into_boxed_slice(),
            preroll: 0,
            delay_bank: crate::compile::DelayBank::with_nodes(2),
            delay_routing: vec![vec![], vec![vec![None]]],
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
            latency: vec![0, 0].into_boxed_slice(),
            arrival: vec![0, 0].into_boxed_slice(),
            to_master: vec![0, 0].into_boxed_slice(),
            edge_delay: vec![0].into_boxed_slice(),
            preroll: 0,
            delay_bank: crate::compile::DelayBank::with_nodes(2),
            delay_routing: vec![vec![], vec![vec![None]]],
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
            latency: vec![0, 0, 0].into_boxed_slice(),
            arrival: vec![0, 0, 0].into_boxed_slice(),
            to_master: vec![0, 0, 0].into_boxed_slice(),
            edge_delay: vec![0, 0].into_boxed_slice(),
            preroll: 0,
            delay_bank: crate::compile::DelayBank::with_nodes(3),
            delay_routing: vec![vec![], vec![vec![None]], vec![vec![None]]],
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
