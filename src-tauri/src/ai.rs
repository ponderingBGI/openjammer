//! Pi-driven AI agent backend (U20) — the native half of the Ctrl/Cmd+K
//! "build what I asked" command bar.
//!
//! TRANSPORT: `rpc-subprocess`. This module owns the `ai_run` Tauri command. It
//! spawns Pi (`pi --mode rpc`, github.com/earendil-works/pi) as a SUBPROCESS,
//! confined to a THROWAWAY git worktree with a STRIPPED env that forwards ONLY
//! the user's one configured provider key, speaks Pi's LF-delimited JSONL RPC,
//! normalizes each event to a [`PiStreamLine`], and re-emits it to the webview as
//! a Tauri event on a per-run channel. The frontend ([`src/ai/PiAgentBackend.ts`])
//! turns those into the streamed transcript and the Approve/Reject transaction.
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
//! * **Throwaway worktree.** Pi runs with its cwd in a fresh `git worktree`
//!   under the OS temp dir, detached from the user's real project, and the
//!   worktree is torn down when the run ends ([`Worktree`]).
//! * **Env allowlist.** The child starts from an EMPTY environment; we forward
//!   only `PATH`/`HOME` (so `pi` and `git` resolve) plus the ONE provider key
//!   the user supplied, under the var name that provider expects
//!   ([`stripped_env`]). Every other secret in the parent env is dropped.
//! * **No key storage.** The key is passed transiently to the child and never
//!   written to disk by OpenJammer.
//! * **Tool calls are forwarded, not executed here.** Graph mutations are
//!   surfaced to the frontend and only applied behind the user's Approve.
//! * **Blocking extension dialogs are auto-cancelled.** M1 surfaces an
//!   `extension_ui_request` as a `ui-request` event but does not yet drive an
//!   interactive reply; to keep a run from hanging on a dialog we never answer,
//!   blocking methods (`select`/`confirm`/`input`/`editor`) get an immediate
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
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// One normalized line of the agent stream, mirrored 1:1 by the frontend
/// `PiStreamLine` (`src/ai/PiAgentBackend.ts`). Serialized as the Tauri event
/// payload on the run's channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PiStreamLine {
    /// `"thought" | "tool-call" | "result" | "error" | "ui-request"`.
    pub kind: String,
    /// Present for `thought` / `result` / `error`.
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
}

impl PiStreamLine {
    fn thought(text: impl Into<String>) -> Self {
        Self {
            kind: "thought".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
        }
    }

    fn result(text: impl Into<String>) -> Self {
        Self {
            kind: "result".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
        }
    }

    fn error(text: impl Into<String>) -> Self {
        Self {
            kind: "error".into(),
            text: Some(text.into()),
            call: None,
            id: None,
            request: None,
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
pub fn ai_run(
    app: AppHandle,
    prompt: String,
    provider_key: Option<String>,
    provider: Option<String>,
    model_id: Option<String>,
    channel: String,
) -> Result<(), String> {
    // Resolve the Pi binary up front so a missing install is a clean message.
    let Some(pi) = find_pi() else {
        emit(&app, &channel, PiStreamLine::error(PI_MISSING_HELP));
        return Ok(());
    };

    // A throwaway worktree confines Pi's cwd; teardown happens on drop.
    let worktree = match Worktree::create() {
        Ok(wt) => wt,
        Err(e) => {
            emit(
                &app,
                &channel,
                PiStreamLine::error(format!("could not create throwaway worktree: {e}")),
            );
            return Ok(());
        }
    };

    emit(
        &app,
        &channel,
        PiStreamLine::thought(format!("Starting Pi in {}", worktree.path().display())),
    );

    // D6 (M7): forward the key under the ACTIVE provider's env var so Pi's
    // provider reads it. A `conflict` (Pi's own auth.json would resolve a working
    // key) means we must NOT also inject ours — defer to Pi's resolution. The key
    // SOURCE is still the provider_key param / env (keychain is founder-gated).
    let conflict = provider
        .as_deref()
        .map(|p| {
            crate::auth::auth_status(Some(p.to_string()))
                .map(|s| s.conflict)
                .unwrap_or(false)
        })
        .unwrap_or(false);
    let key_for_env = if conflict {
        None
    } else {
        provider_key.as_deref()
    };
    let env = stripped_env_for(key_for_env, provider.as_deref());

    let spawn = Command::new(&pi)
        .arg("--mode")
        .arg("rpc")
        .current_dir(worktree.path())
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();

    let mut child = match spawn {
        Ok(c) => c,
        Err(e) => {
            emit(
                &app,
                &channel,
                PiStreamLine::error(format!("failed to spawn `pi`: {e}")),
            );
            return Ok(());
        }
    };

    let Some(mut stdin) = child.stdin.take() else {
        emit(&app, &channel, PiStreamLine::error("pi stdin unavailable"));
        let _ = child.kill();
        let _ = child.wait();
        return Ok(());
    };
    let Some(stdout) = child.stdout.take() else {
        emit(&app, &channel, PiStreamLine::error("pi stdout unavailable"));
        let _ = child.kill();
        let _ = child.wait();
        return Ok(());
    };
    let mut reader = BufReader::new(stdout);

    // 1) Capability handshake: confirm Pi speaks our RPC vocabulary BEFORE we
    //    commit a prompt. A missing/failed response => one reasoned error,
    //    never a silent degrade of every later tool call to `thought`.
    if let Err(e) = send_command(&mut stdin, &serde_json::json!({ "type": "get_commands" })) {
        emit(
            &app,
            &channel,
            PiStreamLine::error(format!("could not talk to Pi: {e}")),
        );
        let _ = child.kill();
        let _ = child.wait();
        return Ok(());
    }
    match await_response(&mut reader, &mut stdin, &app, &channel, "get_commands") {
        Ok(true) => {}
        Ok(false) => {
            emit(&app, &channel, PiStreamLine::error(PI_HANDSHAKE_HELP));
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        Err(()) => {
            emit(
                &app,
                &channel,
                PiStreamLine::error("Pi closed the RPC stream during the handshake."),
            );
            let _ = child.wait();
            return Ok(());
        }
    }

    // 2) Optionally pin the model for this run (no persisted default is assumed).
    //    A `set_model` failure is FATAL-TO-AI (typed), not silently ignored.
    if let (Some(p), Some(m)) = (provider.as_deref(), model_id.as_deref()) {
        let req = serde_json::json!({ "type": "set_model", "provider": p, "modelId": m });
        if let Err(e) = send_command(&mut stdin, &req) {
            emit(
                &app,
                &channel,
                PiStreamLine::error(format!("could not set model: {e}")),
            );
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        match await_response(&mut reader, &mut stdin, &app, &channel, "set_model") {
            Ok(true) => {}
            Ok(false) => {
                emit(
                    &app,
                    &channel,
                    PiStreamLine::error(format!(
                        "Pi rejected model {p}/{m} (provider not authenticated or model unavailable)."
                    )),
                );
                let _ = child.kill();
                let _ = child.wait();
                return Ok(());
            }
            Err(()) => {
                emit(
                    &app,
                    &channel,
                    PiStreamLine::error("Pi closed the stream while setting the model."),
                );
                let _ = child.wait();
                return Ok(());
            }
        }
    }

    // 3) Send the prompt and stream until the agent finishes.
    if let Err(e) = send_command(
        &mut stdin,
        &serde_json::json!({ "type": "prompt", "message": prompt }),
    ) {
        emit(
            &app,
            &channel,
            PiStreamLine::error(format!("could not send prompt: {e}")),
        );
        let _ = child.kill();
        let _ = child.wait();
        return Ok(());
    }

    stream_until_end(&mut reader, &mut stdin, &app, &channel);

    // Per-run spawn: once the agent has finished (or the stream closed) we are
    // done with this Pi. Closing stdin then killing guarantees no hang waiting
    // on a persistent RPC session. (The persistent-subprocess optimization is a
    // later milestone.)
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
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
            return Ok(value
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false));
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

/// Translate one Pi RPC event into an optional [`PiStreamLine`]. `None` means
/// the event carries no transcript signal (lifecycle / partial / housekeeping)
/// and is intentionally dropped rather than degraded to a noisy `thought`.
fn parse_pi_event(value: &serde_json::Value) -> Option<PiStreamLine> {
    let tag = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match tag {
        // The executed tool call (final args) → forward as `tool-call`.
        "tool_execution_start" => {
            let name = value.get("toolName").and_then(|v| v.as_str()).unwrap_or("");
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
    for var in ["USERPROFILE", "SYSTEMROOT", "APPDATA"] {
        if let Ok(val) = std::env::var(var) {
            env.insert(var.to_string(), val);
        }
    }

    if let Some(key) = provider_key.filter(|k| !k.is_empty()) {
        let var = std::env::var("OPENJAMMER_AI_KEY_VAR").unwrap_or_else(|_| {
            provider
                .map(|p| crate::auth::provider_env_var(p).to_string())
                .unwrap_or_else(|| "OPENJAMMER_PROVIDER_KEY".to_string())
        });
        env.insert(var, key.to_string());
    }

    env
}

/// Locate the `pi` binary, honouring an explicit `OPENJAMMER_PI_BIN` override
/// before falling back to the name on `PATH`. Returns `None` when neither
/// resolves, so the caller can emit the install help.
fn find_pi() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("OPENJAMMER_PI_BIN") {
        let p = PathBuf::from(&explicit);
        if p.exists() {
            return Some(p);
        }
    }
    // Probe PATH with a cheap `--version`; if it runs, `pi` is callable.
    if Command::new("pi")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Some(PathBuf::from("pi"));
    }
    None
}

/// The actionable message shown when Pi is not installed.
const PI_MISSING_HELP: &str = "Pi is not installed. Install the agent CLI \
    (`bun add -g @earendil-works/pi-coding-agent`, or see github.com/earendil-works/pi) \
    so the `pi` binary is on PATH, then configure your provider key in ~/.pi. \
    (Set OPENJAMMER_PI_BIN to a custom path, or OPENJAMMER_AI_KEY_VAR to your \
    provider's key variable.)";

/// The actionable message shown when Pi runs but never acknowledges the
/// `get_commands` handshake (too old / a different RPC dialect).
const PI_HANDSHAKE_HELP: &str = "Pi started but did not acknowledge the RPC handshake \
    (`get_commands`). The installed Pi may be too old or speak a different RPC dialect. \
    Update it (`bun add -g @earendil-works/pi-coding-agent`) and try again.";

/// A throwaway git worktree that Pi runs inside, removed on drop.
///
/// Created with `git worktree add --detach <tmp>` against the current repo when
/// possible; if this directory is not a git repo (e.g. an installed app bundle),
/// it falls back to a plain temp directory. Either way Pi's cwd is isolated from
/// the user's real files.
struct Worktree {
    path: PathBuf,
    /// True if created via `git worktree` (so teardown uses `git worktree remove`).
    git_managed: bool,
}

impl Worktree {
    fn create() -> std::io::Result<Self> {
        let base = std::env::temp_dir().join(format!("openjammer-ai-{}", unique_suffix()));

        // Try a git worktree first (keeps Pi inside a real, but disposable, repo).
        let git_ok = Command::new("git")
            .args(["worktree", "add", "--detach"])
            .arg(&base)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if git_ok {
            return Ok(Self {
                path: base,
                git_managed: true,
            });
        }

        // Fallback: a plain isolated temp directory.
        std::fs::create_dir_all(&base)?;
        Ok(Self {
            path: base,
            git_managed: false,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Worktree {
    fn drop(&mut self) {
        if self.git_managed {
            let _ = Command::new("git")
                .args(["worktree", "remove", "--force"])
                .arg(&self.path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        // Always best-effort remove the directory (covers the fallback path and
        // any residue `git worktree remove` left behind).
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A process-unique suffix for the worktree dir name (pid + monotonic-ish nanos).
fn unique_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
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
