//! U16 — real-time resilience: NaN/denormal guard, a per-block CPU watchdog,
//! and last-wins command coalescing.
//!
//! Three independent guards protect foreign-plugin and device boundaries so one
//! misbehaving hosted node can never take down the audio thread:
//!
//! 1. [`sanitize`] — flush any non-finite (NaN/Inf) sample at a hosted-node or
//!    master output boundary and report whether it had to. `no_std`.
//! 2. [`Watchdog`] — measures hosted-node render wall-time and flags / auto-
//!    bypasses a plugin that blows its per-block CPU budget. Wall-clock timing
//!    needs `std::time::Instant`, so the watchdog itself is `std`-gated; the
//!    *budget bookkeeping* ([`NodeBudget`]) is `no_std` so the flags survive on
//!    the worklet (which simply never arms the timer).
//! 3. [`CommandCoalescer`] — last-wins coalescing of duplicate `SetParam` so a
//!    flood of param automation for the same `(node, param)` collapses to the
//!    newest value before it reaches the instances. `no_std` (alloc only).

use alloc::vec;
use alloc::vec::Vec;

use ojproto::RtCommand;

/// Flush every non-finite (NaN/Inf) and denormal sample in `buf` to `0.0`.
///
/// Returns `true` if any sample had to be flushed, so the caller can raise a
/// "this node emitted garbage" flag. Denormals are flushed too: they are finite
/// but cost orders of magnitude more CPU on most FPUs, so silencing them is both
/// a correctness and a CPU-spike guard. Alloc-free; safe on the audio thread.
#[inline]
pub fn sanitize(buf: &mut [f32]) -> bool {
    /// Anything with magnitude below this is treated as a denormal/sub-audible
    /// zero and flushed (well under -300 dBFS, so never audible).
    const DENORMAL_FLOOR: f32 = 1.0e-30;
    let mut dirty = false;
    for s in buf.iter_mut() {
        // Non-finite (NaN/Inf) OR a tiny-but-nonzero denormal both get flushed to
        // a hard zero: the former is garbage, the latter is a CPU-spike hazard.
        let flush = !s.is_finite() || (*s != 0.0 && s.abs() < DENORMAL_FLOOR);
        if flush {
            *s = 0.0;
            dirty = true;
        } else if *s > 4.0 {
            *s = 4.0;
            dirty = true;
        } else if *s < -4.0 {
            *s = -4.0;
            dirty = true;
        }
    }
    dirty
}

/// Per-node resilience bookkeeping: which nodes emitted non-finite output and
/// which were auto-bypassed by the watchdog. Sized once off-RT (one bool per
/// node); the render loop only flips flags. `no_std`.
#[derive(Debug, Clone, Default)]
pub struct NodeBudget {
    /// `true` once a node has emitted a non-finite sample this run.
    pub non_finite: Vec<bool>,
    /// `true` once the watchdog auto-bypassed a node for blowing its budget.
    pub over_budget: Vec<bool>,
}

impl NodeBudget {
    /// One slot per node, all clear.
    pub fn with_nodes(n: usize) -> Self {
        Self {
            non_finite: vec![false; n],
            over_budget: vec![false; n],
        }
    }

    /// Resize to `n` nodes, clearing all flags (called on a program swap).
    pub fn resize(&mut self, n: usize) {
        self.non_finite.clear();
        self.non_finite.resize(n, false);
        self.over_budget.clear();
        self.over_budget.resize(n, false);
    }

    /// Whether any node has tripped a resilience flag.
    pub fn any_flagged(&self) -> bool {
        self.non_finite.iter().any(|&b| b) || self.over_budget.iter().any(|&b| b)
    }

    /// Clear every flag (e.g. after the control plane has consumed them).
    pub fn clear(&mut self) {
        self.non_finite.fill(false);
        self.over_budget.fill(false);
    }
}

/// A per-block CPU-time watchdog (std-only, native).
///
/// Arm it with a per-block budget; call [`Watchdog::start`] before a node renders
/// and [`Watchdog::check`] after. `check` returns `true` if the node exceeded its
/// share of the budget, which the engine uses to flag and (optionally) auto-
/// bypass the offender so a single runaway node degrades to silence rather than
/// xrunning the whole stream.
///
/// `std`-gated: it needs `std::time::Instant`. On the wasm worklet the engine
/// simply never constructs a `Watchdog`, and the resilience flags it would set
/// stay clear.
#[cfg(feature = "std")]
#[derive(Debug, Clone, Copy)]
pub struct Watchdog {
    /// Per-node CPU budget for one block, in nanoseconds.
    budget_ns: u128,
    /// When the current node's render started.
    started: Option<std::time::Instant>,
    /// Whether an exceeded budget should auto-bypass the node.
    pub auto_bypass: bool,
    /// Consecutive over-budget blocks required before auto-bypass. A clean
    /// block resets the node's streak in the engine.
    pub consecutive_limit: u8,
}

#[cfg(feature = "std")]
impl Watchdog {
    /// A watchdog giving each node up to `budget_ns` nanoseconds per block.
    /// `auto_bypass` controls whether an over-budget node is flagged only or
    /// flagged AND bypassed.
    pub fn new(budget_ns: u128, auto_bypass: bool) -> Self {
        Self {
            budget_ns,
            started: None,
            auto_bypass,
            consecutive_limit: 1,
        }
    }

    /// Require `blocks` consecutive overruns before auto-bypass. Zero is
    /// normalized to one so a watchdog can never be accidentally inert.
    pub fn with_consecutive(mut self, blocks: u8) -> Self {
        self.consecutive_limit = blocks.max(1);
        self
    }

    /// Derive a per-node budget from the block duration and a CPU-fraction cap.
    /// `block_size` frames at `sample_rate` Hz is the real-time deadline; a node
    /// is allowed `fraction` of that. Clamped so a degenerate config still yields
    /// a positive budget.
    pub fn from_block(sample_rate: f32, block_size: usize, fraction: f32) -> Self {
        let sr = if sample_rate > 0.0 {
            sample_rate as f64
        } else {
            48_000.0
        };
        let block_secs = block_size as f64 / sr;
        let frac = fraction.clamp(0.0, 1.0) as f64;
        let budget_ns = (block_secs * frac * 1.0e9) as u128;
        Self::new(budget_ns.max(1), false)
    }

    /// Mark the start of a node render.
    #[inline]
    pub fn start(&mut self) {
        self.started = Some(std::time::Instant::now());
    }

    /// Check the elapsed time against the budget. Returns `true` if exceeded.
    /// A `check` without a preceding `start` is treated as in-budget.
    #[inline]
    pub fn check(&mut self) -> bool {
        match self.started.take() {
            Some(t) => t.elapsed().as_nanos() > self.budget_ns,
            None => false,
        }
    }

    /// The configured per-node budget in nanoseconds.
    pub fn budget_ns(&self) -> u128 {
        self.budget_ns
    }
}

/// Last-wins coalescing of duplicate `SetParam` commands.
///
/// A burst of automation for the same `(node, param)` (e.g. a UI slider drag)
/// should not push N redundant writes through the instance: only the newest
/// value matters. The coalescer keeps an insertion-ordered table of pending
/// `(node, param) -> value`; ingesting a duplicate overwrites in place rather
/// than appending. Non-`SetParam` commands pass through verbatim, preserving
/// their order relative to the coalesced params. Sized once off-RT; ingest /
/// drain are alloc-free as long as the working set stays within capacity.
#[derive(Debug, Clone, Default)]
pub struct CommandCoalescer {
    /// Coalesced `SetParam`s, insertion-ordered, deduped by `(node, param)`.
    params: Vec<RtCommand>,
    /// Pass-through (non-`SetParam`) commands, in arrival order.
    other: Vec<RtCommand>,
}

impl CommandCoalescer {
    /// A coalescer pre-sized for up to `cap` distinct pending commands.
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            params: Vec::with_capacity(cap),
            other: Vec::with_capacity(cap),
        }
    }

    /// Whether nothing is pending.
    pub fn is_empty(&self) -> bool {
        self.params.is_empty() && self.other.is_empty()
    }

    /// Number of pending (post-coalesce) commands.
    pub fn len(&self) -> usize {
        self.params.len() + self.other.len()
    }

    /// Ingest one command, coalescing duplicate `SetParam`s last-wins.
    pub fn push(&mut self, cmd: RtCommand) {
        match cmd {
            RtCommand::SetParam { node, param, value } => {
                for existing in &mut self.params {
                    if let RtCommand::SetParam {
                        node: n,
                        param: p,
                        value: v,
                    } = existing
                    {
                        if *n == node && *p == param {
                            *v = value; // last write wins
                            return;
                        }
                    }
                }
                self.params.push(cmd);
            }
            _ => self.other.push(cmd),
        }
    }

    /// Apply every coalesced command to `sink` (params first, then the ordered
    /// pass-through commands), then clear. The closure is the engine's per-
    /// command applicator.
    pub fn drain_into(&mut self, mut sink: impl FnMut(RtCommand)) {
        for &c in &self.params {
            sink(c);
        }
        for &c in &self.other {
            sink(c);
        }
        self.params.clear();
        self.other.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojproto::NodeIdx;

    #[test]
    fn sanitize_flushes_non_finite() {
        let mut buf = [1.0, f32::NAN, 0.5, f32::INFINITY, -2.0, f32::NEG_INFINITY];
        assert!(sanitize(&mut buf));
        assert_eq!(buf, [1.0, 0.0, 0.5, 0.0, -2.0, 0.0]);
    }

    #[test]
    fn sanitize_clean_block_reports_false() {
        let mut buf = [0.1, -0.2, 0.3, 0.0];
        assert!(!sanitize(&mut buf), "finite block is left untouched");
        assert_eq!(buf, [0.1, -0.2, 0.3, 0.0]);
    }

    #[test]
    fn sanitize_flushes_denormals() {
        let mut buf = [1.0e-32f32, 5.0e-40, 0.5];
        assert!(sanitize(&mut buf));
        assert_eq!(buf[0], 0.0);
        assert_eq!(buf[1], 0.0);
        assert_eq!(buf[2], 0.5);
    }

    #[test]
    fn sanitize_hard_clamps_with_headroom() {
        let mut buf = [3.5, 8.0, -9.0];
        assert!(sanitize(&mut buf));
        assert_eq!(buf, [3.5, 4.0, -4.0]);
    }

    #[test]
    fn budget_flags_track_nodes() {
        let mut b = NodeBudget::with_nodes(3);
        assert!(!b.any_flagged());
        b.non_finite[1] = true;
        assert!(b.any_flagged());
        b.clear();
        assert!(!b.any_flagged());
        b.resize(5);
        assert_eq!(b.non_finite.len(), 5);
        assert!(!b.any_flagged());
    }

    #[test]
    fn coalescer_last_wins_for_same_param() {
        let mut c = CommandCoalescer::with_capacity(8);
        c.push(RtCommand::SetParam {
            node: NodeIdx(1),
            param: 0,
            value: 0.1,
        });
        c.push(RtCommand::SetParam {
            node: NodeIdx(1),
            param: 0,
            value: 0.2,
        });
        c.push(RtCommand::SetParam {
            node: NodeIdx(1),
            param: 0,
            value: 0.3,
        });
        assert_eq!(c.len(), 1, "three writes to one param coalesce to one");

        let mut applied: Vec<RtCommand> = Vec::new();
        c.drain_into(|cmd| applied.push(cmd));
        assert_eq!(applied.len(), 1);
        match applied[0] {
            RtCommand::SetParam { value, .. } => assert_eq!(value, 0.3, "last value wins"),
            other => panic!("expected SetParam, got {other:?}"),
        }
        assert!(c.is_empty());
    }

    #[test]
    fn coalescer_keeps_distinct_params_and_passthrough() {
        let mut c = CommandCoalescer::with_capacity(8);
        c.push(RtCommand::SetParam {
            node: NodeIdx(1),
            param: 0,
            value: 0.5,
        });
        c.push(RtCommand::SetParam {
            node: NodeIdx(2),
            param: 0,
            value: 0.6,
        }); // diff node
        c.push(RtCommand::SetParam {
            node: NodeIdx(1),
            param: 1,
            value: 0.7,
        }); // diff param
        c.push(RtCommand::Bypass {
            node: NodeIdx(1),
            on: true,
        }); // pass-through
        c.push(RtCommand::SetParam {
            node: NodeIdx(1),
            param: 0,
            value: 0.9,
        }); // coalesces w/ first
        assert_eq!(c.len(), 4, "3 distinct params + 1 bypass");

        let mut applied: Vec<RtCommand> = Vec::new();
        c.drain_into(|cmd| applied.push(cmd));
        // The first param keeps its slot but updates to the last value.
        assert!(matches!(
            applied[0],
            RtCommand::SetParam { node: NodeIdx(1), param: 0, value } if value == 0.9
        ));
        // Pass-through command survives.
        assert!(applied
            .iter()
            .any(|c| matches!(c, RtCommand::Bypass { on: true, .. })));
    }

    #[cfg(feature = "std")]
    #[test]
    fn watchdog_flags_overrun() {
        let mut w = Watchdog::new(0, false); // zero-ns budget: anything overruns.
        w.start();
        // A trivial bit of work; even this exceeds a 0-ns budget.
        std::thread::yield_now();
        assert!(w.check(), "0-ns budget must report overrun");
    }

    #[cfg(feature = "std")]
    #[test]
    fn watchdog_in_budget_when_fast() {
        // A whole second budget: a no-op render is comfortably inside it.
        let mut w = Watchdog::new(1_000_000_000, false);
        w.start();
        assert!(!w.check(), "no-op render is in budget");
    }

    #[cfg(feature = "std")]
    #[test]
    fn watchdog_check_without_start_is_in_budget() {
        let mut w = Watchdog::new(0, false);
        assert!(!w.check(), "no start => treated as in budget");
    }

    #[cfg(feature = "std")]
    #[test]
    fn watchdog_from_block_positive_budget() {
        let w = Watchdog::from_block(48_000.0, 64, 0.5);
        // 64 frames @ 48kHz ~= 1.333ms; half of that ~= 666us = 666000ns.
        assert!(w.budget_ns() > 0);
        assert!(w.budget_ns() < 1_000_000); // under 1ms.
                                            // Degenerate config still yields a positive budget.
        let w2 = Watchdog::from_block(0.0, 0, 0.0);
        assert!(w2.budget_ns() >= 1);
    }
}
