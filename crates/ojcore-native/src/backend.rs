//! The audio-backend seam + the device-recovery drive loop (Track A P1).
//!
//! [`AudioBackend`] is the minimal OUTER lifecycle the device-recovery loop needs
//! from whatever owns the live stream: drain the next device fault, attempt a
//! (re)open, and report whether audio is running. It is deliberately tiny and is
//! the seam that lets [`supervise_once`] drive the [`DeviceSupervisor`] policy
//! against EITHER the real host (in `oj-tauri`'s `EngineBackend`, which owns the
//! engine + stream and can rebuild them) OR a scripted simulated device — so the
//! whole "unplug → hold last good → reopen with backoff → resume" loop is verified
//! end-to-end, not just the policy in isolation.
//!
//! The real `AudioHost` cannot implement `reopen` itself (its engine is moved into
//! the cpal callback for the stream's life), so the production impl lives where the
//! rebuild does — `oj-tauri`. This module ships the trait, the drive step, and a
//! simulated backend that proves the loop; wiring the production impl is the thin
//! remaining integration.

use crate::device::DeviceFault;
use crate::supervisor::{DeviceSupervisor, RecoveryAction};

/// The minimal lifecycle the recovery loop drives. Implemented by the host that
/// owns the stream (production: `oj-tauri`'s `EngineBackend`; tests: `SimBackend`).
pub trait AudioBackend {
    /// Drain the next pending device fault, if any (off-RT).
    fn poll_fault(&mut self) -> Option<DeviceFault>;
    /// Attempt to (re)open the preferred-or-default device, rebuilding the stream.
    /// Returns `true` once audio is running again.
    fn reopen(&mut self) -> bool;
    /// Whether a stream is currently believed live.
    fn is_running(&self) -> bool;
}

/// One control-tick of device recovery: handle any new fault, then — while
/// recovering — make one paced reopen attempt and feed the result back to the
/// policy. The caller (a control-thread timer) invokes this repeatedly with its
/// own backoff between ticks; it performs no IO beyond the backend's own methods,
/// and never touches the audio thread.
pub fn supervise_once(
    sup: &mut DeviceSupervisor,
    backend: &mut impl AudioBackend,
) -> RecoveryAction {
    let mut action = RecoveryAction::None;
    if let Some(fault) = backend.poll_fault() {
        action = sup.on_fault(fault);
    }
    if sup.poll_recovery() == RecoveryAction::AttemptReopen {
        let ok = backend.reopen();
        action = sup.on_reopen_result(ok);
    }
    action
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    /// A scripted device: a per-tick fault stream + a queue of reopen outcomes.
    struct SimBackend {
        faults: VecDeque<Option<DeviceFault>>,
        reopen_results: VecDeque<bool>,
        running: bool,
        reopen_calls: u32,
    }
    impl SimBackend {
        fn new(faults: Vec<Option<DeviceFault>>, reopens: Vec<bool>) -> Self {
            Self {
                faults: faults.into(),
                reopen_results: reopens.into(),
                running: true,
                reopen_calls: 0,
            }
        }
    }
    impl AudioBackend for SimBackend {
        fn poll_fault(&mut self) -> Option<DeviceFault> {
            self.faults.pop_front().flatten()
        }
        fn reopen(&mut self) -> bool {
            self.reopen_calls += 1;
            let ok = self.reopen_results.pop_front().unwrap_or(true);
            self.running = ok;
            ok
        }
        fn is_running(&self) -> bool {
            self.running
        }
    }

    #[test]
    fn unplug_then_two_failed_reopens_then_success_resumes_with_one_rebuild() {
        let mut sup = DeviceSupervisor::new(5);
        // Tick 0: device removed. Ticks 1-2: reopen fails. Tick 3: reopen succeeds.
        let mut be = SimBackend::new(
            vec![Some(DeviceFault::Removed), None, None, None],
            vec![false, false, true],
        );

        // Tick 0: fault arrives -> hold last good (and the same tick tries a reopen,
        // which is scripted to fail -> ask to try again).
        let a0 = supervise_once(&mut sup, &mut be);
        assert!(matches!(a0, RecoveryAction::AttemptReopen)); // reopen #1 failed
                                                              // Tick 1: reopen #2 fails -> still retrying.
        assert_eq!(
            supervise_once(&mut sup, &mut be),
            RecoveryAction::AttemptReopen
        );
        // Tick 2: reopen #3 succeeds -> resume.
        assert_eq!(supervise_once(&mut sup, &mut be), RecoveryAction::Resume);

        assert!(be.is_running());
        assert_eq!(sup.rebuilds(), 1, "one loss event -> exactly one rebuild");
        assert_eq!(be.reopen_calls, 3, "retried until the device came back");
    }

    #[test]
    fn xrun_storm_drives_no_reopens_and_no_rebuilds() {
        let mut sup = DeviceSupervisor::new(5);
        let mut be = SimBackend::new(
            vec![Some(DeviceFault::Backend); 50], // a storm of transient faults
            vec![],
        );
        for _ in 0..50 {
            assert_eq!(supervise_once(&mut sup, &mut be), RecoveryAction::None);
        }
        assert_eq!(
            be.reopen_calls, 0,
            "transient faults never trigger a reopen"
        );
        assert_eq!(sup.rebuilds(), 0, "transient faults never rebuild");
        assert!(be.is_running());
    }

    #[test]
    fn a_device_that_never_returns_gives_up_within_the_budget() {
        let mut sup = DeviceSupervisor::new(3);
        let mut be = SimBackend::new(
            vec![Some(DeviceFault::Removed), None, None, None, None],
            vec![false, false, false, false],
        );
        // 3 failed reopen attempts -> give up, then stop attempting.
        assert_eq!(
            supervise_once(&mut sup, &mut be),
            RecoveryAction::AttemptReopen
        );
        assert_eq!(
            supervise_once(&mut sup, &mut be),
            RecoveryAction::AttemptReopen
        );
        assert_eq!(supervise_once(&mut sup, &mut be), RecoveryAction::GiveUp);
        // Further ticks do nothing (no endless reopen spinning).
        assert_eq!(supervise_once(&mut sup, &mut be), RecoveryAction::None);
        assert_eq!(be.reopen_calls, 3, "bounded retries, then quiet");
        assert_eq!(sup.rebuilds(), 1);
    }
}
