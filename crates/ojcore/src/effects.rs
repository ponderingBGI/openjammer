//! Built-in EFFECT loaders: biquad filter, waveshaper distortion, feedback
//! delay, and impulse-response convolution. Each is "just a plugin" — a
//! [`PluginManifest`] (lowering its open `builtin.<x>` id to a closed
//! [`PrimitiveKind`]), a [`PluginLoader`] factory, and a [`DspInstance`] whose
//! `process` is allocation-free and reuses an [`ojcore_dsp`] kernel.
//!
//! These bring the built-in effect set to PARITY across the native and `wasm32`
//! engines from a SINGLE source: both registries reach them through
//! [`crate::register_builtins`], never by hand-listing loaders.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore_dsp::{Biquad, BiquadCoeffs, Convolver, DelayLine, FilterType, OnePole, Waveshaper};
use ojproto::PrimitiveKind;

use crate::dsp::{DspInstance, ProcessCtx};
use crate::loader::PluginLoader;
use crate::manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};

// ===========================================================================
// Shared helpers
// ===========================================================================

/// Forward input 0 -> output 0 unchanged (used when a node has no work to do but
/// must still keep signal flowing downstream). Allocation-free, panic-free.
#[inline]
fn passthrough(ctx: &mut ProcessCtx<'_, '_>) {
    if let (Some(input), Some(output)) = (ctx.inputs.first(), ctx.outputs.first_mut()) {
        let n = ctx.nframes.min(input.len()).min(output.len());
        output[..n].copy_from_slice(&input[..n]);
    }
}

// ===========================================================================
// Biquad filter — `builtin.biquad`
// ===========================================================================

/// Stable manifest id for the built-in biquad filter.
pub const BIQUAD_ID: &str = "builtin.biquad";

/// Biquad param ids.
pub mod biquad_param {
    /// Filter type, encoded as an integer index (see [`super::biquad_type`]).
    pub const TYPE: u16 = 0;
    /// Cutoff / centre frequency, Hz.
    pub const FREQ: u16 = 1;
    /// Resonance / Q.
    pub const Q: u16 = 2;
    /// Peaking / shelf gain, dB.
    pub const GAIN_DB: u16 = 3;
}

/// Map a param-encoded filter-type index to a [`FilterType`]. Out-of-range
/// values fall back to a lowpass so a bad param can never panic the RT path.
#[inline]
pub fn biquad_type(idx: f32) -> FilterType {
    match idx as i32 {
        0 => FilterType::Lowpass,
        1 => FilterType::Highpass,
        2 => FilterType::Bandpass,
        3 => FilterType::Notch,
        4 => FilterType::Peaking,
        5 => FilterType::Lowshelf,
        6 => FilterType::Highshelf,
        7 => FilterType::Allpass,
        _ => FilterType::Lowpass,
    }
}

fn biquad_manifest() -> PluginManifest {
    PluginManifest {
        id: String::from(BIQUAD_ID),
        name: String::from("Biquad"),
        kind: PrimitiveKind::Biquad,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: biquad_param::TYPE,
                name: String::from("type"),
                min: 0.0,
                max: 7.0,
                default: 0.0,
            },
            ParamDecl {
                id: biquad_param::FREQ,
                name: String::from("frequency"),
                min: 20.0,
                max: 20_000.0,
                default: 1_000.0,
            },
            ParamDecl {
                id: biquad_param::Q,
                name: String::from("q"),
                min: 0.1,
                max: 20.0,
                default: 0.707,
            },
            ParamDecl {
                id: biquad_param::GAIN_DB,
                name: String::from("gain_db"),
                min: -24.0,
                max: 24.0,
                default: 0.0,
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

/// Loader/factory for [`BiquadNode`].
pub struct BiquadLoader {
    manifest: PluginManifest,
}

impl Default for BiquadLoader {
    fn default() -> Self {
        Self {
            manifest: biquad_manifest(),
        }
    }
}

impl BiquadLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for BiquadLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(BiquadNode::new())
    }
}

/// A single RBJ biquad stage. Coefficients are recomputed off the RT path
/// (`activate` / `set_param`); `process` is a pure two-state recurrence.
pub struct BiquadNode {
    biquad: Biquad,
    sample_rate: f32,
    kind: FilterType,
    freq: f32,
    q: f32,
    gain_db: f32,
}

impl Default for BiquadNode {
    fn default() -> Self {
        Self::new()
    }
}

impl BiquadNode {
    pub fn new() -> Self {
        Self {
            biquad: Biquad::new(BiquadCoeffs::identity()),
            sample_rate: 48_000.0,
            kind: FilterType::Lowpass,
            freq: 1_000.0,
            q: 0.707,
            gain_db: 0.0,
        }
    }

    fn redesign(&mut self) {
        let c = BiquadCoeffs::design(self.kind, self.freq, self.q, self.gain_db, self.sample_rate);
        self.biquad.set_coeffs(c);
    }
}

impl DspInstance for BiquadNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        self.sample_rate = sample_rate.max(1.0);
        self.redesign();
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        let n = ctx.nframes.min(input.len()).min(output.len());
        for i in 0..n {
            output[i] = self.biquad.process(input[i]);
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        match id {
            biquad_param::TYPE => self.kind = biquad_type(value),
            biquad_param::FREQ => self.freq = value.clamp(1.0, self.sample_rate * 0.49),
            biquad_param::Q => self.q = value.max(0.01),
            biquad_param::GAIN_DB => self.gain_db = value,
            _ => return,
        }
        self.redesign();
    }

    fn reset(&mut self) {
        self.biquad.reset();
    }
}

// ===========================================================================
// Waveshaper distortion — `builtin.waveshaper`
// ===========================================================================

/// Stable manifest id for the built-in waveshaper.
pub const WAVESHAPER_ID: &str = "builtin.waveshaper";

/// Waveshaper param ids.
pub mod waveshaper_param {
    /// Drive / distortion amount, 0..1.
    pub const AMOUNT: u16 = 0;
    /// Output level (linear), applied after the curve.
    pub const LEVEL: u16 = 1;
}

/// Resolution of the precomputed distortion curve LUT (matches the TS default).
const WAVESHAPER_CURVE_SAMPLES: usize = 2_048;

fn waveshaper_manifest() -> PluginManifest {
    PluginManifest {
        id: String::from(WAVESHAPER_ID),
        name: String::from("Waveshaper"),
        kind: PrimitiveKind::Waveshaper,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: waveshaper_param::AMOUNT,
                name: String::from("amount"),
                min: 0.0,
                max: 1.0,
                default: 0.5,
            },
            ParamDecl {
                id: waveshaper_param::LEVEL,
                name: String::from("level"),
                min: 0.0,
                max: 2.0,
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

/// Loader/factory for [`WaveshaperNode`].
pub struct WaveshaperLoader {
    manifest: PluginManifest,
}

impl Default for WaveshaperLoader {
    fn default() -> Self {
        Self {
            manifest: waveshaper_manifest(),
        }
    }
}

impl WaveshaperLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for WaveshaperLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(WaveshaperNode::new())
    }
}

/// A LUT waveshaper. The curve is rebuilt off the RT path when `amount` changes
/// (`set_param` allocates a new LUT, never `process`). Output level is smoothed.
pub struct WaveshaperNode {
    shaper: Waveshaper,
    amount: f32,
    level: OnePole,
    level_target: f32,
}

impl Default for WaveshaperNode {
    fn default() -> Self {
        Self::new()
    }
}

impl WaveshaperNode {
    pub fn new() -> Self {
        Self {
            shaper: Waveshaper::new(0.5, WAVESHAPER_CURVE_SAMPLES),
            amount: 0.5,
            level: OnePole::new(1.0),
            level_target: 1.0,
        }
    }
}

impl DspInstance for WaveshaperNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        self.level.set_time(0.005, sample_rate);
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        let n = ctx.nframes.min(input.len()).min(output.len());
        for i in 0..n {
            let g = self.level.tick();
            output[i] = self.shaper.process(input[i]) * g;
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        match id {
            waveshaper_param::AMOUNT => {
                // Rebuild the LUT off the RT path (loaders/`set_param` may alloc).
                self.amount = value.clamp(0.0, 1.0);
                self.shaper = Waveshaper::new(self.amount, WAVESHAPER_CURVE_SAMPLES);
            }
            waveshaper_param::LEVEL => {
                self.level_target = value.max(0.0);
                self.level.set_target(self.level_target);
            }
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.level.snap(self.level_target);
    }
}

// ===========================================================================
// Feedback delay — `builtin.delay`
// ===========================================================================

/// Stable manifest id for the built-in delay.
pub const DELAY_ID: &str = "builtin.delay";

/// Delay param ids.
pub mod delay_param {
    /// Delay time, seconds.
    pub const TIME: u16 = 0;
    /// Feedback amount, 0..0.99.
    pub const FEEDBACK: u16 = 1;
    /// Wet/dry mix, 0 (dry) .. 1 (wet).
    pub const MIX: u16 = 2;
}

/// Maximum delay time the line is sized for (seconds).
const DELAY_MAX_SECONDS: f32 = 2.0;

fn delay_manifest() -> PluginManifest {
    PluginManifest {
        id: String::from(DELAY_ID),
        name: String::from("Delay"),
        kind: PrimitiveKind::Delay,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![
            ParamDecl {
                id: delay_param::TIME,
                name: String::from("time"),
                min: 0.0,
                max: DELAY_MAX_SECONDS,
                default: 0.25,
            },
            ParamDecl {
                id: delay_param::FEEDBACK,
                name: String::from("feedback"),
                min: 0.0,
                max: 0.99,
                default: 0.3,
            },
            ParamDecl {
                id: delay_param::MIX,
                name: String::from("mix"),
                min: 0.0,
                max: 1.0,
                default: 0.5,
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

/// Loader/factory for [`DelayNode`].
pub struct DelayLoader {
    manifest: PluginManifest,
}

impl Default for DelayLoader {
    fn default() -> Self {
        Self {
            manifest: delay_manifest(),
        }
    }
}

impl DelayLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for DelayLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(DelayNode::new(sample_rate))
    }
}

/// A feedback delay reusing [`DelayLine`]. The buffer is sized for
/// [`DELAY_MAX_SECONDS`] at `activate`; the read tap is the delay-time param in
/// samples, clamped into the line.
pub struct DelayNode {
    line: DelayLine,
    sample_rate: f32,
    time_seconds: f32,
    feedback: f32,
    mix: f32,
}

impl DelayNode {
    pub fn new(sample_rate: f32) -> Self {
        let sr = sample_rate.max(1.0);
        let max_samples = (sr * DELAY_MAX_SECONDS) as usize + 1;
        let mut line = DelayLine::new(max_samples);
        line.set(0.3, 0.5);
        Self {
            line,
            sample_rate: sr,
            time_seconds: 0.25,
            feedback: 0.3,
            mix: 0.5,
        }
    }

    #[inline]
    fn delay_samples(&self) -> usize {
        ((self.time_seconds * self.sample_rate) as usize).max(1)
    }
}

impl DspInstance for DelayNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        let sr = sample_rate.max(1.0);
        // Re-size the line for the new rate so the max delay time holds.
        let max_samples = (sr * DELAY_MAX_SECONDS) as usize + 1;
        self.line = DelayLine::new(max_samples);
        self.line.set(self.feedback, self.mix);
        self.sample_rate = sr;
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        let n = ctx.nframes.min(input.len()).min(output.len());
        let d = self.delay_samples();
        for i in 0..n {
            output[i] = self.line.process(input[i], d);
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        match id {
            delay_param::TIME => {
                self.time_seconds = value.clamp(0.0, DELAY_MAX_SECONDS);
            }
            delay_param::FEEDBACK => {
                self.feedback = value.clamp(0.0, 0.99);
                self.line.set(self.feedback, self.mix);
            }
            delay_param::MIX => {
                self.mix = value.clamp(0.0, 1.0);
                self.line.set(self.feedback, self.mix);
            }
            _ => {}
        }
    }

    fn reset(&mut self) {
        // Re-create the line (clears its buffer) and re-apply the mix/feedback.
        self.line = DelayLine::new((self.sample_rate * DELAY_MAX_SECONDS) as usize + 1);
        self.line.set(self.feedback, self.mix);
    }
}

// ===========================================================================
// Convolution reverb — `builtin.convolution`
// ===========================================================================

/// Stable manifest id for the built-in convolution (IR) reverb.
pub const CONVOLUTION_ID: &str = "builtin.convolution";

/// Convolution param ids.
pub mod convolution_param {
    /// Wet/dry mix, 0 (dry) .. 1 (wet).
    pub const MIX: u16 = 0;
}

/// Maximum IR length (taps) the convolution node is sized for. ~0.5 s at 48 kHz
/// — long enough for a small-room / plate IR while keeping the time-domain MAC
/// affordable on the RT path.
pub const CONVOLUTION_MAX_TAPS: usize = 24_000;

fn convolution_manifest() -> PluginManifest {
    PluginManifest {
        id: String::from(CONVOLUTION_ID),
        name: String::from("Convolution"),
        kind: PrimitiveKind::Convolution,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![ParamDecl {
            id: convolution_param::MIX,
            name: String::from("mix"),
            min: 0.0,
            max: 1.0,
            default: 0.5,
        }],
        ports: PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
        },
    }
}

/// Loader/factory for [`ConvolutionNode`].
pub struct ConvolutionLoader {
    manifest: PluginManifest,
}

impl Default for ConvolutionLoader {
    fn default() -> Self {
        Self {
            manifest: convolution_manifest(),
        }
    }
}

impl ConvolutionLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for ConvolutionLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(ConvolutionNode::new())
    }
}

/// An impulse-response convolution node reusing [`Convolver`].
///
/// ## IR-loading seam
/// Mirrors the Sampler's PCM seam: the convolution node does not decode files.
/// A host resolves the node's IR asset to already-decoded mono PCM off the RT
/// thread and installs it via [`ConvolutionNode::set_ir`] at graph-build / asset
/// -bind time. With no IR loaded the node is a clean passthrough (dry signal),
/// so an unbound convolution never silences the graph.
pub struct ConvolutionNode {
    conv: Convolver,
    mix: f32,
}

impl Default for ConvolutionNode {
    fn default() -> Self {
        Self::new()
    }
}

impl ConvolutionNode {
    pub fn new() -> Self {
        Self {
            conv: Convolver::new(CONVOLUTION_MAX_TAPS),
            mix: 0.5,
        }
    }

    /// Install the impulse response (the documented loading seam). Off the RT
    /// thread; IRs longer than [`CONVOLUTION_MAX_TAPS`] are truncated.
    pub fn set_ir(&mut self, ir: &[f32]) {
        self.conv.set_ir(ir);
    }

    /// Whether an IR is currently loaded.
    pub fn is_loaded(&self) -> bool {
        self.conv.is_loaded()
    }
}

impl DspInstance for ConvolutionNode {
    fn activate(&mut self, _sample_rate: f32, _max_block: usize) {}

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        // No IR -> dry passthrough (avoids a needless per-sample MAC).
        if !self.conv.is_loaded() {
            passthrough(ctx);
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        let n = ctx.nframes.min(input.len()).min(output.len());
        let wet = self.mix;
        let dry = 1.0 - wet;
        for i in 0..n {
            let x = input[i];
            output[i] = x * dry + self.conv.process(x) * wet;
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        if id == convolution_param::MIX {
            self.mix = value.clamp(0.0, 1.0);
        }
    }

    fn reset(&mut self) {
        self.conv.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::ProcessCtx;
    use alloc::vec::Vec;

    const SR: f32 = 48_000.0;
    const BLOCK: usize = 64;

    fn run_block(node: &mut dyn DspInstance, input: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0f32; input.len()];
        let ins: [&[f32]; 1] = [input];
        let mut outs: [&mut [f32]; 1] = [&mut out];
        let mut ctx = ProcessCtx {
            inputs: &ins,
            outputs: &mut outs,
            nframes: input.len(),
        };
        node.process(&mut ctx);
        out
    }

    #[test]
    fn biquad_lowpass_passes_dc_blocks_nyquist() {
        let mut node = BiquadNode::new();
        node.activate(SR, BLOCK);
        node.set_param(biquad_param::TYPE, 0.0); // lowpass
        node.set_param(biquad_param::FREQ, 1_000.0);
        node.set_param(biquad_param::Q, 0.707);
        // DC settles to ~unity.
        let dc = vec![1.0f32; 4_000];
        let out = run_block(&mut node, &dc);
        assert!((out[out.len() - 1] - 1.0).abs() < 1e-2, "dc gain off");
        // Nyquist (alternating) is attenuated.
        node.reset();
        let nyq: Vec<f32> = (0..4_000)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        let out = run_block(&mut node, &nyq);
        assert!(out[out.len() - 1].abs() < 0.1, "nyquist not attenuated");
    }

    #[test]
    fn waveshaper_zero_amount_is_clean() {
        let mut node = WaveshaperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(waveshaper_param::AMOUNT, 0.0);
        node.set_param(waveshaper_param::LEVEL, 1.0);
        node.reset(); // snap level smoother to target
        let input: Vec<f32> = (0..BLOCK).map(|i| ((i % 8) as f32 - 4.0) * 0.1).collect();
        let out = run_block(&mut node, &input);
        for (i, &x) in input.iter().enumerate() {
            assert!((out[i] - x).abs() < 0.02, "frame {i} not clean");
        }
    }

    #[test]
    fn waveshaper_high_amount_compresses_peaks() {
        let mut node = WaveshaperNode::new();
        node.activate(SR, BLOCK);
        node.set_param(waveshaper_param::AMOUNT, 1.0);
        node.set_param(waveshaper_param::LEVEL, 1.0);
        node.reset();
        let out = run_block(&mut node, &vec![1.0f32; BLOCK]);
        // Output is finite and bounded; distortion stays well-behaved.
        assert!(out.iter().all(|s| s.is_finite() && s.abs() <= 4.0));
    }

    #[test]
    fn delay_reproduces_impulse_after_time() {
        let mut node = DelayNode::new(SR);
        node.activate(SR, BLOCK);
        node.set_param(delay_param::FEEDBACK, 0.0);
        node.set_param(delay_param::MIX, 1.0); // full wet
        let time = 0.01; // 10 ms
        node.set_param(delay_param::TIME, time);
        let lag = (time * SR) as usize;
        let mut input = vec![0.0f32; lag + 64];
        input[0] = 1.0;
        let out = run_block(&mut node, &input);
        assert!((out[lag] - 1.0).abs() < 1e-3, "impulse not delayed by lag");
    }

    #[test]
    fn convolution_passthrough_without_ir() {
        let mut node = ConvolutionNode::new();
        node.activate(SR, BLOCK);
        let input: Vec<f32> = (0..BLOCK).map(|i| (i as f32) * 0.01).collect();
        let out = run_block(&mut node, &input);
        for (i, &x) in input.iter().enumerate() {
            assert!((out[i] - x).abs() < 1e-6, "no IR should be passthrough");
        }
    }

    #[test]
    fn convolution_identity_ir_full_wet_is_passthrough() {
        let mut node = ConvolutionNode::new();
        node.activate(SR, BLOCK);
        node.set_ir(&[1.0]); // identity kernel
        node.set_param(convolution_param::MIX, 1.0); // full wet
        assert!(node.is_loaded());
        let input: Vec<f32> = (0..BLOCK).map(|i| ((i % 5) as f32 - 2.0) * 0.2).collect();
        let out = run_block(&mut node, &input);
        for (i, &x) in input.iter().enumerate() {
            assert!(
                (out[i] - x).abs() < 1e-5,
                "identity IR should be passthrough"
            );
        }
    }

    /// Every effect tolerates empty buffers without panicking (RT degradation).
    #[test]
    fn effects_tolerate_empty_buffers() {
        let mut nodes: Vec<Box<dyn DspInstance>> = vec![
            Box::new(BiquadNode::new()),
            Box::new(WaveshaperNode::new()),
            Box::new(DelayNode::new(SR)),
            Box::new(ConvolutionNode::new()),
        ];
        for node in nodes.iter_mut() {
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
}
