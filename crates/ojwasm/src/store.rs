//! Content-addressed store for authored code-node `.wasm` bytes.
//!
//! A code node is addressed by the OPEN manifest id `ai.wasm.<hash>`, where
//! `<hash>` is the FNV-1a (32-bit) of the `.wasm` bytes as 8-char lowercase hex —
//! the SAME content address the authoring side (`src-tauri/src/ai.rs`'s
//! `fnv1a_hex`) and the frontend `shortHash` use. This store keeps the bytes so a
//! graph node carrying that id can be resolved + instantiated by the host (fixing
//! the "authored bytes discarded" gap). It mirrors the native `AssetCatalog`
//! pattern but is keyed by the hex STRING id rather than an `AssetId(u32)` — a
//! code node's id lives in a string namespace, not the PCM asset space.

use std::collections::HashMap;
use std::fmt;

/// FNV-1a (32-bit) of `bytes` as 8-char lowercase hex.
///
/// Must stay byte-identical to the authoring hash so an `ai.wasm.<hash>` graph
/// node resolves here. FNV-1a/32: offset basis `0x811c9dc5`, prime `0x01000193`.
pub fn fnv1a_hex(bytes: &[u8]) -> String {
    const OFFSET: u32 = 0x811c_9dc5;
    const PRIME: u32 = 0x0100_0193;
    let mut h = OFFSET;
    for &b in bytes {
        h ^= b as u32;
        h = h.wrapping_mul(PRIME);
    }
    format!("{h:08x}")
}

/// The full manifest id a code node with the given `.wasm` bytes is addressed by:
/// `"ai.wasm." + fnv1a_hex(bytes)`.
pub fn wasm_id_for(bytes: &[u8]) -> String {
    format!("ai.wasm.{}", fnv1a_hex(bytes))
}

/// An error inserting into the [`WasmStore`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WasmStoreError {
    /// Two DIFFERENT byte strings content-addressed to the same `ai.wasm.<hash>`
    /// id. The store keeps the first bytes and surfaces this rather than silently
    /// aliasing two distinct modules (an 8-char/32-bit hash is collidable, so the
    /// store keeps bytes and detects rather than trusting the hash blindly).
    HashCollision(String),
}

impl fmt::Display for WasmStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WasmStoreError::HashCollision(id) => {
                write!(
                    f,
                    "wasm hash collision for id {id}: different bytes share one address"
                )
            }
        }
    }
}

impl std::error::Error for WasmStoreError {}

/// A content-addressed, deduplicating store of authored `.wasm` modules keyed by
/// their `ai.wasm.<hash>` id.
#[derive(Debug, Default)]
pub struct WasmStore {
    modules: HashMap<String, Vec<u8>>,
}

impl WasmStore {
    /// A fresh, empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert `bytes`, returning the `ai.wasm.<hash>` id they address to.
    ///
    /// Idempotent: identical bytes return the same id without a second copy. A
    /// genuine hash collision (same id, different bytes) keeps the FIRST bytes and
    /// returns [`WasmStoreError::HashCollision`].
    pub fn insert(&mut self, bytes: Vec<u8>) -> Result<String, WasmStoreError> {
        let id = wasm_id_for(&bytes);
        match self.modules.get(&id) {
            Some(existing) if existing.as_slice() != bytes.as_slice() => {
                Err(WasmStoreError::HashCollision(id))
            }
            Some(_) => Ok(id), // identical bytes already present — dedup
            None => {
                self.modules.insert(id.clone(), bytes);
                Ok(id)
            }
        }
    }

    /// Resolve a stored module's bytes by its `ai.wasm.<hash>` id.
    pub fn resolve(&self, id: &str) -> Option<&[u8]> {
        self.modules.get(id).map(Vec::as_slice)
    }

    /// Whether `id` is stored.
    pub fn contains(&self, id: &str) -> bool {
        self.modules.contains_key(id)
    }

    /// Number of distinct modules stored.
    pub fn len(&self) -> usize {
        self.modules.len()
    }

    /// True when no modules are stored.
    pub fn is_empty(&self) -> bool {
        self.modules.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_empty_is_offset_basis() {
        // The canonical FNV-1a/32 vector: the empty input hashes to the offset
        // basis 0x811c9dc5. This pins the algorithm against the authoring side.
        assert_eq!(fnv1a_hex(b""), "811c9dc5");
        assert_eq!(wasm_id_for(b""), "ai.wasm.811c9dc5");
    }

    #[test]
    fn fnv1a_is_deterministic_8hex_and_distinguishes_inputs() {
        let a = fnv1a_hex(b"\x00\x01gain-kernel");
        let b = fnv1a_hex(b"\x00\x01gain-kernel");
        let c = fnv1a_hex(b"\x00\x01gain-kerneL");
        assert_eq!(a, b, "deterministic");
        assert_eq!(a.len(), 8, "8-char hex");
        assert!(a
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()));
        assert_ne!(a, c, "a one-byte change yields a different address");
    }

    #[test]
    fn insert_resolve_and_dedup() {
        let mut store = WasmStore::new();
        let bytes = b"\x00asm\x01\x00\x00\x00module-A".to_vec();
        let id = store.insert(bytes.clone()).unwrap();
        assert_eq!(id, wasm_id_for(&bytes));
        assert_eq!(store.resolve(&id), Some(bytes.as_slice()));
        assert!(store.contains(&id));
        // Re-inserting identical bytes dedups (same id, still one module).
        let id2 = store.insert(bytes.clone()).unwrap();
        assert_eq!(id, id2);
        assert_eq!(store.len(), 1);
        assert_eq!(store.resolve("ai.wasm.deadbeef"), None);
    }
}
