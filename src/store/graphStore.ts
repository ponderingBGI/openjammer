/**
 * Graph Store - Manages the node graph state with undo/redo history
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
    GraphNode,
    Connection,
    Position,
    NodeType,
    PortDefinition
} from '../engine/types';
import { getNodeDefinition, canConnect } from '../engine/registry';
import { createDefaultInternalStructure } from '../utils/nodeInternals';
import { syncPortsWithInternalNodes, checkDynamicPortAddition, checkDynamicPortRemoval, isInstrumentNode, detectBundleInfo, expandTargetForBundleWithInfo } from '../utils/portSync';
import { useUIFeedbackStore } from './uiFeedbackStore';
import { useCanvasNavigationStore } from './canvasNavigationStore';
import { useMIDIStore } from './midiStore';
import type { InstrumentRow, InstrumentNodeData, SamplerRow, SamplerNodeData } from '../engine/types';
import { applyGraphVerbs, diffGraph, type GraphStateSlice } from './graphVerbs';
import { isApplyingHistory, registerHistoryDriver, useHistoryStore, type EditVerb } from './historyStore';

// ============================================================================
// Constants
// ============================================================================

/** Node dimension constants - extracted for maintainability */
const NODE_DIMENSIONS = {
    // Keyboard node
    KEYBOARD_WIDTH: 160,
    KEYBOARD_HEIGHT: 120,

    // Speaker node
    SPEAKER_WIDTH: 140,
    SPEAKER_HEIGHT: 160,

    // Looper node
    LOOPER_WIDTH: 240,
    LOOPER_HEIGHT: 120,

    // Instrument nodes (dynamic height)
    INSTRUMENT_WIDTH: 180,
    INSTRUMENT_BASE_HEIGHT: 60,
    INSTRUMENT_PORT_HEIGHT: 28,

    // Default/standard nodes
    DEFAULT_WIDTH: 200,
    DEFAULT_HEIGHT: 150,
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function migrateNodePorts(node: GraphNode): GraphNode {
    if (!Array.isArray(node.ports)) {
        return node;
    }

    node.ports = node.ports
        .filter(port => !(node.type === 'looper' && port.id === 'sample-out'))
        // SEAM-1: the library node's only live seam is `sample-out` (the sampler PCM
        // feed). Its former `audio-out` / `trigger` ports had no engine consumer —
        // drop them from saved projects so no dead port lingers on the canvas.
        .filter(port => !(node.type === 'library' && (port.id === 'audio-out' || port.id === 'trigger')))
        .map(port => ({
            ...port,
            type: (port.type as string) === 'technical' ? 'control' : port.type
        }));

    return node;
}

function connectionPortsExist(conn: Connection, nodes: Map<string, GraphNode>): boolean {
    const sourceNode = nodes.get(conn.sourceNodeId);
    const targetNode = nodes.get(conn.targetNodeId);

    return Boolean(
        sourceNode?.ports.some(port => port.id === conn.sourcePortId) &&
        targetNode?.ports.some(port => port.id === conn.targetPortId)
    );
}

/**
 * Get approximate dimensions for a node based on its type
 */
export function getNodeDimensions(node: GraphNode): { width: number; height: number } {
    switch (node.type) {
        case 'keyboard':
            return {
                width: NODE_DIMENSIONS.KEYBOARD_WIDTH,
                height: NODE_DIMENSIONS.KEYBOARD_HEIGHT
            };
        case 'speaker':
            return {
                width: NODE_DIMENSIONS.SPEAKER_WIDTH,
                height: NODE_DIMENSIONS.SPEAKER_HEIGHT
            };
        case 'looper':
            return {
                width: NODE_DIMENSIONS.LOOPER_WIDTH,
                height: NODE_DIMENSIONS.LOOPER_HEIGHT
            };
        case 'piano':
        case 'cello':
        case 'electricCello':
        case 'violin':
        case 'saxophone':
        case 'strings':
        case 'keys':
        case 'winds': {
            // Instrument nodes: height varies by number of input ports
            const inputPorts = node.ports.filter(p => p.direction === 'input').length;
            return {
                width: NODE_DIMENSIONS.INSTRUMENT_WIDTH,
                height: NODE_DIMENSIONS.INSTRUMENT_BASE_HEIGHT + (inputPorts * NODE_DIMENSIONS.INSTRUMENT_PORT_HEIGHT)
            };
        }
        default:
            // Standard nodes (microphone, effect, multiplier, recorder)
            return {
                width: NODE_DIMENSIONS.DEFAULT_WIDTH,
                height: NODE_DIMENSIONS.DEFAULT_HEIGHT
            };
    }
}

export interface NodeBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

// ============================================================================
// Store Interface
// ============================================================================

interface ClipboardData {
    nodes: [string, GraphNode][];
    connections: Connection[];
}

interface GraphStore {
    // State (all nodes/connections at all levels, flat)
    nodes: Map<string, GraphNode>;
    connections: Map<string, Connection>;
    rootNodeIds: string[];  // IDs of nodes where parentId === null
    selectedNodeIds: Set<string>;
    selectedConnectionIds: Set<string>;

    // Connection indices for O(1) lookup by node
    connectionsByNode: Map<string, Set<string>>;  // nodeId -> connectionIds

    // Version counter for efficient change detection (autosave)
    version: number;

    // Clipboard
    clipboard: ClipboardData | null;

    // Node Actions
    addNode: (type: NodeType, position: Position, parentId?: string | null, initialData?: Record<string, unknown>) => string;
    removeNode: (nodeId: string) => void;
    updateNodePosition: (nodeId: string, position: Position) => void;
    updateNodeData: <T extends object>(nodeId: string, data: Partial<T>) => void;
    updateNodePorts: (nodeId: string, ports: import('../engine/types').PortDefinition[]) => void;
    updateNodeType: (nodeId: string, type: NodeType) => void;
    /**
     * Stamp a node's OPEN identity (M5) — the dynamic plugin id carried alongside
     * the closed `type`. Pass undefined to clear it. `type` is left unchanged so
     * execution/serialization stay on the existing path.
     */
    setNodePluginId: (nodeId: string, pluginId: string | undefined) => void;

    // Instrument Row Actions
    updateInstrumentRow: (nodeId: string, rowId: string, updates: Partial<InstrumentRow>) => void;
    updateKeyGain: (nodeId: string, rowId: string, keyIndex: number, gain: number) => void;

    // Sampler Row Actions
    updateSamplerRow: (nodeId: string, rowId: string, updates: Partial<SamplerRow>) => void;

    // Connection Actions
    addConnection: (
        sourceNodeId: string,
        sourcePortId: string,
        targetNodeId: string,
        targetPortId: string
    ) => string | null;
    removeConnection: (connectionId: string) => void;
    getConnectionsForNode: (nodeId: string) => Connection[];
    getConnectionsForPort: (nodeId: string, portId: string) => Connection[];

    // Selection Actions
    selectNode: (nodeId: string, addToSelection?: boolean) => void;
    selectNodes: (nodeIds: string[]) => void;
    deselectNode: (nodeId: string) => void;
    clearSelection: () => void;
    selectConnection: (connectionId: string) => void;
    selectNodesInRect: (rect: { x: number; y: number; width: number; height: number }) => void;

    // Bulk Actions
    deleteSelected: () => void;
    clearGraph: () => void;
    loadGraph: (nodes: GraphNode[], connections: Connection[]) => void;

    // Clipboard Actions
    copySelected: () => void;
    pasteClipboard: (position?: Position) => void;

    // History Actions
    undo: () => void;
    redo: () => void;
    /** Begin a user gesture: brackets the following param mutations into ONE undo
     *  entry (pre-gesture state is snapshotted on the first mutation). Nestable;
     *  pair every call with {@link endGesture}. Mutations outside a gesture are
     *  not recorded, so system/per-frame writes never spam history. */
    beginGesture: () => void;
    /** End a gesture started with {@link beginGesture}. */
    endGesture: () => void;

    // Getters
    getNode: (nodeId: string) => GraphNode | undefined;
    getNodesByType: (type: NodeType) => GraphNode[];
    getNodesBounds: () => NodeBounds | null;

    // Subscription helpers for AudioGraphManager
    getNodes: () => Map<string, GraphNode>;
    getConnections: () => Map<string, Connection>;

    // Hierarchy traversal helpers (flat normalized structure)
    getNodeChildren: (nodeId: string) => GraphNode[];
    getNodeParent: (nodeId: string) => GraphNode | null;
    getNodeDepth: (nodeId: string) => number;
    getRootNodes: () => GraphNode[];

    // Internal helper
    _rebuildConnectionIndex: (connections: Map<string, Connection>) => Map<string, Set<string>>;
    getNodesAtLevel: (parentId: string | null) => GraphNode[];  // null = root level
    getConnectionsAtLevel: (parentId: string | null) => Connection[];  // Connections between nodes at this level
}

// ============================================================================
// Store Implementation
// ============================================================================

/**
 * Rebuild connection index from connections Map
 * Called whenever connections change for O(1) lookup by node
 */
function rebuildConnectionIndex(connections: Map<string, Connection>): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();
    for (const [connId, conn] of connections) {
        // Add to source node's set
        const sourceSet = index.get(conn.sourceNodeId) ?? new Set();
        sourceSet.add(connId);
        index.set(conn.sourceNodeId, sourceSet);

        // Add to target node's set
        const targetSet = index.get(conn.targetNodeId) ?? new Set();
        targetSet.add(connId);
        index.set(conn.targetNodeId, targetSet);
    }
    return index;
}

// ---------------------------------------------------------------------------
// Gesture coalescing for undo (REV-1). A user gesture — a scrub/drag, or a single
// discrete edit — brackets a run of param mutations into ONE undo entry. The
// pre-gesture snapshot is DEFERRED to the first actual mutation inside the
// gesture, so an empty gesture creates no history. Mutations OUTSIDE a gesture
// (system events like MIDI device propagation, per-frame writes) take NO snapshot
// — so this is ZERO regression until a UI call site opts in via beginGesture()/
// endGesture(). Module-scoped: transient (never persisted) and correct for the
// process-wide singleton store.
// ---------------------------------------------------------------------------
export const useGraphStore = create<GraphStore>()(
    persist(
        (rawSet, get) => {
            const set: typeof rawSet = (partial, replace) => {
                const current = get();
                const before: GraphStateSlice = { nodes: current.nodes, connections: current.connections, rootNodeIds: current.rootNodeIds };
                rawSet(partial as never, replace as never);
                if (isApplyingHistory()) return;
                const changed = get();
                const after: GraphStateSlice = { nodes: changed.nodes, connections: changed.connections, rootNodeIds: changed.rootNodeIds };
                const { verbs, inverse } = diffGraph(before, after);
                if (verbs.length) useHistoryStore.getState().record(
                    verbs.map((verb): EditVerb => ({ domain: 'graph', verb })),
                    inverse.map((verb): EditVerb => ({ domain: 'graph', verb })),
                    'Edit graph',
                    'graph',
                );
            };
            return ({
            // Initial State (flat normalized structure)
            nodes: new Map(),
            connections: new Map(),
            connectionsByNode: new Map(),  // Connection index for O(1) lookup
            rootNodeIds: [],  // IDs of top-level nodes
            selectedNodeIds: new Set(),
            selectedConnectionIds: new Set(),
            version: 0,  // Incremented on every graph mutation for efficient change detection
            clipboard: null,

            // Helper: Rebuild connection index from connections Map
            _rebuildConnectionIndex: rebuildConnectionIndex,

            beginGesture: () => {
                useHistoryStore.getState().begin('Edit graph', 'graph');
            },

            endGesture: () => {
                useHistoryStore.getState().commit();
            },

            // Undo
            undo: () => {
                useHistoryStore.getState().undo();
            },

            // Redo
            redo: () => {
                useHistoryStore.getState().redo();
            },

            // Node Actions
            addNode: (type, position, parentId = null, initialData = {}) => {
                const definition = getNodeDefinition(type);
                const id = generateId();

                // Create node with flat structure (parentId and childIds)
                const node: GraphNode = {
                    id,
                    type,
                    category: definition.category,
                    position,
                    data: { ...definition.defaultData, ...initialData },
                    ports: [...definition.defaultPorts],
                    parentId,
                    childIds: [],
                    specialNodes: []
                };

                // Auto-assign next available key for keyboard nodes
                if (type === 'keyboard') {
                    const state = get();
                    const existingKeyboards = Array.from(state.nodes.values())
                        .filter(n => n.type === 'keyboard');
                    const usedKeys = new Set(
                        existingKeyboards.map(kb => (kb.data as { assignedKey?: number }).assignedKey ?? 2)
                    );

                    // Find next available key (2-9)
                    let nextKey = 2;
                    while (usedKeys.has(nextKey) && nextKey <= 9) {
                        nextKey++;
                    }

                    // Assign the key (wrap to 2 if all 2-9 are used)
                    node.data = {
                        ...node.data,
                        assignedKey: nextKey <= 9 ? nextKey : 2
                    };
                }

                // Get default internal structure (returns flat arrays now)
                const internalStructure = createDefaultInternalStructure(node);

                // Add all internal nodes to flat structure with correct parentId
                const allNodesToAdd: GraphNode[] = [node];
                const allConnectionsToAdd: Connection[] = [];

                internalStructure.internalNodes.forEach((internalNode: GraphNode) => {
                    // Set parentId to point to this node
                    internalNode.parentId = id;
                    internalNode.childIds = [];
                    allNodesToAdd.push(internalNode);
                    node.childIds.push(internalNode.id);
                });

                // Store special node IDs
                node.specialNodes = internalStructure.specialNodes;

                // Copy port visibility configuration
                node.showEmptyInputPorts = internalStructure.showEmptyInputPorts;
                node.showEmptyOutputPorts = internalStructure.showEmptyOutputPorts;

                // Add internal connections to flat structure
                internalStructure.internalConnections.forEach((conn: Connection) => {
                    allConnectionsToAdd.push(conn);
                });

                // Sync ports from internal canvas-input/output nodes
                // Use onlyConnected: true so only ports with connections show on parent
                const syncedPorts = syncPortsWithInternalNodes(
                    node,
                    Array.from(internalStructure.internalNodes.values()),
                    internalStructure.internalConnections,
                    true  // onlyConnected: only show ports that have connections
                );
                if (syncedPorts.length > 0) {
                    node.ports = syncedPorts;
                }

                set((state) => {
                    const newNodes = new Map(state.nodes);
                    const newConnections = new Map(state.connections);
                    const newRootNodeIds = [...state.rootNodeIds];

                    // Add all nodes
                    allNodesToAdd.forEach(n => newNodes.set(n.id, n));

                    // Add all connections
                    allConnectionsToAdd.forEach(c => newConnections.set(c.id, c));

                    // Update parent's childIds if this is a child node
                    if (parentId) {
                        const parent = newNodes.get(parentId);
                        if (parent) {
                            newNodes.set(parentId, {
                                ...parent,
                                childIds: [...parent.childIds, id]
                            });
                        }
                    } else {
                        // Root level node
                        newRootNodeIds.push(id);
                    }

                    // Check for dynamic port addition (for pre-wired internal connections)
                    // This ensures empty ports appear on output-panel and input-panel
                    const { updatedNode } = checkDynamicPortAddition(id, newNodes, newConnections);
                    if (updatedNode) {
                        const existingNode = newNodes.get(updatedNode.id);
                        if (existingNode) {
                            newNodes.set(updatedNode.id, {
                                ...existingNode,
                                ports: updatedNode.ports,
                                data: updatedNode.data
                            });

                            // Re-sync parent's ports after adding dynamic port
                            const nodeToSync = newNodes.get(id);
                            if (nodeToSync) {
                                const childNodes = nodeToSync.childIds
                                    .map(cid => newNodes.get(cid))
                                    .filter((n): n is GraphNode => n !== undefined);

                                const syncedPorts = syncPortsWithInternalNodes(
                                    nodeToSync,
                                    childNodes,
                                    newConnections,
                                    true  // onlyConnected: only show ports that have connections
                                );
                                if (syncedPorts.length > 0) {
                                    newNodes.set(id, { ...nodeToSync, ports: syncedPorts });
                                }
                            }
                        }
                    }

                    return {
                        nodes: newNodes,
                        connections: newConnections,
                        connectionsByNode: rebuildConnectionIndex(newConnections),
                        rootNodeIds: newRootNodeIds,
                        version: state.version + 1
                    };
                });

                return id;
            },

            removeNode: (nodeId) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const newNodes = new Map(state.nodes);
                    const newConnections = new Map(state.connections);
                    const newSelectedNodes = new Set(state.selectedNodeIds);
                    let newRootNodeIds = [...state.rootNodeIds];

                    // Collect all node IDs to delete (this node + all descendants)
                    const nodesToDelete = new Set<string>();
                    const collectDescendants = (id: string) => {
                        nodesToDelete.add(id);
                        const n = newNodes.get(id);
                        if (n?.childIds) {
                            n.childIds.forEach(childId => collectDescendants(childId));
                        }
                    };
                    collectDescendants(nodeId);

                    // Remove all connections involving any deleted node
                    state.connections.forEach((conn, connId) => {
                        if (nodesToDelete.has(conn.sourceNodeId) || nodesToDelete.has(conn.targetNodeId)) {
                            newConnections.delete(connId);
                        }
                    });

                    // Clean up MIDI device signatures for deleted MIDI nodes
                    // This allows the toast to show again when the device reconnects
                    nodesToDelete.forEach(id => {
                        const n = newNodes.get(id);
                        if (n && (n.type === 'midi' || n.type === 'minilab-3')) {
                            const deviceId = (n.data as { deviceId?: string })?.deviceId;
                            if (deviceId) {
                                // Release the device signature so toast can show again
                                useMIDIStore.getState().releaseDeviceSignature(deviceId);
                            }
                        }
                    });

                    // Remove all nodes
                    nodesToDelete.forEach(id => {
                        newNodes.delete(id);
                        newSelectedNodes.delete(id);
                    });

                    // Update parent's childIds if this node has a parent
                    if (node.parentId) {
                        const parent = newNodes.get(node.parentId);
                        if (parent) {
                            newNodes.set(node.parentId, {
                                ...parent,
                                childIds: parent.childIds.filter(id => id !== nodeId)
                            });
                        }
                    } else {
                        // Remove from rootNodeIds
                        newRootNodeIds = newRootNodeIds.filter(id => id !== nodeId);
                    }

                    return {
                        nodes: newNodes,
                        connections: newConnections,
                        connectionsByNode: rebuildConnectionIndex(newConnections),
                        selectedNodeIds: newSelectedNodes,
                        rootNodeIds: newRootNodeIds,
                        version: state.version + 1
                    };
                });
            },

            updateNodePosition: (nodeId, position) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const newNodes = new Map(state.nodes);
                    newNodes.set(nodeId, { ...node, position });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            updateNodeData: (nodeId, data) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const newNodes = new Map(state.nodes);
                    const updatedNode = {
                        ...node,
                        data: { ...node.data, ...data }
                    };
                    newNodes.set(nodeId, updatedNode);

                    // If this is a canvas-input/output or panel node, sync parent's ports
                    const syncableTypes = ['canvas-input', 'canvas-output', 'output-panel', 'input-panel'];
                    if (syncableTypes.includes(node.type) && node.parentId) {
                        const parent = newNodes.get(node.parentId);
                        if (parent) {
                            // Get all child nodes of the parent (using updated node)
                            const childNodes = parent.childIds
                                .map(id => newNodes.get(id))
                                .filter((n): n is GraphNode => n !== undefined);

                            // Sync ports from internal nodes
                            const syncedPorts = syncPortsWithInternalNodes(
                                parent,
                                childNodes,
                                state.connections,
                                true // onlyConnected
                            );

                            newNodes.set(parent.id, {
                                ...parent,
                                ports: syncedPorts
                            });
                        }
                    }

                    // If this is a MIDI node and deviceId/presetId changed, propagate to internal visual nodes
                    const midiNodeTypes = ['midi', 'minilab-3'];
                    const midiVisualTypes = ['midi-visual', 'minilab3-visual'];
                    if (midiNodeTypes.includes(node.type) && (('deviceId' in data) || ('presetId' in data))) {
                        node.childIds.forEach(childId => {
                            const child = newNodes.get(childId);
                            if (child && midiVisualTypes.includes(child.type)) {
                                newNodes.set(childId, {
                                    ...child,
                                    data: {
                                        ...child.data,
                                        ...('deviceId' in data ? { deviceId: (data as { deviceId: unknown }).deviceId } : {}),
                                        ...('presetId' in data ? { presetId: (data as { presetId: unknown }).presetId } : {})
                                    }
                                });
                            }
                        });
                    }

                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            updateNodePorts: (nodeId, ports) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const newNodes = new Map(state.nodes);
                    newNodes.set(nodeId, { ...node, ports });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            updateNodeType: (nodeId, type) => {
                const definition = getNodeDefinition(type);
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const newNodes = new Map(state.nodes);
                    newNodes.set(nodeId, {
                        ...node,
                        type,
                        category: definition.category
                    });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            setNodePluginId: (nodeId, pluginId) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const newNodes = new Map(state.nodes);
                    // type/category are intentionally unchanged — the open identity
                    // is additive (M5); execution stays on the closed-type path.
                    newNodes.set(nodeId, { ...node, pluginId });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            // Instrument Row Actions
            updateInstrumentRow: (nodeId, rowId, updates) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const instrumentData = node.data as InstrumentNodeData;
                    const rows = instrumentData.rows || [];
                    const rowIndex = rows.findIndex(r => r.rowId === rowId);
                    if (rowIndex === -1) return state;

                    const updatedRow = { ...rows[rowIndex], ...updates };

                    // If spread changed, recalculate keyGains
                    if (updates.spread !== undefined && updates.spread !== rows[rowIndex].spread) {
                        const newSpread = updates.spread;
                        updatedRow.keyGains = Array.from(
                            { length: updatedRow.portCount },
                            (_, i) => i * newSpread
                        );
                    }

                    const newRows = [...rows];
                    newRows[rowIndex] = updatedRow;

                    const newNodes = new Map(state.nodes);
                    newNodes.set(nodeId, {
                        ...node,
                        data: { ...node.data, rows: newRows }
                    });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            updateKeyGain: (nodeId, rowId, keyIndex, gain) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node) return state;

                    const instrumentData = node.data as InstrumentNodeData;
                    const rows = instrumentData.rows || [];
                    const rowIndex = rows.findIndex(r => r.rowId === rowId);
                    if (rowIndex === -1) return state;

                    const row = rows[rowIndex];
                    if (keyIndex < 0 || keyIndex >= row.keyGains.length) return state;

                    const newKeyGains = [...row.keyGains];
                    newKeyGains[keyIndex] = gain;

                    const newRows = [...rows];
                    newRows[rowIndex] = { ...row, keyGains: newKeyGains };

                    const newNodes = new Map(state.nodes);
                    newNodes.set(nodeId, {
                        ...node,
                        data: { ...node.data, rows: newRows }
                    });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            // Sampler Row Actions
            updateSamplerRow: (nodeId, rowId, updates) => {
                set((state) => {
                    const node = state.nodes.get(nodeId);
                    if (!node || node.type !== 'sampler') return state;

                    const samplerData = node.data as SamplerNodeData;
                    const rows = samplerData.rows || [];
                    const rowIndex = rows.findIndex(r => r.rowId === rowId);
                    if (rowIndex === -1) return state;

                    const updatedRow = { ...rows[rowIndex], ...updates };

                    // If spread changed, keyGains stay at 1 for sampler (gain is per-row, not per-key based on spread)
                    // Unlike instrument where spread affects keyGains, sampler spread controls pitch interval

                    const newRows = [...rows];
                    newRows[rowIndex] = updatedRow;

                    const newNodes = new Map(state.nodes);
                    newNodes.set(nodeId, {
                        ...node,
                        data: { ...node.data, rows: newRows }
                    });
                    return { nodes: newNodes, version: state.version + 1 };
                });
            },

            // Connection Actions
            addConnection: (sourceNodeId, sourcePortId, targetNodeId, targetPortId) => {
                const state = get();
                const sourceNode = state.nodes.get(sourceNodeId);
                const targetNode = state.nodes.get(targetNodeId);

                if (!sourceNode || !targetNode) return null;

                const sourcePort = sourceNode.ports.find(p => p.id === sourcePortId);
                let targetPort = targetNode.ports.find(p => p.id === targetPortId);

                // If target port not found (e.g., placeholder was replaced by previous connection),
                // try to find any available control input port on instruments
                if (!targetPort && isInstrumentNode(targetNode)) {
                    const existingConnections = Array.from(state.connections.values());
                    const connectedTargetPorts = new Set(
                        existingConnections
                            .filter(c => c.targetNodeId === targetNodeId)
                            .map(c => c.targetPortId)
                    );
                    targetPort = targetNode.ports.find(p =>
                        p.direction === 'input' &&
                        p.type === 'control' &&
                        !connectedTargetPorts.has(p.id)
                    );
                }

                if (!sourcePort || !targetPort) return null;
                if (!canConnect(sourcePort, targetPort)) return null;

                // Check if connection already exists
                const existingConnection = Array.from(state.connections.values()).find(
                    conn =>
                        conn.sourceNodeId === sourceNodeId &&
                        conn.sourcePortId === sourcePortId &&
                        conn.targetNodeId === targetNodeId &&
                        conn.targetPortId === targetPortId
                );
                if (existingConnection) return existingConnection.id;

                // For audio inputs, remove existing connection (only one allowed)
                // Note: We don't call removeConnection() here because it also pushes history,
                // which would create duplicate undo entries. Instead, we'll remove it in the set() below.
                let existingInputToRemove: string | null = null;
                if (targetPort.type === 'audio' && targetPort.direction === 'input') {
                    const existingInput = Array.from(state.connections.values()).find(
                        conn =>
                            conn.targetNodeId === targetNodeId &&
                            conn.targetPortId === targetPortId
                    );
                    if (existingInput) {
                        existingInputToRemove = existingInput.id;
                    }
                }

                const id = generateId();
                const isBundled = sourcePort.isBundled || targetPort.isBundled || false;
                const connection: Connection = {
                    id,
                    sourceNodeId,
                    sourcePortId,
                    targetNodeId,
                    targetPortId,
                    type: sourcePort.type,
                    isBundled
                };

                set((state) => {
                    const newConnections = new Map(state.connections);

                    // Remove existing connection if replacing (for audio inputs)
                    if (existingInputToRemove) {
                        newConnections.delete(existingInputToRemove);
                    }

                    newConnections.set(id, connection);
                    const newNodes = new Map(state.nodes);

                    // ================================================================
                    // Generic Bundle Expansion
                    // When a bundle connects to ANY node with an input-panel,
                    // expand the input-panel to match the bundle size
                    // ================================================================
                    const bundleInfo = detectBundleInfo(
                        sourceNodeId,
                        sourcePortId,
                        newNodes,
                        newConnections
                    );

                    if (bundleInfo) {
                        // Try to expand target for bundle with full channel info
                        const expansion = expandTargetForBundleWithInfo(
                            targetNodeId,
                            bundleInfo,
                            newNodes
                        );
                        const bundleSize = bundleInfo.channels.length;

                        if (expansion) {
                            // Update input-panel with new ports
                            const inputPanel = newNodes.get(expansion.panelId);
                            if (inputPanel) {
                                // Keep existing ports (except placeholders) and add new bundle ports
                                const existingPorts = inputPanel.ports.filter(p =>
                                    p.direction === 'output' && !p.id.startsWith('port-placeholder')
                                );
                                const existingLabels = (inputPanel.data.portLabels as Record<string, string>) || {};
                                const existingHideLabels = (inputPanel.data.portHideExternalLabel as Record<string, boolean>) || {};

                                // Add a new placeholder port at the end
                                const placeholderPortId = `port-placeholder-${Date.now()}`;
                                const allPorts = [
                                    ...existingPorts,
                                    ...expansion.newPorts,
                                    {
                                        id: placeholderPortId,
                                        name: '',
                                        type: 'control' as const,
                                        direction: 'output' as const,
                                        position: { x: 1, y: 0.95 }
                                    }
                                ];
                                const allLabels = {
                                    ...existingLabels,
                                    ...expansion.newPortLabels,
                                    [placeholderPortId]: ''
                                };
                                const allHideLabels = {
                                    ...existingHideLabels,
                                    ...expansion.newPortHideExternalLabel,
                                    [placeholderPortId]: true
                                };

                                newNodes.set(inputPanel.id, {
                                    ...inputPanel,
                                    ports: allPorts,
                                    data: {
                                        ...inputPanel.data,
                                        portLabels: allLabels,
                                        portHideExternalLabel: allHideLabels
                                    }
                                });

                                // Build composite target port ID from panel and first new port
                                const firstNewPortId = expansion.newPorts[0]?.id || '';
                                const bundleTargetPortId = `${expansion.panelId}:${firstNewPortId}`;

                                // Update the connection to use the new bundle port
                                const updatedConnection = { ...connection, targetPortId: bundleTargetPortId };
                                newConnections.set(id, updatedConnection);

                                // If target is an instrument or sampler, create appropriate row
                                const targetNodeForExpansion = newNodes.get(targetNodeId);
                                if (targetNodeForExpansion && isInstrumentNode(targetNodeForExpansion)) {
                                    const rowId = `row-${Date.now()}`;

                                    // Handle sampler nodes differently - use SamplerRow
                                    if (targetNodeForExpansion.type === 'sampler') {
                                        const samplerData = targetNodeForExpansion.data as SamplerNodeData;
                                        const existingRows = samplerData.rows || [];

                                        // Check if a row from this source already exists - override it
                                        const existingRowIndex = existingRows.findIndex(r => r.sourceNodeId === sourceNodeId);
                                        const existingRow = existingRowIndex >= 0 ? existingRows[existingRowIndex] : null;
                                        const actualRowId = existingRow ? existingRow.rowId : rowId;

                                        // Use pre-configured defaults from node data, but preserve existing row's gain/spread if overriding
                                        const defaultGain = existingRow?.gain ?? samplerData.gain ?? 1.0;
                                        const defaultSpread = existingRow?.spread ?? samplerData.spread ?? 1.0;

                                        const newSamplerRow: SamplerRow = {
                                            rowId: actualRowId,
                                            sourceNodeId,
                                            sourcePortId,
                                            targetPortId: bundleTargetPortId,
                                            label: bundleInfo.bundleLabel,
                                            portCount: bundleSize,
                                            gain: defaultGain,
                                            spread: defaultSpread,
                                        };

                                        // If overriding, clean up old internal connections and ports
                                        if (existingRow) {
                                            // Find sampler-visual to clean up old ports
                                            const samplerVisual = targetNodeForExpansion.childIds
                                                .map(cid => newNodes.get(cid))
                                                .find(n => n?.type === 'sampler-visual');

                                            if (samplerVisual) {
                                                // Remove old key ports for the existing row
                                                const oldPortPrefix = `${existingRow.rowId}-key-`;
                                                const cleanedPorts = samplerVisual.ports.filter(p => !p.id.startsWith(oldPortPrefix));
                                                newNodes.set(samplerVisual.id, {
                                                    ...samplerVisual,
                                                    ports: cleanedPorts
                                                });

                                                // Remove old internal connections for this row
                                                for (const [connId, conn] of newConnections) {
                                                    if (conn.targetNodeId === samplerVisual.id && conn.targetPortId.startsWith(oldPortPrefix)) {
                                                        newConnections.delete(connId);
                                                    }
                                                }
                                            }
                                        }

                                        // Build updated rows array (replace existing or add new)
                                        const updatedRows = existingRow
                                            ? existingRows.map((r, i) => i === existingRowIndex ? newSamplerRow : r)
                                            : [...existingRows, newSamplerRow];

                                        newNodes.set(targetNodeId, {
                                            ...targetNodeForExpansion,
                                            data: {
                                                ...targetNodeForExpansion.data,
                                                rows: updatedRows
                                            }
                                        });

                                        // === INTERNAL WIRING FOR SAMPLER ===
                                        // Find sampler-visual node and wire up the key ports
                                        const samplerVisual = targetNodeForExpansion.childIds
                                            .map(cid => newNodes.get(cid))
                                            .find(n => n?.type === 'sampler-visual');

                                        if (samplerVisual) {
                                            // Create key input ports on sampler-visual
                                            const newKeyPorts: PortDefinition[] = [];
                                            for (let i = 0; i < bundleSize; i++) {
                                                const keyPortId = `${rowId}-key-${i}`;
                                                const yPos = 0.1 + (i / bundleSize) * 0.8;
                                                newKeyPorts.push({
                                                    id: keyPortId,
                                                    name: `Key ${i + 1}`,
                                                    type: 'control',
                                                    direction: 'input',
                                                    position: { x: 0, y: yPos }
                                                });
                                            }

                                            // Update sampler-visual with new ports
                                            const existingVisualPorts = samplerVisual.ports;
                                            newNodes.set(samplerVisual.id, {
                                                ...samplerVisual,
                                                ports: [...existingVisualPorts, ...newKeyPorts]
                                            });

                                            // Create internal connections from input-panel bundle port to each key port
                                            const bundlePortId = expansion.newPorts[0]?.id;
                                            if (bundlePortId) {
                                                for (let i = 0; i < bundleSize; i++) {
                                                    const keyPortId = `${rowId}-key-${i}`;
                                                    const connId = `internal-conn-${generateId()}`;
                                                    newConnections.set(connId, {
                                                        id: connId,
                                                        sourceNodeId: expansion.panelId,
                                                        sourcePortId: bundlePortId,
                                                        targetNodeId: samplerVisual.id,
                                                        targetPortId: keyPortId,
                                                        type: 'control'
                                                    });
                                                }
                                            }
                                        }
                                    } else {
                                        // Handle other instrument nodes - use InstrumentRow
                                        const defaultSpread = 0.5;

                                        const newRow: InstrumentRow = {
                                            rowId,
                                            sourceNodeId,
                                            sourcePortId,
                                            targetPortId: bundleTargetPortId,
                                            label: bundleInfo.bundleLabel,
                                            spread: defaultSpread,
                                            baseNote: 0,
                                            baseOctave: 4,
                                            baseOffset: 0,
                                            portCount: bundleSize,
                                            keyGains: Array.from({ length: bundleSize }, () => 1)
                                        };

                                        const instrumentData = targetNodeForExpansion.data as InstrumentNodeData;
                                        const existingRows = instrumentData.rows || [];
                                        newNodes.set(targetNodeId, {
                                            ...targetNodeForExpansion,
                                            data: {
                                                ...targetNodeForExpansion.data,
                                                rows: [...existingRows, newRow]
                                            }
                                        });

                                        // === INTERNAL WIRING ===
                                        // Find instrument-visual node and wire up the key ports
                                        const instrumentVisual = targetNodeForExpansion.childIds
                                            .map(cid => newNodes.get(cid))
                                            .find(n => n?.type === 'instrument-visual');

                                        if (instrumentVisual) {
                                            // Create key input ports on instrument-visual
                                            const newKeyPorts: PortDefinition[] = [];
                                            for (let i = 0; i < bundleSize; i++) {
                                                const keyPortId = `${rowId}-key-${i}`;
                                                const yPos = 0.1 + (i / bundleSize) * 0.8;
                                                newKeyPorts.push({
                                                    id: keyPortId,
                                                    name: `Key ${i + 1}`,
                                                    type: 'control',
                                                    direction: 'input',
                                                    position: { x: 0, y: yPos }
                                                });
                                            }

                                            // Update instrument-visual with new ports
                                            const existingVisualPorts = instrumentVisual.ports;
                                            newNodes.set(instrumentVisual.id, {
                                                ...instrumentVisual,
                                                ports: [...existingVisualPorts, ...newKeyPorts]
                                            });

                                            // Create internal connections from input-panel bundle port to each key port
                                            const bundlePortId = expansion.newPorts[0]?.id;
                                            if (bundlePortId) {
                                                for (let i = 0; i < bundleSize; i++) {
                                                    const keyPortId = `${rowId}-key-${i}`;
                                                    const connId = `internal-conn-${generateId()}`;
                                                    newConnections.set(connId, {
                                                        id: connId,
                                                        sourceNodeId: expansion.panelId,
                                                        sourcePortId: bundlePortId,
                                                        targetNodeId: instrumentVisual.id,
                                                        targetPortId: keyPortId,
                                                        type: 'control'
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }

                                // Re-sync parent's ports
                                const updatedTarget = newNodes.get(targetNodeId);
                                if (updatedTarget) {
                                    const childNodes = updatedTarget.childIds
                                        .map(cid => newNodes.get(cid))
                                        .filter((n): n is GraphNode => n !== undefined);

                                    const syncedPorts = syncPortsWithInternalNodes(
                                        updatedTarget,
                                        childNodes,
                                        newConnections,
                                        true
                                    );
                                    newNodes.set(targetNodeId, { ...updatedTarget, ports: syncedPorts });
                                }
                            }
                        }
                    }

                    // Check if we need to add a dynamic port to the target's parent
                    const targetNodeInState = newNodes.get(targetNodeId);
                    if (targetNodeInState?.parentId) {
                        const { newNode, updatedNode } = checkDynamicPortAddition(
                            targetNodeInState.parentId,
                            newNodes,
                            newConnections
                        );

                        // Handle adding a new port to an existing output-panel
                        if (updatedNode) {
                            // Update the output-panel with new port
                            const existingNode = newNodes.get(updatedNode.id);
                            if (existingNode) {
                                newNodes.set(updatedNode.id, {
                                    ...existingNode,
                                    ports: updatedNode.ports,
                                    data: updatedNode.data
                                });

                                // Re-sync parent's ports with onlyConnected: true
                                const parent = newNodes.get(targetNodeInState.parentId);
                                if (parent) {
                                    const childNodes = parent.childIds
                                        .map(cid => newNodes.get(cid))
                                        .filter((n): n is GraphNode => n !== undefined);

                                    const syncedPorts = syncPortsWithInternalNodes(
                                        parent,
                                        childNodes,
                                        newConnections,
                                        true  // onlyConnected: only show ports that have connections
                                    );
                                    newNodes.set(parent.id, { ...parent, ports: syncedPorts });
                                }
                            }

                            return { connections: newConnections, nodes: newNodes, connectionsByNode: rebuildConnectionIndex(newConnections), version: state.version + 1 };
                        }

                        // Handle adding a new canvas-output node (legacy)
                        if (newNode) {
                            // Add the new node
                            newNodes.set(newNode.id, newNode);

                            // Update parent's childIds and specialNodes
                            const parent = newNodes.get(targetNodeInState.parentId);
                            if (parent) {
                                newNodes.set(parent.id, {
                                    ...parent,
                                    childIds: [...parent.childIds, newNode.id],
                                    specialNodes: [...(parent.specialNodes || []), newNode.id]
                                });

                                // Re-sync parent's ports with onlyConnected: true
                                const childNodes = [...parent.childIds, newNode.id]
                                    .map(cid => newNodes.get(cid))
                                    .filter((n): n is GraphNode => n !== undefined);

                                const syncedPorts = syncPortsWithInternalNodes(
                                    { ...parent, specialNodes: [...(parent.specialNodes || []), newNode.id] },
                                    childNodes,
                                    newConnections,
                                    true  // onlyConnected: only show ports that have connections
                                );

                                const updatedParent = newNodes.get(parent.id);
                                if (updatedParent) {
                                    newNodes.set(parent.id, {
                                        ...updatedParent,
                                        ports: syncedPorts
                                    });
                                }
                            }

                            return { connections: newConnections, nodes: newNodes, connectionsByNode: rebuildConnectionIndex(newConnections), version: state.version + 1 };
                        }
                    }

                    // Handle universal port type resolution for math nodes
                    if (sourcePort.type === 'universal' || targetPort.type === 'universal') {
                        // Determine the resolved type from the non-universal port
                        let resolvedType: 'audio' | 'control' = 'control';
                        if (sourcePort.type !== 'universal') {
                            resolvedType = sourcePort.type as 'audio' | 'control';
                        } else if (targetPort.type !== 'universal') {
                            resolvedType = targetPort.type as 'audio' | 'control';
                        }

                        // Update source node if it has universal ports (add/subtract/multiplier)
                        if ((sourceNode.type === 'add' || sourceNode.type === 'subtract' || sourceNode.type === 'multiplier') &&
                            sourcePort.type === 'universal') {
                            const currentSource = newNodes.get(sourceNodeId) || sourceNode;
                            newNodes.set(sourceNodeId, {
                                ...currentSource,
                                data: { ...currentSource.data, resolvedType }
                            });
                        }

                        // Update target node if it has universal ports (add/subtract/multiplier)
                        if ((targetNode.type === 'add' || targetNode.type === 'subtract' || targetNode.type === 'multiplier') &&
                            targetPort.type === 'universal') {
                            const currentTarget = newNodes.get(targetNodeId) || targetNode;
                            newNodes.set(targetNodeId, {
                                ...currentTarget,
                                data: { ...currentTarget.data, resolvedType }
                            });
                        }
                    }

                    return { connections: newConnections, nodes: newNodes, connectionsByNode: rebuildConnectionIndex(newConnections), version: state.version + 1 };
                });

                return id;
            },

            removeConnection: (connectionId) => {
                set((state) => {
                    const connection = state.connections.get(connectionId);
                    const newConnections = new Map(state.connections);
                    const newSelectedConnections = new Set(state.selectedConnectionIds);
                    newConnections.delete(connectionId);
                    newSelectedConnections.delete(connectionId);

                    // Check if we need to reset universal port type for math nodes
                    if (connection) {
                        const newNodes = new Map(state.nodes);
                        const nodesToCheck = [connection.sourceNodeId, connection.targetNodeId];
                        let nodesUpdated = false;

                        for (const nodeId of nodesToCheck) {
                            const node = newNodes.get(nodeId);
                            if (node && (node.type === 'add' || node.type === 'subtract' || node.type === 'multiplier')) {
                                // Check if node has any remaining connections
                                const remainingConnections = Array.from(newConnections.values()).some(
                                    conn => conn.sourceNodeId === nodeId || conn.targetNodeId === nodeId
                                );

                                if (!remainingConnections && node.data.resolvedType !== null) {
                                    // Reset resolvedType to null
                                    newNodes.set(nodeId, {
                                        ...node,
                                        data: { ...node.data, resolvedType: null }
                                    });
                                    nodesUpdated = true;
                                }
                            }
                        }

                        // Check if we need to remove a sampler row when disconnecting from a sampler
                        const targetNode = newNodes.get(connection.targetNodeId);
                        if (targetNode?.type === 'sampler') {
                            const samplerData = targetNode.data as SamplerNodeData;
                            const existingRows = samplerData.rows || [];
                            const sourceNodeId = connection.sourceNodeId;

                            // Find the row that matches this source
                            const rowToRemove = existingRows.find(r => r.sourceNodeId === sourceNodeId);
                            if (rowToRemove) {
                                // Remove the row from sampler data
                                const filteredRows = existingRows.filter(r => r.rowId !== rowToRemove.rowId);
                                newNodes.set(connection.targetNodeId, {
                                    ...targetNode,
                                    data: {
                                        ...targetNode.data,
                                        rows: filteredRows
                                    }
                                });
                                nodesUpdated = true;

                                // Also clean up the internal key ports and connections in sampler-visual
                                const samplerVisual = targetNode.childIds
                                    .map(cid => newNodes.get(cid))
                                    .find(n => n?.type === 'sampler-visual');

                                if (samplerVisual) {
                                    // Remove old key ports for this row
                                    const oldPortPrefix = `${rowToRemove.rowId}-key-`;
                                    const cleanedPorts = samplerVisual.ports.filter(p => !p.id.startsWith(oldPortPrefix));
                                    newNodes.set(samplerVisual.id, {
                                        ...samplerVisual,
                                        ports: cleanedPorts
                                    });

                                    // Remove old internal connections for this row
                                    for (const [connId, conn] of newConnections) {
                                        if (conn.targetNodeId === samplerVisual.id && conn.targetPortId.startsWith(oldPortPrefix)) {
                                            newConnections.delete(connId);
                                        }
                                    }
                                }
                            }
                        }

                        // Check for dynamic port removal in parent panels
                        const parentsToCheck = new Set<string>();
                        const connTargetNode = newNodes.get(connection.targetNodeId);
                        const connSourceNode = newNodes.get(connection.sourceNodeId);

                        if (connTargetNode?.parentId) {
                            parentsToCheck.add(connTargetNode.parentId);
                        }
                        if (connSourceNode?.parentId) {
                            parentsToCheck.add(connSourceNode.parentId);
                        }

                        for (const parentId of parentsToCheck) {
                            const { updatedNode } = checkDynamicPortRemoval(parentId, newNodes, newConnections);

                            if (updatedNode) {
                                // Update the panel node with removed port
                                const panelNode = newNodes.get(updatedNode.id);
                                if (panelNode) {
                                    newNodes.set(updatedNode.id, {
                                        ...panelNode,
                                        ports: updatedNode.ports,
                                        data: updatedNode.data
                                    });
                                    nodesUpdated = true;
                                }
                            }

                            // Sync parent ports with onlyConnected: true
                            const parent = newNodes.get(parentId);
                            if (parent) {
                                const childNodes = parent.childIds
                                    .map(cid => newNodes.get(cid))
                                    .filter((n): n is GraphNode => n !== undefined);

                                const syncedPorts = syncPortsWithInternalNodes(
                                    parent,
                                    childNodes,
                                    newConnections,
                                    true  // onlyConnected: only show ports that have connections
                                );

                                newNodes.set(parentId, { ...parent, ports: syncedPorts });
                                nodesUpdated = true;
                            }
                        }

                        if (nodesUpdated) {
                            return {
                                connections: newConnections,
                                connectionsByNode: rebuildConnectionIndex(newConnections),
                                selectedConnectionIds: newSelectedConnections,
                                nodes: newNodes,
                                version: state.version + 1
                            };
                        }
                    }

                    return {
                        connections: newConnections,
                        connectionsByNode: rebuildConnectionIndex(newConnections),
                        selectedConnectionIds: newSelectedConnections,
                        version: state.version + 1
                    };
                });
            },

            getConnectionsForNode: (nodeId) => {
                const state = get();
                // Use connection index for O(1) lookup
                const connectionIds = state.connectionsByNode.get(nodeId);
                if (!connectionIds || connectionIds.size === 0) return [];
                return Array.from(connectionIds)
                    .map(id => state.connections.get(id))
                    .filter((conn): conn is Connection => conn !== undefined);
            },

            getConnectionsForPort: (nodeId, portId) => {
                const state = get();
                return Array.from(state.connections.values()).filter(
                    conn =>
                        (conn.sourceNodeId === nodeId && conn.sourcePortId === portId) ||
                        (conn.targetNodeId === nodeId && conn.targetPortId === portId)
                );
            },

            // Selection Actions
            selectNode: (nodeId, addToSelection = false) => {
                set((state) => {
                    const newSelectedNodes = addToSelection
                        ? new Set(state.selectedNodeIds)
                        : new Set<string>();
                    newSelectedNodes.add(nodeId);
                    return {
                        selectedNodeIds: newSelectedNodes,
                        selectedConnectionIds: new Set()
                    };
                });
            },

            selectNodes: (nodeIds) => {
                set({
                    selectedNodeIds: new Set(nodeIds),
                    selectedConnectionIds: new Set()
                });
            },

            deselectNode: (nodeId) => {
                set((state) => {
                    const newSelectedNodes = new Set(state.selectedNodeIds);
                    newSelectedNodes.delete(nodeId);
                    return { selectedNodeIds: newSelectedNodes };
                });
            },

            clearSelection: () => {
                set({
                    selectedNodeIds: new Set(),
                    selectedConnectionIds: new Set()
                });
            },

            selectConnection: (connectionId) => {
                set({
                    selectedNodeIds: new Set(),
                    selectedConnectionIds: new Set([connectionId])
                });
            },

            // Select nodes within a rectangle (for box selection)
            // Only selects nodes that are FULLY contained within the selection box
            selectNodesInRect: (rect) => {
                const navStore = useCanvasNavigationStore.getState();
                const selectedIds: string[] = [];

                // Get nodes at the current viewing level using flat structure
                const currentViewNodeId = navStore.currentViewNodeId;
                const nodesToCheck = get().getNodesAtLevel(currentViewNodeId);

                nodesToCheck.forEach((node) => {
                    const { width: nodeWidth, height: nodeHeight } = getNodeDimensions(node);

                    // Calculate node bounds
                    const nodeRight = node.position.x + nodeWidth;
                    const nodeBottom = node.position.y + nodeHeight;
                    const rectRight = rect.x + rect.width;
                    const rectBottom = rect.y + rect.height;

                    // Normalize rect (handle negative width/height from dragging)
                    const minX = Math.min(rect.x, rectRight);
                    const maxX = Math.max(rect.x, rectRight);
                    const minY = Math.min(rect.y, rectBottom);
                    const maxY = Math.max(rect.y, rectBottom);

                    // Check if node is FULLY contained within selection rect
                    if (node.position.x >= minX &&
                        nodeRight <= maxX &&
                        node.position.y >= minY &&
                        nodeBottom <= maxY) {
                        selectedIds.push(node.id);
                    }
                });

                set({
                    selectedNodeIds: new Set(selectedIds),
                    selectedConnectionIds: new Set()
                });
            },

            // Bulk Actions
            deleteSelected: () => {
                const state = get();

                if (state.selectedNodeIds.size === 0 && state.selectedConnectionIds.size === 0) {
                    return;
                }

                useHistoryStore.getState().begin('Delete selection', 'graph');

                // Capture IDs as arrays to avoid stale closure issues
                // (state changes after each removeNode call, but we want to process all originally selected items)
                const nodesToDelete = Array.from(state.selectedNodeIds);
                const connectionsToDelete = Array.from(state.selectedConnectionIds);

                // Node types that cannot be deleted when inside an internal canvas
                const UNDELETABLE_INTERNAL_TYPES = ['keyboard-visual', 'output-panel', 'input-panel'];

                // With flat structure, we just use removeNode for all nodes
                // It handles all levels uniformly
                nodesToDelete.forEach(nodeId => {
                    // Get fresh state each iteration since removeNode mutates state
                    const currentState = get();
                    const node = currentState.nodes.get(nodeId);
                    if (!node) return;

                    // Check if this node is inside an internal canvas (has a parent)
                    if (node.parentId) {
                        const parent = currentState.nodes.get(node.parentId);

                        // Check if this is a special node (in specialNodes array)
                        if (parent?.specialNodes?.includes(nodeId)) {
                            console.warn(`Cannot delete special node ${nodeId}`);
                            useUIFeedbackStore.getState().flashNode(nodeId);
                            return;
                        }

                        // Check if this is an undeletable internal node type
                        if (UNDELETABLE_INTERNAL_TYPES.includes(node.type)) {
                            console.warn(`Cannot delete ${node.type} node ${nodeId}`);
                            useUIFeedbackStore.getState().flashNode(nodeId);
                            return;
                        }
                    }

                    get().removeNode(nodeId);
                });

                connectionsToDelete.forEach(connectionId => {
                    get().removeConnection(connectionId);
                });

                // Clear selection after deletion
                get().clearSelection();
                useHistoryStore.getState().commit();
            },

            clearGraph: () => {
                set((state) => ({
                    nodes: new Map(),
                    connections: new Map(),
                    connectionsByNode: new Map(),
                    rootNodeIds: [],
                    selectedNodeIds: new Set(),
                    selectedConnectionIds: new Set(),
                    version: state.version + 1
                }));
            },

            loadGraph: (nodes, connections) => {
                const newNodes = new Map<string, GraphNode>();
                const newConnections = new Map<string, Connection>();
                const newRootNodeIds: string[] = [];

                nodes.forEach(node => {
                    newNodes.set(node.id, node);
                    // Collect root nodes
                    if (node.parentId === null || node.parentId === undefined) {
                        newRootNodeIds.push(node.id);
                    }
                });
                connections.forEach(conn => newConnections.set(conn.id, conn));

                set((state) => ({
                    nodes: newNodes,
                    connections: newConnections,
                    connectionsByNode: rebuildConnectionIndex(newConnections),
                    rootNodeIds: newRootNodeIds,
                    selectedNodeIds: new Set(),
                    selectedConnectionIds: new Set(),
                    version: state.version + 1
                }));
                useHistoryStore.getState().clear();
            },

            // Copy selected nodes and their connections to clipboard
            copySelected: () => {
                const state = get();
                if (state.selectedNodeIds.size === 0) return;

                const nodesToCopy: [string, GraphNode][] = [];
                const connectionsToCopy: Connection[] = [];

                // Copy selected nodes
                state.selectedNodeIds.forEach(nodeId => {
                    const node = state.nodes.get(nodeId);
                    if (node) {
                        nodesToCopy.push([nodeId, node]);
                    }
                });

                // Copy connections between selected nodes
                state.connections.forEach(conn => {
                    if (state.selectedNodeIds.has(conn.sourceNodeId) &&
                        state.selectedNodeIds.has(conn.targetNodeId)) {
                        connectionsToCopy.push(conn);
                    }
                });

                set({
                    clipboard: {
                        nodes: nodesToCopy,
                        connections: connectionsToCopy
                    }
                });
            },

            // Paste clipboard contents at specified position or offset from original
            pasteClipboard: (position?: Position) => {
                const state = get();
                if (!state.clipboard || state.clipboard.nodes.length === 0) return;

                useHistoryStore.getState().begin('Paste nodes', 'graph');
                const oldToNewIds = new Map<string, string>();
                const newNodes = new Map(state.nodes);

                // Calculate paste offset
                let offsetX = 50;
                let offsetY = 50;
                if (position && state.clipboard.nodes.length > 0) {
                    const firstNode = state.clipboard.nodes[0][1];
                    offsetX = position.x - firstNode.position.x;
                    offsetY = position.y - firstNode.position.y;
                }

                // Create new nodes with new IDs
                state.clipboard.nodes.forEach(([oldId, node]) => {
                    const newId = generateId();
                    oldToNewIds.set(oldId, newId);

                    const newNode: GraphNode = {
                        ...node,
                        id: newId,
                        position: {
                            x: node.position.x + offsetX,
                            y: node.position.y + offsetY
                        }
                    };

                    newNodes.set(newId, newNode);
                });

                // Create new connections with updated IDs
                const newConnections = new Map(state.connections);
                state.clipboard.connections.forEach(conn => {
                    const newSourceId = oldToNewIds.get(conn.sourceNodeId);
                    const newTargetId = oldToNewIds.get(conn.targetNodeId);

                    if (newSourceId && newTargetId) {
                        const newConnId = generateId();
                        newConnections.set(newConnId, {
                            ...conn,
                            id: newConnId,
                            sourceNodeId: newSourceId,
                            targetNodeId: newTargetId
                        });
                    }
                });

                // Select the newly pasted nodes
                const newSelectedIds = new Set(oldToNewIds.values());

                set((state) => ({
                    nodes: newNodes,
                    connections: newConnections,
                    connectionsByNode: rebuildConnectionIndex(newConnections),
                    selectedNodeIds: newSelectedIds,
                    version: state.version + 1
                }));
                useHistoryStore.getState().commit();
            },

            // Getters
            getNode: (nodeId) => get().nodes.get(nodeId),

            getNodesByType: (type) => {
                return Array.from(get().nodes.values()).filter(node => node.type === type);
            },

            getNodesBounds: () => {
                const { nodes } = get();
                if (nodes.size === 0) return null;

                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;

                nodes.forEach(node => {
                    const dims = getNodeDimensions(node);
                    minX = Math.min(minX, node.position.x);
                    minY = Math.min(minY, node.position.y);
                    maxX = Math.max(maxX, node.position.x + dims.width);
                    maxY = Math.max(maxY, node.position.y + dims.height);
                });

                return {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                    centerX: (minX + maxX) / 2,
                    centerY: (minY + maxY) / 2
                };
            },

            // Subscription helpers for AudioGraphManager
            getNodes: () => get().nodes,
            getConnections: () => get().connections,

            // Hierarchy traversal helpers (flat normalized structure)
            getNodeChildren: (nodeId) => {
                const state = get();
                const node = state.nodes.get(nodeId);
                if (!node?.childIds) return [];
                return node.childIds
                    .map(id => state.nodes.get(id))
                    .filter((n): n is GraphNode => n !== undefined);
            },

            getNodeParent: (nodeId) => {
                const state = get();
                const node = state.nodes.get(nodeId);
                if (!node?.parentId) return null;
                return state.nodes.get(node.parentId) || null;
            },

            getNodeDepth: (nodeId) => {
                const state = get();
                let depth = 0;
                let currentId: string | null = nodeId;

                while (currentId) {
                    const node = state.nodes.get(currentId);
                    if (!node?.parentId) break;
                    currentId = node.parentId;
                    depth++;
                }

                return depth;
            },

            getRootNodes: () => {
                const state = get();
                return state.rootNodeIds
                    .map(id => state.nodes.get(id))
                    .filter((n): n is GraphNode => n !== undefined);
            },

            getNodesAtLevel: (parentId) => {
                const state = get();
                if (parentId === null) {
                    // Root level: return nodes with no parent
                    return Array.from(state.nodes.values()).filter(n => n.parentId === null);
                } else {
                    // Inside a node: return its children
                    const parent = state.nodes.get(parentId);
                    if (!parent?.childIds) return [];
                    return parent.childIds
                        .map(id => state.nodes.get(id))
                        .filter((n): n is GraphNode => n !== undefined);
                }
            },

            getConnectionsAtLevel: (parentId) => {
                const state = get();
                const nodesAtLevel = get().getNodesAtLevel(parentId);
                const nodeIdsAtLevel = new Set(nodesAtLevel.map(n => n.id));

                // Return connections where both source and target are at this level
                return Array.from(state.connections.values()).filter(conn =>
                    nodeIdsAtLevel.has(conn.sourceNodeId) && nodeIdsAtLevel.has(conn.targetNodeId)
                );
            }
        }); },
        {
            name: 'openjammer-graph-v2',  // New version to avoid loading old incompatible data
            // Custom serialization for Map and Set (flat normalized structure)
            storage: {
                getItem: (name) => {
                    try {
                        const str = localStorage.getItem(name);
                        if (!str) return null;

                        const parsed = JSON.parse(str);

                        // Validate data structure exists
                        if (!parsed?.state) {
                            console.warn('Invalid graph store data structure, resetting');
                            return null;
                        }

                        // Deserialize flat node structure
                        const nodesArray = Array.isArray(parsed.state.nodes) ? parsed.state.nodes : [];
                        const nodes = new Map<string, GraphNode>(
                            nodesArray.map(([id, node]: [string, GraphNode]) => {
                                // Ensure new flat structure fields exist
                                if (node.parentId === undefined) node.parentId = null;
                                if (!Array.isArray(node.childIds)) node.childIds = [];
                                if (!Array.isArray(node.specialNodes)) node.specialNodes = [];

                                return [id, migrateNodePorts(node)] as [string, GraphNode];
                            })
                        );

                        // MIGRATION: Rename 'technical' connection types to 'control'
                        // and drop connections attached to ports removed by migrations.
                        const connectionsArray = Array.isArray(parsed.state.connections) ? parsed.state.connections : [];
                        const migratedConnections = connectionsArray
                            .map(([id, conn]: [string, Connection]) => {
                                if ((conn.type as string) === 'technical') {
                                    conn.type = 'control';
                                }
                                return [id, conn] as [string, Connection];
                            })
                            .filter((entry: [string, Connection]) => connectionPortsExist(entry[1], nodes));

                        // Deserialize rootNodeIds (or compute from nodes if missing)
                        let rootNodeIds = parsed.state.rootNodeIds;
                        if (!Array.isArray(rootNodeIds)) {
                            // Compute from nodes
                            rootNodeIds = Array.from(nodes.values())
                                .filter((n: GraphNode) => n.parentId === null)
                                .map((n: GraphNode) => n.id);
                        }

                        const connections = new Map<string, Connection>(migratedConnections);
                        const selectedConnectionIds = new Set(
                            Array.isArray(parsed.state.selectedConnectionIds)
                                ? parsed.state.selectedConnectionIds.filter((id: string) => connections.has(id))
                                : []
                        );
                        return {
                            state: {
                                ...parsed.state,
                                nodes,
                                connections,
                                connectionsByNode: rebuildConnectionIndex(connections),
                                rootNodeIds,
                                selectedNodeIds: new Set(Array.isArray(parsed.state.selectedNodeIds) ? parsed.state.selectedNodeIds : []),
                                selectedConnectionIds
                            }
                        };
                    } catch (error) {
                        console.error('Failed to load graph store from localStorage:', error);
                        return null; // Graceful reset on any error
                    }
                },
                setItem: (name, value) => {
                    // Serialize flat node structure (no nested Maps)
                    const nodesArray = Array.from(value.state.nodes.entries() as Iterable<[string, GraphNode]>);

                    try {
                        const serialized = {
                            state: {
                                ...value.state,
                                nodes: nodesArray,
                                connections: Array.from(value.state.connections.entries()),
                                rootNodeIds: value.state.rootNodeIds,
                                selectedNodeIds: Array.from(value.state.selectedNodeIds),
                                selectedConnectionIds: Array.from(value.state.selectedConnectionIds)
                            }
                        };
                        localStorage.setItem(name, JSON.stringify(serialized));
                    } catch (error) {
                        console.error('Failed to save graph store to localStorage:', error);
                    }
                },
                removeItem: (name) => {
                    try {
                        localStorage.removeItem(name);
                    } catch (error) {
                        console.error('Failed to remove graph store from localStorage:', error);
                    }
                }
            }
        }
    )
);

registerHistoryDriver((verbs) => {
    const graphVerbs = verbs
        .filter((item): item is Extract<EditVerb, { domain: 'graph' }> => item.domain === 'graph')
        .map((item) => item.verb);
    if (!graphVerbs.length) return;
    const state = useGraphStore.getState();
    const { next } = applyGraphVerbs(
        { nodes: state.nodes, connections: state.connections, rootNodeIds: state.rootNodeIds },
        graphVerbs,
    );
    useGraphStore.setState({
        ...next,
        connectionsByNode: rebuildConnectionIndex(next.connections),
        selectedNodeIds: new Set(),
        selectedConnectionIds: new Set(),
        version: state.version + 1,
    });
});
