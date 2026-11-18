/**
 * MIDI Device Card — one device or preset in the browser grid.
 *
 * A real button (so Tab, Enter and Space all work for free) wearing the New DNA
 * card physics: surface fill, one hairline, sh1, a 2px hover lift and a spring
 * press. "Connected" is a StatusDot beside the word `Connected` in success ink —
 * never a pulsing halo. Nothing glows here; only signal glows.
 */

import { useMemo } from 'react';
import { StatusDot } from '@openjammer/oj-ui';
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
        <button
            type="button"
            className={`midi-device-card ${isConnected ? 'is-connected' : ''}`}
            aria-label={`${name}, ${displayManufacturer}${isConnected ? ', connected' : ''}`}
            onClick={onClick}
        >
            <span className="midi-device-card-icon" aria-hidden="true">
                {icon && <span className="midi-device-emoji">{icon}</span>}
            </span>

            <span className="midi-device-card-info">
                <span className="midi-device-card-name">{name}</span>
                <span className="midi-device-card-manufacturer">{displayManufacturer}</span>
            </span>

            {isConnected && (
                <span className="midi-device-card-status">
                    <StatusDot status="ok" />
                    Connected
                </span>
            )}
        </button>
    );
}
