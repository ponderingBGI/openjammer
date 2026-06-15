//! A [`PluginLoader`] is the factory side of "everything is a plugin": it owns
//! a [`PluginManifest`] and knows how to mint live [`DspInstance`]s from it. The
//! registry stores `Box<dyn PluginLoader>` keyed by `manifest.id`, so built-in,
//! Faust, WASM, and hosted backends are discovered and instantiated uniformly.

use alloc::boxed::Box;

use crate::dsp::DspInstance;
use crate::manifest::PluginManifest;

/// Static description + factory for one node type. `Send + Sync` so a single
/// shared registry can hand out instances from any thread.
pub trait PluginLoader: Send + Sync {
    /// The static manifest for the node type this loader produces.
    fn manifest(&self) -> &PluginManifest;

    /// Mint a fresh, not-yet-activated instance. The caller is responsible for
    /// calling [`DspInstance::activate`] before the first `process`; passing the
    /// rate/block here lets loaders that must size at construction do so too.
    fn instantiate(&self, sample_rate: f32, max_block: usize) -> Box<dyn DspInstance>;
}
