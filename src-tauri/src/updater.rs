//! R2/R4 native updater — the desktop-shell wiring around the audio-safe
//! [`ojcore_native::UpdateGate`] and `tauri-plugin-updater`.
//!
//! The novel, live-safety part lives in `ojcore-native` (`update_gate.rs`): a
//! verified update is STAGED and only installed when audio is idle, atomically
//! (no TOCTOU). The download/verify/install is `tauri-plugin-updater` (Tauri v2),
//! Win + Linux only — macOS is compiled-off until notarization
//! (OWNER-PROVISIONING.md §4); the commands still exist there as inert no-ops so
//! the `invoke_handler` list stays platform-uniform.
//!
//! CHANNEL IS RUNTIME, not build-time: the user picks Stable or Canary in
//! Settings. The STABLE pubkey + endpoint live in `tauri.conf.json`
//! (`plugins.updater`); the CANARY pubkey + endpoint are embedded here so a check
//! on the canary channel verifies against the canary key. Both pubkeys are PUBLIC
//! (safe to commit) — fill them per OWNER-PROVISIONING.md §3. The default version
//! comparison (`remote > current`) gives the UPSTREAM-ONLY behaviour for free:
//! switching Canary→Stable never downgrades; you wait until Stable reaches you.

use std::sync::{Arc, Mutex};

use ojcore_native::UpdateGate;

use crate::engine::BackendState;

/// The managed gate handle (shared, cheap to clone).
pub type UpdateGateState = Arc<UpdateGate>;

/// Release channel the updater checks. Mirrors the frontend `updateChannel` pref.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    /// Polished `v*`-tagged releases.
    #[default]
    Stable,
    /// Bleeding-edge rolling builds from the `canari` branch.
    Canary,
}

/// Owner-provisioned canary endpoint. The stable endpoint lives in
/// `tauri.conf.json` (`plugins.updater.endpoints`) and is the builder default.
#[cfg(any(windows, target_os = "linux"))]
const CANARY_ENDPOINT: &str =
    "https://github.com/ponderingBGI/openjammer/releases/download/canary/latest.json";

/// The CANARY updater public key (minisign). EMPTY until owner-provisioned — the
/// canary channel then fails closed (a check returns `Err`, nothing installs).
/// Public; safe to commit. Paste the canary pubkey here per OWNER-PROVISIONING §3.
#[cfg(any(windows, target_os = "linux"))]
const CANARY_UPDATER_PUBKEY: &str = "";

// --- native-side mirror of the auto-update preference ------------------------

/// The frontend's auto-update preference, mirrored natively so the on-quit exit
/// handler can decide install-on-quit without a frontend round-trip.
#[derive(Debug, Clone, Copy)]
pub struct AutoUpdateSettings {
    pub enabled: bool,
    pub channel: Channel,
}

impl Default for AutoUpdateSettings {
    fn default() -> Self {
        // Disabled until the frontend syncs the real pref on mount (it defaults
        // ON). Conservative: never install-on-quit before the UI has spoken.
        Self {
            enabled: false,
            channel: Channel::Stable,
        }
    }
}

/// Managed handle for [`AutoUpdateSettings`].
#[derive(Debug, Default)]
pub struct AutoUpdateConfig(pub Mutex<AutoUpdateSettings>);

/// Push the auto-update preference from the UI into native state. Called by the
/// `useNativeUpdater` hook on mount and whenever the toggle / channel changes.
#[tauri::command]
pub fn update_set_config(
    enabled: bool,
    channel: Channel,
    config: tauri::State<'_, AutoUpdateConfig>,
) {
    let mut g = config.0.lock().unwrap_or_else(|p| p.into_inner());
    g.enabled = enabled;
    g.channel = channel;
}

// --- the audio-safe gate seam (channel-agnostic) -----------------------------

/// Mark a downloaded + verified update as ready.
#[tauri::command]
pub fn update_stage(gate: tauri::State<'_, UpdateGateState>) {
    gate.stage();
}

/// Whether an update is staged and waiting for an audio-idle moment.
#[tauri::command]
pub fn update_is_pending(gate: tauri::State<'_, UpdateGateState>) -> bool {
    gate.is_pending()
}

/// Atomically begin the install IFF an update is pending AND the native audio
/// engine is NOT running. Returns `true` when the shell should relaunch into the
/// new binary. The audio-active decision is taken from the authoritative engine
/// state immediately before the gate's atomic transition.
#[tauri::command]
pub fn update_try_install(
    gate: tauri::State<'_, UpdateGateState>,
    engine: tauri::State<'_, BackendState>,
) -> Result<bool, String> {
    let running = engine
        .0
        .lock()
        .map_err(|_| "engine backend mutex poisoned".to_string())?
        .is_running();
    gate.set_audio_active(running);
    Ok(gate.try_begin_install())
}

// --- the real updater plugin seam (Win + Linux only) -------------------------

/// A downloaded-and-verified update awaiting an audio-idle install, with its
/// bytes. Lives between [`update_check_and_stage`] (download + verify + stage) and
/// the install (on quit, or the explicit [`update_install_if_idle`]). Win/Linux.
#[cfg(any(windows, target_os = "linux"))]
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

/// Build the updater for `channel`: the canary channel overrides the endpoint +
/// embeds the canary pubkey; stable uses the `tauri.conf.json` defaults.
#[cfg(any(windows, target_os = "linux"))]
fn channel_updater(
    app: &tauri::AppHandle,
    channel: Channel,
) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    match channel {
        Channel::Stable => app.updater().map_err(|e| e.to_string()),
        Channel::Canary => {
            let url = url::Url::parse(CANARY_ENDPOINT).map_err(|e| e.to_string())?;
            app.updater_builder()
                .endpoints(vec![url])
                .map_err(|e| e.to_string())?
                .pubkey(CANARY_UPDATER_PUBKEY)
                .build()
                .map_err(|e| e.to_string())
        }
    }
}

/// Check `channel`'s endpoint; if a newer build exists, download + minisign-verify
/// it, then STAGE it in the audio-safe gate. The install is deferred to quit (or
/// the explicit [`update_install_if_idle`]) so the running binary is never swapped
/// from under live audio (a held note beats a glitch). Returns the available
/// version, or `None` when already current (incl. when the selected channel is
/// behind — the upstream-only / no-downgrade default). macOS: always `None`.
#[tauri::command]
pub async fn update_check_and_stage(
    app: tauri::AppHandle,
    channel: Channel,
) -> Result<Option<String>, String> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri::Manager;
        let Some(update) = channel_updater(&app, channel)?
            .check()
            .await
            .map_err(|e| e.to_string())?
        else {
            return Ok(None);
        };
        let version = update.version.clone();
        // The minisign verification is part of `download`; hold the bytes until
        // audio is idle (on quit or an explicit install).
        let bytes = update
            .download(|_chunk, _total| {}, || {})
            .await
            .map_err(|e| e.to_string())?;
        *app.state::<PendingUpdate>()
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = Some((update, bytes));
        app.state::<UpdateGateState>().stage();
        Ok(Some(version))
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (&app, channel);
        Ok(None)
    }
}

/// Install a previously-staged update IFF the audio engine is idle, then relaunch
/// into the new binary. The explicit "Update & restart now" path (Settings).
/// Returns `true` when the install began (the app is about to restart), `false`
/// when audio is live or nothing is staged — the caller retries on the next idle
/// tick. The idle check + gate transition are atomic (no TOCTOU). macOS: `false`.
#[tauri::command]
pub fn update_install_if_idle(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri::Manager;
        let running = app
            .state::<BackendState>()
            .0
            .lock()
            .map_err(|_| "engine backend mutex poisoned".to_string())?
            .is_running();
        let gate = app.state::<UpdateGateState>();
        gate.set_audio_active(running);
        if !gate.try_begin_install() {
            return Ok(false);
        }
        let staged = app
            .state::<PendingUpdate>()
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        if let Some((update, bytes)) = staged {
            update.install(bytes).map_err(|e| e.to_string())?;
            app.restart();
        }
        Ok(true)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = &app;
        Ok(false)
    }
}

/// Snapshot of update state for the Settings → Updates panel.
#[derive(serde::Serialize)]
pub struct UpdateStatus {
    /// The running app version (authoritative; reflects the canary build suffix).
    pub current_version: String,
    /// True when a verified update is staged and waiting for an idle moment.
    pub pending: bool,
    /// The staged update's version, when one is pending.
    pub pending_version: Option<String>,
    /// The version held in the last-good backup, when one exists (the rollback
    /// target). Drives the "Roll back to <version>" affordance.
    pub last_good_version: Option<String>,
    /// Whether the native updater is even available on this platform/build.
    pub supported: bool,
}

/// Report current version + pending-update + rollback state to the UI.
#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> UpdateStatus {
    let current_version = app.package_info().version.to_string();
    let last_good_version = crate::backup::last_good_version(&app);
    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri::Manager;
        let pending_version = app
            .state::<PendingUpdate>()
            .0
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|(u, _)| u.version.clone()));
        UpdateStatus {
            current_version,
            pending: app.state::<UpdateGateState>().is_pending(),
            pending_version,
            last_good_version,
            supported: true,
        }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        UpdateStatus {
            current_version,
            pending: false,
            pending_version: None,
            last_good_version,
            supported: false,
        }
    }
}

/// Install a staged update on the way out (the Ableton-style "installs when you
/// quit"). Called from the window `CloseRequested` handler. Best-effort: a failed
/// install must never block quitting. No-op unless the user has auto-update on and
/// a verified update is staged. macOS: no-op (updater compiled-off).
#[cfg(any(windows, target_os = "linux"))]
pub fn install_on_quit(app: &tauri::AppHandle) {
    use tauri::Manager;
    let enabled = app
        .state::<AutoUpdateConfig>()
        .0
        .lock()
        .map(|g| g.enabled)
        .unwrap_or(false);
    if !enabled {
        return;
    }
    let gate = app.state::<UpdateGateState>();
    if !gate.is_pending() {
        return;
    }
    // We're quitting: audio is stopping, so the gate may open.
    gate.set_audio_active(false);
    if !gate.try_begin_install() {
        return;
    }
    let staged = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .take();
    if let Some((update, bytes)) = staged {
        // No relaunch — the user asked to quit; the installer applies on exit.
        let _ = update.install(bytes);
    }
}

/// macOS / unsupported platforms: nothing to install on quit.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn install_on_quit(_app: &tauri::AppHandle) {}
