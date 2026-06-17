/**
 * BundleManager - Centralized bundle management utility
 *
 * Handles:
 * - "Always one empty slot" invariant for panels
 * - Bundle detection from source ports
 * - Bundle expansion (reveal channels on target)
 * - Bundle collapse back to single port
 * - Channel label generation ({ParentName} {InputType} {Number})
 */

import type {
    GraphNode,
    PortDefinition,
    Connection,
    BundleInfo,
    BundleChannel,
    BundlePortDefinition
} from '../engine/types';
import { generateUniqueId } from './idGenerator';
import { isValidCompositePortId } from './portSync';

// ============================================================================
// Configuration
// ============================================================================

/** Port ID prefix for empty placeholder ports */
const EMPTY_PORT_PREFIX = 'empty-';

/** Default position for new empty ports */
const DEFAULT_PORT_Y = 0.9;

// ============================================================================
// Empty Slot Management
// ============================================================================

/**
 * Check if a port is an empty placeholder
 */
export function isEmptyPort(port: PortDefinition): boolean {
    return port.id.startsWith(EMPTY_PORT_PREFIX) || port.name === '';
}

/**
 * Check if a port has any connections
 */
export function isPortConnected(
    portId: string,
    nodeId: string,
    connections: Map<string, Connection>,
    direction: 'input' | 'output'
): boolean {
    for (const conn of connections.values()) {
        if (direction === 'input') {
            // For input panels, ports have direction='output' (they output inside)
            // But they receive connections from outside (as targets)
            if (conn.targetNodeId === nodeId && conn.targetPortId === portId) {
                return true;
            }
        } else {
            // For output panels, ports have direction='input' (they receive inside)
            // But connections FROM them use sourceNodeId/sourcePortId
            if (conn.sourceNodeId === nodeId && conn.sourcePortId === portId) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Ensure a panel has exactly one empty slot
 *
 * Call this after any connection change to maintain the invariant.
 *
 * @param panel - The input-panel or output-panel node
 * @param connections - All connections in the graph
 * @param panelType - 'input' or 'output' (determines port direction to check)
 * @returns Updated panel node with correct empty slot count
 */
export function ensureEmptySlot(
    panel: GraphNode,
    connections: Map<string, Connection>,
    panelType: 'input' | 'output'
): GraphNode {
    // Determine which direction ports to manage
    // Input panel has output ports (they output signals inside)
    // Output panel has input ports (they receive signals inside)
    const portDirection: 'input' | 'output' = panelType === 'input' ? 'output' : 'input';

    const relevantPorts = panel.ports.filter(p => p.direction === portDirection);

    // Find empty (unconnected) ports
    const emptyPorts = relevantPorts.filter(port =>
        !isPortConnected(port.id, panel.id, connections, panelType)
    );

    // Find connected ports (we need to keep all of these)
    const connectedPorts = relevantPorts.filter(port =>
        isPortConnected(port.id, panel.id, connections, panelType)
    );

    // Keep ports of opposite direction unchanged
    const otherPorts = panel.ports.filter(p => p.direction !== portDirection);

    if (emptyPorts.length === 0) {
        // No empty slots - add one
        const newPortId = generateUniqueId(EMPTY_PORT_PREFIX);
        const newPort: PortDefinition = {
            id: newPortId,
            name: '',
            type: 'control',
            direction: portDirection,
            position: { x: portDirection === 'output' ? 1 : 0, y: DEFAULT_PORT_Y }
        };

        const updatedPortLabels = {
            ...(panel.data.portLabels as Record<string, string> || {}),
            [newPortId]: ''
        };

        const updatedPortHideExternalLabel = {
            ...(panel.data.portHideExternalLabel as Record<string, boolean> || {}),
            [newPortId]: true  // Hide empty port label on parent
        };

        return {
            ...panel,
            ports: [...otherPorts, ...connectedPorts, newPort],
            data: {
                ...panel.data,
                portLabels: updatedPortLabels,
                portHideExternalLabel: updatedPortHideExternalLabel
            }
        };
    } else if (emptyPorts.length > 1) {
        // Too many empty slots - keep only one (the first one)
        const portsToRemove = new Set(emptyPorts.slice(1).map(p => p.id));

        const filteredPorts = panel.ports.filter(p => !portsToRemove.has(p.id));

        // Clean up port labels and hide flags
        const updatedPortLabels = { ...(panel.data.portLabels as Record<string, string> || {}) };
        const updatedPortHideExternalLabel = { ...(panel.data.portHideExternalLabel as Record<string, boolean> || {}) };

        for (const portId of portsToRemove) {
            delete updatedPortLabels[portId];
            delete updatedPortHideExternalLabel[portId];
        }

        return {
            ...panel,
            ports: filteredPorts,
            data: {
                ...panel.data,
                portLabels: updatedPortLabels,
                portHideExternalLabel: updatedPortHideExternalLabel
            }
        };
    }

    // Exactly one empty slot - no changes needed
    return panel;
}

// ============================================================================
// Bundle Detection
// ============================================================================

/**
 * Human-readable names for node types
 */
const NODE_TYPE_NAMES: Record<string, string> = {
    'keyboard': 'Keyboard',
    'minilab-3': 'MiniLab3',
    'midi': 'MIDI',
    'piano': 'Piano',
    'cello': 'Cello',
    'violin': 'Violin',
    'container': 'Container'
};

/**
 * Human-readable names for control types (derived from port ID patterns)
 */
function getControlTypeName(portId: string): string {
    if (portId.startsWith('key-')) return 'Key';
    if (portId.startsWith('pad-')) return 'Pad';
    if (portId.startsWith('knob-')) return 'Knob';
    if (portId.startsWith('fader-')) return 'Fader';
    if (portId.includes('pitch')) return 'Pitch';
    if (portId.includes('mod')) return 'Mod';
    if (portId.includes('row')) return 'Row';
    return 'Ch';  // Generic channel
}

/**
 * Generate channel label in format: "{ParentName} {InputType} {Number}"
 */
function generateChannelLabel(
    sourceNodeName: string,
    portId: string,
    index: number
): string {
    const controlType = getControlTypeName(portId);
    return `${sourceNodeName} ${controlType} ${index + 1}`;
}

/**
 * Get bundle info from a source port
 *
 * Analyzes the internal connections to an output-panel port to determine:
 * - How many channels are in the bundle
 * - What to label each channel
 *
 * @param sourceNodeId - The source node (e.g., keyboard, minilab-3)
 * @param sourcePortId - The source port ID (may be composite: "output-panel-xxx:port-1")
 * @param nodes - All nodes in the graph
 * @param connections - All connections in the graph
 * @returns BundleInfo or null if not a bundle
 */
export function getBundleInfo(
    sourceNodeId: string,
    sourcePortId: string,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
): BundleInfo | null {
    // Validate port ID
    if (!isValidCompositePortId(sourcePortId)) {
        return null;
    }

    // Parse composite port ID: "output-panel-xxx:port-1"
    const colonIndex = sourcePortId.indexOf(':');
    if (colonIndex === -1) {
        return null;  // Not a composite ID, not from a panel
    }

    const panelId = sourcePortId.substring(0, colonIndex);
    const portId = sourcePortId.substring(colonIndex + 1);

    // Get the source node
    const sourceNode = nodes.get(sourceNodeId);
    if (!sourceNode) return null;

    // Get the output-panel node
    const panel = nodes.get(panelId);
    if (!panel || panel.type !== 'output-panel') {
        return null;
    }

    // Get label from panel's portLabels
    const portLabels = panel.data.portLabels as Record<string, string> | undefined;
    const bundleLabel = (portLabels && portLabels[portId]) || 'Bundle';

    // Get source node name
    const sourceNodeName = NODE_TYPE_NAMES[sourceNode.type] || sourceNode.type;

    // Collect internal connections to this panel port
    const internalConnections: Array<{ sourceNodeId: string; sourcePortId: string }> = [];
    for (const conn of connections.values()) {
        if (conn.targetNodeId === panelId && conn.targetPortId === portId) {
            internalConnections.push({
                sourceNodeId: conn.sourceNodeId,
                sourcePortId: conn.sourcePortId
            });
        }
    }

    if (internalConnections.length === 0) {
        return null;  // No connections, not a bundle
    }

    // Create channel entries
    const channels: BundleChannel[] = internalConnections.map((conn, index) => ({
        id: `${sourcePortId}-ch-${index}`,
        label: generateChannelLabel(sourceNodeName, conn.sourcePortId, index),
        sourcePortId: conn.sourcePortId,
        sourceNodeId: conn.sourceNodeId
    }));

    const fullLabel = `${sourceNodeName} ${bundleLabel}`;
    return {
        bundleId: sourcePortId,
        bundleLabel: fullLabel,
        label: fullLabel,  // Alias for bundleLabel
        size: channels.length,  // Number of channels
        sourceNodeName,
        sourceNodeType: sourceNode.type,
        channels,
        expanded: false  // Start collapsed
    };
}

// ============================================================================
// Bundle Expansion
// ============================================================================

/**
 * Expand a target panel to receive a bundle connection
 *
 * Creates a new bundle port on the input-panel with associated BundleInfo.
 * The port starts collapsed (showing just the bundle name + count).
 *
 * @param targetPanel - The input-panel receiving the bundle
 * @param bundleInfo - Information about the incoming bundle
 * @param targetPortId - The port ID to create (or replace)
 * @returns Updated panel node with bundle port
 */
export function expandTargetForBundle(
    targetPanel: GraphNode,
    bundleInfo: BundleInfo,
    targetPortId?: string
): GraphNode {
    if (targetPanel.type !== 'input-panel') {
        console.warn('[BundleManager] expandTargetForBundle called on non-input-panel');
        return targetPanel;
    }

    // Generate port ID if not provided
    const portId = targetPortId || generateUniqueId('bundle-');

    // Find the empty port to replace (if any)
    const emptyPortIndex = targetPanel.ports.findIndex(
        p => p.direction === 'output' && isEmptyPort(p)
    );

    // Calculate position for new port
    const existingOutputPorts = targetPanel.ports.filter(
        p => p.direction === 'output' && !isEmptyPort(p)
    );
    const yPosition = 0.1 + (existingOutputPorts.length / Math.max(existingOutputPorts.length + 2, 1)) * 0.8;

    // Create the bundle port
    const bundlePort: BundlePortDefinition = {
        id: portId,
        name: `${bundleInfo.bundleLabel} (${bundleInfo.channels.length})`,
        type: 'control',
        direction: 'output',  // Output on input-panel = input on parent
        position: { x: 1, y: Math.min(yPosition, 0.85) },
        bundleInfo
    };

    // Update ports array
    let newPorts: PortDefinition[];
    if (emptyPortIndex !== -1) {
        // Replace the empty port with bundle port
        newPorts = [
            ...targetPanel.ports.slice(0, emptyPortIndex),
            bundlePort,
            ...targetPanel.ports.slice(emptyPortIndex + 1)
        ];
    } else {
        // Add bundle port
        newPorts = [...targetPanel.ports, bundlePort];
    }

    // Update port labels
    const updatedPortLabels = {
        ...(targetPanel.data.portLabels as Record<string, string> || {}),
        [portId]: bundlePort.name
    };

    return {
        ...targetPanel,
        ports: newPorts,
        data: {
            ...targetPanel.data,
            portLabels: updatedPortLabels
        }
    };
}

/**
 * Toggle bundle expansion state
 *
 * @param panel - The input-panel containing the bundle port
 * @param bundlePortId - The ID of the bundle port to toggle
 * @returns Updated panel with toggled expansion state
 */
export function toggleBundleExpansion(
    panel: GraphNode,
    bundlePortId: string
): GraphNode {
    const portIndex = panel.ports.findIndex(p => p.id === bundlePortId);
    if (portIndex === -1) return panel;

    const port = panel.ports[portIndex] as BundlePortDefinition;
    if (!port.bundleInfo) return panel;  // Not a bundle port

    const updatedBundleInfo: BundleInfo = {
        ...port.bundleInfo,
        expanded: !port.bundleInfo.expanded
    };

    const updatedPort: BundlePortDefinition = {
        ...port,
        bundleInfo: updatedBundleInfo
    };

    return {
        ...panel,
        ports: [
            ...panel.ports.slice(0, portIndex),
            updatedPort,
            ...panel.ports.slice(portIndex + 1)
        ]
    };
}

/**
 * Collapse a bundle port (remove expanded channel ports)
 *
 * @param panel - The input-panel containing the bundle port
 * @param bundlePortId - The ID of the bundle port to collapse
 * @returns Updated panel with collapsed bundle
 */
export function collapseBundlePort(
    panel: GraphNode,
    bundlePortId: string
): GraphNode {
    const portIndex = panel.ports.findIndex(p => p.id === bundlePortId);
    if (portIndex === -1) return panel;

    const port = panel.ports[portIndex] as BundlePortDefinition;
    if (!port.bundleInfo) return panel;

    const updatedPort: BundlePortDefinition = {
        ...port,
        bundleInfo: {
            ...port.bundleInfo,
            expanded: false
        }
    };

    return {
        ...panel,
        ports: [
            ...panel.ports.slice(0, portIndex),
            updatedPort,
            ...panel.ports.slice(portIndex + 1)
        ]
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the bundle info for a port if it has one
 */
export function getPortBundleInfo(
    panel: GraphNode,
    portId: string
): BundleInfo | null {
    const port = panel.ports.find(p => p.id === portId) as BundlePortDefinition | undefined;
    return port?.bundleInfo || null;
}

/**
 * Check if a port is a bundle port
 */
export function isBundlePort(port: PortDefinition): port is BundlePortDefinition {
    return 'bundleInfo' in port && (port as BundlePortDefinition).bundleInfo !== undefined;
}

/**
 * Recalculate port positions after changes
 * Distributes ports evenly along the panel edge
 */
export function recalculatePortPositions(
    panel: GraphNode,
    direction: 'input' | 'output'
): GraphNode {
    const relevantPorts = panel.ports.filter(p => p.direction === direction);
    const otherPorts = panel.ports.filter(p => p.direction !== direction);

    if (relevantPorts.length === 0) return panel;

    const x = direction === 'output' ? 1 : 0;
    const startY = 0.1;
    const endY = 0.9;
    const spacing = (endY - startY) / Math.max(relevantPorts.length, 1);

    const repositionedPorts = relevantPorts.map((port, index) => ({
        ...port,
        position: {
            x,
            y: startY + spacing * index + spacing / 2
        }
    }));

    return {
        ...panel,
        ports: [...otherPorts, ...repositionedPorts]
    };
}
