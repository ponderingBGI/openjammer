//! The stereo panner — the first built-in node with a 2-channel audio output.
//!
//! A `Pan` node takes one mono audio input and produces a 2-channel (L/R) output,
//! placing the signal in the stereo field by a single `pan` parameter in `[-1, 1]`
//! (−1 = hard left, 0 = centre, +1 = hard right). The L/R gains are smoothed with
//! the shared [`ojcore_dsp::OnePole`] so a pan move never clicks. Allocation-free;
//! it is the canonical example of a stereo built-in (`docs/CHANNELS.md`) — it
//! declares `audio_out_channels = 2`, and the engine routes both lanes downstream.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore_dsp::OnePole;
use ojproto::PrimitiveKind;

use crate::dsp::{DspInstance, ProcessCtx};
use crate::loader::PluginLoader;
use crate::manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};

/// Stable manifest id for the built-in stereo panner.
pub const PAN_ID: &str = "builtin.pan";

/// Parameter ids for [`PanNode`].
pub mod pan_param {
    /// Stereo position, `[-1, 1]` (−1 = hard left, 0 = centre, +1 = hard right).
    pub const PAN: u16 = 0;
}

/// The equal-power (constant-power) L/R gains for a pan position `p`. `p` is clamped
/// to `[-1, 1]`; the gains trace a quarter cosine/sine so perceived loudness stays
/// constant across the sweep — no centre dip. Centre is `(0.707, 0.707)`, hard left
/// `(1.0, 0.0)`, hard right `(0.0, 1.0)`. θ runs `[0, π/2]` as `p` runs `[-1, 1]`.
#[inline]
fn pan_gains(p: f32) -> (f32, f32) {
    let p = p.clamp(-1.0, 1.0);
    let theta = (p + 1.0) * core::f32::consts::FRAC_PI_4;
    (libm::cosf(theta), libm::sinf(theta))
}

/// Build the pan manifest: one mono audio in, a 2-channel audio out, one param.
fn pan_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(PAN_ID),
        name: String::from("Pan"),
        kind: PrimitiveKind::Pan,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![ParamDecl {
            module: String::new(),
            unit: String::new(),
            flags: 0,
            id: pan_param::PAN,
            name: String::from("pan"),
            min: -1.0,
            max: 1.0,
            default: 0.0,
        }],
        ports: PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 1,
            audio_out_channels: 2,
        },
    }
}

/// Loader/factory for [`PanNode`].
pub struct PanLoader {
    manifest: PluginManifest,
}

impl Default for PanLoader {
    fn default() -> Self {
        Self {
            manifest: pan_manifest(),
        }
    }
}

impl PanLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for PanLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(PanNode::new())
    }
}

/// A smoothed stereo panner. State is the two one-pole gain smoothers; `process`
/// allocates nothing.
pub struct PanNode {
    left: OnePole,
    right: OnePole,
    /// Mirror of the smoother targets so `reset` can snap onto them.
    target: (f32, f32),
}

impl Default for PanNode {
    fn default() -> Self {
        Self::new()
    }
}

impl PanNode {
    pub fn new() -> Self {
        let (l, r) = pan_gains(0.0); // centre
        Self {
            left: OnePole::new(l),
            right: OnePole::new(r),
            target: (l, r),
        }
    }
}

impl DspInstance for PanNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        // ~5 ms smoothing: audibly instant, zipper-free on a pan move.
        self.left.set_time(0.005, sample_rate);
        self.right.set_time(0.005, sample_rate);
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.inputs.is_empty() || ctx.outputs.is_empty() {
            return;
        }
        // `input` is the mono source (lifetime independent of `ctx`, so writing the
        // output lanes below does not conflict — the ProcessCtx split lifetimes).
        let input = ctx.inputs[0];
        let stereo = ctx.outputs.len() >= 2;
        for f in 0..ctx.nframes {
            let s = input.get(f).copied().unwrap_or(0.0);
            let lg = self.left.tick();
            let rg = self.right.tick();
            if f < ctx.outputs[0].len() {
                ctx.outputs[0][f] = s * lg;
            }
            if stereo && f < ctx.outputs[1].len() {
                ctx.outputs[1][f] = s * rg;
            }
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        if id == pan_param::PAN {
            let (l, r) = pan_gains(value);
            self.target = (l, r);
            self.left.set_target(l);
            self.right.set_target(r);
        }
    }

    fn reset(&mut self) {
        self.left.snap(self.target.0);
        self.right.snap(self.target.1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    const SR: f32 = 48_000.0;
    const BLOCK: usize = 64;

    fn render(node: &mut PanNode, input: &[f32]) -> (vec::Vec<f32>, vec::Vec<f32>) {
        let mut l = vec![0.0f32; input.len()];
        let mut r = vec![0.0f32; input.len()];
        {
            let ins: [&[f32]; 1] = [input];
            let mut outs: [&mut [f32]; 2] = [&mut l, &mut r];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: input.len(),
            };
            node.process(&mut ctx);
        }
        (l, r)
    }

    #[test]
    fn centre_is_equal_power() {
        let mut node = PanNode::new();
        node.activate(SR, BLOCK);
        node.set_param(pan_param::PAN, 0.0);
        node.reset(); // snap so there is no ramp to wait out
        let input = vec![1.0f32; BLOCK];
        let (l, r) = render(&mut node, &input);
        // Equal-power centre: both channels at cos(π/4) = 1/√2 ≈ 0.7071 (no −3 dB dip).
        let centre = core::f32::consts::FRAC_1_SQRT_2;
        for i in 0..BLOCK {
            assert!((l[i] - centre).abs() < 1e-4, "L@{i}");
            assert!((r[i] - centre).abs() < 1e-4, "R@{i}");
        }
    }

    #[test]
    fn hard_left_and_hard_right() {
        let input = vec![1.0f32; BLOCK];

        let mut left = PanNode::new();
        left.activate(SR, BLOCK);
        left.set_param(pan_param::PAN, -1.0);
        left.reset();
        let (l, r) = render(&mut left, &input);
        assert!(
            l.iter().all(|&x| (x - 1.0).abs() < 1e-4),
            "hard left: L = signal"
        );
        assert!(r.iter().all(|&x| x.abs() < 1e-4), "hard left: R silent");

        let mut right = PanNode::new();
        right.activate(SR, BLOCK);
        right.set_param(pan_param::PAN, 1.0);
        right.reset();
        let (l, r) = render(&mut right, &input);
        assert!(l.iter().all(|&x| x.abs() < 1e-4), "hard right: L silent");
        assert!(
            r.iter().all(|&x| (x - 1.0).abs() < 1e-4),
            "hard right: R = signal"
        );
    }

    #[test]
    fn manifest_is_a_stereo_out_node() {
        let m = PanLoader::new();
        let ports = m.manifest().ports;
        assert_eq!(ports.audio_in, 1);
        assert_eq!(ports.audio_in_channels, 1);
        assert_eq!(ports.audio_out, 1);
        assert_eq!(
            ports.audio_out_channels, 2,
            "Pan is the canonical stereo-out node"
        );
        assert_eq!(m.manifest().kind, PrimitiveKind::Pan);
    }
}
