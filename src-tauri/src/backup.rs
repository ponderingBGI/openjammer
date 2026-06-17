//! Pre-update data backup + restore — the rollback safety net (R2).
//!
//! Before an update installs, the OUTGOING version's user data is snapshotted to a
//! single `last-good` slot under the app data dir: the Pi agent's memory + session
//! history (`~/.openjammer/agent`) and a frontend-supplied export of the webview's
//! `localStorage` (settings, keybindings, theme, the agent-session store, and the
//! emergency project backup). A rollback restores that snapshot, then the UI pins
//! to the backed-up version and turns auto-update off (so the bad build can't come
//! straight back). Best-effort throughout: a failed backup must never block an
//! update or crash the app.
//!
//! Scope note: user projects live as files in the user's own folders (an update
//! never touches them), and IndexedDB holds re-derivable caches + non-serializable
//! file-system handles, so neither is part of the snapshot.

use std::path::{Path, PathBuf};

use tauri::Manager;

/// The single rollback slot (we keep last-good only).
const SLOT: &str = "last-good";

/// What `snapshot` records and `restore` reads back.
#[derive(serde::Serialize, serde::Deserialize)]
struct BackupManifest {
    /// The version that produced this snapshot (the rollback target).
    version: String,
    /// The channel that was active (`stable` / `canary`).
    channel: String,
    /// Wall-clock of the snapshot (ms since the Unix epoch).
    created_unix_ms: u64,
}

/// Returned to the frontend on rollback: the version to pin to + the webview state
/// to re-import.
#[derive(serde::Serialize)]
pub struct RestoreData {
    pub version: String,
    pub webview_state: String,
}

fn backups_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("backups"))
}

fn agent_dir() -> Option<PathBuf> {
    crate::ai::home_dir().map(|h| h.join(".openjammer").join("agent"))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Snapshot the outgoing version's user data into the `last-good` slot, replacing
/// any previous one. Best-effort — errors are swallowed.
pub fn snapshot(app: &tauri::AppHandle, version: &str, channel: &str, webview_state: &str) {
    let Some(root) = backups_root(app) else {
        return;
    };
    let slot = root.join(SLOT);
    // Start from a clean slot so a partial older backup can't mix in.
    let _ = std::fs::remove_dir_all(&slot);
    if std::fs::create_dir_all(&slot).is_err() {
        return;
    }
    let _ = std::fs::write(slot.join("webview.json"), webview_state);
    if let Some(agent) = agent_dir() {
        if agent.exists() {
            let _ = copy_dir(&agent, &slot.join("agent"));
        }
    }
    let manifest = BackupManifest {
        version: version.to_string(),
        channel: channel.to_string(),
        created_unix_ms: now_ms(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&manifest) {
        let _ = std::fs::write(slot.join("manifest.json"), json);
    }
}

/// The version recorded in the `last-good` slot, if a snapshot exists. Drives the
/// "Roll back to <version>" affordance in Settings.
pub fn last_good_version(app: &tauri::AppHandle) -> Option<String> {
    let root = backups_root(app)?;
    let raw = std::fs::read_to_string(root.join(SLOT).join("manifest.json")).ok()?;
    let manifest: BackupManifest = serde_json::from_str(&raw).ok()?;
    Some(manifest.version)
}

/// Restore the `last-good` slot: copy the agent dir back and return the webview
/// state (the frontend re-imports it) + the version to pin to. `None` when there
/// is no snapshot. Best-effort on the agent copy.
pub fn restore(app: &tauri::AppHandle) -> Option<RestoreData> {
    let root = backups_root(app)?;
    let slot = root.join(SLOT);
    let manifest: BackupManifest =
        serde_json::from_str(&std::fs::read_to_string(slot.join("manifest.json")).ok()?).ok()?;
    let webview_state = std::fs::read_to_string(slot.join("webview.json")).unwrap_or_default();
    if let Some(agent) = agent_dir() {
        let backed = slot.join("agent");
        if backed.exists() {
            let _ = std::fs::remove_dir_all(&agent);
            let _ = copy_dir(&backed, &agent);
        }
    }
    Some(RestoreData {
        version: manifest.version,
        webview_state,
    })
}

/// Recursively copy `src` into `dst` (creating `dst`). Used for the agent dir.
fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
