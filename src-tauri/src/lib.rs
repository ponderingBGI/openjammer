//! The OpenJammer native desktop shell (Tauri v2).
//!
//! HYBRID ARCHITECTURE. The frontend is the EXISTING Vite web app (loaded into
//! the Tauri webview — `bun run dev` in development, the bundled `../dist` in a
//! release build). The backend is the native, low-latency engine module (the
//! `<5 ms` ojcore engine on a cpal stream). They talk over Tauri's `invoke`
//! IPC, which is strictly CONTROL-RATE: `OjGraph` and `RtCommand` cross as JSON;
//! no audio sample buffer ever does (governing principle #4).
//!
//! On `setup` we build the `EngineBackend` (registers the built-in
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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use engine::BackendState;
use ojhost::{PluginDescriptor, PluginEditor};
use ojproto::{EngineFrame, Event, NodeIdx, OjGraph, RtCommand, TempoMap, TimedCommand, Timeline};
use tauri::{Emitter, Manager};
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Native E2E-only crash journal mirror. The production record path remains
/// unchanged; this command is unavailable unless the harness supplies both
/// `OJ_NATIVE_E2E=1` and an isolated `OJ_NATIVE_E2E_DIR`.
fn native_e2e_dir() -> Result<PathBuf, String> {
    if std::env::var("OJ_NATIVE_E2E").as_deref() != Ok("1") {
        return Err("native e2e hooks are disabled".into());
    }
    let directory = std::env::var_os("OJ_NATIVE_E2E_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| "OJ_NATIVE_E2E_DIR is not set".to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

#[tauri::command]
fn native_e2e_process_id() -> Result<u32, String> {
    native_e2e_dir()?;
    Ok(std::process::id())
}

#[tauri::command]
fn native_e2e_reclog_begin() -> Result<String, String> {
    use std::io::Write;

    let path = native_e2e_dir()?.join("webdriver-take.reclog");
    let mut file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    // Butler's real journal wire format: M node kind at_frame payload. No stop
    // mark is written in N2 because the whole point is to kill mid-segment.
    writeln!(file, "M 0 {} 0 0", ojproto::capture_mark_kind::RECORD_START)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn native_e2e_reclog_note(note: u8, velocity: u8, on: bool) -> Result<(), String> {
    use std::io::Write;

    let path = native_e2e_dir()?.join("webdriver-take.reclog");
    let prior = std::fs::read_to_string(&path).unwrap_or_default();
    let frame = prior.lines().count().saturating_mul(256);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    let kind = if on {
        ojproto::capture_mark_kind::NOTE_ON
    } else {
        ojproto::capture_mark_kind::NOTE_OFF
    };
    let payload = u32::from(note) | (u32::from(velocity) << 8);
    writeln!(file, "M 0 {kind} {frame} {payload}").map_err(|error| error.to_string())?;
    file.sync_data().map_err(|error| error.to_string())
}

#[tauri::command]
fn native_e2e_reclog_note_count() -> Result<usize, String> {
    let path = native_e2e_dir()?.join("webdriver-take.reclog");
    let contents = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    Ok(contents
        .lines()
        .filter(|line| {
            let mut fields = line.split_whitespace();
            fields.next() == Some("M")
                && fields.nth(1).is_some_and(|kind| {
                    kind.parse::<u8>().is_ok_and(|kind| {
                        kind == ojproto::capture_mark_kind::NOTE_ON
                            || kind == ojproto::capture_mark_kind::NOTE_OFF
                    })
                })
        })
        .count())
}

/// Push a full graph from the UI: recompile it against the plugin registry and
/// adopt it into the running engine (publish to the program-swap mailbox + run).
/// `graph` is an [`OjGraph`] serialized as JSON across the IPC boundary. Returns
/// the IR node ids that degraded to a passthrough stub (a missing / incompatible
/// plugin, invariant #4a) so the UI can badge them; empty on a clean graph.
#[tauri::command]
fn push_graph(graph: OjGraph, state: tauri::State<'_, BackendState>) -> Result<Vec<u32>, String> {
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

#[tauri::command]
fn push_timeline(timeline: Timeline, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .push_timeline(&timeline)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn push_tempo_map(
    tempo_map: TempoMap,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .push_tempo_map(&tempo_map)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn send_timed_command(
    timed: TimedCommand,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .send_timed_command(timed)
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

/// Which third-party plugin hosting backend THIS build actually compiled in, plus
/// the formats it can host. The Plugins panel reads this so its empty state can be
/// honest: a fast scaffold `bun native` (backend `"none"`) can NEVER list a plugin
/// no matter what's installed, so it must say "run `bun native --all`" instead of
/// the misleading "install a plugin here and Re-scan". `"clap"` hosts CLAP only;
/// `"juce"` hosts VST3/CLAP (+ AU on macOS).
#[derive(serde::Serialize)]
struct HostingInfo {
    /// `"none" | "clap" | "juce"`.
    backend: &'static str,
    /// Format slugs this build can host, e.g. `["vst3", "clap"]`. Empty for `"none"`.
    formats: Vec<&'static str>,
}

/// Report the live hosting backend so the UI can tell "nothing installed" apart
/// from "this build can't host plugins". Pure compile-time fact — no engine lock.
#[tauri::command]
fn hosting_backend() -> HostingInfo {
    let backend = ojhost::HostingBackend::current();
    HostingInfo {
        backend: backend.slug(),
        formats: backend.formats().iter().map(|f| f.slug()).collect(),
    }
}

/// A plugin folder shown in the Plugins panel, tagged by scope + format so the UI
/// can explain exactly where VST2/VST3/CLAP/AU plugins are discovered.
#[derive(serde::Serialize)]
struct PluginDir {
    path: String,
    /// `"user"` (under the profile dir — no admin to drop a plugin in) or
    /// `"system"` (all users; usually needs admin).
    scope: &'static str,
    /// Human format tag: `"VST2"`, `"VST3"`, `"CLAP"`, or `"AU"`.
    format: &'static str,
}

/// The OS-standard plugin folders for THIS machine, tagged by scope + format. The
/// Plugins panel shows these in its empty state so the player sees the real paths
/// (and can open one with [`reveal_path`]) instead of generic cross-platform
/// examples. Per-user folders are listed first because they need no admin rights.
#[tauri::command]
fn plugin_dirs() -> Vec<PluginDir> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    let mut dirs: Vec<PluginDir> = ojhost::default_plugin_dirs()
        .into_iter()
        .filter_map(|p| {
            let format = plugin_dir_format(&p)?;
            let user = home.as_ref().is_some_and(|h| p.starts_with(h));
            Some(PluginDir {
                path: p.to_string_lossy().into_owned(),
                scope: if user { "user" } else { "system" },
                format,
            })
        })
        .collect();
    // Lead with the per-user folder, then stable by format/path.
    dirs.sort_by_key(|d| (d.scope != "user", d.format, d.path.clone()));
    dirs
}

fn plugin_dir_format(path: &std::path::Path) -> Option<&'static str> {
    let leaf = path.file_name()?.to_str()?.to_ascii_lowercase();
    if leaf == "clap" || leaf == ".clap" {
        Some("CLAP")
    } else if leaf == "vst3" || leaf == ".vst3" {
        Some("VST3")
    } else if leaf == "components" {
        Some("AU")
    } else if leaf == "vst" || leaf == ".vst" || leaf == "vst2" || leaf == "vstplugins" {
        Some("VST2")
    } else {
        None
    }
}

/// Open one of the plugin folders in the OS file manager (Explorer / Finder /
/// `xdg-open`). The path MUST be one of the known plugin dirs — we never open an
/// arbitrary path handed in from the webview. The folder is created first
/// (best-effort) so a not-yet-existing user plugin dir still opens, giving the
/// player somewhere to drop a plugin.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !ojhost::default_plugin_dirs().iter().any(|d| d == &target) {
        return Err("refusing to open a path that is not a plugin folder".into());
    }
    let _ = std::fs::create_dir_all(&target);
    open_in_file_manager(&target)
}

#[derive(Default)]
struct PluginEditorState(Mutex<HashMap<String, PluginEditor>>);

#[derive(Clone, serde::Serialize)]
struct PluginWindowShellInfo { label: String, plugin_name: String, owner: String, has_gui: bool, bypassed: bool, dirty: bool }
#[derive(Default)]
struct PluginWindowShellState(Mutex<HashMap<String, PluginWindowShellInfo>>);

#[tauri::command]
fn plugin_window_shell_open(app: tauri::AppHandle, node_id: String, project_id: String, plugin_name: String, owner: String, has_gui: bool, state: tauri::State<'_, PluginWindowShellState>) -> Result<(), String> {
    let safe = node_id.chars().map(|character| if character.is_ascii_alphanumeric() { character } else { '-' }).collect::<String>();
    let label = format!("plugin-{safe}");
    if let Some(window) = app.get_webview_window(&label) { window.set_focus().map_err(|error| error.to_string())?; return Ok(()); }
    state.0.lock().map_err(|_| "plugin window mutex poisoned".to_string())?.insert(label.clone(), PluginWindowShellInfo { label: label.clone(), plugin_name: plugin_name.clone(), owner: owner.clone(), has_gui, bypassed: false, dirty: false });
    let main = app.get_webview_window("main").ok_or_else(|| "main window is unavailable".to_string())?;
    let geometry_key = format!("{project_id}:{node_id}");
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html?plugin-window={label}&geometry={geometry_key}").into()))
        .title(format!("{plugin_name} — {owner} — OpenJammer")).inner_size(720.0, 520.0).decorations(true).parent(&main).map_err(|error| error.to_string())?.build().map_err(|error| error.to_string())?;
    Ok(())
}
#[tauri::command]
fn plugin_window_shell_info(label: String, state: tauri::State<'_, PluginWindowShellState>) -> Result<PluginWindowShellInfo, String> { state.0.lock().map_err(|_| "plugin window mutex poisoned".to_string())?.get(&label).cloned().ok_or_else(|| "plugin window metadata is unavailable".to_string()) }
#[tauri::command]
fn plugin_window_shell_close(app: tauri::AppHandle, label: String) -> Result<(), String> { app.get_webview_window(&label).ok_or_else(|| "plugin window is unavailable".to_string())?.close().map_err(|error| error.to_string()) }
#[tauri::command]
fn plugin_window_always_on_top(app: tauri::AppHandle, label: String, always_on_top: bool) -> Result<(), String> { app.get_webview_window(&label).ok_or_else(|| "plugin window is unavailable".to_string())?.set_always_on_top(always_on_top).map_err(|error| error.to_string()) }
#[tauri::command]
fn plugin_window_focus_host(app: tauri::AppHandle) -> Result<(), String> { app.get_webview_window("main").ok_or_else(|| "main window is unavailable".to_string())?.set_focus().map_err(|error| error.to_string()) }

#[derive(serde::Serialize)]
struct PluginQuarantineView {
    path: String,
    reason: String,
    crash_count: u8,
    benched: bool,
}

#[tauri::command]
fn plugin_quarantine_list() -> Vec<PluginQuarantineView> {
    let blacklist = ojhost::Blacklist::load(ojhost::default_reliability_dir().join("quarantine.tsv"));
    blacklist.entries().map(|entry| PluginQuarantineView {
        path: entry.path.clone(), reason: entry.reason.clone(), crash_count: entry.crash_count, benched: entry.benched(),
    }).collect()
}

#[tauri::command]
fn plugin_quarantine_pardon(path: String) -> Result<(), String> {
    let mut blacklist = ojhost::Blacklist::load(ojhost::default_reliability_dir().join("quarantine.tsv"));
    blacklist.pardon(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn plugin_quarantine_reset() -> Result<(), String> {
    let dir = ojhost::default_reliability_dir();
    for name in ["quarantine.tsv", "scan-cache.json"] {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

#[tauri::command]
fn plugin_editor_open(
    node_id: String,
    descriptor: PluginDescriptor,
    state: tauri::State<'_, PluginEditorState>,
) -> Result<(), String> {
    let mut editors = state
        .0
        .lock()
        .map_err(|_| "plugin editor mutex poisoned".to_string())?;
    if let Some(editor) = editors.get_mut(&node_id) {
        editor.focus();
        return Ok(());
    }
    let mut editor = PluginEditor::open(&descriptor).map_err(|e| e.to_string())?;
    editor.focus();
    editors.insert(node_id, editor);
    Ok(())
}

#[tauri::command]
fn plugin_editor_focus(
    node_id: String,
    state: tauri::State<'_, PluginEditorState>,
) -> Result<(), String> {
    let mut editors = state
        .0
        .lock()
        .map_err(|_| "plugin editor mutex poisoned".to_string())?;
    let editor = editors
        .get_mut(&node_id)
        .ok_or_else(|| "plugin editor is not open".to_string())?;
    editor.focus();
    Ok(())
}

#[tauri::command]
fn plugin_editor_close(
    node_id: String,
    state: tauri::State<'_, PluginEditorState>,
) -> Result<(), String> {
    let mut editors = state
        .0
        .lock()
        .map_err(|_| "plugin editor mutex poisoned".to_string())?;
    if let Some(mut editor) = editors.remove(&node_id) {
        editor.close();
    }
    Ok(())
}

fn close_all_plugin_editors(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<PluginEditorState>() {
        if let Ok(mut editors) = state.0.lock() {
            for (_, mut editor) in editors.drain() {
                editor.close();
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn open_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    // `explorer` returns a non-zero exit code even on success, so spawn-and-forget
    // rather than inspect the status.
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn open_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map(drop)
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(drop)
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
/// `action` (one of the `ojproto::looper_action` codes) and `arg` (layer index /
/// packed flags for the indexed actions, ignored by the transport actions). The
/// control-rate seam the looper UI's record/stop/overdub/clear/mute/delete/undo
/// controls reach the engine through.
#[tauri::command]
fn looper_cmd(
    node: u32,
    action: u8,
    arg: u32,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .looper_cmd(NodeIdx(node), action, arg)
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
    channels: u16,
    sample_rate: u32,
    root_note: u8,
    state: tauri::State<'_, BackendState>,
) -> Result<u32, String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .load_sample(NodeIdx(node), pcm, channels, sample_rate, root_note)
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

/// Retrieve the most recently finalized native capture report.
#[tauri::command]
fn get_capture_result(
    state: tauri::State<'_, BackendState>,
) -> Result<Option<ojproto::CaptureResult>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .capture_result())
}

/// One hosted plugin's saved opaque state. `node` is the IR node id; `blob` is the
/// plugin's `getStateInformation` / CLAP-state bytes. The TS layer base64's the blob
/// into `node.data` for the project file, lockfile-gated on the hosted plugin id.
#[derive(serde::Serialize, serde::Deserialize)]
struct PluginStateEntry {
    node: u32,
    blob: Vec<u8>,
}

/// SAVE every hosted plugin's opaque state (the `oj.state` save half) for a project
/// save. One entry per hosted node with non-empty state; empty device-less or with
/// no hosted plugins.
#[tauri::command]
fn save_plugin_states(
    state: tauri::State<'_, BackendState>,
) -> Result<Vec<PluginStateEntry>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .save_plugin_states()
        .into_iter()
        .map(|(node, blob)| PluginStateEntry { node, blob })
        .collect())
}

/// STAGE opaque restore blobs from a project LOAD; the next `push_graph` restores
/// each hosted plugin to its saved state (applied before the baked-in params). Call
/// BEFORE pushing the loaded graph.
#[tauri::command]
fn stage_plugin_restores(
    restores: Vec<PluginStateEntry>,
    state: tauri::State<'_, BackendState>,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .stage_plugin_restores(restores.into_iter().map(|e| (e.node, e.blob)).collect());
    Ok(())
}

/// Looper take PCM + rate returned by [`looper_take_pcm`] for the UI to build a
/// real `AudioBuffer` (true waveform + drag-to-library/export) for a committed
/// layer's row.
#[derive(serde::Serialize)]
struct LooperTakeResult {
    pcm: Vec<f32>,
    sample_rate: u32,
}

/// STAGE-3 finalize-PCM: take looper `node`'s just-COMMITTED take as MONO PCM +
/// rate. The UI calls this when it processes a commit `LooperEdge` for `node`
/// (Recording|Overdubbing→Playing), passing `loop_len` from the looper snapshot
/// it already tracks, so the off-RT per-looper capture is trimmed to the
/// committed cycle. Returns null when no stream is live / nothing was captured.
/// The bulk PCM rides this command RETURN (like `recorder_stop`), not the wire.
#[tauri::command]
fn looper_take_pcm(
    node: u32,
    loop_len: u32,
    state: tauri::State<'_, BackendState>,
) -> Result<Option<LooperTakeResult>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .take_looper_pcm(NodeIdx(node), loop_len as usize)
        .map(|(pcm, sample_rate)| LooperTakeResult { pcm, sample_rate }))
}

/// Discard looper `node`'s accumulated (uncommitted) capture — on CLEAR / undo /
/// delete with no commit — so a later take never inherits a stale tail.
#[tauri::command]
fn looper_discard_pcm(node: u32, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .discard_looper_pcm(NodeIdx(node));
    Ok(())
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

/// Progress payload emitted on `export-progress` while the blocking bounce
/// worker advances. `out_path` lets a future UI distinguish concurrent exports.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgressEvent {
    out_path: String,
    blocks_rendered: u64,
    total_blocks_estimate: u64,
}

/// Successful `export_arrangement` result. Level statistics are measured on the
/// rendered float mix before integer quantization/dither.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportArrangementResult {
    path: String,
    max_sample_peak_dbfs: f32,
    clipped_sample_count: u64,
    frames: u64,
    sample_rate: u32,
    channels: u16,
}

/// Render and encode a complete arrangement without blocking Tauri's main
/// thread. The caller-provided path is treated exactly like `recorder_export`:
/// it is a user-selected host path, while the actual write uses a crash-safe
/// same-directory temp + atomic replacement inside `ojcore-native`.
#[tauri::command]
async fn export_arrangement(
    graph: OjGraph,
    timeline: Timeline,
    tempo_map: TempoMap,
    spec: ojcore_native::BounceSpec,
    out_path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<ExportArrangementResult, String> {
    let (assets, registry) = {
        let backend = state
            .0
            .lock()
            .map_err(|_| "engine backend mutex poisoned".to_string())?;
        (backend.asset_catalog_snapshot(), backend.plugin_registry())
    };
    let event_path = out_path.clone();
    let worker_path = out_path.clone();
    let stats = tauri::async_runtime::spawn_blocking(move || {
        let registry = registry.read().unwrap_or_else(|error| error.into_inner());
        ojcore_native::bounce_to_file_with_registry_and_assets(
            graph,
            timeline,
            tempo_map,
            spec,
            &registry,
            &assets,
            &worker_path,
            |progress| {
                let _ = app.emit(
                    "export-progress",
                    ExportProgressEvent {
                        out_path: event_path.clone(),
                        blocks_rendered: progress.blocks_rendered,
                        total_blocks_estimate: progress.total_blocks_estimate,
                    },
                );
            },
        )
    })
    .await
    .map_err(|error| format!("export worker failed: {error}"))?
    .map_err(|error| error.to_string())?;

    Ok(ExportArrangementResult {
        path: out_path,
        max_sample_peak_dbfs: stats.max_sample_peak_dbfs,
        clipped_sample_count: stats.clipped_sample_count,
        frames: stats.frames,
        sample_rate: stats.sample_rate,
        channels: stats.channels,
    })
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

/// One selectable output device for the Settings device picker: its stable cpal
/// id (passed back to `set_speaker_device`) and its human-readable name.
#[derive(serde::Serialize)]
struct OutputDevice {
    id: String,
    name: String,
}

/// Enumerate the host's available OUTPUT devices for the device picker. Each
/// entry carries the stable cpal `DeviceId` string (which `set_speaker_device`
/// re-opens the stream onto) and the device's human-readable name. Off-RT: the
/// enumeration runs on the control thread (inside `ojcore_native`), never the
/// audio thread. A device-less sandbox (CI / headless) yields an empty list
/// rather than erroring — the UI degrades to "system default only".
#[tauri::command]
fn list_output_devices() -> Vec<OutputDevice> {
    ojcore_native::host::output_devices()
        .into_iter()
        .map(|(id, name)| OutputDevice { id, name })
        .collect()
}

/// DEV/TEST ONLY: arm the hosted-plugin crash boundary so the NEXT guarded
/// `processBlock` deliberately faults, letting the C++ SEH/signal latch be PROVEN on
/// a live machine — arm, then play a note through a hosted plugin: that node faults,
/// latches to a dry passthrough + crash badge, and the rest of the set plays on.
///
/// A no-op unless the app was built with `OJHOST_FAULT_INJECT=1` (env, read by
/// ojhost's build.rs; needs the default `juce` C++): in every other build —
/// including every shipped one — the fault code isn't compiled in, so this does
/// nothing and cannot crash anything. Run `OJHOST_FAULT_INJECT=1 bun native`; with
/// `withGlobalTauri`, arm it from the dev webview console:
/// `await window.__TAURI__.core.invoke('debug_arm_plugin_fault')`.
#[tauri::command]
fn debug_arm_plugin_fault() {
    ojhost::arm_fault();
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
    // The native auto-updater plugin is registered on Win + Linux, and on macOS
    // once the build is notarized (the `apple-notarized` feature — see
    // OWNER-PROVISIONING.md §4). A non-notarized macOS build ships a manual `.dmg`
    // and leaves the updater commands inert.
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(any(
        windows,
        target_os = "linux",
        all(target_os = "macos", feature = "apple-notarized")
    ))]
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
        // quitting. macOS: no-op until the build is notarized.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                close_all_plugin_editors(window.app_handle());
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
            // Record the compiled-in hosting backend at startup, so a log always
            // names whether this run can host plugins at all (a scaffold `bun
            // native` reports `"none"`) — the first thing to check when "my VSTs
            // don't show up" turns out to be "this build never had a host".
            tracing::info!(
                target: "engine",
                backend = ojhost::HostingBackend::current().slug(),
                "plugin hosting backend"
            );
            if let Some(log_dir) = log_dir_for_store {
                let path = log_dir.join("openjammer-events.sqlite");
                if let Ok(mut be) = backend.0.lock() {
                    if let Err(e) = be.attach_log_store(&path) {
                        tracing::warn!(target: "engine", "log store unavailable: {e}");
                    }
                }
            }
            app.manage(backend);
            app.manage(PluginEditorState::default());
            app.manage(PluginWindowShellState::default());
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
            // the audio-idle install (Win/Linux, and macOS when notarized).
            #[cfg(any(
                windows,
                target_os = "linux",
                all(target_os = "macos", feature = "apple-notarized")
            ))]
            app.manage(updater::PendingUpdate::default());
            // The native mirror of the auto-update preference (toggle + channel),
            // read by the install-after-close handler. Synced from the UI on mount.
            app.manage(updater::AutoUpdateConfig::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            push_graph,
            send_command,
            push_timeline,
            push_tempo_map,
            send_timed_command,
            query_stream,
            engine_running,
            scan_plugins,
            hosting_backend,
            plugin_dirs,
            reveal_path,
            plugin_quarantine_reset,
            plugin_quarantine_list,
            plugin_quarantine_pardon,
            plugin_editor_open,
            plugin_editor_focus,
            plugin_editor_close,
            plugin_window_shell_open,
            plugin_window_shell_info,
            plugin_window_shell_close,
            plugin_window_always_on_top,
            plugin_window_focus_host,
            ai::ai_run,
            ai::ai_command,
            ai::ai_prewarm,
            ai::ai_restart,
            ai::ai_set_learning,
            ai::ai_get_learning,
            ai::ai_forget,
            ai::ai_sessions,
            ai::ai_session_messages,
            bridge::ai_tool_result,
            ai_faust_compile,
            ai::author_wasm_node,
            ai::author_faust_native,
            ai::ai_save_self_package,
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
            save_plugin_states,
            stage_plugin_restores,
            recorder_start,
            recorder_stop,
            get_capture_result,
            looper_take_pcm,
            looper_discard_pcm,
            recorder_export,
            export_arrangement,
            native_e2e_process_id,
            native_e2e_reclog_begin,
            native_e2e_reclog_note,
            native_e2e_reclog_note_count,
            set_speaker_volume,
            set_speaker_device,
            set_mic,
            list_output_devices,
            debug_arm_plugin_fault,
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
