//! The native cpal audio host.
//!
//! [`AudioHost::start`] opens a cpal **output** stream (and, when asked, a
//! duplex **input** stream) at a requested sample rate and a small buffer
//! (32/64 frames), and drives [`ojcore::Engine`] from inside the audio
//! callback. The callback's contract mirrors the engine's:
//!
//! 1. drain the UI->RT [`CommandConsumer`] (`engine.drain`),
//! 2. render one mono block (`engine.process_block`),
//! 3. fan the mono block out across the interleaved output channels.
//!
//! On the first callback the thread is promoted to realtime scheduling priority
//! via `audio_thread_priority` (in addition to cpal's own `realtime` feature)
//! so the render never gets preempted by the desktop scheduler.
//!
//! The per-block logic ([`render_block`]) is factored OUT of the cpal closure
//! and written against the [`BlockProcessor`] trait, so it is unit-tested with a
//! mock engine and a real command ring — no audio device required.

use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, SampleFormat, Stream, StreamConfig};

use ojcore::{CommandConsumer, Engine};

/// The minimal slice of [`Engine`] the audio callback needs. Abstracting it lets
/// the callback wiring be tested against a mock without an audio device (and
/// without a compiled DSP program).
pub trait BlockProcessor: Send {
    /// Drain every pending command from the UI->RT ring (block start).
    fn drain_commands(&mut self, rx: &mut CommandConsumer);
    /// Render `nframes` of mono audio into `out`.
    fn render(&mut self, out: &mut [f32], nframes: usize);
}

impl BlockProcessor for Engine {
    #[inline]
    fn drain_commands(&mut self, rx: &mut CommandConsumer) {
        self.drain(rx);
    }
    #[inline]
    fn render(&mut self, out: &mut [f32], nframes: usize) {
        self.process_block(out, nframes);
    }
}

/// Render one cpal output block: drain commands, render mono, fan out to all
/// interleaved channels. `data` is cpal's interleaved output buffer
/// (`frames * channels` samples); `mono` is a reusable scratch buffer at least
/// `data.len() / channels` long. Pure and allocation-free — the hot path.
///
/// RT-SAFETY: no allocation, no locks. `mono` is pre-sized by the caller (it
/// lives in the callback closure, allocated once before the stream starts).
pub fn render_block<P: BlockProcessor>(
    proc: &mut P,
    rx: &mut CommandConsumer,
    data: &mut [f32],
    channels: usize,
    mono: &mut [f32],
) {
    proc.drain_commands(rx);

    if channels == 0 {
        data.fill(0.0);
        return;
    }

    // The callback buffer can be MUCH larger than the engine's block size — WASAPI
    // shared mode hands us the device period (hundreds of frames), not our 64. Render
    // the WHOLE buffer in `mono`-sized (engine-block) chunks so it is filled with
    // continuous audio instead of one block followed by silence (the gappy-playback
    // bug on a `BufferSize::Default` stream). No allocation on the RT path.
    let total_frames = data.len() / channels;
    let block = mono.len().max(1);
    let mut done = 0;
    while done < total_frames {
        let n = (total_frames - done).min(block);
        proc.render(&mut mono[..n], n);
        // Fan each mono frame out across all interleaved channels.
        for (f, &s) in mono[..n].iter().enumerate() {
            let base = (done + f) * channels;
            data[base..base + channels].fill(s);
        }
        done += n;
    }
    // Zero any tail samples past whole frames (data.len() not divisible by channels).
    for s in data[total_frames * channels..].iter_mut() {
        *s = 0.0;
    }
}

/// How to open the stream. A tiny, explicit request rather than guessing from
/// the device default — U7 cares specifically about *small* buffers.
#[derive(Debug, Clone, Copy)]
pub struct StreamRequest {
    /// Requested sample rate in Hz (e.g. 48_000).
    pub sample_rate: u32,
    /// Requested buffer size in frames (e.g. 32 or 64). Mapped to
    /// [`cpal::BufferSize::Fixed`]; backends that cannot honour it fall back to
    /// their own minimum, which the live latency harness then measures.
    pub buffer_frames: u32,
    /// Output channel count to fan the mono engine output across (1 = mono,
    /// 2 = stereo). Resolved against the device's default if it cannot match.
    pub channels: u16,
    /// Also open a duplex input (capture) stream. Required for the loopback
    /// latency harness; pure synthesis only needs output.
    pub duplex_input: bool,
}

impl Default for StreamRequest {
    fn default() -> Self {
        Self {
            sample_rate: 48_000,
            buffer_frames: 64,
            channels: 2,
            duplex_input: false,
        }
    }
}

/// Why the host could not start. `NoOutputDevice` is the EXPECTED, non-fatal
/// case in a headless/CI sandbox — callers print a clear message rather than
/// panicking (see `src/bin/loopback.rs`).
#[derive(Debug)]
pub enum HostError {
    /// No default output device — no audio hardware available.
    NoOutputDevice,
    /// `duplex_input` was requested but no default input device exists.
    NoInputDevice,
    /// cpal failed to query a device config.
    Config(String),
    /// cpal failed to build or start a stream.
    Stream(String),
    /// The device only offered a sample format this host does not handle (it
    /// renders f32). Carries the offending format name.
    UnsupportedFormat(String),
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HostError::NoOutputDevice => write!(f, "no audio output device available"),
            HostError::NoInputDevice => write!(f, "no audio input device available"),
            HostError::Config(m) => write!(f, "audio device config error: {m}"),
            HostError::Stream(m) => write!(f, "audio stream error: {m}"),
            HostError::UnsupportedFormat(m) => write!(f, "unsupported sample format: {m}"),
        }
    }
}

impl std::error::Error for HostError {}

/// Classify a [`cpal::Error`]: does its kind mean "there is effectively no
/// usable audio device/host here" (the headless/CI case)? cpal's ALSA backend,
/// for instance, hands back a "default" device whose later config query fails
/// with [`cpal::ErrorKind::DeviceNotAvailable`] — so absence shows up at the
/// config/build step, not only at `default_output_device`. Folding those kinds
/// into [`HostError::NoOutputDevice`] lets the harness print one clean
/// "no audio device available" message instead of a raw backend error.
fn is_device_absent(err: &cpal::Error) -> bool {
    matches!(
        err.kind(),
        cpal::ErrorKind::DeviceNotAvailable
            | cpal::ErrorKind::HostUnavailable
            | cpal::ErrorKind::DeviceBusy
    )
}

/// Map a cpal config/stream error to a [`HostError`], collapsing
/// device-absence kinds to [`HostError::NoOutputDevice`].
fn map_cpal(err: cpal::Error, fallback: impl FnOnce(String) -> HostError) -> HostError {
    if is_device_absent(&err) {
        HostError::NoOutputDevice
    } else {
        fallback(err.to_string())
    }
}

/// A live audio host. Holds the cpal stream(s) open; dropping it stops audio.
///
/// The [`Engine`] is moved INTO the output callback (it is `Send`), so once
/// started the host owns no further handle to it — parameter changes flow in
/// through the [`CommandConsumer`] the callback drains.
pub struct AudioHost {
    /// The output stream; kept alive for the host's lifetime (cpal stops the
    /// stream when the handle drops).
    _output: Stream,
    /// Optional duplex input stream, held alive the same way.
    _input: Option<Stream>,
    /// The negotiated stream config, exposed for the latency estimate.
    config: StreamConfig,
}

/// The default output device's default sample rate (Hz), or `None` when there is
/// no device. The engine renders at THIS rate (see `oj-tauri`'s `EngineBackend`)
/// so playback is in tune even when the default output isn't 48k — e.g. a 96k pro
/// interface like the MOTU M4.
pub fn default_output_sample_rate() -> Option<u32> {
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let cfg = device.default_output_config().ok()?;
    Some(cfg.config().sample_rate)
}

/// Probe whether `device` accepts `config` for output by opening a throwaway
/// no-op stream and dropping it immediately. Used at startup to pick a config
/// the backend actually supports (WASAPI shared mode rejects an arbitrary
/// `Fixed` buffer, so the sub-5ms request must gracefully fall back).
fn probe_output_config(device: &cpal::Device, config: &StreamConfig) -> bool {
    device
        .build_output_stream(
            *config,
            |_data: &mut [f32], _: &cpal::OutputCallbackInfo| {},
            |_e: cpal::Error| {},
            None,
        )
        .is_ok()
}

impl AudioHost {
    /// The negotiated output [`StreamConfig`] (channels / sample rate / buffer).
    pub fn config(&self) -> &StreamConfig {
        &self.config
    }

    /// Resolve the negotiated buffer size in frames, or `None` if the backend
    /// chose its own default (the live harness measures it empirically then).
    pub fn buffer_frames(&self) -> Option<u32> {
        match self.config.buffer_size {
            BufferSize::Fixed(n) => Some(n),
            BufferSize::Default => None,
        }
    }

    /// Open the stream(s) and start rendering `engine` through the callback.
    ///
    /// `rx` is the audio thread's end of the UI->RT command ring (see
    /// [`ojcore::CommandQueue::split`]); the callback drains it each block.
    ///
    /// Returns [`HostError::NoOutputDevice`] (NOT a panic) when there is no
    /// audio hardware — the device-less sandbox path.
    pub fn start(
        req: StreamRequest,
        mut engine: Engine,
        mut rx: CommandConsumer,
    ) -> Result<Self, HostError> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or(HostError::NoOutputDevice)?;

        // Probe the device default for sample format + channel fallback.
        let default_cfg = device
            .default_output_config()
            .map_err(|e| map_cpal(e, HostError::Config))?;
        let sample_format = default_cfg.sample_format();
        if sample_format != SampleFormat::F32 {
            // This host renders f32; a converting path is out of scope for U7.
            return Err(HostError::UnsupportedFormat(format!("{sample_format:?}")));
        }

        let channels = if req.channels == 0 {
            default_cfg.channels()
        } else {
            req.channels
        };
        // Pick a config the device actually accepts. WASAPI *shared* mode (the
        // default Windows host) rejects an arbitrary `Fixed` buffer — and the
        // sub-5ms ambition needs exclusive/ASIO anyway — so fall back to the
        // device period, then to the device's full default config, probing each
        // by opening a throwaway no-op stream first. Sample rate + channels are
        // preserved where possible so the engine's compiled rate matches the
        // stream (no resampling / pitch drift); only the last-resort device
        // default may change the rate.
        let default_stream_cfg = default_cfg.config();
        let candidates = [
            StreamConfig {
                channels,
                sample_rate: req.sample_rate,
                buffer_size: BufferSize::Fixed(req.buffer_frames),
            },
            StreamConfig {
                channels,
                sample_rate: req.sample_rate,
                buffer_size: BufferSize::Default,
            },
            default_stream_cfg,
        ];
        let config = candidates
            .iter()
            .copied()
            .find(|c| probe_output_config(&device, c))
            .unwrap_or(default_stream_cfg);
        eprintln!(
            "ojcore: audio stream negotiated: {} ch @ {} Hz, buffer {:?}",
            config.channels, config.sample_rate, config.buffer_size
        );

        // Optional duplex input. We open it first so it is running before output
        // pulls; the harness records into a shared buffer via a separate seam.
        // For U7 the input stream simply proves duplex open succeeds; the live
        // loopback capture wiring runs on the founder's hardware.
        let input = if req.duplex_input {
            Some(Self::build_input(&host, &config)?)
        } else {
            None
        };

        let buffer_frames = req.buffer_frames;
        let sample_rate = req.sample_rate;
        let ch = channels as usize;
        // Mono render scratch, allocated ONCE here (off the RT thread).
        let mut mono = vec![0.0f32; buffer_frames as usize];
        // Promote-once guard for realtime priority.
        let mut promoted = false;

        let err_fn = |e: cpal::Error| {
            eprintln!("audio output stream error: {e}");
        };

        let output = device
            .build_output_stream(
                config,
                move |data: &mut [f32], _info: &cpal::OutputCallbackInfo| {
                    if !promoted {
                        promoted = true;
                        // Promote THIS (audio callback) thread to realtime. A
                        // failure is non-fatal: audio still plays, just without
                        // the scheduling guarantee. The returned handle only
                        // matters for an explicit `demote`; we never demote (the
                        // thread stays realtime for the stream's whole life and
                        // is torn down with the process), so we drop it.
                        match audio_thread_priority::promote_current_thread_to_real_time(
                            buffer_frames,
                            sample_rate,
                        ) {
                            Ok(_handle) => {}
                            Err(e) => eprintln!("RT priority promotion failed (non-fatal): {e}"),
                        }
                    }
                    render_block(&mut engine, &mut rx, data, ch, &mut mono);
                },
                err_fn,
                None,
            )
            .map_err(|e| map_cpal(e, HostError::Stream))?;

        output.play().map_err(|e| map_cpal(e, HostError::Stream))?;
        if let Some(ref s) = input {
            s.play().map_err(|e| map_cpal(e, HostError::Stream))?;
        }

        Ok(Self {
            _output: output,
            _input: input,
            config,
        })
    }

    /// Build the duplex input (capture) stream. For U7 this is a minimal,
    /// no-op-consuming capture that proves the duplex path opens; the live
    /// loopback harness on real hardware swaps in a capturing callback.
    fn build_input(host: &cpal::Host, out_config: &StreamConfig) -> Result<Stream, HostError> {
        let in_device = host
            .default_input_device()
            .ok_or(HostError::NoInputDevice)?;

        let in_default = in_device.default_input_config().map_err(|e| {
            if is_device_absent(&e) {
                HostError::NoInputDevice
            } else {
                HostError::Config(e.to_string())
            }
        })?;
        if in_default.sample_format() != SampleFormat::F32 {
            return Err(HostError::UnsupportedFormat(format!(
                "{:?}",
                in_default.sample_format()
            )));
        }
        let in_config = StreamConfig {
            channels: in_default.channels(),
            sample_rate: out_config.sample_rate,
            buffer_size: out_config.buffer_size,
        };

        let err_fn = |e: cpal::Error| eprintln!("audio input stream error: {e}");
        in_device
            .build_input_stream(
                in_config,
                move |_data: &[f32], _info: &cpal::InputCallbackInfo| {
                    // Capture sink is wired on real hardware; here it just drains
                    // the input ring so the backend does not overrun.
                },
                err_fn,
                None,
            )
            .map_err(|e| {
                if is_device_absent(&e) {
                    HostError::NoInputDevice
                } else {
                    HostError::Stream(e.to_string())
                }
            })
    }
}

/// Convenience: how long to hold a started stream open. Pure data; pulled out so
/// the bin and any future smoke tests share one definition.
pub const DEFAULT_RUN: Duration = Duration::from_secs(2);

#[cfg(test)]
mod tests {
    use super::*;
    use ojproto::{NodeIdx, RtCommand};

    /// A mock [`BlockProcessor`] that records what it was asked to do, so the
    /// callback wiring can be verified WITHOUT an audio device or a compiled
    /// engine program.
    struct MockProcessor {
        /// Commands drained, in order.
        drained: Vec<RtCommand>,
        /// The constant value the mock writes into every rendered frame.
        fill: f32,
        /// nframes seen by the last `render` call.
        last_nframes: usize,
        /// Count of render calls.
        renders: usize,
    }

    impl MockProcessor {
        fn new(fill: f32) -> Self {
            Self {
                drained: Vec::new(),
                fill,
                last_nframes: 0,
                renders: 0,
            }
        }
    }

    impl BlockProcessor for MockProcessor {
        fn drain_commands(&mut self, rx: &mut CommandConsumer) {
            while let Ok(cmd) = rx.pop() {
                self.drained.push(cmd);
            }
        }
        fn render(&mut self, out: &mut [f32], nframes: usize) {
            self.last_nframes = nframes;
            self.renders += 1;
            for s in out.iter_mut().take(nframes) {
                *s = self.fill;
            }
        }
    }

    #[test]
    fn callback_drains_then_renders_and_fans_out_stereo() {
        let (mut tx, rx) = ojcore::CommandQueue::split(8);
        // Queue two commands the callback must drain before rendering.
        tx.push(RtCommand::TransportPlay).unwrap();
        tx.push(RtCommand::SetParam {
            node: NodeIdx(3),
            param: 0,
            value: 0.7,
        })
        .unwrap();

        let mut rx = rx;
        let mut proc = MockProcessor::new(0.5);
        let channels = 2;
        let frames = 4;
        let mut data = vec![0.0f32; frames * channels];
        let mut mono = vec![0.0f32; frames];

        render_block(&mut proc, &mut rx, &mut data, channels, &mut mono);

        // Commands were drained, in order, before any render.
        assert_eq!(proc.drained.len(), 2);
        assert_eq!(proc.drained[0], RtCommand::TransportPlay);
        assert_eq!(proc.renders, 1);
        assert_eq!(proc.last_nframes, frames);
        // Mono 0.5 fanned across both channels of every frame.
        for frame in 0..frames {
            assert_eq!(data[frame * 2], 0.5, "L@{frame}");
            assert_eq!(data[frame * 2 + 1], 0.5, "R@{frame}");
        }
    }

    #[test]
    fn callback_handles_mono_output() {
        let (_tx, rx) = ojcore::CommandQueue::split(4);
        let mut rx = rx;
        let mut proc = MockProcessor::new(-0.25);
        let frames = 6;
        let mut data = vec![0.0f32; frames]; // mono: channels == 1
        let mut mono = vec![0.0f32; frames];

        render_block(&mut proc, &mut rx, &mut data, 1, &mut mono);

        assert_eq!(proc.last_nframes, frames);
        for (i, &s) in data.iter().enumerate() {
            assert_eq!(s, -0.25, "frame {i}");
        }
    }

    #[test]
    fn callback_fills_large_buffer_in_chunks() {
        // A callback buffer LARGER than the engine-block scratch must be FULLY
        // rendered in mono-sized chunks — never one block + silence. WASAPI shared
        // mode hands us the device period (much bigger than 64), so clamping would
        // leave most of every buffer silent (the gappy-playback bug).
        let (_tx, rx) = ojcore::CommandQueue::split(4);
        let mut rx = rx;
        let mut proc = MockProcessor::new(1.0);
        let channels = 2;
        let big_frames = 10;
        let mut data = vec![9.0f32; big_frames * channels];
        let mut mono = vec![0.0f32; 4]; // engine block fits 4 frames

        render_block(&mut proc, &mut rx, &mut data, channels, &mut mono);

        // 10 frames in 4-frame chunks → 4 + 4 + 2 = three render calls, last = 2.
        assert_eq!(proc.renders, 3);
        assert_eq!(proc.last_nframes, 2);
        // EVERY frame across EVERY channel is filled — no gaps, no stale samples.
        assert!(data.iter().all(|&s| s == 1.0));
    }

    #[test]
    fn callback_zero_channels_is_safe() {
        let (_tx, rx) = ojcore::CommandQueue::split(4);
        let mut rx = rx;
        let mut proc = MockProcessor::new(1.0);
        let mut data = vec![7.0f32; 8];
        let mut mono = vec![0.0f32; 8];

        render_block(&mut proc, &mut rx, &mut data, 0, &mut mono);

        // Degenerate channel count: output silenced, no render, no panic.
        assert_eq!(proc.renders, 0);
        assert!(data.iter().all(|&s| s == 0.0));
    }

    /// Opening a real device requires audio hardware, which this sandbox lacks.
    /// Gated with `#[ignore]`; run on the founder's hardware with
    /// `cargo test -p ojcore-native -- --ignored`.
    #[test]
    #[ignore = "requires a real audio output device; run on founder hardware"]
    fn host_starts_on_real_device() {
        use ojcore::{compile, GainLoader, PluginRegistry};
        use ojproto::{IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind};

        let mut reg = PluginRegistry::new();
        reg.register(Box::new(GainLoader::new()));
        let graph = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: ojcore::GAIN_ID.into(),
                    kind: PrimitiveKind::Gain,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: ojcore::GAIN_ID.into(),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 1,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(0),
                from_port: 0,
                to_node: NodeIdx(1),
                to_port: 0,
                kind: ojproto::ConnectionType::Audio,
            }],
            schedule: vec![],
        };
        let prog = compile(&graph, &reg).expect("compile");
        let engine = Engine::new(prog);
        let (_tx, rx) = ojcore::CommandQueue::split(64);
        let host = AudioHost::start(
            StreamRequest {
                sample_rate: 48_000,
                buffer_frames: 64,
                channels: 2,
                duplex_input: false,
            },
            engine,
            rx,
        )
        .expect("host start");
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(host.config().sample_rate, 48_000);
    }
}
