//! The reference built-in: a smoothed gain. It proves the whole ABI end-to-end
//! — a [`PluginManifest`] (`DspKind::Builtin`, lowering to [`PrimitiveKind::Gain`]),
//! a [`PluginLoader`], and a [`DspInstance`] whose `process` is allocation-free
//! and reuses [`ojcore_dsp::OnePole`] for zipper-free gain changes.
//!
//! Built-in nodes are "just plugins": they register into the same
//! [`crate::PluginRegistry`] as Faust/WASM/hosted ones.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore_dsp::OnePole;
use ojproto::PrimitiveKind;

use crate::dsp::{DspInstance, ProcessCtx};
use crate::loader::PluginLoader;
use crate::manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};

/// Stable manifest id for the built-in gain.
pub const GAIN_ID: &str = "builtin.gain";
/// Param id for the gain multiplier (linear).
pub const GAIN_PARAM: u16 = 0;

/// Build the gain manifest (one param, one audio in/out).
fn gain_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(GAIN_ID),
        name: String::from("Gain"),
        kind: PrimitiveKind::Gain,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![ParamDecl {
            id: GAIN_PARAM,
            name: String::from("gain"),
            min: 0.0,
            max: 4.0,
            default: 1.0,
        }],
        ports: PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
        },
    }
}

/// Loader/factory for [`GainNode`].
pub struct GainLoader {
    manifest: PluginManifest,
}

impl Default for GainLoader {
    fn default() -> Self {
        Self {
            manifest: gain_manifest(),
        }
    }
}

impl GainLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for GainLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(GainNode::new())
    }
}

/// A smoothed linear gain. State is just the one-pole smoother — no per-block
/// allocation.
pub struct GainNode {
    gain: OnePole,
    /// Mirror of the smoother target so `reset` can snap onto it.
    target: f32,
}

impl Default for GainNode {
    fn default() -> Self {
        Self::new()
    }
}

impl GainNode {
    pub fn new() -> Self {
        // Start at unity; `activate` sets the smoothing time once we know SR.
        Self {
            gain: OnePole::new(1.0),
            target: 1.0,
        }
    }
}

impl DspInstance for GainNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        // ~5 ms smoothing: audibly instant, but zipper-free on param jumps.
        self.gain.set_time(0.005, sample_rate);
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        // Mono in -> mono out; tolerate missing channels gracefully.
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        let input = ctx.inputs[0];
        let output = &mut ctx.outputs[0];
        for i in 0..ctx.nframes {
            let g = self.gain.tick();
            output[i] = input[i] * g;
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        if id == GAIN_PARAM {
            self.target = value;
            self.gain.set_target(value);
        }
    }

    fn reset(&mut self) {
        // Jump immediately to the desired gain, discarding any in-flight ramp.
        self.gain.snap(self.target);
    }
}
