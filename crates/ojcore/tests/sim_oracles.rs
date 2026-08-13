//! Engine-tier deterministic-simulation oracles (Track A P1 — the HARD oracle
//! core, applied to the engine without the full device/AudioBackend harness).
//!
//! A seeded script drives a real `Engine` over many blocks — random param
//! automation through the real command ring, and ADVERSARIAL input (NaN, +/-Inf,
//! huge magnitudes) injected at the graph source — and asserts the invariants the
//! plan calls the HARD oracle tier:
//!
//!   • FINITE        — every output sample is finite after any input/command, end-
//!                     to-end proof that the per-node `sanitize` + master limiter
//!                     hold the line (a held note beats a glitch: garbage in never
//!                     means NaN out).
//!   • BOUNDED       — the master brickwall keeps |out| <= the limiter ceiling, so
//!                     a runaway gain can never blast the device.
//!   • NO-PANIC      — the whole randomized run never panics (proptest catches it).
//!   • DETERMINISM   — the SAME seed yields byte-identical output, proving nothing
//!                     pulls clock/entropy/HashMap-iteration into `process_block`;
//!                     this is what makes a failing `(seed)` a durable bug report.
//!
//! All faults derive from one `u64` seed via the in-repo mulberry32 PRNG (the
//! same bit-stable generator the wav-decode fuzz smoke uses — no global RNG, so
//! the run is replayable). std-only.
#![cfg(feature = "std")]

use ojcore::{compile, CommandQueue, Engine, GainLoader, PluginRegistry, GAIN_ID, GAIN_PARAM};
use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};
use proptest::prelude::*;

const SR: u32 = 48_000;
const BLOCK: u32 = 64;
const NB: usize = BLOCK as usize;
const LIMITER_CEILING: f32 = 0.999; // mirrors ojcore_dsp::guards::LIMITER_CEILING

/// The in-repo mulberry32: a tiny, bit-stable, seedable PRNG. Deterministic ⇒ a
/// whole sim run replays from its `u64` seed (split into two 32-bit streams).
struct Mulberry32(u32);
impl Mulberry32 {
    fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6D2B_79F5);
        let mut z = self.0;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
        z ^ (z >> 14)
    }
    /// A float in [0, 1).
    fn next_f01(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }
}

fn registry() -> PluginRegistry {
    let mut reg = PluginRegistry::new();
    reg.register(Box::new(GainLoader::new()));
    reg
}

fn node(id: u32, kind: PrimitiveKind, n_in: u8, n_out: u8) -> IrNode {
    IrNode {
        id: NodeIdx(id),
        manifest_id: GAIN_ID.into(),
        kind,
        params: Vec::new(),
        assets: Vec::new(),
        n_in,
        n_out,
    }
}
fn edge(from: u32, to: u32) -> IrEdge {
    IrEdge {
        from_node: NodeIdx(from),
        from_port: 0,
        to_node: NodeIdx(to),
        to_port: 0,
        kind: ConnectionType::Audio,
    }
}
/// GraphIn(0) -> Gain(1) -> SpeakerOut(2).
fn graph() -> OjGraph {
    let mut g = OjGraph::empty(SR, BLOCK);
    g.nodes.push(node(0, PrimitiveKind::GraphIn, 0, 1));
    g.nodes.push(node(1, PrimitiveKind::Gain, 1, 1));
    g.nodes.push(node(2, PrimitiveKind::SpeakerOut, 1, 0));
    g.edges.push(edge(0, 1));
    g.edges.push(edge(1, 2));
    g
}

/// One adversarial input sample drawn from the PRNG: mostly ordinary audio, but
/// occasionally NaN / +/-Inf / a huge magnitude — exactly the "garbage" the
/// resilience layer must absorb.
fn adversarial_sample(r: &mut Mulberry32) -> f32 {
    match r.next_u32() % 16 {
        0 => f32::NAN,
        1 => f32::INFINITY,
        2 => f32::NEG_INFINITY,
        3 => 1.0e30 * (r.next_f01() - 0.5),
        4 => 1.0e-32 * (r.next_f01() - 0.5), // denormal-ish
        _ => 2.0 * (r.next_f01() - 0.5),     // ordinary [-1, 1)
    }
}

/// Run the seeded sim, returning the full rendered output. Pure + deterministic.
fn run(seed: u64, blocks: usize) -> Vec<f32> {
    let mut workload = Mulberry32(seed as u32);
    // A separate stream (seed+1 offset, Turso's trick) so the param automation is
    // independent of the input noise yet still fully seed-derived.
    let mut faults = Mulberry32((seed >> 32) as u32 ^ 0x9E37_79B9);

    let prog = compile(&graph(), &registry()).expect("compile");
    let mut engine = Engine::new(prog);
    let (mut tx, mut rx) = CommandQueue::split(64);

    let mut out = vec![0.0f32; NB];
    let mut acc = Vec::with_capacity(blocks * NB);
    for _ in 0..blocks {
        // Random param automation through the REAL command ring, including extreme
        // gains that would clip without the master limiter.
        if faults.next_u32().is_multiple_of(3) {
            let gain = match faults.next_u32() % 4 {
                0 => 1.0e6 * faults.next_f01(), // runaway gain
                1 => 0.0,
                _ => 4.0 * faults.next_f01(),
            };
            let _ = tx.push(RtCommand::SetParam {
                node: NodeIdx(1),
                param: GAIN_PARAM,
                value: gain,
            });
        }
        engine.drain(&mut rx);

        // Adversarial input at the source.
        if let Some(buf) = engine.input_mut(NodeIdx(0), 0) {
            for s in buf.iter_mut() {
                *s = adversarial_sample(&mut workload);
            }
        }
        engine.process_block(&mut out, NB);
        acc.extend_from_slice(&out);
    }
    acc
}

proptest! {
    /// FINITE + BOUNDED: no matter what garbage is fed in or how extreme the gain,
    /// every output sample is finite and within the limiter ceiling.
    #[test]
    fn output_is_finite_and_bounded_under_adversarial_input(seed in any::<u64>()) {
        let out = run(seed, 24);
        for (i, &s) in out.iter().enumerate() {
            prop_assert!(s.is_finite(), "seed {}: non-finite output at {}: {}", seed, i, s);
            prop_assert!(
                s.abs() <= LIMITER_CEILING + 1e-6,
                "seed {}: output {} at {} exceeds the master ceiling",
                seed,
                s,
                i
            );
        }
    }

    /// DETERMINISM: the same seed renders byte-identical output. This is the
    /// prerequisite that makes a failing seed a durable, replayable bug report.
    #[test]
    fn same_seed_is_byte_identical(seed in any::<u64>()) {
        let a = run(seed, 12);
        let b = run(seed, 12);
        prop_assert_eq!(a.len(), b.len());
        for (i, (&x, &y)) in a.iter().zip(b.iter()).enumerate() {
            prop_assert_eq!(x.to_bits(), y.to_bits(), "seed {}: diverged at sample {}", seed, i);
        }
    }
}
