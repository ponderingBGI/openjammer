//! Loom model check of the wait-free SPSC ring (Track A P2).
//!
//! The deterministic-simulation harness runs the engine single-threaded, so it
//! STRUCTURALLY cannot see weak-memory races — the one class it can't reach. loom
//! exhaustively explores every legal interleaving + reordering of the producer's
//! and consumer's atomic operations on this ring, with the data region modeled as
//! a tracked cell, and verifies the Acquire/Release pairing genuinely synchronizes
//! the byte handoff: a consumer that observes the published `write` index ALWAYS
//! sees the complete frame bytes, never a torn/half-written one. Complements the
//! nightly Miri run (which checks UB on the same `unsafe`, but one schedule at a
//! time).
//!
//! Compiled + run ONLY under `--cfg loom` (the nightly job); the production path is
//! `cfg(not(loom))` and byte-identical, so this can never affect shipped behaviour.
#![cfg(loom)]

use ojcore_midiring::ByteRing;

#[test]
fn spsc_handoff_is_race_free_under_all_interleavings() {
    loom::model(|| {
        let ring = loom::sync::Arc::new(ByteRing::<16>::new());

        let producer = {
            let r = ring.clone();
            loom::thread::spawn(move || {
                // One frame; the whole frame must publish atomically.
                assert!(r.push(&[0xa1, 0xb2, 0xc3]));
            })
        };

        let consumer = {
            let r = ring.clone();
            loom::thread::spawn(move || {
                let mut out = [0u8; 8];
                match r.pop(&mut out) {
                    // If the consumer observed the frame, it MUST be the exact bytes
                    // the producer wrote — proving `write`'s Release happens-before
                    // this `pop`'s Acquire for the data region (no torn read).
                    Some(n) => {
                        assert_eq!(n, 3);
                        assert_eq!(&out[..3], &[0xa1, 0xb2, 0xc3]);
                    }
                    // Or it ran before the producer published — a valid interleaving.
                    None => {}
                }
            })
        };

        producer.join().unwrap();
        consumer.join().unwrap();
    });
}
