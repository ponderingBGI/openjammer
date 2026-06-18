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
//! (`plugins.updater`); the CANARI pubkey is embedded here, while the canari
//! endpoint is resolved from the newest numbered GitHub prerelease
//! (`vX.Y.Z-canari.N`). Both pubkeys are PUBLIC (safe to commit) — fill them per
//! OWNER-PROVISIONING.md §3. The default version comparison (`remote > current`)
//! gives the UPSTREAM-ONLY behaviour for free: switching Canary→Stable never
//! downgrades; you wait until Stable reaches you.

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

#[cfg(any(windows, target_os = "linux"))]
const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/ponderingBGI/openjammer/releases";

/// The CANARI updater public key (minisign). Public; safe to commit. Its private
/// counterpart signs canari builds in `canary.yml` (the
/// `TAURI_SIGNING_PRIVATE_KEY_CANARY` secret). A canari-channel check verifies
/// the downloaded `latest.json` against this.
#[cfg(any(windows, target_os = "linux"))]
const CANARY_UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEZFRDU1NkQwNjZBNTNGMkYKUldRdlA2Vm0wRmJWL2dZVzZ2WC9HU2hpUUUrTTh5MGZqQXFoSTdXM0RLSnRwQ25WUERkRXpLankK";

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

fn platform_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn native_update_capability() -> (&'static str, bool, Option<&'static str>) {
    if cfg!(debug_assertions) {
        return (
            "dev",
            false,
            Some("Developer builds do not auto-update. Use a packaged release to test updates."),
        );
    }

    if cfg!(windows) {
        return ("nsis", true, None);
    }

    if cfg!(target_os = "linux") {
        if std::env::var_os("APPIMAGE").is_some() {
            return ("appimage", true, None);
        }
        return (
            "linux-package",
            false,
            Some("This Linux install is managed manually or by your package manager."),
        );
    }

    if cfg!(target_os = "macos") {
        return (
            "dmg",
            false,
            Some("Manual .dmg updates until OpenJammer has Apple Developer ID notarization."),
        );
    }

    (
        "unsupported",
        false,
        Some("Automatic updates are not available on this platform."),
    )
}

fn can_native_auto_update() -> bool {
    native_update_capability().1
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

#[cfg(any(windows, target_os = "linux"))]
#[derive(Debug, serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[cfg(any(windows, target_os = "linux"))]
#[derive(Debug, serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[cfg(any(windows, target_os = "linux"))]
fn canari_version(tag: &str) -> Option<semver::Version> {
    let raw = tag.strip_prefix('v').unwrap_or(tag);
    let version = semver::Version::parse(raw).ok()?;
    let pre = version.pre.as_str();
    if pre.starts_with("canari.") && pre["canari.".len()..].parse::<u64>().is_ok() {
        Some(version)
    } else {
        None
    }
}

#[cfg(any(windows, target_os = "linux"))]
fn select_latest_canari_manifest_url(releases: &[GithubRelease]) -> Option<String> {
    releases
        .iter()
        .filter(|release| !release.draft && release.prerelease)
        .filter_map(|release| {
            let version = canari_version(&release.tag_name)?;
            let manifest = release
                .assets
                .iter()
                .find(|asset| asset.name == "latest.json")?;
            Some((version, manifest.browser_download_url.clone()))
        })
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, url)| url)
}

#[cfg(any(windows, target_os = "linux"))]
async fn latest_canari_manifest_url() -> Result<url::Url, String> {
    let releases = reqwest::Client::new()
        .get(GITHUB_RELEASES_API)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "openjammer-updater")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Vec<GithubRelease>>()
        .await
        .map_err(|e| e.to_string())?;

    let manifest = select_latest_canari_manifest_url(&releases)
        .ok_or_else(|| "no numbered canari release with latest.json was found".to_string())?;
    url::Url::parse(&manifest).map_err(|e| e.to_string())
}

/// Build the updater for `channel`: the canari channel resolves the newest
/// numbered prerelease endpoint and embeds the canari pubkey; stable uses the
/// `tauri.conf.json` defaults.
#[cfg(any(windows, target_os = "linux"))]
async fn channel_updater(
    app: &tauri::AppHandle,
    channel: Channel,
) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    match channel {
        Channel::Stable => app.updater().map_err(|e| e.to_string()),
        Channel::Canary => {
            let url = latest_canari_manifest_url().await?;
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
        if !can_native_auto_update() {
            return Ok(None);
        }
        let Some(update) = channel_updater(&app, channel)
            .await?
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
        if !can_native_auto_update() {
            return Ok(false);
        }
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
    /// Whether the updater plugin is compiled into this platform/build.
    pub supported: bool,
    /// Native OS reported to the UI for manual download selection.
    pub platform: &'static str,
    /// Native CPU arch reported to the UI for manual download selection.
    pub arch: &'static str,
    /// Runtime install kind (`nsis`, `appimage`, `linux-package`, `dmg`, `dev`, ...).
    pub install_kind: &'static str,
    /// Whether this exact platform/install kind may auto-update safely.
    pub can_auto_update: bool,
    /// Human-readable reason shown when auto-update is unavailable.
    pub manual_reason: Option<&'static str>,
}

/// Report current version + pending-update + rollback state to the UI.
#[tauri::command]
pub fn update_status(app: tauri::AppHandle) -> UpdateStatus {
    let current_version = app.package_info().version.to_string();
    let last_good_version = crate::backup::last_good_version(&app);
    let (install_kind, can_auto_update, manual_reason) = native_update_capability();
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
            pending: can_auto_update && app.state::<UpdateGateState>().is_pending(),
            pending_version: if can_auto_update {
                pending_version
            } else {
                None
            },
            last_good_version,
            supported: true,
            platform: platform_name(),
            arch: std::env::consts::ARCH,
            install_kind,
            can_auto_update,
            manual_reason,
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
            platform: platform_name(),
            arch: std::env::consts::ARCH,
            install_kind,
            can_auto_update,
            manual_reason,
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
    if !can_native_auto_update() {
        return;
    }
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

#[cfg(all(test, any(windows, target_os = "linux")))]
mod tests {
    use super::*;

    fn release(tag: &str, draft: bool, prerelease: bool, has_manifest: bool) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            draft,
            prerelease,
            assets: if has_manifest {
                vec![GithubAsset {
                    name: "latest.json".to_string(),
                    browser_download_url: format!("https://example.test/{tag}/latest.json"),
                }]
            } else {
                vec![GithubAsset {
                    name: "OpenJammer.dmg".to_string(),
                    browser_download_url: format!("https://example.test/{tag}/OpenJammer.dmg"),
                }]
            },
        }
    }

    #[test]
    fn canari_version_accepts_only_numbered_canari_prereleases() {
        assert_eq!(
            canari_version("v0.0.1-canari.12").map(|v| v.to_string()),
            Some("0.0.1-canari.12".to_string())
        );
        assert!(canari_version("v0.0.1").is_none());
        assert!(canari_version("v0.0.1-canary.1").is_none());
        assert!(canari_version("v0.0.1.canari.1").is_none());
    }

    #[test]
    fn selects_newest_canari_manifest_by_semver() {
        let releases = vec![
            release("v0.0.2-canari.1", false, true, true),
            release("v0.0.2-canari.3", true, true, true),
            release("v0.0.2-canari.2", false, true, true),
            release("v0.0.3-canari.1", false, true, false),
            release("v0.0.1", false, false, true),
            release("v0.0.2-canary.9", false, true, true),
        ];

        assert_eq!(
            select_latest_canari_manifest_url(&releases),
            Some("https://example.test/v0.0.2-canari.2/latest.json".to_string())
        );
    }

    #[test]
    fn returns_none_without_numbered_canari_manifest() {
        let releases = vec![
            release("v0.0.1", false, false, true),
            release("v0.0.2-canari.1", false, true, false),
        ];

        assert!(select_latest_canari_manifest_url(&releases).is_none());
    }
}
