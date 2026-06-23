//! The native realtime audio backend behind the Tauri shell.
//!
//! This is the "back" half of OpenJammer's hybrid architecture: a web UI front
//! (the existing Vite app, loaded into the Tauri webview) talking control-rate
//! IPC to the native `<5 ms` engine here. The pieces map 1:1 onto the workspace
//! crates:
//!
//! * [`ojcore::PluginRegistry`] — every node type is "just a plugin"; on setup
//!   we register the FULL built-in set through the ONE shared path
//!   [`ojinstrument::register_all`] (effects: gain / biquad / waveshaper /
//!   delay / convolution; structural I/O; instruments: Osc / Sampler / Karplus /
//!   SF2). The `wasm32` worklet calls the SAME function (minus SF2), so the two
//!   registries stay in lockstep. Compilation lowers an [`ojproto::OjGraph`]
//!   against it.
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

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ojcore::meter::{event_frame, return_frame};
use ojcore::{
    compile, compile_resilient, master_param, CommandConsumer, CommandProducer, CommandQueue,
    CompileError, Engine, EventRing, MeterRing, PluginManifest, PluginRegistry, ProgramSwap,
};
use ojcore_native::{
    device_fault_channel, install_device_listener, probe_default_output, AssetCatalog, AssetError,
    AssetStore, AudioHost, DeviceFault, DeviceFaultRx, DeviceListener, DeviceSupervisor,
    DeviceWatcher, HostError, LogRecord, LogStore, Pcm, RecoveryAction, StreamRequest,
};
use ojhost::{register_scanned, scan, HostError as PluginHostError, PluginDescriptor};
use ojinstrument::{register_all, RegisterOpts};
use ojproto::{
    AssetId, AssetRef, EngineFrame, Event, EventKind, NodeIdx, OjGraph, RtCommand, RtEvent,
    Severity, Source,
};
use ojwasm::WasmHostLoader;

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
    /// The UI->RT command ring was full; the command was dropped rather than
    /// blocking the control thread.
    RingFull,
    /// Scanning a plugin directory failed (I/O / cache error). In the scaffold
    /// build (no hosting backend) scanning never errors — it returns empty.
    PluginScan(PluginHostError),
    /// An asset (sample / recording) decode/encode/store operation failed.
    Asset(AssetError),
    /// A capability command referenced a node id not present in the live graph.
    UnknownNode(u32),
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackendError::Compile(e) => write!(f, "graph compile failed: {e}"),
            BackendError::RingFull => write!(f, "command ring full; command dropped"),
            BackendError::PluginScan(e) => write!(f, "plugin scan failed: {e}"),
            BackendError::Asset(e) => write!(f, "asset operation failed: {e}"),
            BackendError::UnknownNode(n) => write!(f, "unknown node id {n} in live graph"),
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
    /// Control-side clone of the engine's RT -> control meter return ring. The
    /// matching `Arc` is attached to the engine before it moves into the audio
    /// host (see [`EngineBackend::start_host`]); the engine publishes `Meter`
    /// frames here at block end, and [`EngineBackend::drain_meters`] reads them
    /// off the control thread for the `meters` Tauri event.
    meter_ring: Arc<MeterRing>,
    /// Control-side clone of the engine's dedicated RT -> control event ring.
    /// The engine publishes compact fault events here; `poll_events` drains and
    /// lifts them into full protocol `Event` envelopes for DevLog/diagnostics.
    event_ring: Arc<EventRing>,
    /// Monotonic sequence assigned while lifting compact RT events off-thread.
    event_seq: u32,
    /// Control-side queue of synthesized `Event`s that do NOT originate on the RT
    /// event ring — e.g. a `Lifecycle` device-loss when an audio host restart
    /// fails. The ring is `Copy`-only (`RtEvent` carries no `Lifecycle` variant),
    /// so these full envelopes are parked here and prepended by [`drain_events`]
    /// so the fault still reaches the pipe. Off-RT: only the control thread (these
    /// command handlers) ever pushes/drains it.
    pending_events: Vec<Event>,
    /// Whether metering is enabled (mirrored so a graph swap re-applies it).
    metering: bool,
    /// Off-RT content-addressed asset catalog (sample PCM for the sampler,
    /// captured recordings). Loading a sample / finishing a recording stores
    /// here, exactly as the native asset pipeline does.
    catalog: AssetCatalog,
    /// Off-RT WAV codec for recorder export.
    store: AssetStore,
    /// In-progress / completed captures, keyed by node id. v1 keeps the captured
    /// PCM here so `recorder_stop` can return it / `recorder_export` can write a
    /// WAV; the live engine-output tap is the documented gap (see `recorder_start`).
    captures: std::collections::HashMap<u32, CaptureState>,
    /// The last graph adopted into the engine. Kept so a control command that
    /// must alter the LIVE program without a fresh UI push — binding a freshly
    /// loaded sample to a Sampler node — can re-resolve + recompile the same
    /// graph against the updated [`AssetCatalog`]. `None` until the first
    /// `push_graph` (the starter graph runs but is not stored).
    last_graph: Option<OjGraph>,
    /// `true` while the engine is in the DEVICE-LOST state: the running output
    /// stream faulted (device yanked/disabled/reconfigured) and a rebuild has not
    /// yet succeeded. Set by [`tick`] on the first detected fault, cleared on a
    /// successful rebuild. Drives the de-bounce (one `DeviceLost` event per loss,
    /// not per retry tick) and gates the `DeviceRecovered` event (only emitted if
    /// we were actually lost). Off-RT: only the control thread touches it.
    device_lost: bool,
    /// The L3 durable LOCAL log store (SQLite + FTS5), the queryable tail of the
    /// fault trail. `None` until [`attach_log_store`] wires one (the Tauri shell
    /// opens it under the platform log dir in `setup`); never network, never the
    /// post-crash SSOT (the NDJSON file is). Fed ONLY here, on the control thread,
    /// from [`drain_events`] — never the audio callback. A write failure is
    /// swallowed (best-effort durability must never take the instrument down).
    log_store: Option<LogStore>,
    /// Device-loss recovery policy (Track A P1). Driven each control poll by
    /// [`EngineBackend::poll_device_recovery`] from the host's `DeviceFault`
    /// mailbox: on a removal it holds the last good sound and rebuilds the stream
    /// with backoff (exactly one rebuild per loss; xruns never rebuild).
    supervisor: DeviceSupervisor,
    /// Wall-clock (µs) of the last reopen attempt, so retries are paced (~1s
    /// backoff) instead of hammered on every fast UI poll.
    last_reopen_us: u64,
    /// Portable default-output-device watcher: detects a silent device swap /
    /// removal that cpal's error callback may never report (cpal #373), by polling.
    device_watcher: DeviceWatcher,
    /// Wall-clock (µs) of the last device probe, so the (device-enumerating) probe
    /// runs ~1 Hz rather than on every fast UI poll.
    last_probe_us: u64,
    /// Event-driven OS default-device listener (macOS CoreAudio; `None` elsewhere —
    /// Windows is covered by cpal's own notifier + `err_fn`). Held for its `Drop`
    /// (deregisters). It feeds `listener_faults` the instant the OS notices, ahead
    /// of the ~1 Hz poll.
    _device_listener: Option<DeviceListener>,
    /// Drain for faults the OS listener emits (empty where there is no listener).
    listener_faults: DeviceFaultRx,
    /// The chosen OUTPUT device's cpal [`DeviceId`] string, or `None` for the
    /// system default. Set by [`set_speaker_device`]; the audio host is (re)opened
    /// onto it through the SAME rebuild seam device-loss recovery uses, so a pick
    /// costs one controlled stream rebuild (a brief held-note gap) and survives a
    /// later graph swap / recovery (every `open_host` honours it).
    selected_output_device: Option<String>,
    /// The live `MicIn` node fed by the duplex input stream, or `None` when mic
    /// capture is off. Set by [`set_mic`]; while `Some`, the host opens the duplex
    /// input and feeds this node's buffer from the mic ring each block. Re-applied
    /// on every `open_host` so it survives a graph swap / device recovery.
    mic_node: Option<NodeIdx>,
}

/// State of one recorder capture for a node.
struct CaptureState {
    /// Captured interleaved PCM (filled by the engine-output tap when wired).
    pcm: Vec<f32>,
    /// The capture's sample rate / channel count.
    sample_rate: u32,
    channels: u16,
    /// Whether the capture is currently armed/recording.
    recording: bool,
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
        // Event-driven OS device-change listener (macOS; None elsewhere) feeds this
        // mailbox; drained alongside the host's err_fn faults + the polling watcher.
        let (listener_tx, listener_rx) = device_fault_channel(8);
        // Render at the DEVICE's default sample rate, not a hardcoded 48k: a pro
        // interface (e.g. the MOTU M4) may run at 96k, and rendering at the wrong
        // rate plays back at the wrong pitch/tempo. The hardware is authoritative;
        // the graph's own rate is just the UI hint (overridden per push_graph too).
        let mut stream = DEFAULT_STREAM;
        if let Some(rate) = ojcore_native::default_output_sample_rate() {
            stream.sample_rate = rate;
        }
        let swap = ProgramSwap::new();
        let meter_ring = Arc::new(MeterRing::new());
        let event_ring = Arc::new(EventRing::new());

        // Compile the minimal starter program (silent: a gain into the speaker).
        // `compile` only fails on a malformed graph, and ours is well-formed by
        // construction, so a failure here is a build-time bug, not a runtime one.
        // Justified panic (Phase-4 scoped panic guard): the precondition is a
        // compile-time invariant, not runtime input — an `Err` here is unreachable.
        #[allow(clippy::expect_used)]
        let program =
            compile(&Self::starter_graph(stream), &registry).expect("starter graph compiles");
        let mut engine = Engine::new(program);
        // Attach the control-side meter ring up front. The same `Arc` clone is
        // kept on the control side so `drain_meters` reads what the audio thread
        // publishes.
        engine.attach_meter_ring(Some(Arc::clone(&meter_ring)));
        engine.attach_event_ring(Some(Arc::clone(&event_ring)));
        // Metering is enabled for the engine's whole life. With publish-only graph
        // swaps the engine INSTANCE persists inside the audio callback, so we can
        // no longer flip its flag from the control thread on the next push (the
        // old rebuild-per-push path did that). The UI meters continuously anyway;
        // while unsubscribed the only cost is a bounded ring push per block whose
        // frames simply drop undrained. (`enable_metering` keeps its flag for API
        // compatibility but no longer gates the live engine.)
        engine.set_metering(true);

        // Split a fresh command ring; the consumer moves into the audio host.
        let (producer, consumer) = CommandQueue::split(COMMAND_RING_CAP);

        // Try to start audio. No device => keep the backend alive without a host
        // (the expected sandbox path); any other host error is also non-fatal
        // here — the next `push_graph` re-attempts the start. The host adopts
        // UI graph edits in-callback via the swap mailbox (no stream restart).
        let host = match AudioHost::start_with_swap(stream, engine, consumer, swap.rx()) {
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
            meter_ring,
            event_ring,
            event_seq: 0,
            pending_events: Vec::new(),
            metering: false,
            catalog: AssetCatalog::new(),
            store: AssetStore::new(),
            captures: std::collections::HashMap::new(),
            last_graph: None,
            device_lost: false,
            log_store: None,
            // Up to 8 reopen attempts per loss event before a calm give-up.
            supervisor: DeviceSupervisor::new(8),
            last_reopen_us: 0,
            device_watcher: DeviceWatcher::new(probe_default_output()),
            last_probe_us: 0,
            _device_listener: install_device_listener(listener_tx),
            listener_faults: listener_rx,
            selected_output_device: None,
            mic_node: None,
        }
    }

    /// Attach the L3 durable LOCAL log store (SQLite/FTS5) opened at `path`. Called
    /// once from the Tauri `setup` hook with a file under the platform log dir, so
    /// the off-RT event drain ([`drain_events`]) gets a queryable durable tail
    /// alongside the NDJSON post-crash record. LOCAL-ONLY. A failure to open is
    /// non-fatal: the backend keeps running with `log_store: None` (the NDJSON
    /// SSOT is unaffected), and the error is returned so the caller can log it.
    pub fn attach_log_store(&mut self, path: &std::path::Path) -> Result<(), String> {
        let store = LogStore::open(path).map_err(|e| e.to_string())?;
        self.log_store = Some(store);
        Ok(())
    }

    /// Register the FULL native built-in set through the ONE shared path
    /// [`ojinstrument::register_all`] — the SAME function the `wasm32` worklet
    /// calls (`ojcore-wasm::init`), so the two registries never drift. Native
    /// uses [`RegisterOpts::full`], which includes SF2 (`builtin.sf2`); the
    /// worklet uses `RegisterOpts::wasm()`, which omits it. "Everything is a
    /// plugin": every loader implements the same `PluginLoader` surface and the
    /// compiler lowers them uniformly.
    fn build_registry() -> PluginRegistry {
        let mut registry = PluginRegistry::new();
        register_all(&mut registry, RegisterOpts::full());
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
    ///
    /// ASSET RESOLUTION. Compilation goes through [`compile_resilient`] with the
    /// backend's [`AssetCatalog`] as the resolver, so any node carrying an
    /// [`AssetRef`] (a Sampler's sample, a Convolution's IR) has its decoded PCM
    /// installed (Sampler `set_sample` / Convolution `set_ir`) BEFORE the program
    /// goes live — the founder-verified seam that makes a serialized graph with a
    /// bound sample actually play.
    pub fn push_graph(&mut self, graph: &OjGraph) -> Result<(), BackendError> {
        // The graph's own sample_rate / block_size are UI hints; `adopt` is the one
        // owner that compiles at the live device rate + host render chunk (see
        // `adopt`), so a 96k interface plays in tune and a recovery onto a
        // different-rate device never detunes. Here we only carry the binding forward.
        let mut g = graph.clone();
        // SAMPLE-BINDING SINGLE OWNER. A fresh UI push carries no imperatively
        // bound sample (a `load_sample` mutates only the engine's kept graph, never
        // the UI's), so a naive clobber would silently drop a user-loaded sample on
        // the very next edit — a native↔wasm divergence the wasm path doesn't have.
        // Forward-merge the prior per-node sample binding (its `AssetRef` + the
        // sampler root-note param) from `last_graph` onto the incoming graph so a
        // bound sample survives subsequent edits. The ENGINE is the one owner of
        // this mapping; no second owner in TS.
        if let Some(prev) = self.last_graph.as_ref() {
            Self::forward_merge_sample_bindings(prev, &mut g);
        }
        // Re-validate mic capture against the incoming graph: if the user enabled
        // the mic but this edit removed (or moved) the `MicIn` node, re-bind to its
        // current id, or drop the wiring entirely when it is gone — so we never
        // open a duplex stream for a node that cannot hear it. No-op when mic
        // capture is off. Done HERE (the real UI graph), not on the starter-graph
        // cold-start fallback, so a device-less enable does not lose the target.
        self.reconcile_mic_node(&g);
        self.adopt(&g)?;
        // Remember the (rate-adjusted, binding-merged) live graph so a later sample
        // bind can re-resolve + recompile it against the catalog without a fresh
        // UI push, and so the NEXT push forward-merges from it in turn.
        self.last_graph = Some(g);
        Ok(())
    }

    /// Carry forward the per-node sample binding (the slot-0 [`AssetRef`] and the
    /// sampler root-note param) from the previously adopted `prev` graph onto the
    /// freshly pushed `next` graph, for every node id present in both that still
    /// exists in `next`. This is the single-owner persistence seam: a UI push
    /// never carries an imperatively bound sample (that lives only in the engine's
    /// kept graph), so without this merge the next edit would clobber it.
    ///
    /// Only nodes whose `next` slot-0 binding is empty are merged — a UI push that
    /// deliberately carries its own slot-0 asset (e.g. a serialized project with a
    /// baked sample) is authoritative and is left untouched. Off-RT, pure data.
    fn forward_merge_sample_bindings(prev: &OjGraph, next: &mut OjGraph) {
        use ojinstrument::SAMPLER_PCM_PARAM;
        use ojproto::{Param, PrimitiveKind};
        for node in next.nodes.iter_mut() {
            // Only carry a sample binding between Samplers. The merge keys on node
            // id, so if the UI replaced a Sampler with a different node type at the
            // SAME id, copying the old slot-0 asset/root-note would bind a stale
            // sample to the wrong node and corrupt the adopted graph.
            if !matches!(node.kind, PrimitiveKind::Sampler) {
                continue;
            }
            // The prior binding for this exact node id, if any.
            let Some(prev_node) = prev.nodes.iter().find(|n| n.id == node.id) else {
                continue;
            };
            if !matches!(prev_node.kind, PrimitiveKind::Sampler) {
                continue;
            }
            let Some(prev_asset) = prev_node.assets.iter().find(|a| a.slot == 0) else {
                continue;
            };
            // Respect an explicit slot-0 binding already on the incoming node.
            if node.assets.iter().any(|a| a.slot == 0) {
                continue;
            }
            node.assets.push(AssetRef {
                slot: 0,
                asset: prev_asset.asset,
            });
            // Carry the root-note param too, so the merged sample keeps its pitch
            // mapping. Only fill it when the incoming node hasn't set its own.
            if let Some(prev_root) = prev_node
                .params
                .iter()
                .find(|p| p.id == SAMPLER_PCM_PARAM)
                .map(|p| p.value)
            {
                if !node.params.iter().any(|p| p.id == SAMPLER_PCM_PARAM) {
                    node.params.push(Param {
                        id: SAMPLER_PCM_PARAM,
                        value: prev_root,
                    });
                }
            }
        }
    }

    /// Compile `graph` (resolving its assets through the catalog) and adopt the
    /// fresh program into the running engine. Shared by [`push_graph`] and the
    /// sample-bind path; does NOT itself store `last_graph` (the caller decides).
    ///
    /// PUBLISH-ONLY: when a host is already running we compile the program and
    /// PUBLISH it into the swap mailbox; the audio callback installs it in-place
    /// at the next block boundary via [`ProgramSwapRx::install_into`] — NO cpal
    /// stream teardown/restart, so editing the graph never glitches the audio
    /// (a held note survives the swap). We then `collect()` the displaced
    /// program off the audio thread. The host + command ring persist across
    /// pushes; the stream keeps its negotiated rate/buffer.
    ///
    /// When no host is running yet (device absent at boot, or a prior start
    /// failed), we start one now around this program — subsequent edits hot-swap.
    fn adopt(&mut self, graph: &OjGraph) -> Result<(), BackendError> {
        // SINGLE OWNER of "render at the live device rate + host block size". Both
        // the UI push AND the post-device-loss rebuild route through here, so
        // neither can forget it: a recovery onto a different-rate default device
        // recompiles at the NEW rate instead of playing back detuned. `self.stream`
        // carries the running stream's negotiated rate (cold start / rebuild seed it
        // from the current default device), authoritative over the graph's UI hint.
        let mut g = graph.clone();
        g.sample_rate = self.stream.sample_rate;
        g.block_size = self.stream.buffer_frames;
        // Load-time graceful degrade (invariant #4a): a missing plugin dependency in a
        // pushed/loaded graph becomes a passthrough stub so the project ALWAYS opens,
        // rather than rejecting the whole push; genuine errors (cycle, no master) still
        // surface. The starter graph above stays strict (a known-good internal graph).
        let program = compile_resilient(&g, &self.registry, &self.catalog)
            .map_err(BackendError::Compile)?;

        if self.host.is_some() {
            // Live: hand the program to the audio thread (lock-free) and reclaim
            // the program it displaces (off-RT deferred drop).
            self.swap.publish(program);
            self.swap.collect();
            return Ok(());
        }

        // Cold start: build the persistent engine around this program and open
        // the stream with the swap mailbox wired into the callback. Routing (the
        // chosen device + mic) is honoured inside `open_host`, so a cold start /
        // recovery resumes on the same device and mic the user picked.
        let mut engine = Engine::new(program);
        engine.attach_meter_ring(Some(Arc::clone(&self.meter_ring)));
        engine.attach_event_ring(Some(Arc::clone(&self.event_ring)));
        engine.set_metering(true); // always-on; see `new()`.
        let (producer, consumer) = CommandQueue::split(COMMAND_RING_CAP);

        // ANY start failure is NON-FATAL (matching [`EngineBackend::new`]): the
        // producer is live so commands still validate, and the next `push_graph`
        // re-attempts the start. Covers a device-less sandbox AND a present-but-
        // incompatible default output.
        match self.open_host(engine, consumer) {
            Ok(h) => {
                self.host = Some(h);
                self.producer = producer;
            }
            Err(e) => {
                // Device-less or incompatible default output: the start failed.
                // STOP swallowing this as a bare eprintln — emit a `Lifecycle`
                // event into the pipe so the fault surfaces in the DevLog and the
                // tri-state health goes DEGRADED (the auto-rebuild recovery is a
                // later wave; here we just make it visible, not silent). The prior
                // program / last good sound is untouched (there was none to keep on
                // a cold start, but we still never tear anything down here).
                eprintln!("ojcore: audio host failed to start (non-fatal): {e}");
                // Announce the cold-start failure ONCE, but stay silent while a
                // device loss is latched: `rebuild_after_loss` calls `adopt` on
                // EVERY tick, and the loss was already announced at detection in
                // `tick`, so emitting here per retry would storm the fault pipe and
                // break the one-loss-event de-bounce.
                if !self.device_lost {
                    self.emit_lifecycle(Severity::Warn, format!("audio host failed to start: {e}"));
                }
                self.producer = producer;
            }
        }
        Ok(())
    }

    /// Control-thread tick: the off-RT recovery pump. Called each `drain_events`
    /// poll (alongside `drain_meters`), it checks the running host's device-fault
    /// signal — SET by the cpal `err_fn` off the render thread on a yanked /
    /// disabled / reconfigured device — and, on a fault, attempts to REBUILD the
    /// stream on the CURRENT default output device, re-adopting `last_graph` so the
    /// patch resumes. Runs ENTIRELY off the audio path (no audio thread work, no
    /// allocation/lock in the render callback — only here).
    ///
    /// LIVE-PERFORMANCE RULE: device-loss means the instrument is ALREADY silent,
    /// so automated visible recovery is allowed (unlike a mid-note graph swap). We
    /// preserve graph state and report via the existing event pipe WITHOUT a modal.
    ///
    /// DE-BOUNCE: `device_lost` latches on the first detected fault so one
    /// device-loss emits exactly ONE `DeviceLost` event; subsequent ticks while
    /// still lost only RETRY the rebuild (no event storm). On the rebuild that
    /// succeeds we emit ONE `DeviceRecovered`. No device yet → stay lost, retry on
    /// the next tick (no spin, no block, no panic).
    #[cfg(test)]
    pub fn tick(&mut self) {
        // Read-and-clear the running host's fault edge. No host (device-less /
        // never started) → nothing to recover here; a cold start is still driven
        // by `push_graph`/`adopt`.
        let faulted = self
            .host
            .as_ref()
            .map(|h| h.fault_signal().take())
            .unwrap_or(false);

        if faulted && !self.device_lost {
            // FIRST detection of this loss: latch, drop the dead stream (off-RT),
            // and announce ONCE. Dropping the host stops cpal's dead stream cleanly
            // and flips `is_running()` to false so the rebuild takes the cold-start
            // path that opens a fresh stream on the current default device.
            self.device_lost = true;
            self.host = None;
            self.emit_lifecycle(
                Severity::Warn,
                "audio device lost; attempting auto-rebuild".into(),
            );
        }

        // While lost, try to rebuild on EVERY tick until a device is back. The
        // retry is cheap (one default-device probe); if there is no device yet the
        // attempt fails fast and we stay lost for the next tick.
        if self.device_lost && self.rebuild_after_loss() {
            self.device_lost = false;
            self.emit_lifecycle(
                Severity::Info,
                "audio device recovered; patch resumed".into(),
            );
        }
    }

    /// Re-open the cpal stream on the current default output device and re-adopt
    /// the last compiled program so the patch resumes after a device loss. Returns
    /// `true` on success, `false` if no usable device is available yet (caller
    /// retries on the next tick). Off-RT only.
    ///
    /// Re-syncs the stream request to the (possibly new) device's default sample
    /// rate first — a yanked interface may be replaced by one at a different rate,
    /// and rendering at the wrong rate would play back detuned. Then it routes
    /// through the SAME `adopt` cold-start path `push_graph` uses (host is `None`
    /// after the loss), so there is one stream-open seam, not a parallel one.
    #[cfg(test)]
    fn rebuild_after_loss(&mut self) -> bool {
        debug_assert!(
            self.host.is_none(),
            "rebuild expects the dead host already dropped"
        );
        // Follow the current default device's rate (it may be a different device).
        if let Some(rate) = ojcore_native::default_output_sample_rate() {
            self.stream.sample_rate = rate;
        }
        // Re-adopt the last compiled program if there is one, else the silent
        // starter graph, so the cold-start path inside `adopt` opens a stream.
        let graph = self
            .last_graph
            .clone()
            .unwrap_or_else(|| Self::starter_graph(self.stream));
        // `adopt` is idempotent w.r.t. `last_graph` (it does not store it); it
        // opens a fresh stream when `host.is_none()`. A compile error here would be
        // a build-time bug (the graph last compiled fine), so swallow+report rather
        // than panic — the next tick retries.
        if let Err(e) = self.adopt(&graph) {
            tracing::warn!(target: "engine", "device rebuild: re-adopt failed: {e}");
            return false;
        }
        // `adopt` only opens a stream on the cold-start path; if the device is
        // still absent it leaves `host` None (and emits its own Lifecycle). So a
        // running host is the unambiguous "recovered" signal.
        self.host.is_some()
    }

    /// Queue a control-side `Lifecycle` `Event` (device-loss, recovery, or
    /// host-restart failure) onto [`pending_events`], to be drained by
    /// [`drain_events`]. The RT event ring is `Copy`-only and has no `Lifecycle`
    /// variant, so these synthesized envelopes ride this off-RT queue instead.
    /// Pure control-thread work — never called from the audio callback.
    ///
    /// `severity` distinguishes loss/failure (`Warn` → DEGRADED) from recovery
    /// (`Info`). The wire `kind` stays the existing [`EventKind::Lifecycle`] so
    /// ojproto is unchanged and the Wave-1 frontend fault pipe still reads it; the
    /// human `text` is the observable log line (NDJSON + tracing) the orchestrator
    /// watches during the live Disable-PnpDevice test.
    fn emit_lifecycle(&mut self, severity: Severity, text: String) {
        self.event_seq = self.event_seq.wrapping_add(1);
        self.pending_events.push(Event {
            v: ojproto::SCHEMA_VERSION,
            seq: self.event_seq,
            severity,
            kind: EventKind::Lifecycle,
            source: Source::Native,
            ts_us: now_us(),
            corr_id: 0,
        });
        // `text` is folded into the structured NDJSON record for the post-crash
        // trail; the UI surfaces the `Lifecycle` kind itself (a calm DEGRADED).
        match severity {
            Severity::Info | Severity::Debug | Severity::Trace => {
                tracing::info!(target: "engine", "{text}")
            }
            _ => tracing::warn!(target: "engine", "{text}"),
        }
    }

    /// Enqueue one [`RtCommand`] onto the UI->RT ring (the high-rate control
    /// path: note on/off, param patches, transport). Wait-free push; a full
    /// ring drops the command rather than blocking the control thread.
    pub fn send_command(&mut self, cmd: RtCommand) -> Result<(), BackendError> {
        self.producer.push(cmd).map_err(|_| BackendError::RingFull)
    }

    // --- U-EXEC-PARITY capability seam (control-rate) ----------------------

    /// Drive a looper node's state machine: enqueue an [`RtCommand::Looper`] with
    /// the given action code (one of the [`ojproto::looper_action`] consts) and
    /// `arg` (layer index / packed flags for the indexed actions, ignored by the
    /// transport actions). The audio thread applies it via
    /// `DspInstance::looper_action`.
    pub fn looper_cmd(&mut self, node: NodeIdx, action: u8, arg: u32) -> Result<(), BackendError> {
        self.send_command(RtCommand::Looper { node, action, arg })
    }

    /// Enable / disable the engine's level metering. While off, the render loop
    /// skips all `accumulate` calls (zero-cost). Enabling tells the audio thread
    /// (via the next `push_graph` swap) to fold per-node + master levels into the
    /// meter ring; the metering toggle is mirrored so a graph swap re-applies it.
    ///
    /// NOTE: the engine is already moved into the audio host, so we cannot flip
    /// the live engine's flag directly here — instead we record the desired state
    /// and re-apply it on the next `push_graph` (the UI pushes a graph on every
    /// node/connection change, so metering activates promptly). The ring is always
    /// attached, so once a graph with `metering=true` is running, frames flow.
    pub fn enable_metering(&mut self, on: bool) {
        self.metering = on;
    }

    /// Drain the engine's meter return ring into a batch of [`EngineFrame`]s for
    /// the UI's `meters` event. Control-rate: called on a UI-driven poll, never
    /// the audio thread. Decodes the compact wire frames the audio thread pushed.
    ///
    /// SINGLE CONSUMER, ALL TAGS: the meter ring is one SPSC queue, so this is the
    /// only place the wire frames are decoded. It surfaces both `Meter` frames
    /// (the signal-level stream consumes their peaks) AND `Looper` frames (the
    /// looper UI consumes their transport snapshot) — folding both into one drain
    /// keeps a single ring consumer (a second drainer would race-steal frames).
    /// `Beat` still rides the transport path and is filtered out here.
    pub fn drain_meters(&mut self) -> Vec<EngineFrame> {
        let mut out = Vec::new();
        let mut buf = [0u8; return_frame::MAX_LEN];
        while let Some(n) = self.meter_ring.pop(&mut buf) {
            if let Some(frame) = return_frame::decode(&buf[..n]) {
                // Surface Meter + Looper frames here (Beat goes via the transport
                // path). One drain decodes every tag because there is exactly one
                // consumer of the meter ring.
                if matches!(frame, EngineFrame::Meter { .. } | EngineFrame::Looper { .. }) {
                    out.push(frame);
                }
            }
        }
        out
    }

    /// Rebuild the audio stream around the last good graph — the production
    /// `reopen` the recovery loop drives. Drops the dead host and re-runs the
    /// cold-start path (`adopt`), which opens a fresh stream + engine on whatever
    /// device is now default. Returns whether audio is running again. No graph yet
    /// (nothing was ever pushed) ⇒ nothing to rebuild.
    fn reopen_device(&mut self) -> bool {
        let Some(graph) = self.last_graph.clone() else {
            return false;
        };
        self.host = None; // tear down the dead stream before re-opening
        // Follow the (possibly new) default device's sample rate BEFORE adopting:
        // a format change (e.g. the interface switching 96 kHz → 48 kHz) or a
        // replacement device at a different rate must rebuild at that rate, or the
        // patch would resume detuned. `adopt` compiles the graph at
        // `self.stream.sample_rate`. (The cpal stream is gone here, so this just
        // queries the OS default — off-RT.)
        if let Some(rate) = ojcore_native::default_output_sample_rate() {
            self.stream.sample_rate = rate;
        }
        let _ = self.adopt(&graph); // start failure is non-fatal (emits Lifecycle)
        self.host.is_some()
    }

    /// One control-poll tick of device-loss recovery (Track A P1). Drains the
    /// host's device-fault mailbox, drives the [`DeviceSupervisor`] policy, and —
    /// while recovering — makes one PACED reopen attempt (~1s backoff). A removal
    /// holds the last good sound and rebuilds the stream exactly once; an xrun
    /// storm rebuilds zero times. Off-RT: only the control thread runs this.
    pub fn poll_device_recovery(&mut self) {
        // Drain faults first (releases the &mut host borrow before we rebuild).
        let mut faults: Vec<DeviceFault> = Vec::new();
        if let Some(h) = self.host.as_mut() {
            h.drain_device_faults(|f| faults.push(f));
        }
        // Event-driven OS listener faults (macOS CoreAudio; empty elsewhere).
        self.listener_faults.drain(|f| faults.push(f));
        // Portable default-device watch (throttled ~1 Hz): catches a silent swap /
        // removal cpal's callback may never report. The probe enumerates devices,
        // so we do NOT run it on every fast UI poll.
        let now = now_us();
        if now.wrapping_sub(self.last_probe_us) >= 1_000_000 {
            self.last_probe_us = now;
            if let Some(f) = self.device_watcher.poll(probe_default_output()) {
                faults.push(f);
            }
        }
        for fault in faults {
            if self.supervisor.on_fault(fault) == RecoveryAction::HoldLastGood {
                self.emit_lifecycle(
                    Severity::Warn,
                    "audio device lost — holding last good sound, reconnecting".into(),
                );
            }
        }
        // While recovering, attempt a paced reopen.
        if self.supervisor.poll_recovery() == RecoveryAction::AttemptReopen {
            let now = now_us();
            if now.wrapping_sub(self.last_reopen_us) >= 1_000_000 {
                self.last_reopen_us = now;
                let ok = self.reopen_device();
                match self.supervisor.on_reopen_result(ok) {
                    RecoveryAction::Resume => self
                        .emit_lifecycle(Severity::Info, "audio device recovered — resuming".into()),
                    RecoveryAction::GiveUp => self.emit_lifecycle(
                        Severity::Warn,
                        "could not reopen an audio device — open Settings → Audio to choose one"
                            .into(),
                    ),
                    _ => {}
                }
            }
        }
    }

    /// Drain compact RT fault events and lift them into protocol `Event`s for
    /// DevLog/diagnostics. Control-rate: called by the UI poll command, never on
    /// the audio thread.
    pub fn drain_events(&mut self) -> Vec<Event> {
        // Drive device-loss recovery on the same control-poll tick the UI already
        // makes, so a mid-set unplug is held + reconnected without a separate loop.
        self.poll_device_recovery();
        // Control-side synthesized events (device-loss `Lifecycle`, …) first, so a
        // host-restart failure reaches the pipe alongside RT faults in one drain.
        let mut out = std::mem::take(&mut self.pending_events);
        event_frame::drain_events(&self.event_ring, |rt| {
            self.event_seq = self.event_seq.wrapping_add(1);
            out.push(lift_event(rt, self.event_seq, now_us()));
        });
        // L3 durable LOCAL tail: append every drained event to the SQLite/FTS5 store
        // (the queryable history). This is the SINGLE off-RT ingest site — the same
        // control thread that drains the RT ring also writes the store, so there is
        // no second owner and the audio callback never touches I/O. Best-effort:
        // a write failure is swallowed so durability never takes the instrument
        // down (the NDJSON file remains the post-crash SSOT regardless).
        if let Some(store) = self.log_store.as_ref() {
            for ev in &out {
                Self::persist_event(store, ev);
            }
        }
        out
    }

    /// Append one drained [`Event`] to the L3 [`LogStore`] as a [`LogRecord`].
    /// Renders the closed event taxonomy into the store's already-shaped fields
    /// (severity/source/kind variant names + a human message + structured JSON).
    /// Off-RT only (control thread). Errors are intentionally swallowed.
    fn persist_event(store: &LogStore, ev: &Event) {
        let severity = severity_name(ev.severity);
        let source = source_name(ev.source);
        let (kind, message, fields) = render_event_kind(&ev.kind);
        let rec = LogRecord {
            ts_us: ev.ts_us.min(i64::MAX as u64) as i64,
            seq: i64::from(ev.seq),
            severity,
            source,
            kind,
            message: &message,
            corr_id: ev.corr_id.min(i64::MAX as u64) as i64,
            fields_json: fields.as_deref(),
        };
        let _ = store.insert(&rec);
    }

    /// Load decoded mono PCM as the sample for `node`'s `builtin.sampler` and
    /// make it PLAY: content-address the PCM into the [`AssetCatalog`] (the same
    /// off-RT asset pipeline a file load uses), bind the returned [`AssetId`] +
    /// the `root_note` onto `node` in the live graph, then recompile so the
    /// Sampler's `set_sample` (the U6 seam) fires through
    /// [`compile_resilient`]. Returns the stored [`AssetId`].
    ///
    /// If no graph has been pushed yet (no `last_graph`), the asset is still
    /// stored and returned — a subsequent `push_graph` that references it will
    /// resolve it — but no live recompile happens (there is nothing to bind to).
    pub fn load_sample(
        &mut self,
        node: NodeIdx,
        pcm: Vec<f32>,
        sample_rate: u32,
        root_note: u8,
    ) -> Result<AssetId, BackendError> {
        let pcm = Pcm {
            samples: pcm,
            channels: 1,
            sample_rate: sample_rate.max(1),
        };
        let id = self.catalog.insert(pcm).map_err(BackendError::Asset)?;

        // Bind the asset (and root note) to the node in the kept graph and adopt
        // the recompiled program, so the LIVE sampler instance receives the PCM.
        if let Some(mut graph) = self.last_graph.clone() {
            if Self::bind_sample_to_node(&mut graph, node, id, root_note) {
                self.adopt(&graph)?;
                self.last_graph = Some(graph);
            }
        }
        Ok(id)
    }

    /// Register an AI-authored NATIVE faust code node (already compiled to a
    /// `.dll`) under its `manifest_id`, then recompile the live graph so a node
    /// referencing that id instantiates the native kernel. Off-RT (called from the
    /// `author_faust_native` command). The `OutputGuard` chain wraps the kernel.
    pub fn register_native_faust(
        &mut self,
        manifest_json: &str,
        dll_path: PathBuf,
    ) -> Result<(), String> {
        let manifest: PluginManifest =
            serde_json::from_str(manifest_json).map_err(|e| format!("bad manifest json: {e}"))?;
        self.registry
            .register(Box::new(WasmHostLoader::new_native(manifest, dll_path)));
        // Recompile the live graph so the loader resolves + instantiates: the node
        // may already be present (re-author), else the next `push_graph` uses it.
        if let Some(graph) = self.last_graph.clone() {
            self.adopt(&graph).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Bind `asset` (and its `root_note`) onto `node` in `graph`: set the node's
    /// `root_note` param and add/replace an [`AssetRef`] in slot 0. Returns
    /// whether the node was found (and the graph thus mutated). Off-RT, pure data.
    fn bind_sample_to_node(
        graph: &mut OjGraph,
        node: NodeIdx,
        asset: AssetId,
        root_note: u8,
    ) -> bool {
        let Some(ir) = graph.nodes.iter_mut().find(|n| n.id == node) else {
            return false;
        };
        // Root note -> the sampler's root-note param (so the recorded pitch lands
        // at unity at `root_note`); the compiler applies params before assets.
        use ojinstrument::SAMPLER_PCM_PARAM;
        use ojproto::Param;
        if let Some(p) = ir.params.iter_mut().find(|p| p.id == SAMPLER_PCM_PARAM) {
            p.value = root_note as f32;
        } else {
            ir.params.push(Param {
                id: SAMPLER_PCM_PARAM,
                value: root_note as f32,
            });
        }
        // Bind the PCM asset in slot 0 (the sampler ignores the slot index — it
        // has a single buffer); replace any prior binding on that slot.
        if let Some(a) = ir.assets.iter_mut().find(|a| a.slot == 0) {
            a.asset = asset;
        } else {
            ir.assets.push(AssetRef { slot: 0, asset });
        }
        true
    }

    /// Arm a recorder capture of the master mix, tagged to `node`. The host's
    /// output tap records the rendered MONO master into its recorder while armed
    /// (see [`ojcore_native::AudioHost::arm_capture`]); `recorder_stop` takes the
    /// captured PCM and `recorder_export` writes it to WAV. In a device-less
    /// sandbox (no host) the start/stop lifecycle still validates — there is
    /// simply no live stream to tap.
    pub fn recorder_start(&mut self, node: NodeIdx) {
        if let Some(host) = self.host.as_ref() {
            host.arm_capture();
        }
        self.captures.insert(
            node.0,
            CaptureState {
                pcm: Vec::new(),
                sample_rate: self.stream.sample_rate,
                channels: 1,
                recording: true,
            },
        );
    }

    /// Stop a recorder capture and return its captured (mono) PCM + rate. Takes
    /// the recorded master from the host tap when a stream is live, and RETAINS it
    /// on the [`CaptureState`] so `recorder_export` can still write it afterward.
    /// Returns `None` if no capture was armed for `node`.
    pub fn recorder_stop(&mut self, node: NodeIdx) -> Option<(Vec<f32>, u32)> {
        // Take the captured PCM from the host first (immutable borrow), then
        // record it on the capture state (mutable borrow) — kept separate so the
        // borrows don't overlap.
        let captured = self.host.as_ref().map(|host| host.stop_capture());
        let cap = self.captures.get_mut(&node.0)?;
        cap.recording = false;
        if let Some(pcm) = captured {
            cap.pcm = pcm.samples;
            cap.sample_rate = pcm.sample_rate;
        }
        Some((cap.pcm.clone(), cap.sample_rate))
    }

    /// STAGE-3 finalize-PCM: take looper `node`'s just-COMMITTED take as MONO PCM
    /// + its sample rate, so the UI can build a real `AudioBuffer` for the layer's
    /// row (true waveform + drag-to-library/export). Called by the control thread
    /// when it drains a commit `LooperEdge` for `node` (the
    /// Recording|Overdubbing→Playing edge): the host's off-RT per-looper capture
    /// has the streamed take by then, and `loop_len` (from the looper snapshot the
    /// UI already tracks) trims it to the committed cycle. Returns `None` when no
    /// stream is live (device-less sandbox) or nothing was captured for the node.
    ///
    /// The PCM rides the Tauri command RETURN value (exactly like
    /// [`recorder_stop`]), NOT an `EngineFrame` — keeping the wire/ojproto
    /// unchanged: only `OjGraph` / `RtCommand` / the existing return frames cross
    /// the boundary, and bulk PCM rides command returns.
    pub fn take_looper_pcm(&self, node: NodeIdx, loop_len: usize) -> Option<(Vec<f32>, u32)> {
        let host = self.host.as_ref()?;
        let pcm = host.take_looper_pcm(node, loop_len)?;
        Some((pcm, host.sample_rate()))
    }

    /// Discard looper `node`'s accumulated (uncommitted) capture — on CLEAR /
    /// undo / delete with no commit — so a later take never inherits a stale tail.
    /// No-op in the device-less sandbox. Off-RT.
    pub fn discard_looper_pcm(&self, node: NodeIdx) {
        if let Some(host) = self.host.as_ref() {
            host.discard_looper_pcm(node);
        }
    }

    /// Export a node's captured recording to a WAV file at `path` via the
    /// [`AssetStore`] (lossless 32-bit float). Errors if nothing was captured.
    pub fn recorder_export(&mut self, node: NodeIdx, path: &str) -> Result<(), BackendError> {
        let cap = self
            .captures
            .get(&node.0)
            .ok_or(BackendError::UnknownNode(node.0))?;
        let pcm = Pcm {
            samples: cap.pcm.clone(),
            channels: cap.channels,
            sample_rate: cap.sample_rate,
        };
        self.store
            .write_wav_file(path, &pcm)
            .map_err(BackendError::Asset)
    }

    /// Set a speaker node's master volume / mute. The SpeakerOut sink now carries
    /// real `volume` / `mute` params ([`master_param`]); this routes both as
    /// wait-free [`RtCommand::SetParam`]s to the live engine, which scales its
    /// master mix by the result (see `ojcore::exec` / [`master_param`]). A real
    /// round-trip, not a no-op: `setSpeakerVolume` audibly changes the output.
    pub fn set_speaker_volume(
        &mut self,
        node: NodeIdx,
        volume: f32,
        muted: bool,
    ) -> Result<(), BackendError> {
        self.send_command(RtCommand::SetParam {
            node,
            param: master_param::VOLUME,
            value: volume.max(0.0),
        })?;
        self.send_command(RtCommand::SetParam {
            node,
            param: master_param::MUTE,
            value: if muted { 1.0 } else { 0.0 },
        })
    }

    /// Open the audio host for `engine` on the CURRENT routing state — the chosen
    /// output device ([`selected_output_device`], default when `None`) and, when
    /// mic capture is on ([`mic_node`]), the duplex input feeding that `MicIn`
    /// node. The ONE stream-open seam: every cold start / device-loss rebuild /
    /// device-pick / mic-toggle routes through here, so routing can never be
    /// forgotten on one path and present on another (code-value #2: extend the
    /// pillar, never fork it).
    fn open_host(
        &mut self,
        engine: Engine,
        consumer: CommandConsumer,
    ) -> Result<AudioHost, HostError> {
        let mut req = self.stream;
        // The duplex input is opened iff mic capture is wired to a live node.
        req.duplex_input = self.mic_node.is_some();
        AudioHost::start_with_swap_on_device(
            req,
            engine,
            consumer,
            self.swap.rx(),
            self.selected_output_device.clone(),
            self.mic_node,
        )
    }

    /// The `MicIn` source node in `graph`, if any. The duplex input feeds this
    /// node's buffer; a graph carries at most one mic source in practice, so the
    /// first match is authoritative. Pure, off-RT.
    fn mic_node_of(graph: &OjGraph) -> Option<NodeIdx> {
        use ojproto::PrimitiveKind;
        graph
            .nodes
            .iter()
            .find(|n| matches!(n.kind, PrimitiveKind::MicIn))
            .map(|n| n.id)
    }

    /// Re-validate the enabled mic target against the graph being adopted: if mic
    /// capture is on but its `MicIn` node is gone (the user deleted it), drop the
    /// wiring so `open_host` does not open a duplex stream for a node that cannot
    /// hear it. Re-binds to the node's current id when it is still present. No-op
    /// when mic capture is off. Off-RT, pure bookkeeping.
    fn reconcile_mic_node(&mut self, graph: &OjGraph) {
        if self.mic_node.is_some() {
            self.mic_node = Self::mic_node_of(graph);
        }
    }

    /// Tear down the live stream and re-open it on the CURRENT routing state
    /// (chosen device + mic) around `last_graph` (or the silent starter graph when
    /// nothing has been pushed yet). This is the SAME controlled rebuild
    /// device-loss recovery uses — a brief held-note gap — so a device pick or a
    /// mic toggle reuses one seam rather than inventing a teardown path. Off-RT.
    /// A start failure is non-fatal (`adopt` emits a `Lifecycle` and leaves the
    /// backend usable); the error is not surfaced to the caller because the
    /// routing state IS recorded and the next push/recovery retries.
    fn rebuild_stream(&mut self) {
        // Follow the chosen/default device's rate first, so a pick onto a
        // different-rate interface recompiles at the new rate (no detune) — the
        // same rule the device-loss rebuild applies.
        if let Some(rate) = ojcore_native::default_output_sample_rate() {
            self.stream.sample_rate = rate;
        }
        self.host = None; // drop the dead/old stream before re-opening
        let graph = self
            .last_graph
            .clone()
            .unwrap_or_else(|| Self::starter_graph(self.stream));
        // `adopt` opens a fresh stream via the cold-start path (host is None) and
        // honours the recorded routing through `open_host`.
        if let Err(e) = self.adopt(&graph) {
            tracing::warn!(target: "engine", "stream rebuild: re-adopt failed: {e}");
        }
    }

    /// Route the engine's output to the device with cpal id `device_id` (the
    /// device picker's selection). Records the choice and re-opens the stream onto
    /// it through the shared rebuild seam — a brief, controlled held-note gap,
    /// identical to device-loss recovery (a held note beats a glitch). An empty
    /// id resets to the system default. The `node` is accepted for API symmetry
    /// with `set_speaker_volume`; native output is a single master stream, so the
    /// device applies to the whole engine, not a per-node sink. A REAL round trip:
    /// after this call the audio plays out of the chosen device.
    pub fn set_speaker_device(
        &mut self,
        _node: NodeIdx,
        device_id: &str,
    ) -> Result<(), BackendError> {
        let chosen = (!device_id.is_empty()).then(|| device_id.to_string());
        // No-op if the device is already selected: do not glitch a held note for a
        // redundant pick.
        if self.selected_output_device == chosen {
            return Ok(());
        }
        self.selected_output_device = chosen;
        self.rebuild_stream();
        Ok(())
    }

    /// Enable / disable microphone capture into `node` (a `MicIn` source). On
    /// enable, records the target and re-opens the stream WITH the duplex input,
    /// which down-mixes the mic to mono and feeds `node`'s buffer each block (see
    /// `ojcore_native::host`); on disable, re-opens WITHOUT the duplex input. Both
    /// reuse the shared rebuild seam (a brief held-note gap). A REAL round trip:
    /// once enabled, the `MicIn` node actually hears the microphone.
    pub fn set_mic(&mut self, node: NodeIdx, enabled: bool) -> Result<(), BackendError> {
        let next = enabled.then_some(node);
        // No-op if the mic wiring is unchanged (avoid a needless stream rebuild).
        if self.mic_node == next {
            return Ok(());
        }
        self.mic_node = next;
        self.rebuild_stream();
        Ok(())
    }

    /// Scan `dirs` for hostable third-party plugins (VST3 / CLAP, + AU on
    /// macOS) and register each as a `host.plugin` node in the registry, so the
    /// UI can drop a hosted plugin into the graph like any other node.
    ///
    /// Returns the descriptors found (for the UI's plugin list). In the default
    /// (scaffold) build with no hosting backend compiled in, this is always an
    /// empty list and never errors — the safe degraded path. Registration uses
    /// the SAME `PluginRegistry` recompiles lower against, so a subsequent
    /// `push_graph` referencing a hosted plugin compiles.
    pub fn scan_plugins(
        &mut self,
        dirs: &[PathBuf],
    ) -> Result<Vec<PluginDescriptor>, BackendError> {
        // Empty request -> scan the OS-standard plugin directories (the "scan my
        // installed plugins" default the Plugins panel uses).
        let default_dirs;
        let dirs = if dirs.is_empty() {
            default_dirs = ojhost::default_plugin_dirs();
            &default_dirs[..]
        } else {
            dirs
        };
        let found = scan(dirs).map_err(BackendError::PluginScan)?;
        register_scanned(&mut self.registry, &found);
        Ok(found)
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

fn now_us() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

/// The stable variant name for a [`Severity`] (mirrors the bare-string serde the
/// `LogStore` columns expect: `Trace|Debug|Info|Warn|Error`).
fn severity_name(s: Severity) -> &'static str {
    match s {
        Severity::Trace => "Trace",
        Severity::Debug => "Debug",
        Severity::Info => "Info",
        Severity::Warn => "Warn",
        Severity::Error => "Error",
    }
}

/// The stable variant name for a [`Source`] (`Engine|Wasm|Ui|Native`).
fn source_name(s: Source) -> &'static str {
    match s {
        Source::Engine => "Engine",
        Source::Wasm => "Wasm",
        Source::Ui => "Ui",
        Source::Native => "Native",
    }
}

/// Render an [`EventKind`] into the `LogStore` triple: the variant name, a
/// human-readable message, and an optional JSON blob of the structured fields.
/// Pure, off-RT; keeps the SQLite tail self-describing without coupling the store
/// to `ojproto`.
fn render_event_kind(kind: &EventKind) -> (&'static str, String, Option<String>) {
    match kind {
        EventKind::Lifecycle => ("Lifecycle", "lifecycle event".into(), None),
        EventKind::GraphSwap => ("GraphSwap", "graph hot-swap landed".into(), None),
        EventKind::Xrun { dropped } => (
            "Xrun",
            format!("xrun: {dropped} frame(s) dropped"),
            Some(format!("{{\"dropped\":{dropped}}}")),
        ),
        EventKind::NodeFault { node, fault } => (
            "NodeFault",
            format!("node {} fault: {fault:?}", node.0),
            Some(format!("{{\"node\":{},\"fault\":\"{fault:?}\"}}", node.0)),
        ),
        EventKind::RingFull => ("RingFull", "event ring overflowed".into(), None),
        EventKind::Asset => ("Asset", "asset event".into(), None),
        EventKind::Plugin => ("Plugin", "plugin event".into(), None),
        EventKind::Midi => ("Midi", "midi event".into(), None),
        EventKind::Collab => ("Collab", "collab event".into(), None),
        EventKind::Message { code, text } => (
            "Message",
            text.clone(),
            Some(format!("{{\"code\":{code}}}")),
        ),
        EventKind::LooperEdge { node, from, to } => (
            "LooperEdge",
            format!("looper {} edge: {from} -> {to}", node.0),
            Some(format!(
                "{{\"node\":{},\"from\":{from},\"to\":{to}}}",
                node.0
            )),
        ),
    }
}

fn lift_event(rt: RtEvent, seq: u32, ts_us: u64) -> Event {
    let kind = match rt {
        RtEvent::Xrun { dropped } => EventKind::Xrun { dropped },
        RtEvent::NodeFault { node, fault } => EventKind::NodeFault { node, fault },
        RtEvent::RingFull => EventKind::RingFull,
        RtEvent::LooperEdge { node, from, to } => EventKind::LooperEdge { node, from, to },
    };
    let severity = match kind {
        EventKind::NodeFault { .. } => Severity::Error,
        _ => Severity::Warn,
    };
    Event {
        v: ojproto::SCHEMA_VERSION,
        seq,
        severity,
        kind,
        source: Source::Engine,
        ts_us,
        corr_id: 0,
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
        // The engine follows the default output device's rate (e.g. 96k on a pro
        // interface), falling back to DEFAULT_STREAM's rate when there is no device.
        let expected_rate =
            ojcore_native::default_output_sample_rate().unwrap_or(DEFAULT_STREAM.sample_rate);
        assert_eq!(info.sample_rate, expected_rate);
        assert!(info.latency_ms > 0.0);
    }

    /// The registry knows every loader the unit must register, by manifest id —
    /// the FULL native built-in set (effects + structural + instruments + SF2).
    #[test]
    fn registry_has_builtin_and_instruments() {
        let reg = EngineBackend::build_registry();
        // Effects.
        assert!(reg.contains(ojcore::GAIN_ID));
        assert!(reg.contains(ojcore::BIQUAD_ID));
        assert!(reg.contains(ojcore::WAVESHAPER_ID));
        assert!(reg.contains(ojcore::DELAY_ID));
        assert!(reg.contains(ojcore::CONVOLUTION_ID));
        // Structural.
        assert!(reg.contains(ojcore::SPEAKER_OUT_ID));
        assert!(reg.contains(ojcore::GRAPH_IN_ID));
        assert!(reg.contains(ojcore::PASSTHROUGH_ID));
        // Instruments.
        assert!(reg.contains(ojinstrument::OSC_ID));
        assert!(reg.contains(ojinstrument::SAMPLER_ID));
        assert!(reg.contains(ojinstrument::KARPLUS_ID));
        // SF2 is native-only and on by default (the `sf2` feature).
        assert!(reg.contains(ojinstrument::SF2_ID));
    }

    /// `scan_plugins` is safe in the device-less / no-backend sandbox: an empty
    /// or missing directory yields an empty list and never errors.
    #[test]
    fn scan_plugins_empty_is_safe() {
        let mut be = EngineBackend::new();
        let found = be
            .scan_plugins(&[std::path::PathBuf::from("/no/such/plugin/dir")])
            .expect("scan never errors in the scaffold build");
        assert!(found.is_empty());
    }

    /// The starter graph lowers cleanly (exactly one master output, no cycle).
    #[test]
    fn starter_graph_compiles() {
        let reg = EngineBackend::build_registry();
        let g = EngineBackend::starter_graph(DEFAULT_STREAM);
        assert!(compile(&g, &reg).is_ok());
    }

    /// `push_graph` recompiles a UI-pushed graph and adopts it without error.
    /// ENVIRONMENT-AGNOSTIC: the device-independent contract is that the graph is
    /// retained as `last_graph`. Whether the program is ALSO staged in the swap
    /// mailbox depends on a live host — present only with a real output device; the
    /// headless cold-start path bakes it directly into `Engine::new` instead and the
    /// swap stays empty. So we assert the universal invariant always, and the swap
    /// publish only where a device makes the host live (a box WITH audio).
    #[test]
    fn device_recovery_poll_is_safe_without_a_host() {
        // Device-less (CI sandbox): no host, so the recovery tick has no mailbox to
        // drain, the supervisor stays Running, and no spurious lifecycle events are
        // emitted. It must be safe to call every poll without a device. (The full
        // hold -> reopen -> resume policy is covered by ojcore-native's supervisor
        // + backend tests; this guards the EngineBackend wiring.)
        let mut be = EngineBackend::new();
        for _ in 0..5 {
            be.poll_device_recovery();
        }
        assert!(
            be.drain_events().is_empty(),
            "no device, no spurious faults"
        );
    }

    #[test]
    fn push_graph_compiles_and_publishes() {
        let mut be = EngineBackend::new();
        let g = EngineBackend::starter_graph(DEFAULT_STREAM);
        assert!(be.push_graph(&g).is_ok());
        assert!(
            be.last_graph.is_some(),
            "the adopted graph is retained as last_graph"
        );
        if be.is_running() {
            assert!(
                be.swap.has_pending(),
                "a live host stages the pushed program in the swap mailbox"
            );
        }
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

    // --- U-EXEC-PARITY capability seam tests -------------------------------

    /// `looper_cmd` enqueues an `RtCommand::Looper` with the given node + action.
    #[test]
    fn looper_cmd_enqueues_looper_command() {
        let mut be = EngineBackend::new();
        for action in 0u8..=8 {
            assert!(
                be.looper_cmd(NodeIdx(3), action, 0).is_ok(),
                "looper action {action} should enqueue"
            );
        }
    }

    /// `load_sample` content-addresses the PCM into the catalog and returns an id
    /// that resolves back to the same samples.
    #[test]
    fn load_sample_stores_into_catalog() {
        let mut be = EngineBackend::new();
        let pcm = vec![0.0f32, 0.25, -0.25, 0.5];
        let id = be
            .load_sample(NodeIdx(2), pcm.clone(), 48_000, 60)
            .expect("sample stores");
        let resolved = be.catalog.resolve(id).expect("resolves");
        assert_eq!(resolved.samples, pcm);
        assert_eq!(resolved.channels, 1);
        assert_eq!(resolved.sample_rate, 48_000);
    }

    /// A recorder capture round-trips through start -> stop, returning the (empty
    /// in the device-less sandbox) PCM + the stream rate.
    #[test]
    fn recorder_start_then_stop_returns_capture() {
        let mut be = EngineBackend::new();
        be.recorder_start(NodeIdx(4));
        let (pcm, rate) = be.recorder_stop(NodeIdx(4)).expect("capture was armed");
        // Capture rate follows the device (see backend_constructs_headless).
        let expected_rate =
            ojcore_native::default_output_sample_rate().unwrap_or(DEFAULT_STREAM.sample_rate);
        assert_eq!(rate, expected_rate);
        // The engine-output tap is wired in the host (see host.rs
        // `render_block_taps_mono_master_into_armed_capture`), but this sandbox
        // has no output device — so there is no live stream to render, and the
        // captured PCM is empty here. The start/stop lifecycle is intact.
        assert!(pcm.is_empty());
        // Stopping an unarmed node returns None rather than erroring.
        assert!(be.recorder_stop(NodeIdx(99)).is_none());
    }

    /// Exporting a node with no armed capture is a clean error, not a panic.
    #[test]
    fn recorder_export_unknown_node_errors() {
        let mut be = EngineBackend::new();
        let err = be.recorder_export(NodeIdx(7), "/tmp/oj-export-test.wav");
        assert!(matches!(err, Err(BackendError::UnknownNode(7))));
    }

    /// Enabling metering flips the mirrored flag (re-applied on the next swap).
    #[test]
    fn enable_metering_sets_flag() {
        let mut be = EngineBackend::new();
        assert!(!be.metering);
        be.enable_metering(true);
        assert!(be.metering);
    }

    /// `drain_meters` surfaces `Meter` AND `Looper` frames (one ring, one consumer,
    /// all tags), and filters out `Beat` (it rides the transport path). With no
    /// audio device the ring is otherwise empty, so the drain never panics.
    #[test]
    fn drain_meters_decodes_meter_and_looper_frames() {
        let mut be = EngineBackend::new();
        // Drain any frames a live audio device (present in this sandbox) already
        // published, so the assertions only see the frames we push below — the test
        // must be deterministic with OR without a device.
        let _ = be.drain_meters();
        // Push one Meter, one Looper, and one Beat frame directly onto the ring
        // (simulating the audio thread's publish), then drain.
        let mut buf = [0u8; return_frame::MAX_LEN];
        let n = return_frame::encode_meter(NodeIdx(5), 0.1, 0.8, &mut buf);
        assert!(be.meter_ring.push(&buf[..n]));
        let n = return_frame::encode_looper(NodeIdx(9), 3, 240, 480, 0.5, &mut buf);
        assert!(be.meter_ring.push(&buf[..n]));
        let n = return_frame::encode_beat(1, 2, 0.5, &mut buf);
        assert!(be.meter_ring.push(&buf[..n]));

        let frames = be.drain_meters();
        // The Meter and Looper frames survive the filter; the Beat is dropped. A
        // live device may interleave its own Meter/Beat frames, so assert on the
        // SPECIFIC frames we pushed rather than an exact count.
        let meter = frames.iter().find_map(|f| match f {
            EngineFrame::Meter { node, peak, .. } if *node == NodeIdx(5) => Some(*peak),
            _ => None,
        });
        assert!(meter.is_some(), "the pushed Meter frame survived");
        assert!((meter.unwrap() - 0.8).abs() < 1e-6);

        let looper = frames.iter().find(|f| {
            matches!(f, EngineFrame::Looper { node, .. } if *node == NodeIdx(9))
        });
        match looper {
            Some(EngineFrame::Looper { state, pos, loop_len, peak, .. }) => {
                assert_eq!(*state, 3);
                assert_eq!(*pos, 240);
                assert_eq!(*loop_len, 480);
                assert!((peak - 0.5).abs() < 1e-6);
            }
            other => panic!("expected the pushed Looper frame, got {other:?}"),
        }

        // No Beat frame from OUR push survives the filter (a device may still emit
        // its own transport beats; we only assert ours is gone by checking the
        // pushed Beat shape — bar=1, beat=2 — is absent).
        assert!(
            !frames
                .iter()
                .any(|f| matches!(f, EngineFrame::Beat { bar: 1, beat: 2, .. })),
            "Beat frames are filtered out of the meter drain",
        );
    }

    /// Speaker volume, device selection, and mic capture are all REAL round trips
    /// now (the cpal re-open / duplex-input routing landed). In a device-free
    /// sandbox the stream rebuild cannot open a host, but the calls must never
    /// panic and must RECORD the routing state (the chosen device id / the mic
    /// node), so a device appearing on the next push resumes on the right routing.
    #[test]
    fn speaker_and_mic_controls_route_for_real() {
        let mut be = EngineBackend::new();
        // Two SetParams (volume, mute) enqueue cleanly on the live ring.
        be.set_speaker_volume(NodeIdx(1), 0.7, false)
            .expect("speaker volume enqueues");

        // Selecting an output device records the choice and triggers the (here
        // device-less, so no-op) rebuild — never an error, never a panic.
        be.set_speaker_device(NodeIdx(1), "device-2")
            .expect("device selection is routable");
        assert_eq!(
            be.selected_output_device.as_deref(),
            Some("device-2"),
            "the chosen output device id is recorded"
        );
        // An empty id resets to the system default.
        be.set_speaker_device(NodeIdx(1), "")
            .expect("default device selection is routable");
        assert_eq!(
            be.selected_output_device, None,
            "an empty id resets to the system default"
        );

        // Enabling mic capture records the target MicIn node; disabling clears it.
        be.set_mic(NodeIdx(1), true)
            .expect("mic enable is routable");
        assert_eq!(
            be.mic_node,
            Some(NodeIdx(1)),
            "mic capture target node is recorded while enabled"
        );
        be.set_mic(NodeIdx(1), false)
            .expect("mic disable is routable");
        assert_eq!(be.mic_node, None, "mic capture target cleared on disable");
    }

    /// `load_sample` with a previously pushed graph binds the asset to the
    /// Sampler node and recompiles: the asset is stored AND the live graph now
    /// carries the AssetRef + root-note param, so the sampler resolves it.
    #[test]
    fn load_sample_binds_asset_into_live_graph() {
        use ojinstrument::{SAMPLER_ID, SAMPLER_PCM_PARAM};
        use ojproto::{ConnectionType, IrEdge, IrNode, PrimitiveKind};

        let mut be = EngineBackend::new();
        // Sampler(1) -> SpeakerOut(2).
        let graph = OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: SAMPLER_ID.into(),
                    kind: PrimitiveKind::Sampler,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(2),
                    manifest_id: ojcore::SPEAKER_OUT_ID.into(),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(1),
                from_port: 0,
                to_node: NodeIdx(2),
                to_port: 0,
                kind: ConnectionType::Audio,
            }],
            schedule: vec![],
        };
        be.push_graph(&graph).expect("push graph");

        let pcm = vec![0.0f32, 0.5, -0.5, 0.25, 0.1, -0.1];
        let id = be
            .load_sample(NodeIdx(1), pcm.clone(), 48_000, 60)
            .expect("sample binds");

        // The asset resolves back to the same PCM.
        let resolved = be.catalog.resolve(id).expect("resolves");
        assert_eq!(resolved.samples, pcm);

        // The live graph now binds the asset + root note onto the sampler node.
        let g = be.last_graph.as_ref().expect("graph kept");
        let sampler = g.nodes.iter().find(|n| n.id == NodeIdx(1)).unwrap();
        assert!(
            sampler.assets.iter().any(|a| a.asset == id),
            "asset not bound to sampler node"
        );
        assert!(
            sampler
                .params
                .iter()
                .any(|p| p.id == SAMPLER_PCM_PARAM && p.value == 60.0),
            "root note not bound"
        );
    }

    /// Build a Sampler(1) -> SpeakerOut(2) graph (no asset bound) for the
    /// forward-merge tests.
    fn sampler_graph() -> OjGraph {
        use ojinstrument::SAMPLER_ID;
        use ojproto::{ConnectionType, IrEdge, IrNode, PrimitiveKind};
        OjGraph {
            ir_version: ojproto::SCHEMA_VERSION,
            sample_rate: 48_000,
            block_size: 64,
            nodes: vec![
                IrNode {
                    id: NodeIdx(1),
                    manifest_id: SAMPLER_ID.into(),
                    kind: PrimitiveKind::Sampler,
                    params: vec![],
                    assets: vec![],
                    n_in: 0,
                    n_out: 1,
                },
                IrNode {
                    id: NodeIdx(2),
                    manifest_id: ojcore::SPEAKER_OUT_ID.into(),
                    kind: PrimitiveKind::SpeakerOut,
                    params: vec![],
                    assets: vec![],
                    n_in: 1,
                    n_out: 0,
                },
            ],
            edges: vec![IrEdge {
                from_node: NodeIdx(1),
                from_port: 0,
                to_node: NodeIdx(2),
                to_port: 0,
                kind: ConnectionType::Audio,
            }],
            schedule: vec![],
        }
    }

    /// SINGLE-OWNER FORWARD-MERGE: a sample bound via `load_sample` SURVIVES a
    /// subsequent UI `push_graph` (which carries no asset). Before the fix the
    /// push clobbered `last_graph` and silently dropped the sample on the next
    /// edit; now the engine forward-merges the prior binding, with no second owner
    /// in TS. This is the native↔wasm parity the plan calls out.
    #[test]
    fn pushed_graph_preserves_bound_sample() {
        use ojinstrument::SAMPLER_PCM_PARAM;

        let mut be = EngineBackend::new();
        be.push_graph(&sampler_graph()).expect("initial push");

        // Imperatively bind a sample to the sampler node (the engine-only mapping).
        let pcm = vec![0.0f32, 0.5, -0.5, 0.25];
        let id = be
            .load_sample(NodeIdx(1), pcm.clone(), 48_000, 60)
            .expect("sample binds");

        // A FRESH UI push of the same topology (no asset on the wire) must NOT drop
        // the binding — the forward-merge carries it onto the new kept graph.
        be.push_graph(&sampler_graph()).expect("re-push");

        let g = be.last_graph.as_ref().expect("graph kept");
        let sampler = g.nodes.iter().find(|n| n.id == NodeIdx(1)).unwrap();
        assert!(
            sampler.assets.iter().any(|a| a.slot == 0 && a.asset == id),
            "bound sample dropped by re-push (forward-merge failed)"
        );
        assert!(
            sampler
                .params
                .iter()
                .any(|p| p.id == SAMPLER_PCM_PARAM && p.value == 60.0),
            "root note dropped by re-push"
        );
    }

    /// The forward-merge yields to an EXPLICIT slot-0 binding on the incoming push
    /// (a serialized project that bakes its own sample stays authoritative).
    #[test]
    fn explicit_push_binding_overrides_merge() {
        let mut be = EngineBackend::new();
        be.push_graph(&sampler_graph()).expect("initial push");
        let first = be
            .load_sample(NodeIdx(1), vec![0.1f32, 0.2], 48_000, 60)
            .expect("first sample binds");

        // Push a graph that ALREADY carries its own slot-0 asset on node 1.
        let other = be
            .catalog
            .insert(Pcm {
                samples: vec![0.9f32, -0.9],
                channels: 1,
                sample_rate: 48_000,
            })
            .expect("store second asset");
        assert_ne!(first, other, "distinct assets");
        let mut g = sampler_graph();
        g.nodes[0].assets.push(AssetRef {
            slot: 0,
            asset: other,
        });
        be.push_graph(&g).expect("push with explicit binding");

        let kept = be.last_graph.as_ref().unwrap();
        let sampler = kept.nodes.iter().find(|n| n.id == NodeIdx(1)).unwrap();
        let slot0 = sampler.assets.iter().find(|a| a.slot == 0).unwrap();
        assert_eq!(
            slot0.asset, other,
            "explicit push binding must win over the merged one"
        );
    }

    /// DEVICE-LOSS TICK, NO-HOST BRANCH: when there is no running host (device-less
    /// boot, or a prior start failed) a `tick` has nothing to recover — it must NOT
    /// latch `device_lost`, must emit no event, and must never panic. We force
    /// `host = None` so this is deterministic on a dev box that DOES have a device.
    #[test]
    fn tick_is_inert_without_a_host() {
        let mut be = EngineBackend::new();
        // Force the no-host state (the headless / failed-start path) regardless of
        // whether this machine happens to have an audio device.
        be.host = None;
        be.device_lost = false;
        be.tick();
        assert!(
            !be.device_lost,
            "tick must not latch device-loss with no host"
        );
        assert!(
            be.pending_events.is_empty(),
            "tick emits no event when there is nothing to recover"
        );
        // And it composes into a clean drain (the live call site).
        let drained = be.drain_events();
        assert!(drained.iter().all(|e| e.kind != EventKind::Lifecycle));
    }

    /// DEVICE-LOSS REBUILD DECISION: after a (simulated) loss the dead host is
    /// dropped, so `rebuild_after_loss` takes the cold-start `adopt` path and
    /// RE-ADOPTS `last_graph`. Environment-agnostic:
    ///   • on a box WITH a device the rebuild OPENS a real stream → recovered
    ///     (host running again), the live patch resumes;
    ///   • on a device-less box it returns `false` (stay lost, retry next tick).
    /// EITHER way it must not panic and must leave `last_graph` intact so the patch
    /// is ready to resume. The orchestrator drives the real Disable-PnpDevice loss.
    #[test]
    fn rebuild_after_loss_readopts_last_graph() {
        let mut be = EngineBackend::new();
        // Push a real graph so `last_graph` is populated (the patch to resume).
        be.push_graph(&sampler_graph()).expect("push graph");
        let kept_before = be.last_graph.clone().expect("graph kept");

        // Simulate the post-loss state the tick sets up: dead host dropped.
        be.host = None;
        be.device_lost = true;

        // Rebuild on the current default device. Result depends on hardware; the
        // INVARIANT we assert is recovered ⇔ host is now running.
        let recovered = be.rebuild_after_loss();
        assert_eq!(
            recovered,
            be.is_running(),
            "recovered iff a stream is running again"
        );
        // The patch is preserved across the attempt (NOT cleared by the rebuild),
        // so the sampler topology survives a loss whether or not a device was back.
        assert_eq!(
            be.last_graph.as_ref().map(|g| g.nodes.len()),
            Some(kept_before.nodes.len()),
            "last_graph preserved across the rebuild so the patch resumes intact"
        );
    }

    /// DE-BOUNCE: one device-loss latches `device_lost` and emits EXACTLY ONE
    /// `Warn` Lifecycle, and repeated ticks while still lost do NOT re-emit the loss
    /// event (no event storm) — they only retry the rebuild. Forced no-host state
    /// makes the retry branch deterministic without hardware.
    #[test]
    fn repeated_ticks_while_lost_emit_one_loss_event() {
        let mut be = EngineBackend::new();
        be.push_graph(&sampler_graph()).expect("push graph");
        // Enter the lost state as if a fault was just detected and the dead host
        // dropped; clear any events the push staged so we count only the loss path.
        be.host = None;
        be.device_lost = true;
        be.pending_events.clear();

        // Tick three times. On a device-less box every retry fails and stays lost;
        // on a box WITH a device the FIRST retry recovers. Either way the loss
        // itself is already latched, so no NEW Warn loss event should appear here —
        // the loss event is emitted once at detection (covered by the tick path),
        // not per retry.
        let mut warns = 0usize;
        for _ in 0..3 {
            be.tick();
            warns += be
                .pending_events
                .iter()
                .filter(|e| e.kind == EventKind::Lifecycle && e.severity == Severity::Warn)
                .count();
            // Drain so each tick's events are counted once.
            let _ = be.drain_events();
        }
        assert_eq!(
            warns, 0,
            "already-latched loss must not re-emit a Warn loss event on retries"
        );
    }

    /// DE-BOUNCE: a recovery emits exactly ONE `Info` Lifecycle, and the `Warn`
    /// loss / `Info` recovery severities are distinct (loss → DEGRADED, recovery →
    /// healthy). Drives the tri-state health without a second wire variant.
    #[test]
    fn lifecycle_severity_distinguishes_loss_from_recovery() {
        let mut be = EngineBackend::new();
        be.emit_lifecycle(Severity::Warn, "audio device lost".into());
        be.emit_lifecycle(Severity::Info, "audio device recovered".into());
        let drained = be.drain_events();
        let lifecycles: Vec<_> = drained
            .iter()
            .filter(|e| e.kind == EventKind::Lifecycle)
            .collect();
        assert_eq!(lifecycles.len(), 2, "one loss + one recovery event");
        assert_eq!(lifecycles[0].severity, Severity::Warn, "loss is a warning");
        assert_eq!(
            lifecycles[1].severity,
            Severity::Info,
            "recovery is informational (not an alarm)"
        );
    }

    /// The L3 SQLite/FTS5 log store ingests drained events off-RT: after attaching
    /// a store and draining a synthesized device-loss `Lifecycle`, the row is
    /// queryable. Proves the dormant store is now WIRED (code-value #8).
    #[test]
    fn drain_events_persists_into_log_store() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("oj-logstore-test-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);

        let mut be = EngineBackend::new();
        be.attach_log_store(&path).expect("store opens");

        // Synthesize a control-side Lifecycle event and drain it.
        be.emit_lifecycle(Severity::Warn, "simulated device loss".into());
        let drained = be.drain_events();
        assert!(
            drained.iter().any(|e| e.kind == EventKind::Lifecycle),
            "lifecycle event drained"
        );

        // The store now holds the durable tail; it is searchable by kind.
        let store = be.log_store.as_ref().expect("store attached");
        assert_eq!(store.count().unwrap(), drained.len() as i64);
        let hits = store.search("Lifecycle", 10).unwrap();
        assert!(
            hits.iter().any(|h| h.kind == "Lifecycle"),
            "lifecycle row searchable in the SQLite tail"
        );

        drop(be);
        let _ = std::fs::remove_file(&path);
    }
}
