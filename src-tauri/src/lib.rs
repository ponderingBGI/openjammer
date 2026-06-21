//! The OpenJammer native desktop shell (Tauri v2).
//!
//! HYBRID ARCHITECTURE. The frontend is the EXISTING Vite web app (loaded into
//! the Tauri webview — `bun run dev` in development, the bundled `../dist` in a
//! release build). The backend is the native, low-latency [`engine`] (the
//! `<5 ms` ojcore engine on a cpal stream). They talk over Tauri's `invoke`
//! IPC, which is strictly CONTROL-RATE: `OjGraph` and `RtCommand` cross as JSON;
//! no audio sample buffer ever does (governing principle #4).
//!
//! On `setup` we build the [`engine::EngineBackend`] (registers the built-in
//! gain + the Osc / Sampler / Karplus instrument loaders, compiles a minimal
//! starter graph, and starts the [`AudioHost`](ojcore_native::AudioHost)) and
//! `manage` it as Tauri state. The commands below are the UI->RT seam.

mod ai;
mod auth;
mod backup;
mod bridge;
mod engine;
mod sandbox;
mod updater;

use std::path::PathBuf;

use engine::BackendState;
use ojhost::PluginDescriptor;
use ojproto::{EngineFrame, Event, NodeIdx, OjGraph, RtCommand};
use tauri::Manager;

/// Push a full graph from the UI: recompile it against the plugin registry and
/// adopt it into the running engine (publish to the program-swap mailbox + run).
/// `graph` is an [`OjGraph`] serialized as JSON across the IPC boundary.
#[tauri::command]
fn push_graph(graph: OjGraph, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .push_graph(&graph)
        .map_err(|e| e.to_string())
}

/// Enqueue one realtime command (note on/off, param patch, transport) onto the
/// wait-free UI->RT ring the audio callback drains each block. `cmd` is an
/// [`RtCommand`] serialized as JSON.
#[tauri::command]
fn send_command(cmd: RtCommand, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .send_command(cmd)
        .map_err(|e| e.to_string())
}

/// Query the negotiated stream + theoretical buffering-floor latency, for the
/// UI's device / latency readout.
#[tauri::command]
fn query_stream(state: tauri::State<'_, BackendState>) -> Result<engine::StreamInfo, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .stream_info())
}

/// Scan `dirs` for third-party plugins (VST3 / CLAP, + AU on macOS) and return
/// the descriptors for the UI's plugin list. Each found plugin is also
/// registered as a `host.plugin` node so it can be dropped into the graph.
///
/// `dirs` are UTF-8 filesystem paths from the UI. In the default build (no
/// hosting backend compiled in) this returns an empty list — the UI degrades to
/// "no plugins found" rather than erroring. See crates/ojhost/README.md for how
/// to enable a real backend.
#[tauri::command]
fn scan_plugins(
    dirs: Vec<String>,
    state: tauri::State<'_, BackendState>,
) -> Result<Vec<PluginDescriptor>, String> {
    let paths: Vec<PathBuf> = dirs.into_iter().map(PathBuf::from).collect();
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .scan_plugins(&paths)
        .map_err(|e| e.to_string())
}

/// Whether the native audio engine is currently running (false in a device-less
/// environment, where the UI still runs and the engine starts when a device
/// appears on the next `push_graph`).
#[tauri::command]
fn engine_running(state: tauri::State<'_, BackendState>) -> Result<bool, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .is_running())
}

/// Compile an AI-authored Faust DSP source via the `ojfaust` crate (U20).
///
/// This is the DSP-NODE AUTHORING leg of the agent. When the desktop build was
/// compiled with `--features ojfaust/libfaust` (and libfaust is installed), this
/// returns the compiled DSP's name + port counts so the frontend can register it
/// as a first-class node. In the DEFAULT build (no libfaust) it returns
/// `Ok(None)` — the agent stores the Faust source against the node instead, to be
/// compiled later, exactly as the project plan's fallback specifies. Reversible
/// either way (the node is deletable). Never runs on the realtime path.
#[tauri::command]
fn ai_faust_compile(source: String) -> Result<Option<ai::FaustCompileResult>, String> {
    ai::compile_faust(&source)
}

// `ai::author_wasm_node` (M6) is itself a `#[tauri::command]`; it is registered
// directly in the invoke_handler below (like `ai::ai_run`). It compiles DSP source
// via the ojfaust CLI Path B to a `.wasm` + real manifest, validates host-side
// fail-closed, and NEVER runs the wasm (the RT host is founder-gated; see
// `docs/code-node-abi.md`).

// --- U-EXEC-PARITY: looper / sampler / recorder / metering / speaker / mic ---

/// Drive a looper node's state machine: enqueue an `RtCommand::Looper` carrying
/// `action` (one of the `ojproto::looper_action` codes). The control-rate seam
/// the looper UI's record/stop/overdub/clear buttons reach the engine through.
#[tauri::command]
fn looper_cmd(node: u32, action: u8, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .looper_cmd(NodeIdx(node), action)
        .map_err(|e| e.to_string())
}

/// Enable the engine's level metering so per-node + master levels start flowing
/// onto the meter return ring (drained by [`poll_meters`] for the UI's
/// signal-level stream). The frontend calls this when a signal-level subscriber
/// appears.
#[tauri::command]
fn subscribe_meters(state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .enable_metering(true);
    Ok(())
}

/// Drain the engine's pending meter frames (control-rate poll). Returns a batch
/// of `EngineFrame::Meter`s the UI maps to per-node levels. The frontend polls
/// this on a timer (or wires it to the `meters` event); a poll-shaped command
/// keeps the seam a plain request/response with no event-permission setup.
#[tauri::command]
fn poll_meters(state: tauri::State<'_, BackendState>) -> Result<Vec<EngineFrame>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .drain_meters())
}

/// Drain pending engine fault events for DevLog / diagnostics.
#[tauri::command]
fn poll_events(state: tauri::State<'_, BackendState>) -> Result<Vec<Event>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .drain_events())
}

/// Load decoded mono PCM as the sample for `node`'s sampler (content-addressed
/// into the asset catalog). `pcm` is f32 samples in `[-1, 1]` (control-rate asset
/// load, never the audio thread). Returns the stored `AssetId`.
#[tauri::command]
fn load_sample(
    node: u32,
    pcm: Vec<f32>,
    sample_rate: u32,
    root_note: u8,
    state: tauri::State<'_, BackendState>,
) -> Result<u32, String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .load_sample(NodeIdx(node), pcm, sample_rate, root_note)
        .map(|id| id.0)
        .map_err(|e| e.to_string())
}

/// Arm a recorder capture of `node`'s output bus.
#[tauri::command]
fn recorder_start(node: u32, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .recorder_start(NodeIdx(node));
    Ok(())
}

/// PCM + rate returned by `recorder_stop` for the UI to encode to a WAV blob.
#[derive(serde::Serialize)]
struct RecorderStopResult {
    pcm: Vec<f32>,
    sample_rate: u32,
}

/// Stop a recorder capture and return its captured PCM + sample rate (or null
/// when nothing was armed for `node`).
#[tauri::command]
fn recorder_stop(
    node: u32,
    state: tauri::State<'_, BackendState>,
) -> Result<Option<RecorderStopResult>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .recorder_stop(NodeIdx(node))
        .map(|(pcm, sample_rate)| RecorderStopResult { pcm, sample_rate }))
}

/// Export a node's captured recording to a WAV file at `path`.
#[tauri::command]
fn recorder_export(
    node: u32,
    path: String,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .recorder_export(NodeIdx(node), &path)
        .map_err(|e| e.to_string())
}

/// Set a speaker node's master volume / mute.
#[tauri::command]
fn set_speaker_volume(
    node: u32,
    volume: f32,
    muted: bool,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .set_speaker_volume(NodeIdx(node), volume, muted)
        .map_err(|e| e.to_string())
}

/// Route a speaker node to an output device id.
#[tauri::command]
fn set_speaker_device(
    node: u32,
    device_id: String,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .set_speaker_device(NodeIdx(node), &device_id)
        .map_err(|e| e.to_string())
}

/// Enable mic capture into `node`'s input bus.
#[tauri::command]
fn set_mic(node: u32, enabled: bool, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .set_mic(NodeIdx(node), enabled)
        .map_err(|e| e.to_string())
}

/// Snapshot the current user data before an update installs — the frontend passes
/// its exported `localStorage`; the Pi agent dir is copied natively. Best-effort:
/// a failed backup never fails the caller. Records the OUTGOING version + channel
/// so a later rollback knows its target.
#[tauri::command]
fn update_backup(
    webview_state: String,
    app: tauri::AppHandle,
    config: tauri::State<'_, updater::AutoUpdateConfig>,
) {
    let version = app.package_info().version.to_string();
    let channel = match config.0.lock().unwrap_or_else(|p| p.into_inner()).channel {
        updater::Channel::Stable => "stable",
        updater::Channel::Canary => "canary",
    };
    backup::snapshot(&app, &version, channel, &webview_state);
}

/// Restore the last-good snapshot for a rollback: copies the Pi agent dir back and
/// returns the version to pin to + the webview state for the frontend to re-import
/// (`null` when there's no snapshot). The UI then pins + turns auto-update off.
#[tauri::command]
fn update_rollback(app: tauri::AppHandle) -> Option<backup::RestoreData> {
    backup::restore(&app)
}

/// Tauri-managed holder for the `tracing` non-blocking writer's flush guard.
/// Held for the process lifetime: dropping it (on app teardown) flushes any
/// buffered NDJSON records out of the background writer. A newtype so it can be
/// `manage`d without leaking the `tracing_appender` type into command handlers.
struct LogGuard(#[allow(dead_code)] tracing_appender::non_blocking::WorkerGuard);

/// Install a process-wide panic hook that routes a host panic through the SAME
/// off-RT `tracing` channel as everything else, so the most catastrophic class
/// (a Rust panic on a control thread) is VISIBLE in the NDJSON record instead of
/// dying silently. The previous default hook (stderr only) is chained after ours
/// so a debug terminal still shows the backtrace. The audio thread never panics
/// through here — it owns the engine inside cpal and has no `tracing` dep.
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Best-effort structured capture: location + payload, no allocation on any
        // RT path (this is a control-thread panic by construction).
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic payload".to_string());
        tracing::error!(target: "panic", location = %location, payload = %payload, "host panic");
        // Chain the original hook so stderr / debugger behaviour is preserved.
        default_hook(info);
    }));
}

/// Build and run the Tauri application. Shared between the desktop binary
/// (`main.rs`) and any future mobile entry point (the Tauri convention).
///
/// `setup` constructs the native engine backend and stores it as managed state
/// so the `#[tauri::command]`s above can borrow it. Engine construction never
/// panics on a missing audio device (the headless/CI path) — it simply leaves
/// the host idle until a device is present.
pub fn run() {
    // Win + Linux get the native auto-updater plugin; macOS is compiled-off
    // (manual `.dmg` until Apple notarization — OWNER-PROVISIONING.md §4), so the
    // plugin is never registered there and the updater commands are inert.
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    // Justified panic (Phase-4 scoped panic guard): top-level app bring-up. A
    // failure to generate the Tauri context / start the event loop is a fatal
    // startup bug with no recoverable in-app fallback — there is no instrument yet
    // to keep playing — so a clear panic at the entry point is the honest outcome.
    #[allow(clippy::expect_used)]
    builder
        // Ableton-style install-after-close: if the user has auto-update on and
        // a verified update is staged, apply it silently on the way out (no
        // relaunch, no mid-session interruption). Best-effort; never blocks
        // quitting. macOS: no-op (updater compiled-off).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                updater::install_on_quit(window.app_handle());
            }
        })
        .setup(|app| {
            // Bring up the off-RT structured logging sink (human stderr + a
            // daily-rolling NDJSON file under the platform log dir) and PARK its
            // flush guard in managed state for the process lifetime — dropping the
            // guard flushes the non-blocking writer, so it must outlive `setup`.
            // The file is fed ONLY by the off-RT path (tracing call sites on the
            // control thread + this panic hook); the audio callback never touches
            // it. Best-effort: if the log dir is unavailable we skip the file sink
            // rather than fail startup.
            let mut log_dir_for_store: Option<std::path::PathBuf> = None;
            if let Ok(log_dir) = app.path().app_log_dir() {
                if std::fs::create_dir_all(&log_dir).is_ok() {
                    let guard = ojcore_native::init_logging(&log_dir);
                    app.manage(LogGuard(guard));
                    install_panic_hook();
                    log_dir_for_store = Some(log_dir);
                }
            }

            // Build the backend, then attach the L3 durable LOCAL log store
            // (SQLite/FTS5) under the same log dir. This is the queryable history
            // tail; the NDJSON file above remains the post-crash SSOT. LOCAL-ONLY,
            // fed only off the audio thread (the control-side event drain). A failed
            // open is non-fatal — the instrument keeps running without the tail.
            let backend = BackendState::new();
            if let Some(log_dir) = log_dir_for_store {
                let path = log_dir.join("openjammer-events.sqlite");
                if let Ok(mut be) = backend.0.lock() {
                    if let Err(e) = be.attach_log_store(&path) {
                        tracing::warn!(target: "engine", "log store unavailable: {e}");
                    }
                }
            }
            app.manage(backend);
            // The at-most-one warm Pi child for the session (Phase 1: instant feel).
            app.manage(ai::WarmChildState::default());
            // The loopback tool bridge (Phase 3: real graph reads round-trip to Pi).
            app.manage(bridge::BridgeState::default());
            // R2: the audio-safe update gate (the owner-enabled updater stages
            // into it; the install is refused while audio plays).
            app.manage::<updater::UpdateGateState>(std::sync::Arc::new(
                ojcore_native::UpdateGate::new(),
            ));
            // The staged-update holder the native updater downloads into before
            // the audio-idle install (Win/Linux only; macOS has no runtime updater).
            #[cfg(any(windows, target_os = "linux"))]
            app.manage(updater::PendingUpdate::default());
            // The native mirror of the auto-update preference (toggle + channel),
            // read by the install-after-close handler. Synced from the UI on mount.
            app.manage(updater::AutoUpdateConfig::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            push_graph,
            send_command,
            query_stream,
            engine_running,
            scan_plugins,
            ai::ai_run,
            ai::ai_command,
            ai::ai_prewarm,
            ai::ai_restart,
            ai::ai_set_learning,
            ai::ai_forget,
            ai::ai_sessions,
            ai::ai_session_messages,
            bridge::ai_tool_result,
            ai_faust_compile,
            ai::author_wasm_node,
            ai::author_faust_native,
            auth::auth_status,
            auth::auth_store_key,
            auth::auth_get_key,
            auth::auth_clear,
            auth::auth_begin_oauth,
            auth::auth_validate_key,
            looper_cmd,
            subscribe_meters,
            poll_meters,
            poll_events,
            load_sample,
            recorder_start,
            recorder_stop,
            recorder_export,
            set_speaker_volume,
            set_speaker_device,
            set_mic,
            updater::update_stage,
            updater::update_is_pending,
            updater::update_try_install,
            updater::update_check_and_stage,
            updater::update_install_if_idle,
            updater::update_set_config,
            updater::update_status,
            update_backup,
            update_rollback
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenJammer tauri application");
}
