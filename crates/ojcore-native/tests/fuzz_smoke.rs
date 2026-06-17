//! Per-PR FUZZ SMOKE over the untrusted parse surface.
//!
//! A malformed sample file must never crash a live show: the WAV decoder
//! (`AssetStore::decode_wav_bytes`, symphonia) has to return a clean `Result` on
//! ANY input — random bytes, truncated/garbage RIFF headers, empty — never panic
//! or read out of bounds. This is the bounded, deterministic smoke that runs on
//! every PR; the UNBOUNDED nightly fuzz (libFuzzer via `cargo fuzz`) is the
//! Lane-B extension that explores the same entry point without a fixed budget.

#![allow(clippy::disallowed_methods)] // test-only PRNG / signal helpers

use ojcore_native::AssetStore;

/// Deterministic PRNG (mulberry32) so the smoke is reproducible.
struct Rng(u32);
impl Rng {
    fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    fn byte(&mut self) -> u8 {
        (self.next_u32() & 0xff) as u8
    }
    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.byte()).collect()
    }
}

/// Run `f` and report whether it panicked (no payload printed — we expect none).
fn panicked(f: impl FnOnce() + std::panic::UnwindSafe) -> bool {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {})); // silence the expected-none panics
    let res = std::panic::catch_unwind(f);
    std::panic::set_hook(prev);
    res.is_err()
}

#[test]
fn wav_decoder_never_panics_on_garbage() {
    let store = AssetStore;
    let mut rng = Rng(0x1234_5678);

    // A spread of adversarial inputs: empty, tiny, random, and RIFF/WAVE-prefixed
    // garbage (gets past the container sniff, then the codec hits nonsense).
    let mut corpus: Vec<Vec<u8>> = vec![Vec::new(), vec![0u8; 1], vec![0xffu8; 4]];
    for _ in 0..400 {
        let len = (rng.next_u32() % 4096) as usize;
        corpus.push(rng.bytes(len));
    }
    for _ in 0..200 {
        let mut b = b"RIFF\x24\x00\x00\x00WAVEfmt ".to_vec();
        let extra = (rng.next_u32() % 2048) as usize;
        b.extend(rng.bytes(extra));
        corpus.push(b);
    }

    for (i, bytes) in corpus.into_iter().enumerate() {
        let store = &store;
        let crashed = panicked(move || {
            // The result is irrelevant — only that it is a Result, never a panic.
            let _ = store.decode_wav_bytes(bytes);
        });
        assert!(!crashed, "decode_wav_bytes PANICKED on corpus input #{i}");
    }
}
