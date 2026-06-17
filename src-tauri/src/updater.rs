//! R2 native updater — the desktop-shell wiring around the audio-safe
//! [`ojcore_native::UpdateGate`].
//!
//! The novel, live-safety part is implemented + tested in `ojcore-native`
//! (`update_gate.rs`): a verified update is STAGED and only installed when audio
//! is idle, atomically (no TOCTOU). This module exposes that gate to the
//! frontend as commands and ties the "is audio running?" decision to the REAL
//! native engine state, so the renderer can offer "Update ready — install now"
//! and the install is refused while sound is playing.
//!
//! The actual download/verify/relaunch is `tauri-plugin-updater` (Tauri v2),
//! which is OWNER-ENABLED: it needs the split stable/canary minisign keys + the
//! update endpoints provisioned per `OWNER-PROVISIONING.md` §3 (and is `cfg`-off
//! on macOS until notarization, §4). Once provisioned, the updater's
//! download-complete callback calls [`update_stage`] and the shell relaunches
//! when [`update_try_install`] returns `true`.

use std::sync::Arc;

use ojcore_native::UpdateGate;

use crate::engine::BackendState;

/// The managed gate handle (shared, cheap to clone).
pub type UpdateGateState = Arc<UpdateGate>;

/// Mark a downloaded + verified update as ready. Called by the owner-enabled
/// updater plugin's download-complete callback.
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
