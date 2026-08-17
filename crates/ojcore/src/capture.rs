//! Wait-free realtime capture seam shared by loopers and timeline recording.
//!
//! PCM retains the historical all-`f32` framing (`node`, `len`, samples). Rare
//! timestamped events use an independent typed ring, so no `u64` is ever encoded
//! through a float and the established looper sample path remains unchanged.

use std::collections::HashMap;
use std::vec::Vec;

use ojproto::{CaptureMark, NodeIdx};
use rtrb::{Consumer, Producer, RingBuffer};

pub const DEFAULT_RING_FRAMES: usize = 48_000;
pub const DEFAULT_MARK_CAPACITY: usize = 1024;

/// Realtime producer. Both pushes are wait-free and allocation-free.
pub struct CaptureSink {
    pcm_tx: Producer<f32>,
    mark_tx: Producer<CaptureMark>,
    dropped_pcm: u64,
    dropped_marks: u64,
}

impl CaptureSink {
    /// Historical looper framing, deliberately kept byte-for-byte equivalent.
    #[inline]
    pub fn capture(&mut self, node: u32, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let need = samples.len() + 2;
        if self.pcm_tx.slots() < need {
            self.dropped_pcm = self.dropped_pcm.wrapping_add(need as u64);
            return;
        }
        let _ = self.pcm_tx.push(node as f32);
        let _ = self.pcm_tx.push(samples.len() as f32);
        for &sample in samples {
            let _ = self.pcm_tx.push(sample);
        }
    }

    #[inline]
    pub fn mark(&mut self, node: u32, kind: u8, at_frame: u64, payload: u32) {
        if self
            .mark_tx
            .push(CaptureMark {
                node: NodeIdx(node),
                kind,
                at_frame,
                payload,
            })
            .is_err()
        {
            self.dropped_marks = self.dropped_marks.wrapping_add(1);
        }
    }

    #[inline]
    pub fn dropped(&self) -> u64 {
        self.dropped_pcm
    }

    #[inline]
    pub fn dropped_marks(&self) -> u64 {
        self.dropped_marks
    }
}

/// Off-realtime consumer/demultiplexer.
pub struct Capture {
    pcm_rx: Consumer<f32>,
    mark_rx: Consumer<CaptureMark>,
    pcm: HashMap<u32, Vec<f32>>,
    pending: Option<(u32, usize)>,
}

impl Capture {
    pub fn new(ring_frames: usize) -> (Self, CaptureSink) {
        Self::with_capacities(ring_frames, DEFAULT_MARK_CAPACITY)
    }

    pub fn with_capacities(ring_frames: usize, mark_capacity: usize) -> (Self, CaptureSink) {
        let (pcm_tx, pcm_rx) = RingBuffer::<f32>::new(ring_frames.max(4));
        let (mark_tx, mark_rx) = RingBuffer::<CaptureMark>::new(mark_capacity.max(1));
        (
            Self {
                pcm_rx,
                mark_rx,
                pcm: HashMap::new(),
                pending: None,
            },
            CaptureSink {
                pcm_tx,
                mark_tx,
                dropped_pcm: 0,
                dropped_marks: 0,
            },
        )
    }

    pub fn with_default_ring() -> (Self, CaptureSink) {
        Self::new(DEFAULT_RING_FRAMES)
    }

    pub fn drain(&mut self) {
        loop {
            let (node, mut remaining) = match self.pending.take() {
                Some(pending) => pending,
                None => {
                    let Ok(node) = self.pcm_rx.pop() else {
                        break;
                    };
                    let Ok(len) = self.pcm_rx.pop() else {
                        break;
                    };
                    (node as u32, len as usize)
                }
            };
            let buf = self.pcm.entry(node).or_default();
            while remaining > 0 {
                match self.pcm_rx.pop() {
                    Ok(sample) => {
                        buf.push(sample);
                        remaining -= 1;
                    }
                    Err(_) => {
                        self.pending = Some((node, remaining));
                        return;
                    }
                }
            }
        }
    }

    pub fn pop_mark(&mut self) -> Option<CaptureMark> {
        self.mark_rx.pop().ok()
    }

    pub fn drain_marks(&mut self, sink: &mut Vec<CaptureMark>) -> usize {
        let before = sink.len();
        while let Ok(mark) = self.mark_rx.pop() {
            sink.push(mark);
        }
        sink.len() - before
    }

    pub fn take(&mut self, node: u32, loop_len: usize) -> Option<Vec<f32>> {
        self.drain();
        let buf = self.pcm.get_mut(&node)?;
        if buf.is_empty() {
            return None;
        }
        let pcm = if loop_len > 0 && buf.len() >= loop_len {
            buf.split_off(buf.len() - loop_len)
        } else {
            std::mem::take(buf)
        };
        self.pcm.remove(&node);
        (!pcm.is_empty()).then_some(pcm)
    }

    pub fn discard(&mut self, node: u32) {
        self.pcm.remove(&node);
    }

    pub fn accumulated(&self, node: u32) -> usize {
        self.pcm.get(&node).map_or(0, Vec::len)
    }

    /// Node ids currently holding drained PCM (off-RT diagnostics/butler use).
    pub fn nodes(&self) -> impl Iterator<Item = u32> + '_ {
        self.pcm.keys().copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ojproto::capture_mark_kind;

    #[test]
    fn historical_pcm_framing_and_take_are_unchanged() {
        let (mut capture, mut sink) = Capture::new(4096);
        let a: Vec<f32> = (0..32).map(|i| i as f32 * 0.01).collect();
        let b: Vec<f32> = (0..32).map(|i| -(i as f32) * 0.02).collect();
        sink.capture(7, &a);
        sink.capture(7, &b);
        capture.drain();
        assert_eq!(capture.accumulated(7), 64);
        assert_eq!(capture.take(7, 32).as_deref(), Some(b.as_slice()));
    }

    #[test]
    fn marks_are_independent_and_keep_full_frame_timestamp() {
        let (mut capture, mut sink) = Capture::new(64);
        let at = (1_u64 << 54) + 17;
        sink.capture(2, &[0.25, -0.25]);
        sink.mark(2, capture_mark_kind::NOTE_ON, at, 60 | (101 << 8));
        assert_eq!(capture.take(2, 0).unwrap(), vec![0.25, -0.25]);
        let mark = capture.pop_mark().unwrap();
        assert_eq!(mark.at_frame, at);
        assert_eq!(mark.payload, 60 | (101 << 8));
    }

    #[test]
    fn oversized_pcm_frame_drops_whole_frame() {
        let (mut capture, mut sink) = Capture::new(8);
        sink.capture(9, &[0.0; 32]);
        assert!(sink.dropped() >= 34);
        capture.drain();
        assert_eq!(capture.accumulated(9), 0);
    }
}
