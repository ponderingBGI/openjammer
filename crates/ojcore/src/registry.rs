//! The plugin registry: the OPEN side of the open/closed split. It maps each
//! manifest `id` (an arbitrary string) to its [`PluginLoader`], and lowers an
//! `id` to the CLOSED [`PrimitiveKind`] the RT loop matches on. Compilation asks
//! the registry `lower(manifest_id)` to fill `IrNode::kind` without ever
//! editing the primitive enum.

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::string::String;

use ojproto::PrimitiveKind;

use crate::loader::PluginLoader;

/// A string-keyed table of registered plugin loaders. Deterministic iteration
/// order (`BTreeMap`) so manifest enumeration is stable for the UI.
#[derive(Default)]
pub struct PluginRegistry {
    loaders: BTreeMap<String, Box<dyn PluginLoader>>,
}

impl PluginRegistry {
    /// A fresh, empty registry.
    pub fn new() -> Self {
        Self { loaders: BTreeMap::new() }
    }

    /// Register a loader under its own `manifest().id`. Returns the previously
    /// registered loader for that id, if any (last registration wins).
    pub fn register(&mut self, loader: Box<dyn PluginLoader>) -> Option<Box<dyn PluginLoader>> {
        let id = loader.manifest().id.clone();
        self.loaders.insert(id, loader)
    }

    /// Borrow the loader registered under `id`, if present.
    pub fn get(&self, id: &str) -> Option<&dyn PluginLoader> {
        self.loaders.get(id).map(|b| b.as_ref())
    }

    /// Whether a loader is registered under `id`.
    pub fn contains(&self, id: &str) -> bool {
        self.loaders.contains_key(id)
    }

    /// Number of registered loaders.
    pub fn len(&self) -> usize {
        self.loaders.len()
    }

    /// Whether the registry holds no loaders.
    pub fn is_empty(&self) -> bool {
        self.loaders.is_empty()
    }

    /// Iterate registered manifest ids in sorted order.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.loaders.keys().map(String::as_str)
    }

    /// Lower an OPEN manifest id to the CLOSED [`PrimitiveKind`] the RT loop
    /// matches on. `None` if `id` is not registered.
    pub fn lower(&self, manifest_id: &str) -> Option<PrimitiveKind> {
        self.get(manifest_id).map(|l| l.manifest().kind)
    }
}
