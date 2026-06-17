/**
 * useMIDIConnectionToast - Hook to manage MIDI connection toasts via Sonner
 *
 * Features:
 * - Shows toast for each pending device
 * - Manages countdown timer per device
 * - Dismisses toast when device disconnects
 * - Supports stacking of multiple toasts
 */

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useMIDIStore } from '../../store/midiStore';
import { MIDIConnectionToast, AUTO_DISMISS_SECONDS } from './MIDIConnectionToast';
import type { MIDIDeviceInfo, MIDIDevicePreset } from '../../midi/types';

interface ToastState {
    countdown: number;
    intervalId: ReturnType<typeof setInterval> | null;
}

export function useMIDIConnectionToast(
    onAddDevice: (deviceId: string, presetId: string) => void
) {
    const pendingDevices = useMIDIStore((s) => s.pendingDevices);
    const dismissPendingDevice = useMIDIStore((s) => s.dismissPendingDevice);
    const openBrowser = useMIDIStore((s) => s.openBrowser);
    const usedDeviceNames = useMIDIStore((s) => s.usedDeviceNames);
    const deviceSignatures = useMIDIStore((s) => s.deviceSignatures);

    // Track active toasts and their countdown states
    const toastStatesRef = useRef<Map<string, ToastState>>(new Map());
    const activeToastIdsRef = useRef<Set<string>>(new Set());

    // Calculate preview device name (what will be assigned)
    const getPreviewDeviceName = useCallback((
        deviceId: string,
        preset: MIDIDevicePreset | null
    ): string => {
        const presetId = preset?.id || 'generic';
        const presetName = preset?.name || 'MIDI Device';

        // Check if this device already has a signature
        const existingSig = deviceSignatures[deviceId];
        if (existingSig) return existingSig.deviceName;

        // Calculate what name would be generated
        let suffix = 1;
        let candidateName = presetName;
        while (usedDeviceNames[`${presetId}:${candidateName}`]) {
            suffix++;
            candidateName = `${presetName} ${suffix}`;
        }
        return candidateName;
    }, [usedDeviceNames, deviceSignatures]);

    // Dismiss toast for a device
    const dismissToast = useCallback((deviceId: string) => {
        const state = toastStatesRef.current.get(deviceId);
        if (state?.intervalId) {
            clearInterval(state.intervalId);
        }
        toastStatesRef.current.delete(deviceId);
        activeToastIdsRef.current.delete(deviceId);

        toast.dismiss(deviceId);
        dismissPendingDevice(deviceId);
    }, [dismissPendingDevice]);

    // Show toast for a device
    const showToast = useCallback((
        device: MIDIDeviceInfo,
        preset: MIDIDevicePreset | null
    ) => {
        const deviceId = device.id;

        // Already showing this toast
        if (activeToastIdsRef.current.has(deviceId)) return;

        activeToastIdsRef.current.add(deviceId);

        // Initialize countdown state
        const state: ToastState = {
            countdown: AUTO_DISMISS_SECONDS,
            intervalId: null,
        };
        toastStatesRef.current.set(deviceId, state);

        const previewName = getPreviewDeviceName(deviceId, preset);
        const presetId = preset?.id || 'generic';

        // Function to render the toast
        const renderToast = (currentCountdown: number) => {
            toast.custom(
                () => (
                    MIDIConnectionToast({
                        device,
                        preset,
                        previewDeviceName: previewName,
                        countdown: currentCountdown,
                        onAdd: () => {
                            onAddDevice(deviceId, presetId);
                            dismissToast(deviceId);
                        },
                        onBrowse: () => {
                            dismissToast(deviceId);
                            openBrowser();
                        },
                        onDismiss: () => dismissToast(deviceId),
                    })
                ),
                {
                    id: deviceId,
                    duration: Infinity, // We manage dismissal ourselves
                }
            );
        };

        // Initial render
        renderToast(state.countdown);

        // Start countdown interval
        state.intervalId = setInterval(() => {
            const currentState = toastStatesRef.current.get(deviceId);
            if (!currentState) return;

            currentState.countdown--;

            if (currentState.countdown <= 0) {
                dismissToast(deviceId);
            } else {
                // Update toast with new countdown
                renderToast(currentState.countdown);
            }
        }, 1000);
    }, [getPreviewDeviceName, onAddDevice, openBrowser, dismissToast]);

    // React to pendingDevices changes
    useEffect(() => {
        // Show toasts for new devices
        pendingDevices.forEach(({ device, preset }, deviceId) => {
            if (!activeToastIdsRef.current.has(deviceId)) {
                showToast(device, preset);
            }
        });

        // Dismiss toasts for removed devices (disconnected)
        activeToastIdsRef.current.forEach((deviceId) => {
            if (!pendingDevices.has(deviceId)) {
                dismissToast(deviceId);
            }
        });
    }, [pendingDevices, showToast, dismissToast]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Intentionally reads the LIVE ref contents at unmount: these refs are
            // mutated throughout the component's life as toasts come and go, and the
            // teardown must clear whatever is active then. Snapshotting `.current` into
            // a local at mount would capture the empty initial Map/Set and clear nothing.
            toastStatesRef.current.forEach((state, deviceId) => {
                if (state.intervalId) clearInterval(state.intervalId);
                toast.dismiss(deviceId);
            });
            // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount teardown must read live ref values, not a mount-time snapshot
            toastStatesRef.current.clear();
            // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount teardown must read live ref values, not a mount-time snapshot
            activeToastIdsRef.current.clear();
        };
    }, []);
}
