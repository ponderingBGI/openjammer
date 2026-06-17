//! Unbounded fuzz target for the WAV decoder (the untrusted sample-import parse
//! surface). The bounded per-PR smoke lives in
//! `crates/ojcore-native/tests/fuzz_smoke.rs`; this explores the SAME entry point
//! without a fixed budget under libFuzzer. A finding is a clean Err vs a crash.
#![no_main]

use libfuzzer_sys::fuzz_target;
use ojcore_native::AssetStore;

fuzz_target!(|data: &[u8]| {
    // Must return a Result on ANY input — never panic / read out of bounds.
    let _ = AssetStore.decode_wav_bytes(data.to_vec());
});
