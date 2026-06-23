//! A minimal WAV [`AssetStore`]: decode (via `symphonia`) and write/capture
//! (via `hound`). This is the off-RT-thread side of asset loading — the engine
//! never decodes on the audio thread; it consumes the already-decoded [`Pcm`]
//! buffers this store produces.
//!
//! Scope is deliberately tiny (governing principle: obsessive minimalism): WAV
//! in, WAV out, f32 samples. Other containers/codecs are out of scope for U7.

use std::fs::File;
use std::io::{Cursor, Write};
use std::path::Path;

use crate::fs::unique_temp_path;

/// Fsync of `path`'s parent directory so a just-completed rename survives power
/// loss. On Unix this is what makes the rename itself durable, so a failure
/// PROPAGATES (`?`). On Windows opening a directory handle this way fails and the
/// rename is durable regardless, so it stays best-effort.
fn sync_parent_dir(path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        let dir = if dir.as_os_str().is_empty() {
            Path::new(".")
        } else {
            dir
        };
        #[cfg(not(windows))]
        {
            let d = File::open(dir)?;
            d.sync_all()?;
        }
        #[cfg(windows)]
        {
            if let Ok(d) = File::open(dir) {
                let _ = d.sync_all(); // best-effort; the rename is durable regardless
            }
        }
    }
    Ok(())
}

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Decoded PCM audio: interleaved f32 samples plus the spec needed to interpret
/// them. `samples.len() == channels * frames`.
#[derive(Debug, Clone, PartialEq)]
pub struct Pcm {
    /// Interleaved samples, one f32 per (frame, channel).
    pub samples: Vec<f32>,
    /// Number of interleaved channels.
    pub channels: u16,
    /// Sample rate in Hz.
    pub sample_rate: u32,
}

impl Pcm {
    /// Number of frames (per-channel sample count).
    pub fn frames(&self) -> usize {
        if self.channels == 0 {
            0
        } else {
            self.samples.len() / self.channels as usize
        }
    }

    /// True when there are no samples.
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
}

/// Why an asset operation failed. Decode/encode errors are surfaced, never
/// swallowed.
#[derive(Debug)]
pub enum AssetError {
    /// I/O failure opening or writing a file.
    Io(std::io::Error),
    /// The WAV could not be probed/decoded (unsupported, truncated, ...).
    Decode(String),
    /// The WAV could not be encoded/written.
    Encode(String),
    /// The file contained no decodable audio track.
    NoAudioTrack,
}

impl std::fmt::Display for AssetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AssetError::Io(e) => write!(f, "asset io error: {e}"),
            AssetError::Decode(m) => write!(f, "asset decode error: {m}"),
            AssetError::Encode(m) => write!(f, "asset encode error: {m}"),
            AssetError::NoAudioTrack => write!(f, "asset has no audio track"),
        }
    }
}

impl std::error::Error for AssetError {}

impl From<std::io::Error> for AssetError {
    fn from(e: std::io::Error) -> Self {
        AssetError::Io(e)
    }
}

/// Off-RT WAV decode/encode helper. Stateless: every method is associated and
/// allocates its own buffers, so a single `AssetStore` can serve any number of
/// loads without shared mutable state.
#[derive(Debug, Default, Clone, Copy)]
pub struct AssetStore;

impl AssetStore {
    pub fn new() -> Self {
        Self
    }

    /// Decode a WAV file at `path` into interleaved f32 [`Pcm`].
    pub fn decode_wav_file<P: AsRef<Path>>(&self, path: P) -> Result<Pcm, AssetError> {
        let file = File::open(path)?;
        Self::decode(Box::new(file), Some("wav"))
    }

    /// Decode a WAV from an in-memory byte buffer. Used by the unit tests
    /// (no filesystem) and by callers that already hold the bytes.
    pub fn decode_wav_bytes(&self, bytes: Vec<u8>) -> Result<Pcm, AssetError> {
        Self::decode(Box::new(Cursor::new(bytes)), Some("wav"))
    }

    /// Core decode: probe the source, find the first audio track, run the
    /// decode loop, and accumulate interleaved f32 samples. `hint_ext` is an
    /// optional container-extension hint (e.g. `"wav"`).
    fn decode(
        source: Box<dyn symphonia::core::io::MediaSource>,
        hint_ext: Option<&str>,
    ) -> Result<Pcm, AssetError> {
        let mss = MediaSourceStream::new(source, Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = hint_ext {
            hint.with_extension(ext);
        }

        let mut format = symphonia::default::get_probe()
            .probe(
                &hint,
                mss,
                FormatOptions::default(),
                MetadataOptions::default(),
            )
            .map_err(|e| AssetError::Decode(e.to_string()))?;

        let track = format
            .default_track(TrackType::Audio)
            .ok_or(AssetError::NoAudioTrack)?;
        let track_id = track.id;
        let audio_params = track
            .codec_params
            .as_ref()
            .and_then(|p| p.audio())
            .ok_or(AssetError::NoAudioTrack)?
            .clone();

        let mut decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
            .map_err(|e| AssetError::Decode(e.to_string()))?;

        let mut samples: Vec<f32> = Vec::new();
        let mut channels: u16 = 0;
        let mut sample_rate: u32 = 0;
        // `copy_to_vec_interleaved` REPLACES its target with just this packet's
        // samples (it is "copy to", not "append to"). Decode each packet into a
        // scratch buffer and EXTEND the accumulator, or every sample longer than one
        // packet (~16 ms) is truncated to its final packet. (Surfaced by the offline
        // audition tool: a 2 s WAV decoded to 0.01 s.)
        let mut packet_samples: Vec<f32> = Vec::new();

        loop {
            let packet = match format.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => break,                        // end of stream
                Err(SymphoniaError::IoError(_)) => break, // treat EOF-ish io as done
                Err(e) => return Err(AssetError::Decode(e.to_string())),
            };
            if packet.track_id != track_id {
                continue;
            }
            match decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = decoded.spec();
                    sample_rate = spec.rate();
                    channels = spec.channels().count() as u16;
                    decoded.copy_to_vec_interleaved(&mut packet_samples);
                    samples.extend_from_slice(&packet_samples);
                }
                // Skip recoverable per-packet errors; halt on the rest.
                Err(SymphoniaError::DecodeError(_)) | Err(SymphoniaError::IoError(_)) => continue,
                Err(e) => return Err(AssetError::Decode(e.to_string())),
            }
        }

        Ok(Pcm {
            samples,
            channels,
            sample_rate,
        })
    }

    /// Write interleaved f32 [`Pcm`] to a WAV file as 32-bit float samples,
    /// CRASH-SAFELY (Track B durability — "a held take beats a lost take").
    ///
    /// A recording is written WHILE the user performs, and `hound` finalizes the
    /// RIFF header LAST — so a direct `File::create` + write that is interrupted
    /// (app crash / power loss) leaves a torn, headerless, undecodable file in
    /// place of any prior take. Instead we write to a sibling temp, fsync it,
    /// atomically rename it over the destination, then fsync the directory. A
    /// crash at any point leaves the COMPLETE old file (or none) — never a torn
    /// one. POSIX-atomic on the same filesystem; the dir-fsync (no-op on Windows,
    /// where the rename is durable regardless) makes the rename itself survive
    /// power loss.
    pub fn write_wav_file<P: AsRef<Path>>(&self, path: P, pcm: &Pcm) -> Result<(), AssetError> {
        let path = path.as_ref();
        // Unique per write (`<path>.<pid>.<nonce>.ojtmp`) so concurrent exports to
        // the same destination never clobber each other's staged bytes.
        let tmp = unique_temp_path(path);
        // Stage the WAV into the temp + fsync it; on ANY failure remove THIS write's
        // temp so it never leaks. `&File` is Write + Seek, so `hound` can finalize
        // the header while we retain `file` to fsync the data + header before the
        // rename.
        let stage = (|| -> Result<(), AssetError> {
            let file = File::create(&tmp)?;
            Self::write_wav(&file, pcm)?;
            file.sync_all()?;
            Ok(())
        })();
        if let Err(e) = stage {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        // Atomic replace, then make the rename durable.
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp); // don't leak the temp on failure
            return Err(e.into());
        }
        sync_parent_dir(path)?;
        Ok(())
    }

    /// Encode interleaved f32 [`Pcm`] to an in-memory WAV byte buffer (32-bit
    /// float). Used to capture render output without touching the filesystem.
    pub fn encode_wav_bytes(&self, pcm: &Pcm) -> Result<Vec<u8>, AssetError> {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        Self::write_wav(&mut cursor, pcm)?;
        Ok(cursor.into_inner())
    }

    /// Core encode: stream `pcm.samples` into a `hound` 32-bit-float WAV writer.
    fn write_wav<W: Write + std::io::Seek>(writer: W, pcm: &Pcm) -> Result<(), AssetError> {
        let spec = hound::WavSpec {
            channels: pcm.channels.max(1),
            sample_rate: pcm.sample_rate.max(1),
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        };
        let mut wav =
            hound::WavWriter::new(writer, spec).map_err(|e| AssetError::Encode(e.to_string()))?;
        for &s in &pcm.samples {
            wav.write_sample(s)
                .map_err(|e| AssetError::Encode(e.to_string()))?;
        }
        wav.finalize()
            .map_err(|e| AssetError::Encode(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    // Test signal generators may use std transcendentals — the libm-only guard
    // is for the deterministic DSP path, not throwaway test fixtures.
    #![allow(clippy::disallowed_methods)]
    use super::*;

    /// Build a deterministic test signal: a 1-channel sine-ish ramp.
    fn test_pcm() -> Pcm {
        let frames = 480; // 10 ms @ 48 kHz
        let samples: Vec<f32> = (0..frames)
            .map(|i| {
                let phase = i as f32 / frames as f32;
                (phase * std::f32::consts::TAU).sin() * 0.5
            })
            .collect();
        Pcm {
            samples,
            channels: 1,
            sample_rate: 48_000,
        }
    }

    #[test]
    fn wav_roundtrip_in_memory_mono() {
        let store = AssetStore::new();
        let original = test_pcm();

        // Encode to bytes, then decode them back — no filesystem involved.
        let bytes = store.encode_wav_bytes(&original).expect("encode");
        assert!(!bytes.is_empty(), "encoded WAV must not be empty");
        // RIFF/WAVE header sanity.
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");

        let decoded = store.decode_wav_bytes(bytes).expect("decode");

        assert_eq!(decoded.channels, original.channels);
        assert_eq!(decoded.sample_rate, original.sample_rate);
        assert_eq!(decoded.frames(), original.frames());
        assert_eq!(decoded.samples.len(), original.samples.len());

        // 32-bit float WAV is lossless: samples come back bit-for-bit (within
        // a tiny epsilon for any format-conversion rounding).
        for (i, (&a, &b)) in original
            .samples
            .iter()
            .zip(decoded.samples.iter())
            .enumerate()
        {
            assert!((a - b).abs() < 1e-6, "frame {i}: {a} != {b}");
        }
    }

    #[test]
    fn wav_roundtrip_stereo_interleaving_preserved() {
        let store = AssetStore::new();
        // L = +0.25 constant, R = -0.25 constant, interleaved L,R,L,R...
        let frames = 64;
        let mut samples = Vec::with_capacity(frames * 2);
        for _ in 0..frames {
            samples.push(0.25);
            samples.push(-0.25);
        }
        let original = Pcm {
            samples,
            channels: 2,
            sample_rate: 44_100,
        };

        let bytes = store.encode_wav_bytes(&original).expect("encode");
        let decoded = store.decode_wav_bytes(bytes).expect("decode");

        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44_100);
        assert_eq!(decoded.frames(), frames);
        // Channel interleaving must survive the round trip.
        for f in 0..frames {
            assert!((decoded.samples[f * 2] - 0.25).abs() < 1e-6, "L@{f}");
            assert!((decoded.samples[f * 2 + 1] + 0.25).abs() < 1e-6, "R@{f}");
        }
    }

    #[test]
    fn wav_roundtrip_multi_packet_full_length() {
        // The decoder reads the stream packet-by-packet; a sample longer than one
        // packet MUST accumulate EVERY packet, not keep only the last. Regression:
        // `copy_to_vec_interleaved` REPLACES its target, so the loop used to
        // truncate any sample > ~16 ms to its final packet (the other round-trip
        // tests use <1-packet samples, so they never caught it — the offline
        // audition tool did). Use a multi-packet length and assert the full span.
        let store = AssetStore::new();
        let frames = 20_000; // ~0.42 s @ 48 kHz — spans many decode packets
        let samples: Vec<f32> = (0..frames)
            .map(|i| ((i % 100) as f32 / 100.0) * 2.0 - 1.0) // sawtooth (libm-free)
            .collect();
        let original = Pcm {
            samples,
            channels: 1,
            sample_rate: 48_000,
        };
        let bytes = store.encode_wav_bytes(&original).expect("encode");
        let decoded = store.decode_wav_bytes(bytes).expect("decode");

        assert_eq!(decoded.channels, 1);
        assert_eq!(decoded.sample_rate, 48_000);
        assert_eq!(
            decoded.frames(),
            frames,
            "multi-packet WAV truncated: got {} of {frames} frames",
            decoded.frames()
        );
        // The bug kept only the LAST packet, so the head + middle would be lost.
        assert!((decoded.samples[0] - original.samples[0]).abs() < 1e-6, "head lost");
        let mid = frames / 2;
        assert!(
            (decoded.samples[mid] - original.samples[mid]).abs() < 1e-6,
            "middle lost"
        );
    }

    #[test]
    fn decode_garbage_bytes_is_error_not_panic() {
        let store = AssetStore::new();
        let err = store.decode_wav_bytes(vec![0u8; 32]);
        assert!(err.is_err(), "non-WAV bytes must error, not panic");
    }

    #[test]
    fn pcm_frames_handles_zero_channels() {
        let p = Pcm {
            samples: vec![],
            channels: 0,
            sample_rate: 48_000,
        };
        assert_eq!(p.frames(), 0);
        assert!(p.is_empty());
    }

    // ---- Crash-safe write (Track B durability) ----

    use std::sync::atomic::{AtomicU64, Ordering};

    /// A process-unique temp dir for a file test (no tempfile dep).
    fn unique_dir(tag: &str) -> std::path::PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("oj-asset-{}-{}-{}", tag, std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("mkdir temp");
        dir
    }

    /// True if `dir` holds ANY staged `.ojtmp` sibling (the temp name is now unique
    /// per write — `<dest>.<pid>.<nonce>.ojtmp` — so we scan rather than guess it).
    fn any_ojtmp(dir: &Path) -> bool {
        std::fs::read_dir(dir)
            .unwrap()
            .any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".ojtmp"))
    }

    #[test]
    fn write_wav_file_roundtrips_and_leaves_no_temp() {
        let store = AssetStore::new();
        let dir = unique_dir("roundtrip");
        let path = dir.join("take.wav");
        let pcm = test_pcm();

        store.write_wav_file(&path, &pcm).expect("atomic write");

        // The destination exists and decodes back to the same PCM...
        let back = store.decode_wav_file(&path).expect("decode");
        assert_eq!(back.channels, pcm.channels);
        assert_eq!(back.samples.len(), pcm.samples.len());
        // ...and the sibling temp was renamed away, never left behind.
        assert!(!any_ojtmp(&dir), "temp must not leak");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_wav_file_atomically_replaces_and_a_stale_temp_is_harmless() {
        let store = AssetStore::new();
        let dir = unique_dir("replace");
        let path = dir.join("take.wav");

        // An existing, GOOD take (v1: 1 mono frame).
        let v1 = Pcm {
            samples: vec![0.25],
            channels: 1,
            sample_rate: 48_000,
        };
        store.write_wav_file(&path, &v1).expect("write v1");

        // A stale temp left by a hypothetical earlier interrupted write — it must
        // NOT corrupt the destination (the dest is only ever changed by rename).
        // The temp name is unique per write, so a leftover from a prior crash is a
        // distinct file the new write never touches; what matters is that it cannot
        // reach the destination.
        let stale = {
            let mut s = path.clone().into_os_string();
            s.push(".stale.ojtmp");
            std::path::PathBuf::from(s)
        };
        std::fs::write(&stale, b"torn garbage, never renamed").unwrap();
        // v1 is still intact and decodable despite the stale temp.
        assert_eq!(
            store
                .decode_wav_file(&path)
                .expect("decode v1")
                .samples
                .len(),
            1
        );

        // A new take (v2: 3 frames) atomically replaces v1; its OWN temp is renamed
        // away, leaving no temp from this write behind (the unrelated stale one is
        // harmless and simply ignored).
        let v2 = Pcm {
            samples: vec![0.1, -0.2, 0.3],
            channels: 1,
            sample_rate: 48_000,
        };
        store.write_wav_file(&path, &v2).expect("write v2");
        assert_eq!(
            store
                .decode_wav_file(&path)
                .expect("decode v2")
                .samples
                .len(),
            3
        );
        // The stale temp never reached the dest (dest is the complete v2 above), and
        // removing it leaves no `.ojtmp` from this write's own staging.
        std::fs::remove_file(&stale).unwrap();
        assert!(!any_ojtmp(&dir), "this write's own temp was renamed away");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
