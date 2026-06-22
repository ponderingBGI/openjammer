import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGraphStore } from '../graphStore';

// The localStorage key used by the store
const STORAGE_KEY = 'openjammer-graph-v2';

describe('graphStore', () => {
    beforeEach(() => {
        // Clear localStorage FIRST to prevent persist middleware from rehydrating old state
        localStorage.removeItem(STORAGE_KEY);

        // Reset store to initial state with ALL required fields
        useGraphStore.setState({
            nodes: new Map(),
            connections: new Map(),
            connectionsByNode: new Map(),
            rootNodeIds: [],
            selectedNodeIds: new Set(),
            selectedConnectionIds: new Set(),
            clipboard: null,
            history: [],
            historyIndex: -1,
            version: 0,
        });
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Clean up localStorage after each test
        localStorage.removeItem(STORAGE_KEY);
    });

    describe('localStorage persistence', () => {
        it('should handle corrupted JSON in localStorage gracefully', () => {
            // Simulate corrupted data
            localStorage.setItem(STORAGE_KEY, 'not valid json');

            // The store should handle this gracefully and return null (reset state)
            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem(STORAGE_KEY);
                // Should return null on parse error
                expect(result).toBeNull();
            }
        });

        it('should handle missing state property gracefully', () => {
            // Set data without state property
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));

            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem(STORAGE_KEY);
                // Should return null when state is missing
                expect(result).toBeNull();
            }
        });

        it('should handle invalid arrays in state gracefully', () => {
            // Set data with non-array nodes
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: 'not an array',
                    connections: null,
                    selectedNodeIds: {},
                    selectedConnectionIds: undefined,
                }
            }));

            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem(STORAGE_KEY) as { state: { nodes: Map<string, unknown> } } | null;
                // Should handle gracefully - convert to empty Maps/Sets
                if (result) {
                    expect(result.state.nodes).toBeInstanceOf(Map);
                    expect(result.state.nodes.size).toBe(0);
                }
            }
        });

        it('should migrate old looper sample-out ports and connections', () => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: [
                        ['looper-1', {
                            id: 'looper-1',
                            type: 'looper',
                            category: 'routing',
                            position: { x: 0, y: 0 },
                            data: { duration: 10, isRecording: false, loops: [], currentTime: 0 },
                            ports: [
                                { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input', position: { x: 0, y: 0.5 } },
                                { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output', position: { x: 1, y: 0.35 } },
                                { id: 'sample-out', name: 'Sample', type: 'audio', direction: 'output', position: { x: 1, y: 0.65 } }
                            ],
                            parentId: null,
                            childIds: [],
                            specialNodes: []
                        }],
                        ['speaker-1', {
                            id: 'speaker-1',
                            type: 'speaker',
                            category: 'output',
                            position: { x: 300, y: 0 },
                            data: { isMuted: false, volume: 1 },
                            ports: [
                                { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input', position: { x: 0, y: 0.5 } }
                            ],
                            parentId: null,
                            childIds: [],
                            specialNodes: []
                        }]
                    ],
                    connections: [
                        ['stale-conn', {
                            id: 'stale-conn',
                            sourceNodeId: 'looper-1',
                            sourcePortId: 'sample-out',
                            targetNodeId: 'speaker-1',
                            targetPortId: 'audio-in',
                            type: 'audio'
                        }],
                        ['valid-conn', {
                            id: 'valid-conn',
                            sourceNodeId: 'looper-1',
                            sourcePortId: 'audio-out',
                            targetNodeId: 'speaker-1',
                            targetPortId: 'audio-in',
                            type: 'audio'
                        }]
                    ],
                    selectedConnectionIds: ['stale-conn', 'valid-conn']
                }
            }));

            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem(STORAGE_KEY) as {
                    state: {
                        nodes: Map<string, { ports: { id: string }[] }>;
                        connections: Map<string, unknown>;
                        selectedConnectionIds: Set<string>;
                    }
                } | null;

                expect(result?.state.nodes.get('looper-1')?.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out']);
                expect(result?.state.connections.has('stale-conn')).toBe(false);
                expect(result?.state.connections.has('valid-conn')).toBe(true);
                expect(result?.state.selectedConnectionIds.has('stale-conn')).toBe(false);
            }
        });
    });

    describe('node operations', () => {
        it('should add a node', () => {
            const { addNode, nodes } = useGraphStore.getState();

            addNode('piano', { x: 100, y: 100 });

            expect(nodes.size).toBe(0); // State is stale, need to get fresh
            // Piano node has internal children (instrument-visual, input-panel, output-panel)
            // so total nodes is greater than 1. Check root nodes instead.
            const rootNodes = useGraphStore.getState().getRootNodes();
            expect(rootNodes.length).toBe(1);
            expect(rootNodes[0].type).toBe('piano');
        });

        it('should add loopers with a single output port', () => {
            useGraphStore.getState().addNode('looper', { x: 0, y: 0 });

            const looper = Array.from(useGraphStore.getState().nodes.values())
                .find(node => node.type === 'looper');

            expect(looper?.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out']);
            expect(looper?.ports.filter(port => port.direction === 'output')).toHaveLength(1);
        });

        it('should generate unique node IDs', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            addNode('piano', { x: 100, y: 100 });

            const nodes = useGraphStore.getState().nodes;
            const ids = Array.from(nodes.keys());

            expect(ids[0]).not.toBe(ids[1]);
        });

        it('should update node position', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().updateNodePosition(nodeId, { x: 200, y: 300 });

            const node = useGraphStore.getState().nodes.get(nodeId);
            expect(node?.position).toEqual({ x: 200, y: 300 });
        });

        it('should delete selected nodes', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().selectNode(nodeId, false);
            useGraphStore.getState().deleteSelected();

            expect(useGraphStore.getState().nodes.size).toBe(0);
        });
    });

    describe('selection', () => {
        it('should select a node', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().selectNode(nodeId, false);

            expect(useGraphStore.getState().selectedNodeIds.has(nodeId)).toBe(true);
        });

        it('should support multi-select with additive flag', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            addNode('speaker', { x: 100, y: 100 });

            const nodes = useGraphStore.getState().nodes;
            const nodeIds = Array.from(nodes.keys());

            useGraphStore.getState().selectNode(nodeIds[0], false);
            useGraphStore.getState().selectNode(nodeIds[1], true); // Additive

            expect(useGraphStore.getState().selectedNodeIds.size).toBe(2);
        });

        it('should clear selection', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().selectNode(nodeId, false);
            useGraphStore.getState().clearSelection();

            expect(useGraphStore.getState().selectedNodeIds.size).toBe(0);
        });
    });

    describe('connections', () => {
        it('should add a connection between nodes', () => {
            const { addNode } = useGraphStore.getState();

            addNode('keyboard', { x: 0, y: 0 });
            addNode('piano', { x: 200, y: 0 });

            // Get internal connections count before adding external connection
            const initialConnections = useGraphStore.getState().connections.size;

            const nodes = Array.from(useGraphStore.getState().nodes.values());
            const keyboardNode = nodes.find(n => n.type === 'keyboard');
            const pianoNode = nodes.find(n => n.type === 'piano');

            if (keyboardNode && pianoNode) {
                const outputPort = keyboardNode.ports.find(p => p.direction === 'output');
                const inputPort = pianoNode.ports.find(p => p.direction === 'input');

                if (outputPort && inputPort) {
                    useGraphStore.getState().addConnection(
                        keyboardNode.id,
                        outputPort.id,
                        pianoNode.id,
                        inputPort.id
                    );

                    // Should have at least one more connection than before
                    expect(useGraphStore.getState().connections.size).toBeGreaterThan(initialConnections);

                    // Verify connection exists between the root nodes
                    const rootConnections = useGraphStore.getState().getConnectionsAtLevel(null);
                    expect(rootConnections.length).toBeGreaterThanOrEqual(1);
                }
            }
        });

        it('should delete connections when deleting connected nodes', () => {
            const { addNode } = useGraphStore.getState();

            addNode('keyboard', { x: 0, y: 0 });
            addNode('piano', { x: 200, y: 0 });

            const nodes = Array.from(useGraphStore.getState().nodes.values());
            const keyboardNode = nodes.find(n => n.type === 'keyboard');
            const pianoNode = nodes.find(n => n.type === 'piano');

            if (keyboardNode && pianoNode) {
                const outputPort = keyboardNode.ports.find(p => p.direction === 'output');
                const inputPort = pianoNode.ports.find(p => p.direction === 'input');

                if (outputPort && inputPort) {
                    useGraphStore.getState().addConnection(
                        keyboardNode.id,
                        outputPort.id,
                        pianoNode.id,
                        inputPort.id
                    );

                    // Delete the keyboard node
                    useGraphStore.getState().selectNode(keyboardNode.id, false);
                    useGraphStore.getState().deleteSelected();

                    // Root-level connections should be gone (keyboard deleted)
                    const rootConnections = useGraphStore.getState().getConnectionsAtLevel(null);
                    const connectionsInvolvingKeyboard = rootConnections.filter(
                        c => c.sourceNodeId === keyboardNode.id || c.targetNodeId === keyboardNode.id
                    );
                    expect(connectionsInvolvingKeyboard.length).toBe(0);
                }
            }
        });
    });

    describe('undo/redo', () => {
        it('should undo node addition', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            // Piano node has internal children, check root nodes instead
            expect(useGraphStore.getState().getRootNodes().length).toBe(1);

            useGraphStore.getState().undo();
            expect(useGraphStore.getState().getRootNodes().length).toBe(0);
        });

        it('should redo undone action', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            useGraphStore.getState().undo();
            expect(useGraphStore.getState().getRootNodes().length).toBe(0);

            useGraphStore.getState().redo();
            expect(useGraphStore.getState().getRootNodes().length).toBe(1);
        });

        it('should not undo when at beginning of history', () => {
            // Fresh state, nothing to undo
            const initialSize = useGraphStore.getState().nodes.size;
            useGraphStore.getState().undo();
            expect(useGraphStore.getState().nodes.size).toBe(initialSize);
        });

        it('should not redo when at end of history', () => {
            const { addNode } = useGraphStore.getState();

            addNode('piano', { x: 0, y: 0 });
            const currentSize = useGraphStore.getState().nodes.size;

            useGraphStore.getState().redo(); // Should do nothing
            expect(useGraphStore.getState().nodes.size).toBe(currentSize);
        });
    });

    describe('gesture-bracketed undo (REV-1)', () => {
        function addSpeaker(): string {
            useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
            const roots = useGraphStore.getState().getRootNodes();
            return roots[roots.length - 1].id;
        }
        const volOf = (id: string) =>
            (useGraphStore.getState().getNode(id)!.data as { volume: number }).volume;

        it('a param mutation OUTSIDE a gesture records NO history (system/per-frame safe)', () => {
            const id = addSpeaker();
            const idx = useGraphStore.getState().historyIndex;
            useGraphStore.getState().updateNodeData(id, { volume: 0.5 });
            // The data changed...
            expect(volOf(id)).toBe(0.5);
            // ...but no new undo entry was created (zero-regression: this is the
            // path MIDI propagation / per-frame writes take).
            expect(useGraphStore.getState().historyIndex).toBe(idx);
        });

        it('a gesture brackets multiple mutations into ONE undo entry', () => {
            const id = addSpeaker();
            const before = volOf(id);
            const idx = useGraphStore.getState().historyIndex;

            const s = useGraphStore.getState();
            s.beginGesture();
            s.updateNodeData(id, { volume: 0.3 });
            s.updateNodeData(id, { volume: 0.7 });
            s.endGesture();

            // Exactly one snapshot (deferred to the first mutation in the gesture).
            expect(useGraphStore.getState().historyIndex).toBe(idx + 1);
            expect(volOf(id)).toBe(0.7);

            // ONE undo reverts the WHOLE gesture to the pre-gesture value.
            useGraphStore.getState().undo();
            expect(volOf(id)).toBe(before);
        });

        it('an empty gesture creates no history entry', () => {
            addSpeaker();
            const idx = useGraphStore.getState().historyIndex;
            const s = useGraphStore.getState();
            s.beginGesture();
            s.endGesture();
            expect(useGraphStore.getState().historyIndex).toBe(idx);
        });

        it('nested gestures coalesce into a single undo entry', () => {
            const id = addSpeaker();
            const before = volOf(id);
            const idx = useGraphStore.getState().historyIndex;
            const s = useGraphStore.getState();
            s.beginGesture();
            s.beginGesture();
            s.updateNodeData(id, { volume: 0.1 });
            s.updateNodeData(id, { volume: 0.2 });
            s.endGesture();
            s.endGesture();
            expect(useGraphStore.getState().historyIndex).toBe(idx + 1);
            useGraphStore.getState().undo();
            expect(volOf(id)).toBe(before);
        });
    });
});
