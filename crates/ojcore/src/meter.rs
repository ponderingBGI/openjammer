//! U15 — per-node + master level metering and the RT -> control return ring.
//!
//! Two pieces, both ADDITIVE to the engine:
//!
//! 1. [`Meter`] / [`MeterBank`] — a tiny, **alloc-free** RMS+peak accumulator
//!    computed inside the render loop, behind a cheap `enabled` toggle so it
//!    costs ~nothing when off. This half is `no_std` (alloc only) and compiles
//!    for the `wasm32` worklet.
//!
//! 2. [`MeterRing`] / [`return_frame`] — a SECOND wait-free SPSC ring carrying
//!    [`EngineFrame::Meter`] / [`EngineFrame::Beat`] from the audio thread back
//!    to the control thread. It reuses the zero-dep [`ojcore_midiring::ByteRing`]
//!    with a compact fixed-size wire format, and a non-blocking publish at block
//!    end. This half is `std`-gated (it is a host-side return path; the worklet
//!    has its own SharedArrayBuffer ring).

use alloc::vec;
use alloc::vec::Vec;

/// A single channel's level accumulator: running sum-of-squares + running peak.
///
/// `accumulate` is the only hot-path entry; it folds a block of samples in with
/// no branching beyond the abs/compare and never allocates. `snapshot` divides
/// out the sample count to produce RMS and resets for the next window.
#[derive(Debug, Clone, Copy, Default)]
pub struct Meter {
    sum_sq: f64,
    peak: f32,
    frames: u64,
}

impl Meter {
    /// A zeroed meter.
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one block of samples into the running RMS/peak window. Alloc-free.
    #[inline]
    pub fn accumulate(&mut self, samples: &[f32]) {
        let mut sum = 0.0f64;
        let mut peak = self.peak;
        for &s in samples {
            let a = s.abs();
            if a > peak {
                peak = a;
            }
            sum += (s as f64) * (s as f64);
        }
        self.sum_sq += sum;
        self.peak = peak;
        self.frames += samples.len() as u64;
    }

    /// Current RMS over the accumulated window (0 if nothing accumulated).
    #[inline]
    pub fn rms(&self) -> f32 {
        if self.frames == 0 {
            return 0.0;
        }
        libm::sqrt(self.sum_sq / self.frames as f64) as f32
    }

    /// Current peak magnitude over the accumulated window.
    #[inline]
    pub fn peak(&self) -> f32 {
        self.peak
    }

    /// Read `(rms, peak)` and reset the window for the next measurement.
    #[inline]
    pub fn take(&mut self) -> (f32, f32) {
        let out = (self.rms(), self.peak);
        *self = Self::default();
        out
    }

    /// Clear the window without reading.
    #[inline]
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// Per-node meters plus a master meter, with a single cheap enable toggle.
///
/// The bank is sized once (off the RT thread) to the node count; the render loop
/// only indexes and `accumulate`s. When `enabled` is false the engine skips the
/// `accumulate` calls entirely, so disabled metering is a single bool test per
/// block.
#[derive(Debug, Clone, Default)]
pub struct MeterBank {
    /// One meter per compiled node slot.
    pub nodes: Vec<Meter>,
    /// The master-output meter.
    pub master: Meter,
    /// Cheap on/off gate. Off by default so metering is opt-in and zero-cost.
    pub enabled: bool,
}

impl MeterBank {
    /// A bank with `n` node meters, metering disabled.
    pub fn with_nodes(n: usize) -> Self {
        Self {
            nodes: vec![Meter::new(); n],
            master: Meter::new(),
            enabled: false,
        }
    }

    /// Resize to `n` node meters (off-RT; called when a new program installs).
    /// Preserves nothing — meters start fresh on a swap.
    pub fn resize(&mut self, n: usize) {
        self.nodes.clear();
        self.nodes.resize(n, Meter::new());
        self.master.reset();
    }

    /// Reset every meter window without changing size or enable state.
    pub fn reset(&mut self) {
        for m in &mut self.nodes {
            m.reset();
        }
        self.master.reset();
    }
}

// --- the RT -> control return ring (std-gated host return path) -------------

/// Compact, fixed-size wire frames carried on the meter return ring.
///
/// `EngineFrame` itself is not `Copy` (its `Error` variant owns a `String`), so
/// it cannot ride a `Copy` SPSC ring directly. Instead the audio thread encodes
/// the two RT-emittable variants (`Meter`, `Beat`) into these small byte frames;
/// the control thread decodes them back into `EngineFrame`s. Shared by the
/// `no_std` core (encode side) and the `std` ring (decode side), so it lives out
/// here rather than behind the feature gate.
pub mod return_frame {
    use ojproto::{EngineFrame, NodeIdx};

    /// Tag byte for a `Meter` frame.
    pub const TAG_METER: u8 = 1;
    /// Tag byte for a `Beat` frame.
    pub const TAG_BEAT: u8 = 2;
    /// Tag byte for a `Looper` frame. Continues the numbering past
    /// `TAG_METER = 1` / `TAG_BEAT = 2`. (Note: this `return_frame` tag space is
    /// independent of `event_frame::TAG_EVENT`, which lives on a different ring.)
    pub const TAG_LOOPER: u8 = 4;

    /// Wire size of a `Meter` frame: tag + node(u32) + rms(f32) + peak(f32).
    pub const METER_LEN: usize = 1 + 4 + 4 + 4;
    /// Wire size of a `Beat` frame: tag + bar(u32) + beat(u32) + phase(f32).
    pub const BEAT_LEN: usize = 1 + 4 + 4 + 4;
    /// Wire size of a `Looper` frame:
    /// tag + node(u32) + state(u8) + pos(u32) + loop_len(u32) + peak(f32).
    pub const LOOPER_LEN: usize = 1 + 4 + 1 + 4 + 4 + 4;
    /// The largest frame the ring will ever carry (for fixed out-buffers).
    pub const MAX_LEN: usize = {
        let mut m = if METER_LEN > BEAT_LEN {
            METER_LEN
        } else {
            BEAT_LEN
        };
        if LOOPER_LEN > m {
            m = LOOPER_LEN;
        }
        m
    };

    /// Encode a `Meter` frame into `buf`, returning the written length.
    #[inline]
    pub fn encode_meter(node: NodeIdx, rms: f32, peak: f32, buf: &mut [u8; MAX_LEN]) -> usize {
        buf[0] = TAG_METER;
        buf[1..5].copy_from_slice(&node.0.to_le_bytes());
        buf[5..9].copy_from_slice(&rms.to_le_bytes());
        buf[9..13].copy_from_slice(&peak.to_le_bytes());
        METER_LEN
    }

    /// Encode a `Beat` frame into `buf`, returning the written length.
    #[inline]
    pub fn encode_beat(bar: u32, beat: u32, phase: f32, buf: &mut [u8; MAX_LEN]) -> usize {
        buf[0] = TAG_BEAT;
        buf[1..5].copy_from_slice(&bar.to_le_bytes());
        buf[5..9].copy_from_slice(&beat.to_le_bytes());
        buf[9..13].copy_from_slice(&phase.to_le_bytes());
        BEAT_LEN
    }

    /// Encode a `Looper` telemetry frame into `buf`, returning the written length.
    #[inline]
    pub fn encode_looper(
        node: NodeIdx,
        state: u8,
        pos: u32,
        loop_len: u32,
        peak: f32,
        buf: &mut [u8; MAX_LEN],
    ) -> usize {
        buf[0] = TAG_LOOPER;
        buf[1..5].copy_from_slice(&node.0.to_le_bytes());
        buf[5] = state;
        buf[6..10].copy_from_slice(&pos.to_le_bytes());
        buf[10..14].copy_from_slice(&loop_len.to_le_bytes());
        buf[14..18].copy_from_slice(&peak.to_le_bytes());
        LOOPER_LEN
    }

    /// Decode one wire frame back into an [`EngineFrame`]. Returns `None` on an
    /// unknown tag or a truncated frame.
    pub fn decode(bytes: &[u8]) -> Option<EngineFrame> {
        match *bytes.first()? {
            TAG_METER if bytes.len() >= METER_LEN => {
                let node = NodeIdx(u32::from_le_bytes(bytes[1..5].try_into().ok()?));
                let rms = f32::from_le_bytes(bytes[5..9].try_into().ok()?);
                let peak = f32::from_le_bytes(bytes[9..13].try_into().ok()?);
                Some(EngineFrame::Meter { node, rms, peak })
            }
            TAG_BEAT if bytes.len() >= BEAT_LEN => {
                let bar = u32::from_le_bytes(bytes[1..5].try_into().ok()?);
                let beat = u32::from_le_bytes(bytes[5..9].try_into().ok()?);
                let phase = f32::from_le_bytes(bytes[9..13].try_into().ok()?);
                Some(EngineFrame::Beat { bar, beat, phase })
            }
            TAG_LOOPER if bytes.len() >= LOOPER_LEN => {
                let node = NodeIdx(u32::from_le_bytes(bytes[1..5].try_into().ok()?));
                let state = bytes[5];
                let pos = u32::from_le_bytes(bytes[6..10].try_into().ok()?);
                let loop_len = u32::from_le_bytes(bytes[10..14].try_into().ok()?);
                let peak = f32::from_le_bytes(bytes[14..18].try_into().ok()?);
                Some(EngineFrame::Looper {
                    node,
                    state,
                    pos,
                    loop_len,
                    peak,
                })
            }
            _ => None,
        }
    }
}

/// Fixed-size wire codec for RT-emittable events, carried on a dedicated event
/// ring (NOT the meter ring — a fault storm must never evict meters). One tag
/// continues the [`return_frame`] numbering past `TAG_METER = 1` / `TAG_BEAT = 2`.
pub mod event_frame {
    use ojproto::{FaultKind, NodeIdx, RtEvent};

    /// Tag byte for an event frame. Continues `return_frame`'s sequence
    /// (`TAG_METER = 1`, `TAG_BEAT = 2`).
    pub const TAG_EVENT: u8 = 3;

    /// Sub-kind for [`RtEvent::Xrun`] (byte 1 selects the variant).
    pub const SUB_XRUN: u8 = 0;
    /// Sub-kind for [`RtEvent::NodeFault`].
    pub const SUB_NODE_FAULT: u8 = 1;
    /// Sub-kind for [`RtEvent::RingFull`].
    pub const SUB_RING_FULL: u8 = 2;
    /// Sub-kind for [`RtEvent::LooperEdge`].
    pub const SUB_LOOPER_EDGE: u8 = 3;

    const FAULT_NON_FINITE: u8 = 0;
    const FAULT_OVER_BUDGET: u8 = 1;
    const FAULT_AUTO_BYPASSED: u8 = 2;
    const FAULT_CRASHED: u8 = 3;

    /// Largest event frame: the looper edge frame is
    /// tag + sub + node(u32) + from(u8) + to(u8) = 8 bytes (the node-fault frame
    /// is 7); take the max so the fixed out-buffer always fits.
    pub const MAX_LEN: usize = 1 + 1 + 4 + 1 + 1;

    /// Encode one [`RtEvent`] into `buf`, returning the written length.
    #[inline]
    pub fn encode(ev: RtEvent, buf: &mut [u8; MAX_LEN]) -> usize {
        buf[0] = TAG_EVENT;
        match ev {
            RtEvent::Xrun { dropped } => {
                buf[1] = SUB_XRUN;
                buf[2..6].copy_from_slice(&dropped.to_le_bytes());
                6
            }
            RtEvent::NodeFault { node, fault } => {
                buf[1] = SUB_NODE_FAULT;
                buf[2..6].copy_from_slice(&node.0.to_le_bytes());
                buf[6] = match fault {
                    FaultKind::NonFinite => FAULT_NON_FINITE,
                    FaultKind::OverBudget => FAULT_OVER_BUDGET,
                    FaultKind::AutoBypassed => FAULT_AUTO_BYPASSED,
                    FaultKind::Crashed => FAULT_CRASHED,
                };
                7
            }
            RtEvent::LooperEdge { node, from, to } => {
                buf[1] = SUB_LOOPER_EDGE;
                buf[2..6].copy_from_slice(&node.0.to_le_bytes());
                buf[6] = from;
                buf[7] = to;
                8
            }
            RtEvent::RingFull => {
                buf[1] = SUB_RING_FULL;
                2
            }
        }
    }

    /// Decode one event frame. Returns `None` on unknown sub-kind or truncation.
    pub fn decode(bytes: &[u8]) -> Option<RtEvent> {
        match (*bytes.first()?, bytes.get(1).copied()) {
            (TAG_EVENT, Some(SUB_XRUN)) if bytes.len() >= 6 => {
                let dropped = u32::from_le_bytes(bytes[2..6].try_into().ok()?);
                Some(RtEvent::Xrun { dropped })
            }
            (TAG_EVENT, Some(SUB_NODE_FAULT)) if bytes.len() >= 7 => {
                let node = NodeIdx(u32::from_le_bytes(bytes[2..6].try_into().ok()?));
                let fault = match bytes[6] {
                    FAULT_NON_FINITE => FaultKind::NonFinite,
                    FAULT_OVER_BUDGET => FaultKind::OverBudget,
                    FAULT_AUTO_BYPASSED => FaultKind::AutoBypassed,
                    FAULT_CRASHED => FaultKind::Crashed,
                    _ => return None,
                };
                Some(RtEvent::NodeFault { node, fault })
            }
            (TAG_EVENT, Some(SUB_LOOPER_EDGE)) if bytes.len() >= 8 => {
                let node = NodeIdx(u32::from_le_bytes(bytes[2..6].try_into().ok()?));
                let from = bytes[6];
                let to = bytes[7];
                Some(RtEvent::LooperEdge { node, from, to })
            }
            (TAG_EVENT, Some(SUB_RING_FULL)) => Some(RtEvent::RingFull),
            _ => None,
        }
    }

    /// RT-safe event emit: encode `ev` into a stack buffer and publish it.
    #[cfg(feature = "std")]
    #[inline]
    pub fn emit(ring: &super::EventRing, ev: RtEvent) -> bool {
        let mut buf = [0u8; MAX_LEN];
        let n = encode(ev, &mut buf);
        ring.push(&buf[..n])
    }

    /// Off-RT consumer of the event ring.
    #[cfg(feature = "std")]
    pub fn drain_events(ring: &super::EventRing, mut on_event: impl FnMut(RtEvent)) {
        let mut buf = [0u8; MAX_LEN];
        while let Some(n) = ring.pop(&mut buf) {
            if let Some(ev) = decode(&buf[..n]) {
                on_event(ev);
            }
        }
    }
}

/// The RT -> control return ring (host side). A reused [`ojcore_midiring::ByteRing`]
/// of 8 KiB, big enough to absorb a full block's worth of per-node meter frames
/// plus a beat frame between control-thread drains. `std`-gated because it is a
/// native host return path; the wasm worklet uses its own SAB ring.
#[cfg(feature = "std")]
pub type MeterRing = ojcore_midiring::ByteRing<8192>;

/// The RT -> control EVENT return ring (host side). A separate ring so a fault
/// storm can never back-pressure or evict per-node meter frames.
#[cfg(feature = "std")]
pub type EventRing = ojcore_midiring::ByteRing<16384>;

#[cfg(test)]
mod tests {
    use super::*;
    use ojproto::{EngineFrame, FaultKind, NodeIdx, RtEvent};

    #[test]
    fn rms_matches_known_signal() {
        // A constant 0.5 signal has RMS 0.5 and peak 0.5.
        let mut m = Meter::new();
        let block = [0.5f32; 256];
        m.accumulate(&block);
        assert!((m.rms() - 0.5).abs() < 1e-6, "rms {}", m.rms());
        assert!((m.peak() - 0.5).abs() < 1e-6);
    }

    #[test]
    fn rms_of_full_scale_sine_is_root_half() {
        // RMS of a unit sine is 1/sqrt(2) ~= 0.70710678; peak is 1.0.
        let mut m = Meter::new();
        let n = 48_000usize;
        let mut buf = vec![0.0f32; n];
        for (i, s) in buf.iter_mut().enumerate() {
            *s = libm::sinf(core::f32::consts::TAU * 440.0 * i as f32 / 48_000.0);
        }
        m.accumulate(&buf);
        let expected = 1.0 / core::f32::consts::SQRT_2;
        assert!(
            (m.rms() - expected).abs() < 1e-3,
            "rms {}, expected {expected}",
            m.rms()
        );
        assert!((m.peak() - 1.0).abs() < 1e-2, "peak {}", m.peak());
    }

    #[test]
    fn silence_meters_zero() {
        let mut m = Meter::new();
        m.accumulate(&[0.0f32; 128]);
        assert_eq!(m.rms(), 0.0);
        assert_eq!(m.peak(), 0.0);
    }

    #[test]
    fn take_resets_window() {
        let mut m = Meter::new();
        m.accumulate(&[1.0f32; 64]);
        let (rms, peak) = m.take();
        assert!((rms - 1.0).abs() < 1e-6);
        assert!((peak - 1.0).abs() < 1e-6);
        // Reset: a fresh window reads zero.
        assert_eq!(m.rms(), 0.0);
        assert_eq!(m.peak(), 0.0);
    }

    #[test]
    fn bank_sizes_and_resizes() {
        let mut bank = MeterBank::with_nodes(3);
        assert_eq!(bank.nodes.len(), 3);
        assert!(!bank.enabled);
        bank.resize(5);
        assert_eq!(bank.nodes.len(), 5);
    }

    #[test]
    fn return_frame_meter_roundtrips() {
        let mut buf = [0u8; return_frame::MAX_LEN];
        let n = return_frame::encode_meter(NodeIdx(42), 0.25, 0.9, &mut buf);
        assert_eq!(n, return_frame::METER_LEN);
        match return_frame::decode(&buf[..n]) {
            Some(EngineFrame::Meter { node, rms, peak }) => {
                assert_eq!(node, NodeIdx(42));
                assert!((rms - 0.25).abs() < 1e-6);
                assert!((peak - 0.9).abs() < 1e-6);
            }
            other => panic!("expected Meter, got {other:?}"),
        }
    }

    #[test]
    fn return_frame_beat_roundtrips() {
        let mut buf = [0u8; return_frame::MAX_LEN];
        let n = return_frame::encode_beat(3, 2, 0.5, &mut buf);
        assert_eq!(n, return_frame::BEAT_LEN);
        match return_frame::decode(&buf[..n]) {
            Some(EngineFrame::Beat { bar, beat, phase }) => {
                assert_eq!((bar, beat), (3, 2));
                assert!((phase - 0.5).abs() < 1e-6);
            }
            other => panic!("expected Beat, got {other:?}"),
        }
    }

    #[test]
    fn return_frame_looper_roundtrips() {
        let mut buf = [0u8; return_frame::MAX_LEN];
        let n = return_frame::encode_looper(NodeIdx(7), 3, 1024, 48_000, 0.5, &mut buf);
        assert_eq!(n, return_frame::LOOPER_LEN);
        match return_frame::decode(&buf[..n]) {
            Some(EngineFrame::Looper {
                node,
                state,
                pos,
                loop_len,
                peak,
            }) => {
                assert_eq!(node, NodeIdx(7));
                assert_eq!(state, 3);
                assert_eq!(pos, 1024);
                assert_eq!(loop_len, 48_000);
                assert!((peak - 0.5).abs() < 1e-6);
            }
            other => panic!("expected Looper, got {other:?}"),
        }
    }

    #[test]
    fn return_frame_rejects_garbage() {
        assert!(return_frame::decode(&[]).is_none());
        assert!(return_frame::decode(&[0xFF, 0, 0, 0]).is_none());
        // Correct tag but truncated frame.
        assert!(return_frame::decode(&[return_frame::TAG_METER, 1, 2]).is_none());
    }

    fn assert_event_roundtrips(ev: RtEvent) {
        let mut buf = [0u8; event_frame::MAX_LEN];
        let n = event_frame::encode(ev, &mut buf);
        assert!(n <= event_frame::MAX_LEN);
        assert_eq!(buf[0], event_frame::TAG_EVENT);
        assert_eq!(event_frame::decode(&buf[..n]), Some(ev));
    }

    #[test]
    fn event_frame_roundtrips_every_variant() {
        assert_event_roundtrips(RtEvent::Xrun { dropped: 7 });
        assert_event_roundtrips(RtEvent::NodeFault {
            node: NodeIdx(42),
            fault: FaultKind::NonFinite,
        });
        assert_event_roundtrips(RtEvent::NodeFault {
            node: NodeIdx(0),
            fault: FaultKind::OverBudget,
        });
        assert_event_roundtrips(RtEvent::NodeFault {
            node: NodeIdx(u32::MAX),
            fault: FaultKind::AutoBypassed,
        });
        assert_event_roundtrips(RtEvent::NodeFault {
            node: NodeIdx(5),
            fault: FaultKind::Crashed,
        });
        assert_event_roundtrips(RtEvent::LooperEdge {
            node: NodeIdx(7),
            from: 2,
            to: 3,
        });
        assert_event_roundtrips(RtEvent::LooperEdge {
            node: NodeIdx(u32::MAX),
            from: 0,
            to: 4,
        });
        assert_event_roundtrips(RtEvent::RingFull);
    }

    #[test]
    fn event_frame_rejects_garbage() {
        assert!(event_frame::decode(&[]).is_none());
        assert!(event_frame::decode(&[0xFF, event_frame::SUB_XRUN, 0, 0, 0, 0]).is_none());
        assert!(event_frame::decode(&[event_frame::TAG_EVENT, 0x7F]).is_none());
        assert!(event_frame::decode(&[event_frame::TAG_EVENT]).is_none());
        assert!(
            event_frame::decode(&[event_frame::TAG_EVENT, event_frame::SUB_XRUN, 1, 2]).is_none()
        );
        assert!(event_frame::decode(&[
            event_frame::TAG_EVENT,
            event_frame::SUB_NODE_FAULT,
            1,
            0,
            0,
            0,
            0x7F,
        ])
        .is_none());
    }

    #[cfg(feature = "std")]
    #[test]
    fn drain_events_yields_pushed_sequence_fifo() {
        let ring = EventRing::new();
        let pushed = [
            RtEvent::Xrun { dropped: 3 },
            RtEvent::NodeFault {
                node: NodeIdx(7),
                fault: FaultKind::NonFinite,
            },
            RtEvent::RingFull,
        ];
        for &ev in &pushed {
            assert!(event_frame::emit(&ring, ev), "ring should accept {ev:?}");
        }

        let mut drained = Vec::new();
        event_frame::drain_events(&ring, |ev| drained.push(ev));
        assert_eq!(drained, pushed);
    }
}
