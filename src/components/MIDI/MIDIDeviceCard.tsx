/**
 * MIDI Device Card - Device preview card for browser grid
 *
 * Shows device name, manufacturer, connection status, and icon
 */

import { useMemo } from 'react';
import { Button } from '@openjammer/oj-ui';
import { getPresetRegistry } from '../../midi';
import './MIDIDeviceCard.css';

interface MIDIDeviceCardProps {
    name: string;
    presetId: string;
    manufacturer?: string;
    isConnected: boolean;
    onClick: () => void;
}

export function MIDIDeviceCard({
    name,
    presetId,
    manufacturer,
    isConnected,
    onClick
}: MIDIDeviceCardProps) {
    // Get preset info for icon
    const registry = getPresetRegistry();
    const preset = useMemo(() => registry.getPreset(presetId), [registry, presetId]);

    // Determine icon based on preset or default
    const icon = useMemo(() => {
        if (presetId === 'generic') return '\u{1F3B9}';  // Musical keyboard emoji
        if (preset?.visualization?.svgPath) return null; // Will use SVG
        // Default icons based on controls
        if (preset?.controls?.pads && preset.controls.pads.length > 0) return '\u{1F3B5}';  // Drum pads
        if (preset?.controls?.keys) return '\u{1F3B9}';  // Piano/keyboard
        return '\u{1F3B6}';  // Generic music note
    }, [preset, presetId]);

    // Get display manufacturer
    const displayManufacturer = manufacturer || preset?.manufacturer || 'Unknown';

    return (
        <Button
            className={`midi-device-card ${isConnected ? 'connected' : ''}`}
            onClick={onClick}
            type="button"
        >
            {/* Device icon/image */}
            <div className="midi-device-card-icon">
                {icon && <span className="midi-device-emoji">{icon}</span>}
            </div>

            {/* Device info */}
            <div className="midi-device-card-info">
                <span className="midi-device-card-name">{name}</span>
                <span className="midi-device-card-manufacturer">{displayManufacturer}</span>
            </div>

            {/* Connection indicator */}
            {isConnected && (
                <div className="midi-device-card-status">
                    <div className="midi-device-status-dot connected" />
                    <span>Connected</span>
                </div>
            )}
        </Button>
    );
}
