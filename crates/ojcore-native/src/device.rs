//! Device-edge fault mailbox (Track A P0a).
//!
//! cpal surfaces stream errors through an error callback that, today, is a dead
//! `eprintln!` — so when the output device is unplugged mid-set the stream dies
//! SILENTLY and nothing off the audio thread can react. This module turns that
//! into an observable, typed signal: the error callback classifies the cpal error
//! and pushes a [`DeviceFault`] into a wait-free SPSC mailbox (the same `rtrb`
//! ring the recorder uses), which the control plane drains off-RT.
//!
//! This is the "ship first, standalone" step of the device-recovery work: it makes
//! the silent stop VISIBLE before any recovery logic exists, and it is the exact
//! seam the future `DeviceSupervisor` (and the per-OS CoreAudio / WASAPI listeners)
//! will feed. The richer fault classes (default-device change, sample-rate change)
//! are NOT emitted here — cpal's error callback cannot observe them; they arrive
//! with the native OS listeners later and will extend this enum then (no dormant
//! variants now, per the "every production line is used" value).

use rtrb::{Consumer, Producer, RingBuffer};

/// A device-edge fault observed from cpal's stream error callback (off the render
/// path). Small + `Copy` so it rides a fixed-size lock-free ring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceFault {
    /// The device became unavailable mid-stream — unplugged, lost, or seized by
    /// another app. Classified from cpal's device-absence error kinds. THIS is the
    /// "a held note beats a glitch" trigger: the control plane should hold the last
    /// good sound and attempt recovery rather than die silently.
    Removed,
    /// A backend stream error that is NOT device-absence (a transient/though-rare
    /// driver error). Kept as a distinct, observable signal rather than swallowed.
    Backend,
}

/// Pure classification of "is this error device-absence?" into a [`DeviceFault`].
/// Split out from the cpal type so the mapping is unit-testable without
/// constructing a `cpal::Error` (which has no public constructor).
#[inline]
pub fn classify(is_device_absent: bool) -> DeviceFault {
    if is_device_absent {
        DeviceFault::Removed
    } else {
        DeviceFault::Backend
    }
}

/// The audio-thread / error-callback end of the mailbox.
pub struct DeviceFaultTx {
    tx: Producer<DeviceFault>,
}

/// The off-RT (control-plane) end of the mailbox.
pub struct DeviceFaultRx {
    rx: Consumer<DeviceFault>,
}

/// Create a device-fault mailbox with room for `cap` pending faults.
pub fn device_fault_channel(cap: usize) -> (DeviceFaultTx, DeviceFaultRx) {
    let (tx, rx) = RingBuffer::new(cap.max(1));
    (DeviceFaultTx { tx }, DeviceFaultRx { rx })
}

impl DeviceFaultTx {
    /// Push a fault, dropping it if the mailbox is full. Faults are coalescable —
    /// the control plane only needs to learn that a fault occurred, not receive
    /// every duplicate of a flapping device — so a full ring is safe to ignore.
    /// Never blocks or allocates: safe to call from the error callback.
    #[inline]
    pub fn push(&mut self, fault: DeviceFault) {
        let _ = self.tx.push(fault);
    }
}

impl DeviceFaultRx {
    /// Drain every pending fault into `sink`, oldest first. Off-RT.
    pub fn drain(&mut self, mut sink: impl FnMut(DeviceFault)) {
        while let Ok(f) = self.rx.pop() {
            sink(f);
        }
    }

    /// Pop a single pending fault, if any. Off-RT.
    pub fn try_recv(&mut self) -> Option<DeviceFault> {
        self.rx.pop().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_maps_absence_to_removed() {
        assert_eq!(classify(true), DeviceFault::Removed);
        assert_eq!(classify(false), DeviceFault::Backend);
    }

    #[test]
    fn mailbox_round_trips_faults_in_order() {
        let (mut tx, mut rx) = device_fault_channel(8);
        tx.push(DeviceFault::Removed);
        tx.push(DeviceFault::Backend);
        let mut got = Vec::new();
        rx.drain(|f| got.push(f));
        assert_eq!(got, vec![DeviceFault::Removed, DeviceFault::Backend]);
        // Drained dry.
        assert_eq!(rx.try_recv(), None);
    }

    #[test]
    fn full_mailbox_drops_without_panicking() {
        let (mut tx, mut rx) = device_fault_channel(2);
        // Push more than capacity — must never panic; excess is dropped.
        for _ in 0..10 {
            tx.push(DeviceFault::Removed);
        }
        let mut n = 0;
        rx.drain(|_| n += 1);
        assert!(n <= 2, "ring holds at most its capacity");
        assert!(n >= 1, "at least one fault was retained");
    }
}
