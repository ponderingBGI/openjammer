/**
 * MIDI Device Configuration Types
 *
 * Declarative configuration for MIDI controllers. These types define:
 * - Control layouts (keys, knobs, faders, pads, strips)
 * - MIDI mappings (CC numbers, note ranges, channels)
 * - Visual appearance and sizing
 * - Default connection bundles
 *
 * Use this to quickly define new MIDI devices without manually
 * specifying port positions - the DOM handles positioning.
 */

import type { PortDefinition } from '../../engine/types';
import { isBlackKey, noteLabel } from './noteNames';

// ============================================================================
// Control Type Definitions
// ============================================================================

export type ControlType = 'key' | 'knob' | 'fader' | 'pad' | 'strip' | 'encoder' | 'button';

export interface BaseControl {
    /** Unique ID for this control (used as port ID) */
    id: string;
    /** Control type */
    type: ControlType;
    /** Human-readable label */
    label?: string;
}

export interface KeyControl extends BaseControl {
    type: 'key';
    /** MIDI note number */
    note: number;
    /** MIDI channel (0-15) */
    channel?: number;
    /** Whether this is a black key */
    isBlack?: boolean;
}

export interface KnobControl extends BaseControl {
    type: 'knob';
    /** MIDI CC number */
    cc: number;
    /** MIDI channel (0-15) */
    channel?: number;
    /** Is this an endless encoder? */
    endless?: boolean;
}

export interface FaderControl extends BaseControl {
    type: 'fader';
    /** MIDI CC number */
    cc: number;
    /** MIDI channel (0-15) */
    channel?: number;
}

export interface PadControl extends BaseControl {
    type: 'pad';
    /** MIDI note number */
    note: number;
    /** MIDI channel (0-15) */
    channel?: number;
    /** Does this pad support aftertouch? */
    aftertouch?: boolean;
    /** RGB capable? */
    rgb?: boolean;
}

export interface StripControl extends BaseControl {
    type: 'strip';
    /** For pitch bend strips */
    isPitchBend?: boolean;
    /** For CC-based strips */
    cc?: number;
    /** MIDI channel (0-15) */
    channel?: number;
}

export interface EncoderControl extends BaseControl {
    type: 'encoder';
    /** MIDI CC number */
    cc?: number;
    /** Is it a push encoder? */
    push?: boolean;
}

export interface ButtonControl extends BaseControl {
    type: 'button';
    /** MIDI CC or note number */
    cc?: number;
    note?: number;
    /** MIDI channel (0-15) */
    channel?: number;
}

export type MIDIControl =
    | KeyControl
    | KnobControl
    | FaderControl
    | PadControl
    | StripControl
    | EncoderControl
    | ButtonControl;

// ============================================================================
// Device Configuration
// ============================================================================

export interface MIDIDeviceConfig {
    /** Unique device type ID */
    type: string;
    /** Display name */
    name: string;
    /** Description */
    description?: string;
    /** Manufacturer */
    manufacturer?: string;

    /** Visual dimensions of the internal view */
    visualDimensions: {
        width: number;
        height: number;
    };

    /** Collapsed (external) node dimensions */
    collapsedDimensions: {
        width: number;
        height: number;
    };

    /** All controls on this device */
    controls: MIDIControl[];

    /** Default bundle connections when entering node */
    defaultBundles?: {
        /** Bundle name (e.g., "Keys", "Pads") */
        name: string;
        /** Control IDs to include in this bundle */
        controlIds: string[];
    }[];

    /** MIDI device detection patterns */
    devicePatterns?: {
        /** Name patterns to match (case-insensitive) */
        namePatterns: string[];
        /** Manufacturer patterns */
        manufacturerPatterns?: string[];
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate port definitions from a device config
 * These are used in the registry for the internal visual node
 */
export function generatePortsFromConfig(config: MIDIDeviceConfig): PortDefinition[] {
    return config.controls.map(control => ({
        id: control.id,
        name: control.label || control.id,
        type: 'control' as const,
        direction: 'output' as const,
        // No position - DOM lookup is used for exact positioning
    }));
}

/**
 * Generate port IDs for a range of keys (for piano keyboards)
 */
export function generateKeyPortIds(startNote: number, endNote: number): string[] {
    const ids: string[] = [];
    for (let note = startNote; note <= endNote; note++) {
        ids.push(`key-${note}`);
    }
    return ids;
}

/**
 * Generate key controls for a piano keyboard
 */
export function generateKeyControls(
    startNote: number,
    endNote: number,
    channel: number = 0
): KeyControl[] {
    const controls: KeyControl[] = [];
    for (let note = startNote; note <= endNote; note++) {
        controls.push({
            id: `key-${note}`,
            type: 'key',
            note,
            channel,
            isBlack: isBlackKey(note),
            label: noteLabel(note)
        });
    }

    return controls;
}

// ============================================================================
// Example Device Configs
// ============================================================================

/**
 * Arturia MiniLab 3 configuration
 */
export const MINILAB3_CONFIG: MIDIDeviceConfig = {
    type: 'minilab-3',
    name: 'MiniLab 3',
    description: 'Arturia MiniLab 3 - 25 keys, 8 pads, 8 knobs, 4 faders',
    manufacturer: 'Arturia',

    visualDimensions: { width: 650, height: 400 },
    collapsedDimensions: { width: 160, height: 120 },

    controls: [
        // 25 Keys (C3-C5, notes 48-72)
        ...generateKeyControls(48, 72, 0),

        // 8 Pads
        { id: 'pad-1', type: 'pad', note: 36, channel: 9, aftertouch: true },
        { id: 'pad-2', type: 'pad', note: 37, channel: 9, aftertouch: true },
        { id: 'pad-3', type: 'pad', note: 38, channel: 9, aftertouch: true },
        { id: 'pad-4', type: 'pad', note: 39, channel: 9, aftertouch: true },
        { id: 'pad-5', type: 'pad', note: 40, channel: 9, aftertouch: true },
        { id: 'pad-6', type: 'pad', note: 41, channel: 9, aftertouch: true },
        { id: 'pad-7', type: 'pad', note: 42, channel: 9, aftertouch: true },
        { id: 'pad-8', type: 'pad', note: 43, channel: 9, aftertouch: true },

        // 8 Knobs
        { id: 'knob-1', type: 'knob', cc: 74, endless: true },
        { id: 'knob-2', type: 'knob', cc: 71, endless: true },
        { id: 'knob-3', type: 'knob', cc: 76, endless: true },
        { id: 'knob-4', type: 'knob', cc: 77, endless: true },
        { id: 'knob-5', type: 'knob', cc: 93, endless: true },
        { id: 'knob-6', type: 'knob', cc: 18, endless: true },
        { id: 'knob-7', type: 'knob', cc: 19, endless: true },
        { id: 'knob-8', type: 'knob', cc: 16, endless: true },

        // 4 Faders
        { id: 'fader-1', type: 'fader', cc: 82 },
        { id: 'fader-2', type: 'fader', cc: 83 },
        { id: 'fader-3', type: 'fader', cc: 85 },
        { id: 'fader-4', type: 'fader', cc: 17 },

        // Touch strips
        { id: 'pitch-bend', type: 'strip', isPitchBend: true },
        { id: 'mod-wheel', type: 'strip', cc: 1 }
    ],

    defaultBundles: [
        {
            name: 'Keys',
            controlIds: generateKeyPortIds(48, 72)
        }
    ],

    devicePatterns: {
        namePatterns: ['minilab', 'minilab 3', 'minilab3'],
        manufacturerPatterns: ['arturia']
    }
};
