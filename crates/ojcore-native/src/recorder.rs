//! The native RECORDER capability (U-STATEFUL): capture a node/bus output into a
//! growable PCM buffer, then store it in the [`AssetCatalog`] and/or export it to
//! WAV via the [`AssetStore`].
//!
//! # Off-RT design (the whole point)
//!
//! Recording grows a `Vec<f32>`, and `Vec` growth allocates — which is forbidden
//! on the realtime audio thread. So the capture path is split across a wait-free
//! SPSC ring (`rtrb`, the same ring the engine's command queue uses):
//!
//! ```text
//!   RT audio thread                         control thread
//!   ───────────────                         ──────────────
//!   RecorderSink::capture(&block)  ──ring──▶ Recorder::drain()  -> grows Vec
//!     (push f32s, never blocks,                (pull f32s off the ring into the
//!      never allocates, drops on                growable PCM buffer; allocation
//!      overrun)                                 happens HERE, off the RT thread)
//! ```
//!
//! The RT thread ONLY pushes into the pre-allocated ring (`capture` is
//! allocation-free and wait-free; on overrun it counts a dropped frame rather
//! than blocking or growing). The control thread drains the ring at its leisure
//! and appends to the recording's `Vec<f32>`, exactly mirroring the existing
//! off-RT recording philosophy in `asset.rs` / `store.rs` (the audio thread never
//! decodes, encodes, or allocates).
//!
//! When recording stops, [`Recorder::finish`] yields a [`Pcm`] (interleaved
//! f32s + channel/rate spec), which [`Recorder::store`] hands to the
//! [`AssetCatalog`] (content-addressed, deduplicating) and which
//! [`AssetStore`] encodes to a WAV — so a captured signal round-trips through
//! the exact same decode/encode path as any loaded sample.
//!
//! This is a host-side capture API, deliberately NOT a `DspInstance`: the RT loop
//! needs no per-node state to record a bus, and keeping the ring on the host side
//! means the engine core stays `no_std`/wasm-clean (the recorder is native-only).

use rtrb::{Consumer, Producer, RingBuffer};

use crate::asset::{AssetError, AssetStore, Pcm};
use crate::store::AssetCatalog;
use ojproto::AssetId;

/// Default ring capacity (interleaved f32 frames) when none is given. ~0.5 s of
/// stereo @ 48 kHz of slack between RT pushes and control-thread drains.
pub const DEFAULT_RING_FRAMES: usize = 48_000;

/// The realtime side of a recorder: a wait-free producer the audio callback
/// pushes captured samples into. `Send` so it can be moved onto the audio
/// thread. Cheap to hold; all it does on the RT path is `push`.
pub struct RecorderSink {
    tx: Producer<f32>,
    /// Count of interleaved samples that could not be pushed (ring full). Lets
    /// the control side detect an under-drained ring without any RT-path branch
    /// beyond a single increment.
    dropped: u64,
}

impl RecorderSink {
    /// Push one block of interleaved samples into the ring. RT-safe: wait-free,
    /// allocation-free, never blocks. Samples that do not fit (ring full because
    /// the control thread has not drained yet) are dropped and counted — the
    /// audio thread is NEVER stalled to wait for the consumer.
    #[inline]
    pub fn capture(&mut self, interleaved: &[f32]) {
        for &s in interleaved {
            if self.tx.push(s).is_err() {
                self.dropped = self.dropped.wrapping_add(1);
            }
        }
    }

    /// Number of interleaved samples dropped so far due to a full ring. A
    /// non-zero value means the control thread is not draining fast enough (the
    /// fix is a larger ring or more frequent drains), surfaced rather than hidden.
    #[inline]
    pub fn dropped(&self) -> u64 {
        self.dropped
    }
}

/// The control-thread side of a recorder: drains the ring into a growing PCM
/// buffer, then stores/exports it. Lives entirely OFF the realtime thread, where
/// allocation (the `Vec` growth) is fine.
pub struct Recorder {
    rx: Consumer<f32>,
    /// The accumulated interleaved capture. Grows on the control thread only.
    pcm: Vec<f32>,
    channels: u16,
    sample_rate: u32,
}

impl Recorder {
    /// Create a recorder + its RT-side sink, sized for `ring_frames` interleaved
    /// samples of in-flight slack. `channels` / `sample_rate` describe the bus
    /// being captured (used to stamp the resulting [`Pcm`]). All allocation
    /// happens here, off the RT thread; nothing on the capture/drain hot paths
    /// allocates.
    pub fn new(channels: u16, sample_rate: u32, ring_frames: usize) -> (Self, RecorderSink) {
        let (tx, rx) = RingBuffer::<f32>::new(ring_frames.max(1));
        let recorder = Recorder {
            rx,
            pcm: Vec::new(),
            channels: channels.max(1),
            sample_rate: sample_rate.max(1),
        };
        let sink = RecorderSink { tx, dropped: 0 };
        (recorder, sink)
    }

    /// Create a recorder with the [`DEFAULT_RING_FRAMES`] capacity.
    pub fn with_default_ring(channels: u16, sample_rate: u32) -> (Self, RecorderSink) {
        Self::new(channels, sample_rate, DEFAULT_RING_FRAMES)
    }

    /// Drain every sample currently in the ring into the growing PCM buffer.
    /// Call periodically from the control thread (e.g. once per UI tick). Returns
    /// the number of interleaved samples drained this call. The `Vec` may grow
    /// here — that is exactly why this runs OFF the RT thread.
    pub fn drain(&mut self) -> usize {
        let mut n = 0;
        while let Ok(s) = self.rx.pop() {
            self.pcm.push(s);
            n += 1;
        }
        n
    }

    /// Number of interleaved samples captured so far (after the latest drain).
    pub fn captured_samples(&self) -> usize {
        self.pcm.len()
    }

    /// Number of frames captured so far (`captured_samples / channels`).
    pub fn captured_frames(&self) -> usize {
        self.pcm.len() / self.channels as usize
    }

    /// Whether nothing has been captured yet.
    pub fn is_empty(&self) -> bool {
        self.pcm.is_empty()
    }

    /// Discard any buffered capture: drain and drop everything still in the ring,
    /// then clear the accumulated PCM. Called when ARMING a fresh recording so a
    /// new capture never inherits a previous session's tail. Off-RT.
    pub fn reset(&mut self) {
        while self.rx.pop().is_ok() {}
        self.pcm.clear();
    }

    /// Drain the ring and MOVE OUT the captured PCM, leaving the recorder empty
    /// and ready to capture again (the RT-side [`RecorderSink`] keeps working).
    /// Ends a recording WITHOUT consuming the recorder. Off-RT.
    pub fn take(&mut self) -> Pcm {
        self.drain();
        Pcm {
            samples: std::mem::take(&mut self.pcm),
            channels: self.channels,
            sample_rate: self.sample_rate,
        }
    }

    /// Drain any remaining samples and snapshot the capture as a [`Pcm`] WITHOUT
    /// consuming the recorder (so capture can continue afterwards). Use
    /// [`Recorder::finish`] to take ownership and end the recording.
    pub fn snapshot(&mut self) -> Pcm {
        self.drain();
        Pcm {
            samples: self.pcm.clone(),
            channels: self.channels,
            sample_rate: self.sample_rate,
        }
    }

    /// Drain any remaining samples and CONSUME the recorder, yielding the final
    /// captured [`Pcm`]. The RT-side [`RecorderSink`] should already be dropped
    /// (recording stopped) before calling this.
    pub fn finish(mut self) -> Pcm {
        self.drain();
        Pcm {
            samples: self.pcm,
            channels: self.channels,
            sample_rate: self.sample_rate,
        }
    }

    /// Finish the recording and store it in `catalog`, returning its
    /// content-addressed [`AssetId`]. The capture round-trips through the SAME
    /// content-addressed store any loaded sample uses.
    pub fn store(self, catalog: &mut AssetCatalog) -> Result<AssetId, AssetError> {
        let pcm = self.finish();
        catalog.insert(pcm)
    }

    /// Finish the recording and export it to a WAV file at `path` via the
    /// [`AssetStore`] (32-bit float WAV — lossless round-trip).
    pub fn export_wav<P: AsRef<std::path::Path>>(
        self,
        store: &AssetStore,
        path: P,
    ) -> Result<(), AssetError> {
        let pcm = self.finish();
        store.write_wav_file(path, &pcm)
    }

    /// Finish the recording and encode it to an in-memory WAV byte buffer (no
    /// filesystem). Handy for tests and for callers that hold the bytes
    /// themselves.
    pub fn export_wav_bytes(self, store: &AssetStore) -> Result<Vec<u8>, AssetError> {
        let pcm = self.finish();
        store.encode_wav_bytes(&pcm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 48_000;

    /// A deterministic mono test signal.
    fn ramp(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| (i as f32) * 0.001 - 0.25).collect()
    }

    #[test]
    fn capture_then_finish_round_trips_samples() {
        let (mut rec, mut sink) = Recorder::new(1, SR, 4096);
        let signal = ramp(1000);

        // Simulate the RT thread pushing two blocks, with control-thread drains
        // interleaved (so the ring never overruns).
        sink.capture(&signal[..500]);
        let drained = rec.drain();
        assert_eq!(drained, 500);
        sink.capture(&signal[500..]);

        // Drop the sink to "stop recording", then finish.
        drop(sink);
        let pcm = rec.finish();
        assert_eq!(pcm.channels, 1);
        assert_eq!(pcm.sample_rate, SR);
        assert_eq!(pcm.samples.len(), signal.len());
        for (i, (&a, &b)) in signal.iter().zip(pcm.samples.iter()).enumerate() {
            assert!((a - b).abs() < 1e-9, "frame {i}: {a} != {b}");
        }
    }

    #[test]
    fn export_then_decode_round_trips() {
        let (mut rec, mut sink) = Recorder::new(1, SR, 8192);
        let signal = ramp(480);
        sink.capture(&signal);
        rec.drain();
        drop(sink);

        let store = AssetStore::new();
        let bytes = rec.export_wav_bytes(&store).expect("encode");
        assert_eq!(&bytes[0..4], b"RIFF");

        // Decode the captured WAV back and compare — a full capture->WAV->decode
        // round trip of a known signal.
        let decoded = store.decode_wav_bytes(bytes).expect("decode");
        assert_eq!(decoded.channels, 1);
        assert_eq!(decoded.sample_rate, SR);
        assert_eq!(decoded.frames(), signal.len());
        for (i, (&a, &b)) in signal.iter().zip(decoded.samples.iter()).enumerate() {
            assert!((a - b).abs() < 1e-6, "frame {i}: {a} != {b}");
        }
    }

    #[test]
    fn store_into_catalog_is_content_addressed() {
        let (mut rec, mut sink) = Recorder::new(1, SR, 4096);
        let signal = ramp(256);
        sink.capture(&signal);
        rec.drain();
        drop(sink);

        let mut catalog = AssetCatalog::new();
        let id = rec.store(&mut catalog).expect("store");
        assert!(catalog.contains(id));
        // The stored PCM resolves back to the captured signal.
        let pcm = catalog.resolve(id).expect("resolve");
        assert_eq!(pcm.samples.len(), signal.len());
        for (i, (&a, &b)) in signal.iter().zip(pcm.samples.iter()).enumerate() {
            assert!((a - b).abs() < 1e-9, "frame {i}");
        }
    }

    #[test]
    fn stereo_interleaving_is_preserved() {
        let (mut rec, mut sink) = Recorder::new(2, 44_100, 4096);
        // L = +0.5, R = -0.5, interleaved.
        let frames = 100;
        let mut signal = Vec::with_capacity(frames * 2);
        for _ in 0..frames {
            signal.push(0.5);
            signal.push(-0.5);
        }
        sink.capture(&signal);
        rec.drain();
        drop(sink);

        let pcm = rec.finish();
        assert_eq!(pcm.channels, 2);
        assert_eq!(pcm.frames(), frames);
        for f in 0..frames {
            assert!((pcm.samples[f * 2] - 0.5).abs() < 1e-9, "L@{f}");
            assert!((pcm.samples[f * 2 + 1] + 0.5).abs() < 1e-9, "R@{f}");
        }
    }

    #[test]
    fn overrun_drops_are_counted_not_blocked() {
        // A tiny ring deliberately too small for the block: the excess is dropped
        // and counted, and `capture` returns promptly (never blocks/allocates).
        let (mut rec, mut sink) = Recorder::new(1, SR, 8);
        let signal = ramp(64);
        sink.capture(&signal); // ring holds at most 8; 56 dropped
        assert!(sink.dropped() >= 56, "overrun frames must be counted");
        // What did fit drains cleanly.
        let drained = rec.drain();
        assert!(drained <= 8 && drained > 0);
    }

    #[test]
    fn snapshot_does_not_end_recording() {
        let (mut rec, mut sink) = Recorder::new(1, SR, 4096);
        sink.capture(&ramp(100));
        let snap = rec.snapshot();
        assert_eq!(snap.frames(), 100);
        // Capture can continue after a snapshot.
        sink.capture(&ramp(50));
        drop(sink);
        let pcm = rec.finish();
        assert_eq!(pcm.frames(), 150);
    }
}
