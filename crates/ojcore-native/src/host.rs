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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use std::str::FromStr;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, DeviceId, SampleFormat, Stream, StreamConfig};
use rtrb::{Consumer, Producer, RingBuffer};

use ojcore::{CommandConsumer, Engine, ProgramSwapRx};
use ojproto::NodeIdx;

use crate::device::{classify, device_fault_channel, DeviceFault, DeviceFaultRx};
use crate::recorder::RecorderSink;

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

/// A [`BlockProcessor`] that feeds the engine's `MicIn` source node from the mic
/// ring just before each block renders, so duplex capture flows downstream. It
/// borrows the [`Engine`] and the output-side [`MicDrain`] for one callback and
/// fills `engine.input_mut(mic_node, 0)` per engine-block chunk — keeping the mic
/// injection aligned with `render_block`'s chunking even when the cpal buffer is
/// many engine blocks wide.
///
/// RT-SAFETY: the fill is a wait-free ring drain into a pre-sized buffer and the
/// render is the engine's alloc-free `process_block`. If the `MicIn` node is not
/// in the live program (a graph swap removed it), `input_mut` returns `None` and
/// the block simply renders without mic input — no panic, no allocation.
struct MicFedEngine<'a> {
    engine: &'a mut Engine,
    mic: &'a mut MicDrain,
    mic_node: NodeIdx,
}

impl BlockProcessor for MicFedEngine<'_> {
    #[inline]
    fn drain_commands(&mut self, rx: &mut CommandConsumer) {
        self.engine.drain(rx);
    }
    #[inline]
    fn render(&mut self, out: &mut [f32], nframes: usize) {
        if let Some(buf) = self.engine.input_mut(self.mic_node, 0) {
            let n = nframes.min(buf.len());
            self.mic.drain_into(&mut buf[..n]);
        }
        self.engine.process_block(out, nframes);
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

/// A wait-free SPSC ring carrying captured MONO microphone samples from the
/// duplex INPUT callback to the OUTPUT callback — the mirror image of
/// [`RecorderSink`]/[`Recorder`] (which carries output capture off-RT), reversed
/// so it stays entirely RT→RT. The two cpal callbacks run on DIFFERENT threads,
/// so the hand-off must be lock-free: the input callback is the sole producer,
/// the output callback the sole consumer.
///
/// Both ends only `push`/`pop` into pre-allocated storage and never block or
/// allocate, so neither RT thread is ever stalled. On a full ring the input side
/// DROPS the excess (a held note beats a glitch — we never block the render);
/// on an empty ring the output side reads SILENCE for the unfilled tail.
fn mic_ring(frames: usize) -> (MicCaptureSink, MicDrain) {
    let (tx, rx) = RingBuffer::<f32>::new(frames.max(1));
    (MicCaptureSink { tx }, MicDrain { rx })
}

/// The INPUT-callback side of the mic ring: down-mix one interleaved capture
/// block to mono and push it. RT-safe (wait-free, allocation-free, drops on a
/// full ring — never blocks the capture thread).
struct MicCaptureSink {
    tx: Producer<f32>,
}

impl MicCaptureSink {
    /// Push one interleaved input block, averaging its `channels` lanes into a
    /// single mono sample per frame. A `channels` of 0 is treated as silence.
    #[inline]
    fn capture(&mut self, interleaved: &[f32], channels: usize) {
        if channels == 0 {
            return;
        }
        let inv = 1.0 / channels as f32;
        for frame in interleaved.chunks_exact(channels) {
            let mut sum = 0.0;
            for &s in frame {
                sum += s;
            }
            // Drop on a full ring rather than block the RT capture thread.
            let _ = self.tx.push(sum * inv);
        }
    }
}

/// The OUTPUT-callback side of the mic ring: drain captured mono samples into the
/// `MicIn` node's output buffer each block. RT-safe (wait-free, allocation-free);
/// an under-filled ring yields silence for the tail rather than blocking.
struct MicDrain {
    rx: Consumer<f32>,
}

impl MicDrain {
    /// Fill `out` with the next `out.len()` captured mono samples, padding any
    /// tail the ring could not supply with silence. Wait-free; never blocks.
    #[inline]
    fn drain_into(&mut self, out: &mut [f32]) {
        for s in out.iter_mut() {
            *s = self.rx.pop().unwrap_or(0.0);
        }
    }
}

/// Promote the calling (audio callback) thread to realtime scheduling, once per
/// stream. Non-fatal: audio still plays without it, just without the scheduling
/// guarantee.
///
/// WINDOWS: cpal's WASAPI backend already registers the render thread with the
/// MMCSS "Pro Audio" task, so a SECOND `AvSetMmThreadCharacteristics` from
/// `audio_thread_priority` is redundant and fails (the source of the repeated
/// `(1552)` errors). We therefore skip the manual promotion on Windows and rely
/// on cpal's. (True sub-5ms still needs WASAPI-exclusive/ASIO — a device-config
/// concern, not this scheduling call.)
///
/// LINUX / macOS: cpal does not promote, so we do it here (SCHED_FIFO / the
/// POSIX RT path inside `audio_thread_priority`).
#[cfg(not(target_os = "windows"))]
fn promote_audio_thread(buffer_frames: u32, sample_rate: u32) {
    match audio_thread_priority::promote_current_thread_to_real_time(buffer_frames, sample_rate) {
        Ok(_handle) => {}
        // The returned handle only matters for an explicit `demote`; we never
        // demote (the thread is RT for the stream's whole life, torn down with
        // the process), so we drop it.
        Err(e) => eprintln!("ojcore: RT thread-priority not granted (non-fatal): {e}"),
    }
}

#[cfg(target_os = "windows")]
fn promote_audio_thread(_buffer_frames: u32, _sample_rate: u32) {
    // No-op: cpal already MMCSS-promotes the WASAPI render thread (see fn docs).
}

/// Enable flush-to-zero (FTZ) + denormals-are-zero (DAZ) on the CURRENT (audio
/// callback) thread, so a denormal that appears INSIDE a DSP loop — e.g. a decaying
/// filter feedback register — is flushed by the FPU itself instead of costing the
/// 10-100x cycle penalty that can spike a block over its deadline and xrun.
///
/// This complements (does not replace) the per-node [`ojcore::sanitize`], which
/// only flushes at block boundaries: it cannot catch an in-loop spike, which is the
/// real live-CPU hazard. Per-thread + idempotent (set once at stream start, via the
/// same promote-once guard). Uses stable inline asm — the `_mm_setcsr` intrinsic is
/// deprecated — and is a no-op on architectures without a denormal-flush control.
#[inline]
fn set_flush_denormals() {
    #[cfg(target_arch = "x86_64")]
    {
        use core::arch::asm;
        let mut mxcsr: u32 = 0;
        // SAFETY: stmxcsr/ldmxcsr read+write THIS thread's SSE control register
        // (SSE2 is the x86_64 baseline). FTZ = bit 15, DAZ = bit 6.
        unsafe {
            asm!("stmxcsr [{}]", in(reg) &mut mxcsr, options(nostack, preserves_flags));
            mxcsr |= 0x8040;
            asm!("ldmxcsr [{}]", in(reg) &mxcsr, options(nostack, preserves_flags));
        }
    }
    #[cfg(target_arch = "aarch64")]
    {
        use core::arch::asm;
        let mut fpcr: u64;
        // SAFETY: read/modify/write THIS thread's FPCR; FZ = bit 24 (flush-to-zero).
        unsafe {
            asm!("mrs {}, fpcr", out(reg) fpcr, options(nomem, nostack, preserves_flags));
            fpcr |= 1 << 24;
            asm!("msr fpcr, {}", in(reg) fpcr, options(nomem, nostack, preserves_flags));
        }
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

/// A cheap, shared "the output stream faulted" flag. The cpal `err_fn` runs on
/// cpal's OWN error thread (NOT the audio render thread) when a running stream
/// errors — a yanked/disabled/reconfigured device hands us a
/// [`cpal::StreamError`] here. The contract for that callback is strict: it does
/// a SINGLE atomic store and nothing else — no allocation, no lock, no blocking
/// I/O, no stream teardown. The control thread (which already ticks
/// `drain_events`/`poll_meters`) polls [`StreamFault::take`] each tick and does
/// the actual off-RT stream rebuild.
///
/// This is intentionally a one-bit edge, not a counter: device-loss is a single
/// recoverable condition, and a relaxed boolean is the cheapest wait-free signal
/// that survives the cpal-thread → control-thread hop.
#[derive(Clone, Default)]
pub struct StreamFault(Arc<AtomicBool>);

impl StreamFault {
    /// A fresh, un-faulted signal.
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    /// RT/cpal-thread side: mark the stream as faulted. ONE relaxed atomic store,
    /// nothing else — safe to call from the cpal `err_fn`. (Relaxed is sufficient:
    /// there is no other state being published alongside the flag; the control
    /// thread only needs to eventually observe the set, which a relaxed store on
    /// one side and a relaxed load on the other guarantees.)
    #[inline]
    pub fn mark(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    /// Non-destructive peek (mostly for tests / diagnostics).
    pub fn is_set(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// Control-thread side: read AND clear the fault in one step, returning
    /// whether a fault was pending. Clearing here (rather than in `mark`) keeps
    /// the cpal `err_fn` a pure store and makes the control thread the single
    /// owner of the rebuild decision — a second fault that lands mid-rebuild is
    /// simply observed on the next tick (no lost edge, no rebuild storm because
    /// the caller debounces on its own host state).
    pub fn take(&self) -> bool {
        self.0.swap(false, Ordering::Relaxed)
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
    /// Shared device-fault signal SET by the cpal output `err_fn` (off the render
    /// thread) and polled+cleared by the control thread to trigger an off-RT
    /// rebuild. Cloned out via [`AudioHost::fault_signal`].
    fault: StreamFault,
    /// Off-RT drain for device-edge faults the output error callback classifies
    /// (device removed, backend error). Lets the control plane SEE a silent stop
    /// instead of it vanishing into a dead `eprintln!` (Track A P0a).
    device_faults: DeviceFaultRx,
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

/// Enumerate the host's available OUTPUT devices as `(id, name)` pairs for the
/// Settings device picker: the stable cpal [`DeviceId`] string (which
/// [`AudioHost::start_with_swap_on_device`] re-opens the stream onto) and the
/// device's human-readable name. Off-RT: queries cpal on the control thread,
/// never the audio thread. A device-less sandbox yields an empty list (the UI
/// degrades to "system default only"); a device that disconnects mid-enumeration
/// is skipped rather than failing the whole list.
pub fn output_devices() -> Vec<(String, String)> {
    let host = cpal::default_host();
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|device| {
            let id = device.id().ok()?.to_string();
            let name = device.description().ok()?.name().to_string();
            Some((id, name))
        })
        .collect()
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

/// The optional wiring a started stream may carry, bundled so the public
/// constructors stay readable and [`AudioHost::start_inner`] takes one tidy
/// argument instead of a growing positional tail. All `None`/default is a plain
/// output-only stream on the system default device.
#[derive(Default)]
struct StartOptions {
    /// The loopback latency harness's RT-side output capture (the `RecorderSink`
    /// path); mutually independent of `mic_node` (one records output, the other
    /// feeds mic input into the engine).
    input_capture: Option<RecorderSink>,
    /// The lock-free graph hot-swap mailbox the callback adopts at each block
    /// boundary (the live UI-edit path).
    swap_rx: Option<ProgramSwapRx>,
    /// The cpal [`DeviceId`] string to open the OUTPUT stream on; `None` (or an
    /// unknown id) falls back to the system default output device.
    device_id: Option<String>,
    /// When `Some`, open the duplex INPUT stream and feed its mono down-mix into
    /// this `MicIn` node's input buffer each block (see [`MicFedEngine`]).
    mic_node: Option<NodeIdx>,
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

    /// A clone of this host's device-fault signal, for the control thread to poll
    /// (`take`) each tick and trigger an off-RT rebuild on a yanked/disabled
    /// device. The signal is SET by the cpal `err_fn` (off the render thread).
    pub fn fault_signal(&self) -> StreamFault {
        self.fault.clone()
    }

    /// Has the output stream faulted (device yanked/disabled/reconfigured) since
    /// the last [`StreamFault::take`]? Non-destructive convenience for the control
    /// thread; the rebuild path uses `fault_signal().take()` to read-and-clear.
    pub fn faulted(&self) -> bool {
        self.fault.is_set()
    }

    /// Drain any device-edge faults the output error callback reported since the
    /// last poll (oldest first). The control plane calls this off-RT — e.g. to
    /// surface a non-focus-stealing "device removed" indicator and, later, to
    /// drive recovery. Returns immediately when there is nothing pending.
    pub fn drain_device_faults(&mut self, sink: impl FnMut(DeviceFault)) {
        self.device_faults.drain(sink);
    }

    /// Pop a single pending device fault, if any (off-RT).
    pub fn poll_device_fault(&mut self) -> Option<DeviceFault> {
        self.device_faults.try_recv()
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
        engine: Engine,
        rx: CommandConsumer,
    ) -> Result<Self, HostError> {
        Self::start_inner(req, engine, rx, StartOptions::default())
    }

    /// Like [`start`](Self::start) but the callback also adopts hot-swapped
    /// programs published into `swap_rx` at each block boundary — so a UI graph
    /// edit becomes a lock-free in-callback program swap with NO stream
    /// teardown/restart (the live path, [`crate`] consumer: `src-tauri`'s
    /// `EngineBackend`). The displaced program is dropped off the audio thread
    /// (see [`ProgramSwapRx::install_into`]).
    pub fn start_with_swap(
        req: StreamRequest,
        engine: Engine,
        rx: CommandConsumer,
        swap_rx: ProgramSwapRx,
    ) -> Result<Self, HostError> {
        Self::start_inner(
            req,
            engine,
            rx,
            StartOptions {
                swap_rx: Some(swap_rx),
                ..StartOptions::default()
            },
        )
    }

    /// The unified live path: hot-swap (`swap_rx`) on a CHOSEN output device, with
    /// OPTIONAL mic capture wired into the engine's `MicIn` node. This is the one
    /// seam the device picker (Settings → Audio) and the mic toggle drive — the
    /// `EngineBackend` reopens the stream through here on a device change or a mic
    /// enable/disable, exactly as the device-loss rebuild does.
    ///
    /// * `device_id` — the cpal [`DeviceId`] string to open the OUTPUT stream on,
    ///   resolved via `host.device_by_id`; `None` (or an id no longer present)
    ///   falls back to the system default output. Selecting a device costs ONE
    ///   controlled stream rebuild (a brief held-note gap), identical to
    ///   device-loss recovery.
    /// * `mic_node` — when `Some`, the duplex INPUT stream is opened and its
    ///   capture is down-mixed to mono and fed into `engine.input_mut(node, 0)`
    ///   each block over a wait-free ring (so a `MicIn` source node hears the
    ///   microphone). `None` opens output only.
    pub fn start_with_swap_on_device(
        req: StreamRequest,
        engine: Engine,
        rx: CommandConsumer,
        swap_rx: ProgramSwapRx,
        device_id: Option<String>,
        mic_node: Option<NodeIdx>,
    ) -> Result<Self, HostError> {
        Self::start_inner(
            req,
            engine,
            rx,
            StartOptions {
                swap_rx: Some(swap_rx),
                device_id,
                mic_node,
                ..StartOptions::default()
            },
        )
    }

    /// Like [`start`](Self::start) but the duplex input is captured into
    /// `capture` (a [`RecorderSink`]) on the RT thread — the seam the loopback
    /// latency harness uses to record the round-trip impulse on real hardware.
    /// Requires `req.duplex_input = true` to actually open the input stream.
    pub fn start_with_input_capture(
        req: StreamRequest,
        engine: Engine,
        rx: CommandConsumer,
        capture: RecorderSink,
    ) -> Result<Self, HostError> {
        Self::start_inner(
            req,
            engine,
            rx,
            StartOptions {
                input_capture: Some(capture),
                ..StartOptions::default()
            },
        )
    }

    fn start_inner(
        req: StreamRequest,
        mut engine: Engine,
        mut rx: CommandConsumer,
        opts: StartOptions,
    ) -> Result<Self, HostError> {
        let StartOptions {
            input_capture,
            swap_rx,
            device_id,
            mic_node,
        } = opts;
        // Mic capture REQUIRES the duplex input; force it on so a caller cannot ask
        // to feed a `MicIn` node without opening the stream that fills it.
        let mut req = req;
        req.duplex_input |= mic_node.is_some();

        let host = cpal::default_host();
        // Resolve the CHOSEN output device by its stable cpal id (the device
        // picker's selection), falling back to the system default when no id was
        // given OR the id no longer enumerates (the device was unplugged since the
        // UI listed it — we honour the request best-effort, never error on a stale
        // pick). A malformed id string is likewise a silent fall-back to default.
        let device = device_id
            .as_deref()
            .and_then(|id| DeviceId::from_str(id).ok())
            .and_then(|id| host.device_by_id(&id))
            .or_else(|| host.default_output_device())
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
        // pulls. Two independent RT-side capture seams may ride the input
        // callback: the loopback harness's `RecorderSink` (records the raw input
        // off-RT) and — when a `MicIn` node is wired — a `MicCaptureSink` that
        // down-mixes the input to mono and hands it to the output callback over a
        // wait-free ring, so the engine's mic source hears the microphone.
        //
        // The mic ring is sized for ~0.5 s of mono slack at 48 kHz between the
        // input and output callbacks — generous headroom for differing callback
        // cadences; on overrun the input side drops (never blocks the RT thread).
        let (mic_capture, mut mic_drain) = match mic_node {
            Some(_) => {
                let (sink, drain) = mic_ring(crate::recorder::DEFAULT_RING_FRAMES);
                (Some(sink), Some(drain))
            }
            None => (None, None),
        };
        let input = if req.duplex_input {
            Some(Self::build_input(
                &host,
                &config,
                input_capture,
                mic_capture,
            )?)
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

        // Shared device-fault signal. The cpal `err_fn` (cpal's own error thread,
        // NOT the render thread) SETS it; the control thread polls + clears it to
        // drive the off-RT rebuild. The render data callback never touches it.
        let fault = StreamFault::new();
        let err_fault = fault.clone();
        // Device-fault mailbox: the output error callback classifies a cpal error
        // and publishes a typed fault the control plane can drain off-RT, instead
        // of the silent stop a bare `eprintln!` left behind (Track A P0a). `cap`
        // is generous; faults are coalescable so a full ring is harmless.
        let (mut fault_tx, fault_rx) = device_fault_channel(16);
        let err_fn = move |e: cpal::Error| {
            // CPAL-ERROR-THREAD CONTRACT: one atomic store plus one bounded,
            // wait-free mailbox push. Stream rebuild remains owned by the control
            // thread; the typed fault is for observation/supervision.
            err_fault.mark();
            let fault = classify(is_device_absent(&e));
            fault_tx.push(fault);
            eprintln!(
                "audio output stream error (flagged for rebuild): {e} (device fault: {fault:?})"
            );
        };

        // `mic_drain` (the output-side ring consumer) + `mic_node` move into the
        // callback when mic capture is wired; `MicFedEngine` fills the `MicIn`
        // node's input each block from the ring just before rendering.
        let output = device
            .build_output_stream(
                config,
                move |data: &mut [f32], _info: &cpal::OutputCallbackInfo| {
                    if !promoted {
                        promoted = true;
                        promote_audio_thread(buffer_frames, sample_rate);
                        // Flush denormals in hardware on the render thread (in-loop
                        // denormal-spike guard; complements per-node sanitize).
                        set_flush_denormals();
                    }
                    // Adopt a hot-swapped program (if one was published) at the
                    // block boundary, BEFORE rendering. Lock-free; the displaced
                    // program is dropped off-thread (basedrop). `install` may grow
                    // the engine's per-node tables here — a block-boundary
                    // allocation the engine contract explicitly sanctions (see
                    // `Engine::install`), distinct from the strictly alloc-free
                    // `process_block` hot path.
                    if let Some(swap) = swap_rx.as_ref() {
                        swap.install_into(&mut engine);
                    }
                    // With mic capture wired, feed the `MicIn` node from the ring
                    // per engine-block (inside `render_block`'s chunking) via the
                    // `MicFedEngine` adapter; otherwise render the engine directly.
                    match (mic_node, mic_drain.as_mut()) {
                        (Some(node), Some(mic)) => {
                            let mut fed = MicFedEngine {
                                engine: &mut engine,
                                mic,
                                mic_node: node,
                            };
                            render_block(&mut fed, &mut rx, data, ch, &mut mono);
                        }
                        _ => render_block(&mut engine, &mut rx, data, ch, &mut mono),
                    }
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
            fault,
            device_faults: fault_rx,
        })
    }

    /// Build the duplex input (capture) stream on the default INPUT device. Two
    /// independent RT-side seams ride its callback, either or both optional:
    /// `capture` is the loopback harness's off-RT [`RecorderSink`]; `mic` is the
    /// [`MicCaptureSink`] that down-mixes the input to mono and hands it to the
    /// output callback over the wait-free mic ring (so a `MicIn` node hears the
    /// microphone). With neither wired the callback just drains so the backend
    /// does not overrun.
    fn build_input(
        host: &cpal::Host,
        out_config: &StreamConfig,
        mut capture: Option<RecorderSink>,
        mut mic: Option<MicCaptureSink>,
    ) -> Result<Stream, HostError> {
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
        // The mic down-mix needs the input lane count (known here, off-RT) so the
        // RT callback does no division-by-channels work beyond the average.
        let in_channels = in_config.channels as usize;

        let err_fn = |e: cpal::Error| eprintln!("audio input stream error: {e}");
        in_device
            .build_input_stream(
                in_config,
                move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                    // RT-safe capture: push the interleaved input block into the
                    // off-RT recorder ring when a sink is wired (the loopback
                    // harness installs one), and/or push the mono down-mix into the
                    // mic ring for the engine's `MicIn` node. Both are wait-free and
                    // drop on a full ring — the capture thread is never stalled.
                    if let Some(sink) = capture.as_mut() {
                        sink.capture(data);
                    }
                    if let Some(sink) = mic.as_mut() {
                        sink.capture(data, in_channels);
                    }
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
    use ojproto::RtCommand;

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
    fn stream_fault_marks_and_takes_once() {
        // The cpal err_fn side `mark`s; the control side `take`s it read-and-clear.
        let fault = StreamFault::new();
        assert!(!fault.is_set(), "fresh signal is un-faulted");
        assert!(!fault.take(), "take on a clean signal is false");

        fault.mark();
        assert!(fault.is_set(), "mark sets the flag");
        // First take consumes the edge; a second take sees nothing (no rebuild storm
        // from one device-loss — the control thread debounces on this single edge).
        assert!(fault.take(), "first take observes the fault");
        assert!(!fault.take(), "second take is clear (debounced)");
        assert!(!fault.is_set(), "take cleared the flag");
    }

    #[test]
    fn stream_fault_is_shared_across_clones() {
        // The `err_fn` holds a clone; the host holds the original. A mark on either
        // is visible on the other (the Arc<AtomicBool> is shared, not copied).
        let host_side = StreamFault::new();
        let err_side = host_side.clone();
        err_side.mark();
        assert!(
            host_side.is_set(),
            "mark on the err_fn clone is seen host-side"
        );
        assert!(
            host_side.take(),
            "host-side take observes the err_fn's mark"
        );
        assert!(
            !err_side.is_set(),
            "clearing on one clone clears the shared flag"
        );
    }

    #[test]
    fn set_flush_denormals_is_safe_to_call() {
        // Smoke: enabling FTZ/DAZ on the current thread must never panic on any
        // supported arch (and is a no-op where there's no denormal-flush control).
        // Covers x86_64 here + in CI; the macOS arm64 job exercises the aarch64 path.
        super::set_flush_denormals();
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

    #[test]
    fn mic_ring_round_trips_mono_capture() {
        // The input side pushes a mono signal; the output side drains it in
        // order. No device needed — this is the wait-free RT→RT hand-off.
        let (mut sink, mut drain) = mic_ring(16);
        let signal = [0.1f32, -0.2, 0.3, -0.4];
        // channels == 1: each frame is its own sample (no averaging).
        sink.capture(&signal, 1);

        let mut out = [9.0f32; 4];
        drain.drain_into(&mut out);
        for (i, (&a, &b)) in signal.iter().zip(out.iter()).enumerate() {
            assert!((a - b).abs() < 1e-9, "frame {i}: {a} != {b}");
        }
    }

    #[test]
    fn mic_capture_down_mixes_interleaved_to_mono() {
        // A stereo block averages its two lanes into one mono sample per frame.
        let (mut sink, mut drain) = mic_ring(16);
        // L = 1.0, R = 0.0 -> 0.5; L = -0.4, R = -0.6 -> -0.5.
        let stereo = [1.0f32, 0.0, -0.4, -0.6];
        sink.capture(&stereo, 2);

        let mut out = [0.0f32; 2];
        drain.drain_into(&mut out);
        assert!((out[0] - 0.5).abs() < 1e-6, "frame 0 down-mix");
        assert!((out[1] + 0.5).abs() < 1e-6, "frame 1 down-mix");
    }

    #[test]
    fn mic_drain_pads_an_underfilled_ring_with_silence() {
        // An empty/short ring must not block or read stale memory: the unfilled
        // tail is silence, so the engine simply hears nothing where there is no
        // capture yet (a held note beats a glitch).
        let (mut sink, mut drain) = mic_ring(16);
        sink.capture(&[0.7f32], 1); // only one sample available

        let mut out = [9.0f32; 4];
        drain.drain_into(&mut out);
        assert!((out[0] - 0.7).abs() < 1e-9, "first sample is the capture");
        assert!(
            out[1..].iter().all(|&s| s == 0.0),
            "tail past the capture is silence, not stale"
        );
    }

    #[test]
    fn mic_capture_zero_channels_is_safe() {
        // A degenerate 0-channel input block is a no-op (no panic, no push).
        let (mut sink, mut drain) = mic_ring(8);
        sink.capture(&[0.5f32, 0.5], 0);
        let mut out = [0.0f32; 2];
        drain.drain_into(&mut out);
        assert!(out.iter().all(|&s| s == 0.0), "nothing captured");
    }

    #[test]
    fn mic_fed_engine_fills_mic_node_then_renders() {
        // The `MicFedEngine` adapter fills the `MicIn` node's input from the ring
        // and the signal flows to the master output — verified end-to-end through
        // a real compiled program (MicIn -> SpeakerOut), no audio device.
        use ojcore::{compile, register_builtins, BuiltinOpts, PluginRegistry};
        use ojproto::{ConnectionType, IrEdge, IrNode, NodeIdx, OjGraph, PrimitiveKind};

        let mut reg = PluginRegistry::new();
        register_builtins(&mut reg, BuiltinOpts::full());
        let graph = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 8,
            nodes: vec![
                IrNode {
                    id: NodeIdx(0),
                    manifest_id: ojcore::MIC_IN_ID.into(),
                    kind: PrimitiveKind::MicIn,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: ojcore::SPEAKER_OUT_ID.into(),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(0),
                from_port: 0,
                to_node: NodeIdx(1),
                to_port: 0,
                kind: ConnectionType::Audio,
            }],
            schedule: vec![],
        };
        let prog = compile(&graph, &reg).expect("MicIn -> SpeakerOut compiles");
        let mut engine = Engine::new(prog);

        // Push a known mono signal into the mic ring, then render through the
        // adapter and confirm the master output carries it (the mic was heard).
        let (mut sink, mut drain) = mic_ring(16);
        let signal = [0.25f32, -0.25, 0.5, -0.5];
        sink.capture(&signal, 1);

        let (_tx, rx) = ojcore::CommandQueue::split(8);
        let mut rx = rx;
        let mut fed = MicFedEngine {
            engine: &mut engine,
            mic: &mut drain,
            mic_node: NodeIdx(0),
        };
        let mut out = vec![0.0f32; signal.len()];
        let mut mono = vec![0.0f32; signal.len()];
        render_block(&mut fed, &mut rx, &mut out, 1, &mut mono);

        for (i, (&a, &b)) in signal.iter().zip(out.iter()).enumerate() {
            assert!(
                (a - b).abs() < 1e-6,
                "mic frame {i} reached output: {a} != {b}"
            );
        }
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

    /// Loopback round-trip automation: with a loopback cable (or software
    /// loopback) feeding output back into input, `start_with_input_capture`
    /// records the input on the RT thread into a [`Recorder`]; the control thread
    /// drains it and detects the rendered impulse, turning the manual runbook into
    /// a measurement. Device-gated; run on founder hardware with
    /// `cargo test -p ojcore-native -- --ignored loopback`.
    #[test]
    #[ignore = "requires a real duplex device + a loopback cable; run on founder hardware"]
    fn loopback_capture_records_input() {
        use crate::recorder::Recorder;
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

        // Capture the duplex input into a Recorder via its RT-side sink.
        let (mut recorder, sink) = Recorder::with_default_ring(2, 48_000);
        let host = AudioHost::start_with_input_capture(
            StreamRequest {
                sample_rate: 48_000,
                buffer_frames: 64,
                channels: 2,
                duplex_input: true,
            },
            engine,
            rx,
            sink,
        )
        .expect("host start with capture");

        // Let the duplex stream run, then drain what the input captured.
        std::thread::sleep(Duration::from_millis(300));
        recorder.drain();
        let pcm = recorder.finish();
        assert!(
            !pcm.samples.is_empty(),
            "loopback capture recorded no input frames"
        );
        assert_eq!(host.config().sample_rate, 48_000);
    }
}
