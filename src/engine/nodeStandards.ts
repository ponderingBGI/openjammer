/**
 * Node Standards - Reusable patterns and utilities for node development
 *
 * This module provides standardized patterns for creating consistent, high-quality nodes.
 * Use these templates, validators, and utilities when building new nodes.
 *
 * @see docs/node-standards.md for full documentation
 * @see docs/creating-nodes.md for step-by-step guide
 */

import type { PortDefinition, ConnectionType, NodeCategory } from './types';

// ============================================================================
// Naming Conventions
// ============================================================================

/**
 * Naming validation patterns
 *
 * @example
 * NAMING.nodeType.test('audio-mixer')  // true
 * NAMING.nodeType.test('AudioMixer')   // false
 * NAMING.portId.test('audio-in')       // true
 * NAMING.component.test('AudioMixerNode')  // true
 */
export const NAMING = {
    /** Node types must be kebab-case: 'audio-mixer', 'mini-lab-3' */
    nodeType: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,

    /** Port IDs must be kebab-case: 'audio-in', 'control-out' */
    portId: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,

    /** Component names must be PascalCase ending in Node: 'AudioMixerNode' */
    component: /^[A-Z][a-zA-Z0-9]+Node$/,

    /** CSS classes follow node type: '.audio-mixer-node' */
    cssClass: /^\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
} as const;

/**
 * Validate a node type name
 */
export function isValidNodeType(nodeType: string): boolean {
    return NAMING.nodeType.test(nodeType);
}

/**
 * Validate a port ID
 */
export function isValidPortId(portId: string): boolean {
    return NAMING.portId.test(portId);
}

/**
 * Validate a component name
 */
export function isValidComponentName(name: string): boolean {
    return NAMING.component.test(name);
}

/**
 * Convert kebab-case to PascalCase with Node suffix
 *
 * @example
 * toComponentName('audio-mixer')  // 'AudioMixerNode'
 * toComponentName('mini-lab-3')   // 'MiniLab3Node'
 */
export function toComponentName(nodeType: string): string {
    return nodeType
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Node';
}

/**
 * Convert PascalCase component name to kebab-case node type
 *
 * @example
 * toNodeType('AudioMixerNode')  // 'audio-mixer'
 * toNodeType('MiniLab3Node')    // 'mini-lab-3'
 */
export function toNodeType(componentName: string): string {
    return componentName
        .replace(/Node$/, '')
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '')
        .replace(/(\d+)/g, '-$1')
        .replace(/--/g, '-');
}

// ============================================================================
// Port Templates
// ============================================================================

/**
 * Standard port templates for common port configurations
 * Use these as a base and customize as needed.
 *
 * @example
 * const myPorts = [
 *     { ...PORT_TEMPLATES.audioIn },
 *     { ...PORT_TEMPLATES.audioOut },
 *     { ...PORT_TEMPLATES.controlIn, id: 'gain', name: 'Gain' }
 * ];
 */
export const PORT_TEMPLATES = {
    // ---- Audio Ports ----

    /** Standard audio input (left side, centered) */
    audioIn: {
        id: 'audio-in',
        name: 'In',
        type: 'audio' as ConnectionType,
        direction: 'input' as const,
        position: { x: 0, y: 0.5 }
    },

    /** Standard audio output (right side, centered) */
    audioOut: {
        id: 'audio-out',
        name: 'Out',
        type: 'audio' as ConnectionType,
        direction: 'output' as const,
        position: { x: 1, y: 0.5 }
    },

    // ---- Control Ports ----

    /** Standard control input (left side, centered) */
    controlIn: {
        id: 'control-in',
        name: 'Control',
        type: 'control' as ConnectionType,
        direction: 'input' as const,
        position: { x: 0, y: 0.5 }
    },

    /** Standard control output (right side, centered) */
    controlOut: {
        id: 'control-out',
        name: 'Control',
        type: 'control' as ConnectionType,
        direction: 'output' as const,
        position: { x: 1, y: 0.5 }
    },

    // ---- Bundle Ports ----

    /** Bundle input for receiving grouped signals */
    bundleIn: {
        id: 'bundle-in',
        name: 'Bundle',
        type: 'control' as ConnectionType,
        direction: 'input' as const,
        isBundled: true,
        position: { x: 0, y: 0.5 }
    },

    /** Bundle output for sending grouped signals */
    bundleOut: {
        id: 'bundle-out',
        name: 'Bundle',
        type: 'control' as ConnectionType,
        direction: 'output' as const,
        isBundled: true,
        position: { x: 1, y: 0.5 }
    },

    // ---- Universal Ports ----

    /** Universal input (accepts any signal type) */
    universalIn: {
        id: 'in',
        name: 'In',
        type: 'universal' as ConnectionType,
        direction: 'input' as const,
        position: { x: 0, y: 0.5 }
    },

    /** Universal output (sends any signal type) */
    universalOut: {
        id: 'out',
        name: 'Out',
        type: 'universal' as ConnectionType,
        direction: 'output' as const,
        position: { x: 1, y: 0.5 }
    },

    // ---- Empty Slot Pattern ----

    /** Empty input slot for dynamic port creation */
    emptyInput: (index: number): PortDefinition => ({
        id: `empty-in-${index}`,
        name: '',
        type: 'control' as ConnectionType,
        direction: 'input' as const,
        position: { x: 0, y: 0.5 }
    }),

    /** Empty output slot for dynamic port creation */
    emptyOutput: (index: number): PortDefinition => ({
        id: `empty-out-${index}`,
        name: '',
        type: 'control' as ConnectionType,
        direction: 'output' as const,
        position: { x: 1, y: 0.5 }
    }),
} as const;

// ============================================================================
// Port Position Utilities
// ============================================================================

/**
 * Generate evenly-spaced port positions
 *
 * @param count Number of ports
 * @param x X position (0 = left, 1 = right)
 * @returns Array of position objects
 *
 * @example
 * // 3 evenly-spaced input ports on left side
 * const positions = calculatePortPositions(3, 0);
 * // Returns: [{ x: 0, y: 0.25 }, { x: 0, y: 0.5 }, { x: 0, y: 0.75 }]
 */
export function calculatePortPositions(
    count: number,
    x: number
): Array<{ x: number; y: number }> {
    return Array.from({ length: count }, (_, i) => ({
        x,
        y: (i + 1) / (count + 1)
    }));
}

/**
 * Generate port positions within a specific vertical range
 *
 * @param count Number of ports
 * @param x X position
 * @param startY Start of vertical range (0-1)
 * @param endY End of vertical range (0-1)
 *
 * @example
 * // 4 ports in the top half of the left side
 * const positions = calculatePortPositionsInRange(4, 0, 0.1, 0.5);
 */
export function calculatePortPositionsInRange(
    count: number,
    x: number,
    startY: number,
    endY: number
): Array<{ x: number; y: number }> {
    if (count <= 0) return [];
    if (count === 1) return [{ x, y: (startY + endY) / 2 }];

    const step = (endY - startY) / (count - 1);
    return Array.from({ length: count }, (_, i) => ({
        x,
        y: startY + i * step
    }));
}

/**
 * Create a port with calculated position
 *
 * @example
 * const ports = [
 *     createPort('in-1', 'Input 1', 'audio', 'input', 0, 0.33),
 *     createPort('in-2', 'Input 2', 'audio', 'input', 0, 0.67),
 *     createPort('out', 'Output', 'audio', 'output', 1, 0.5),
 * ];
 */
export function createPort(
    id: string,
    name: string,
    type: ConnectionType,
    direction: 'input' | 'output',
    x: number,
    y: number,
    options?: { isBundled?: boolean; hideExternalLabel?: boolean }
): PortDefinition {
    return {
        id,
        name,
        type,
        direction,
        position: { x, y },
        ...options
    };
}

// ============================================================================
// Category-Specific Required Fields
// ============================================================================

/**
 * Required data fields by node category
 *
 * These are the minimum fields each category should include for consistency.
 * Use these when creating new nodes to ensure proper integration.
 */
export const REQUIRED_FIELDS: Record<NodeCategory, string[]> = {
    input: ['isActive'],
    instruments: ['rows'],  // Row-based structure
    effects: ['params'],
    routing: [],  // Minimal requirements
    output: ['volume', 'isMuted'],
    utility: [],  // Minimal requirements
};

/**
 * Recommended data fields by category (optional but encouraged)
 */
export const RECOMMENDED_FIELDS: Record<NodeCategory, string[]> = {
    input: ['isMuted', 'deviceId', 'lowLatencyMode'],
    instruments: ['instrumentId', 'isLoading'],
    effects: ['effectType', 'bypass'],
    routing: ['portLabels'],
    output: ['deviceId'],
    utility: ['resolvedType'],
};

// ============================================================================
// Default Data Templates
// ============================================================================

/**
 * Default data templates by category
 *
 * Use these as starting points for node defaultData.
 *
 * @example
 * const myNodeDefinition = {
 *     type: 'my-effect',
 *     category: 'effects',
 *     defaultData: {
 *         ...DEFAULT_DATA.effects,
 *         myCustomField: 'value'
 *     }
 * };
 */
export const DEFAULT_DATA: Record<NodeCategory, Record<string, unknown>> = {
    input: {
        isActive: false,
        isMuted: false,
    },

    instruments: {
        rows: [],
        isLoading: false,
    },

    effects: {
        effectType: null,
        params: {},
        bypass: false,
    },

    routing: {
        portLabels: {},
    },

    output: {
        volume: 0.8,
        isMuted: false,
    },

    utility: {
        resolvedType: null,
    },
};

// ============================================================================
// Default Dimensions
// ============================================================================

/**
 * Standard node dimensions by category
 *
 * These are sensible defaults - override if your node needs different sizing.
 */
export const DEFAULT_DIMENSIONS: Record<NodeCategory, { width: number; height: number }> = {
    input: { width: 180, height: 80 },
    instruments: { width: 200, height: 100 },
    effects: { width: 160, height: 80 },
    routing: { width: 140, height: 60 },
    output: { width: 180, height: 100 },
    utility: { width: 80, height: 60 },
};

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validation result for node definitions
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validate port positions are within 0-1 range
 */
export function validatePortPositions(ports: PortDefinition[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const port of ports) {
        if (port.position) {
            const { x, y } = port.position;
            if (x < 0 || x > 1) {
                errors.push(`Port '${port.id}' has invalid x position: ${x} (must be 0-1)`);
            }
            if (y < 0 || y > 1) {
                errors.push(`Port '${port.id}' has invalid y position: ${y} (must be 0-1)`);
            }
        }

        if (!isValidPortId(port.id) && !port.id.startsWith('empty-')) {
            warnings.push(`Port '${port.id}' should use kebab-case naming`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate a complete node definition
 */
export function validateNodeDefinition(def: {
    type: string;
    category: NodeCategory;
    defaultPorts: PortDefinition[];
    defaultData: Record<string, unknown>;
}): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate node type
    if (!isValidNodeType(def.type)) {
        errors.push(`Node type '${def.type}' should be kebab-case`);
    }

    // Validate ports
    const portValidation = validatePortPositions(def.defaultPorts);
    errors.push(...portValidation.errors);
    warnings.push(...portValidation.warnings);

    // Check for required fields
    const requiredFields = REQUIRED_FIELDS[def.category] || [];
    for (const field of requiredFields) {
        if (!(field in def.defaultData)) {
            warnings.push(`Missing recommended field '${field}' for ${def.category} category`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ============================================================================
// Common Port Configurations
// ============================================================================

/**
 * Pre-built port arrays for common node patterns
 *
 * @example
 * const myNode = {
 *     defaultPorts: PORT_CONFIGS.stereoEffect
 * };
 */
export const PORT_CONFIGS = {
    /** Single audio pass-through: audio-in → audio-out */
    audioPassthrough: [
        { ...PORT_TEMPLATES.audioIn },
        { ...PORT_TEMPLATES.audioOut }
    ],

    /** Stereo effect: left + right in → left + right out */
    stereoEffect: [
        createPort('left-in', 'Left In', 'audio', 'input', 0, 0.33),
        createPort('right-in', 'Right In', 'audio', 'input', 0, 0.67),
        createPort('left-out', 'Left Out', 'audio', 'output', 1, 0.33),
        createPort('right-out', 'Right Out', 'audio', 'output', 1, 0.67),
    ],

    /** Mixer: 3 inputs → 1 output */
    mixer3to1: [
        createPort('in-1', 'In 1', 'audio', 'input', 0, 0.25),
        createPort('in-2', 'In 2', 'audio', 'input', 0, 0.5),
        createPort('in-3', 'In 3', 'audio', 'input', 0, 0.75),
        createPort('out', 'Out', 'audio', 'output', 1, 0.5),
    ],

    /** Effect with sidechain: audio + control → audio */
    sidechainEffect: [
        createPort('audio-in', 'Audio', 'audio', 'input', 0, 0.33),
        createPort('sidechain', 'Sidechain', 'audio', 'input', 0, 0.67),
        createPort('audio-out', 'Out', 'audio', 'output', 1, 0.5),
    ],

    /** Instrument: bundle in → audio out */
    instrument: [
        { ...PORT_TEMPLATES.bundleIn, id: 'keys', name: 'Keys' },
        { ...PORT_TEMPLATES.audioOut },
    ],

    /** Utility: 2 universal inputs → 1 universal output */
    utility2to1: [
        createPort('in-1', 'A', 'universal', 'input', 0, 0.33),
        createPort('in-2', 'B', 'universal', 'input', 0, 0.67),
        createPort('out', 'Out', 'universal', 'output', 1, 0.5),
    ],
} as const;

// ============================================================================
// CSS Class Generators
// ============================================================================

/**
 * Generate standard CSS class for a node
 *
 * @example
 * const className = getNodeClassName('audio-mixer', { selected: true, dragging: false });
 * // Returns: 'audio-mixer-node selected'
 */
export function getNodeClassName(
    nodeType: string,
    state?: { selected?: boolean; dragging?: boolean; hovering?: boolean }
): string {
    const classes = [`${nodeType}-node`];

    if (state?.selected) classes.push('selected');
    if (state?.dragging) classes.push('dragging');
    if (state?.hovering) classes.push('hovering');

    return classes.join(' ');
}

// ============================================================================
// Export all utilities
// ============================================================================

export default {
    // Naming
    NAMING,
    isValidNodeType,
    isValidPortId,
    isValidComponentName,
    toComponentName,
    toNodeType,

    // Ports
    PORT_TEMPLATES,
    PORT_CONFIGS,
    calculatePortPositions,
    calculatePortPositionsInRange,
    createPort,

    // Data
    REQUIRED_FIELDS,
    RECOMMENDED_FIELDS,
    DEFAULT_DATA,
    DEFAULT_DIMENSIONS,

    // Validation
    validatePortPositions,
    validateNodeDefinition,

    // CSS
    getNodeClassName,
};
