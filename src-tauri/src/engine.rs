//! The native realtime audio backend behind the Tauri shell.
//!
//! This is the "back" half of OpenJammer's hybrid architecture: a web UI front
//! (the existing Vite app, loaded into the Tauri webview) talking control-rate
//! IPC to the native `<5 ms` engine here. The pieces map 1:1 onto the workspace
//! crates:
//!
//! * [`ojcore::PluginRegistry`] — every node type is "just a plugin"; on setup
//!   we register the built-in gain plus the `ojinstrument` Osc / Sampler /
//!   Karplus loaders. Compilation lowers an [`ojproto::OjGraph`] against it.
//! * [`ojcore::compile`] -> [`ojcore::Engine`] — a graph becomes a runnable,
//!   pre-allocated program; the engine runs it one block at a time.
//! * [`ojcore_native::AudioHost`] — opens the small-buffer cpal stream and OWNS
//!   the engine inside its realtime-promoted audio callback (its own thread).
//! * [`ojcore::CommandQueue`] — the wait-free UI->RT ring. The control side
//!   (these Tauri command handlers) holds the [`ojcore::CommandProducer`]; the
//!   audio callback drains the consumer each block.
//! * [`ojcore::ProgramSwap`] — the lock-free graph hot-swap mailbox. `push_graph`
//!   publishes a freshly compiled program here (per the unit's contract); the
//!   audio host adopts it (see [`EngineBackend::push_graph`]).
//!
//! THREADING. The audio engine lives entirely on the audio thread inside
//! [`AudioHost`] (cpal owns that thread; dropping the host stops it). The only
//! shared, control-rate state these handlers touch is the [`CommandProducer`]
//! (behind a `Mutex`, off the RT path) and the recompile inputs. No audio
//! sample buffer ever crosses the IPC boundary — only `OjGraph` / `RtCommand`
//! JSON (governing principle #4).

use std::sync::Mutex;

use ojcore::{
    compile, CommandProducer, CommandQueue, CompileError, Engine, GainLoader, PluginRegistry,
    ProgramSwap,
};
use ojcore_native::{AudioHost, HostError, StreamRequest};
use ojinstrument::{KarplusLoader, OscLoader, SamplerLoader};
use ojproto::{OjGraph, RtCommand};

/// Default stream request: 48 kHz, a small buffer for low latency, stereo out,
/// no duplex input (pure synthesis path). Matches the `<5 ms` engine target;
/// the backend that cannot honour the small buffer falls back and the live
/// latency harness measures the real figure.
pub const DEFAULT_STREAM: StreamRequest = StreamRequest {
    sample_rate: 48_000,
    buffer_frames: 64,
    channels: 2,
    duplex_input: false,
};

/// Capacity (in commands) of the UI->RT ring. Generous headroom for a burst of
/// note/param events between two audio blocks; `RtCommand` is `Copy` and tiny.
const COMMAND_RING_CAP: usize = 1024;

/// Why a backend control operation failed. Surfaces to the webview as a string
/// (these are control-rate, off-RT errors — never raised on the audio thread).
#[derive(Debug)]
pub enum BackendError {
    /// The pushed graph could not be lowered (cycle / unknown manifest / no
    /// master output / dangling edge / out-of-range port).
    Compile(CompileError),
    /// The audio host could not (re)start — typically no audio device in a
    /// headless/CI sandbox, which is expected and non-fatal there.
    Host(HostError),
    /// The UI->RT command ring was full; the command was dropped rather than
    /// blocking the control thread.
    RingFull,
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackendError::Compile(e) => write!(f, "graph compile failed: {e}"),
            BackendError::Host(e) => write!(f, "audio host: {e}"),
            BackendError::RingFull => write!(f, "command ring full; command dropped"),
        }
    }
}

impl std::error::Error for BackendError {}

/// A snapshot of the negotiated stream, returned to the webview for the latency
/// / device readouts.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StreamInfo {
    /// Whether an audio stream is currently running (false in a device-less
    /// sandbox, where `AudioHost::start` returns `NoOutputDevice`).
    pub running: bool,
    /// Negotiated output sample rate in Hz.
    pub sample_rate: u32,
    /// Negotiated output channel count.
    pub channels: u16,
    /// Negotiated buffer size in frames, if the backend honoured a fixed size
    /// (else `None` — the backend chose its own and the live harness measures).
    pub buffer_frames: Option<u32>,
    /// The theoretical buffering-floor round-trip latency in milliseconds
    /// (output-buffer + one engine block; no input ring in the synthesis path).
    pub latency_ms: f32,
}

/// The native backend. Owns the plugin registry (for recompiles), the running
/// audio host (which owns the engine on the audio thread), the shared command
/// producer (for `send_command`), and the program-swap mailbox.
///
/// Wrapped in a Tauri-managed `Mutex` (see [`crate::run`]); every method here is
/// control-rate and runs on the IPC/control thread, never the audio thread.
pub struct EngineBackend {
    /// Open registry: `manifest_id -> loader`. Used to recompile a pushed graph.
    registry: PluginRegistry,
    /// The live audio host (cpal stream + engine on the audio thread). `None`
    /// when no device is available (headless/CI) — the backend stays usable for
    /// compile/validation and re-tries on the next `push_graph`.
    host: Option<AudioHost>,
    /// Control side of the UI->RT command ring; `send_command` enqueues here.
    /// Re-created whenever the host (re)starts, since the consumer half moves
    /// into the new audio callback.
    producer: CommandProducer,
    /// The graph hot-swap mailbox. `push_graph` publishes a freshly compiled
    /// program here per the unit's contract; see [`EngineBackend::push_graph`].
    swap: ProgramSwap,
    /// The stream request the host (re)starts with.
    stream: StreamRequest,
}

impl EngineBackend {
    /// Build the backend: register the built-in + instrument loaders, compile a
    /// minimal starter graph, create an [`Engine`], and start the [`AudioHost`].
    ///
    /// A device-less environment (CI / headless) is NOT an error: the host is
    /// left `None`, the producer is a live ring (its consumer parked until the
    /// first successful start), and control commands still validate.
    pub fn new() -> Self {
        let registry = Self::build_registry();
        let stream = DEFAULT_STREAM;
        let swap = ProgramSwap::new();

        // Compile the minimal starter program (silent: a gain into the speaker).
        // `compile` only fails on a malformed graph, and ours is well-formed by
        // construction, so a failure here is a build-time bug, not a runtime one.
        let program =
            compile(&Self::starter_graph(stream), &registry).expect("starter graph compiles");
        let engine = Engine::new(program);

        // Split a fresh command ring; the consumer moves into the audio host.
        let (producer, consumer) = CommandQueue::split(COMMAND_RING_CAP);

        // Try to start audio. No device => keep the backend alive without a host
        // (the expected sandbox path); any other host error is also non-fatal
        // here — the next `push_graph` re-attempts the start.
        let host = match AudioHost::start(stream, engine, consumer) {
            Ok(h) => Some(h),
            Err(HostError::NoOutputDevice) => {
                eprintln!(
                    "ojcore: no audio output device; UI runs, engine idle until a device appears"
                );
                None
            }
            Err(e) => {
                eprintln!("ojcore: audio host failed to start (non-fatal): {e}");
                None
            }
        };

        Self {
            registry,
            host,
            producer,
            swap,
            stream,
        }
    }

    /// Register the built-in gain plus the `ojinstrument` Osc / Sampler /
    /// Karplus loaders. "Everything is a plugin": these all implement the same
    /// `PluginLoader` surface and the compiler lowers them uniformly.
    fn build_registry() -> PluginRegistry {
        let mut registry = PluginRegistry::new();
        registry.register(Box::new(GainLoader::new()));
        registry.register(Box::new(OscLoader::new()));
        registry.register(Box::new(SamplerLoader::new()));
        registry.register(Box::new(KarplusLoader::new()));
        registry
    }

    /// The minimal well-formed graph the engine boots with: a unity gain feeding
    /// the master `SpeakerOut`. Silent until the UI pushes a real graph, but it
    /// satisfies `compile`'s "exactly one master output" rule so the audio
    /// stream can run from the very first block.
    fn starter_graph(stream: StreamRequest) -> OjGraph {
        use ojproto::{IrEdge, IrNode, NodeIdx, PrimitiveKind};
        OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: stream.sample_rate,
            block_size: stream.buffer_frames,
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
        }
    }

    /// Recompile a graph pushed from the UI and adopt it into the running engine.
    ///
    /// CONTRACT (this unit): compile the [`OjGraph`] against the registry, then
    /// publish the program into the [`ProgramSwap`] mailbox. Because the public
    /// [`AudioHost`] API moves the engine wholesale into its callback (it has no
    /// per-block swap hook of its own), adoption is realised by REBUILDING the
    /// host around a fresh [`Engine`] from the same program: compile once, run
    /// the new program. The swap mailbox is still the publish point of record,
    /// so when the host gains an in-callback `install_into` hook this path
    /// collapses to "publish only" with no IPC change.
    ///
    /// This is control-rate (off the audio thread). The displaced host is
    /// dropped here, which stops the old stream cleanly off-RT.
    pub fn push_graph(&mut self, graph: &OjGraph) -> Result<(), BackendError> {
        // Compile once; reuse the program for both the swap publish and the
        // fresh engine. `CompiledProgram` is not `Clone`, so we compile twice
        // from the same graph: one program to publish, one to run. Both are
        // off-RT allocations.
        let published = compile(graph, &self.registry).map_err(BackendError::Compile)?;
        self.swap.publish(published);

        let program = compile(graph, &self.registry).map_err(BackendError::Compile)?;
        let engine = Engine::new(program);

        // Fresh command ring for the new audio callback; the old producer (and
        // any unsent commands) is replaced.
        let (producer, consumer) = CommandQueue::split(COMMAND_RING_CAP);

        // Update the stream request to the graph's rate/block before restart.
        self.stream.sample_rate = graph.sample_rate;
        self.stream.buffer_frames = graph.block_size;

        // Drop the old host first (stops the old stream), then start the new one.
        self.host = None;
        match AudioHost::start(self.stream, engine, consumer) {
            Ok(h) => {
                self.host = Some(h);
                self.producer = producer;
                Ok(())
            }
            Err(HostError::NoOutputDevice) => {
                // No device: keep the (compiled, published) program staged and
                // the new producer live so commands still validate. Not an error
                // the UI must surface — it just means "engine idle, no device".
                self.producer = producer;
                Ok(())
            }
            Err(e) => Err(BackendError::Host(e)),
        }
    }

    /// Enqueue one [`RtCommand`] onto the UI->RT ring (the high-rate control
    /// path: note on/off, param patches, transport). Wait-free push; a full
    /// ring drops the command rather than blocking the control thread.
    pub fn send_command(&mut self, cmd: RtCommand) -> Result<(), BackendError> {
        self.producer.push(cmd).map_err(|_| BackendError::RingFull)
    }

    /// Whether an audio stream is currently running.
    pub fn is_running(&self) -> bool {
        self.host.is_some()
    }

    /// A snapshot of the negotiated stream for the UI's latency / device
    /// readout. When no host is running (device-less), reports the requested
    /// config with `running: false`.
    pub fn stream_info(&self) -> StreamInfo {
        match &self.host {
            Some(host) => {
                let cfg = host.config();
                let buffer_frames = host.buffer_frames();
                // Buffering floor: one output buffer + one engine block. With no
                // duplex input there is no capture ring in the path.
                let frames = buffer_frames.unwrap_or(self.stream.buffer_frames);
                let latency_ms =
                    ojcore_native::frames_to_ms(frames.saturating_mul(2), cfg.sample_rate);
                StreamInfo {
                    running: true,
                    sample_rate: cfg.sample_rate,
                    channels: cfg.channels,
                    buffer_frames,
                    latency_ms,
                }
            }
            None => StreamInfo {
                running: false,
                sample_rate: self.stream.sample_rate,
                channels: self.stream.channels,
                buffer_frames: Some(self.stream.buffer_frames),
                latency_ms: ojcore_native::frames_to_ms(
                    self.stream.buffer_frames.saturating_mul(2),
                    self.stream.sample_rate,
                ),
            },
        }
    }
}

impl Default for EngineBackend {
    fn default() -> Self {
        Self::new()
    }
}

/// Tauri-managed wrapper: the backend behind a `Mutex` so the IPC command
/// handlers (which run on Tauri's worker pool) get exclusive control-rate
/// access. Never locked from the audio thread (that thread is inside `cpal`,
/// owning the engine, and never touches this).
pub struct BackendState(pub Mutex<EngineBackend>);

impl BackendState {
    pub fn new() -> Self {
        Self(Mutex::new(EngineBackend::new()))
    }
}

impl Default for BackendState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The backend constructs in a device-less sandbox without panicking: it
    /// registers loaders, compiles the starter graph, and leaves `host` empty
    /// when no audio device exists. (A real device only appears on hardware.)
    #[test]
    fn backend_constructs_headless() {
        let be = EngineBackend::new();
        // No device in CI => not running, but the producer ring is live.
        let info = be.stream_info();
        assert_eq!(info.sample_rate, DEFAULT_STREAM.sample_rate);
        assert!(info.latency_ms > 0.0);
    }

    /// The registry knows every loader the unit must register, by manifest id.
    #[test]
    fn registry_has_builtin_and_instruments() {
        let reg = EngineBackend::build_registry();
        assert!(reg.contains(ojcore::GAIN_ID));
        assert!(reg.contains(ojinstrument::OSC_ID));
        assert!(reg.contains(ojinstrument::SAMPLER_ID));
        assert!(reg.contains(ojinstrument::KARPLUS_ID));
    }

    /// The starter graph lowers cleanly (exactly one master output, no cycle).
    #[test]
    fn starter_graph_compiles() {
        let reg = EngineBackend::build_registry();
        let g = EngineBackend::starter_graph(DEFAULT_STREAM);
        assert!(compile(&g, &reg).is_ok());
    }

    /// `push_graph` recompiles a UI-pushed graph and publishes it (device-less:
    /// no host, but no error either — the program is staged).
    #[test]
    fn push_graph_compiles_and_publishes() {
        let mut be = EngineBackend::new();
        let g = EngineBackend::starter_graph(DEFAULT_STREAM);
        assert!(be.push_graph(&g).is_ok());
        // The swap mailbox holds the published program.
        assert!(be.swap.has_pending());
    }

    /// A malformed graph (no master output) is rejected as a compile error,
    /// never silently patched.
    #[test]
    fn push_graph_rejects_bad_graph() {
        use ojproto::{IrNode, NodeIdx, PrimitiveKind};
        let mut be = EngineBackend::new();
        let bad = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![IrNode {
                id: NodeIdx(0),
                manifest_id: ojcore::GAIN_ID.into(),
                kind: PrimitiveKind::Gain,
                params: vec![],
                assets: vec![],
                n_in: 1,
                n_out: 1,
            }],
            edges: vec![],
            schedule: vec![],
        };
        assert!(matches!(
            be.push_graph(&bad),
            Err(BackendError::Compile(CompileError::NoMasterOutput))
        ));
    }

    /// `send_command` enqueues onto the live ring even with no audio device.
    #[test]
    fn send_command_enqueues() {
        let mut be = EngineBackend::new();
        assert!(be.send_command(RtCommand::TransportPlay).is_ok());
    }
}
