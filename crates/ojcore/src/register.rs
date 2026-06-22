//! The ONE shared registration path for `ojcore`'s built-in node set.
//!
//! Both engine targets — the native host (`src-tauri`) and the `wasm32`
//! AudioWorklet (`ojcore-wasm`) — register the SAME built-in effects and
//! structural nodes through [`register_builtins`]. Neither hand-lists loaders
//! anymore, so the two registries can never drift (zero duplication).
//!
//! Instruments live in `ojinstrument` (which depends on this crate), so the
//! full common set is composed there by `ojinstrument::register_all`, which
//! calls this function first and then adds Osc / Sampler / Karplus / (SF2).

use alloc::boxed::Box;

use crate::builtin::GainLoader;
use crate::effects::{BiquadLoader, ConvolutionLoader, DelayLoader, WaveshaperLoader};
use crate::looper::LooperLoader;
use crate::registry::PluginRegistry;
use crate::structural::StructuralLoader;

/// Knobs for [`register_builtins`] so the two targets can request the same set
/// with small, explicit differences. All default to the full set.
#[derive(Debug, Clone, Copy)]
pub struct BuiltinOpts {
    /// Register the structural / routing boundary nodes (GraphIn / GraphOut /
    /// MicIn / SpeakerOut / Add / Passthrough). On by default; a host that mints
    /// its own boundary can turn this off.
    pub structural: bool,
    /// Register the DSP effects (gain / biquad / waveshaper / delay /
    /// convolution). On by default.
    pub effects: bool,
}

impl Default for BuiltinOpts {
    fn default() -> Self {
        Self {
            structural: true,
            effects: true,
        }
    }
}

impl BuiltinOpts {
    /// The full set (both effects and structural). Same as [`Default`].
    pub fn full() -> Self {
        Self::default()
    }
}

/// Register `ojcore`'s built-in effects and structural nodes into `reg`.
///
/// This is the single registration path for the effect + routing half of the
/// common built-in set; instruments are added on top by
/// `ojinstrument::register_all`. Registers (when enabled by `opts`):
///
/// * effects:    `builtin.gain`, `builtin.biquad`, `builtin.waveshaper`,
///   `builtin.delay`, `builtin.convolution`, `builtin.looper`
/// * structural: `host.graph_in`, `host.mic_in`, `host.graph_out`,
///   `host.speaker_out`, `builtin.add`, `builtin.subtract`, `builtin.passthrough`
pub fn register_builtins(reg: &mut PluginRegistry, opts: BuiltinOpts) {
    if opts.effects {
        reg.register(Box::new(GainLoader::new()));
        reg.register(Box::new(BiquadLoader::new()));
        reg.register(Box::new(WaveshaperLoader::new()));
        reg.register(Box::new(DelayLoader::new()));
        reg.register(Box::new(ConvolutionLoader::new()));
        // U-STATEFUL: the looper rides the SAME shared path, so it appears in
        // both the native and wasm registries (no_std -> wasm-safe).
        reg.register(Box::new(LooperLoader::new()));
    }
    if opts.structural {
        reg.register(Box::new(StructuralLoader::graph_in()));
        reg.register(Box::new(StructuralLoader::mic_in()));
        reg.register(Box::new(StructuralLoader::graph_out()));
        reg.register(Box::new(StructuralLoader::speaker_out()));
        reg.register(Box::new(StructuralLoader::add()));
        reg.register(Box::new(StructuralLoader::subtract()));
        reg.register(Box::new(StructuralLoader::passthrough()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtin::GAIN_ID;
    use crate::effects::{BIQUAD_ID, CONVOLUTION_ID, DELAY_ID, WAVESHAPER_ID};
    use crate::looper::LOOPER_ID;
    use crate::structural::{
        ADD_ID, GRAPH_IN_ID, GRAPH_OUT_ID, MIC_IN_ID, PASSTHROUGH_ID, SPEAKER_OUT_ID, SUBTRACT_ID,
    };

    /// The shared path registers exactly the expected built-in id set.
    #[test]
    fn register_builtins_populates_expected_ids() {
        let mut reg = PluginRegistry::new();
        register_builtins(&mut reg, BuiltinOpts::full());

        for id in [
            GAIN_ID,
            BIQUAD_ID,
            WAVESHAPER_ID,
            DELAY_ID,
            CONVOLUTION_ID,
            LOOPER_ID,
            GRAPH_IN_ID,
            MIC_IN_ID,
            GRAPH_OUT_ID,
            SPEAKER_OUT_ID,
            ADD_ID,
            SUBTRACT_ID,
            PASSTHROUGH_ID,
        ] {
            assert!(reg.contains(id), "missing built-in id: {id}");
        }
        // 6 effects (incl. looper) + 7 structural == 13 loaders.
        assert_eq!(reg.len(), 13);
    }

    /// Opting structural off registers effects only (and vice versa).
    #[test]
    fn opts_gate_each_half() {
        let mut effects_only = PluginRegistry::new();
        register_builtins(
            &mut effects_only,
            BuiltinOpts {
                structural: false,
                effects: true,
            },
        );
        assert!(effects_only.contains(GAIN_ID));
        assert!(effects_only.contains(LOOPER_ID));
        assert!(!effects_only.contains(SPEAKER_OUT_ID));
        assert_eq!(effects_only.len(), 6);

        let mut structural_only = PluginRegistry::new();
        register_builtins(
            &mut structural_only,
            BuiltinOpts {
                structural: true,
                effects: false,
            },
        );
        assert!(structural_only.contains(SPEAKER_OUT_ID));
        assert!(structural_only.contains(SUBTRACT_ID));
        assert!(!structural_only.contains(GAIN_ID));
        assert_eq!(structural_only.len(), 7);
    }

    /// Every registered manifest lowers to its closed primitive kind.
    #[test]
    fn registered_ids_lower_to_kinds() {
        use ojproto::PrimitiveKind;
        let mut reg = PluginRegistry::new();
        register_builtins(&mut reg, BuiltinOpts::full());
        assert_eq!(reg.lower(GAIN_ID), Some(PrimitiveKind::Gain));
        assert_eq!(reg.lower(BIQUAD_ID), Some(PrimitiveKind::Biquad));
        assert_eq!(reg.lower(WAVESHAPER_ID), Some(PrimitiveKind::Waveshaper));
        assert_eq!(reg.lower(DELAY_ID), Some(PrimitiveKind::Delay));
        assert_eq!(reg.lower(CONVOLUTION_ID), Some(PrimitiveKind::Convolution));
        assert_eq!(reg.lower(LOOPER_ID), Some(PrimitiveKind::Looper));
        assert_eq!(reg.lower(SPEAKER_OUT_ID), Some(PrimitiveKind::SpeakerOut));
    }
}
