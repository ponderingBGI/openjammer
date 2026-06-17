//! Audio-safe update gate (R2).
//!
//! The native auto-updater (Tauri v2 `tauri-plugin-updater`, owner-enabled — it
//! needs the signing keys + endpoints provisioned in `OWNER-PROVISIONING.md` §3)
//! must NEVER swap the running binary out from under live audio. This is the
//! tiny, pure state machine that enforces that: a downloaded-and-verified update
//! is STAGED as [`UpdateState::Pending`] and only transitions to `Installing`
//! when audio is idle — atomically, under one lock, so there is no
//! check-then-act (TOCTOU) window where audio could start between the check and
//! the install.
//!
//! It is deliberately UI-/plugin-agnostic and `std`-only so it unit-tests
//! without a device, a webview, or the network. The desktop shell drives it:
//! the updater calls [`UpdateGate::stage`] after a good download, the audio host
//! reports run state via [`UpdateGate::set_audio_active`], and an idle-tick (or
//! the user's "quit & install") calls [`UpdateGate::try_begin_install`].

use std::sync::Mutex;

/// Where a staged update is in its audio-safe lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateState {
    /// No update staged.
    Idle,
    /// An update is downloaded + verified, waiting for an audio-idle moment.
    Pending,
    /// The install was begun (the shell relaunches into the new binary).
    Installing,
}

/// The lock-protected gate. Cheap to share behind an `Arc`.
#[derive(Debug)]
pub struct UpdateGate {
    inner: Mutex<Inner>,
}

#[derive(Debug)]
struct Inner {
    state: UpdateState,
    audio_active: bool,
}

impl Default for UpdateGate {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateGate {
    /// A fresh gate: no update staged, audio assumed idle.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: UpdateState::Idle,
                audio_active: false,
            }),
        }
    }

    /// Stage a downloaded + verified update. Idempotent while already `Pending`;
    /// ignored once `Installing` (the relaunch is already committed).
    pub fn stage(&self) {
        let mut g = self.lock();
        if g.state != UpdateState::Installing {
            g.state = UpdateState::Pending;
        }
    }

    /// Report whether the audio engine is currently running. The host calls this
    /// on start/stop; the gate reads it atomically when deciding to install.
    pub fn set_audio_active(&self, active: bool) {
        self.lock().audio_active = active;
    }

    /// The current lifecycle state.
    pub fn state(&self) -> UpdateState {
        self.lock().state
    }

    /// Whether an update is staged + waiting.
    pub fn is_pending(&self) -> bool {
        self.state() == UpdateState::Pending
    }

    /// Atomically begin the install IFF an update is `Pending` AND audio is idle.
    /// Returns `true` when it transitioned to `Installing` (the caller then
    /// relaunches), `false` otherwise. The decision + transition happen under one
    /// lock, so audio cannot start in a TOCTOU window between the two.
    pub fn try_begin_install(&self) -> bool {
        let mut g = self.lock();
        if g.state == UpdateState::Pending && !g.audio_active {
            g.state = UpdateState::Installing;
            true
        } else {
            false
        }
    }

    /// Lock helper that recovers from a poisoned mutex (a panic elsewhere must
    /// not wedge the updater — worst case we proceed with the last good state).
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_idle() {
        let g = UpdateGate::new();
        assert_eq!(g.state(), UpdateState::Idle);
        assert!(!g.is_pending());
        // Nothing to install yet.
        assert!(!g.try_begin_install());
    }

    #[test]
    fn staged_then_installs_only_when_audio_idle() {
        let g = UpdateGate::new();
        g.stage();
        assert!(g.is_pending());

        // Audio running -> install is refused (the live-safety invariant).
        g.set_audio_active(true);
        assert!(!g.try_begin_install());
        assert_eq!(g.state(), UpdateState::Pending);

        // Audio idle -> install begins atomically.
        g.set_audio_active(false);
        assert!(g.try_begin_install());
        assert_eq!(g.state(), UpdateState::Installing);
    }

    #[test]
    fn install_is_one_shot() {
        let g = UpdateGate::new();
        g.stage();
        assert!(g.try_begin_install());
        // A second attempt does not re-install.
        assert!(!g.try_begin_install());
        // Staging after install commit is ignored (the relaunch is underway).
        g.stage();
        assert_eq!(g.state(), UpdateState::Installing);
    }

    #[test]
    fn poisoned_lock_recovers() {
        use std::sync::Arc;
        let g = Arc::new(UpdateGate::new());
        let g2 = Arc::clone(&g);
        // Poison the mutex from a panicking thread.
        let _ = std::thread::spawn(move || {
            let _guard = g2.inner.lock().unwrap();
            panic!("poison");
        })
        .join();
        // The gate still works (lock() recovers the poisoned guard).
        g.stage();
        assert!(g.is_pending());
    }
}
