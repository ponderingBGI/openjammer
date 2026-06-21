/**
 * Shared type guards for node data validation
 *
 * These type guards provide runtime type checking for data from the graph store.
 * They are used across multiple components (nodes, audio engine, visual nodes).
 */

import type { InstrumentNodeData, InstrumentRow, SamplerNodeData, SamplerRow, SpeakerNodeData, NodeData } from './types';

// ============================================================================
// Validation Constants
// ============================================================================

/**
 * Validation bounds for instrument row data
 * Exported for use in UI components that need to clamp values
 */
export const VALIDATION_BOUNDS = {
    MIN_PORT_COUNT: 1,
    MAX_PORT_COUNT: 128,  // Reasonable upper bound for MIDI
    MIN_NOTE: 0,          // C
    MAX_NOTE: 11,         // B
    MIN_OCTAVE: 0,
    MAX_OCTAVE: 8,
    MIN_OFFSET: -48,      // 4 octaves down
    MAX_OFFSET: 48,       // 4 octaves up
    MIN_SPREAD: 0,
    MAX_SPREAD: 12,       // Max 1 octave spread per key
    MIN_KEY_GAIN: 0,      // Minimum per-key gain multiplier
    MAX_KEY_GAIN: 10,     // Maximum per-key gain multiplier (10x amplification cap)
} as const;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for instrument row validation
 * Validates both structure and value ranges
 */
export function isValidInstrumentRow(row: unknown): row is InstrumentRow {
    if (typeof row !== 'object' || row === null) return false;
    const r = row as Record<string, unknown>;

    // Type checks (Number.isFinite rejects NaN/Infinity which would pass range checks)
    if (typeof r.rowId !== 'string') return false;
    if (typeof r.portCount !== 'number' || !Number.isFinite(r.portCount)) return false;
    if (typeof r.baseNote !== 'number' || !Number.isFinite(r.baseNote)) return false;
    if (typeof r.baseOctave !== 'number' || !Number.isFinite(r.baseOctave)) return false;
    if (typeof r.baseOffset !== 'number' || !Number.isFinite(r.baseOffset)) return false;
    if (typeof r.spread !== 'number' || !Number.isFinite(r.spread)) return false;

    // Range validation
    if (r.portCount < VALIDATION_BOUNDS.MIN_PORT_COUNT ||
        r.portCount > VALIDATION_BOUNDS.MAX_PORT_COUNT) return false;
    if (r.baseNote < VALIDATION_BOUNDS.MIN_NOTE ||
        r.baseNote > VALIDATION_BOUNDS.MAX_NOTE) return false;
    if (r.baseOctave < VALIDATION_BOUNDS.MIN_OCTAVE ||
        r.baseOctave > VALIDATION_BOUNDS.MAX_OCTAVE) return false;
    if (r.baseOffset < VALIDATION_BOUNDS.MIN_OFFSET ||
        r.baseOffset > VALIDATION_BOUNDS.MAX_OFFSET) return false;
    if (r.spread < VALIDATION_BOUNDS.MIN_SPREAD ||
        r.spread > VALIDATION_BOUNDS.MAX_SPREAD) return false;

    // Validate keyGains if present (optional field)
    if ('keyGains' in r && r.keyGains !== undefined) {
        if (!Array.isArray(r.keyGains)) return false;
        const gains = r.keyGains as unknown[];
        const validGains = gains.every((g): g is number =>
            typeof g === 'number' &&
            Number.isFinite(g) &&
            g >= VALIDATION_BOUNDS.MIN_KEY_GAIN &&
            g <= VALIDATION_BOUNDS.MAX_KEY_GAIN
        );
        if (!validGains) return false;
    }

    return true;
}

/**
 * Type guard for sampler row validation
 * Validates both structure and value ranges
 */
export function isValidSamplerRow(row: unknown): row is SamplerRow {
    if (typeof row !== 'object' || row === null) return false;
    const r = row as Record<string, unknown>;

    // Required string field checks
    if (typeof r.rowId !== 'string' || r.rowId.length === 0) return false;
    if (typeof r.sourceNodeId !== 'string' || r.sourceNodeId.length === 0) return false;
    if (typeof r.sourcePortId !== 'string' || r.sourcePortId.length === 0) return false;
    if (typeof r.targetPortId !== 'string' || r.targetPortId.length === 0) return false;
    if (typeof r.label !== 'string') return false; // label can be empty

    // Required number field checks
    if (typeof r.portCount !== 'number' || !Number.isFinite(r.portCount)) return false;
    if (typeof r.spread !== 'number' || !Number.isFinite(r.spread)) return false;
    if (typeof r.gain !== 'number' || !Number.isFinite(r.gain)) return false;

    // Range validation
    if (r.portCount < VALIDATION_BOUNDS.MIN_PORT_COUNT ||
        r.portCount > VALIDATION_BOUNDS.MAX_PORT_COUNT) return false;
    if (r.spread < VALIDATION_BOUNDS.MIN_SPREAD ||
        r.spread > VALIDATION_BOUNDS.MAX_SPREAD) return false;
    if (r.gain < 0 || r.gain > 2) return false;  // 0-2 gain range

    return true;
}

/**
 * Type guard for instrument node data with runtime validation
 * Validates both structure and content of rows array including value ranges
 *
 * Supports both:
 * - New row-based system (rows array)
 * - Offset-based config (offsets object — the built-in instrument default)
 * - Empty data (no configuration yet)
 */
export function isInstrumentNodeData(data: unknown): data is InstrumentNodeData {
    if (typeof data !== 'object' || data === null) return false;

    const d = data as Record<string, unknown>;

    // Check for new row-based system
    if ('rows' in d && Array.isArray(d.rows)) {
        // Validate each row has required fields with valid ranges
        const rows = d.rows as unknown[];
        return rows.every(isValidInstrumentRow);
    }

    // Check for the offset-based config (built-in instrument default)
    if ('offsets' in d && typeof d.offsets === 'object' && d.offsets !== null) {
        return true;
    }

    // Empty data object is valid (no configuration yet)
    return Object.keys(d).length === 0 || (!('rows' in d) && !('offsets' in d));
}

/**
 * Simplified type guard for instrument node data
 * Only checks basic structure without full range validation
 * Use this for UI components where full validation isn't critical
 */
export function isBasicInstrumentNodeData(data: unknown): data is InstrumentNodeData {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;

    // Check for row-based system (new format)
    if ('rows' in d) {
        if (!Array.isArray(d.rows)) return false;
        // Validate at least basic structure for rows
        return d.rows.every((row: unknown) => {
            if (typeof row !== 'object' || row === null) return false;
            const r = row as Record<string, unknown>;
            return typeof r.rowId === 'string';
        });
    }

    // Check for the offset-based config (built-in instrument default)
    if ('offsets' in d && typeof d.offsets === 'object' && d.offsets !== null) {
        return true;
    }

    // Empty data object is valid (no configuration yet)
    return Object.keys(d).length === 0;
}

/**
 * Type guard for sampler node data with row validation
 * Supports both:
 * - New row-based system (rows array)
 * - Legacy single-input system (no rows)
 */
export function isSamplerNodeData(data: unknown): data is SamplerNodeData {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;

    // Check for new row-based system
    if ('rows' in d && Array.isArray(d.rows)) {
        // Validate each row has required fields with valid ranges
        const rows = d.rows as unknown[];
        return rows.every(isValidSamplerRow);
    }

    // No rows = valid (legacy or empty data)
    return true;
}

/**
 * Type guard for speaker node data
 */
export function isSpeakerNodeData(data: unknown): data is SpeakerNodeData {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as Record<string, unknown>;

    // Check for expected speaker fields
    if ('deviceId' in d && typeof d.deviceId !== 'string' && d.deviceId !== null) {
        return false;
    }
    if ('volume' in d && (typeof d.volume !== 'number' || !Number.isFinite(d.volume))) {
        return false;
    }

    return true;
}

/**
 * Generic type guard for any node data
 * Returns true if data is a valid object (not null)
 */
export function isNodeData(data: unknown): data is NodeData {
    return typeof data === 'object' && data !== null;
}
