//! The built-in LOOPER (U-STATEFUL): an audio thru-node that records its input
//! into a pre-allocated loop buffer, plays it back mixed with the live input,
//! and supports overdubbing (summing new input into the existing loop).
//!
//! Like every other node it is "just a plugin": a [`PluginManifest`] (lowering
//! its open `builtin.looper` id to the closed [`PrimitiveKind::Looper`]), a
//! [`PluginLoader`] factory, and a [`DspInstance`] whose `process` is
//! **allocation-free** — the whole loop buffer is sized once in
//! [`DspInstance::activate`] (to [`MAX_LOOP_SECS`] at the activation sample
//! rate) and never reallocated on the RT path.
//!
//! # State machine
//! ```text
//!   Idle ──arm──▶ Armed ──record──▶ Recording ──stop/wrap──▶ Playing
//!     ▲                                                         │  ▲
//!     └──────────────── clear ◀────────────────────────────────┘  │
//!                                              overdub ────────────┘
//! ```
//! Transitions are driven by [`ojproto::RtCommand::Looper`] actions, decoded
//! into [`LooperNode::action`] (one of the [`ojproto::looper_action`] consts).
//!
//! # Loop-boundary quantization (v1)
//! The loop length is quantized to a settable [`looper_param::LOOP_SECS`]
//! parameter (seconds), NOT to the engine [`crate::Transport`]'s bar/beat. The
//! [`DspInstance`] trait gives a node no cross-node access to the engine's
//! transport from inside `process`, so transport-locked quantization would
//! require threading a `TransportPos` through `ProcessCtx` (a wider protocol
//! change owned by another unit). For v1 the loop length is a plain param: a UI
//! that wants bar-locked loops sets `LOOP_SECS = bars * beats_per_bar *
//! 60 / tempo_bpm`. When `LOOP_SECS <= 0` the looper free-runs and the loop
//! length is whatever was captured between record-start and stop. This is the
//! documented deviation noted in U-STATEFUL.

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

/// Maximum loop length the buffer is pre-sized for, in seconds. 60 s at the
/// activation sample rate; the buffer is allocated once in `activate` and never
/// grows on the RT path.
pub const MAX_LOOP_SECS: f32 = 60.0;

/// Looper parameter ids (the one `(NodeIdx, id)` addressing scheme).
pub mod looper_param {
    /// Quantized loop length in seconds. `<= 0` means free-run (the loop length
    /// is whatever was captured between record-start and stop). Clamped to
    /// [`super::MAX_LOOP_SECS`].
    pub const LOOP_SECS: u16 = 0;
    /// Wet (loop playback) level mixed into the output, linear `0..1`.
    pub const WET: u16 = 1;
    /// Dry (live input) level mixed into the output, linear `0..1`.
    pub const DRY: u16 = 2;
}

/// The looper's transport state. Driven by [`ojproto::looper_action`] commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LooperState {
    /// No loop captured; pure passthrough of the dry input.
    Idle,
    /// Armed: the next block of recording will start from a clean buffer.
    Armed,
    /// Capturing the input into the loop buffer.
    Recording,
    /// Playing the captured loop back (mixed with the dry input).
    Playing,
    /// Playing the loop back AND summing the live input into it.
    Overdubbing,
}

fn looper_manifest() -> PluginManifest {
    PluginManifest {
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
                default: 1.0,
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
        // Size the loop buffer up front so the first `process` (even before an
        // explicit `activate`) is allocation-free.
        node.activate(sample_rate, max_block);
        Box::new(node)
    }
}

/// A loop recorder/player. The loop buffer is allocated once in [`activate`] to
/// [`MAX_LOOP_SECS`] frames; `process` only reads/writes inside it, so the hot
/// path never allocates.
///
/// [`activate`]: DspInstance::activate
pub struct LooperNode {
    /// Pre-allocated loop buffer (mono), `MAX_LOOP_SECS * sample_rate` frames.
    buf: Vec<f32>,
    /// Active sample rate, set in `activate`.
    sample_rate: f32,
    /// Current transport state.
    state: LooperState,
    /// Read/write playhead within `[0, loop_len)`.
    pos: usize,
    /// Number of valid frames in the current loop. `0` until a loop is captured.
    loop_len: usize,
    /// Quantized loop length param, in seconds (`<= 0` = free-run).
    loop_secs: f32,
    /// Loop playback level (wet).
    wet: f32,
    /// Live input level (dry).
    dry: f32,
}

impl Default for LooperNode {
    fn default() -> Self {
        Self::new()
    }
}

impl LooperNode {
    pub fn new() -> Self {
        Self {
            buf: Vec::new(),
            sample_rate: 48_000.0,
            state: LooperState::Idle,
            pos: 0,
            loop_len: 0,
            loop_secs: 0.0,
            wet: 1.0,
            dry: 1.0,
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

    /// Maximum loop length the buffer is sized for, in frames.
    #[inline]
    pub fn capacity(&self) -> usize {
        self.buf.len()
    }

    /// The quantized loop length implied by [`looper_param::LOOP_SECS`], in
    /// frames, clamped to the buffer capacity. `0` means free-run.
    #[inline]
    fn quantized_len(&self) -> usize {
        if self.loop_secs <= 0.0 {
            return 0;
        }
        let frames = (self.loop_secs * self.sample_rate) as usize;
        frames.clamp(1, self.buf.len().max(1))
    }

    /// Drive the state machine from an [`ojproto::looper_action`] code. RT-safe:
    /// bounded work, no allocation. Unknown actions are ignored.
    pub fn action(&mut self, action: u8) {
        match action {
            looper_action::ARM => {
                // Arm from a clean slate: next record starts a fresh loop.
                self.clear_buffer();
                self.state = LooperState::Armed;
            }
            looper_action::RECORD => {
                // From Armed/Idle this begins a fresh capture; the loop length
                // is the quantized length if set, else grows until STOP.
                if matches!(self.state, LooperState::Idle | LooperState::Armed) {
                    self.clear_buffer();
                }
                self.pos = 0;
                self.state = LooperState::Recording;
            }
            looper_action::OVERDUB => {
                // Overdub only makes sense once a loop exists; otherwise treat
                // it as a fresh record so the action is never a silent no-op.
                if self.loop_len > 0 {
                    self.state = LooperState::Overdubbing;
                } else {
                    self.pos = 0;
                    self.state = LooperState::Recording;
                }
            }
            looper_action::PLAY => {
                if self.loop_len > 0 {
                    // Finalize a free-run capture if we were still recording.
                    self.state = LooperState::Playing;
                } else {
                    self.state = LooperState::Idle;
                }
            }
            looper_action::STOP => {
                // Stopping a free-run record finalizes the loop length at the
                // current write head; then hold (Playing if we have a loop).
                if matches!(self.state, LooperState::Recording) && self.quantized_len() == 0 {
                    self.loop_len = self.pos.max(self.loop_len);
                }
                self.pos = 0;
                self.state = if self.loop_len > 0 {
                    LooperState::Playing
                } else {
                    LooperState::Idle
                };
            }
            looper_action::CLEAR => {
                self.clear_buffer();
                self.state = LooperState::Idle;
            }
            _ => {}
        }
    }

    /// Zero the captured loop and reset playback to the start. Touches only the
    /// already-allocated buffer, so it is RT-safe.
    fn clear_buffer(&mut self) {
        for s in self.buf.iter_mut() {
            *s = 0.0;
        }
        self.loop_len = 0;
        self.pos = 0;
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
        let cap = (MAX_LOOP_SECS * sr) as usize;
        // Reallocate only off the RT thread (here, in `activate`). Preserve no
        // prior contents — activation starts a clean instance.
        self.buf = vec![0.0; cap.max(1)];
        self.loop_len = 0;
        self.pos = 0;
        self.state = LooperState::Idle;
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Mono in -> mono out; tolerate missing channels gracefully.
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        let n = ctx.nframes.min(input.len()).min(output.len());
        let cap = self.buf.len();
        if cap == 0 {
            // Not activated yet: clean passthrough rather than silence.
            output[..n].copy_from_slice(&input[..n]);
            return;
        }

        // Resolve the loop window for this block.
        let quant = self.quantized_len();

        for i in 0..n {
            let x = input[i];
            match self.state {
                LooperState::Idle | LooperState::Armed => {
                    // No loop yet: pure dry passthrough (gain 1.0 so an
                    // unconfigured looper is transparent).
                    output[i] = x;
                }
                LooperState::Recording => {
                    // Determine the loop window: quantized length if set, else
                    // grow the buffer up to capacity.
                    let len = if quant > 0 { quant } else { cap };
                    // Record (overwrite) the input.
                    self.buf[self.pos] = x;
                    // Monitor the dry input while recording.
                    output[i] = x * self.dry;
                    self.pos += 1;
                    if self.pos >= len {
                        // Loop boundary reached: finalize length and switch to
                        // playback (quantized) — this is the loop-boundary
                        // quantization point for a fixed-length loop.
                        self.loop_len = len;
                        self.pos = 0;
                        if quant > 0 {
                            self.state = LooperState::Playing;
                        }
                        // Free-run recording keeps going (wrapping) until STOP;
                        // loop_len is held at `cap` as the upper bound.
                    }
                }
                LooperState::Playing => {
                    let len = self.loop_len.max(1);
                    let loop_s = self.buf[self.pos];
                    output[i] = x * self.dry + loop_s * self.wet;
                    self.pos += 1;
                    if self.pos >= len {
                        self.pos = 0;
                    }
                }
                LooperState::Overdubbing => {
                    let len = self.loop_len.max(1);
                    // Sum the live input into the existing loop.
                    let summed = self.buf[self.pos] + x;
                    self.buf[self.pos] = summed;
                    output[i] = x * self.dry + summed * self.wet;
                    self.pos += 1;
                    if self.pos >= len {
                        self.pos = 0;
                    }
                }
            }
        }
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

    fn looper_action(&mut self, action: u8) {
        // Delegate the trait hook to the inherent state-machine driver.
        self.action(action);
    }

    fn reset(&mut self) {
        self.clear_buffer();
        self.state = LooperState::Idle;
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
    fn idle_is_passthrough() {
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
        // Record one block — exactly fills the quantized loop and auto-switches
        // to Playing.
        node.action(looper_action::RECORD);
        let _ = run_block(&mut node, &input);
        assert_eq!(node.state(), LooperState::Playing);
        assert_eq!(node.loop_len(), BLOCK);

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

    #[test]
    fn overdub_sums_into_loop() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let first = ramp(BLOCK, 0.01);
        node.action(looper_action::RECORD);
        let _ = run_block(&mut node, &first);
        assert_eq!(node.state(), LooperState::Playing);

        // Overdub a second pass; the loop should now hold first + second.
        let second = ramp(BLOCK, 0.007);
        node.action(looper_action::OVERDUB);
        assert_eq!(node.state(), LooperState::Overdubbing);
        let _ = run_block(&mut node, &second);

        // Back to playback over silence: out == (first + second) * wet.
        node.action(looper_action::PLAY);
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        for i in 0..BLOCK {
            let expected = first[i] + second[i];
            assert!(
                (out[i] - expected).abs() < 1e-6,
                "overdub frame {i}: got {} expected {expected}",
                out[i]
            );
        }
    }

    #[test]
    fn clear_resets_to_silence() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(looper_param::LOOP_SECS, BLOCK as f32 / SR);
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        let input = ramp(BLOCK, 0.02);
        node.action(looper_action::RECORD);
        let _ = run_block(&mut node, &input);
        assert!(node.loop_len() > 0);

        node.action(looper_action::CLEAR);
        assert_eq!(node.state(), LooperState::Idle);
        assert_eq!(node.loop_len(), 0);

        // After clear, playing over silence yields pure silence (it falls back
        // to Idle passthrough of the silent input).
        let silence = vec![0.0f32; BLOCK];
        let out = run_block(&mut node, &silence);
        assert!(out.iter().all(|&y| y == 0.0), "loop not cleared to silence");
    }

    #[test]
    fn state_machine_transitions_via_actions() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        assert_eq!(node.state(), LooperState::Idle);

        node.action(looper_action::ARM);
        assert_eq!(node.state(), LooperState::Armed);

        node.action(looper_action::RECORD);
        assert_eq!(node.state(), LooperState::Recording);

        // Free-run (no quantized length): a block does not auto-stop.
        let input = ramp(BLOCK, 0.01);
        let _ = run_block(&mut node, &input);
        assert_eq!(node.state(), LooperState::Recording);

        node.action(looper_action::STOP);
        assert_eq!(node.state(), LooperState::Playing);
        assert_eq!(node.loop_len(), BLOCK, "free-run loop length == captured");

        node.action(looper_action::OVERDUB);
        assert_eq!(node.state(), LooperState::Overdubbing);

        node.action(looper_action::PLAY);
        assert_eq!(node.state(), LooperState::Playing);

        node.action(looper_action::CLEAR);
        assert_eq!(node.state(), LooperState::Idle);
    }

    #[test]
    fn free_run_record_then_stop_captures_variable_length() {
        let mut node = LooperNode::new();
        node.activate(SR, BLOCK);
        // No LOOP_SECS set => free-run.
        node.set_param(looper_param::WET, 1.0);
        node.set_param(looper_param::DRY, 0.0);

        node.action(looper_action::RECORD);
        // Record two blocks (128 frames) then stop.
        let a = ramp(BLOCK, 0.01);
        let b = ramp(BLOCK, 0.02);
        let _ = run_block(&mut node, &a);
        let _ = run_block(&mut node, &b);
        node.action(looper_action::STOP);
        assert_eq!(node.loop_len(), 2 * BLOCK);
        assert_eq!(node.state(), LooperState::Playing);

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
