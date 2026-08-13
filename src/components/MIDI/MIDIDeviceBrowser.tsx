/**
 * MIDI Device Browser - modal for selecting MIDI devices/presets
 *
 * Features:
 * - Search/filter by device name or manufacturer
 * - Card grid layout for device presets
 * - "Generic Device" option always visible
 * - ESC to close
 *
 * The overlay chrome (portal, scrim, Escape, focus-trap, click-outside) is the
 * oj-ui Modal; the header strip is a PanelHeader and the search field is an
 * oj-ui Input. The device cards (MIDIDeviceCard) and section layout are kept.
 */

import { useCallback, useMemo } from 'react';
import { Modal, PanelHeader, Input, Kbd } from '@openjammer/oj-ui';
import { useMIDIStore } from '../../store/midiStore';
import { getPresetRegistry } from '../../midi';
import { MIDIDeviceCard } from './MIDIDeviceCard';
import { ScrollContainer } from '../common/ScrollContainer';
import './MIDIDeviceBrowser.css';

interface MIDIDeviceBrowserProps {
    onSelectDevice: (deviceId: string | null, presetId: string) => boolean;
}

export function MIDIDeviceBrowser({ onSelectDevice }: MIDIDeviceBrowserProps) {
    const isOpen = useMIDIStore((s) => s.isBrowserOpen);
    const searchQuery = useMIDIStore((s) => s.browserSearchQuery);
    const setSearchQuery = useMIDIStore((s) => s.setSearchQuery);
    const closeBrowser = useMIDIStore((s) => s.closeBrowser);
    const inputs = useMIDIStore((s) => s.inputs);

    // Get all presets - registry is a singleton so safe to call inside useMemo
    const allPresets = useMemo(() => {
        const registry = getPresetRegistry();
        return registry.getAllPresets();
    }, []);

    // Filter presets based on search query
    const filteredPresets = useMemo(() => {
        if (!searchQuery.trim()) return allPresets;

        const query = searchQuery.toLowerCase();
        return allPresets.filter(
            (preset) =>
                preset.name.toLowerCase().includes(query) ||
                preset.manufacturer.toLowerCase().includes(query)
        );
    }, [allPresets, searchQuery]);

    // Get connected devices with matched presets
    // Group multiple ports from the same physical device into one entry
    const connectedDevices = useMemo(() => {
        const registry = getPresetRegistry();
        const devices: Array<{
            deviceId: string;
            name: string;
            presetId: string;
            isConnected: boolean;
        }> = [];

        // Group devices by preset (physical device)
        const devicesByPreset = new Map<string, Array<{
            id: string;
            name: string;
            state: string;
            isPreferred: boolean;
        }>>();

        // Devices without a matching preset
        const genericDevices: Array<{
            id: string;
            name: string;
            state: string;
        }> = [];

        inputs.forEach((device) => {
            const matchedPreset = registry.matchDevice(device.name);

            if (matchedPreset) {
                // Group by preset ID (same physical device)
                if (!devicesByPreset.has(matchedPreset.id)) {
                    devicesByPreset.set(matchedPreset.id, []);
                }

                // Check if this is the preferred port
                const isPreferred = matchedPreset.preferredPort
                    ? device.name.includes(matchedPreset.preferredPort)
                    : false;

                devicesByPreset.get(matchedPreset.id)!.push({
                    id: device.id,
                    name: device.name,
                    state: device.state,
                    isPreferred
                });
            } else {
                // No preset match - show as generic
                genericDevices.push({
                    id: device.id,
                    name: device.name,
                    state: device.state
                });
            }
        });

        // For each preset group, pick the best port and show as one device
        devicesByPreset.forEach((ports, presetId) => {
            const preset = registry.getPreset(presetId);
            if (!preset) return;

            // Pick preferred port, or first connected, or just first
            const preferredPort = ports.find(p => p.isPreferred);
            const connectedPort = ports.find(p => p.state === 'connected');
            const bestPort = preferredPort || connectedPort || ports[0];

            if (bestPort) {
                devices.push({
                    deviceId: bestPort.id,
                    name: preset.name, // Use preset name, not port name
                    presetId: presetId,
                    isConnected: ports.some(p => p.state === 'connected')
                });
            }
        });

        // Add generic devices
        genericDevices.forEach((device) => {
            devices.push({
                deviceId: device.id,
                name: device.name,
                presetId: 'generic',
                isConnected: device.state === 'connected'
            });
        });

        return devices;
    }, [inputs]);

    // Handle selecting a preset
    // Only closes browser if node was successfully created
    const handleSelectPreset = useCallback(
        (presetId: string, deviceId: string | null = null) => {
            const success = onSelectDevice(deviceId, presetId);
            if (success) {
                closeBrowser();
            }
            // If not success, browser stays open and existing node flashes red
        },
        [onSelectDevice, closeBrowser]
    );

    // Handle selecting a connected device
    // Only closes browser if node was successfully created
    const handleSelectDevice = useCallback(
        (deviceId: string, presetId: string) => {
            const success = onSelectDevice(deviceId, presetId);
            if (success) {
                closeBrowser();
            }
            // If not success, browser stays open and existing node flashes red
        },
        [onSelectDevice, closeBrowser]
    );

    return (
        <Modal open={isOpen} onClose={closeBrowser} ariaLabel="Select MIDI Device" size="lg">
            <PanelHeader title="Select MIDI Device" onClose={closeBrowser}>
                <Input
                    type="text"
                    placeholder="Search devices..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    aria-label="Search MIDI devices"
                />
            </PanelHeader>

            {/* Connected Devices Section */}
            {connectedDevices.length > 0 && (
                <ScrollContainer mode="dropdown" className="midi-browser-section">
                    <h3>Connected Devices</h3>
                    <div className="midi-device-grid">
                        {connectedDevices.map((device) => (
                            <MIDIDeviceCard
                                key={device.deviceId}
                                name={device.name}
                                presetId={device.presetId}
                                isConnected={device.isConnected}
                                onClick={() =>
                                    handleSelectDevice(device.deviceId, device.presetId)
                                }
                            />
                        ))}
                    </div>
                </ScrollContainer>
            )}

            {/* All Presets Section */}
            <ScrollContainer mode="dropdown" className="midi-browser-section">
                <h3>Device Presets</h3>
                <div className="midi-device-grid">
                    {filteredPresets.map((preset) => (
                        <MIDIDeviceCard
                            key={preset.id}
                            name={preset.name}
                            presetId={preset.id}
                            manufacturer={preset.manufacturer}
                            isConnected={false}
                            onClick={() => handleSelectPreset(preset.id)}
                        />
                    ))}
                </div>
                {filteredPresets.length === 0 && (
                    <div className="midi-browser-empty">
                        No presets match your search
                    </div>
                )}
            </ScrollContainer>

            {/* Footer hint */}
            <div className="midi-browser-footer">
                <span>
                    Press <Kbd>Esc</Kbd> to close
                </span>
            </div>
        </Modal>
    );
}
