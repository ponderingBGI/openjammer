//! Compatibility names for the generalized `ojcore::capture` seam.
//!
//! The looper continues to call the same `capture(node, samples)` method and the
//! PCM frame layout is unchanged; timeline capture additionally uses the mark
//! ring owned by the same producer/consumer pair.

pub use ojcore::capture::{
    Capture as LooperCapture, CaptureSink as LooperCaptureSink, DEFAULT_RING_FRAMES,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_then_take_keeps_last_loop_len() {
        let (mut cap, mut sink) = LooperCapture::new(4096);
        let a: Vec<f32> = (0..32).map(|i| i as f32 * 0.01).collect();
        let b: Vec<f32> = (0..32).map(|i| -(i as f32) * 0.02).collect();
        sink.capture(7, &a);
        sink.capture(7, &b);
        cap.drain();
        assert_eq!(cap.accumulated(7), 64);
        assert_eq!(cap.take(7, 32).as_deref(), Some(b.as_slice()));
        assert_eq!(cap.accumulated(7), 0);
    }

    #[test]
    fn multiplexes_two_nodes_independently() {
        let (mut cap, mut sink) = LooperCapture::new(4096);
        sink.capture(1, &[0.1, 0.2, 0.3]);
        sink.capture(2, &[0.9, 0.8]);
        sink.capture(1, &[0.4]);
        cap.drain();
        assert_eq!(cap.take(1, 0).unwrap(), vec![0.1, 0.2, 0.3, 0.4]);
        assert_eq!(cap.take(2, 0).unwrap(), vec![0.9, 0.8]);
    }

    #[test]
    fn oversized_frame_is_dropped_wholesale() {
        let (mut cap, mut sink) = LooperCapture::new(8);
        sink.capture(9, &[0.0; 32]);
        assert!(sink.dropped() >= 34);
        cap.drain();
        assert_eq!(cap.accumulated(9), 0);
    }
}
