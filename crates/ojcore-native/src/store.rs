//! Content-addressed PCM asset store — the off-RT-thread side that the engine's
//! [`AssetId`] handles point at.
//!
//! # Why content addressing
//!
//! [`AssetId`] is a `u32` handle baked into the IR. We derive
//! that handle from the *content* of the decoded [`Pcm`] (its samples + spec),
//! not from a load counter, so that:
//!
//! * the same audio loaded twice (different paths, same bytes, or the same file
//!   loaded in two sessions) maps to the SAME id — identical samples are stored
//!   exactly once (zero duplication);
//! * ids are deterministic and reproducible: a given `Pcm` always hashes to the
//!   same `AssetId`, in this run and the next, so a serialized graph that refers
//!   to `AssetId(n)` resolves to the same audio after a reload.
//!
//! The hash is a pinned, self-contained 64-bit **FNV-1a** folded to `u32`
//! (governing principle: obsessive minimalism / zero new deps). It is *not*
//! cryptographic — it is a fast, stable fingerprint for deduplication, and the
//! store keeps the full `Pcm` so the (astronomically unlikely) 32-bit collision
//! of two genuinely different samples is the only failure mode, which we detect
//! and surface rather than silently alias (see [`AssetCatalog::insert`]).
//!
//! # How the engine / instruments fetch a `Pcm` by `AssetId`
//!
//! This store is **off the realtime thread**. The RT audio callback never calls
//! into it. The intended flow is:
//!
//! 1. Off RT (load / compile time): the host calls [`AssetCatalog::load_path`]
//!    or [`AssetCatalog::load_bytes`] (or [`AssetCatalog::insert`] for already
//!    decoded / captured PCM). It gets back an [`AssetId`], which is written
//!    into the IR as an [`AssetRef`](ojproto::AssetRef) on the relevant node.
//! 2. Off RT (program build, before the swap): for each node carrying an
//!    `AssetRef`, the builder calls [`AssetCatalog::resolve`] to borrow the
//!    decoded `&Pcm`, then hands the instrument an owned/shared copy of the
//!    sample buffer (e.g. an `Arc<[f32]>`) inside its constructed `DspInstance`.
//! 3. On RT: the instrument reads from the buffer it was given at construction.
//!    No hashing, no map lookup, no allocation, no decode ever happens on the
//!    audio thread — the catalog exists purely to resolve a handle into already
//!    decoded samples *before* the program is installed.
//!
//! The catalog is in-memory and **eviction-free**: once an asset is inserted it
//! stays for the lifetime of the catalog. Audio assets are few and small
//! relative to a session; deduplication keeps the footprint to one copy per
//! distinct sample, and a graph can be re-resolved at any time.

use std::collections::HashMap;

use ojproto::AssetId;

use crate::asset::{AssetError, AssetStore, Pcm};

/// FNV-1a 64-bit offset basis (pinned constant — do not change; it would shift
/// every [`AssetId`] and break previously serialized graphs).
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
/// FNV-1a 64-bit prime (pinned constant — see [`FNV_OFFSET`]).
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Mix a single byte into a running FNV-1a hash.
#[inline]
fn fnv1a_byte(hash: u64, byte: u8) -> u64 {
    (hash ^ byte as u64).wrapping_mul(FNV_PRIME)
}

/// Compute the deterministic content address of a decoded [`Pcm`].
///
/// The fingerprint covers the spec (`channels`, `sample_rate`) AND every sample
/// byte, so two buffers with identical samples but different rates/layouts get
/// distinct ids. Samples are hashed via their IEEE-754 little-endian bytes:
/// bit-exact, platform-stable, and (because we hash raw bits) `-0.0` and `+0.0`
/// are treated as the distinct values they are.
///
/// The 64-bit FNV-1a result is folded to the `u32` [`AssetId`] domain by XORing
/// its halves, which preserves entropy from both ends of the hash.
pub fn content_address(pcm: &Pcm) -> AssetId {
    let mut h = FNV_OFFSET;
    // Spec first, so a respec of identical samples changes the id.
    for b in pcm.channels.to_le_bytes() {
        h = fnv1a_byte(h, b);
    }
    for b in pcm.sample_rate.to_le_bytes() {
        h = fnv1a_byte(h, b);
    }
    for &s in &pcm.samples {
        for b in s.to_le_bytes() {
            h = fnv1a_byte(h, b);
        }
    }
    AssetId((h ^ (h >> 32)) as u32)
}

/// In-memory, content-addressed, eviction-free store of decoded [`Pcm`].
///
/// Owns an [`AssetStore`] for WAV decode/encode so callers have a single object
/// to manage assets through (load, capture-write, resolve). Cloning a catalog
/// is a deep copy of every stored `Pcm`; share a single catalog (e.g. behind an
/// `Arc<Mutex<_>>`) across the off-RT load/compile path instead of cloning.
#[derive(Debug, Default, Clone)]
pub struct AssetCatalog {
    codec: AssetStore,
    by_id: HashMap<AssetId, Pcm>,
}

impl AssetCatalog {
    /// An empty catalog.
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of distinct stored assets.
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// True when nothing has been stored yet.
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    /// True if `id` is present in the catalog.
    pub fn contains(&self, id: AssetId) -> bool {
        self.by_id.contains_key(&id)
    }

    /// Store a decoded [`Pcm`], returning its content-addressed [`AssetId`].
    ///
    /// Deduplicating: if an identical `Pcm` is already stored (same id AND equal
    /// content) the existing entry is kept and no new copy is made — the input
    /// is dropped. If the id is present but the stored content differs, that is
    /// a genuine 32-bit hash collision between two distinct samples; rather than
    /// silently aliasing one to the other we surface it as
    /// [`AssetError::Decode`] so the caller can react (the realistic fix being a
    /// trivial perturbation of one buffer). This never happens for normal audio.
    pub fn insert(&mut self, pcm: Pcm) -> Result<AssetId, AssetError> {
        let id = content_address(&pcm);
        match self.by_id.get(&id) {
            Some(existing) if *existing == pcm => Ok(id),
            Some(_) => Err(AssetError::Decode(format!(
                "asset hash collision on {id:?}: two distinct samples share a content address"
            ))),
            None => {
                self.by_id.insert(id, pcm);
                Ok(id)
            }
        }
    }

    /// Decode a WAV file at `path` and store it, returning its [`AssetId`].
    /// Loading the same file twice yields the same id and stores one copy.
    pub fn load_path<P: AsRef<std::path::Path>>(&mut self, path: P) -> Result<AssetId, AssetError> {
        let pcm = self.codec.decode_wav_file(path)?;
        self.insert(pcm)
    }

    /// Decode a WAV from an in-memory byte buffer and store it, returning its
    /// [`AssetId`]. Identical bytes loaded twice yield the same id (one copy).
    pub fn load_bytes(&mut self, bytes: Vec<u8>) -> Result<AssetId, AssetError> {
        let pcm = self.codec.decode_wav_bytes(bytes)?;
        self.insert(pcm)
    }

    /// Borrow the decoded [`Pcm`] behind an [`AssetId`], or `None` if unknown.
    ///
    /// This is the off-RT resolve the program builder uses to turn an
    /// [`AssetRef`](ojproto::AssetRef) into samples before installing a program.
    pub fn resolve(&self, id: AssetId) -> Option<&Pcm> {
        self.by_id.get(&id)
    }

    /// Borrow the embedded WAV codec for capture/write (recording) without
    /// going through the catalog — recordings are saved to disk, not addressed.
    pub fn codec(&self) -> &AssetStore {
        &self.codec
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A deterministic mono test signal.
    fn ramp_pcm(frames: usize, channels: u16, sample_rate: u32) -> Pcm {
        let n = frames * channels as usize;
        let samples = (0..n)
            .map(|i| (i as f32 / n.max(1) as f32) * std::f32::consts::TAU)
            .map(f32::sin)
            .map(|s| s * 0.5)
            .collect();
        Pcm {
            samples,
            channels,
            sample_rate,
        }
    }

    #[test]
    fn content_address_is_stable_and_deterministic() {
        let a = ramp_pcm(256, 1, 48_000);
        let b = ramp_pcm(256, 1, 48_000);
        // Same content -> same id, every time, this run and the next.
        assert_eq!(content_address(&a), content_address(&b));
        assert_eq!(content_address(&a), content_address(&a));
    }

    #[test]
    fn content_address_depends_on_spec() {
        let mono = ramp_pcm(256, 1, 48_000);
        let same_samples_diff_rate = Pcm {
            sample_rate: 44_100,
            ..mono.clone()
        };
        let same_samples_diff_channels = Pcm {
            channels: 2,
            ..mono.clone()
        };
        assert_ne!(
            content_address(&mono),
            content_address(&same_samples_diff_rate)
        );
        assert_ne!(
            content_address(&mono),
            content_address(&same_samples_diff_channels)
        );
    }

    #[test]
    fn content_address_changes_with_samples() {
        let a = ramp_pcm(256, 1, 48_000);
        let mut b = a.clone();
        b.samples[100] += 1e-3; // perturb one sample
        assert_ne!(content_address(&a), content_address(&b));
    }

    #[test]
    fn insert_dedups_identical_samples() {
        let mut cat = AssetCatalog::new();
        let id1 = cat.insert(ramp_pcm(512, 2, 44_100)).expect("insert 1");
        let id2 = cat.insert(ramp_pcm(512, 2, 44_100)).expect("insert 2");
        // Identical samples -> same id and exactly one stored copy.
        assert_eq!(id1, id2);
        assert_eq!(cat.len(), 1, "identical samples must not duplicate");
    }

    #[test]
    fn distinct_samples_get_distinct_entries() {
        let mut cat = AssetCatalog::new();
        let id1 = cat.insert(ramp_pcm(128, 1, 48_000)).expect("insert 1");
        let id2 = cat.insert(ramp_pcm(256, 1, 48_000)).expect("insert 2");
        assert_ne!(id1, id2);
        assert_eq!(cat.len(), 2);
    }

    #[test]
    fn resolve_round_trips() {
        let mut cat = AssetCatalog::new();
        let pcm = ramp_pcm(300, 2, 44_100);
        let id = cat.insert(pcm.clone()).expect("insert");
        let got = cat.resolve(id).expect("resolve");
        assert_eq!(*got, pcm, "resolve must return the exact stored Pcm");
    }

    #[test]
    fn resolve_unknown_id_is_none() {
        let cat = AssetCatalog::new();
        assert!(cat.resolve(AssetId(0xdead_beef)).is_none());
        assert!(!cat.contains(AssetId(0xdead_beef)));
    }

    #[test]
    fn wav_decode_store_resolve_round_trips_in_memory() {
        // Generate an in-memory WAV, load it through the catalog, resolve it,
        // and confirm the decoded samples match the original within float eps.
        let mut cat = AssetCatalog::new();
        let original = ramp_pcm(480, 1, 48_000);

        let wav_bytes = cat.codec().encode_wav_bytes(&original).expect("encode wav");
        assert_eq!(&wav_bytes[0..4], b"RIFF");

        let id = cat.load_bytes(wav_bytes).expect("load wav bytes");
        let resolved = cat.resolve(id).expect("resolve loaded asset");

        assert_eq!(resolved.channels, original.channels);
        assert_eq!(resolved.sample_rate, original.sample_rate);
        assert_eq!(resolved.frames(), original.frames());
        for (i, (&a, &b)) in original
            .samples
            .iter()
            .zip(resolved.samples.iter())
            .enumerate()
        {
            assert!((a - b).abs() < 1e-6, "frame {i}: {a} != {b}");
        }
    }

    #[test]
    fn loading_same_wav_bytes_twice_dedups() {
        let mut cat = AssetCatalog::new();
        let pcm = ramp_pcm(240, 2, 44_100);
        let wav = cat.codec().encode_wav_bytes(&pcm).expect("encode");

        let id1 = cat.load_bytes(wav.clone()).expect("load 1");
        let id2 = cat.load_bytes(wav).expect("load 2");
        assert_eq!(id1, id2, "same WAV bytes -> same AssetId");
        assert_eq!(cat.len(), 1, "same WAV bytes must store one copy");
    }

    #[test]
    fn capture_write_still_works_via_codec() {
        // Recording / capture path is unchanged: encode round-trips through the
        // catalog's embedded codec without being content-addressed.
        let cat = AssetCatalog::new();
        let pcm = ramp_pcm(120, 1, 48_000);
        let bytes = cat.codec().encode_wav_bytes(&pcm).expect("encode");
        let back = cat.codec().decode_wav_bytes(bytes).expect("decode");
        assert_eq!(back.frames(), pcm.frames());
    }
}
