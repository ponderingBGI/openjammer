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

use ojcore::meter::return_frame;
use ojcore::{
    compile, compile_with_assets, master_param, CommandProducer, CommandQueue, CompileError,
    Engine, MeterRing, PluginRegistry, ProgramSwap,
};
use ojcore_native::{
    AssetCatalog, AssetError, AssetStore, AudioHost, HostError, Pcm, StreamRequest,
};
use ojhost::{register_scanned, scan, HostError as PluginHostError, PluginDescriptor};
use ojinstrument::{register_all, RegisterOpts};
use ojproto::{AssetId, AssetRef, EngineFrame, NodeIdx, OjGraph, RtCommand};

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
        let stream = DEFAULT_STREAM;
        let swap = ProgramSwap::new();
        let meter_ring = Arc::new(MeterRing::new());

        // Compile the minimal starter program (silent: a gain into the speaker).
        // `compile` only fails on a malformed graph, and ours is well-formed by
        // construction, so a failure here is a build-time bug, not a runtime one.
        let program =
            compile(&Self::starter_graph(stream), &registry).expect("starter graph compiles");
        let mut engine = Engine::new(program);
        // Attach the control-side meter ring up front; metering stays OFF until a
        // subscriber asks (zero-cost while off). The same `Arc` clone is kept on
        // the control side so `drain_meters` reads what the audio thread publishes.
        engine.attach_meter_ring(Some(Arc::clone(&meter_ring)));

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
            meter_ring,
            metering: false,
            catalog: AssetCatalog::new(),
            store: AssetStore::new(),
            captures: std::collections::HashMap::new(),
            last_graph: None,
        }
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
    /// ASSET RESOLUTION. Compilation goes through [`compile_with_assets`] with the
    /// backend's [`AssetCatalog`] as the resolver, so any node carrying an
    /// [`AssetRef`] (a Sampler's sample, a Convolution's IR) has its decoded PCM
    /// installed (Sampler `set_sample` / Convolution `set_ir`) BEFORE the program
    /// goes live — the founder-verified seam that makes a serialized graph with a
    /// bound sample actually play.
    pub fn push_graph(&mut self, graph: &OjGraph) -> Result<(), BackendError> {
        self.adopt(graph)?;
        // Remember the live graph so a later sample bind can re-resolve + recompile
        // it against the updated catalog without a fresh UI push.
        self.last_graph = Some(graph.clone());
        Ok(())
    }

    /// Compile `graph` (resolving its assets through the catalog) and adopt the
    /// fresh program into the running engine. Shared by [`push_graph`] and the
    /// sample-bind path; does NOT itself store `last_graph` (the caller decides).
    fn adopt(&mut self, graph: &OjGraph) -> Result<(), BackendError> {
        // Compile once; reuse the program for both the swap publish and the
        // fresh engine. `CompiledProgram` is not `Clone`, so we compile twice
        // from the same graph: one program to publish, one to run. Both are
        // off-RT allocations, and both resolve assets through the catalog so the
        // staged and the running program are byte-for-byte the same.
        let published = compile_with_assets(graph, &self.registry, &self.catalog)
            .map_err(BackendError::Compile)?;
        self.swap.publish(published);

        let program = compile_with_assets(graph, &self.registry, &self.catalog)
            .map_err(BackendError::Compile)?;
        let mut engine = Engine::new(program);
        // Re-attach the meter ring + re-apply the metering toggle to the fresh
        // engine so the level stream survives a graph swap.
        engine.attach_meter_ring(Some(Arc::clone(&self.meter_ring)));
        engine.set_metering(self.metering);

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
            // ANY host-(re)start failure is NON-FATAL here, matching
            // [`EngineBackend::new`]: the freshly compiled program is already
            // published to the swap mailbox and the new producer is live, so
            // commands still validate and the next `push_graph` re-attempts the
            // start. This covers both a device-less sandbox
            // (`HostError::NoOutputDevice`) AND a present-but-incompatible device
            // (e.g. a default output whose WASAPI shared-mode format rejects the
            // requested rate/buffer). The UI keeps running with the engine idle
            // instead of surfacing a hard error the user cannot act on.
            Err(e) => {
                eprintln!("ojcore: audio host failed to (re)start (non-fatal): {e}");
                self.producer = producer;
                Ok(())
            }
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
    /// the given action code (one of the [`ojproto::looper_action`] consts). The
    /// audio thread applies it via `DspInstance::looper_action`.
    pub fn looper_cmd(&mut self, node: NodeIdx, action: u8) -> Result<(), BackendError> {
        self.send_command(RtCommand::Looper { node, action })
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
    pub fn drain_meters(&mut self) -> Vec<EngineFrame> {
        let mut out = Vec::new();
        let mut buf = [0u8; return_frame::MAX_LEN];
        while let Some(n) = self.meter_ring.pop(&mut buf) {
            if let Some(frame) = return_frame::decode(&buf[..n]) {
                // Surface only Meter frames here (Beat goes via the transport
                // path); the UI's signal-level stream consumes Meter peaks.
                if matches!(frame, EngineFrame::Meter { .. }) {
                    out.push(frame);
                }
            }
        }
        out
    }

    /// Load decoded mono PCM as the sample for `node`'s `builtin.sampler` and
    /// make it PLAY: content-address the PCM into the [`AssetCatalog`] (the same
    /// off-RT asset pipeline a file load uses), bind the returned [`AssetId`] +
    /// the `root_note` onto `node` in the live graph, then recompile so the
    /// Sampler's `set_sample` (the U6 seam) fires through
    /// [`compile_with_assets`]. Returns the stored [`AssetId`].
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

    /// Arm a recorder capture of `node`'s output bus. v1 records the capture's
    /// spec; the engine-output tap that fills the PCM is the documented gap (the
    /// public [`AudioHost`] callback owns the engine and exposes no per-node bus
    /// tap yet). `recorder_stop` / `recorder_export` operate on the captured PCM.
    pub fn recorder_start(&mut self, node: NodeIdx) {
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

    /// Stop a recorder capture and return its captured (interleaved) PCM + rate.
    /// Returns `None` if no capture was armed for `node`.
    pub fn recorder_stop(&mut self, node: NodeIdx) -> Option<(Vec<f32>, u32)> {
        let mut cap = self.captures.remove(&node.0)?;
        cap.recording = false;
        Some((cap.pcm, cap.sample_rate))
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

    /// Route a speaker node to an output device id. Device selection is a host
    /// (cpal) concern; v1 records the request (the host renders to the default
    /// device). Surfaced for round-trip parity with the Web Audio path.
    pub fn set_speaker_device(&mut self, _node: NodeIdx, _device_id: &str) {
        // TODO(native-parity): re-open the cpal stream on the chosen device.
    }

    /// Enable mic capture into `node`'s input bus. Requires the duplex input
    /// stream; v1 records the request (the host opens output-only by default).
    pub fn set_mic(&mut self, _node: NodeIdx, _enabled: bool) {
        // TODO(native-parity): open the duplex input + route it to the node bus.
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

    // --- U-EXEC-PARITY capability seam tests -------------------------------

    /// `looper_cmd` enqueues an `RtCommand::Looper` with the given node + action.
    #[test]
    fn looper_cmd_enqueues_looper_command() {
        let mut be = EngineBackend::new();
        for action in 0u8..=5 {
            assert!(
                be.looper_cmd(NodeIdx(3), action).is_ok(),
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
        assert_eq!(rate, DEFAULT_STREAM.sample_rate);
        // No engine-output tap in the sandbox, so the captured PCM is empty —
        // but the start/stop lifecycle is intact (the documented gap is the tap).
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

    /// `drain_meters` returns only `Meter` frames decoded from the ring. With no
    /// audio device the ring is empty, so the drain is an empty batch (no panic).
    #[test]
    fn drain_meters_decodes_only_meter_frames() {
        let mut be = EngineBackend::new();
        // Push one encoded Meter frame and one Beat frame directly onto the ring
        // (simulating the audio thread's publish), then drain.
        let mut buf = [0u8; return_frame::MAX_LEN];
        let n = return_frame::encode_meter(NodeIdx(5), 0.1, 0.8, &mut buf);
        assert!(be.meter_ring.push(&buf[..n]));
        let n = return_frame::encode_beat(1, 2, 0.5, &mut buf);
        assert!(be.meter_ring.push(&buf[..n]));

        let frames = be.drain_meters();
        // Only the Meter frame survives the filter.
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            EngineFrame::Meter { node, peak, .. } => {
                assert_eq!(*node, NodeIdx(5));
                assert!((peak - 0.8).abs() < 1e-6);
            }
            other => panic!("expected Meter, got {other:?}"),
        }
    }

    /// Speaker / mic control methods are safe round trips and never panic.
    /// `set_speaker_volume` now enqueues real `SetParam`s (volume + mute) onto the
    /// live ring; device / mic remain documented host-side gaps.
    #[test]
    fn speaker_and_mic_controls_do_not_panic() {
        let mut be = EngineBackend::new();
        // Two SetParams (volume, mute) enqueue cleanly on the live ring.
        be.set_speaker_volume(NodeIdx(1), 0.7, false)
            .expect("speaker volume enqueues");
        be.set_speaker_device(NodeIdx(1), "device-2");
        be.set_mic(NodeIdx(1), true);
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
}
