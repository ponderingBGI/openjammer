//! The built-in LOOPER (U-STATEFUL): an audio thru-node that records its input
//! into pre-allocated loop buffers, plays them back ADDED on top of the live
//! monitor, and supports independent MULTI-TRACK layering (overdubbing as
//! separate, phase-locked captured tracks rather than summing in place).
//!
//! Like every other node it is "just a plugin": a [`PluginManifest`] (lowering
//! its open `builtin.looper` id to the closed [`PrimitiveKind::Looper`]), a
//! [`PluginLoader`] factory, and a [`DspInstance`] whose `process` is
//! **allocation-free** — every loop buffer is sized once in
//! [`DspInstance::activate`] (to [`MAX_LOOP_SECS`] at the activation sample
//! rate) and never reallocated on the RT path.
//!
//! # The multi-layer model (owner-locked)
//! Each recording pass captures an *independent* layer. The FIRST take sets the
//! loop length; every later take is phase-locked to that length (shared
//! shared playhead and loop length).
//! Layers can be muted or deleted individually, and the most recent layer can be
//! undone. The loop is ADDED on top of the live monitor (dry) with a controllable
//! wet level.
//!
//! # The no-duplication rule (the loudness fix)
//! The buffer currently being recorded is NEVER read back into the output while
//! it is being captured. The output is always
//! `x*dry + (sum of committed, unmuted layers)*wet`. This is what makes a freshly
//! recorded layer not "double" the live input — the user's "way louder" bug.
//!
//! # RT-safety: all allocation is in `activate`
//! [`activate`](DspInstance::activate) pre-allocates `MAX_LAYERS + 1` buffers of
//! `MAX_LOOP_SECS * sample_rate` frames: one becomes the active `recording` take
//! buffer and the rest sit in a free `pool`. Committing a take is an O(1) pointer
//! move (`core::mem::take` + `pool.pop`), never a copy or an allocation. Deleting
//! a layer is an O(n<=MAX_LAYERS) `Vec::remove` shift — bounded and alloc-free.
//!
//! Pre-allocated memory: `(MAX_LAYERS + 1) * MAX_LOOP_SECS * sample_rate * 4`
//! bytes. At 8 layers, 60 s, 48 kHz that is `9 * 60 * 48000 * 4 ≈ 103.7 MB`.
//!
//! # State machine
//! ```text
//!   Idle ──record──▶ Recording ──stop/wrap──▶ Playing
//!     ▲                                          │  ▲
//!     └──────────────── clear ◀──────────────────┘  │
//!                                       record ──────┘  (new layer)
//! ```
//! Transitions are driven by [`ojproto::RtCommand::Looper`] actions, decoded
//! into [`LooperNode::action`] (one of the [`ojproto::looper_action`] consts).
//!
//! # Loop-boundary quantization (v1)
//! The first take's length is settable via [`looper_param::LOOP_SECS`] (seconds);
//! when `<= 0` the looper free-runs and the first take's length is captured
//! between record-start and STOP. There is NO global tempo — first-loop-sets-the
//! -length. Every later take inherits that `loop_len` (phase-lock).

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use ojproto::{looper_action, PrimitiveKind};

use crate::dsp::{DspInstance, ProcessCtx};
use crate::loader::PluginLoader;
use crate::manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};

/// Stable manifest id for the built-in looper.
pub const LOOPER_ID: &str = "builtin.looper";

/// Maximum loop length the buffers are pre-sized for, in seconds. 60 s at the
/// activation sample rate; the buffers are allocated once in `activate` and never
/// grow on the RT path.
pub const MAX_LOOP_SECS: f32 = 60.0;

/// Maximum number of independent, simultaneously-playing layers. Bounds the
/// pre-allocated buffer pool (`MAX_LAYERS + 1` buffers) so the RT path never
/// allocates. Eight layers is plenty for live looping and keeps the pre-allocated
/// footprint (see module docs) reasonable.
pub const MAX_LAYERS: usize = 8;

/// Looper parameter ids (the one `(NodeIdx, id)` addressing scheme).
pub mod looper_param {
    /// Quantized loop length in seconds, applied to the FIRST take. `<= 0` means
    /// free-run (the first take's length is whatever was captured between
    /// record-start and STOP). Clamped to [`super::MAX_LOOP_SECS`].
    pub const LOOP_SECS: u16 = 0;
    /// Wet (loop playback) level mixed on top of the live monitor, linear `0..1`.
    pub const WET: u16 = 1;
    /// Dry (live input / monitor) level, linear `0..1`.
    pub const DRY: u16 = 2;
}

/// The looper's transport state. Driven by [`ojproto::looper_action`] commands.
/// The discriminant order MUST mirror `ojproto::looper_state` (IDLE=0, ARMED=1,
/// RECORDING=2, PLAYING=3, OVERDUBBING=4) so [`LooperState::as_u8`] is a plain
/// cast. `Overdubbing` is retained for protocol parity but the multi-layer model
/// treats every record pass identically (each is a new layer); the kernel maps
/// the `OVERDUB` action onto a new `Recording` take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LooperState {
    /// No layers captured; pure passthrough of the dry input.
    Idle = 0,
    /// Armed: the next record will start a fresh take. (Retained for parity.)
    Armed = 1,
    /// Capturing the input into the active `recording` take buffer.
    Recording = 2,
    /// Playing the committed layers back, added on top of the dry monitor.
    Playing = 3,
    /// Recording a new layer while existing layers play (multi-track overdub).
    Overdubbing = 4,
}

impl LooperState {
    /// The protocol `u8` for this state (mirrors `ojproto::looper_state`).
    #[inline]
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

fn looper_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(LOOPER_ID),
        name: String::from("Looper"),
        kind: PrimitiveKind::Looper,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: looper_param::LOOP_SECS,
                name: String::from("loop_secs"),
                min: 0.0,
                max: MAX_LOOP_SECS,
                default: 0.0,
            },
            ParamDecl {
                id: looper_param::WET,
                name: String::from("wet"),
                min: 0.0,
                max: 1.0,
                // Loop layers ride on top of the live monitor; ~unity but kept
                // controllable. The master soft-limiter is the real ceiling.
                default: 0.9,
            },
            ParamDecl {
                id: looper_param::DRY,
                name: String::from("dry"),
                min: 0.0,
                max: 1.0,
                default: 1.0,
            },
        ],
        ports: PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 1,
            audio_out_channels: 1,
        },
    }
}

/// Loader/factory for [`LooperNode`].
pub struct LooperLoader {
    manifest: PluginManifest,
}

impl Default for LooperLoader {
    fn default() -> Self {
        Self {
            manifest: looper_manifest(),
        }
    }
}

impl LooperLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for LooperLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, max_block: usize) -> Box<dyn DspInstance> {
        let mut node = LooperNode::new();
        // Size the buffer pool up front so the first `process` (even before an
        // explicit `activate`) is allocation-free.
        node.activate(sample_rate, max_block);
        Box::new(node)
    }
}

/// A single committed loop layer: a fully-captured mono buffer plus a per-layer
/// mute flag. The buffer is `loop_len` valid frames (it was overwritten across a
/// full cycle of the active take), backed by a pre-allocated `MAX_LOOP_SECS`
/// allocation drawn from the pool.
pub struct Layer {
    /// Captured mono samples. `[0, loop_len)` are valid loop content.
    buf: Vec<f32>,
    /// When `true` this layer is excluded from the output mix (but kept, so it
    /// can be unmuted) — distinct from a delete, which returns the buffer.
    muted: bool,
}

/// A multi-track loop recorder/player. All buffers are pre-allocated once in
/// [`activate`] to [`MAX_LOOP_SECS`] frames; `process` only reads/writes inside
/// them and commit is an O(1) pointer move, so the hot path never allocates.
///
/// [`activate`]: DspInstance::activate
pub struct LooperNode {
    /// Committed, simultaneously-playing layers (capacity pre-reserved to
    /// [`MAX_LAYERS`] so `push` never reallocates).
    layers: Vec<Layer>,
    /// The active take buffer being recorded into. Pre-allocated to capacity; on
    /// commit it is `mem::take`n into a [`Layer`] and replaced from the `pool`.
    recording: Vec<f32>,
    /// Free pre-allocated buffers available to back the next take / returned by
    /// CLEAR / UNDO / delete. Never grows on the RT path.
    pool: Vec<Vec<f32>>,
    /// Active sample rate, set in `activate`.
    sample_rate: f32,
    /// Current transport state.
    state: LooperState,
    /// Shared read/write playhead within `[0, loop_len)` (phase-lock).
    pos: usize,
    /// Shared loop length in frames for ALL layers. `0` until the first take
    /// sets it (first-loop-sets-the-length).
    loop_len: usize,
    /// Quantized first-take length param, in seconds (`<= 0` = free-run).
    loop_secs: f32,
    /// Loop playback level (wet).
    wet: f32,
    /// Live input level (dry / monitor).
    dry: f32,
    /// Peak absolute output sample seen in the most recent processed block, for
    /// telemetry. Reset at the start of each `process`.
    last_block_peak: f32,
    /// A just-occurred state transition `(from, to)` (as protocol `u8`s), waiting
    /// to be drained onto the loss-proof event ring. Set by `process`/`action`.
    pending_edge: Option<(u8, u8)>,
    /// The write head (`pos`) at the START of the current `process` block, so
    /// [`last_captured_block`](Self::last_captured_block) can hand the native
    /// capture ring exactly the samples written this block. Reset each `process`
    /// call (and to `0` on a wrap-commit, where the captured tail is `None`).
    block_capture_start: usize,
}

impl Default for LooperNode {
    fn default() -> Self {
        Self::new()
    }
}

impl LooperNode {
    pub fn new() -> Self {
        Self {
            layers: Vec::new(),
            recording: Vec::new(),
            pool: Vec::new(),
            sample_rate: 48_000.0,
            state: LooperState::Idle,
            pos: 0,
            loop_len: 0,
            loop_secs: 0.0,
            wet: 0.9,
            dry: 1.0,
            last_block_peak: 0.0,
            pending_edge: None,
            block_capture_start: 0,
        }
    }

    /// Current transport state (for tests / introspection).
    #[inline]
    pub fn state(&self) -> LooperState {
        self.state
    }

    /// Length of the captured loop, in frames (`0` if none).
    #[inline]
    pub fn loop_len(&self) -> usize {
        self.loop_len
    }

    /// Number of committed layers (muted or not).
    #[inline]
    pub fn layer_count(&self) -> usize {
        self.layers.len()
    }

    /// Whether layer `idx` is muted (`false` if out of range).
    #[inline]
    pub fn layer_muted(&self, idx: usize) -> bool {
        self.layers.get(idx).map(|l| l.muted).unwrap_or(false)
    }

    /// Maximum loop length the buffers are sized for, in frames.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.recording.len()
    }

    /// Telemetry snapshot for the engine→UI return path:
    /// `(state_u8, pos, loop_len, last_block_peak)`. RT-safe: plain field reads.
    /// The matching trait override is wired by the protocol-agent stage.
    #[inline]
    pub fn looper_snapshot(&self) -> (u8, u32, u32, f32) {
        (
            self.state.as_u8(),
            self.pos as u32,
            self.loop_len as u32,
            self.last_block_peak,
        )
    }

    /// Drain a pending state-transition edge `(from_u8, to_u8)`, if any. The
    /// executor pushes this onto the loss-proof EVENT ring (not the lossy meter
    /// ring) so a recording→playing transition is never dropped. RT-safe.
    #[inline]
    pub fn take_looper_edge(&mut self) -> Option<(u8, u8)> {
        self.pending_edge.take()
    }

    /// The MOST-RECENTLY-COMMITTED layer's loop content as a read-only slice
    /// `[0, loop_len)` — the just-captured take's true per-sample PCM. The
    /// committed layer is read-only on the render path (never written again, only
    /// read for playback), so handing back a borrow is RT-safe: no copy, no
    /// allocation. Returns an empty slice before the first commit. This is the
    /// WASM read-on-commit seam: the worklet calls
    /// [`crate::DspInstance::last_committed_layer_pcm`] when it drains a commit
    /// `LooperEdge` and ships the bytes to the UI (mirroring `output_ptr`).
    #[inline]
    pub fn last_committed_layer_pcm(&self) -> &[f32] {
        match self.layers.last() {
            Some(layer) => {
                let n = self.loop_len.min(layer.buf.len());
                &layer.buf[..n]
            }
            None => &[],
        }
    }

    /// The block of input samples the active take just CAPTURED this `process`
    /// call, as a read-only slice — or `None` when no take is recording. This is
    /// the NATIVE stream-during-record seam: the cpal callback reads it after each
    /// `process_block` and pushes it into the per-looper capture ring (the
    /// `RecorderSink`), so the off-RT side assembles the take's PCM by the commit
    /// edge. RT-safe: a plain slice borrow into the pre-allocated `recording`
    /// buffer, no copy/alloc.
    ///
    /// The slice is the window `[block_start, pos)` written this block. On the
    /// block where the take WRAPS and commits, the wrap resets `pos` and moves the
    /// buffer into a layer, so this returns `None` that block; the streamed
    /// samples up to the wrap already rode the ring, and the off-RT assembler
    /// trims to `loop_len`.
    #[inline]
    pub fn last_captured_block(&self) -> Option<&[f32]> {
        if !matches!(
            self.state,
            LooperState::Recording | LooperState::Overdubbing
        ) {
            return None;
        }
        let start = self.block_capture_start;
        let end = self.pos.min(self.recording.len());
        if start >= end {
            return None;
        }
        Some(&self.recording[start..end])
    }

    /// Record a state transition, coalescing onto the single pending slot. If an
    /// edge is already pending (un-drained), keep its original `from` so the net
    /// transition across the block is reported. RT-safe.
    #[inline]
    fn set_edge(&mut self, from: LooperState, to: LooperState) {
        if from == to {
            return;
        }
        let from_u8 = match self.pending_edge {
            Some((f, _)) => f,
            None => from.as_u8(),
        };
        self.pending_edge = Some((from_u8, to.as_u8()));
    }

    /// Transition to `next`, recording the edge. RT-safe.
    #[inline]
    fn transition(&mut self, next: LooperState) {
        let prev = self.state;
        self.state = next;
        self.set_edge(prev, next);
    }

    /// The quantized first-take length implied by [`looper_param::LOOP_SECS`], in
    /// frames, clamped to the buffer capacity. `0` means free-run.
    #[inline]
    fn quantized_len(&self) -> usize {
        if self.loop_secs <= 0.0 {
            return 0;
        }
        let frames = (self.loop_secs * self.sample_rate) as usize;
        frames.clamp(1, self.capacity().max(1))
    }

    /// Begin a fresh take into the `recording` buffer. The buffer will be fully
    /// overwritten across its cycle before commit, so it needs no pre-zero. RT-safe.
    #[inline]
    fn start_take(&mut self) {
        self.pos = 0;
        // Overdub vs first record only differs in whether layers already exist;
        // the engine still reports OVERDUBBING when playing layers are present so
        // the UI can distinguish, but capture is identical.
        let next = if self.layers.is_empty() {
            LooperState::Recording
        } else {
            LooperState::Overdubbing
        };
        self.transition(next);
    }

    /// Commit the active take as a new layer (RT-safe: O(1) pointer move, NO
    /// alloc, NO big copy). The committed buffer was fully overwritten across its
    /// cycle, so it needs no zeroing; the replacement `recording` buffer is fully
    /// overwritten before its own commit, so it needs no pre-zero either.
    fn commit_take(&mut self) {
        if self.loop_len == 0 {
            return;
        }
        if self.layers.len() < MAX_LAYERS {
            // O(1) swap a fresh take buffer in from the pool, which `activate`
            // pre-sized to MAX_LAYERS spares — so while layers < MAX_LAYERS the
            // pool always holds at least one and this NEVER allocates on the RT
            // path. If it is ever empty here, `activate` was not called (a misuse
            // path): keep the last good `recording` buffer and drop the take
            // rather than allocate while audio flows. The debug_assert makes CI
            // catch any path that reaches it.
            if let Some(replacement) = self.pool.pop() {
                let buf = core::mem::take(&mut self.recording);
                self.layers.push(Layer { buf, muted: false });
                self.recording = replacement;
            } else {
                debug_assert!(
                    false,
                    "looper pool exhausted in commit_take (activate not called?)"
                );
            }
        }
        // else: at the layer cap — drop the take (state still goes to Playing).
        self.transition(LooperState::Playing);
        self.pos = 0;
    }

    /// Return every layer's buffer to the pool and reset to a clean Idle. RT-safe:
    /// bounded moves over `<= MAX_LAYERS` layers, no allocation.
    fn clear_all(&mut self) {
        while let Some(layer) = self.layers.pop() {
            self.pool.push(layer.buf);
        }
        self.loop_len = 0;
        self.pos = 0;
        self.transition(LooperState::Idle);
    }

    /// Pop the most recent layer, returning its buffer to the pool (UNDO_LAST).
    /// RT-safe: O(1). If no layers remain, falls back to Idle. `pub` so the
    /// protocol-agent stage can route the `UNDO_LAST` action straight to it.
    pub fn undo_last(&mut self) {
        if let Some(layer) = self.layers.pop() {
            self.pool.push(layer.buf);
        }
        if self.layers.is_empty() {
            self.loop_len = 0;
            self.pos = 0;
            self.transition(LooperState::Idle);
        }
    }

    /// Toggle (or set) a layer's mute flag. RT-safe: a single bool write.
    pub fn set_layer_muted(&mut self, idx: usize, muted: bool) {
        if let Some(layer) = self.layers.get_mut(idx) {
            layer.muted = muted;
        }
    }

    /// Delete a layer by index, returning its buffer to the pool. RT-safe:
    /// `Vec::remove` is an O(n <= MAX_LAYERS) shift with NO allocation.
    pub fn delete_layer(&mut self, idx: usize) {
        if idx < self.layers.len() {
            let layer = self.layers.remove(idx);
            self.pool.push(layer.buf);
            if self.layers.is_empty() {
                self.loop_len = 0;
                self.pos = 0;
                self.transition(LooperState::Idle);
            }
        }
    }

    /// Drive the state machine from an [`ojproto::looper_action`] code. `arg`
    /// addresses a layer for the indexed actions (set_mute / delete_layer) and
    /// is ignored by the transport actions. RT-safe: bounded work, no
    /// allocation. Unknown actions are ignored.
    pub fn action(&mut self, action: u8, arg: u32) {
        match action {
            looper_action::ARM => {
                // In the multi-track model ARM no longer wipes anything; it just
                // marks intent to record next. (No clear — layering is preserved.)
                self.transition(LooperState::Armed);
            }
            looper_action::RECORD | looper_action::OVERDUB => {
                // Every record/overdub starts a NEW take. Existing layers are
                // never cleared — that is the multi-track contract.
                self.start_take();
            }
            looper_action::PLAY => {
                if !self.layers.is_empty() {
                    self.transition(LooperState::Playing);
                } else {
                    self.transition(LooperState::Idle);
                }
            }
            looper_action::STOP => {
                // Stopping an in-progress take finalizes it. For the FIRST take
                // (loop_len still 0, free-run) the length is the current write
                // head; then commit. If quantized, the wrap in `process` already
                // committed; here we just hold Playing.
                if matches!(
                    self.state,
                    LooperState::Recording | LooperState::Overdubbing
                ) {
                    if self.loop_len == 0 {
                        self.loop_len = self.pos.max(1);
                    }
                    self.commit_take();
                } else if !self.layers.is_empty() {
                    self.transition(LooperState::Playing);
                } else {
                    self.transition(LooperState::Idle);
                }
            }
            looper_action::CLEAR => {
                self.clear_all();
            }
            looper_action::UNDO_LAST => {
                self.undo_last();
            }
            looper_action::SET_MUTE => {
                // `arg` packs the layer index in its low bits; the high
                // MUTE_FLAG bit carries the desired muted state.
                let muted = arg & looper_action::MUTE_FLAG != 0;
                let idx = (arg & !looper_action::MUTE_FLAG) as usize;
                self.set_layer_muted(idx, muted);
            }
            looper_action::DELETE_LAYER => {
                self.delete_layer(arg as usize);
            }
            _ => {}
        }
    }
}

impl DspInstance for LooperNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        let sr = if sample_rate > 0.0 {
            sample_rate
        } else {
            48_000.0
        };
        self.sample_rate = sr;
        let cap = ((MAX_LOOP_SECS * sr) as usize).max(1);
        // ALL allocation happens HERE (off-RT). Pre-allocate MAX_LAYERS + 1
        // buffers: one becomes the active `recording` take, the rest fill the
        // free pool. The layer Vec reserves MAX_LAYERS so `push` never grows it.
        self.layers = Vec::with_capacity(MAX_LAYERS);
        self.recording = vec![0.0; cap];
        self.pool = Vec::with_capacity(MAX_LAYERS);
        for _ in 0..MAX_LAYERS {
            self.pool.push(vec![0.0; cap]);
        }
        self.loop_len = 0;
        self.pos = 0;
        self.state = LooperState::Idle;
        self.last_block_peak = 0.0;
        self.pending_edge = None;
        self.block_capture_start = 0;
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Mono in -> mono out; tolerate missing channels gracefully.
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        let n = ctx.nframes.min(input.len()).min(output.len());
        let cap = self.recording.len();
        if cap == 0 {
            // Not activated yet: clean passthrough rather than silence.
            output[..n].copy_from_slice(&input[..n]);
            return;
        }

        // The quantized first-take length (only meaningful when no loop yet).
        let quant = self.quantized_len();
        let mut peak = 0.0f32;

        // Snapshot the write head at block start so the native capture seam
        // ([`last_captured_block`]) can hand the per-looper ring exactly the
        // samples written this block. When a take wraps + commits mid-block, the
        // state leaves Recording/Overdubbing and `last_captured_block` returns
        // `None` for the block (the streamed tail up to the wrap already rode the
        // ring on prior blocks; the off-RT assembler trims to `loop_len`).
        self.block_capture_start = self.pos;

        for i in 0..n {
            let x = input[i];

            // Output = dry monitor + sum of committed, UNMUTED layers (wet).
            // The active `recording` buffer is NEVER read here (no-duplication).
            let mut wet_sum = 0.0f32;
            if self.loop_len > 0 {
                let p = self.pos;
                for layer in self.layers.iter() {
                    if !layer.muted {
                        // Safe: every committed layer buffer is >= loop_len and
                        // p < loop_len holds (enforced by the wrap below).
                        wet_sum += layer.buf[p];
                    }
                }
            }
            let y = x * self.dry + wet_sum * self.wet;
            output[i] = y;
            let a = y.abs();
            if a > peak {
                peak = a;
            }

            match self.state {
                LooperState::Idle | LooperState::Armed | LooperState::Playing => {
                    // Advance the shared playhead within the loop window.
                    if self.loop_len > 0 {
                        self.pos += 1;
                        if self.pos >= self.loop_len {
                            self.pos = 0;
                        }
                    }
                }
                LooperState::Recording | LooperState::Overdubbing => {
                    // Capture the live take WITHOUT feeding it back to output.
                    self.recording[self.pos] = x;
                    self.pos += 1;

                    if self.loop_len == 0 {
                        // FIRST take, free-run vs quantized.
                        if quant > 0 {
                            // Fixed-length first take: commit at the boundary.
                            if self.pos >= quant {
                                self.loop_len = quant;
                                self.commit_take();
                            }
                        } else {
                            // Free-run: grow until STOP, but never past capacity.
                            if self.pos >= cap {
                                self.loop_len = cap;
                                self.commit_take();
                            }
                        }
                    } else {
                        // Later take: phase-locked to the established loop_len.
                        // Wrap commits the take exactly at the loop boundary.
                        if self.pos >= self.loop_len {
                            self.commit_take();
                        }
                    }
                }
            }
        }

        self.last_block_peak = peak;
    }

    fn set_param(&mut self, id: u16, value: f32) {
        match id {
            looper_param::LOOP_SECS => {
                self.loop_secs = value.clamp(0.0, MAX_LOOP_SECS);
            }
            looper_param::WET => self.wet = value.clamp(0.0, 1.0),
            looper_param::DRY => self.dry = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn looper_action(&mut self, action: u8, arg: u32) {
        // Delegate the trait hook to the inherent state-machine driver.
        self.action(action, arg);
    }

    fn looper_snapshot(&self) -> Option<(u8, u32, u32, f32)> {
        // Delegate to the inherent accessor (fully-qualified to skip the trait
        // method we are defining). RT-safe: plain field reads.
        Some(LooperNode::looper_snapshot(self))
    }

    fn take_looper_edge(&mut self) -> Option<(u8, u8)> {
        // Delegate to the inherent drainer (fully-qualified). RT-safe:
        // an `Option::take`, no allocation.
        LooperNode::take_looper_edge(self)
    }

    fn last_committed_layer_pcm(&self) -> &[f32] {
        // Delegate to the inherent accessor. RT-safe: a slice borrow.
        LooperNode::last_committed_layer_pcm(self)
    }

    fn last_captured_block(&self) -> Option<&[f32]> {
        // Delegate to the inherent accessor. RT-safe: a slice borrow.
        LooperNode::last_captured_block(self)
    }

    fn reset(&mut self) {
        self.clear_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const BLOCK: usize = 64;

    /// Run one block through the looper with the given input, returning output.
    fn run_block(node: &mut LooperNode, input: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0f32; input.len()];
        {
            let ins: [&[f32]; 1] = [input];
            let mut outs: [&mut [f32]; 1] = [&mut out];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: input.len(),
            };
            node.process(&mut ctx);
        }
        out
    }

    fn ramp(len: usize, scale: f32) -> Vec<f32> {
        (0..len).map(|i| (i as f32) * scale - 0.5).collect()
    }

    #[test]
    fn idle_is_exact_unity_passthrough() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        let input = ramp(BLOCK, 0.01);
        let out = run_block(&mut node, &input);
        for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
            assert!((x - y).abs() < 1e-6, "frame {i}: {x} != {y}");
        }
    }

    #[test]
    fn records_then_plays_back_identically() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        // Fixed-length loop of exactly one block.
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let input = ramp(BLOCK, 0.013);
        // Record one block — exactly fills the quantized loop and auto-commits
        // to Playing with one layer.
        node.action(looper_action::RECORD, 0);
        let rec_out = run_block(&mut node, &input);
        assert_eq!(node.state(), LooperState::Playing);
        assert_eq!(node.loop_len(), BLOCK);
        assert_eq!(node.layer_count(), 1);

        // NO-DUPLICATION: while recording (dry=0) the take is not fed back, so
        // the recording-pass output is silent.
        for (i, &y) in rec_out.iter().enumerate() {
            assert!(y.abs() < 1e-6, "record-pass frame {i} leaked: {y}");
        }

        // Now play back with silence as the input: out == recorded loop * wet.
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        for (i, (&x, &y)) in input.iter().zip(out.iter()).enumerate() {
            assert!(
                (x - y).abs() < 1e-6,
                "playback frame {i}: recorded {x} != played {y}"
            );
        }
    }

    /// (a) Recording a 2nd layer does NOT double the live input into the output.
    #[test]
    fn second_layer_does_not_double_live_input() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 1.0);

        // First layer captured.
        let first = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &first);
        assert_eq!(node.layer_count(), 1);
        assert_eq!(node.state(), LooperState::Playing);

        // Start a 2nd take (overdub). During this pass the output must be
        // dry*x + wet*(layer0) ONLY — the live input is NOT also summed from the
        // recording buffer (that is the "way louder" double-count bug).
        let second = ramp(BLOCK, 0.007);
        node.action(looper_action::OVERDUB, 0);
        assert_eq!(node.state(), LooperState::Overdubbing);
        let out = run_block(&mut node, &second);
        for i in 0..BLOCK {
            let expected = second[i] /* dry */ + first[i] /* layer0 wet */;
            assert!(
                (out[i] - expected).abs() < 1e-6,
                "frame {i}: got {} expected {expected} (live input double-counted?)",
                out[i]
            );
        }
        // The take wrapped at the boundary and committed a 2nd layer.
        assert_eq!(node.layer_count(), 2);
    }

    /// (b) Two committed layers both play and are phase-locked.
    #[test]
    fn two_layers_play_phase_locked() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let a = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &a);
        let len_after_first = node.loop_len();

        let b = ramp(BLOCK, 0.005);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &b);
        assert_eq!(node.layer_count(), 2);
        // Phase-lock: the loop length did not change with the 2nd layer.
        assert_eq!(node.loop_len(), len_after_first);

        // Playback over silence: both layers sum, sample-aligned (same pos/len).
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            let expected = a[i] + b[i];
            assert!(
                (out[i] - expected).abs() < 1e-6,
                "frame {i}: got {} expected {expected} (layers not phase-locked?)",
                out[i]
            );
        }
    }

    /// (d) Per-layer mute removes only that layer from the mix.
    #[test]
    fn mute_removes_only_that_layer() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let a = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &a);
        let b = ramp(BLOCK, 0.005);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &b);
        assert_eq!(node.layer_count(), 2);

        // Mute layer 0: output should be only layer 1 (b).
        node.set_layer_muted(0, true);
        assert!(node.layer_muted(0));
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            assert!(
                (out[i] - b[i]).abs() < 1e-6,
                "mute frame {i}: got {} expected {} (only b should play)",
                out[i],
                b[i]
            );
        }

        // Unmute -> both layers again.
        node.set_layer_muted(0, false);
        let out2 = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            let expected = a[i] + b[i];
            assert!((out2[i] - expected).abs() < 1e-6, "unmute frame {i}");
        }
    }

    /// (e) Undo-last removes the last layer.
    #[test]
    fn undo_last_removes_last_layer() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let a = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &a);
        let b = ramp(BLOCK, 0.005);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &b);
        assert_eq!(node.layer_count(), 2);

        // Undo the most recent layer (b); only a should remain.
        node.undo_last();
        assert_eq!(node.layer_count(), 1);
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            assert!(
                (out[i] - a[i]).abs() < 1e-6,
                "undo frame {i}: got {} expected {} (b should be gone)",
                out[i],
                a[i]
            );
        }

        // Undo the last remaining layer -> back to Idle.
        node.undo_last();
        assert_eq!(node.layer_count(), 0);
        assert_eq!(node.state(), LooperState::Idle);
        assert_eq!(node.loop_len(), 0);
    }

    #[test]
    fn delete_layer_returns_buffer_to_pool() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let a = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &a);
        let b = ramp(BLOCK, 0.005);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &b);
        let c = ramp(BLOCK, 0.003);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &c);
        assert_eq!(node.layer_count(), 3);

        // Delete the middle layer (b). a + c remain, order preserved.
        node.delete_layer(1);
        assert_eq!(node.layer_count(), 2);
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            let expected = a[i] + c[i];
            assert!((out[i] - expected).abs() < 1e-6, "delete frame {i}");
        }
    }

    /// The indexed action codes route through `action(action, arg)` to the
    /// inherent layer ops — this is the gap the command-protocol stage closes.
    #[test]
    fn indexed_actions_route_through_action_arg() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);

        let a = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &a);
        let b = ramp(BLOCK, 0.005);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &b);
        let c = ramp(BLOCK, 0.003);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &c);
        assert_eq!(node.layer_count(), 3);

        // SET_MUTE with the MUTE_FLAG high bit set mutes the addressed layer.
        node.action(looper_action::SET_MUTE, 1 | looper_action::MUTE_FLAG);
        assert!(node.layer_muted(1));
        // SET_MUTE with the flag clear unmutes it.
        node.action(looper_action::SET_MUTE, 1);
        assert!(!node.layer_muted(1));

        // DELETE_LAYER addresses the layer via `arg`.
        node.action(looper_action::DELETE_LAYER, 0);
        assert_eq!(node.layer_count(), 2);

        // UNDO_LAST pops the most-recent layer (ignores `arg`).
        node.action(looper_action::UNDO_LAST, 0);
        assert_eq!(node.layer_count(), 1);
    }

    #[test]
    fn clear_resets_to_silence() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let input = ramp(BLOCK, 0.02);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &input);
        assert!(node.loop_len() > 0);
        assert_eq!(node.layer_count(), 1);

        node.action(looper_action::CLEAR, 0);
        assert_eq!(node.state(), LooperState::Idle);
        assert_eq!(node.loop_len(), 0);
        assert_eq!(node.layer_count(), 0);

        // After clear, playing over silence yields pure silence.
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        assert!(out.iter().all(|&y| y == 0.0), "loop not cleared to silence");
    }

    #[test]
    fn state_machine_transitions_via_actions() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        assert_eq!(node.state(), LooperState::Idle);

        node.action(looper_action::ARM, 0);
        assert_eq!(node.state(), LooperState::Armed);

        node.action(looper_action::RECORD, 0);
        assert_eq!(node.state(), LooperState::Recording);

        // Free-run (no quantized length): a block does not auto-stop.
        let input = ramp(BLOCK, 0.01);
        let _ = run_block(&mut node, &input);
        assert_eq!(node.state(), LooperState::Recording);

        node.action(looper_action::STOP, 0);
        assert_eq!(node.state(), LooperState::Playing);
        assert_eq!(node.loop_len(), BLOCK, "free-run loop length == captured");
        assert_eq!(node.layer_count(), 1);

        // A second record/overdub starts a new take while layers exist.
        node.action(looper_action::OVERDUB, 0);
        assert_eq!(node.state(), LooperState::Overdubbing);

        node.action(looper_action::PLAY, 0);
        assert_eq!(node.state(), LooperState::Playing);

        node.action(looper_action::CLEAR, 0);
        assert_eq!(node.state(), LooperState::Idle);
    }

    #[test]
    fn free_run_record_then_stop_captures_variable_length() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        // No LOOP_SECS set => free-run.
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        node.action(looper_action::RECORD, 0);
        // Record two blocks (128 frames) then stop.
        let a = ramp(BLOCK, 0.01);
        let b = ramp(BLOCK, 0.02);
        let _ = run_block(&mut node, &a);
        let _ = run_block(&mut node, &b);
        node.action(looper_action::STOP, 0);
        assert_eq!(node.loop_len(), 2 * BLOCK);
        assert_eq!(node.state(), LooperState::Playing);
        assert_eq!(node.layer_count(), 1);

        // Playback over silence reproduces a ++ b.
        let silence = vec![0.0f32; BLOCK];
        let out0 = run_block(&mut node, &silence);
        let out1 = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            assert!((out0[i] - a[i]).abs() < 1e-6, "block0 frame {i}");
            assert!((out1[i] - b[i]).abs() < 1e-6, "block1 frame {i}");
        }
    }

    #[test]
    fn capacity_sized_to_max_loop_secs() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        assert_eq!(node.capacity(), (MAX_LOOP_SECS * SR) as usize);
    }

    #[test]
    fn snapshot_and_edge_reflect_state() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);

        // State u8s mirror ojproto::looper_state (IDLE=0, RECORDING=2, PLAYING=3).
        const IDLE: u8 = LooperState::Idle as u8;
        const RECORDING: u8 = LooperState::Recording as u8;
        const PLAYING: u8 = LooperState::Playing as u8;

        // Idle snapshot.
        let (s, pos, len, _peak) = node.looper_snapshot();
        assert_eq!(s, IDLE);
        assert_eq!(pos, 0);
        assert_eq!(len, 0);

        node.action(looper_action::RECORD, 0);
        // An Idle->Recording edge is pending.
        assert_eq!(node.take_looper_edge(), Some((IDLE, RECORDING)));
        // Drained.
        assert_eq!(node.take_looper_edge(), None);

        let _ = run_block(&mut node, &ramp(BLOCK, 0.01));
        // Wrap committed -> Playing edge pending.
        assert_eq!(node.take_looper_edge(), Some((RECORDING, PLAYING)));
        let (s, _pos, len, _peak) = node.looper_snapshot();
        assert_eq!(s, PLAYING);
        assert_eq!(len, BLOCK as u32);
    }

    #[test]
    fn layer_cap_does_not_allocate_or_overflow() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        // Record MAX_LAYERS + 3 takes; only MAX_LAYERS should be retained.
        for k in 0..(MAX_LAYERS + 3) {
            let take = ramp(BLOCK, 0.001 * (k as f32 + 1.0));
            node.action(looper_action::OVERDUB, 0);
            let _ = run_block(&mut node, &take);
        }
        assert_eq!(node.layer_count(), MAX_LAYERS);
        assert_eq!(node.state(), LooperState::Playing);
    }

    /// WASM read-on-commit seam: after a take commits, `last_committed_layer_pcm`
    /// returns the captured take's true per-sample PCM `[0, loop_len)`, intact.
    #[test]
    fn last_committed_layer_pcm_returns_captured_take() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);

        // Before any commit, the slice is empty.
        assert!(node.last_committed_layer_pcm().is_empty());

        let signal = ramp(BLOCK, 0.013);
        node.action(looper_action::RECORD, 0);
        let _ = run_block(&mut node, &signal);
        assert_eq!(node.state(), LooperState::Playing);
        assert_eq!(node.layer_count(), 1);

        // The committed layer's PCM is exactly the recorded input, loop_len long.
        let pcm = node.last_committed_layer_pcm();
        assert_eq!(pcm.len(), BLOCK);
        for (i, (&x, &y)) in signal.iter().zip(pcm.iter()).enumerate() {
            assert!((x - y).abs() < 1e-9, "commit pcm frame {i}: {x} != {y}");
        }

        // A SECOND take's commit replaces what the accessor returns (most-recent).
        let second = ramp(BLOCK, 0.005);
        node.action(looper_action::OVERDUB, 0);
        let _ = run_block(&mut node, &second);
        assert_eq!(node.layer_count(), 2);
        let pcm2 = node.last_committed_layer_pcm();
        assert_eq!(pcm2.len(), BLOCK);
        for (i, (&x, &y)) in second.iter().zip(pcm2.iter()).enumerate() {
            assert!((x - y).abs() < 1e-9, "2nd commit pcm frame {i}: {x} != {y}");
        }
    }

    /// NATIVE stream-during-record seam: while a free-run take is recording,
    /// `last_captured_block` hands back exactly the samples written each block, so
    /// the off-RT recorder ring reassembles the take. Concatenated across blocks
    /// they equal the input; once the take is not recording it returns `None`.
    #[test]
    fn last_captured_block_streams_recorded_input() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        // Free-run so the take does not auto-commit mid-block (no quantize).
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        // Not recording yet -> nothing to stream.
        assert!(node.last_captured_block().is_none());

        node.action(looper_action::RECORD, 0);
        let a = ramp(BLOCK, 0.01);
        let b = ramp(BLOCK, 0.02);

        let mut assembled: Vec<f32> = Vec::new();
        let _ = run_block(&mut node, &a);
        assembled.extend_from_slice(node.last_captured_block().expect("block a captured"));
        let _ = run_block(&mut node, &b);
        assembled.extend_from_slice(node.last_captured_block().expect("block b captured"));

        assert_eq!(assembled.len(), 2 * BLOCK);
        for (i, (&x, &y)) in a.iter().chain(b.iter()).zip(assembled.iter()).enumerate() {
            assert!((x - y).abs() < 1e-9, "streamed frame {i}: {x} != {y}");
        }

        // STOP commits; no longer recording, so the stream window closes.
        node.action(looper_action::STOP, 0);
        assert_eq!(node.state(), LooperState::Playing);
        assert!(node.last_captured_block().is_none());

        // And the committed layer equals the full captured take.
        let pcm = node.last_committed_layer_pcm();
        assert_eq!(pcm.len(), 2 * BLOCK);
        for (i, (&x, &y)) in a.iter().chain(b.iter()).zip(pcm.iter()).enumerate() {
            assert!((x - y).abs() < 1e-9, "committed frame {i}: {x} != {y}");
        }
    }

    #[test]
    fn tolerates_empty_buffers() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        let ins: [&[f32]; 0] = [];
        let mut outs: [&mut [f32]; 0] = [];
        let mut ctx = ProcessCtx {
            inputs: &ins,
            outputs: &mut outs,
            nframes: 0,
        };
        node.process(&mut ctx);
    }
}
