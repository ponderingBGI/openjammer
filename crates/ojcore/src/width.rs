//! The stereo width node — the first built-in with a 2-channel audio INPUT.
//!
//! `Width` takes a 2-channel (L/R) input and re-images it with a single `width`
//! parameter via mid/side processing: `mid = (L+R)/2`, `side = (L-R)/2 · width`,
//! `L' = mid + side`, `R' = mid - side`. `width = 0` collapses to mono (centre),
//! `1` is unchanged, `> 1` widens the stereo image. The width is smoothed with the
//! shared [`ojcore_dsp::OnePole`] so a move never clicks. Allocation-free.
//!
//! It is the canonical example of a stereo-INPUT built-in (`docs/CHANNELS.md`): it
//! declares `audio_in_channels = 2`, so the engine's general lane-aware mix hands
//! its `process` BOTH input lanes (e.g. fed by a `Pan` node upstream).

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec;

use ojcore_dsp::OnePole;
use ojproto::PrimitiveKind;

use crate::dsp::{DspInstance, ProcessCtx};
use crate::loader::PluginLoader;
use crate::manifest::{DspKind, ParamDecl, PluginManifest, PortDecl, UiKind};

/// Stable manifest id for the built-in stereo width node.
pub const WIDTH_ID: &str = "builtin.width";

/// Parameter ids for [`WidthNode`].
pub mod width_param {
    /// Stereo width, `[0, 2]` (0 = mono/centre, 1 = unchanged, 2 = extra-wide).
    pub const WIDTH: u16 = 0;
}

/// Build the width manifest: a 2-channel audio in, a 2-channel audio out, one param.
fn width_manifest() -> PluginManifest {
    PluginManifest {
        abi: None,
        id: String::from(WIDTH_ID),
        name: String::from("Width"),
        kind: PrimitiveKind::Width,
        dsp: DspKind::Builtin,
        ui: UiKind::Auto,
        params: vec![ParamDecl {
            module: String::new(),
            unit: String::new(),
            flags: 0,
            id: width_param::WIDTH,
            name: String::from("width"),
            min: 0.0,
            max: 2.0,
            default: 1.0,
        }],
        ports: PortDecl {
            audio_in: 1,
            audio_out: 1,
            control_in: 0,
            control_out: 0,
            audio_in_channels: 2,
            audio_out_channels: 2,
        },
    }
}

/// Loader/factory for [`WidthNode`].
pub struct WidthLoader {
    manifest: PluginManifest,
}

impl Default for WidthLoader {
    fn default() -> Self {
        Self {
            manifest: width_manifest(),
        }
    }
}

impl WidthLoader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl PluginLoader for WidthLoader {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn instantiate(&self, _sample_rate: f32, _max_block: usize) -> Box<dyn DspInstance> {
        Box::new(WidthNode::new())
    }
}

/// A smoothed mid/side stereo width processor. State is the one width smoother;
/// `process` allocates nothing.
pub struct WidthNode {
    width: OnePole,
    /// Mirror of the smoother target so `reset` can snap onto it.
    target: f32,
}

impl Default for WidthNode {
    fn default() -> Self {
        Self::new()
    }
}

impl WidthNode {
    pub fn new() -> Self {
        Self {
            width: OnePole::new(1.0), // unity (unchanged image)
            target: 1.0,
        }
    }
}

impl DspInstance for WidthNode {
    fn activate(&mut self, sample_rate: f32, _max_block: usize) {
        // ~5 ms smoothing: audibly instant, zipper-free on a width move.
        self.width.set_time(0.005, sample_rate);
    }

    fn process(&mut self, ctx: &mut ProcessCtx<'_, '_>) {
        if ctx.outputs.is_empty() {
            return;
        }
        // Stereo input lanes 0 (L) and 1 (R); the slices' lifetime is independent of
        // `ctx`, so writing the outputs below does not conflict. A mono input feeds
        // both (then side == 0 and width has no effect — a sane degrade).
        let l_in = ctx.inputs.first().copied().unwrap_or(&[]);
        let r_in = ctx.inputs.get(1).copied().unwrap_or(l_in);
        let stereo_out = ctx.outputs.len() >= 2;
        for f in 0..ctx.nframes {
            let l = l_in.get(f).copied().unwrap_or(0.0);
            let r = r_in.get(f).copied().unwrap_or(0.0);
            let w = self.width.tick();
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5 * w;
            if f < ctx.outputs[0].len() {
                ctx.outputs[0][f] = mid + side;
            }
            if stereo_out && f < ctx.outputs[1].len() {
                ctx.outputs[1][f] = mid - side;
            }
        }
    }

    fn set_param(&mut self, id: u16, value: f32) {
        if id == width_param::WIDTH {
            let w = value.clamp(0.0, 2.0);
            self.target = w;
            self.width.set_target(w);
        }
    }

    fn reset(&mut self) {
        self.width.snap(self.target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    const SR: f32 = 48_000.0;
    const BLOCK: usize = 64;

    /// Render one block of an explicit L/R pair through the node at a settled width.
    fn render(node: &mut WidthNode, l: &[f32], r: &[f32]) -> (vec::Vec<f32>, vec::Vec<f32>) {
        let mut lo = vec![0.0f32; l.len()];
        let mut ro = vec![0.0f32; r.len()];
        {
            let ins: [&[f32]; 2] = [l, r];
            let mut outs: [&mut [f32]; 2] = [&mut lo, &mut ro];
            let mut ctx = ProcessCtx {
                inputs: &ins,
                outputs: &mut outs,
                nframes: l.len(),
            };
            node.process(&mut ctx);
        }
        (lo, ro)
    }

    #[test]
    fn unity_width_is_transparent() {
        let mut node = WidthNode::new();
        node.activate(SR, BLOCK);
        node.set_param(width_param::WIDTH, 1.0);
        node.reset();
        let l: vec::Vec<f32> = (0..BLOCK).map(|i| (i as f32) * 0.01 - 0.3).collect();
        let r: vec::Vec<f32> = (0..BLOCK).map(|i| 0.2 - (i as f32) * 0.005).collect();
        let (lo, ro) = render(&mut node, &l, &r);
        for i in 0..BLOCK {
            assert!((lo[i] - l[i]).abs() < 1e-5, "L@{i} transparent");
            assert!((ro[i] - r[i]).abs() < 1e-5, "R@{i} transparent");
        }
    }

    #[test]
    fn zero_width_collapses_to_mono() {
        let mut node = WidthNode::new();
        node.activate(SR, BLOCK);
        node.set_param(width_param::WIDTH, 0.0);
        node.reset();
        let l = vec![1.0f32; BLOCK];
        let r = vec![-0.4f32; BLOCK];
        let (lo, ro) = render(&mut node, &l, &r);
        // width 0 => side = 0 => both channels carry the mid (L+R)/2 = 0.3.
        for i in 0..BLOCK {
            assert!((lo[i] - 0.3).abs() < 1e-5, "L@{i} == mid");
            assert!((ro[i] - 0.3).abs() < 1e-5, "R@{i} == mid");
        }
    }

    #[test]
    fn manifest_is_a_stereo_in_out_node() {
        let m = WidthLoader::new();
        let ports = m.manifest().ports;
        assert_eq!(ports.audio_in, 1);
        assert_eq!(
            ports.audio_in_channels, 2,
            "Width is the canonical stereo-IN node"
        );
        assert_eq!(ports.audio_out, 1);
        assert_eq!(ports.audio_out_channels, 2);
        assert_eq!(m.manifest().kind, PrimitiveKind::Width);
    }
}
