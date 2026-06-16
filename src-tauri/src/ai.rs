//! Pi-driven AI agent backend (U20) — the native half of the Ctrl/Cmd+K
//! "build what I asked" command bar.
//!
//! TRANSPORT: `rpc-subprocess`. This module owns the `ai_run` Tauri command. It
//! spawns Pi (`pi --mode rpc`, github.com/earendil-works/pi) as a SUBPROCESS,
//! confined to a THROWAWAY git worktree with a STRIPPED env that forwards ONLY
//! the user's one configured provider key, reads Pi's LF-delimited JSONL stream,
//! normalizes each line to a [`PiStreamLine`], and re-emits it to the webview as
//! a Tauri event on a per-run channel. The frontend ([`src/ai/PiAgentBackend.ts`])
//! turns those into the streamed transcript and the Approve/Reject transaction.
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
//!
//! # Reality / fallback
//!
//! Pi is NOT assumed installed and there is no key in CI. When `pi` is not on
//! `PATH`, [`ai_run`] emits a single terminal `error` line telling the founder
//! exactly what to install, then returns `Ok(())` — it never panics or blocks.
//! The full tool-call -> graph-verb path is proven with Pi MOCKED on the
//! frontend (`src/ai/__tests__`, `src/store/__tests__/agentSessionStore.test.ts`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
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
    /// `"thought" | "tool-call" | "result" | "error"`.
    pub kind: String,
    /// Present for `thought` / `result` / `error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Present for `tool-call`: the raw JSON of the proposed call, forwarded
    /// verbatim for the frontend to interpret against its tool schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call: Option<serde_json::Value>,
    /// Present for `tool-call`: a stable id within the run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

impl PiStreamLine {
    fn thought(text: impl Into<String>) -> Self {
        Self {
            kind: "thought".into(),
            text: Some(text.into()),
            call: None,
            id: None,
        }
    }

    fn result(text: impl Into<String>) -> Self {
        Self {
            kind: "result".into(),
            text: Some(text.into()),
            call: None,
            id: None,
        }
    }

    fn error(text: impl Into<String>) -> Self {
        Self {
            kind: "error".into(),
            text: Some(text.into()),
            call: None,
            id: None,
        }
    }
}

/// Spawn Pi for one task and stream its output to `channel`.
///
/// `prompt` is the user's natural-language request. `provider_key` is the user's
/// own provider API key (forwarded under the allowlist; never stored). `channel`
/// is the per-run Tauri event name the frontend subscribed to.
///
/// Always returns `Ok(())`: failures (Pi missing, spawn error, key missing) are
/// streamed as a terminal `error` line so the UI surfaces them uniformly.
#[tauri::command]
pub fn ai_run(
    app: AppHandle,
    prompt: String,
    provider_key: Option<String>,
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

    let env = stripped_env(provider_key.as_deref());

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

    // Send the task to Pi over stdin as a single RPC request, then close stdin.
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let request = serde_json::json!({ "type": "run", "prompt": prompt });
        let _ = writeln!(stdin, "{request}");
        // dropping `stdin` closes Pi's input.
    }

    // Read Pi's LF-delimited JSONL stdout. CRITICAL: split ONLY on '\n'.
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(raw) = line else { break };
            if raw.trim().is_empty() {
                continue;
            }
            emit(&app, &channel, parse_pi_line(&raw));
        }
    }

    let _ = child.wait();
    emit(&app, &channel, PiStreamLine::result("Agent run complete."));
    Ok(())
}

/// Translate one raw Pi RPC line into a [`PiStreamLine`].
///
/// Pi's RPC schema is not pinned here (it evolves), so this is DEFENSIVE: it
/// recognizes the line shapes OpenJammer cares about and degrades anything else
/// to a `thought` carrying the raw text, so nothing is silently lost. The
/// founder can tighten this once they pin a Pi version (see README).
fn parse_pi_line(raw: &str) -> PiStreamLine {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        // Not JSON — treat as narration.
        return PiStreamLine::thought(raw.to_string());
    };

    // Pi RPC events carry a "type" (or "kind") tag; map the ones we model.
    let tag = value
        .get("type")
        .or_else(|| value.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match tag {
        // A tool/function call Pi wants to make → forward the call payload.
        "tool_call" | "tool-call" | "function_call" => {
            let call = value
                .get("call")
                .or_else(|| value.get("arguments"))
                .or_else(|| value.get("function"))
                .cloned()
                .unwrap_or(value.clone());
            let id = value
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            PiStreamLine {
                kind: "tool-call".into(),
                text: None,
                call: Some(call),
                id,
            }
        }
        // Terminal completion.
        "result" | "done" | "complete" => {
            PiStreamLine::result(text_field(&value).unwrap_or_else(|| "Done.".into()))
        }
        // An error from Pi / the provider.
        "error" => PiStreamLine::error(text_field(&value).unwrap_or_else(|| "Pi error.".into())),
        // Reasoning / assistant text, or anything unrecognized.
        _ => PiStreamLine::thought(text_field(&value).unwrap_or_else(|| raw.to_string())),
    }
}

/// Extract a human-readable text field from a Pi line, trying common keys.
fn text_field(value: &serde_json::Value) -> Option<String> {
    for key in ["text", "message", "content", "summary", "delta"] {
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
fn stripped_env(provider_key: Option<&str>) -> HashMap<String, String> {
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
        let var = std::env::var("OPENJAMMER_AI_KEY_VAR")
            .unwrap_or_else(|_| "OPENJAMMER_PROVIDER_KEY".to_string());
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
    fn parse_tool_call_line_forwards_the_call() {
        let raw =
            r#"{"type":"tool_call","id":"c1","call":{"name":"add_node","args":{"type":"looper"}}}"#;
        let line = parse_pi_line(raw);
        assert_eq!(line.kind, "tool-call");
        assert_eq!(line.id.as_deref(), Some("c1"));
        let call = line.call.expect("call present");
        assert_eq!(call["name"], "add_node");
        assert_eq!(call["args"]["type"], "looper");
    }

    #[test]
    fn parse_result_and_error_lines() {
        let r = parse_pi_line(r#"{"type":"result","summary":"all done"}"#);
        assert_eq!(r.kind, "result");
        assert_eq!(r.text.as_deref(), Some("all done"));

        let e = parse_pi_line(r#"{"type":"error","message":"bad key"}"#);
        assert_eq!(e.kind, "error");
        assert_eq!(e.text.as_deref(), Some("bad key"));
    }

    #[test]
    fn parse_unknown_line_degrades_to_thought() {
        let t = parse_pi_line(r#"{"type":"assistant","text":"thinking..."}"#);
        assert_eq!(t.kind, "thought");
        assert_eq!(t.text.as_deref(), Some("thinking..."));

        // Non-JSON narration is preserved verbatim.
        let n = parse_pi_line("plain text line");
        assert_eq!(n.kind, "thought");
        assert_eq!(n.text.as_deref(), Some("plain text line"));
    }
}
