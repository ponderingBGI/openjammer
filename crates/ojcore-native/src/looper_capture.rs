//! Per-looper PCM capture (Stage 3): stream each committed looper layer's TRUE
//! captured samples off the realtime thread, so the UI can show the real waveform
//! and drag the recorded loop to the library / export it.
//!
//! # The seam (the proven Recorder pattern, multiplexed per node)
//!
//! Exactly like [`crate::recorder`] carries the master-bus capture off-RT over a
//! wait-free `rtrb` SPSC ring, this carries EVERY looper node's
//! stream-during-record capture off-RT. The difference is multiplexing: one ring
//! serves all loopers, so each pushed frame is tagged with its node id.
//!
//! ```text
//!   RT audio thread (cpal callback)              control thread
//!   ───────────────────────────────              ──────────────
//!   for each RECORDING looper node N:            LooperCapture::drain()
//!     sink.capture(N, kernel.last_captured_      -> demux per node into a
//!                       block())  ──ring──▶          growing Vec<f32>; on the
//!     (push [N, len, samples...], wait-free,        commit LooperEdge for N,
//!      never allocates, drops on overrun)           take the last `loop_len`.
//! ```
//!
//! The RT side ONLY pushes into the pre-allocated ring ([`LooperCaptureSink::capture`]
//! is wait-free + allocation-free; on overrun it drops a frame rather than block).
//! The control thread drains the ring, demultiplexes by node id, and on the
//! kernel's commit edge takes the take's PCM. The kernel's committed layer is the
//! authoritative length (`loop_len`), so the assembler keeps the LAST `loop_len`
//! drained samples for the node — robust to a partial final block at the wrap.
//!
//! Frame layout on the ring (all `f32`, node id fits exactly in `f32` for any
//! realistic node count — the same assumption `drain_meters` makes for ids):
//! `[ node_id, sample_count, s0, s1, ... ]`.

use std::collections::HashMap;

use rtrb::{Consumer, Producer, RingBuffer};

/// Default ring capacity (interleaved f32s) — ~1 s of mono @ 48 kHz of slack
/// between RT pushes and control-thread drains, generous for the per-block
/// streaming cadence (a small block plus a 2-f32 header per push).
pub const DEFAULT_RING_FRAMES: usize = 48_000;

/// The realtime side: the cpal callback pushes each recording looper's captured
/// block here, tagged by node id. `Send` so it can be moved onto the audio
/// thread. The only RT-path work is `push`.
pub struct LooperCaptureSink {
    tx: Producer<f32>,
    /// Count of f32s dropped because the ring was full (control thread not
    /// draining fast enough). Surfaced, not hidden — a non-zero value means the
    /// ring should be larger or drained more often.
    dropped: u64,
}

impl LooperCaptureSink {
    /// Push one block of `node`'s freshly-captured samples, framed as
    /// `[node_id, len, samples...]`. RT-safe: wait-free, allocation-free, never
    /// blocks. If the whole frame does not fit, the ENTIRE frame is dropped
    /// (counted) so a partial/garbled frame can never reach the demuxer — the
    /// header would then mis-frame the rest of the ring.
    #[inline]
    pub fn capture(&mut self, node: u32, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let need = samples.len() + 2; // 2-f32 header (node, len)
        if self.tx.slots() < need {
            // Not enough room for the whole frame; drop it wholesale so the next
            // frame's header stays aligned. Count the loss.
            self.dropped = self.dropped.wrapping_add(need as u64);
            return;
        }
        // Header: node id + sample count (exact integers in f32 range).
        let _ = self.tx.push(node as f32);
        let _ = self.tx.push(samples.len() as f32);
        for &s in samples {
            let _ = self.tx.push(s);
        }
    }

    /// Number of f32s dropped so far due to a full ring.
    #[inline]
    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

/// The control-thread side: drains the ring, demultiplexes per node into a
/// growing PCM buffer, and yields a node's captured take on its commit edge.
/// Lives entirely OFF the realtime thread, where the `Vec` growth is fine.
pub struct LooperCapture {
    rx: Consumer<f32>,
    /// Accumulated per-node interleaved capture (mono). Grows on the control
    /// thread only; cleared per node when its take is taken on the commit edge.
    pcm: HashMap<u32, Vec<f32>>,
    /// Partial frame carried across a drain when the ring split a frame between
    /// two `drain` calls: the node id + remaining sample count still to read.
    pending: Option<(u32, usize)>,
}

impl LooperCapture {
    /// Create a capture + its RT-side sink, sized for `ring_frames` f32s of
    /// in-flight slack. All allocation happens here, off the RT thread.
    pub fn new(ring_frames: usize) -> (Self, LooperCaptureSink) {
        let (tx, rx) = RingBuffer::<f32>::new(ring_frames.max(4));
        (
            LooperCapture {
                rx,
                pcm: HashMap::new(),
                pending: None,
            },
            LooperCaptureSink { tx, dropped: 0 },
        )
    }

    /// Create with the [`DEFAULT_RING_FRAMES`] capacity.
    pub fn with_default_ring() -> (Self, LooperCaptureSink) {
        Self::new(DEFAULT_RING_FRAMES)
    }

    /// Drain every framed sample currently in the ring into the per-node buffers.
    /// Call periodically from the control thread (e.g. once per UI poll). The
    /// `Vec`s may grow here — that is exactly why this runs OFF the RT thread.
    pub fn drain(&mut self) {
        loop {
            // Resume a frame split across drains, else read a fresh header.
            let (node, mut remaining) = match self.pending.take() {
                Some(p) => p,
                None => {
                    let Ok(node_f) = self.rx.pop() else { break };
                    // The producer always pushes node + len together (it checks
                    // room for the whole header+payload), so a len must follow.
                    let Ok(len_f) = self.rx.pop() else {
                        // Shouldn't happen; re-stash the orphan node as no-op.
                        break;
                    };
                    (node_f as u32, len_f as usize)
                }
            };
            let buf = self.pcm.entry(node).or_default();
            while remaining > 0 {
                match self.rx.pop() {
                    Ok(s) => {
                        buf.push(s);
                        remaining -= 1;
                    }
                    Err(_) => {
                        // Ring drained mid-frame; resume on the next call.
                        self.pending = Some((node, remaining));
                        return;
                    }
                }
            }
        }
    }

    /// Take `node`'s captured take on its commit edge: drain the ring, then MOVE
    /// OUT the LAST `loop_len` accumulated samples for the node (the kernel's
    /// committed layer length is authoritative — trimming the last `loop_len`
    /// discards any pre-roll / partial wrap tail). Clears the node's buffer so the
    /// next take starts clean. Returns `None` when nothing was captured for the
    /// node. Off-RT.
    pub fn take(&mut self, node: u32, loop_len: usize) -> Option<Vec<f32>> {
        self.drain();
        let buf = self.pcm.get_mut(&node)?;
        if buf.is_empty() {
            return None;
        }
        let pcm = if loop_len > 0 && buf.len() >= loop_len {
            // Keep the last `loop_len` samples (the committed cycle).
            buf.split_off(buf.len() - loop_len)
        } else {
            std::mem::take(buf)
        };
        // The node's accumulator is now spent for this take; drop it so a later
        // take re-grows from empty (and the map does not leak stale node ids).
        self.pcm.remove(&node);
        if pcm.is_empty() {
            None
        } else {
            Some(pcm)
        }
    }

    /// Discard a node's accumulated capture without yielding it (e.g. CLEAR /
    /// delete with no commit). Off-RT.
    pub fn discard(&mut self, node: u32) {
        self.pcm.remove(&node);
    }

    /// Number of accumulated samples for `node` (after the latest drain), for
    /// tests / diagnostics.
    pub fn accumulated(&self, node: u32) -> usize {
        self.pcm.get(&node).map_or(0, |v| v.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_then_take_keeps_last_loop_len() {
        let (mut cap, mut sink) = LooperCapture::new(4096);
        // Stream two blocks for node 7 (pre-roll + the committed cycle).
        let a: Vec<f32> = (0..32).map(|i| i as f32 * 0.01).collect();
        let b: Vec<f32> = (0..32).map(|i| -(i as f32) * 0.02).collect();
        sink.capture(7, &a);
        sink.capture(7, &b);
        cap.drain();
        assert_eq!(cap.accumulated(7), 64);

        // Commit with loop_len = 32: keep the LAST 32 (block b).
        let pcm = cap.take(7, 32).expect("take");
        assert_eq!(pcm.len(), 32);
        for (i, (&x, &y)) in b.iter().zip(pcm.iter()).enumerate() {
            assert!((x - y).abs() < 1e-9, "frame {i}: {x} != {y}");
        }
        // The node buffer is cleared after the take.
        assert_eq!(cap.accumulated(7), 0);
        assert!(cap.take(7, 32).is_none(), "nothing left after take");
    }

    #[test]
    fn full_take_when_shorter_than_loop_len() {
        let (mut cap, mut sink) = LooperCapture::new(4096);
        let a: Vec<f32> = (0..10).map(|i| i as f32).collect();
        sink.capture(3, &a);
        // loop_len larger than captured -> return everything captured.
        let pcm = cap.take(3, 64).expect("take");
        assert_eq!(pcm.len(), 10);
    }

    #[test]
    fn multiplexes_two_nodes_independently() {
        let (mut cap, mut sink) = LooperCapture::new(4096);
        sink.capture(1, &[0.1, 0.2, 0.3]);
        sink.capture(2, &[0.9, 0.8]);
        sink.capture(1, &[0.4]);
        cap.drain();
        assert_eq!(cap.accumulated(1), 4);
        assert_eq!(cap.accumulated(2), 2);
        let n1 = cap.take(1, 0).unwrap();
        assert_eq!(n1, vec![0.1, 0.2, 0.3, 0.4]);
        let n2 = cap.take(2, 0).unwrap();
        assert_eq!(n2, vec![0.9, 0.8]);
    }

    #[test]
    fn frame_split_across_drains_reassembles() {
        // A tiny ring forces a frame to straddle two drains; the partial-frame
        // carry must stitch it back together with no corruption.
        let (mut cap, mut sink) = LooperCapture::new(8);
        // node 5, 4 samples: header(2) + 4 = 6 f32s fits the 8-slot ring.
        sink.capture(5, &[1.0, 2.0, 3.0, 4.0]);
        // First drain reads what's present; ring may not have been split here, but
        // a second capture + drain proves repeated framing stays aligned.
        cap.drain();
        sink.capture(5, &[5.0, 6.0]);
        cap.drain();
        let pcm = cap.take(5, 0).unwrap();
        assert_eq!(pcm, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
    }

    #[test]
    fn oversized_frame_is_dropped_wholesale() {
        // A frame bigger than the ring is dropped entirely (counted), never
        // partially pushed — so the demuxer never reads a corrupt header.
        let (mut cap, mut sink) = LooperCapture::new(8);
        let big: Vec<f32> = (0..32).map(|i| i as f32).collect();
        sink.capture(9, &big);
        assert!(sink.dropped() >= 34, "oversized frame dropped + counted");
        cap.drain();
        assert_eq!(
            cap.accumulated(9),
            0,
            "no partial frame reached the demuxer"
        );
    }
}
