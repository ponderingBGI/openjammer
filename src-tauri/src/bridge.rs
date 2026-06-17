//! Loopback tool bridge (Phase 3) — gives Pi's `pi-openjammer-graph` extension a
//! way to round-trip READ tools (`get_graph` / `find_nodes` / `list_node_types` /
//! `validate_plan`) back to the app and receive the REAL graph state, so the agent
//! reasons on ground truth instead of a guess.
//!
//! WRITE verbs are NOT applied here: they already apply through the streamed
//! `tool_execution_start` → `tool-call` → `applyToolCall` path (with undo / single
//! Approve-Reject / collab-guard intact), so the bridge only ACKs them. That split
//! is what avoids a double-apply without touching the verified mutation machinery.
//!
//! Protocol — one JSON line each over a loopback TCP socket the host owns:
//! the extension sends `{"token","name","args"}\n`; the host relays it to the
//! frontend (a `oj-bridge-call` Tauri event the UI answers via `ai_tool_result`)
//! and writes back the frontend's `{"ok","data"}\n`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// Shared bridge internals (behind an `Arc` so the accept thread and the
/// `ai_tool_result` command both reach the pending table).
struct BridgeInner {
    /// A per-session secret the extension must present (loopback is local, but a
    /// token still stops any other local process from driving the bridge).
    token: String,
    /// In-flight calls awaiting the frontend's result, keyed by request id.
    pending: Mutex<HashMap<u64, Sender<serde_json::Value>>>,
    next_id: AtomicU64,
}

/// Tauri-managed bridge state: the loopback address (once started) + the shared
/// internals. At most one listener per app session, started lazily on first use.
pub struct BridgeState {
    inner: Arc<BridgeInner>,
    addr: Mutex<Option<String>>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            inner: Arc::new(BridgeInner {
                token: session_token(),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
            }),
            addr: Mutex::new(None),
        }
    }
}

/// Start the loopback listener if it isn't already, returning `(addr, token)` to
/// hand to the Pi child via env. `None` only if binding the local socket fails.
pub fn ensure_started(app: &AppHandle, state: &BridgeState) -> Option<(String, String)> {
    let mut addr_guard = state.addr.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(addr) = addr_guard.as_ref() {
        return Some((addr.clone(), state.inner.token.clone()));
    }
    let listener = TcpListener::bind("127.0.0.1:0").ok()?;
    let addr = listener.local_addr().ok()?.to_string();
    *addr_guard = Some(addr.clone());

    let inner = state.inner.clone();
    let app = app.clone();
    std::thread::spawn(move || accept_loop(listener, inner, app));
    Some((addr, state.inner.token.clone()))
}

fn accept_loop(listener: TcpListener, inner: Arc<BridgeInner>, app: AppHandle) {
    for stream in listener.incoming().flatten() {
        let inner = inner.clone();
        let app = app.clone();
        std::thread::spawn(move || handle_conn(stream, inner, app));
    }
}

fn handle_conn(stream: TcpStream, inner: Arc<BridgeInner>, app: AppHandle) {
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    let mut writer = stream;

    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let req: serde_json::Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => {
            let _ = writeln!(writer, "{}", err_line("malformed request"));
            return;
        }
    };
    if req.get("token").and_then(|v| v.as_str()) != Some(inner.token.as_str()) {
        let _ = writeln!(writer, "{}", err_line("bad token"));
        return;
    }

    let name = req.get("name").and_then(|v| v.as_str()).unwrap_or_default();
    let args = req.get("args").cloned().unwrap_or_else(|| serde_json::json!({}));
    let req_id = inner.next_id.fetch_add(1, Ordering::SeqCst);

    let (tx, rx) = channel();
    inner
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(req_id, tx);

    // Relay to the frontend, which answers via `ai_tool_result`.
    let _ = app.emit(
        "oj-bridge-call",
        serde_json::json!({ "reqId": req_id, "name": name, "args": args }),
    );

    let resp = match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(v) => v,
        Err(_) => {
            inner
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&req_id);
            err_line("the OpenJammer host did not answer in time")
        }
    };
    let _ = writeln!(writer, "{}", resp);
}

fn err_line(msg: &str) -> serde_json::Value {
    serde_json::json!({ "ok": false, "error": msg })
}

/// A per-session token (pid + nanos — local-only, just to fence off other local
/// processes; not a cryptographic secret).
fn session_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
}

/// The frontend's answer to a relayed bridge call (Phase 3). `result` is the
/// `{ ok, data }` the UI computed (real read data, or a write ack); it unblocks
/// the waiting bridge connection so it can reply to Pi.
#[tauri::command]
pub fn ai_tool_result(
    req_id: u64,
    result: serde_json::Value,
    bridge: tauri::State<'_, BridgeState>,
) -> Result<(), String> {
    if let Some(tx) = bridge
        .inner
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&req_id)
    {
        let _ = tx.send(result);
    }
    Ok(())
}
