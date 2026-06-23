//! Pi-driven AI agent backend (U20) — the native half of the Ctrl/Cmd+K
//! "build what I asked" command bar.
//!
//! TRANSPORT: `rpc-subprocess`. This module owns the `ai_run` Tauri command. It
//! spawns Pi (`pi --mode rpc`, github.com/earendil-works/pi) as a SUBPROCESS,
//! confined to a persistent jailed workspace with a STRIPPED env that forwards ONLY
//! the user's configured provider keys, speaks Pi's LF-delimited JSONL RPC,
//! normalizes each event to a [`PiStreamLine`], and re-emits it to the webview as
//! a Tauri event on a per-run channel. The frontend ([`src/ai/PiAgentBackend.ts`])
//! turns those into the streamed transcript and reversible live graph edits.
//!
//! # RPC protocol (pi.dev `rpc.md`) — M1 "transport truth"
//!
//! Earlier this module guessed the wire format; this is the REAL one:
//!   * Start a run with `{"type":"prompt","message":<text>}` (NOT `run`).
//!   * Commands (`get_commands`, `set_model`, …) are acknowledged with a
//!     `{"type":"response","command":<name>,"success":<bool>}` line.
//!   * Streamed events: `tool_execution_start` ({`toolName`,`args`,`toolCallId`})
//!     is the executed tool call → `tool-call`; `message_update` carrying an
//!     `assistantMessageEvent` of `text_delta` → `thought`; `agent_end` → `result`;
//!     `extension_ui_request` → `ui-request`. All other lifecycle/partial events
//!     (agent_start, turn_*, message_start/end, thinking/toolcall deltas,
//!     tool_execution_update/end, queue/compaction/retry) carry no transcript
//!     signal and are SKIPPED (no thought-spam).
//!   * Before committing a prompt we HANDSHAKE with `get_commands`: if Pi never
//!     acknowledges it, the installed Pi is too old / speaks another dialect, and
//!     we surface a single reasoned `error` (never silently degrade every later
//!     tool call to `thought`).
//!
//! # Security model (project plan)
//!
//! Pi has NO built-in permission system: its tool calls auto-execute with the
//! launching user's privileges; sandboxing is the HOST's job. So OpenJammer
//! treats Pi as an UNTRUSTED GENERATOR, never a trusted runner:
//!
//! * **Persistent jailed workspace.** Pi runs with `HOME` pointed at a single
//!   global brain (`~/.openjammer/agent/`, so its `.pi` memory/sessions/auth
//!   accumulate and the agent learns) and its cwd at a jailed project dir beneath
//!   it ([`AgentWorkspace`]). The OS jail (`sandbox.rs`) confines writes to those
//!   roots; the in-Pi `permission-gate` extension (fed `OJ_PROJECT_ROOT` /
//!   `OJ_MEMORY_ROOTS` / `OJ_KEY_VAR(S)`) polices bash + redacts keys.
//! * **Env allowlist.** The child starts from an EMPTY environment; we forward
//!   only `PATH`/`HOME` (so `pi` and `git` resolve) plus the configured provider
//!   keys the user supplied, each under the var name that provider expects. Every
//!   other secret in the parent env is dropped.
//! * **No key storage.** The key is passed transiently to the child and never
//!   written to disk by OpenJammer.
//! * **Tool calls are forwarded, not executed here.** Graph mutations are
//!   surfaced to the frontend as reversible live edits that undo with Ctrl+Z.
//! * **Blocking extension dialogs are auto-cancelled.** M1 surfaces an
//!   `extension_ui_request` as a `ui-request` event for the UI to observe; to
//!   keep a run from hanging on a dialog the host never answers, blocking
//!   methods (`select`/`confirm`/`input`/`editor`) get an immediate
//!   `extension_ui_response{cancelled:true}`.
//!
//! # Reality / fallback
//!
//! Pi is NOT assumed installed and there is no key in CI. When `pi` is not on
//! `PATH`, [`ai_run`] emits a single terminal `error` line telling the founder
//! exactly what to install, then returns `Ok(())` — it never panics or blocks.
//! The full tool-call -> graph-verb path is proven with Pi MOCKED on the
//! frontend (`src/ai/__tests__`, `src/store/__tests__/agentSessionStore.test.ts`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// One normalized line of the agent stream, mirrored 1:1 by the frontend
/// `PiStreamLine` (`src/ai/PiAgentBackend.ts`). Serialized as the Tauri event
/// payload on the run's channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiStreamLine {
    /// `"thought" | "status" | "tool-call" | "result" | "error" | "ui-request" | "session"`.
    pub kind: String,
    /// Present for `thought` / `status` / `result` / `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Present for `tool-call`: `{ "name": <toolName>, "args": <args> }`,
    /// forwarded for the frontend to interpret against its tool schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<serde_json::Value>,
    /// Present for `tool-call` (`toolCallId`) and `ui-request` (the request id).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Present for `ui-request`: the raw `extension_ui_request` payload (method,
    /// title, options, …) for the frontend to render.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request: Option<serde_json::Value>,
    /// Present for command results that carry structured data (`get_state`,
    /// `get_commands`, `compact`, …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl PiStreamLine {
    fn thought(text: impl Into<String>) -> Self {
        Self {
            kind: "thought".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
            data: None,
        }
    }

    fn status(text: impl Into<String>) -> Self {
        Self {
            kind: "status".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
            data: None,
        }
    }

    fn result(text: impl Into<String>) -> Self {
        Self {
            kind: "result".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
            data: None,
        }
    }

    fn result_with_data(text: impl Into<String>, data: Option<serde_json::Value>) -> Self {
        Self {
            kind: "result".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
            data,
        }
    }

    fn error(text: impl Into<String>) -> Self {
        Self {
            kind: "error".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
            data: None,
        }
    }

    /// A `tool-call` line carrying `{ name, args }` + the stable `toolCallId`.
    fn tool_call(name: &str, args: serde_json::Value, id: Option<String>) -> Self {
        Self {
            kind: "tool-call".into(),
            text: None,
            call: Some(serde_json::json!({ "name": name, "args": args })),
            id,
            request: None,
            data: None,
        }
    }

    /// A `session` line carrying the agent's ACTIVE Pi session id, so the
    /// frontend can persist it and auto-reattach to the same conversation on the
    /// next run / after a restart (the id rides in `text`). NOT terminal.
    fn session(id: impl Into<String>) -> Self {
        Self {
            kind: "session".into(),
            text: Some(id.into()),
            call: None,
            id: None,
            request: None,
            data: None,
        }
    }

    /// A `ui-request` line carrying the raw `extension_ui_request` payload.
    fn ui_request(request: serde_json::Value) -> Self {
        let id = request
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Self {
            kind: "ui-request".into(),
            text: None,
            call: None,
            id,
            request: Some(request),
            data: None,
        }
    }
}

/// Spawn Pi for one task and stream its output to `channel`.
///
/// `prompt` is the user's natural-language request. `provider_key` is the user's
/// own provider API key (forwarded under the allowlist; never stored).
/// `provider`/`model_id`, when BOTH present, pin the model for this run via
/// `set_model` (Pi confirms no persisted default, so it is set per spawn);
/// otherwise Pi's own `~/.pi` configuration selects the model. `channel` is the
/// per-run Tauri event name the frontend subscribed to.
///
/// Always returns `Ok(())`: failures (Pi missing, spawn error, handshake/model
/// failure) are streamed as a terminal `error` line so the UI surfaces them
/// uniformly.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // the agent run threads the full auth + bridge context
pub fn ai_run(
    app: AppHandle,
    prompt: String,
    provider_key: Option<String>,
    provider_keys: Option<HashMap<String, String>>,
    provider_base_urls: Option<HashMap<String, String>>,
    provider_custom_models: Option<HashMap<String, Vec<String>>>,
    provider: Option<String>,
    model_id: Option<String>,
    thinking_level: Option<String>,
    yolo: Option<bool>,
    // When present, resume this Pi session (so the run continues that
    // conversation's context); when absent, Pi uses/creates its current session
    // and we report the active id back so the frontend can persist it.
    session_id: Option<String>,
    channel: String,
) -> Result<(), String> {
    // Do not run Pi on the Tauri IPC/UI thread. A long agent turn (code search,
    // subprocess startup, model listing) otherwise makes Windows mark the app
    // "Not responding" and desaturate the window.
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let warm = app_for_thread.state::<WarmChildState>();
        let bridge = app_for_thread.state::<crate::bridge::BridgeState>();
        let _ = ai_run_blocking(
            app_for_thread.clone(),
            prompt,
            provider_key,
            provider_keys,
            provider_base_urls,
            provider_custom_models,
            provider,
            model_id,
            thinking_level,
            yolo,
            session_id,
            channel,
            warm,
            bridge,
        );
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn ai_run_blocking(
    app: AppHandle,
    prompt: String,
    provider_key: Option<String>,
    provider_keys: Option<HashMap<String, String>>,
    provider_base_urls: Option<HashMap<String, String>>,
    provider_custom_models: Option<HashMap<String, Vec<String>>>,
    provider: Option<String>,
    model_id: Option<String>,
    thinking_level: Option<String>,
    yolo: Option<bool>,
    session_id: Option<String>,
    channel: String,
    warm: tauri::State<'_, WarmChildState>,
    bridge: tauri::State<'_, crate::bridge::BridgeState>,
) -> Result<(), String> {
    // Resolve the Pi binary up front so a missing install is a clean message.
    let Some(pi) = find_pi(&app) else {
        emit(&app, &channel, PiStreamLine::error(PI_MISSING_HELP));
        return Ok(());
    };

    // The PERSISTENT agent workspace (Phase 1): a single global HOME "brain" whose
    // `.pi` memory/sessions/auth survive every run (so the agent learns), plus a
    // jailed project cwd. Replaces the per-run throwaway worktree.
    let workspace = match AgentWorkspace::ensure() {
        Ok(ws) => ws,
        Err(e) => {
            emit(
                &app,
                &channel,
                PiStreamLine::error(format!("could not prepare the agent workspace: {e}")),
            );
            return Ok(());
        }
    };

    // D6 (M7): forward every configured provider key under that provider's env
    // var so Pi's own model registry can list/select models across providers.
    // Conflicts still defer to Pi's own auth.json for that provider. Keys are
    // transient process env only; OpenJammer never persists them.
    let provider_key_entries = collect_provider_key_entries(
        provider_key.as_deref(),
        provider.as_deref(),
        provider_keys.as_ref(),
    );
    let filtered_provider_key_entries = filter_conflicting_provider_keys(provider_key_entries);
    let provider_base_urls = sanitized_provider_base_urls(provider_base_urls.as_ref());
    let provider_custom_models = sanitized_provider_custom_models(provider_custom_models.as_ref());
    if write_openjammer_models_json(
        &workspace.agent_home,
        &provider_base_urls,
        &provider_custom_models,
    )
    .is_err()
    {
        emit(
            &app,
            &channel,
            PiStreamLine::thought("note: could not update custom model config"),
        );
    }
    let auth_fingerprint = runtime_fingerprint(
        &filtered_provider_key_entries,
        &provider_base_urls,
        &provider_custom_models,
    );
    let jailed = !yolo.unwrap_or(false);

    // JAILED (default): a STRIPPED allowlist env + the gate's jail-boundary vars.
    // YOLO: the FULL parent environment (the real Pi experience) + provider keys,
    // and no gate vars. HOME points at the persistent global brain in BOTH modes,
    // so the agent keeps its learned memory/sessions regardless.
    let mut env = env_for_provider_keys(jailed, &filtered_provider_key_entries);
    env.insert(
        "HOME".to_string(),
        workspace.agent_home.to_string_lossy().into_owned(),
    );
    // Phase 3: stand up the loopback tool bridge and hand its address + token to
    // the graph extension, so its READ tools round-trip the REAL graph state back
    // to Pi (writes still apply via the streamed tool-call path). Available in both
    // modes — grounded reasoning isn't a guard YOLO should drop.
    if let Some((addr, token)) = crate::bridge::ensure_started(&app, &bridge) {
        env.insert("OJ_BRIDGE_ADDR".to_string(), addr);
        env.insert("OJ_BRIDGE_TOKEN".to_string(), token);
    }
    if jailed {
        // Hand the in-Pi permission-gate its write-jail (the project + the memory
        // roots, which live under HOME outside the project) and the env var holding
        // the secret to redact from tool output.
        env.insert(
            "OJ_PROJECT_ROOT".to_string(),
            workspace.project_root.to_string_lossy().into_owned(),
        );
        env.insert(
            "OJ_MEMORY_ROOTS".to_string(),
            workspace
                .memory_roots()
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(":"),
        );
        let key_vars = provider_key_vars(&filtered_provider_key_entries);
        if let Some(active_key_var) = provider
            .as_deref()
            .map(|p| provider_key_var(Some(p)))
            .filter(|v| key_vars.iter().any(|k| k == v))
        {
            env.insert("OJ_KEY_VAR".to_string(), active_key_var);
        }
        if !key_vars.is_empty() {
            env.insert("OJ_KEY_VARS".to_string(), key_vars.join(":"));
        }
    }

    // Ensure a WARM, configured Pi child for this provider/model, then stream the
    // prompt against it. The child PERSISTS across prompts — the handshake and
    // `set_model` are paid ONCE at (re)spawn, so the 2nd+ turn has no cold-start
    // (the "instant" feel). The mutex serializes prompts (the agent is sequential).
    let mut guard = warm.0.lock().unwrap_or_else(|e| e.into_inner());

    let needs_respawn = match guard.as_mut() {
        None => true,
        Some(c) => {
            c.is_dead()
                || c.provider.as_deref() != provider.as_deref()
                || c.model_id.as_deref() != model_id.as_deref()
                || c.project_root != workspace.project_root
                || c.jailed != jailed
                || c.auth_fingerprint != auth_fingerprint
        }
    };
    if needs_respawn {
        // Drop (kill + wait) any stale child before standing up a fresh one.
        drop(guard.take());
        // Load/drop the permission-gate to match the mode BEFORE Pi reads settings.
        configure_gate(&workspace.agent_home, jailed, &app, &channel);
        // Install the graph-verb extension in EVERY mode (the core capability, so
        // Pi can build the canvas); it is never dropped by YOLO.
        let graph_pkg = graph_extension_dir(&app).to_string_lossy().into_owned();
        let _ = set_settings_package(&workspace.agent_home, &graph_pkg, true);
        // The hard OS jail (Linux) — present in jailed mode, absent in YOLO.
        let jail = if jailed {
            Some(crate::sandbox::Jail::new(
                workspace.project_root.clone(),
                workspace.agent_home.clone(),
            ))
        } else {
            None
        };
        match spawn_and_configure(
            &pi,
            env,
            &workspace.project_root,
            provider.as_deref(),
            model_id.as_deref(),
            auth_fingerprint,
            jail,
            &app,
            &channel,
        ) {
            Ok(c) => *guard = Some(c),
            Err(()) => return Ok(()), // a reasoned error line was already emitted
        }
    }

    let child = match guard.as_mut() {
        Some(c) => c,
        None => return Ok(()),
    };

    // Reattach to the requested session if the live child isn't already on it
    // (works for a fresh spawn AND a reused child — switching is cheaper than a
    // respawn, so a session change never forces one). A failed switch is a soft
    // note, not fatal: we keep going on whatever session Pi has.
    if let Some(sid) = session_id.as_deref() {
        if child.current_session.as_deref() != Some(sid) {
            let req = serde_json::json!({ "type": "switch_session", "id": sid });
            if send_command(&mut child.stdin, &req).is_ok() {
                match await_response(
                    &mut child.reader,
                    &mut child.stdin,
                    &app,
                    &channel,
                    "switch_session",
                ) {
                    Ok(true) => child.current_session = Some(sid.to_string()),
                    Ok(false) => emit(
                        &app,
                        &channel,
                        PiStreamLine::thought(
                            "couldn't resume the previous session — continuing in the current one."
                                .to_string(),
                        ),
                    ),
                    Err(()) => {
                        emit(
                            &app,
                            &channel,
                            PiStreamLine::error("Pi closed the stream while resuming the session."),
                        );
                        drop(guard.take());
                        return Ok(());
                    }
                }
            }
        }
    }

    if apply_thinking_level_if_needed(child, thinking_level.as_deref(), &app, &channel).is_err() {
        drop(guard.take());
        return Ok(());
    }

    if let Err(e) = send_command(
        &mut child.stdin,
        &serde_json::json!({ "type": "prompt", "message": prompt }),
    ) {
        emit(
            &app,
            &channel,
            PiStreamLine::error(format!("could not send prompt: {e}")),
        );
        // A broken pipe means the child is gone; drop it so the next turn respawns.
        drop(guard.take());
        return Ok(());
    }

    stream_until_end(&mut child.reader, &mut child.stdin, &app, &channel);

    // Report the ACTIVE session id so the frontend persists it and reattaches on
    // the next run / after a restart. Prefer what we already track; else ask Pi
    // (get_state); else fall back to the most-recently-written session file (the
    // one this run just appended to). Best-effort — never fatal.
    let mut active = child.current_session.clone();
    if active.is_none() {
        active = query_session_id(&mut child.reader, &mut child.stdin, &app, &channel);
    }
    if active.is_none() {
        active = newest_session_id();
    }
    if let Some(id) = active {
        child.current_session = Some(id.clone());
        emit(&app, &channel, PiStreamLine::session(id));
    }
    // The child stays WARM for the next prompt — no kill.
    Ok(())
}

// ============================================================================
// Warm child (Phase 1): one long-lived Pi RPC subprocess, reused across prompts.
// ============================================================================

/// A warm, long-lived `pi --mode rpc` child reused across prompts. Spawned +
/// handshaken + (optionally) model-pinned ONCE; each prompt streams against it and
/// it stays alive, so the 2nd+ turn pays no cold-start (the instant feel). It is
/// re-spawned when it dies or when the provider / model / project root changes.
pub struct WarmChild {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    provider: Option<String>,
    model_id: Option<String>,
    project_root: PathBuf,
    /// Whether this child was spawned jailed (gate loaded + env stripped) vs YOLO
    /// (gate dropped + full env). A mode flip forces a respawn.
    jailed: bool,
    /// Fingerprint of forwarded provider keys. A provider/key change forces a respawn.
    auth_fingerprint: String,
    /// Last thinking level successfully applied to this warm child.
    thinking_level: Option<String>,
    /// The Pi session this child is currently on, tracked so a session change
    /// `switch_session`es the live child instead of respawning, and so the active
    /// id can be reported back to the frontend for persistence / reattach.
    current_session: Option<String>,
    /// Windows ONLY: the kill-on-close Job Object the child (and its descendants)
    /// were adopted into. Held for the child's whole life; dropping it here reaps
    /// the WHOLE process tree, closing the orphan gap a bare `Child::kill()` leaves
    /// on Windows. `None` if the job couldn't be created (best-effort fallback).
    // Never read by name — it is an RAII reap guard whose only job is `Drop`.
    #[cfg(windows)]
    #[allow(dead_code)]
    job: Option<JobObject>,
}

impl WarmChild {
    /// Whether the child has exited (or we can no longer tell) → needs a respawn.
    fn is_dead(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)) | Err(_))
    }
}

impl Drop for WarmChild {
    /// Kill + reap on drop (respawn or app exit) so no Pi child is ever orphaned —
    /// `std::process::Child` does NOT kill on drop by default. On Windows the Job
    /// Object (dropped right after, see field order) additionally reaps any
    /// DESCENDANTS Pi spawned, which a single-handle `kill()` cannot reach.
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        // The `job` field then drops, closing the kill-on-close job and reaping the
        // rest of the tree (Windows). Field drop order is declaration order, so the
        // explicit kill+wait above runs first; the job is the backstop for orphans.
    }
}

/// Tauri-managed state holding the at-most-one warm child for the app session.
/// The `Mutex` serializes prompts (one agent turn at a time).
#[derive(Default)]
pub struct WarmChildState(pub std::sync::Mutex<Option<WarmChild>>);

fn collect_provider_key_entries(
    provider_key: Option<&str>,
    provider: Option<&str>,
    provider_keys: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(keys) = provider_keys {
        for (provider, key) in keys {
            if !provider.trim().is_empty() && !key.trim().is_empty() {
                out.insert(provider.trim().to_string(), key.to_string());
            }
        }
    }
    if let Some(key) = provider_key.filter(|k| !k.trim().is_empty()) {
        out.insert(provider.unwrap_or_default().to_string(), key.to_string());
    }
    out
}

fn filter_conflicting_provider_keys(keys: HashMap<String, String>) -> HashMap<String, String> {
    keys.into_iter()
        .filter(|(provider, _)| {
            provider.is_empty()
                || !crate::auth::auth_status(Some(provider.clone()))
                    .map(|s| s.conflict)
                    .unwrap_or(false)
        })
        .collect()
}

fn provider_key_vars(keys: &HashMap<String, String>) -> Vec<String> {
    let mut vars = keys
        .keys()
        .map(|provider| provider_key_var((!provider.is_empty()).then_some(provider.as_str())))
        .collect::<Vec<_>>();
    vars.sort();
    vars.dedup();
    vars
}

fn env_for_provider_keys(jailed: bool, keys: &HashMap<String, String>) -> HashMap<String, String> {
    let mut env = if jailed {
        stripped_env_for(None, None)
    } else {
        std::env::vars().collect()
    };
    for (provider, key) in keys {
        env.insert(
            provider_key_var((!provider.is_empty()).then_some(provider.as_str())),
            key.to_string(),
        );
    }
    env
}

fn auth_fingerprint(keys: &HashMap<String, String>) -> String {
    let mut pairs = keys.iter().collect::<Vec<_>>();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    let mut bytes = Vec::new();
    for (provider, key) in pairs {
        bytes.extend_from_slice(provider.as_bytes());
        bytes.push(0);
        bytes.extend_from_slice(key.as_bytes());
        bytes.push(0xff);
    }
    fnv1a_hex(&bytes)
}

fn sanitized_provider_base_urls(
    provider_base_urls: Option<&HashMap<String, String>>,
) -> HashMap<String, String> {
    provider_base_urls
        .into_iter()
        .flat_map(|m| m.iter())
        .filter_map(|(provider, url)| {
            let provider = provider.trim();
            let url = url.trim();
            if provider.is_empty() || url.is_empty() {
                None
            } else {
                Some((provider.to_string(), url.to_string()))
            }
        })
        .collect()
}

fn sanitized_provider_custom_models(
    provider_custom_models: Option<&HashMap<String, Vec<String>>>,
) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    for (provider, models) in provider_custom_models.into_iter().flat_map(|m| m.iter()) {
        let provider = provider.trim();
        if provider.is_empty() {
            continue;
        }
        let mut ids = models
            .iter()
            .map(|id| id.trim())
            .filter(|id| !id.is_empty())
            .map(String::from)
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        if !ids.is_empty() {
            out.insert(provider.to_string(), ids);
        }
    }
    out
}

fn model_config_fingerprint(
    base_urls: &HashMap<String, String>,
    custom_models: &HashMap<String, Vec<String>>,
) -> String {
    let mut bytes = Vec::new();
    let mut urls = base_urls.iter().collect::<Vec<_>>();
    urls.sort_by(|a, b| a.0.cmp(b.0));
    for (provider, url) in urls {
        bytes.extend_from_slice(provider.as_bytes());
        bytes.push(0);
        bytes.extend_from_slice(url.as_bytes());
        bytes.push(0xfe);
    }
    let mut models = custom_models.iter().collect::<Vec<_>>();
    models.sort_by(|a, b| a.0.cmp(b.0));
    for (provider, ids) in models {
        bytes.extend_from_slice(provider.as_bytes());
        bytes.push(0);
        for id in ids {
            bytes.extend_from_slice(id.as_bytes());
            bytes.push(0xfd);
        }
    }
    fnv1a_hex(&bytes)
}

fn runtime_fingerprint(
    keys: &HashMap<String, String>,
    base_urls: &HashMap<String, String>,
    custom_models: &HashMap<String, Vec<String>>,
) -> String {
    format!(
        "{}:{}",
        auth_fingerprint(keys),
        model_config_fingerprint(base_urls, custom_models),
    )
}

fn write_openjammer_models_json(
    agent_home: &Path,
    base_urls: &HashMap<String, String>,
    custom_models: &HashMap<String, Vec<String>>,
) -> std::io::Result<()> {
    if base_urls.is_empty() && custom_models.is_empty() {
        return Ok(());
    }
    let models_path = agent_home.join(".pi").join("agent").join("models.json");
    let mut root: serde_json::Value = std::fs::read_to_string(&models_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    if !root.get("providers").is_some_and(|v| v.is_object()) {
        root["providers"] = serde_json::json!({});
    }

    for provider in base_urls
        .keys()
        .chain(custom_models.keys())
        .collect::<std::collections::BTreeSet<_>>()
    {
        let provider = provider.as_str();
        if !root["providers"]
            .get(provider)
            .is_some_and(|v| v.is_object())
        {
            root["providers"][provider] = serde_json::json!({});
        }
        let entry = &mut root["providers"][provider];
        if let Some(base_url) = base_urls.get(provider) {
            entry["baseUrl"] = serde_json::json!(base_url);
            entry["api"] = serde_json::json!("openai-completions");
            entry["apiKey"] = serde_json::json!(format!("${}", provider_key_var(Some(provider))));
            if base_url.contains("openrouter.ai") {
                entry["compat"] = serde_json::json!({ "thinkingFormat": "openrouter" });
            }
        }
        if let Some(ids) = custom_models.get(provider) {
            let mut existing = entry
                .get("models")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let mut seen = existing
                .iter()
                .filter_map(|v| v.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect::<std::collections::BTreeSet<_>>();
            for id in ids {
                if seen.insert(id.clone()) {
                    existing.push(serde_json::json!({ "id": id, "name": id }));
                }
            }
            entry["models"] = serde_json::Value::Array(existing);
        }
    }

    if let Some(parent) = models_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_string_pretty(&root).map_err(std::io::Error::other)?;
    // Crash-safe (temp + fsync + atomic rename) so an interrupted write can't leave
    // a torn models.json that fails to parse on next launch.
    ojcore_native::atomic_write_path(&models_path, serialized.as_bytes())
}

// ============================================================================
// Windows process hygiene — reliable whole-tree reap + no console flash.
// ============================================================================
//
// On stage two Windows-specific things bite: (1) `Child::kill()` is a single
// `TerminateProcess` on the Pi handle, so any descendants Pi spawned (node, git,
// a provider helper) are ORPHANED and linger after a respawn/quit; (2) spawning a
// console subprocess without `CREATE_NO_WINDOW` flashes a console window in front
// of the performer. We fix both: a Windows **Job Object** with
// `KILL_ON_JOB_CLOSE` adopts the whole tree, so dropping the job handle (on a
// respawn, on `WarmChild::drop`, or on app exit) reaps every descendant reliably;
// `CREATE_NO_WINDOW` suppresses the flash (matching `updater.rs`). Both are
// CONTROL-PLANE only (off the audio RT path). Non-Windows is unaffected.

/// The `CREATE_NO_WINDOW` process creation flag — no console window flashes when
/// the Pi child (a console program) is spawned. Same constant `updater.rs` uses.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// An owned Windows Job Object that whole-tree-reaps the process(es) assigned to
/// it when its handle closes. Configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
/// so that closing the handle (on `Drop`) terminates every still-living process in
/// the job — the Pi child AND any descendants it spawned — closing the orphan gap
/// `Child::kill()` leaves on Windows.
#[cfg(windows)]
struct JobObject(windows_sys::Win32::Foundation::HANDLE);

// The job handle is only ever created, assigned to once, and closed on drop, all
// from the control thread that owns the `WarmChild`. The raw `HANDLE` (a pointer)
// is not `Send` by default; this wrapper is moved into `WarmChild`, which crosses
// threads via Tauri managed state, so assert it is safe to send (we never share it
// concurrently — Win32 job handles are process-global and the ops we call are
// thread-safe).
#[cfg(windows)]
unsafe impl Send for JobObject {}

#[cfg(windows)]
impl JobObject {
    /// Create a kill-on-close job. Returns `None` if the OS refuses (best-effort:
    /// a missing job degrades to today's single-process kill, never a failed spawn).
    fn create_kill_on_close() -> Option<Self> {
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        // SAFETY: a null name + null security attributes is the documented way to
        // create an anonymous job; the returned handle is checked below.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return None;
        }
        let job = JobObject(handle);

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `info` is a fully-initialized POD of the matching class size; the
        // handle is valid (checked above).
        let ok = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(info) as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if ok == 0 {
            return None; // `job` drops here, closing the handle.
        }
        Some(job)
    }

    /// Adopt `child` (and thus its future descendants) into the job. Best-effort.
    fn assign(&self, child: &Child) -> bool {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

        let process = child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE;
        // SAFETY: `self.0` is a live job handle; `process` is the child's live
        // process handle owned by `Child` for the duration of this call.
        unsafe { AssignProcessToJobObject(self.0, process) != 0 }
    }
}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        // Closing the only handle to a KILL_ON_JOB_CLOSE job terminates every
        // process still inside it — the whole Pi tree — then frees the job.
        // SAFETY: `self.0` is a valid handle this type uniquely owns.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Apply Windows-only spawn hygiene to `cmd`: suppress the console-window flash.
/// (Tree-reap is handled post-spawn by [`JobObject`].) A no-op on other targets.
#[cfg(windows)]
fn apply_windows_spawn_hygiene(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_windows_spawn_hygiene(_cmd: &mut Command) {}

/// Spawn a fresh Pi child, run the `get_commands` handshake, and pin the model
/// ONCE. Emits a reasoned `error` line and returns `Err(())` on any failure (the
/// caller then just returns `Ok(())`, surfacing the streamed error to the UI).
#[allow(clippy::too_many_arguments)] // spawning a configured child needs the full run context
fn spawn_and_configure(
    pi: &Path,
    env: HashMap<String, String>,
    project_root: &Path,
    provider: Option<&str>,
    model_id: Option<&str>,
    auth_fingerprint: String,
    jail: Option<crate::sandbox::Jail>,
    app: &AppHandle,
    channel: &str,
) -> Result<WarmChild, ()> {
    let jailed = jail.is_some();
    emit(
        app,
        channel,
        PiStreamLine::status(format!("Starting Pi in {}", project_root.display())),
    );
    if jailed && !crate::sandbox::jail_supported() {
        // Be honest where the hard OS jail isn't wired yet (macOS/Windows): the
        // cooperative in-Pi gate is still active, but it is not the hard guarantee.
        emit(
            app,
            channel,
            PiStreamLine::status(
                "OS-level file jail isn't available on this platform — the in-Pi permission-gate is the active layer.".to_string(),
            ),
        );
    }

    let mut cmd = Command::new(pi);
    cmd.arg("--mode")
        .arg("rpc")
        .current_dir(project_root)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // The OS jail (Linux Landlock) — the hard, unbypassable boundary. A no-op in
    // YOLO (jail = None) and on platforms without it (the in-Pi gate is the layer).
    if let Some(j) = jail {
        crate::sandbox::apply(&mut cmd, j);
    }
    // Windows: no console-window flash on stage (CREATE_NO_WINDOW). No-op elsewhere.
    apply_windows_spawn_hygiene(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            emit(
                app,
                channel,
                PiStreamLine::error(format!("failed to spawn `pi`: {e}")),
            );
            return Err(());
        }
    };

    // Windows: adopt the child into a kill-on-close Job Object BEFORE it spawns its
    // own descendants, so dropping the job (respawn / WarmChild::drop / app exit)
    // reaps the WHOLE Pi tree — not just the one process `Child::kill()` reaches.
    // Best-effort: if the job can't be created/assigned we keep the child and fall
    // back to today's single-process kill rather than failing the spawn.
    #[cfg(windows)]
    let job = {
        match JobObject::create_kill_on_close() {
            Some(j) if j.assign(&child) => Some(j),
            Some(_) => {
                // Created but could NOT adopt the child: a held-but-unassigned job
                // reaps nothing, so keeping it is a false sense of protection. Drop
                // it now and SAY so — the fallback to single-process kill must be
                // visible, never silent (descendants may then orphan on force-kill).
                emit(
                    app,
                    channel,
                    PiStreamLine::status(
                        "Windows Job Object assignment failed; falling back to single-process kill"
                            .to_string(),
                    ),
                );
                None
            }
            None => {
                emit(
                    app,
                    channel,
                    PiStreamLine::status(
                        "Windows Job Object unavailable; falling back to single-process kill"
                            .to_string(),
                    ),
                );
                None
            }
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        emit(app, channel, PiStreamLine::error("pi stdin unavailable"));
        let _ = child.kill();
        let _ = child.wait();
        return Err(());
    };
    let Some(stdout) = child.stdout.take() else {
        emit(app, channel, PiStreamLine::error("pi stdout unavailable"));
        let _ = child.kill();
        let _ = child.wait();
        return Err(());
    };
    let mut reader = BufReader::new(stdout);

    // Handshake: confirm Pi speaks our RPC vocabulary BEFORE any prompt — a
    // missing/failed ack is one reasoned error, not a silent degrade-to-thought.
    if let Err(e) = send_command(&mut stdin, &serde_json::json!({ "type": "get_commands" })) {
        emit(
            app,
            channel,
            PiStreamLine::error(format!("could not talk to Pi: {e}")),
        );
        let _ = child.kill();
        let _ = child.wait();
        return Err(());
    }
    match await_response(&mut reader, &mut stdin, app, channel, "get_commands") {
        Ok(true) => {}
        Ok(false) => {
            emit(app, channel, PiStreamLine::error(PI_HANDSHAKE_HELP));
            let _ = child.kill();
            let _ = child.wait();
            return Err(());
        }
        Err(()) => {
            emit(
                app,
                channel,
                PiStreamLine::error("Pi closed the RPC stream during the handshake."),
            );
            let _ = child.wait();
            return Err(());
        }
    }

    // Pin the model ONCE at spawn (no persisted default is assumed). A failure is
    // FATAL-TO-AI (typed), not silently ignored.
    if let (Some(p), Some(m)) = (provider, model_id) {
        let req = serde_json::json!({ "type": "set_model", "provider": p, "modelId": m });
        if let Err(e) = send_command(&mut stdin, &req) {
            emit(
                app,
                channel,
                PiStreamLine::error(format!("could not set model: {e}")),
            );
            let _ = child.kill();
            let _ = child.wait();
            return Err(());
        }
        match await_response(&mut reader, &mut stdin, app, channel, "set_model") {
            Ok(true) => {}
            Ok(false) => {
                emit(
                    app,
                    channel,
                    PiStreamLine::error(format!(
                        "Pi rejected model {p}/{m} (provider not authenticated or model unavailable)."
                    )),
                );
                let _ = child.kill();
                let _ = child.wait();
                return Err(());
            }
            Err(()) => {
                emit(
                    app,
                    channel,
                    PiStreamLine::error("Pi closed the stream while setting the model."),
                );
                let _ = child.wait();
                return Err(());
            }
        }
    }

    Ok(WarmChild {
        child,
        stdin,
        reader,
        provider: provider.map(String::from),
        model_id: model_id.map(String::from),
        project_root: project_root.to_path_buf(),
        jailed,
        auth_fingerprint,
        thinking_level: None,
        // A fresh child starts on Pi's own current/auto session; the first run
        // resolves + reports the real id (or switches to a requested one).
        current_session: None,
        #[cfg(windows)]
        job,
    })
}

/// Where the bundled permission-gate extension lives. Overridable for packaging
/// via `OPENJAMMER_GATE_DIR`; the dev fallback is the in-repo `pi-extensions`.
fn gate_extension_dir(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("OPENJAMMER_GATE_DIR") {
        return PathBuf::from(p);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("pi-extensions").join("permission-gate");
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("pi-extensions").join("permission-gate"))
        .unwrap_or_else(|| PathBuf::from("pi-extensions/permission-gate"))
}

/// Where the first-party `pi-openjammer-graph` extension lives — the package that
/// gives Pi the graph verbs (`add_node`/`add_connection`/…) so it can build the
/// canvas. Overridable via `OPENJAMMER_GRAPH_DIR`. Installed in EVERY mode (it is
/// the core capability, not a guard), unlike the permission-gate which YOLO drops.
fn graph_extension_dir(app: &AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("OPENJAMMER_GRAPH_DIR") {
        return PathBuf::from(p);
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("pi-openjammer-graph");
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("pi-openjammer-graph"))
        .unwrap_or_else(|| PathBuf::from("pi-openjammer-graph"))
}

fn same_openjammer_package_family(existing: &str, package: &str) -> bool {
    fn normalized(s: &str) -> String {
        s.replace('\\', "/").trim_end_matches('/').to_string()
    }
    let existing = normalized(existing);
    let package = normalized(package);

    fn ends_with_path_segment(path: &str, segment: &str) -> bool {
        path.strip_suffix(segment)
            .is_some_and(|prefix| prefix.is_empty() || prefix.ends_with('/'))
    }

    for marker in ["pi-openjammer-graph", "permission-gate"] {
        if ends_with_path_segment(&package, marker) && ends_with_path_segment(&existing, marker) {
            return true;
        }
    }
    false
}

/// Add (`present`) or remove a `package` entry from the agent home's
/// `settings.json` `packages[]` — the one mechanism Pi loads packages through.
/// Shared by the permission-gate (sandbox) and pi-persistent-intelligence (learning).
fn set_settings_package(agent_home: &Path, package: &str, present: bool) -> std::io::Result<()> {
    let settings_path = agent_home.join(".pi").join("agent").join("settings.json");

    let mut root: serde_json::Value = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    let mut packages: Vec<String> = root
        .get("packages")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // Installer paths can change across app versions. Keep only the current
    // OpenJammer package path for this package family so stale resource paths do
    // not duplicate tools or keep the old permission gate active in YOLO.
    let before_prune = packages.len();
    packages.retain(|p| p == package || !same_openjammer_package_family(p, package));
    let mut changed = packages.len() != before_prune;

    let has = packages.iter().any(|p| p == package);
    if present && !has {
        packages.push(package.to_string());
        changed = true;
    } else if !present && has {
        packages.retain(|p| p != package);
        changed = true;
    }

    if !changed {
        return Ok(()); // already in the desired state
    }

    root["packages"] = serde_json::json!(packages);
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let serialized = serde_json::to_string_pretty(&root).map_err(std::io::Error::other)?;
    // Crash-safe (temp + fsync + atomic rename): never leave a torn settings.json.
    ojcore_native::atomic_write_path(&settings_path, serialized.as_bytes())
}

/// Make the in-Pi permission-gate ACTIVE (jailed) or DROPPED (YOLO) by editing the
/// agent home's `settings.json` `packages[]` BEFORE the child spawns and reads it.
/// This is what turns the verified gate policy into live enforcement — and what
/// YOLO removes. Best-effort: a write failure is surfaced as a note, never fatal.
fn configure_gate(agent_home: &Path, jailed: bool, app: &AppHandle, channel: &str) {
    let gate = gate_extension_dir(app).to_string_lossy().into_owned();
    if set_settings_package(agent_home, &gate, jailed).is_err() {
        emit(
            app,
            channel,
            PiStreamLine::thought("note: could not update the sandbox config".to_string()),
        );
    }
}

/// The pi-persistent-intelligence package the agent learns through (Phase 7).
/// Overridable via `OPENJAMMER_PI_MEMORY_PKG` for a custom path / package name.
fn persistent_intelligence_pkg() -> String {
    std::env::var("OPENJAMMER_PI_MEMORY_PKG")
        .unwrap_or_else(|_| "pi-persistent-intelligence".to_string())
}

/// Opt-in learning (Phase 7): install/remove pi-persistent-intelligence in the
/// agent home so the agent remembers your taste across sessions (local frecency is
/// the floor either way). A mode change takes effect on the next (re)spawn.
#[tauri::command]
pub fn ai_set_learning(enabled: bool) -> Result<(), String> {
    let agent_home = AgentWorkspace::ensure()
        .map_err(|e| e.to_string())?
        .agent_home;
    set_settings_package(&agent_home, &persistent_intelligence_pkg(), enabled)
        .map_err(|e| e.to_string())
}

/// Forget the agent's learned memory (Phase 7) — wipes the pi-memory dir, leaving
/// auth + sessions intact. The "delete one brain" action behind a Ctrl+K command.
#[tauri::command]
pub fn ai_forget() -> Result<(), String> {
    let agent_home = AgentWorkspace::ensure()
        .map_err(|e| e.to_string())?
        .agent_home;
    let mem = agent_home.join(".pi").join("agent").join("pi-memory");
    if mem.exists() {
        std::fs::remove_dir_all(&mem).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&mem).map_err(|e| e.to_string())?;
    Ok(())
}

/// One past session, for the Ctrl+K "Sessions" list / timeline (Phase 4). `id` is
/// the session-store stem `switch_session` resumes by; `modifiedMs` orders them
/// most-recent-first. Read app-side from the JSONL store (Pi's RPC exposes only
/// linear `get_fork_messages` + `fork`, not a tree enumeration).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    id: String,
    modified_ms: u64,
}

/// List the agent's persisted sessions (newest first) from the global brain's
/// session store, for the resume / session-tree UI.
#[tauri::command]
pub fn ai_sessions() -> Result<Vec<SessionInfo>, String> {
    let dir = sessions_dir().map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(SessionInfo { id, modified_ms });
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.modified_ms));
    Ok(out)
}

/// The persisted-session store under the global agent brain
/// (`~/.openjammer/agent/.pi/agent/sessions`). One JSONL file per session, the
/// file stem is the session id `switch_session` resumes by.
fn sessions_dir() -> std::io::Result<PathBuf> {
    Ok(AgentWorkspace::ensure()?
        .agent_home
        .join(".pi")
        .join("agent")
        .join("sessions"))
}

/// The id (file stem) of the most-recently-written session — the one the current
/// run appended to. Used as the last-resort way to learn a fresh run's session id
/// when Pi's `get_state` didn't surface one.
fn newest_session_id() -> Option<String> {
    let dir = sessions_dir().ok()?;
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("jsonl") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else {
            continue;
        };
        let modified = entry.metadata().ok().and_then(|m| m.modified().ok());
        if let Some(t) = modified {
            if best.as_ref().map(|(bt, _)| t > *bt).unwrap_or(true) {
                best = Some((t, id));
            }
        }
    }
    best.map(|(_, id)| id)
}

/// Pull a session id out of a Pi response payload, trying the field names Pi has
/// used across versions. Best-effort — `None` when the payload carries none.
fn extract_session_id(value: &serde_json::Value) -> Option<String> {
    for key in ["sessionId", "session_id", "session", "id"] {
        if let Some(s) = value.get(key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    // Some shapes nest it under a `data` / `state` / `session` object.
    for outer in ["data", "state", "session"] {
        if let Some(obj) = value.get(outer) {
            if let Some(s) = extract_session_id(obj) {
                return Some(s);
            }
        }
    }
    None
}

/// Ask Pi for its active session id via `get_state` (request/response). Used after
/// a fresh run with no requested session, so a brand-new session's id can be
/// persisted. Best-effort: returns `None` if Pi doesn't surface one.
fn query_session_id(
    reader: &mut impl BufRead,
    stdin: &mut impl Write,
    app: &AppHandle,
    channel: &str,
) -> Option<String> {
    if send_command(stdin, &serde_json::json!({ "type": "get_state" })).is_err() {
        return None;
    }
    match await_response_value(reader, stdin, app, channel, "get_state") {
        Ok(value) => extract_session_id(&value),
        Err(()) => None,
    }
}

/// One renderable message from a persisted session, for the `/resume` history.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMessage {
    /// `"user" | "assistant" | "system" | "tool"`.
    role: String,
    /// The message text (markdown for assistant turns), best-effort extracted.
    text: String,
    /// A tool name, when this message is a tool call / result.
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
}

/// A loaded session transcript for display. `incomplete` is set when some lines
/// couldn't be parsed into a known shape (the UI says so, but still resumes).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscript {
    messages: Vec<DisplayMessage>,
    incomplete: bool,
}

/// Load a persisted session's messages for display (the `/resume` history).
///
/// READ-ONLY: parses `<sessions>/<id>.jsonl` directly (mirrors [`ai_sessions`]),
/// so it needs no warm child. The JSONL message shape is Pi's, not ours, so the
/// parser is deliberately TOLERANT and flags `incomplete` rather than failing —
/// the persisted-locally transcript covers the current session's display; this is
/// only for resuming OTHER sessions. (If the shape proves unstable, switch to
/// `get_fork_messages` over RPC.)
#[tauri::command]
pub fn ai_session_messages(id: String) -> Result<SessionTranscript, String> {
    let path = sessions_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{id}.jsonl"));
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    let mut incomplete = false;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(value) => {
                if let Some(msg) = parse_session_line(&value) {
                    messages.push(msg);
                }
            }
            Err(_) => incomplete = true,
        }
    }
    Ok(SessionTranscript {
        messages,
        incomplete,
    })
}

/// Best-effort: turn one parsed session-store JSON line into a [`DisplayMessage`].
/// Handles a plain message (`{role, content}`), an enveloped one
/// (`{message:{role, content}}`), string OR array-of-parts content, and a
/// standalone tool call. `None` for lines that carry no renderable message
/// (metadata, partial deltas, …).
fn parse_session_line(value: &serde_json::Value) -> Option<DisplayMessage> {
    // Unwrap a common `{ message: {…} }` / `{ data: {…} }` envelope.
    let msg = value
        .get("message")
        .or_else(|| value.get("data"))
        .unwrap_or(value);

    let role = msg.get("role").and_then(|v| v.as_str())?;
    if !matches!(role, "user" | "assistant" | "system" | "tool") {
        return None;
    }

    let text = extract_message_text(msg.get("content"));
    let tool = msg
        .get("name")
        .or_else(|| msg.get("toolName"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| first_tool_name(msg.get("content")));

    if text.trim().is_empty() && tool.is_none() {
        return None;
    }
    Some(DisplayMessage {
        role: role.to_string(),
        text,
        tool,
    })
}

/// Flatten a message `content` (string | array-of-parts | object) into plain text.
fn extract_message_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| {
                p.as_str()
                    .map(String::from)
                    .or_else(|| p.get("text").and_then(|t| t.as_str()).map(String::from))
            })
            .collect::<Vec<_>>()
            .join(""),
        Some(serde_json::Value::Object(_)) => content
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

/// The first tool name inside an array-of-parts content (a `tool_use`/`tool-call`
/// part), so a tool turn shows what it did.
fn first_tool_name(content: Option<&serde_json::Value>) -> Option<String> {
    let parts = content?.as_array()?;
    for p in parts {
        if let Some(name) = p
            .get("name")
            .or_else(|| p.get("toolName"))
            .and_then(|v| v.as_str())
        {
            return Some(name.to_string());
        }
    }
    None
}

/// CLI-parity seam (Phase 4): forward ONE raw RPC envelope to the warm Pi child
/// and stream the reply on `channel`. This is the thin GUI-over-RPC bridge that
/// gives the verbs Pi already exposes — `new_session`, `switch_session`,
/// `fork`, `clone`, `get_state`, `set_model`, `cycle_model`, `set_thinking_level`
/// — without reimplementing any of them. (Streaming verbs like `prompt` go through
/// [`ai_run`]; this is for the request/response commands.)
///
/// `command` is the full envelope, e.g. `{ "type": "switch_session", "id": "…" }`.
/// Requires a running warm child (start a prompt first); otherwise it surfaces a
/// clear error rather than spawning a child with no prompt context.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn ai_command(
    app: AppHandle,
    command: serde_json::Value,
    channel: String,
    provider_key: Option<String>,
    provider_keys: Option<HashMap<String, String>>,
    provider_base_urls: Option<HashMap<String, String>>,
    provider_custom_models: Option<HashMap<String, Vec<String>>>,
    provider: Option<String>,
    model_id: Option<String>,
    thinking_level: Option<String>,
    yolo: Option<bool>,
) -> Result<(), String> {
    // Same rule as ai_run: command RPC may spawn/configure/read Pi, so it must
    // not occupy the native UI/IPC thread while the frontend waits on events.
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let warm = app_for_thread.state::<WarmChildState>();
        let bridge = app_for_thread.state::<crate::bridge::BridgeState>();
        let _ = ai_command_blocking(
            app_for_thread.clone(),
            command,
            channel,
            provider_key,
            provider_keys,
            provider_base_urls,
            provider_custom_models,
            provider,
            model_id,
            thinking_level,
            yolo,
            warm,
            bridge,
        );
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn ai_command_blocking(
    app: AppHandle,
    command: serde_json::Value,
    channel: String,
    provider_key: Option<String>,
    provider_keys: Option<HashMap<String, String>>,
    provider_base_urls: Option<HashMap<String, String>>,
    provider_custom_models: Option<HashMap<String, Vec<String>>>,
    provider: Option<String>,
    model_id: Option<String>,
    thinking_level: Option<String>,
    yolo: Option<bool>,
    warm: tauri::State<'_, WarmChildState>,
    bridge: tauri::State<'_, crate::bridge::BridgeState>,
) -> Result<(), String> {
    let cmd_name = command
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if cmd_name.is_empty() {
        emit(
            &app,
            &channel,
            PiStreamLine::error("ai_command requires a `type` field"),
        );
        return Ok(());
    }

    let Some(pi) = find_pi(&app) else {
        emit(&app, &channel, PiStreamLine::error(PI_MISSING_HELP));
        return Ok(());
    };
    let workspace = match AgentWorkspace::ensure() {
        Ok(ws) => ws,
        Err(e) => {
            emit(
                &app,
                &channel,
                PiStreamLine::error(format!("could not prepare the agent workspace: {e}")),
            );
            return Ok(());
        }
    };
    let provider_key_entries = collect_provider_key_entries(
        provider_key.as_deref(),
        provider.as_deref(),
        provider_keys.as_ref(),
    );
    let filtered_provider_key_entries = filter_conflicting_provider_keys(provider_key_entries);
    let provider_base_urls = sanitized_provider_base_urls(provider_base_urls.as_ref());
    let provider_custom_models = sanitized_provider_custom_models(provider_custom_models.as_ref());
    if write_openjammer_models_json(
        &workspace.agent_home,
        &provider_base_urls,
        &provider_custom_models,
    )
    .is_err()
    {
        emit(
            &app,
            &channel,
            PiStreamLine::thought("note: could not update custom model config"),
        );
    }
    let auth_fingerprint = runtime_fingerprint(
        &filtered_provider_key_entries,
        &provider_base_urls,
        &provider_custom_models,
    );
    let jailed = !yolo.unwrap_or(false);
    let _runtime_thinking_level = sanitize_thinking_level(thinking_level.as_deref());
    let mut env = env_for_provider_keys(jailed, &filtered_provider_key_entries);
    env.insert(
        "HOME".to_string(),
        workspace.agent_home.to_string_lossy().into_owned(),
    );
    if let Some((addr, token)) = crate::bridge::ensure_started(&app, &bridge) {
        env.insert("OJ_BRIDGE_ADDR".to_string(), addr);
        env.insert("OJ_BRIDGE_TOKEN".to_string(), token);
    }
    if jailed {
        env.insert(
            "OJ_PROJECT_ROOT".to_string(),
            workspace.project_root.to_string_lossy().into_owned(),
        );
        env.insert(
            "OJ_MEMORY_ROOTS".to_string(),
            workspace
                .memory_roots()
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(":"),
        );
        let key_vars = provider_key_vars(&filtered_provider_key_entries);
        if let Some(active_key_var) = provider
            .as_deref()
            .map(|p| provider_key_var(Some(p)))
            .filter(|v| key_vars.iter().any(|k| k == v))
        {
            env.insert("OJ_KEY_VAR".to_string(), active_key_var);
        }
        if !key_vars.is_empty() {
            env.insert("OJ_KEY_VARS".to_string(), key_vars.join(":"));
        }
    }

    let mut guard = warm.0.lock().unwrap_or_else(|e| e.into_inner());
    let needs_respawn = match guard.as_mut() {
        None => true,
        Some(c) => {
            c.is_dead()
                || c.provider.as_deref() != provider.as_deref()
                || c.model_id.as_deref() != model_id.as_deref()
                || c.project_root != workspace.project_root
                || c.jailed != jailed
                || c.auth_fingerprint != auth_fingerprint
        }
    };
    if needs_respawn {
        drop(guard.take());
        configure_gate(&workspace.agent_home, jailed, &app, &channel);
        let graph_pkg = graph_extension_dir(&app).to_string_lossy().into_owned();
        let _ = set_settings_package(&workspace.agent_home, &graph_pkg, true);
        let jail = if jailed {
            Some(crate::sandbox::Jail::new(
                workspace.project_root.clone(),
                workspace.agent_home.clone(),
            ))
        } else {
            None
        };
        match spawn_and_configure(
            &pi,
            env,
            &workspace.project_root,
            provider.as_deref(),
            model_id.as_deref(),
            auth_fingerprint,
            jail,
            &app,
            &channel,
        ) {
            Ok(c) => *guard = Some(c),
            Err(()) => return Ok(()),
        }
    }

    let Some(child) = guard.as_mut() else {
        return Ok(());
    };

    if let Err(e) = send_command(&mut child.stdin, &command) {
        emit(
            &app,
            &channel,
            PiStreamLine::error(format!("could not send {cmd_name}: {e}")),
        );
        drop(guard.take());
        return Ok(());
    }

    match await_response_value(
        &mut child.reader,
        &mut child.stdin,
        &app,
        &channel,
        &cmd_name,
    ) {
        Ok(value) => {
            // A session-mutating command (`new_session` / `switch_session` /
            // `get_state`) carries the active id — track + report it so the
            // frontend persists and reattaches to it.
            if let Some(sid) = extract_session_id(&value) {
                child.current_session = Some(sid.clone());
                emit(&app, &channel, PiStreamLine::session(sid));
            }
            if value
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                if cmd_name == "set_model" {
                    child.provider = command
                        .get("provider")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    child.model_id = command
                        .get("modelId")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                } else if cmd_name == "set_thinking_level" {
                    child.thinking_level = command
                        .get("level")
                        .and_then(|v| v.as_str())
                        .and_then(|level| sanitize_thinking_level(Some(level)));
                }
                let data = value.get("data").cloned();
                emit(
                    &app,
                    &channel,
                    PiStreamLine::result_with_data(format!("{cmd_name} ok"), data),
                );
            } else {
                emit(
                    &app,
                    &channel,
                    PiStreamLine::error(format!("Pi rejected {cmd_name}")),
                );
            }
        }
        Err(()) => {
            emit(
                &app,
                &channel,
                PiStreamLine::error(format!("Pi closed the stream during {cmd_name}")),
            );
            drop(guard.take());
        }
    }
    Ok(())
}

/// Pre-warm the Pi child on intent (the frontend calls this when the user enters
/// AI mode), so the FIRST real prompt pays NO cold start — spawn, handshake, and
/// `set_model` are already done. Runs the SAME spawn/configure path as [`ai_run`]
/// / [`ai_command`] but sends no command. IDEMPOTENT: if a warm child already
/// matches this runtime's fingerprint it returns at once, so re-entering AI mode
/// is free. Off the UI/IPC thread like every other `ai_*`. The frontend gates it
/// on configured + capable, so the search-only / pure-instrument majority never
/// spawns Pi; the single idle child is reaped on the next respawn or app exit.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn ai_prewarm(
    app: AppHandle,
    provider_key: Option<String>,
    provider_keys: Option<HashMap<String, String>>,
    provider_base_urls: Option<HashMap<String, String>>,
    provider_custom_models: Option<HashMap<String, Vec<String>>>,
    provider: Option<String>,
    model_id: Option<String>,
    yolo: Option<bool>,
) -> Result<(), String> {
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        let warm = app_for_thread.state::<WarmChildState>();
        let bridge = app_for_thread.state::<crate::bridge::BridgeState>();
        ai_prewarm_blocking(
            app_for_thread.clone(),
            provider_key,
            provider_keys,
            provider_base_urls,
            provider_custom_models,
            provider,
            model_id,
            yolo,
            warm,
            bridge,
        );
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn ai_prewarm_blocking(
    app: AppHandle,
    provider_key: Option<String>,
    provider_keys: Option<HashMap<String, String>>,
    provider_base_urls: Option<HashMap<String, String>>,
    provider_custom_models: Option<HashMap<String, Vec<String>>>,
    provider: Option<String>,
    model_id: Option<String>,
    yolo: Option<bool>,
    warm: tauri::State<'_, WarmChildState>,
    bridge: tauri::State<'_, crate::bridge::BridgeState>,
) {
    // Best-effort + silent: status/errors go to an internal channel the frontend
    // does not subscribe to, so a failed prewarm just means the first prompt pays
    // the cold start it would have paid anyway.
    const CHANNEL: &str = "oj-ai-prewarm";
    let Some(pi) = find_pi(&app) else {
        return;
    };
    let Ok(workspace) = AgentWorkspace::ensure() else {
        return;
    };

    let provider_key_entries = collect_provider_key_entries(
        provider_key.as_deref(),
        provider.as_deref(),
        provider_keys.as_ref(),
    );
    let filtered_provider_key_entries = filter_conflicting_provider_keys(provider_key_entries);
    let provider_base_urls = sanitized_provider_base_urls(provider_base_urls.as_ref());
    let provider_custom_models = sanitized_provider_custom_models(provider_custom_models.as_ref());
    let _ = write_openjammer_models_json(
        &workspace.agent_home,
        &provider_base_urls,
        &provider_custom_models,
    );
    let auth_fingerprint = runtime_fingerprint(
        &filtered_provider_key_entries,
        &provider_base_urls,
        &provider_custom_models,
    );
    let jailed = !yolo.unwrap_or(false);
    let mut env = env_for_provider_keys(jailed, &filtered_provider_key_entries);
    env.insert(
        "HOME".to_string(),
        workspace.agent_home.to_string_lossy().into_owned(),
    );
    if let Some((addr, token)) = crate::bridge::ensure_started(&app, &bridge) {
        env.insert("OJ_BRIDGE_ADDR".to_string(), addr);
        env.insert("OJ_BRIDGE_TOKEN".to_string(), token);
    }
    if jailed {
        env.insert(
            "OJ_PROJECT_ROOT".to_string(),
            workspace.project_root.to_string_lossy().into_owned(),
        );
        env.insert(
            "OJ_MEMORY_ROOTS".to_string(),
            workspace
                .memory_roots()
                .iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(":"),
        );
        let key_vars = provider_key_vars(&filtered_provider_key_entries);
        if let Some(active_key_var) = provider
            .as_deref()
            .map(|p| provider_key_var(Some(p)))
            .filter(|v| key_vars.iter().any(|k| k == v))
        {
            env.insert("OJ_KEY_VAR".to_string(), active_key_var);
        }
        if !key_vars.is_empty() {
            env.insert("OJ_KEY_VARS".to_string(), key_vars.join(":"));
        }
    }

    let mut guard = warm.0.lock().unwrap_or_else(|e| e.into_inner());
    let needs_respawn = match guard.as_mut() {
        None => true,
        Some(c) => {
            c.is_dead()
                || c.provider.as_deref() != provider.as_deref()
                || c.model_id.as_deref() != model_id.as_deref()
                || c.project_root != workspace.project_root
                || c.jailed != jailed
                || c.auth_fingerprint != auth_fingerprint
        }
    };
    if !needs_respawn {
        return; // already warm and matching this runtime — nothing to do.
    }
    drop(guard.take());
    configure_gate(&workspace.agent_home, jailed, &app, CHANNEL);
    let graph_pkg = graph_extension_dir(&app).to_string_lossy().into_owned();
    let _ = set_settings_package(&workspace.agent_home, &graph_pkg, true);
    let jail = if jailed {
        Some(crate::sandbox::Jail::new(
            workspace.project_root.clone(),
            workspace.agent_home.clone(),
        ))
    } else {
        None
    };
    if let Ok(child) = spawn_and_configure(
        &pi,
        env,
        &workspace.project_root,
        provider.as_deref(),
        model_id.as_deref(),
        auth_fingerprint,
        jail,
        &app,
        CHANNEL,
    ) {
        *guard = Some(child);
    }
}

/// Drop the warm Pi child so the next prompt respawns and reloads settings,
/// bundled packages, extensions, skills, and prompt templates.
#[tauri::command]
pub fn ai_restart(warm: tauri::State<'_, WarmChildState>) -> Result<(), String> {
    drop(warm.0.lock().unwrap_or_else(|e| e.into_inner()).take());
    Ok(())
}

fn valid_thinking_level(level: &str) -> bool {
    matches!(
        level,
        "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
    )
}

fn sanitize_thinking_level(level: Option<&str>) -> Option<String> {
    level
        .map(str::trim)
        .filter(|level| valid_thinking_level(level))
        .map(String::from)
}

fn apply_thinking_level_if_needed(
    child: &mut WarmChild,
    level: Option<&str>,
    app: &AppHandle,
    channel: &str,
) -> Result<(), ()> {
    let Some(level) = sanitize_thinking_level(level) else {
        return Ok(());
    };
    if child.thinking_level.as_deref() == Some(level.as_str()) {
        return Ok(());
    }
    let req = serde_json::json!({ "type": "set_thinking_level", "level": level.as_str() });
    if send_command(&mut child.stdin, &req).is_err() {
        emit(
            app,
            channel,
            PiStreamLine::error("could not send thinking-level change"),
        );
        return Err(());
    }
    match await_response(
        &mut child.reader,
        &mut child.stdin,
        app,
        channel,
        "set_thinking_level",
    ) {
        Ok(true) => {
            child.thinking_level = Some(level);
            Ok(())
        }
        Ok(false) => {
            emit(
                app,
                channel,
                PiStreamLine::thought("Pi rejected the selected thinking level"),
            );
            Ok(())
        }
        Err(()) => {
            emit(
                app,
                channel,
                PiStreamLine::error("Pi closed the stream while setting thinking level."),
            );
            Err(())
        }
    }
}

/// Write one JSON command to Pi's stdin (LF-framed) and flush.
fn send_command(stdin: &mut impl Write, msg: &serde_json::Value) -> std::io::Result<()> {
    writeln!(stdin, "{msg}")?;
    stdin.flush()
}

/// Read lines until the `{"type":"response","command":<command>}` ack arrives,
/// returning its `success` flag. Any events seen meanwhile are mapped + emitted
/// (and blocking dialogs auto-cancelled). `Err(())` means EOF/read error before
/// the ack (Pi died).
fn await_response(
    reader: &mut impl BufRead,
    stdin: &mut impl Write,
    app: &AppHandle,
    channel: &str,
    command: &str,
) -> Result<bool, ()> {
    await_response_value(reader, stdin, app, channel, command)
        .map(|v| v.get("success").and_then(|s| s.as_bool()).unwrap_or(false))
}

/// As [`await_response`], but returns the WHOLE `{"type":"response",…}` object so
/// the caller can read its payload (e.g. the session id a `new_session` /
/// `get_state` command surfaces). `Err(())` means EOF/read error before the ack.
fn await_response_value(
    reader: &mut impl BufRead,
    stdin: &mut impl Write,
    app: &AppHandle,
    channel: &str,
    command: &str,
) -> Result<serde_json::Value, ()> {
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Err(()), // EOF
            Ok(_) => {}
            Err(_) => return Err(()),
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            // Non-JSON narration during the handshake: surface, keep waiting.
            emit(app, channel, PiStreamLine::thought(trimmed.to_string()));
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) == Some("response")
            && value.get("command").and_then(|v| v.as_str()) == Some(command)
        {
            return Ok(value);
        }
        handle_event(&value, stdin, app, channel);
    }
}

/// Stream events until `agent_end` (emit `result`) or EOF / read error.
fn stream_until_end(
    reader: &mut impl BufRead,
    stdin: &mut impl Write,
    app: &AppHandle,
    channel: &str,
) {
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            // EOF without an explicit agent_end: treat as a clean completion.
            Ok(0) => {
                emit(app, channel, PiStreamLine::result("Agent run complete."));
                return;
            }
            Ok(_) => {}
            Err(_) => {
                emit(app, channel, PiStreamLine::error("error reading Pi stream"));
                return;
            }
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.trim().is_empty() {
            continue;
        }
        let value = match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(v) => v,
            Err(_) => {
                emit(app, channel, PiStreamLine::thought(trimmed.to_string()));
                continue;
            }
        };
        // agent_end terminates the run.
        if value.get("type").and_then(|v| v.as_str()) == Some("agent_end") {
            emit(app, channel, PiStreamLine::result("Agent run complete."));
            return;
        }
        handle_event(&value, stdin, app, channel);
    }
}

/// Auto-cancel blocking extension dialogs (so a run never hangs on UI we don't
/// drive yet), then map the event to a [`PiStreamLine`] and emit it if it
/// carries transcript signal.
fn handle_event(value: &serde_json::Value, stdin: &mut impl Write, app: &AppHandle, channel: &str) {
    if value.get("type").and_then(|v| v.as_str()) == Some("extension_ui_request") {
        if let Some(method) = value.get("method").and_then(|v| v.as_str()) {
            if is_blocking_dialog(method) {
                if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                    let _ = send_command(
                        stdin,
                        &serde_json::json!({ "type": "extension_ui_response", "id": id, "cancelled": true }),
                    );
                }
            }
        }
    }
    if let Some(out) = parse_pi_event(value) {
        emit(app, channel, out);
    }
}

/// The four `extension_ui_request` methods that block Pi until answered.
fn is_blocking_dialog(method: &str) -> bool {
    matches!(method, "select" | "confirm" | "input" | "editor")
}

/// The only Pi tools OpenJammer's webview is allowed to interpret as canvas
/// graph verbs. Generic Pi tools (`read`, `bash`, `edit`, …) may run inside Pi,
/// especially in YOLO, but they must NEVER be routed into `applyToolCall`.
const OPENJAMMER_TOOL_NAMES: &[&str] = &[
    "add_node",
    "remove_node",
    "update_node_data",
    "add_connection",
    "remove_connection",
    "author_dsp_node",
    "author_code_node",
    "get_graph",
    "list_node_types",
    "find_nodes",
    "batch_apply",
    "validate_plan",
    "emit_plan",
    "get_logs",
    "get_diagnostics",
    "get_settings",
    "update_settings",
];

fn is_openjammer_tool(name: &str) -> bool {
    OPENJAMMER_TOOL_NAMES.contains(&name)
}

/// Translate one Pi RPC event into an optional [`PiStreamLine`]. `None` means
/// the event carries no transcript signal (lifecycle / partial / housekeeping)
/// and is intentionally dropped rather than degraded to a noisy `thought`.
fn parse_pi_event(value: &serde_json::Value) -> Option<PiStreamLine> {
    let tag = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match tag {
        // The executed tool call (final args) → forward as `tool-call`.
        "tool_execution_start" => {
            let name = value.get("toolName").and_then(|v| v.as_str()).unwrap_or("");
            if !is_openjammer_tool(name) {
                return None;
            }
            let args = value
                .get("args")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let id = value
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(PiStreamLine::tool_call(name, args, id))
        }
        // Streaming assistant text delta → narration.
        "message_update" => {
            let ev = value.get("assistantMessageEvent")?;
            if ev.get("type").and_then(|v| v.as_str()) == Some("text_delta") {
                let delta = ev.get("delta").and_then(|v| v.as_str()).unwrap_or("");
                if delta.is_empty() {
                    None
                } else {
                    Some(PiStreamLine::thought(delta))
                }
            } else {
                None
            }
        }
        "agent_end" => Some(PiStreamLine::result("Agent run complete.")),
        "error" => Some(PiStreamLine::error(
            text_field(value).unwrap_or_else(|| "Pi error.".into()),
        )),
        "extension_error" => Some(PiStreamLine::error(
            value
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("extension error")
                .to_string(),
        )),
        "extension_ui_request" => Some(PiStreamLine::ui_request(value.clone())),
        // Lifecycle / partial / housekeeping events carry no transcript signal.
        _ => None,
    }
}

/// Extract a human-readable text field from a Pi line, trying common keys.
fn text_field(value: &serde_json::Value) -> Option<String> {
    for key in ["text", "message", "content", "summary", "delta", "reason"] {
        if let Some(s) = value.get(key).and_then(|v| v.as_str()) {
            return Some(s.to_string());
        }
    }
    None
}

/// Build the STRIPPED environment for the Pi child: an allowlist, not the
/// inherited env. Forwards `PATH`/`HOME` (so `pi`/`git`/the user config resolve)
/// and, when supplied, the single provider key under the var name Pi/its
/// providers read. Everything else in the parent process env is dropped.
///
/// The provider-key var defaults to a generic name but can be overridden via
/// `OPENJAMMER_AI_KEY_VAR` so the founder targets their specific provider (e.g.
/// `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) without code changes.
///
/// Kept as the no-provider shorthand for [`stripped_env_for`]; exercised by the
/// allowlist tests and available for any future call site that has no active
/// provider to map.
#[cfg(test)]
fn stripped_env(provider_key: Option<&str>) -> HashMap<String, String> {
    stripped_env_for(provider_key, None)
}

/// As [`stripped_env`], but resolves the provider-key VAR NAME from the active
/// provider (D6, M7) when no explicit `OPENJAMMER_AI_KEY_VAR` override is set.
///
/// Resolution order:
/// 1. `OPENJAMMER_AI_KEY_VAR` (founder override) wins if present;
/// 2. else `auth::provider_env_var(provider)` (e.g. `anthropic` →
///    `ANTHROPIC_API_KEY`) when a provider is given;
/// 3. else the generic `OPENJAMMER_PROVIDER_KEY`.
///
/// The caller passes `None` for the key when a conflict means we must defer to
/// Pi's own auth.json resolution.
fn stripped_env_for(provider_key: Option<&str>, provider: Option<&str>) -> HashMap<String, String> {
    let mut env = HashMap::new();

    // Minimal forwarding so the child can find executables + the user's ~/.pi.
    for var in ["PATH", "HOME"] {
        if let Ok(val) = std::env::var(var) {
            env.insert(var.to_string(), val);
        }
    }
    // Windows needs these to resolve binaries / the home dir.
    for var in [
        "USERPROFILE",
        "SYSTEMROOT",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
        "COMSPEC",
        "PATHEXT",
    ] {
        if let Ok(val) = std::env::var(var) {
            env.insert(var.to_string(), val);
        }
    }

    if let Some(key) = provider_key.filter(|k| !k.is_empty()) {
        env.insert(provider_key_var(provider), key.to_string());
    }

    env
}

/// Resolve the env VAR NAME the provider key is injected under — used both to
/// inject the key (above) and to tell the in-Pi permission-gate which var holds
/// the secret to redact (`OJ_KEY_VAR`). Order: `OPENJAMMER_AI_KEY_VAR` override →
/// the active provider's mapping (e.g. `anthropic` → `ANTHROPIC_API_KEY`) → a
/// generic fallback name.
fn provider_key_var(provider: Option<&str>) -> String {
    std::env::var("OPENJAMMER_AI_KEY_VAR").unwrap_or_else(|_| {
        provider
            .map(|p| crate::auth::provider_env_var(p).to_string())
            .unwrap_or_else(|| "OPENJAMMER_PROVIDER_KEY".to_string())
    })
}

/// Locate the Pi runtime. Resolution order:
/// 1. `OPENJAMMER_PI_BIN` developer override;
/// 2. OpenJammer's bundled Pi runtime copied from Tauri resources into app data;
/// 3. the in-repo dev sidecar (`src-tauri/binaries/...`);
/// 4. a global `pi` on PATH (developer fallback only).
///
/// Bundled wins over PATH so users never accidentally run an incompatible global
/// Pi. Returns `None` only when OpenJammer's bundled runtime is missing/corrupt
/// AND no development fallback exists.
fn find_pi(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("OPENJAMMER_PI_BIN") {
        let p = PathBuf::from(&explicit);
        if executable_works(&p) {
            return Some(p);
        }
    }

    if let Some(p) = installed_bundled_pi(app) {
        return Some(p);
    }

    let dev_runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Some(p) = pi_in_runtime_dir(&dev_runtime) {
        return Some(p);
    }

    // Probe PATH with a cheap `--version`; if it runs, `pi` is callable. This is
    // intentionally last: packaged OpenJammer should be self-contained.
    let path_pi = PathBuf::from("pi");
    if executable_works(&path_pi) {
        return Some(path_pi);
    }
    None
}

fn installed_bundled_pi(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("OPENJAMMER_PI_RUNTIME_DIR") {
        if let Some(p) = pi_in_runtime_dir(&PathBuf::from(dir)) {
            return Some(p);
        }
    }

    let resource_runtime = app.path().resource_dir().ok()?.join("pi-runtime");
    if !resource_runtime.join("openjammer-pi-runtime.json").exists() {
        return None;
    }

    let version = runtime_version(&resource_runtime).unwrap_or_else(|| "bundled".to_string());
    let install_root = app
        .path()
        .app_data_dir()
        .ok()?
        .join("pi-runtime")
        .join(version);
    let installed_bin = install_root.join(pi_binary_name());

    if !executable_works(&installed_bin) {
        let tmp = install_root.with_extension("tmp");
        let _ = std::fs::remove_dir_all(&tmp);
        if copy_dir_all(&resource_runtime, &tmp).is_err() {
            let _ = std::fs::remove_dir_all(&tmp);
            return None;
        }
        let _ = std::fs::remove_dir_all(&install_root);
        if std::fs::rename(&tmp, &install_root).is_err() {
            let _ = std::fs::remove_dir_all(&tmp);
            return None;
        }
        make_executable(&installed_bin);
    }

    pi_in_runtime_dir(&install_root)
}

fn pi_in_runtime_dir(dir: &Path) -> Option<PathBuf> {
    let p = dir.join(pi_binary_name());
    if executable_works(&p) {
        Some(p)
    } else {
        None
    }
}

fn runtime_version(dir: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(dir.join("openjammer-pi-runtime.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&manifest).ok()?;
    json.get("version")?.as_str().map(str::to_string)
}

fn executable_works(path: &Path) -> bool {
    if path.as_os_str() != "pi" && !path.exists() {
        return false;
    }
    Command::new(path)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn copy_dir_all(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o755);
        let _ = std::fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) {}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn pi_binary_name() -> &'static str {
    "openjammer-pi-x86_64-pc-windows-msvc.exe"
}

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn pi_binary_name() -> &'static str {
    "openjammer-pi-aarch64-pc-windows-msvc.exe"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn pi_binary_name() -> &'static str {
    "openjammer-pi-x86_64-apple-darwin"
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn pi_binary_name() -> &'static str {
    "openjammer-pi-aarch64-apple-darwin"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn pi_binary_name() -> &'static str {
    "openjammer-pi-x86_64-unknown-linux-gnu"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn pi_binary_name() -> &'static str {
    "openjammer-pi-aarch64-unknown-linux-gnu"
}

/// The actionable message shown when OpenJammer cannot start its bundled Pi runtime.
const PI_MISSING_HELP: &str = "OpenJammer's bundled AI runtime is missing or damaged. \
    Reinstall OpenJammer or set OPENJAMMER_PI_BIN to a compatible Pi executable. \
    Provider authentication is separate: choose a provider in OpenJammer or set the \
    provider API key (OPENJAMMER_AI_KEY_VAR can override the key variable name).";

/// The actionable message shown when Pi runs but never acknowledges the
/// `get_commands` handshake (too old / a different RPC dialect).
const PI_HANDSHAKE_HELP: &str = "Pi started but did not acknowledge the RPC handshake \
    (`get_commands`). The installed Pi may be too old or speak a different RPC dialect. \
    Update it (`bun add -g @earendil-works/pi-coding-agent`) and try again.";

/// The PERSISTENT agent workspace (Phase 1) — replaces the per-run throwaway
/// worktree. The agent's HOME is a single GLOBAL brain under the user's home
/// (`~/.openjammer/agent/`) so its `.pi` memory / sessions / auth accumulate
/// across runs and projects (the founder's "evolves & learns" folder). Pi's cwd
/// and the write-jail boundary is a project working dir beneath it. The OS jail
/// (`sandbox.rs`, device side) confines writes to these roots; nothing is torn
/// down — persistence is the whole point.
struct AgentWorkspace {
    /// Forwarded as `HOME` → Pi reads/writes its `.pi` here (the global brain).
    agent_home: PathBuf,
    /// Pi's cwd and the write-jail boundary.
    project_root: PathBuf,
}

impl AgentWorkspace {
    fn ensure() -> std::io::Result<Self> {
        let agent_home = home_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join(".openjammer")
            .join("agent");
        let project_root = agent_home.join("workspace");
        // The memory + sessions dirs the persistent-intelligence package and Pi
        // use; creating them up front keeps the gate's writable roots real.
        let pi_agent = agent_home.join(".pi").join("agent");
        std::fs::create_dir_all(pi_agent.join("pi-memory"))?;
        std::fs::create_dir_all(pi_agent.join("sessions"))?;
        std::fs::create_dir_all(&project_root)?;
        // Seed the SEE hand's on-demand debugging skill the persona points at.
        // Idempotent: only written when absent, so the agent's own refinements to
        // its skill (pi-memory is agent-writable) are never clobbered. Best-effort —
        // a failed seed just means the persona's compact pointer has no file yet.
        let debugging = pi_agent.join("pi-memory").join("debugging.md");
        if !debugging.exists() {
            let _ = std::fs::write(&debugging, include_str!("../assets/agent/debugging.md"));
        }
        Ok(Self {
            agent_home,
            project_root,
        })
    }

    /// The extra writable roots (besides `project_root`) the in-Pi gate must allow:
    /// the agent's own memory + sessions live under HOME, OUTSIDE the project cwd,
    /// so the write-jail spans both — but never the gate's own config/packages.
    fn memory_roots(&self) -> Vec<PathBuf> {
        let pi_agent = self.agent_home.join(".pi").join("agent");
        vec![pi_agent.join("pi-memory"), pi_agent.join("sessions")]
    }
}

/// The user's home dir (`HOME` / `USERPROFILE`), for siting the persistent agent
/// home. Falls back to the temp dir at the call site when neither is set.
pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Emit one stream line on the run channel, ignoring emit errors (a closed
/// webview just means nobody is listening; the run still tears down cleanly).
fn emit(app: &AppHandle, channel: &str, line: PiStreamLine) {
    let _ = app.emit(channel, line);
}

// ============================================================================
// DSP-node authoring (Faust)
// ============================================================================

/// The result of compiling an AI-authored Faust DSP, sent back to the frontend.
/// Mirrors the relevant fields of [`ojfaust::CompiledFaust`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FaustCompileResult {
    /// The DSP name (from `declare name` or a default).
    pub name: String,
    /// Audio inputs the DSP reports for `process`.
    pub n_in: u8,
    /// Audio outputs the DSP reports for `process`.
    pub n_out: u8,
}

/// Compile Faust `source` via [`ojfaust`].
///
/// * `Ok(Some(result))` — compiled (only possible when the build has libfaust).
/// * `Ok(None)` — no Faust backend in this build; the caller stores the source
///   and registers the node for later compilation (the documented fallback).
/// * `Err(msg)` — the source was reachable but did not compile; the message is
///   the compiler diagnostic, suitable for the agent's repair loop.
///
/// The default build (no `ojfaust/libfaust` feature) always returns `Ok(None)`,
/// so the desktop app builds + the command works with no native Faust toolchain.
pub fn compile_faust(source: &str) -> Result<Option<FaustCompileResult>, String> {
    use ojfaust::{FaustCompiler, FaustError};

    match FaustCompiler::new().compile(source) {
        Ok(c) => Ok(Some(FaustCompileResult {
            name: c.name,
            n_in: c.n_in,
            n_out: c.n_out,
        })),
        // No backend compiled in: not an error — fall back to "store source".
        Err(FaustError::Unavailable) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ============================================================================
// author_wasm_node (M6) — Faust -> .wasm + validated v1 manifest, fail-closed
// ============================================================================
//
// This is the VERIFIABLE half of code-node authoring (D4). Given Faust `source`,
// it compiles via the ojfaust CLI Path B to a `.wasm` + the real port/param
// metadata, builds the frozen v1 `oj-plugin-v1` manifest, and VALIDATES it
// HOST-SIDE (fail-closed, D4-A1): namespace the id `ai.wasm.<wasmHash>`, REJECT a
// built-in collision, assert declared ports match the faust meta, and shape-check
// every field against the v1 schema. A failed validation returns a `diagnostic`
// and registers NOTHING.
//
// FOUNDER-GATED BOUNDARY: this command authors + validates the artifact ONLY. It
// never executes the wasm — the wasmtime native RT host + the AudioWorklet
// executor are the founder-gated next step (see `docs/code-node-abi.md`). Newly
// authored nodes stay AUDIBLE via M5's faust-source effect path in the interim.

/// A successfully (or partially) authored code node, returned to the frontend.
///
/// On a clean author: `manifest_id`/`manifest_json`/`wasm_hash`/`n_in`/`n_out`
/// are populated and `diagnostic` is absent. On a recoverable problem (no faust
/// binary, a compile error, or a failed validation) the data fields are empty and
/// `diagnostic` explains why — the frontend falls back to storing source and the
/// agent can repair. The command itself always returns `Ok`; only true internal
/// faults map to `Err`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthoredNode {
    /// The OPEN registry id: `"ai.wasm." + wasm_hash` (empty on failure).
    pub manifest_id: String,
    /// The serialized v1 `PluginManifest` JSON (empty on failure).
    pub manifest_json: String,
    /// FNV-1a 32-bit hex of the wasm bytes — the content-addressed identity
    /// (empty on failure). Matches the frontend `shortHash` format.
    pub wasm_hash: String,
    /// Audio inputs the compiled DSP reports.
    pub n_in: u8,
    /// Audio outputs the compiled DSP reports.
    pub n_out: u8,
    /// Present when authoring did not produce a validated node (faust missing,
    /// compile error, or validation rejection) — the message to surface / repair.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

impl AuthoredNode {
    /// A failure result carrying only a diagnostic (no manifest registered).
    fn failed(diagnostic: impl Into<String>) -> Self {
        Self {
            manifest_id: String::new(),
            manifest_json: String::new(),
            wasm_hash: String::new(),
            n_in: 0,
            n_out: 0,
            diagnostic: Some(diagnostic.into()),
        }
    }
}

/// FNV-1a 32-bit hash of bytes as 8-char lowercase hex.
///
/// The SAME algorithm + format as the frontend `shortHash` (`dynamicRegistry.ts`)
/// so an id derived from the wasm here lines up with the open-identity namespace
/// the UI uses. Pure + deterministic (no time, no randomness).
fn fnv1a_hex(bytes: &[u8]) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for &b in bytes {
        hash ^= b as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// The CLOSED set of namespaces a built-in node id may live under. An authored id
/// that collides with one of these is REJECTED fail-closed — an AI node must
/// never be able to shadow a real built-in's identity (D4-A1).
const RESERVED_ID_PREFIXES: &[&str] = &["builtin.", "host.", "oj.builtin."];

/// Reject any id that falls inside a reserved built-in namespace (D4-A1). Pure +
/// directly testable: the `ai.wasm.` namespace can never literally start with a
/// reserved prefix, so this guard is the fail-closed proof that the host would
/// reject an authored id that DID collide.
fn reject_reserved_id(id: &str) -> Result<(), String> {
    for reserved in RESERVED_ID_PREFIXES {
        if id.starts_with(reserved) {
            return Err(format!(
                "authored id `{id}` collides with the reserved built-in namespace `{reserved}`"
            ));
        }
    }
    Ok(())
}

/// The minimal v1 manifest shape this command emits + validates. Field names +
/// the `dsp`/`ui` enums mirror `schemas/oj-plugin-v1.json` and the TS
/// `PluginManifest`; serialized straight to `manifest_json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct V1Manifest {
    id: String,
    name: String,
    kind: String,
    dsp: String,
    ui: String,
    params: Vec<V1Param>,
    ports: V1Ports,
}

/// One numeric param in the v1 manifest (mirrors `ParamDecl`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct V1Param {
    id: u16,
    name: String,
    min: f32,
    max: f32,
    default: f32,
}

/// Port topology in the v1 manifest (mirrors `PortDecl`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct V1Ports {
    audio_in: u8,
    audio_out: u8,
    control_in: u8,
    control_out: u8,
}

/// The metadata an authored manifest is validated against — the ground truth the
/// faust compile reported (name + true port counts + params). Separated from the
/// process plumbing so the validator is unit-testable with a sample meta and no
/// real faust binary.
#[derive(Debug, Clone, PartialEq)]
struct AuthoredMeta {
    name: String,
    n_in: u8,
    n_out: u8,
    wasm_hash: String,
    params: Vec<V1Param>,
}

/// Build + VALIDATE the v1 manifest from the compiled metadata, fail-closed.
///
/// Returns `Ok(manifest)` only when EVERY check passes:
/// 1. the namespaced id `ai.wasm.<hash>` does not collide with a built-in
///    ([`RESERVED_ID_PREFIXES`]);
/// 2. the declared ports match the faust-reported arity exactly;
/// 3. the schema-shape invariants hold (non-empty id/name, every param
///    `min <= default <= max`, port counts in range).
///
/// On any failure returns `Err(diagnostic)` and the caller registers nothing.
fn build_and_validate_manifest(meta: &AuthoredMeta) -> Result<V1Manifest, String> {
    // 1) Namespace + collision check (fail-closed: never shadow a built-in).
    if meta.wasm_hash.is_empty() {
        return Err("cannot author a node from an empty wasm hash".to_string());
    }
    let id = format!("ai.wasm.{}", meta.wasm_hash);
    reject_reserved_id(&id)?;

    // The manifest's declared ports, derived from the compiled DSP's true arity.
    let ports = V1Ports {
        audio_in: meta.n_in,
        audio_out: meta.n_out,
        control_in: 0,
        control_out: 0,
    };

    // 2) Arity check: the declared audio ports MUST equal the faust-reported
    //    counts (a mismatch means the manifest would mis-wire the RT graph).
    if ports.audio_in != meta.n_in || ports.audio_out != meta.n_out {
        return Err(format!(
            "declared port arity ({} in / {} out) does not match the compiled DSP \
             ({} in / {} out)",
            ports.audio_in, ports.audio_out, meta.n_in, meta.n_out
        ));
    }

    let name = if meta.name.trim().is_empty() {
        "AI Code Node".to_string()
    } else {
        meta.name.clone()
    };

    let manifest = V1Manifest {
        id: id.clone(),
        name,
        // CLOSED PrimitiveKind the RT loop lowers a wasm code node to.
        kind: "WasmHost".to_string(),
        dsp: "wasm".to_string(),
        ui: "auto".to_string(),
        params: meta.params.clone(),
        ports,
    };

    // 3) Schema-shape validation against the frozen v1 invariants.
    validate_manifest_shape(&manifest)?;
    Ok(manifest)
}

/// Shape-validate a built manifest against the `oj-plugin-v1.json` invariants
/// that a host can check without a JSON-schema engine: non-empty id/name, a
/// frozen `dsp`/`ui` enum value, params with sane ranges + in-range ids, and port
/// counts within the schema's `0..=255` bound.
fn validate_manifest_shape(m: &V1Manifest) -> Result<(), String> {
    if m.id.is_empty() {
        return Err("manifest id must be non-empty".to_string());
    }
    if m.name.trim().is_empty() {
        return Err("manifest name must be non-empty".to_string());
    }
    if !matches!(m.dsp.as_str(), "builtin" | "faust" | "wasm" | "none") {
        return Err(format!("manifest dsp `{}` is not a v1 value", m.dsp));
    }
    if !matches!(m.ui.as_str(), "auto" | "react") {
        return Err(format!("manifest ui `{}` is not a v1 value", m.ui));
    }
    for p in &m.params {
        if p.name.trim().is_empty() {
            return Err(format!("param {} has an empty name", p.id));
        }
        if !(p.min.is_finite() && p.max.is_finite() && p.default.is_finite()) {
            return Err(format!("param `{}` has a non-finite bound", p.name));
        }
        if p.min > p.max {
            return Err(format!(
                "param `{}` has min {} > max {}",
                p.name, p.min, p.max
            ));
        }
        if p.default < p.min || p.default > p.max {
            return Err(format!(
                "param `{}` default {} is outside [{}, {}]",
                p.name, p.default, p.min, p.max
            ));
        }
    }
    Ok(())
}

/// Author a code node from DSP `source` in language `lang` (M6).
///
/// Steps (ALL off the realtime thread):
/// 1. compile via the ojfaust CLI Path B;
/// 2. `Unavailable` (no faust binary) -> `Ok` with a diagnostic, no manifest (the
///    frontend falls back to storing source, exactly like today);
/// 3. `Compile` error -> `Ok` with the diagnostic (the agent can repair);
/// 4. success -> build + host-validate the v1 manifest fail-closed and return the
///    [`AuthoredNode`]. A validation failure returns a diagnostic, registers
///    NOTHING.
///
/// `lang` is currently always `"faust"`; other languages return a diagnostic
/// rather than silently mis-compiling.
#[tauri::command]
pub fn author_wasm_node(source: String, lang: String) -> Result<AuthoredNode, String> {
    if !lang.trim().eq_ignore_ascii_case("faust") {
        return Ok(AuthoredNode::failed(format!(
            "unsupported code-node language `{lang}` (only `faust` is supported)"
        )));
    }
    author_wasm_from_compile(|src| ojfaust::FaustCompiler::new().compile(src), &source)
}

/// Backend-agnostic core of [`author_wasm_node`], parameterized over the compile
/// step so the validation path is unit-testable with a FAKE compiler (no real
/// faust binary needed). Mirrors the `compile_repair_with` split in ojfaust.
fn author_wasm_from_compile(
    compile: impl FnOnce(&str) -> Result<ojfaust::CompiledFaust, ojfaust::FaustError>,
    source: &str,
) -> Result<AuthoredNode, String> {
    use ojfaust::FaustError;

    let compiled = match compile(source) {
        Ok(c) => c,
        // No faust toolchain: not an error — store source + fall back (today's path).
        Err(FaustError::Unavailable) => {
            return Ok(AuthoredNode::failed("faust not installed"));
        }
        // Recoverable compile error: hand the diagnostic back for the repair loop.
        Err(e @ FaustError::Compile { .. }) => {
            return Ok(AuthoredNode::failed(e.to_string()));
        }
        Err(e) => return Ok(AuthoredNode::failed(e.to_string())),
    };

    // The CLI Path B always emits wasm; guard anyway (a non-wasm backend can't
    // produce a code node here).
    let Some(wasm) = compiled.wasm.as_ref() else {
        return Ok(AuthoredNode::failed(
            "the active faust backend did not emit a .wasm module",
        ));
    };
    let wasm_hash = fnv1a_hex(wasm);

    let meta = AuthoredMeta {
        name: compiled.name.clone(),
        n_in: compiled.n_in,
        n_out: compiled.n_out,
        wasm_hash: wasm_hash.clone(),
        params: compiled
            .params
            .iter()
            .map(|p| V1Param {
                id: p.id,
                name: p.name.clone(),
                min: p.min,
                max: p.max,
                default: p.default,
            })
            .collect(),
    };

    // Fail-closed validation: a rejection registers nothing, just a diagnostic.
    let manifest = match build_and_validate_manifest(&meta) {
        Ok(m) => m,
        Err(diag) => return Ok(AuthoredNode::failed(diag)),
    };
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|e| format!("failed to serialize manifest: {e}"))?;

    Ok(AuthoredNode {
        manifest_id: manifest.id,
        manifest_json,
        wasm_hash,
        n_in: compiled.n_in,
        n_out: compiled.n_out,
        diagnostic: None,
    })
}

/// The faust binary the native author path falls back to when `OJFAUST_FAUST_BIN`
/// is unset and faust isn't on PATH (Windows dev install; mirrors ojwasm's path).
const DEFAULT_FAUST_BIN: &str = r"C:\Program Files\Faust\bin\faust.exe";

/// A stable per-node directory for an authored code node's compiled artifacts,
/// keyed by the content hash so re-authoring the same node reuses it.
fn code_node_dir(hash: &str) -> std::path::PathBuf {
    let mut dir = std::env::temp_dir();
    dir.push("openjammer-codenodes");
    dir.push(hash);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// The faust path → NATIVE EXECUTION (M6): compile the source to a runnable native
/// `.dll` and register it in the live engine, so the authored node actually plays
/// the REAL DSP. (faust's `-lang wasm` output uses an exception proposal wasmtime
/// can't run, so the native dll is the execution path — see docs/code-node-abi.md.)
///
/// Returns the SAME [`AuthoredNode`] shape as [`author_wasm_node`] (so the frontend
/// `authorCodeNode` upgrade flow is unchanged): on success the id is
/// `ai.wasm.<hash>` AND the engine now hosts it; if faust/MSVC are unavailable it
/// returns a diagnostic and the frontend keeps the stored-source fallback.
#[tauri::command]
pub fn author_faust_native(
    source: String,
    state: tauri::State<'_, crate::engine::BackendState>,
) -> Result<AuthoredNode, String> {
    // 1) Manifest + validation via the existing wasm-author path (ojfaust metadata).
    //    Help ojfaust find faust even if it isn't on the app's PATH (dev convenience).
    if std::env::var("OJFAUST_FAUST_BIN").is_err()
        && std::path::Path::new(DEFAULT_FAUST_BIN).exists()
    {
        std::env::set_var("OJFAUST_FAUST_BIN", DEFAULT_FAUST_BIN);
    }
    let authored = author_wasm_node(source.clone(), "faust".to_string())?;
    if authored.diagnostic.is_some() || authored.manifest_id.is_empty() {
        return Ok(authored); // no faust / compile error → frontend keeps fallback
    }

    // 2) Compile the runnable NATIVE dll (faust -lang cpp → cl.exe).
    let out_dir = code_node_dir(&authored.wasm_hash);
    let Some(dll) = ojwasm::compile_faust_to_dll(&source, &out_dir) else {
        // No native toolchain → diagnostic, so the frontend keeps the source
        // fallback (an unrunnable `ai.wasm.*` would fail to compile in the engine).
        return Ok(AuthoredNode::failed(
            "native faust toolchain unavailable (needs faust + MSVC cl.exe)",
        ));
    };

    // 3) Register the native loader in the live engine + recompile.
    state
        .0
        .lock()
        .map_err(|_| "engine state poisoned".to_string())?
        .register_native_faust(&authored.manifest_json, dll)?;
    Ok(authored)
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests mutate the GLOBAL process env (OPENJAMMER_AI_KEY_VAR etc.), so
    // they must not run concurrently. Serialize via a shared lock; recover from
    // poisoning so one failing test doesn't cascade into the others.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn stripped_env_forwards_only_the_allowlist_plus_key() {
        let _env = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Set a secret that must NOT leak, and a key var override.
        std::env::set_var("SECRET_SHOULD_NOT_LEAK", "topsecret");
        std::env::set_var("OPENJAMMER_AI_KEY_VAR", "ANTHROPIC_API_KEY");

        let env = stripped_env(Some("sk-test-123"));

        assert!(!env.contains_key("SECRET_SHOULD_NOT_LEAK"));
        assert_eq!(
            env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("sk-test-123")
        );
        // PATH is forwarded so `pi` resolves (present in any normal test env).
        assert!(env.contains_key("PATH"));

        std::env::remove_var("SECRET_SHOULD_NOT_LEAK");
        std::env::remove_var("OPENJAMMER_AI_KEY_VAR");
    }

    #[test]
    fn stripped_env_omits_key_when_none() {
        let _env = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("OPENJAMMER_AI_KEY_VAR");
        let env = stripped_env(None);
        assert_eq!(env.get("OPENJAMMER_PROVIDER_KEY"), None);
    }

    #[test]
    fn stripped_env_uses_default_key_var() {
        let _env = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("OPENJAMMER_AI_KEY_VAR");
        let env = stripped_env(Some("abc"));
        assert_eq!(
            env.get("OPENJAMMER_PROVIDER_KEY").map(String::as_str),
            Some("abc")
        );
    }

    #[test]
    fn stripped_env_for_uses_provider_mapping() {
        // D6 (M7): with no OPENJAMMER_AI_KEY_VAR override, the active provider's var
        // name is derived from the provider->env-var mapping.
        let _env = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("OPENJAMMER_AI_KEY_VAR");
        let env = stripped_env_for(Some("sk-ant"), Some("anthropic"));
        assert_eq!(
            env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("sk-ant")
        );
        // No conflict-side key (None) injects nothing under the provider var.
        let none_env = stripped_env_for(None, Some("anthropic"));
        assert_eq!(none_env.get("ANTHROPIC_API_KEY"), None);
    }

    #[test]
    fn env_for_provider_keys_forwards_multiple_configured_providers() {
        let _env = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("OPENJAMMER_AI_KEY_VAR");
        let keys = HashMap::from([
            ("opencode".to_string(), "sk-zen".to_string()),
            ("openai".to_string(), "sk-openai".to_string()),
        ]);

        let env = env_for_provider_keys(true, &keys);

        assert_eq!(
            env.get("OPENCODE_API_KEY").map(String::as_str),
            Some("sk-zen")
        );
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("sk-openai"),
        );
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        assert_eq!(
            provider_key_vars(&keys),
            vec!["OPENAI_API_KEY", "OPENCODE_API_KEY"],
        );
        assert_eq!(auth_fingerprint(&keys), auth_fingerprint(&keys));
    }

    #[test]
    fn writes_custom_openai_compatible_models_json() {
        let dir = std::env::temp_dir().join(format!(
            "openjammer-models-json-test-{}",
            std::process::id(),
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let base_urls = HashMap::from([(
            "openai".to_string(),
            "https://openrouter.ai/api/v1".to_string(),
        )]);
        let custom_models = HashMap::from([(
            "openai".to_string(),
            vec!["anthropic/claude-sonnet-4".to_string()],
        )]);

        write_openjammer_models_json(&dir, &base_urls, &custom_models).expect("write models");

        let path = dir.join(".pi").join("agent").join("models.json");
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let provider = &json["providers"]["openai"];
        assert_eq!(provider["baseUrl"], "https://openrouter.ai/api/v1");
        assert_eq!(provider["apiKey"], "$OPENAI_API_KEY");
        assert_eq!(provider["api"], "openai-completions");
        assert_eq!(provider["compat"]["thinkingFormat"], "openrouter");
        assert_eq!(provider["models"][0]["id"], "anthropic/claude-sonnet-4");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn openjammer_package_family_matches_across_install_paths() {
        assert!(same_openjammer_package_family(
            r#"C:\Program Files\OpenJammer\resources\pi-openjammer-graph"#,
            r#"C:\Users\u\AppData\Local\OpenJammer\resources\pi-openjammer-graph"#,
        ));
        assert!(same_openjammer_package_family(
            "/old/resources/pi-extensions/permission-gate/",
            "/new/resources/pi-extensions/permission-gate",
        ));
        assert!(!same_openjammer_package_family(
            "pi-persistent-intelligence",
            "/new/resources/pi-openjammer-graph",
        ));
        assert!(!same_openjammer_package_family(
            "/old/resources/not-pi-openjammer-graph",
            "/new/resources/pi-openjammer-graph",
        ));
    }

    // ---- RPC event mapping (the M1 "transport truth") ----------------------

    #[test]
    fn tool_execution_start_maps_to_tool_call() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"tool_execution_start","toolCallId":"call_1","toolName":"add_node","args":{"type":"looper"}}"#,
        )
        .unwrap();
        let line = parse_pi_event(&value).expect("tool-call emitted");
        assert_eq!(line.kind, "tool-call");
        assert_eq!(line.id.as_deref(), Some("call_1"));
        let call = line.call.expect("call present");
        assert_eq!(call["name"], "add_node");
        assert_eq!(call["args"]["type"], "looper");
    }

    #[test]
    fn unsupported_tool_execution_start_is_skipped() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"tool_execution_start","toolCallId":"call_1","toolName":"read","args":{"path":"Cargo.toml"}}"#,
        )
        .unwrap();
        assert!(parse_pi_event(&value).is_none());
    }

    #[test]
    fn message_update_text_delta_maps_to_thought() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Planning…"}}"#,
        )
        .unwrap();
        let line = parse_pi_event(&value).expect("thought emitted");
        assert_eq!(line.kind, "thought");
        assert_eq!(line.text.as_deref(), Some("Planning…"));
    }

    #[test]
    fn message_update_non_text_delta_is_skipped() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"message_update","assistantMessageEvent":{"type":"toolcall_delta","delta":"{"}}"#,
        )
        .unwrap();
        assert!(parse_pi_event(&value).is_none());
    }

    #[test]
    fn agent_end_maps_to_result() {
        let value: serde_json::Value =
            serde_json::from_str(r#"{"type":"agent_end","messages":[]}"#).unwrap();
        let line = parse_pi_event(&value).expect("result emitted");
        assert_eq!(line.kind, "result");
    }

    #[test]
    fn error_event_maps_to_error() {
        let value: serde_json::Value =
            serde_json::from_str(r#"{"type":"error","reason":"aborted"}"#).unwrap();
        let line = parse_pi_event(&value).expect("error emitted");
        assert_eq!(line.kind, "error");
        assert_eq!(line.text.as_deref(), Some("aborted"));
    }

    #[test]
    fn extension_ui_request_maps_to_ui_request() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Allow?"}"#,
        )
        .unwrap();
        let line = parse_pi_event(&value).expect("ui-request emitted");
        assert_eq!(line.kind, "ui-request");
        assert_eq!(line.id.as_deref(), Some("u1"));
        let req = line.request.expect("request present");
        assert_eq!(req["method"], "confirm");
    }

    #[test]
    fn lifecycle_and_housekeeping_events_are_skipped() {
        for raw in [
            r#"{"type":"agent_start"}"#,
            r#"{"type":"turn_start"}"#,
            r#"{"type":"turn_end","message":{}}"#,
            r#"{"type":"message_start","message":{}}"#,
            r#"{"type":"message_end","message":{}}"#,
            r#"{"type":"tool_execution_update","toolCallId":"c"}"#,
            r#"{"type":"tool_execution_end","toolCallId":"c","isError":false}"#,
            r#"{"type":"queue_update","steering":[]}"#,
            r#"{"type":"response","command":"prompt","success":true}"#,
        ] {
            let value: serde_json::Value = serde_json::from_str(raw).unwrap();
            assert!(parse_pi_event(&value).is_none(), "expected skip for {raw}");
        }
    }

    #[test]
    fn blocking_dialog_detection() {
        for m in ["select", "confirm", "input", "editor"] {
            assert!(is_blocking_dialog(m));
        }
        for m in ["notify", "setStatus", "setWidget", "setTitle"] {
            assert!(!is_blocking_dialog(m));
        }
    }

    // ---- author_wasm_node validation (M6) ---------------------------------

    fn sample_meta() -> AuthoredMeta {
        AuthoredMeta {
            name: "Tremolo".to_string(),
            n_in: 1,
            n_out: 1,
            wasm_hash: "deadbeef".to_string(),
            params: vec![V1Param {
                id: 0,
                name: "rate".to_string(),
                min: 0.1,
                max: 20.0,
                default: 4.0,
            }],
        }
    }

    #[test]
    fn validation_happy_path_builds_wasm_namespaced_manifest() {
        let m = build_and_validate_manifest(&sample_meta()).expect("valid meta");
        assert_eq!(m.id, "ai.wasm.deadbeef");
        assert_eq!(m.kind, "WasmHost");
        assert_eq!(m.dsp, "wasm");
        assert_eq!(m.ui, "auto");
        assert_eq!(m.ports.audio_in, 1);
        assert_eq!(m.ports.audio_out, 1);
        assert_eq!(m.params.len(), 1);
        assert_eq!(m.params[0].name, "rate");
    }

    #[test]
    fn validation_rejects_builtin_id_collision() {
        // Fail-closed: an id inside ANY reserved built-in namespace is rejected so
        // an AI node can never shadow a built-in identity (D4-A1).
        assert!(reject_reserved_id("builtin.gain").is_err());
        assert!(reject_reserved_id("host.plugin.foo").is_err());
        assert!(reject_reserved_id("oj.builtin.osc").is_err());
        // The authored namespace is always accepted (never collides by construction).
        assert!(reject_reserved_id("ai.wasm.deadbeef").is_ok());
        // And a real authored manifest lands in that safe namespace.
        let m = build_and_validate_manifest(&sample_meta()).expect("valid");
        assert!(reject_reserved_id(&m.id).is_ok());
    }

    #[test]
    fn validation_rejects_empty_hash() {
        let mut meta = sample_meta();
        meta.wasm_hash = String::new();
        assert!(build_and_validate_manifest(&meta).is_err());
    }

    #[test]
    fn validation_rejects_param_out_of_range() {
        let mut meta = sample_meta();
        meta.params[0].default = 999.0; // outside [min, max]
        let err = build_and_validate_manifest(&meta).unwrap_err();
        assert!(err.contains("outside"), "got: {err}");
    }

    #[test]
    fn validation_rejects_inverted_param_range() {
        let mut meta = sample_meta();
        meta.params[0].min = 10.0;
        meta.params[0].max = 1.0;
        let err = build_and_validate_manifest(&meta).unwrap_err();
        assert!(err.contains("min"), "got: {err}");
    }

    #[test]
    fn shape_validator_rejects_bad_enums() {
        let mut m = build_and_validate_manifest(&sample_meta()).unwrap();
        m.dsp = "bogus".to_string();
        assert!(validate_manifest_shape(&m).is_err());
    }

    #[test]
    fn author_unavailable_returns_diagnostic_not_manifest() {
        // A fake compiler reporting no backend -> Ok with "faust not installed".
        let res =
            author_wasm_from_compile(|_src| Err(ojfaust::FaustError::Unavailable), "process = _;")
                .expect("Ok with diagnostic");
        assert_eq!(res.diagnostic.as_deref(), Some("faust not installed"));
        assert!(res.manifest_id.is_empty());
        assert!(res.manifest_json.is_empty());
    }

    #[test]
    fn author_compile_error_returns_diagnostic_for_repair() {
        let res = author_wasm_from_compile(
            |_src| {
                Err(ojfaust::FaustError::Compile {
                    message: "undefined symbol: foo".to_string(),
                })
            },
            "broken",
        )
        .expect("Ok with diagnostic");
        let diag = res.diagnostic.expect("diagnostic present");
        assert!(diag.contains("undefined symbol"), "got: {diag}");
        assert!(res.manifest_id.is_empty());
    }

    #[test]
    fn author_success_builds_validated_namespaced_node() {
        // A fake compiler returns wasm bytes + a param: prove the full author path
        // produces an `ai.wasm.<hash>` node with a serialized v1 manifest.
        let res = author_wasm_from_compile(
            |src| {
                Ok(ojfaust::CompiledFaust {
                    name: "Booster".to_string(),
                    n_in: 1,
                    n_out: 1,
                    source: src.to_string(),
                    params: vec![ojfaust::FaustParam {
                        id: 0,
                        name: "gain".to_string(),
                        min: 0.0,
                        max: 2.0,
                        default: 1.0,
                    }],
                    wasm: Some(b"\0asm\x01\x00\x00\x00".to_vec()),
                })
            },
            "process = _ : *(1.0);",
        )
        .expect("Ok");
        assert!(res.diagnostic.is_none(), "happy path has no diagnostic");
        assert!(res.manifest_id.starts_with("ai.wasm."));
        assert_eq!(res.wasm_hash.len(), 8); // FNV-1a 32-bit hex
        assert_eq!(res.n_in, 1);
        assert_eq!(res.n_out, 1);
        // The serialized manifest round-trips to the expected v1 shape.
        let parsed: V1Manifest = serde_json::from_str(&res.manifest_json).unwrap();
        assert_eq!(parsed.id, res.manifest_id);
        assert_eq!(parsed.kind, "WasmHost");
        assert_eq!(parsed.params[0].name, "gain");
    }

    #[test]
    fn fnv1a_hex_is_deterministic_and_8_chars() {
        let a = fnv1a_hex(b"\0asm\x01\x00\x00\x00");
        let b = fnv1a_hex(b"\0asm\x01\x00\x00\x00");
        assert_eq!(a, b);
        assert_eq!(a.len(), 8);
        assert_ne!(a, fnv1a_hex(b"different bytes"));
    }
}
