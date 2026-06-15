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

mod engine;

use engine::BackendState;
use ojproto::{OjGraph, RtCommand};
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

/// Build and run the Tauri application. Shared between the desktop binary
/// (`main.rs`) and any future mobile entry point (the Tauri convention).
///
/// `setup` constructs the native engine backend and stores it as managed state
/// so the `#[tauri::command]`s above can borrow it. Engine construction never
/// panics on a missing audio device (the headless/CI path) — it simply leaves
/// the host idle until a device is present.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(BackendState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            push_graph,
            send_command,
            query_stream,
            engine_running
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenJammer tauri application");
}
