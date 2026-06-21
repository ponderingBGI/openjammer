//! Device-edge fault mailbox (Track A P0a).
//!
//! cpal surfaces stream errors through an error callback that, today, is a dead
//! `eprintln!` — so when the output device is unplugged mid-set the stream dies
//! SILENTLY and nothing off the audio thread can react. This module turns that
//! into an observable, typed signal: the error callback classifies the cpal error
//! and pushes a [`DeviceFault`] into a wait-free SPSC mailbox (the same `rtrb`
//! ring the recorder uses), which the control plane drains off-RT.
//!
//! This is the device-recovery work's fault-observation layer: it makes the
//! otherwise-silent stop VISIBLE, and it is the exact seam the
//! [`DeviceSupervisor`](crate::supervisor) (and the per-OS CoreAudio / WASAPI
//! listeners) feed from. The richer fault classes (default-device change, sample-rate change)
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
    /// The DEFAULT output device changed underneath us (the user plugged in
    /// headphones / switched interface) — the stream is still on the OLD device, so
    /// we must rebuild onto the new default. Surfaced by the portable
    /// [`DeviceWatcher`] (cpal's error callback does not report this), and handled
    /// like a removal: hold last good, rebuild ONCE on the new default.
    DefaultChanged,
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

/// A cheap, comparable identity of the default output device, so a change can be
/// detected by polling rather than per-OS event APIs. The pinned cpal 0.18.1 DOES
/// expose a stable [`DeviceId`](cpal::DeviceId) (`DeviceTrait::id`), so identity is
/// that id plus the default spec — which now also catches an identically-specced
/// swap (same sample rate + channels, different device), not just a spec change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceIdentity {
    /// The backend-stable device id (`DeviceTrait::id`) — distinguishes two devices
    /// that happen to share a spec, so a same-spec swap is still detected.
    pub id: String,
    /// Its default sample rate (Hz) — switching interfaces usually changes this.
    pub sample_rate: u32,
    /// Its default output channel count.
    pub channels: u16,
}

/// Probe the CURRENT default output device's identity, or `None` when there is no
/// device. Off-RT (queries cpal); call on the control poll, never the audio thread.
pub fn probe_default_output() -> Option<DeviceIdentity> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let id = device.id().ok()?.to_string();
    let cfg = device.default_output_config().ok()?;
    Some(DeviceIdentity {
        id,
        sample_rate: cfg.sample_rate(),
        channels: cfg.channels(),
    })
}

/// Watches the DEFAULT output device by polling and emits a [`DeviceFault`] when it
/// disappears or changes — the portable, FFI-free answer to cpal's error callback
/// staying silent on a default-device change (and, on some backends, on removal:
/// cpal #373). Driven from the control poll alongside the error-callback mailbox;
/// the two are complementary (the callback catches a hard stream error, the watcher
/// catches a silent swap). Pure comparison logic + an injectable probe, so it is
/// unit-testable without real hardware.
#[derive(Debug, Default)]
pub struct DeviceWatcher {
    last: Option<DeviceIdentity>,
}

impl DeviceWatcher {
    /// A watcher seeded with the device identity at stream start.
    pub fn new(initial: Option<DeviceIdentity>) -> Self {
        Self { last: initial }
    }

    /// Feed the freshly-probed current identity; return a fault if the default
    /// VANISHED ([`DeviceFault::Removed`]) or CHANGED ([`DeviceFault::DefaultChanged`])
    /// since the last poll. A device first APPEARING (none → some) is a recovery
    /// opportunity, not a fault, so it yields `None`. Updates the remembered state.
    pub fn poll(&mut self, current: Option<DeviceIdentity>) -> Option<DeviceFault> {
        let fault = match (&self.last, &current) {
            (Some(_), None) => Some(DeviceFault::Removed),
            (Some(prev), Some(now)) if prev != now => Some(DeviceFault::DefaultChanged),
            _ => None,
        };
        self.last = current;
        fault
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

    fn ident(sr: u32) -> DeviceIdentity {
        DeviceIdentity {
            id: "dev-a".to_string(),
            sample_rate: sr,
            channels: 2,
        }
    }

    /// Same as [`ident`] but with an explicit device id, to model a swap between two
    /// devices that share a spec.
    fn ident_with_id(id: &str, sr: u32) -> DeviceIdentity {
        DeviceIdentity {
            id: id.to_string(),
            sample_rate: sr,
            channels: 2,
        }
    }

    #[test]
    fn watcher_emits_removed_when_the_default_vanishes() {
        let mut w = DeviceWatcher::new(Some(ident(48_000)));
        assert_eq!(w.poll(None), Some(DeviceFault::Removed));
        // Steady absence does not keep re-emitting.
        assert_eq!(w.poll(None), None);
    }

    #[test]
    fn watcher_emits_default_changed_on_a_swap() {
        let mut w = DeviceWatcher::new(Some(ident(48_000)));
        // Same device -> nothing.
        assert_eq!(w.poll(Some(ident(48_000))), None);
        // Switched interface (rate change) -> DefaultChanged, once.
        assert_eq!(
            w.poll(Some(ident(44_100))),
            Some(DeviceFault::DefaultChanged)
        );
        assert_eq!(w.poll(Some(ident(44_100))), None);
    }

    #[test]
    fn watcher_emits_default_changed_on_a_same_spec_swap() {
        let mut w = DeviceWatcher::new(Some(ident_with_id("dev-a", 48_000)));
        // A swap to a DIFFERENT device with the IDENTICAL spec (same sample rate +
        // channels) is still a change — the stable id distinguishes them, so the
        // watcher must emit DefaultChanged (once).
        assert_eq!(
            w.poll(Some(ident_with_id("dev-b", 48_000))),
            Some(DeviceFault::DefaultChanged)
        );
        assert_eq!(w.poll(Some(ident_with_id("dev-b", 48_000))), None);
    }

    #[test]
    fn watcher_treats_a_device_appearing_as_no_fault() {
        let mut w = DeviceWatcher::new(None);
        // None -> Some is a recovery opportunity, not a fault.
        assert_eq!(w.poll(Some(ident(48_000))), None);
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
