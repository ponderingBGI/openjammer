//! The Tier-3 OFFLINE driver — "one core, two clocks" made concrete.
//!
//! [`OfflineDriver`] drives the SAME [`ojcore::Engine::process_block`] device-lessly
//! at a non-RT clock: a block-by-block loop with a virtual transport (the frame
//! counter). It is the SECOND clock — the offline twin of the Tier-3 device callback
//! (the RT clock in [`crate::host`]) — and a bounce is bit-identical to a live take
//! by construction, because it reuses the identical engine, not a second mixdown
//! path (`docs/BOUNDARY.md` §9). No audio device, so it runs in CI.
//!
//! The block loop + virtual transport live HERE (Tier 3); SCHEDULING lives in the
//! caller's per-block hook, so a demo render, a future stems bounce, and a unit test
//! all share one driver instead of each re-implementing the loop. (The render demo
//! `src/bin/render.rs` drives its arpeggio through this.)

use ojcore::Engine;

/// A non-RT clock over an [`Engine`]: renders whole blocks into a buffer, calling a
/// caller hook at each block boundary so scheduled [`ojproto::RtCommand`]s land at
/// their frame (the virtual transport position).
pub struct OfflineDriver {
    engine: Engine,
    block: usize,
}

impl OfflineDriver {
    /// Wrap a compiled engine. `block` is the render quantum (frames per
    /// `process_block`); clamped to at least 1.
    pub fn new(engine: Engine, block: usize) -> Self {
        Self {
            engine,
            block: block.max(1),
        }
    }

    /// Render `frames` mono samples into a fresh buffer whose length is rounded UP to
    /// a whole block. `before_block(&mut engine, frame)` runs at each block boundary
    /// BEFORE that block renders, so the caller applies scheduled commands at the
    /// transport `frame`. The one-shot output allocation happens here — this is the
    /// OFF-RT clock, so allocating is fine (unlike `process_block`'s RT hot path,
    /// which the loop calls and which still allocates nothing).
    pub fn render_mono<F>(&mut self, frames: usize, mut before_block: F) -> Vec<f32>
    where
        F: FnMut(&mut Engine, usize),
    {
        let total = frames.div_ceil(self.block) * self.block;
        let mut buf = vec![0.0f32; total];
        let mut frame = 0;
        while frame < total {
            before_block(&mut self.engine, frame);
            self.engine
                .process_block(&mut buf[frame..frame + self.block], self.block);
            frame += self.block;
        }
        buf
    }

    /// Borrow the engine (e.g. to apply setup commands before the first block).
    pub fn engine_mut(&mut self) -> &mut Engine {
        &mut self.engine
    }

    /// Consume the driver, returning the engine.
    pub fn into_engine(self) -> Engine {
        self.engine
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojcore::{compile, register_builtins, BuiltinOpts, Engine, PluginRegistry, SPEAKER_OUT_ID};
    use ojproto::{IrNode, NodeIdx, OjGraph, PrimitiveKind};

    /// A lone-`SpeakerOut` engine (renders silence) — enough to exercise the driver's
    /// loop without a generator (the bootstrap graph the wasm worklet starts on).
    fn lone_speaker_engine() -> Engine {
        let mut g = OjGraph::empty(48_000, 64);
        g.nodes.push(IrNode {
            id: NodeIdx(1),
            manifest_id: SPEAKER_OUT_ID.into(),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        });
        let mut reg = PluginRegistry::new();
        register_builtins(&mut reg, BuiltinOpts::full());
        Engine::new(compile(&g, &reg).expect("lone speaker compiles"))
    }

    #[test]
    fn renders_whole_blocks_and_visits_each_transport_frame() {
        let mut driver = OfflineDriver::new(lone_speaker_engine(), 64);
        let mut boundaries = Vec::new();
        // 200 frames @ block 64 -> rounds up to 256 (4 blocks).
        let buf = driver.render_mono(200, |_engine, frame| boundaries.push(frame));
        assert_eq!(buf.len(), 256, "length rounds up to a whole block");
        assert_eq!(
            boundaries,
            vec![0, 64, 128, 192],
            "one hook per block, at the virtual transport frame"
        );
        assert!(
            buf.iter().all(|x| x.is_finite()),
            "no NaN/inf from a silent graph"
        );
    }

    #[test]
    fn zero_frames_renders_nothing() {
        let mut driver = OfflineDriver::new(lone_speaker_engine(), 64);
        let mut calls = 0;
        let buf = driver.render_mono(0, |_e, _f| calls += 1);
        assert!(buf.is_empty());
        assert_eq!(calls, 0, "no blocks, no hook calls");
    }
}
