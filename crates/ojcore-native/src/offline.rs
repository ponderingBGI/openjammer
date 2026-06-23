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

    /// Render `frames` of STEREO audio into two planar channel buffers (each rounded
    /// UP to a whole block) via `process_block_into` — the stereo counterpart of
    /// [`OfflineDriver::render_mono`], for an offline bounce of a graph that contains a
    /// `Pan` / `Width` / stereo node. `before_block` runs at each block boundary,
    /// exactly as in `render_mono`. A mono graph fills both channels identically.
    pub fn render_stereo<F>(&mut self, frames: usize, mut before_block: F) -> (Vec<f32>, Vec<f32>)
    where
        F: FnMut(&mut Engine, usize),
    {
        let total = frames.div_ceil(self.block) * self.block;
        let mut l = vec![0.0f32; total];
        let mut r = vec![0.0f32; total];
        let mut frame = 0;
        while frame < total {
            before_block(&mut self.engine, frame);
            let (lb, rb) = (
                &mut l[frame..frame + self.block],
                &mut r[frame..frame + self.block],
            );
            let mut outs: [&mut [f32]; 2] = [lb, rb];
            self.engine.process_block_into(&mut outs, self.block);
            frame += self.block;
        }
        (l, r)
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
    use ojcore::{
        compile, pan_param, register_builtins, BuiltinOpts, Engine, PluginRegistry, GRAPH_IN_ID,
        PAN_ID, SPEAKER_OUT_ID,
    };
    use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind, RtCommand};

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

    #[test]
    fn render_stereo_returns_two_finite_channels() {
        let mut driver = OfflineDriver::new(lone_speaker_engine(), 64);
        let (l, r) = driver.render_stereo(200, |_e, _f| {});
        assert_eq!(l.len(), 256, "L rounds up to a whole block");
        assert_eq!(r.len(), 256, "R rounds up to a whole block");
        assert!(
            l.iter().chain(r.iter()).all(|x| x.is_finite()),
            "no NaN/inf"
        );
    }

    /// GraphIn -> Pan -> SpeakerOut: a host-injected DC source panned by a SCHEDULED
    /// param change mid-render. Proves the driver applies per-block commands across
    /// the virtual transport (the seam a P3 stems bounce relies on) — not just at the
    /// start: the first half pans hard LEFT, the second hard RIGHT.
    fn pan_chain_engine() -> Engine {
        let mut g = OjGraph::empty(48_000, 64);
        g.nodes.push(IrNode {
            id: NodeIdx(1),
            manifest_id: GRAPH_IN_ID.into(),
            kind: PrimitiveKind::GraphIn,
            params: vec![],
            assets: vec![],
            n_in: 0,
            n_out: 1,
        });
        g.nodes.push(IrNode {
            id: NodeIdx(2),
            manifest_id: PAN_ID.into(),
            kind: PrimitiveKind::Pan,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 1,
        });
        g.nodes.push(IrNode {
            id: NodeIdx(3),
            manifest_id: SPEAKER_OUT_ID.into(),
            kind: PrimitiveKind::SpeakerOut,
            params: vec![],
            assets: vec![],
            n_in: 1,
            n_out: 0,
        });
        g.edges.push(IrEdge {
            from_node: NodeIdx(1),
            from_port: 0,
            to_node: NodeIdx(2),
            to_port: 0,
            kind: ConnectionType::Audio,
        });
        g.edges.push(IrEdge {
            from_node: NodeIdx(2),
            from_port: 0,
            to_node: NodeIdx(3),
            to_port: 0,
            kind: ConnectionType::Audio,
        });
        let mut reg = PluginRegistry::new();
        register_builtins(&mut reg, BuiltinOpts::full());
        Engine::new(compile(&g, &reg).expect("pan chain compiles"))
    }

    #[test]
    fn render_stereo_applies_scheduled_pan_over_time() {
        let mut driver = OfflineDriver::new(pan_chain_engine(), 64);
        let frames = 32 * 64; // 32 blocks: each half >> the 5 ms pan smoother settle
        let (l, r) = driver.render_stereo(frames, |engine, frame| {
            // Inject a DC into the GraphIn source each block (what a host feeds).
            if let Some(buf) = engine.input_mut(NodeIdx(1), 0) {
                buf.fill(0.5);
            }
            // Stepped pan: hard LEFT for the first half, hard RIGHT for the second.
            let pan = if frame < frames / 2 { -1.0 } else { 1.0 };
            engine.apply(RtCommand::SetParam {
                node: NodeIdx(2),
                param: pan_param::PAN,
                value: pan,
            });
        });
        // First half settled hard-left: L carries the signal, R ~0.
        assert!(
            l[frames / 2 - 1] > r[frames / 2 - 1] + 0.2,
            "first half panned left (L {} > R {})",
            l[frames / 2 - 1],
            r[frames / 2 - 1]
        );
        // Second half settled hard-right: R carries the signal, L ~0.
        assert!(
            r[frames - 1] > l[frames - 1] + 0.2,
            "second half panned right (R {} > L {})",
            r[frames - 1],
            l[frames - 1]
        );
    }
}
