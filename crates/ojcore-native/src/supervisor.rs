//! Device-recovery policy (Track A P1) — the pure brain of "a held note beats a
//! glitch" at the device edge.
//!
//! When the output device is lost mid-set (a [`DeviceFault::Removed`] drained from
//! the host's mailbox), the control plane must hold the last good sound, rebuild
//! the engine ONCE, and retry opening the preferred-then-default device with
//! backoff — never thrash, never steal focus. This module is that decision logic
//! as a small, deterministic state machine, kept FREE of any host/IO dependency so
//! it is exhaustively unit-testable; `oj-tauri`'s `EngineBackend` drives it from
//! the real [`AudioHost::drain_device_faults`] + a reopen attempt (the thin wiring
//! is the consumer, modeled byte-for-byte on the existing `UpdateGate` discipline).
//!
//! The load-bearing invariants it encodes (mirrored by the engine-tier oracle
//! harness for the audio side):
//!   • EXACTLY-ONE-REBUILD — a device-loss event triggers exactly ONE engine
//!     rebuild, no matter how many removal notifications or reopen attempts follow.
//!   • XRUNS-NEVER-REBUILD — a transient (non-removal) fault is counted and ridden
//!     out; it must NEVER rebuild the engine (rebuilding on a transient turns one
//!     tick into an audible gap).
//!   • BOUNDED RECOVERY — reopen is retried at most `max_attempts` times, then the
//!     supervisor reports a calm give-up rather than spinning forever.

use crate::device::DeviceFault;

/// What the supervisor wants the host layer to do next. The host executes it
/// (hold/fade the buffer, attempt a device open, resume, or surface give-up); the
/// supervisor itself performs no IO.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryAction {
    /// Nothing to do this step.
    None,
    /// Device is gone: hold (then fade) the last good buffer — never hard-zero.
    HoldLastGood,
    /// Attempt to (re)open the preferred-or-default device now (after backoff).
    AttemptReopen,
    /// A reopen succeeded — resume normal rendering on the rebuilt engine.
    Resume,
    /// Backoff exhausted — stop retrying and surface a calm, non-modal notice.
    GiveUp,
}

/// The supervisor's lifecycle. A reference FSM: illegal transitions are simply
/// impossible to express through the methods (TigerBeetle-style).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisorState {
    /// The device is live; audio is flowing normally.
    Running,
    /// The device was lost; we are holding last-good + retrying the open.
    Recovering,
    /// Reopen retries are exhausted; awaiting an explicit user/device action.
    Failed,
}

/// The device-recovery state machine. Construct with a retry budget, feed it the
/// faults drained from the host mailbox + the outcomes of reopen attempts, and
/// execute the [`RecoveryAction`]s it returns.
#[derive(Debug, Clone)]
pub struct DeviceSupervisor {
    state: SupervisorState,
    attempts: u32,
    max_attempts: u32,
    rebuilds: u64,
    transient: u64,
}

impl DeviceSupervisor {
    /// A supervisor that retries a device open up to `max_attempts` times per loss
    /// event before giving up (clamped to at least 1).
    pub fn new(max_attempts: u32) -> Self {
        Self {
            state: SupervisorState::Running,
            attempts: 0,
            max_attempts: max_attempts.max(1),
            rebuilds: 0,
            transient: 0,
        }
    }

    /// Current lifecycle state.
    pub fn state(&self) -> SupervisorState {
        self.state
    }

    /// Total engine rebuilds triggered so far (one per device-loss event).
    pub fn rebuilds(&self) -> u64 {
        self.rebuilds
    }

    /// Total transient (non-removal) faults ridden out without a rebuild.
    pub fn transient_faults(&self) -> u64 {
        self.transient
    }

    /// Handle one device fault drained from the host mailbox.
    ///
    /// A [`DeviceFault::Removed`] from `Running` enters recovery and counts the
    /// ONE rebuild this loss event is allowed; a removal received while already
    /// recovering does NOT rebuild again. A [`DeviceFault::Backend`] (transient /
    /// xrun-like) is counted and ridden out — never a rebuild.
    pub fn on_fault(&mut self, fault: DeviceFault) -> RecoveryAction {
        match fault {
            // A removal OR a default-device swap both require rebuilding onto the
            // (new) default device — same recovery, exactly one rebuild per event.
            DeviceFault::Removed | DeviceFault::DefaultChanged => {
                if self.state == SupervisorState::Running {
                    self.state = SupervisorState::Recovering;
                    self.attempts = 0;
                    self.rebuilds += 1; // exactly one rebuild per loss event
                }
                // Whether newly-recovering or already-recovering: hold the sound.
                RecoveryAction::HoldLastGood
            }
            DeviceFault::Backend => {
                self.transient += 1; // xrun-like: count, never rebuild
                RecoveryAction::None
            }
        }
    }

    /// While recovering, ask whether the host should attempt a device open now.
    /// The host paces calls with its own backoff between attempts.
    pub fn poll_recovery(&self) -> RecoveryAction {
        match self.state {
            SupervisorState::Recovering => RecoveryAction::AttemptReopen,
            _ => RecoveryAction::None,
        }
    }

    /// Report the outcome of a reopen attempt the host made.
    ///
    /// Success resumes `Running`; failure advances the attempt count and either
    /// asks for another attempt or, once the budget is spent, gives up.
    pub fn on_reopen_result(&mut self, ok: bool) -> RecoveryAction {
        if self.state != SupervisorState::Recovering {
            return RecoveryAction::None;
        }
        if ok {
            self.state = SupervisorState::Running;
            self.attempts = 0;
            RecoveryAction::Resume
        } else {
            self.attempts += 1;
            if self.attempts >= self.max_attempts {
                self.state = SupervisorState::Failed;
                RecoveryAction::GiveUp
            } else {
                RecoveryAction::AttemptReopen
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_faults_never_rebuild() {
        let mut s = DeviceSupervisor::new(4);
        for _ in 0..100 {
            assert_eq!(s.on_fault(DeviceFault::Backend), RecoveryAction::None);
        }
        assert_eq!(s.rebuilds(), 0, "an xrun storm must NEVER rebuild");
        assert_eq!(s.transient_faults(), 100);
        assert_eq!(s.state(), SupervisorState::Running);
    }

    #[test]
    fn a_loss_then_successful_reopen_rebuilds_exactly_once_and_resumes() {
        let mut s = DeviceSupervisor::new(4);
        assert_eq!(
            s.on_fault(DeviceFault::Removed),
            RecoveryAction::HoldLastGood
        );
        assert_eq!(s.state(), SupervisorState::Recovering);
        assert_eq!(s.poll_recovery(), RecoveryAction::AttemptReopen);
        // First open fails, second succeeds.
        assert_eq!(s.on_reopen_result(false), RecoveryAction::AttemptReopen);
        assert_eq!(s.on_reopen_result(true), RecoveryAction::Resume);
        assert_eq!(s.state(), SupervisorState::Running);
        assert_eq!(s.rebuilds(), 1, "exactly one rebuild for one loss event");
    }

    #[test]
    fn repeated_removals_during_recovery_do_not_rebuild_again() {
        let mut s = DeviceSupervisor::new(4);
        s.on_fault(DeviceFault::Removed);
        for _ in 0..10 {
            // The OS may emit many removal notifications for one unplug.
            assert_eq!(
                s.on_fault(DeviceFault::Removed),
                RecoveryAction::HoldLastGood
            );
        }
        assert_eq!(s.rebuilds(), 1, "still exactly one rebuild");
    }

    #[test]
    fn reopen_budget_is_bounded_then_gives_up() {
        let mut s = DeviceSupervisor::new(3);
        s.on_fault(DeviceFault::Removed);
        // 3 failed attempts -> give up, never spin forever.
        assert_eq!(s.on_reopen_result(false), RecoveryAction::AttemptReopen); // 1
        assert_eq!(s.on_reopen_result(false), RecoveryAction::AttemptReopen); // 2
        assert_eq!(s.on_reopen_result(false), RecoveryAction::GiveUp); // 3 -> failed
        assert_eq!(s.state(), SupervisorState::Failed);
        assert_eq!(
            s.poll_recovery(),
            RecoveryAction::None,
            "no retries after give-up"
        );
        // A late reopen result after give-up is a no-op (no illegal resume).
        assert_eq!(s.on_reopen_result(true), RecoveryAction::None);
        assert_eq!(s.state(), SupervisorState::Failed);
    }

    #[test]
    fn transient_faults_during_recovery_still_never_rebuild() {
        let mut s = DeviceSupervisor::new(4);
        s.on_fault(DeviceFault::Removed); // rebuild #1
        s.on_fault(DeviceFault::Backend); // xrun while recovering
        s.on_fault(DeviceFault::Backend);
        assert_eq!(s.rebuilds(), 1);
        assert_eq!(s.transient_faults(), 2);
        // A second, distinct loss AFTER resuming rebuilds again (a new event).
        assert_eq!(s.on_reopen_result(true), RecoveryAction::Resume);
        s.on_fault(DeviceFault::Removed);
        assert_eq!(
            s.rebuilds(),
            2,
            "a new loss event after resume is a new rebuild"
        );
    }

    #[test]
    fn reopen_result_while_running_is_a_noop() {
        let mut s = DeviceSupervisor::new(4);
        // No loss in progress: a stray reopen result changes nothing.
        assert_eq!(s.on_reopen_result(true), RecoveryAction::None);
        assert_eq!(s.state(), SupervisorState::Running);
        assert_eq!(s.rebuilds(), 0);
    }
}
