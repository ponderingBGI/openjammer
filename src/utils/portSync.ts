/**
 * Port Synchronization - Sync canvas-input/output nodes with parent node ports
 */

import type { GraphNode, PortDefinition, Connection, BundleInfo, BundlePortDefinition } from '../engine/types';
import { generateUniqueId } from './idGenerator';
import { getBundleInfo as getBundleInfoFromManager } from './bundleManager';

// ============================================================================
// Port ID Validation
// ============================================================================

/**
 * Validate a port ID to prevent path traversal and injection attacks
 *
 * Valid IDs:
 * - Must start with a letter
 * - Can contain letters, numbers, hyphens, and underscores
 * - Cannot be empty
 * - Cannot contain path traversal characters (../, /, \)
 * - Cannot contain XSS/injection characters (<, >, &, ", ', ;, etc.)
 *
 * This pattern is intentionally strict to prevent:
 * - Path traversal attacks (../../etc/passwd)
 * - XSS attacks (<script>alert(1)</script>)
 * - SQL injection ('OR 1=1--)
 * - Command injection (;rm -rf /)
 *
 * @param id - The port ID to validate
 * @returns true if the ID is safe, false otherwise
 */
export function isValidPortId(id: string): boolean {
    if (!id || typeof id !== 'string') return false;

    // Limit length to prevent DoS via extremely long strings
    if (id.length > 256) return false;

    // Must start with a letter, then contain only alphanumeric, hyphen, underscore
    return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id);
}

/**
 * Validate a composite port ID (panelId:portId format)
 *
 * @param id - The composite port ID to validate (e.g., "output-panel-123:port-1")
 * @returns true if both parts are valid, false otherwise
 */
export function isValidCompositePortId(id: string): boolean {
    if (!id || typeof id !== 'string') return false;

    // Limit length
    if (id.length > 512) return false;

    const colonIndex = id.indexOf(':');
    if (colonIndex === -1) {
        return isValidPortId(id);
    }

    // Only one colon allowed
    if (id.indexOf(':', colonIndex + 1) !== -1) return false;

    const panelId = id.substring(0, colonIndex);
    const portId = id.substring(colonIndex + 1);

    return isValidPortId(panelId) && isValidPortId(portId);
}

/**
 * Sanitize a port ID by removing invalid characters
 * Use this for display purposes only, not for security-critical operations
 *
 * @param id - The port ID to sanitize
 * @returns A sanitized version of the ID, or 'invalid-port' if completely invalid
 */
export function sanitizePortId(id: string): string {
    if (!id || typeof id !== 'string') return 'invalid-port';

    // Remove any character that's not alphanumeric, hyphen, or underscore
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');

    // Ensure it starts with a letter
    if (!sanitized || !/^[a-zA-Z]/.test(sanitized)) {
        return 'port-' + sanitized.substring(0, 50);
    }

    return sanitized.substring(0, 256);
}

/**
 * Synchronize a node's ports with its internal canvas-input/output nodes
 *
 * This ensures that:
 * - Each SPECIAL canvas-output node internally creates an output port on the parent
 * - Each SPECIAL canvas-input node internally creates an input port on the parent
 * - Port names are synced from the canvas node's portName data
 *
 * Only nodes in specialNodes array are synced (prevents individual keys from appearing as ports)
 *
 * @param node - The parent node
 * @param childNodes - Optional array of child nodes (for flat structure). If not provided, uses node.childIds with graphStore lookup.
 * @param connections - Optional connections map for filtering by connection status
 * @param onlyConnected - If true, only include ports that have connections (for parent-level display)
 */
export function syncPortsWithInternalNodes(
    node: GraphNode,
    childNodes?: GraphNode[],
    connections?: Map<string, Connection>,
    onlyConnected: boolean = false
): PortDefinition[] {
    const ports: PortDefinition[] = [];
    const specialNodeIds = new Set(node.specialNodes || []);

    // Get visibility configuration from the node
    const showEmptyInputs = node.showEmptyInputPorts ?? false;
    const showEmptyOutputs = node.showEmptyOutputPorts ?? false;

    // If childNodes provided, use them directly (for addNode during creation)
    // Otherwise, this function is being called without children available
    if (!childNodes || childNodes.length === 0) {
        return ports;
    }

    // Scan child nodes for canvas-input and canvas-output types
    // Only sync nodes that are in the specialNodes array
    childNodes.forEach((childNode) => {
        // Skip non-special nodes
        if (!specialNodeIds.has(childNode.id)) {
            return;
        }

        // For canvas-input/canvas-output, check if they have internal connections
        // (skip this check for panel nodes - they have per-port filtering below)
        if (onlyConnected && connections) {
            if (childNode.type === 'canvas-input' || childNode.type === 'canvas-output') {
                const hasConnection = hasInternalConnection(childNode, connections);
                if (!hasConnection) {
                    return; // Skip this port - no connections
                }
            }
            // For output-panel and input-panel, the per-port filtering below handles visibility
        }

        if (childNode.type === 'canvas-input') {
            // Canvas-input creates an input port on parent
            const portName = (childNode.data.portName as string) || 'Input';

            // DETECT port type from internal node's output port
            const internalPort = childNode.ports.find(p => p.direction === 'output');
            const portType = internalPort?.type || 'control';

            ports.push({
                id: childNode.id,
                name: portName,
                type: portType,  // Use detected type instead of hardcoded 'control'
                direction: 'input'
            });
        } else if (childNode.type === 'canvas-output') {
            // Canvas-output creates an output port on parent
            const portName = (childNode.data.portName as string) || 'Output';

            // DETECT port type from internal node's input port
            const internalPort = childNode.ports.find(p => p.direction === 'input');
            const portType = internalPort?.type || 'control';

            ports.push({
                id: childNode.id,
                name: portName,
                type: portType,  // Use detected type instead of hardcoded 'control'
                direction: 'output'
            });
        } else if (childNode.type === 'output-panel') {
            // Output-panel creates multiple output ports on parent (one per input port)
            const portLabels = (childNode.data.portLabels as Record<string, string>) || {};
            const portHideExternalLabel = (childNode.data.portHideExternalLabel as Record<string, boolean>) || {};
            const inputPorts = childNode.ports.filter(p => p.direction === 'input');

            inputPorts.forEach((internalPort) => {
                const portName = portLabels[internalPort.id] || internalPort.name || 'Output';

                // Skip empty ports unless showEmptyOutputs is true
                if (onlyConnected && !showEmptyOutputs && connections) {
                    const hasConn = Array.from(connections.values()).some(
                        c => c.targetNodeId === childNode.id && c.targetPortId === internalPort.id
                    );
                    if (!hasConn) return;
                }

                ports.push({
                    id: `${childNode.id}:${internalPort.id}`,  // Composite ID: panelId:portId
                    name: portName,
                    type: internalPort.type || 'control',
                    direction: 'output',  // Input on panel = Output on parent
                    hideExternalLabel: portHideExternalLabel[internalPort.id] ?? false
                });
            });
        } else if (childNode.type === 'input-panel') {
            // Input-panel creates multiple input ports on parent (one per output port)
            const portLabels = (childNode.data.portLabels as Record<string, string>) || {};
            const portHideExternalLabel = (childNode.data.portHideExternalLabel as Record<string, boolean>) || {};
            const outputPorts = childNode.ports.filter(p => p.direction === 'output');

            outputPorts.forEach((internalPort) => {
                const portName = portLabels[internalPort.id] || internalPort.name || 'Input';

                // Skip empty ports unless showEmptyInputs is true
                if (onlyConnected && !showEmptyInputs && connections) {
                    const hasConn = Array.from(connections.values()).some(
                        c => c.sourceNodeId === childNode.id && c.sourcePortId === internalPort.id
                    );
                    if (!hasConn) return;
                }

                ports.push({
                    id: `${childNode.id}:${internalPort.id}`,  // Composite ID: panelId:portId
                    name: portName,
                    type: internalPort.type || 'control',
                    direction: 'input',  // Output on panel = Input on parent
                    hideExternalLabel: portHideExternalLabel[internalPort.id] ?? false
                });
            });
        }
    });

    return ports;
}

/**
 * Check if a canvas-input/output node has any internal connections
 */
function hasInternalConnection(childNode: GraphNode, connections: Map<string, Connection>): boolean {
    for (const conn of connections.values()) {
        if (childNode.type === 'canvas-input') {
            // Canvas-input sends signals out, so check if it's a source
            if (conn.sourceNodeId === childNode.id) {
                return true;
            }
        } else if (childNode.type === 'canvas-output') {
            // Canvas-output receives signals, so check if it's a target
            if (conn.targetNodeId === childNode.id) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Update a node's ports to match its internal canvas-input/output nodes
 *
 * This should be called:
 * - After creating/deleting internal canvas-input/output nodes
 * - After renaming internal canvas-input/output nodes
 */
export function updateNodePortsFromInternals(node: GraphNode): GraphNode {
    const syncedPorts = syncPortsWithInternalNodes(node);

    return {
        ...node,
        ports: syncedPorts
    };
}

// ============================================================================
// Bundle Detection
// ============================================================================

/**
 * Determine if a connection should be displayed as a "bundle" (thicker wire)
 *
 * A connection is bundled when:
 * 1. The source port corresponds to a canvas-output node inside the source node
 * 2. That canvas-output has multiple incoming internal connections
 *
 * @param connection - The connection to check
 * @param nodes - All nodes in the graph
 * @param allConnections - All connections in the graph
 * @returns Number of internal connections (1 = single, >1 = bundle)
 */
export function getConnectionBundleCount(
    connection: Connection,
    nodes: Map<string, GraphNode>,
    allConnections: Map<string, Connection>
): number {
    const sourceNode = nodes.get(connection.sourceNodeId);
    if (!sourceNode) return 1;

    // Check if source port is a special node (canvas-output)
    const specialNodes = sourceNode.specialNodes || [];
    if (!specialNodes.includes(connection.sourcePortId)) {
        return 1; // Not a canvas-output, so single connection
    }

    // The sourcePortId IS the canvas-output node's ID
    // Count internal connections TO this canvas-output
    let internalConnectionCount = 0;

    for (const conn of allConnections.values()) {
        // Connection targets this canvas-output node
        if (conn.targetNodeId === connection.sourcePortId) {
            internalConnectionCount++;
        }
    }

    return Math.max(1, internalConnectionCount);
}

/**
 * Check if a connection is bundled (has multiple internal wires)
 */
export function isConnectionBundled(
    connection: Connection,
    nodes: Map<string, GraphNode>,
    allConnections: Map<string, Connection>
): boolean {
    return getConnectionBundleCount(connection, nodes, allConnections) > 1;
}

// ============================================================================
// Bundle Size Detection for Instrument Nodes
// ============================================================================

/**
 * Get bundle size and label from a source port
 *
 * Used when connecting a keyboard output to an instrument input.
 * Detects how many internal connections feed into the keyboard's output-panel port,
 * which tells us how many ports to create on the instrument.
 *
 * @param sourceNodeId - The source node (e.g., keyboard)
 * @param sourcePortId - The source port ID (may be composite like "output-panel-xxx:port-1")
 * @param nodes - All nodes in the graph
 * @param connections - All connections in the graph
 * @returns Bundle size (number of internal connections) and label from source
 */
export function getBundleSizeFromSourcePort(
    sourceNodeId: string,
    sourcePortId: string,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
): { size: number; label: string } {
    // Validate port ID to prevent injection attacks
    if (!isValidCompositePortId(sourcePortId)) {
        console.warn('[portSync] Invalid source port ID rejected:', sourcePortId);
        return { size: 1, label: 'Input' };
    }

    // Parse composite port ID: "output-panel-xxx:port-1"
    const colonIndex = sourcePortId.indexOf(':');
    const panelId = colonIndex !== -1 ? sourcePortId.substring(0, colonIndex) : sourcePortId;
    const portId = colonIndex !== -1 ? sourcePortId.substring(colonIndex + 1) : null;

    const sourceNode = nodes.get(sourceNodeId);
    if (!sourceNode) return { size: 1, label: 'Input' };

    // Find the output-panel node
    const panel = nodes.get(panelId);
    if (!panel || panel.type !== 'output-panel') {
        // Not an output-panel, return single connection
        return { size: 1, label: 'Input' };
    }

    // Get label from panel's portLabels
    const portLabels = panel.data.portLabels as Record<string, string> | undefined;
    const label = (portLabels && portId) ? (portLabels[portId] || 'Input') : 'Input';

    // Count internal connections TO this panel port
    let size = 0;
    for (const conn of connections.values()) {
        if (conn.targetNodeId === panelId && conn.targetPortId === portId) {
            size++;
        }
    }

    return { size: Math.max(1, size), label };
}

/**
 * Check if a node is an instrument type
 */
export function isInstrumentNode(node: GraphNode): boolean {
    const instrumentTypes = [
        'piano', 'cello', 'electricCello', 'violin', 'saxophone',
        'strings', 'keys', 'winds', 'instrument', 'sampler'
    ];
    return instrumentTypes.includes(node.type);
}

// ============================================================================
// Dynamic Port Addition
// ============================================================================

interface DynamicPortResult {
    newNode: GraphNode | null;
    updatedNode: { id: string; ports: PortDefinition[]; data: Record<string, unknown> } | null;
}

/**
 * Check if we should add a new dynamic port to a parent node
 *
 * For output-panel nodes: Adds a new port when all ports have connections (or panel is empty)
 * For input-panel nodes: Adds a new port when all ports have connections (or panel is empty)
 * For canvas-output nodes: Creates a new canvas-output node when all existing ones have connections
 *
 * @param parentId - The parent node ID
 * @param nodes - All nodes in the graph
 * @param connections - All connections in the graph
 * @returns New node to add, updated node with new port, or null if no changes needed
 */
export function checkDynamicPortAddition(
    parentId: string,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
): DynamicPortResult {
    const parent = nodes.get(parentId);
    if (!parent) return { newNode: null, updatedNode: null };

    // Only keyboard nodes get dynamic ports for now
    if (parent.type !== 'keyboard') {
        return { newNode: null, updatedNode: null };
    }

    const specialNodeIds = new Set(parent.specialNodes || []);

    // Check for output-panel (new approach)
    const outputPanel = parent.childIds
        .map(id => nodes.get(id))
        .find((n): n is GraphNode =>
            n !== undefined &&
            n.type === 'output-panel' &&
            specialNodeIds.has(n.id)
        );

    if (outputPanel) {
        // Check if ALL input ports on the output-panel have connections
        const inputPorts = outputPanel.ports.filter(p => p.direction === 'input');
        const allPortsConnected = inputPorts.length === 0 || inputPorts.every(port =>
            Array.from(connections.values()).some(
                c => c.targetNodeId === outputPanel.id && c.targetPortId === port.id
            )
        );

        if (allPortsConnected) {
            // Add a new empty port to the output-panel (no name - it's a placeholder)
            const nextIndex = inputPorts.length + 1;
            const newPortId = `port-${nextIndex}`;

            // Calculate y position for new port (distribute evenly)
            const yPosition = 0.15 + ((nextIndex - 1) * 0.23);

            const newPorts = [
                ...outputPanel.ports,
                {
                    id: newPortId,
                    name: '',  // Empty name for placeholder port
                    type: 'control' as const,
                    direction: 'input' as const,
                    position: { x: 0, y: Math.min(yPosition, 0.92) }
                }
            ];

            const newPortLabels = {
                ...(outputPanel.data.portLabels as Record<string, string> || {}),
                [newPortId]: ''  // Empty label for placeholder port
            };

            return {
                newNode: null,
                updatedNode: {
                    id: outputPanel.id,
                    ports: newPorts,
                    data: { ...outputPanel.data, portLabels: newPortLabels }
                }
            };
        }
    }

    // Check for input-panel
    const inputPanel = parent.childIds
        .map(id => nodes.get(id))
        .find((n): n is GraphNode =>
            n !== undefined &&
            n.type === 'input-panel' &&
            specialNodeIds.has(n.id)
        );

    if (inputPanel) {
        // Check if ALL output ports on the input-panel have connections
        const outputPorts = inputPanel.ports.filter(p => p.direction === 'output');
        const allPortsConnected = outputPorts.length === 0 || outputPorts.every(port =>
            Array.from(connections.values()).some(
                c => c.sourceNodeId === inputPanel.id && c.sourcePortId === port.id
            )
        );

        if (allPortsConnected) {
            // Add a new empty port to the input-panel (no name - it's a placeholder)
            const nextIndex = outputPorts.length + 1;
            const newPortId = `port-${nextIndex}`;

            // Calculate y position for new port (distribute evenly)
            const yPosition = 0.15 + ((nextIndex - 1) * 0.23);

            const newPorts = [
                ...inputPanel.ports,
                {
                    id: newPortId,
                    name: '',  // Empty name for placeholder port
                    type: 'control' as const,
                    direction: 'output' as const,  // Output on input-panel = Input on parent
                    position: { x: 1, y: Math.min(yPosition, 0.92) }
                }
            ];

            const newPortLabels = {
                ...(inputPanel.data.portLabels as Record<string, string> || {}),
                [newPortId]: ''  // Empty label for placeholder port
            };

            return {
                newNode: null,
                updatedNode: {
                    id: inputPanel.id,
                    ports: newPorts,
                    data: { ...inputPanel.data, portLabels: newPortLabels }
                }
            };
        }
    }

    // Fallback: Check for canvas-output nodes (legacy approach)
    const canvasOutputs = parent.childIds
        .map(id => nodes.get(id))
        .filter((n): n is GraphNode =>
            n !== undefined &&
            n.type === 'canvas-output' &&
            specialNodeIds.has(n.id)
        );

    if (canvasOutputs.length === 0) {
        return { newNode: null, updatedNode: null };
    }

    const allConnected = canvasOutputs.every(node =>
        Array.from(connections.values()).some(c => c.targetNodeId === node.id)
    );

    if (allConnected) {
        const lastOutput = canvasOutputs[canvasOutputs.length - 1];
        const nextIndex = canvasOutputs.length + 1;

        const newNode: GraphNode = {
            id: generateUniqueId('canvas-output-'),
            type: 'canvas-output',
            category: 'routing',
            position: {
                x: lastOutput.position.x,
                y: lastOutput.position.y + 80
            },
            data: { portName: `Output ${nextIndex}` },
            ports: [{ id: 'in', name: 'In', type: 'control', direction: 'input' }],
            parentId: parentId,
            childIds: []
        };

        return { newNode, updatedNode: null };
    }

    return { newNode: null, updatedNode: null };
}

/**
 * Check if we should remove excess free ports from a panel
 *
 * Ensures there's always exactly ONE free port on the panel.
 * If there are 2+ free ports, remove the extras.
 *
 * @param parentId - The parent node ID
 * @param nodes - All nodes in the graph
 * @param connections - All connections in the graph
 * @returns Updated node with port removed, or null if no changes needed
 */
export function checkDynamicPortRemoval(
    parentId: string,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
): { updatedNode: { id: string; ports: PortDefinition[]; data: Record<string, unknown> } | null } {
    const parent = nodes.get(parentId);
    if (!parent) return { updatedNode: null };

    // Only keyboard nodes get dynamic ports for now
    if (parent.type !== 'keyboard') {
        return { updatedNode: null };
    }

    const specialNodeIds = new Set(parent.specialNodes || []);

    // Check for output-panel
    const outputPanel = parent.childIds
        .map(id => nodes.get(id))
        .find((n): n is GraphNode =>
            n !== undefined &&
            n.type === 'output-panel' &&
            specialNodeIds.has(n.id)
        );

    if (outputPanel) {
        const inputPorts = outputPanel.ports.filter(p => p.direction === 'input');

        // Count how many ports are NOT connected (free ports)
        const freePorts = inputPorts.filter(port =>
            !Array.from(connections.values()).some(
                c => c.targetNodeId === outputPanel.id && c.targetPortId === port.id
            )
        );

        // If there are 2+ free ports, remove the last one(s) until only 1 remains
        // But never go below 4 ports (the default)
        if (freePorts.length > 1 && inputPorts.length > 4) {
            // Find the last free port (highest port number that's not connected)
            const sortedFreePorts = freePorts.sort((a, b) => {
                const aNum = parseInt(a.id.replace('port-', ''), 10) || 0;
                const bNum = parseInt(b.id.replace('port-', ''), 10) || 0;
                return bNum - aNum;  // Descending order
            });

            const portToRemove = sortedFreePorts[0];  // Highest numbered free port

            const newPorts = outputPanel.ports.filter(p => p.id !== portToRemove.id);
            const newPortLabels = { ...(outputPanel.data.portLabels as Record<string, string> || {}) };
            delete newPortLabels[portToRemove.id];

            return {
                updatedNode: {
                    id: outputPanel.id,
                    ports: newPorts,
                    data: { ...outputPanel.data, portLabels: newPortLabels }
                }
            };
        }
    }

    // Check for input-panel
    const inputPanel = parent.childIds
        .map(id => nodes.get(id))
        .find((n): n is GraphNode =>
            n !== undefined &&
            n.type === 'input-panel' &&
            specialNodeIds.has(n.id)
        );

    if (inputPanel) {
        const outputPorts = inputPanel.ports.filter(p => p.direction === 'output');

        // Count how many ports are NOT connected (free ports)
        const freePorts = outputPorts.filter(port =>
            !Array.from(connections.values()).some(
                c => c.sourceNodeId === inputPanel.id && c.sourcePortId === port.id
            )
        );

        // If there are 2+ free ports, remove the last one(s) until only 1 remains
        // Input panel can go down to 0 ports (then 1 free one will be added)
        if (freePorts.length > 1 && outputPorts.length > 1) {
            // Find the last free port (highest port number that's not connected)
            const sortedFreePorts = freePorts.sort((a, b) => {
                const aNum = parseInt(a.id.replace('port-', ''), 10) || 0;
                const bNum = parseInt(b.id.replace('port-', ''), 10) || 0;
                return bNum - aNum;  // Descending order
            });

            const portToRemove = sortedFreePorts[0];  // Highest numbered free port

            const newPorts = inputPanel.ports.filter(p => p.id !== portToRemove.id);
            const newPortLabels = { ...(inputPanel.data.portLabels as Record<string, string> || {}) };
            delete newPortLabels[portToRemove.id];

            return {
                updatedNode: {
                    id: inputPanel.id,
                    ports: newPorts,
                    data: { ...inputPanel.data, portLabels: newPortLabels }
                }
            };
        }
    }

    return { updatedNode: null };
}

// ============================================================================
// Generic Bundle Detection and Target Expansion
// ============================================================================

/**
 * Detect if a source port is a bundle and return full BundleInfo
 * Returns null if not a bundle (no internal connections)
 * Note: Size 1 bundles (like pedal) are valid and should create their own row
 *
 * This function returns full BundleInfo with channel details for expandable UI
 */
export function detectBundleInfo(
    sourceNodeId: string,
    sourcePortId: string,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
): BundleInfo | null {
    // Use the new bundle manager to get full bundle info with channels
    return getBundleInfoFromManager(sourceNodeId, sourcePortId, nodes, connections);
}

/**
 * Legacy function for backward compatibility
 * Returns simple size/label for code that doesn't need full bundle info
 */
export function detectBundleInfoSimple(
    sourceNodeId: string,
    sourcePortId: string,
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
): { size: number; label: string } | null {
    const result = getBundleSizeFromSourcePort(sourceNodeId, sourcePortId, nodes, connections);
    return result.size >= 1 ? result : null;
}

/**
 * Expand a target node to receive a bundle connection with full BundleInfo
 * Creates a BundlePortDefinition with expandable UI support
 *
 * @param targetNodeId - The target node receiving the bundle
 * @param bundleInfo - Full bundle info with channels
 * @param nodes - All nodes in the graph
 * @returns Info needed to update the input-panel, or null if target doesn't support expansion
 */
export function expandTargetForBundleWithInfo(
    targetNodeId: string,
    bundleInfo: BundleInfo,
    nodes: Map<string, GraphNode>
): {
    panelId: string;
    newPorts: BundlePortDefinition[];
    newPortLabels: Record<string, string>;
    newPortHideExternalLabel: Record<string, boolean>;
} | null {
    const targetNode = nodes.get(targetNodeId);
    if (!targetNode) return null;

    // Find input-panel in target's children (if it has one)
    const specialNodeIds = new Set(targetNode.specialNodes || []);
    const inputPanel = targetNode.childIds
        .map(id => nodes.get(id))
        .find((n): n is GraphNode =>
            n?.type === 'input-panel' && specialNodeIds.has(n.id)
        );

    if (!inputPanel) return null;  // Target doesn't support bundle expansion

    // Create a bundle port with full channel info for expandable UI
    const newPorts: BundlePortDefinition[] = [];
    const newPortLabels: Record<string, string> = {};
    const newPortHideExternalLabel: Record<string, boolean> = {};
    const existingOutputPorts = inputPanel.ports.filter(p =>
        p.direction === 'output' && !p.id.startsWith('port-placeholder') && !p.id.startsWith('empty-')
    );

    const portId = generateUniqueId('bundle-');
    const portIndex = existingOutputPorts.length;
    const totalCount = existingOutputPorts.length + 1;

    // Calculate y position distributed evenly
    const yPosition = 0.1 + (portIndex / Math.max(totalCount, 1)) * 0.8;

    // Create bundle port with full info for expandable UI
    const bundlePort: BundlePortDefinition = {
        id: portId,
        name: `${bundleInfo.bundleLabel} (${bundleInfo.channels.length})`,
        type: 'control',
        direction: 'output',  // Output on input-panel = Input on parent
        position: { x: 1, y: Math.min(yPosition, 0.92) },
        bundleInfo: {
            ...bundleInfo,
            expanded: false  // Start collapsed
        }
    };

    newPorts.push(bundlePort);
    newPortLabels[portId] = bundlePort.name;
    newPortHideExternalLabel[portId] = false;

    return {
        panelId: inputPanel.id,
        newPorts,
        newPortLabels,
        newPortHideExternalLabel
    };
}

/**
 * Expand a target node to receive a bundle connection
 * Works for ANY node that has an input-panel as a special node
 *
 * @param targetNodeId - The target node receiving the bundle
 * @param bundleSize - Number of ports to create
 * @param bundleLabel - Label for the first port
 * @param nodes - All nodes in the graph
 * @returns Info needed to update the input-panel, or null if target doesn't support expansion
 */
export function expandTargetForBundle(
    targetNodeId: string,
    _bundleSize: number,  // Kept for API compatibility, but we create 1 port per bundle
    bundleLabel: string,
    nodes: Map<string, GraphNode>
): {
    panelId: string;
    newPorts: PortDefinition[];
    newPortLabels: Record<string, string>;
    newPortHideExternalLabel: Record<string, boolean>;
} | null {
    const targetNode = nodes.get(targetNodeId);
    if (!targetNode) return null;

    // Find input-panel in target's children (if it has one)
    const specialNodeIds = new Set(targetNode.specialNodes || []);
    const inputPanel = targetNode.childIds
        .map(id => nodes.get(id))
        .find((n): n is GraphNode =>
            n?.type === 'input-panel' && specialNodeIds.has(n.id)
        );

    if (!inputPanel) return null;  // Target doesn't support bundle expansion

    // Create ONE port per bundle (not one per key in the bundle)
    // The bundle size is stored in InstrumentRow.portCount for audio routing
    const newPorts: PortDefinition[] = [];
    const newPortLabels: Record<string, string> = {};
    const newPortHideExternalLabel: Record<string, boolean> = {};
    const existingOutputPorts = inputPanel.ports.filter(p =>
        p.direction === 'output' && !p.id.startsWith('port-placeholder')
    );

    const portId = generateUniqueId('bundle-');
    const portIndex = existingOutputPorts.length;
    const totalCount = existingOutputPorts.length + 1;

    // Calculate y position distributed evenly
    const yPosition = 0.1 + (portIndex / Math.max(totalCount, 1)) * 0.8;

    newPorts.push({
        id: portId,
        name: bundleLabel,
        type: 'control',
        direction: 'output',  // Output on input-panel = Input on parent
        position: { x: 1, y: Math.min(yPosition, 0.92) }
    });

    newPortLabels[portId] = bundleLabel;
    newPortHideExternalLabel[portId] = false;

    return {
        panelId: inputPanel.id,
        newPorts,
        newPortLabels,
        newPortHideExternalLabel
    };
}
