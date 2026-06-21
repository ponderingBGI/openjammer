//! Event-driven default-output-device listener (Track A P2).
//!
//! The portable polling [`DeviceWatcher`](crate::device::DeviceWatcher) is the
//! always-on, cross-platform backstop; this lowers detection latency to "the
//! instant the OS notices" where a native API exists. It feeds the SAME
//! [`DeviceFault`] mailbox as the cpal error callback, so the recovery path is
//! identical.
//!
//! Platform coverage:
//! * **macOS** — cpal's CoreAudio backend does NOT reliably surface a default-
//!   device change / removal to the stream error callback (cpal #373), so we
//!   register a CoreAudio property listener on the system object's
//!   `kAudioHardwarePropertyDefaultOutputDevice` ourselves.
//! * **Windows** — cpal ALREADY registers an `IMMNotificationClient` internally
//!   (`wasapi/stream.rs`) and surfaces changes as stream errors, which the wired
//!   `err_fn` mailbox captures — so no separate listener is needed here.
//! * **other** — the polling watcher is the sole path (a no-op listener).
//!
//! SAFETY MODEL (macOS): the listener is best-effort and CANNOT cause UB even if a
//! runtime detail is wrong. The callback context is a LEAKED `DeviceFaultTx`
//! (valid for the listener's whole life, reclaimed only on `Drop` after
//! deregistration), and the callback does nothing but a wait-free push to the SPSC
//! mailbox — exactly what the proven `err_fn` does. CoreAudio invokes a single
//! (object, address) listener serially, so the single-producer SPSC contract
//! holds. If the property/run-loop detail is off, the listener simply never fires
//! and the poller covers it — no regression, no unsafety.

use crate::device::DeviceFaultTx;

/// A registered OS device listener; deregisters on drop. Opaque per platform.
pub struct DeviceListener {
    // Held purely for its `Drop` (deregisters the listener); never read directly.
    #[cfg(target_os = "macos")]
    #[allow(dead_code)]
    inner: macos::CoreAudioListener,
    // Keep the type non-empty + Send on platforms without a native listener.
    #[cfg(not(target_os = "macos"))]
    _unused: (),
}

/// Install the OS default-output-device-change listener, feeding `tx`. Returns
/// `None` where there is no native API (or registration failed) — the caller then
/// relies on the polling watcher + cpal's error callback.
pub fn install(tx: DeviceFaultTx) -> Option<DeviceListener> {
    #[cfg(target_os = "macos")]
    {
        macos::CoreAudioListener::install(tx).map(|inner| DeviceListener { inner })
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows: cpal's internal IMMNotificationClient + our err_fn already cover
        // it. Other targets: the polling watcher is the path. Drop `tx`; nothing to
        // register.
        let _ = tx;
        None
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use crate::device::{DeviceFault, DeviceFaultTx};
    use core::ffi::c_void;

    type AudioObjectID = u32;
    type OSStatus = i32;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        m_selector: u32,
        m_scope: u32,
        m_element: u32,
    }

    type AudioObjectPropertyListenerProc = unsafe extern "C" fn(
        AudioObjectID,
        u32,
        *const AudioObjectPropertyAddress,
        *mut c_void,
    ) -> OSStatus;

    // The whole-system object + the "default output device" property, global scope.
    const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
    const fn fourcc(b: &[u8; 4]) -> u32 {
        ((b[0] as u32) << 24) | ((b[1] as u32) << 16) | ((b[2] as u32) << 8) | (b[3] as u32)
    }
    const K_DEFAULT_OUTPUT_DEVICE: u32 = fourcc(b"dOut");
    const K_SCOPE_GLOBAL: u32 = fourcc(b"glob");
    const K_ELEMENT_MAIN: u32 = 0;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectAddPropertyListener(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_listener: AudioObjectPropertyListenerProc,
            in_client_data: *mut c_void,
        ) -> OSStatus;
        fn AudioObjectRemovePropertyListener(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_listener: AudioObjectPropertyListenerProc,
            in_client_data: *mut c_void,
        ) -> OSStatus;
    }

    const ADDRESS: AudioObjectPropertyAddress = AudioObjectPropertyAddress {
        m_selector: K_DEFAULT_OUTPUT_DEVICE,
        m_scope: K_SCOPE_GLOBAL,
        m_element: K_ELEMENT_MAIN,
    };

    /// Called by CoreAudio when the default output device changes. Pushes a fault
    /// and returns `noErr`. SAFETY: `client_data` is the leaked `DeviceFaultTx`
    /// from `install`, valid until `Drop` deregisters this proc.
    unsafe extern "C" fn listener_proc(
        _obj: AudioObjectID,
        _n_addrs: u32,
        _addrs: *const AudioObjectPropertyAddress,
        client_data: *mut c_void,
    ) -> OSStatus {
        if !client_data.is_null() {
            let tx = &mut *(client_data as *mut DeviceFaultTx);
            tx.push(DeviceFault::DefaultChanged);
        }
        0 // noErr
    }

    /// Owns the registration; deregisters + reclaims the leaked context on drop.
    pub struct CoreAudioListener {
        ctx: *mut DeviceFaultTx,
    }

    // The registration is created + dropped on the control thread; the raw ptr is
    // only ever read by the (serial) CoreAudio callback. Safe to move the handle.
    unsafe impl Send for CoreAudioListener {}

    impl CoreAudioListener {
        pub fn install(tx: DeviceFaultTx) -> Option<Self> {
            // Leak the producer so the callback context is valid for the whole
            // listener lifetime; reclaimed in `Drop`.
            let ctx = Box::into_raw(Box::new(tx));
            // SAFETY: ADDRESS is a valid static; `listener_proc` matches the proc
            // ABI; `ctx` outlives the registration (reclaimed only after removal).
            let status = unsafe {
                AudioObjectAddPropertyListener(
                    K_AUDIO_OBJECT_SYSTEM_OBJECT,
                    &ADDRESS,
                    listener_proc,
                    ctx as *mut c_void,
                )
            };
            if status == 0 {
                Some(Self { ctx })
            } else {
                // Registration failed: reclaim the box so it does not leak.
                unsafe { drop(Box::from_raw(ctx)) };
                None
            }
        }
    }

    impl Drop for CoreAudioListener {
        fn drop(&mut self) {
            // SAFETY: deregister BEFORE reclaiming the context, so no in-flight
            // callback can observe a freed `tx`.
            unsafe {
                AudioObjectRemovePropertyListener(
                    K_AUDIO_OBJECT_SYSTEM_OBJECT,
                    &ADDRESS,
                    listener_proc,
                    self.ctx as *mut c_void,
                );
                drop(Box::from_raw(self.ctx));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::device_fault_channel;

    #[test]
    fn install_is_safe_and_optional() {
        // On Linux/CI there is no native listener: install returns None and drops
        // the producer cleanly (no panic, no leak-by-design). On macOS this would
        // register the real listener; the call must never panic regardless.
        let (tx, _rx) = device_fault_channel(8);
        let listener = install(tx);
        // We can't assert Some/None portably (depends on the OS + a real device),
        // but constructing + dropping it must be safe.
        let _ = listener;
    }
}
