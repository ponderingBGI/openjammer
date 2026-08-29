import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getNodeDimensions, useGraphStore } from '../graphStore';
import { useHistoryStore } from '../historyStore';
import { useCanvasNavigationStore } from '../canvasNavigationStore';
import type { GraphNode } from '../../engine/types';

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
            version: 0,
        });
        useHistoryStore.getState().clear();
        useCanvasNavigationStore.setState({ currentViewNodeId: null, rootViewState: null, viewStates: new Map() });
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

        // W6-P11: the five legacy fixed-voice types are DELETED from the registry.
        // A session saved with one of them must still open, still be wired, and
        // still make the same sound. Both assertions below fail on the pre-P11
        // code: there the node stayed `type: 'piano'` and carried no instrumentId.
        it('migrates a saved legacy piano to `instrument`, keeping its ports and cables', () => {
            const pianoPorts = [
                { id: 'input-panel-1:key-in', name: 'Input', type: 'control', direction: 'input' },
                { id: 'output-panel-1:audio-out', name: 'Audio', type: 'audio', direction: 'output' }
            ];
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: [
                        ['kb-1', {
                            id: 'kb-1',
                            type: 'keyboard',
                            category: 'input',
                            position: { x: 0, y: 0 },
                            data: { activeRow: null, rowOctaves: [4, 4, 4] },
                            ports: [
                                { id: 'bundle-out', name: 'Bundle', type: 'control', direction: 'output' }
                            ],
                            parentId: null, childIds: [], specialNodes: []
                        }],
                        ['piano-1', {
                            id: 'piano-1',
                            type: 'piano',
                            category: 'instruments',
                            position: { x: 200, y: 0 },
                            data: { offsets: { 'input-1': 0 }, activeInputs: ['input-1'] },
                            ports: pianoPorts,
                            parentId: null, childIds: [], specialNodes: []
                        }],
                        ['spk-1', {
                            id: 'spk-1',
                            type: 'speaker',
                            category: 'output',
                            position: { x: 400, y: 0 },
                            data: { isMuted: false, volume: 1 },
                            ports: [
                                { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' }
                            ],
                            parentId: null, childIds: [], specialNodes: []
                        }]
                    ],
                    connections: [
                        ['c-kb', {
                            id: 'c-kb', sourceNodeId: 'kb-1', sourcePortId: 'bundle-out',
                            targetNodeId: 'piano-1', targetPortId: 'input-panel-1:key-in', type: 'control'
                        }],
                        ['c-spk', {
                            id: 'c-spk', sourceNodeId: 'piano-1', sourcePortId: 'output-panel-1:audio-out',
                            targetNodeId: 'spk-1', targetPortId: 'audio-in', type: 'audio'
                        }]
                    ]
                }
            }));

            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist?.getOptions?.()?.storage;
            expect(storage).toBeDefined();
            const result = storage!.getItem(STORAGE_KEY) as {
                state: {
                    nodes: Map<string, { type: string; data: Record<string, unknown>; ports: { id: string }[] }>;
                    connections: Map<string, unknown>;
                }
            } | null;

            const migrated = result?.state.nodes.get('piano-1');
            expect(migrated?.type).toBe('instrument');
            expect(migrated?.data.instrumentId).toBe('gm-acoustic-grand-piano');
            // The offsets the old fixed def carried are the node's own data now.
            expect(migrated?.data.offsets).toEqual({ 'input-1': 0 });
            // PERSISTED PORTS survive verbatim — `connectionPortsExist` drops any
            // cable whose port vanished, so this is what keeps the patch wired.
            expect(migrated?.ports.map(p => p.id)).toEqual(pianoPorts.map(p => p.id));
            expect(result?.state.connections.has('c-kb')).toBe(true);
            expect(result?.state.connections.has('c-spk')).toBe(true);
        });

        it('migrates every legacy voice through loadGraph (the project-folder / crash-recovery seam)', () => {
            // A project folder hands `manifest.graph.nodes` STRAIGHT to loadGraph
            // (AppMenuBar.handleOpenProject) and so does crash recovery — neither
            // passes through zustand-persist or importWorkflow.
            const legacy = [
                ['cello', 'gm-cello'],
                ['electricCello', 'gm-cello'],
                ['violin', 'gm-violin'],
                ['saxophone', 'gm-alto-sax'],
            ] as const;
            const nodes = legacy.map(([type], i) => ({
                id: `n-${i}`,
                type,
                category: 'instruments',
                position: { x: i * 200, y: 0 },
                data: { offsets: { 'input-1': -12 }, activeInputs: ['input-1'] },
                ports: [{ id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' }],
                parentId: null,
                childIds: [],
                specialNodes: [],
            }));

            useGraphStore.getState().loadGraph(nodes as unknown as GraphNode[], []);

            const loaded = useGraphStore.getState().nodes;
            legacy.forEach(([, instrumentId], i) => {
                const node = loaded.get(`n-${i}`)!;
                expect(node.type).toBe('instrument');
                expect((node.data as Record<string, unknown>).instrumentId).toBe(instrumentId);
                expect(node.ports.map(p => p.id)).toEqual(['audio-out']);
            });
        });

        // W6-P11b: the FIFTH seam. The graph store has no `partialize`, so
        // `setItem` writes `clipboard` alongside `nodes`, and `pasteClipboard`
        // clones the copied node's `type` and `ports` verbatim. Ctrl+C then reload
        // then Ctrl+V has to paste a live node, not last release's corpse.
        it('migrates a legacy node sitting in the PERSISTED CLIPBOARD', () => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: [], connections: [],
                    clipboard: {
                        nodes: [['c-1', {
                            id: 'c-1', type: 'cello', category: 'instruments',
                            position: { x: 0, y: 0 },
                            data: { offsets: { 'input-1': -12 } },
                            ports: [], parentId: null, childIds: [], specialNodes: [],
                        }]],
                        connections: [],
                    },
                },
            }));

            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist.getOptions().storage;
            const result = storage.getItem(STORAGE_KEY) as {
                state: { clipboard: { nodes: [string, { type: string; data: Record<string, unknown> }][] } }
            };

            const [, pasted] = result.state.clipboard.nodes[0];
            expect(pasted.type).toBe('instrument');
            expect(pasted.data.instrumentId).toBe('gm-cello');
            // The offsets the deleted `cello` def used to supply are the node's own.
            expect(pasted.data.offsets).toEqual({ 'input-1': -12 });
        });

        it('migrates the PORTS of a clipboard node too (the pre-existing gap at the same seam)', () => {
            // `migrateNodePorts` drops the looper's dead `sample-out`. A looper
            // copied before that migration used to paste back carrying it — the
            // clipboard escaped ports migration exactly as it escaped types.
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    nodes: [], connections: [],
                    clipboard: {
                        nodes: [['lp-1', {
                            id: 'lp-1', type: 'looper', category: 'utility',
                            position: { x: 0, y: 0 },
                            data: {},
                            ports: [
                                { id: 'audio-in', name: 'In', type: 'audio', direction: 'input' },
                                { id: 'audio-out', name: 'Out', type: 'audio', direction: 'output' },
                                { id: 'sample-out', name: 'Sample', type: 'technical', direction: 'output' },
                            ],
                            parentId: null, childIds: [], specialNodes: [],
                        }]],
                        connections: [],
                    },
                },
            }));

            const storage = (useGraphStore as unknown as { persist: { getOptions: () => { storage: { getItem: (name: string) => unknown } } } }).persist.getOptions().storage;
            const result = storage.getItem(STORAGE_KEY) as {
                state: { clipboard: { nodes: [string, { ports: { id: string; type: string }[] }][] } }
            };

            const [, pasted] = result.state.clipboard.nodes[0];
            expect(pasted.ports.map(p => p.id)).toEqual(['audio-in', 'audio-out']);
            // ...and the same call renames the retired `technical` port type.
            expect(pasted.ports.every(p => p.type !== 'technical')).toBe(true);
        });
    });

    describe('node operations', () => {
        it('should add a node', () => {
            const { addNode, nodes } = useGraphStore.getState();

            addNode('instrument', { x: 100, y: 100 });

            expect(nodes.size).toBe(0); // State is stale, need to get fresh
            // The instrument node has internal children (instrument-visual, input-panel, output-panel)
            // so total nodes is greater than 1. Check root nodes instead.
            const rootNodes = useGraphStore.getState().getRootNodes();
            expect(rootNodes.length).toBe(1);
            expect(rootNodes[0].type).toBe('instrument');
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

            addNode('instrument', { x: 0, y: 0 });
            addNode('instrument', { x: 100, y: 100 });

            const nodes = useGraphStore.getState().nodes;
            const ids = Array.from(nodes.keys());

            expect(ids[0]).not.toBe(ids[1]);
        });

        it('should update node position', () => {
            const { addNode } = useGraphStore.getState();

            addNode('instrument', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().updateNodePosition(nodeId, { x: 200, y: 300 });

            const node = useGraphStore.getState().nodes.get(nodeId);
            expect(node?.position).toEqual({ x: 200, y: 300 });
        });

        it('should delete selected nodes', () => {
            const { addNode } = useGraphStore.getState();

            addNode('instrument', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().selectNode(nodeId, false);
            useGraphStore.getState().deleteSelected();

            expect(useGraphStore.getState().nodes.size).toBe(0);
        });
    });

    describe('selection', () => {
        it('should select a node', () => {
            const { addNode } = useGraphStore.getState();

            addNode('instrument', { x: 0, y: 0 });
            const nodeId = Array.from(useGraphStore.getState().nodes.keys())[0];

            useGraphStore.getState().selectNode(nodeId, false);

            expect(useGraphStore.getState().selectedNodeIds.has(nodeId)).toBe(true);
        });

        it('should support multi-select with additive flag', () => {
            const { addNode } = useGraphStore.getState();

            addNode('instrument', { x: 0, y: 0 });
            addNode('speaker', { x: 100, y: 100 });

            const nodes = useGraphStore.getState().nodes;
            const nodeIds = Array.from(nodes.keys());

            useGraphStore.getState().selectNode(nodeIds[0], false);
            useGraphStore.getState().selectNode(nodeIds[1], true); // Additive

            expect(useGraphStore.getState().selectedNodeIds.size).toBe(2);
        });

        it('should clear selection', () => {
            const { addNode } = useGraphStore.getState();

            addNode('instrument', { x: 0, y: 0 });
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
            addNode('instrument', { x: 200, y: 0 });

            // Get internal connections count before adding external connection
            const initialConnections = useGraphStore.getState().connections.size;

            const nodes = Array.from(useGraphStore.getState().nodes.values());
            const keyboardNode = nodes.find(n => n.type === 'keyboard');
            const instrumentNode = nodes.find(n => n.type === 'instrument');

            if (keyboardNode && instrumentNode) {
                const outputPort = keyboardNode.ports.find(p => p.direction === 'output');
                const inputPort = instrumentNode.ports.find(p => p.direction === 'input');

                if (outputPort && inputPort) {
                    useGraphStore.getState().addConnection(
                        keyboardNode.id,
                        outputPort.id,
                        instrumentNode.id,
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
            addNode('instrument', { x: 200, y: 0 });

            const nodes = Array.from(useGraphStore.getState().nodes.values());
            const keyboardNode = nodes.find(n => n.type === 'keyboard');
            const instrumentNode = nodes.find(n => n.type === 'instrument');

            if (keyboardNode && instrumentNode) {
                const outputPort = keyboardNode.ports.find(p => p.direction === 'output');
                const inputPort = instrumentNode.ports.find(p => p.direction === 'input');

                if (outputPort && inputPort) {
                    useGraphStore.getState().addConnection(
                        keyboardNode.id,
                        outputPort.id,
                        instrumentNode.id,
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

            addNode('instrument', { x: 0, y: 0 });
            // The instrument node has internal children, check root nodes instead
            expect(useGraphStore.getState().getRootNodes().length).toBe(1);

            useGraphStore.getState().undo();
            expect(useGraphStore.getState().getRootNodes().length).toBe(0);
        });

        it('should redo undone action', () => {
            const { addNode } = useGraphStore.getState();

            addNode('instrument', { x: 0, y: 0 });
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

            addNode('instrument', { x: 0, y: 0 });
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

        it('a param mutation outside a gesture is one unified history entry', () => {
            const id = addSpeaker();
            const idx = useHistoryStore.getState().cursor;
            useGraphStore.getState().updateNodeData(id, { volume: 0.5 });
            // The data changed...
            expect(volOf(id)).toBe(0.5);
            expect(useHistoryStore.getState().cursor).toBe(idx + 1);
        });

        it('a gesture brackets multiple mutations into ONE undo entry', () => {
            const id = addSpeaker();
            const before = volOf(id);
            const idx = useHistoryStore.getState().cursor;

            const s = useGraphStore.getState();
            s.beginGesture();
            s.updateNodeData(id, { volume: 0.3 });
            s.updateNodeData(id, { volume: 0.7 });
            s.endGesture();

            // Exactly one snapshot (deferred to the first mutation in the gesture).
            expect(useHistoryStore.getState().cursor).toBe(idx + 1);
            expect(volOf(id)).toBe(0.7);

            // ONE undo reverts the WHOLE gesture to the pre-gesture value.
            useGraphStore.getState().undo();
            expect(volOf(id)).toBe(before);
        });

        it('an empty gesture creates no history entry', () => {
            addSpeaker();
            const idx = useHistoryStore.getState().cursor;
            const s = useGraphStore.getState();
            s.beginGesture();
            s.endGesture();
            expect(useHistoryStore.getState().cursor).toBe(idx);
        });

        it('nested gestures coalesce into a single undo entry', () => {
            const id = addSpeaker();
            const before = volOf(id);
            const idx = useHistoryStore.getState().cursor;
            const s = useGraphStore.getState();
            s.beginGesture();
            s.beginGesture();
            s.updateNodeData(id, { volume: 0.1 });
            s.updateNodeData(id, { volume: 0.2 });
            s.endGesture();
            s.endGesture();
            expect(useHistoryStore.getState().cursor).toBe(idx + 1);
            useGraphStore.getState().undo();
            expect(volOf(id)).toBe(before);
        });
    });

    describe('canvas reliability verbs', () => {
        it('does not confuse the width DSP parameter with pixel geometry', () => {
            const id = useGraphStore.getState().addNode('width', { x: 0, y: 0 });
            const node = useGraphStore.getState().nodes.get(id)!;

            expect(node.data.width).toBe(1);
            expect(getNodeDimensions(node).width).toBeGreaterThan(100);
        });

        it('uses persisted dimensions only for the resizable library node', () => {
            const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
            useGraphStore.getState().updateNodeData(id, { width: 612, height: 455 });

            expect(getNodeDimensions(useGraphStore.getState().nodes.get(id)!)).toEqual({
                width: 612,
                height: 455,
            });
        });

        it('falls back for an unknown plugin node without throwing', () => {
            const unknown = {
                id: 'plugin-node', type: 'future-plugin', category: 'effects',
                position: { x: 0, y: 0 }, data: {}, ports: [], parentId: null,
                childIds: [], specialNodes: [],
            } as unknown as Parameters<typeof getNodeDimensions>[0];

            expect(() => getNodeDimensions(unknown)).not.toThrow();
            expect(getNodeDimensions(unknown)).toEqual({ width: 160, height: 100 });
        });

        it('moves a selected group in one store publication', () => {
            const firstId = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
            const secondId = useGraphStore.getState().addNode('speaker', { x: 100, y: 0 });
            let publications = 0;
            const unsubscribe = useGraphStore.subscribe(() => { publications += 1; });

            useGraphStore.getState().moveNodes(new Map([
                [firstId, { x: 20, y: 30 }],
                [secondId, { x: 120, y: 30 }],
            ]));
            unsubscribe();

            expect(publications).toBe(1);
            expect(useGraphStore.getState().nodes.get(firstId)?.position).toEqual({ x: 20, y: 30 });
            expect(useGraphStore.getState().nodes.get(secondId)?.position).toEqual({ x: 120, y: 30 });
        });

        it('rejects a reconnect without touching the original cable', () => {
            const store = useGraphStore.getState();
            const keyboardId = store.addNode('keyboard', { x: 0, y: 0 });
            const instrumentNodeId = store.addNode('instrument', { x: 200, y: 0 });
            const keyboard = useGraphStore.getState().nodes.get(keyboardId)!;
            const instrument = useGraphStore.getState().nodes.get(instrumentNodeId)!;
            const source = keyboard.ports.find(port => port.direction === 'output')!;
            const target = instrument.ports.find(port => port.direction === 'input')!;
            const originalId = useGraphStore.getState().addConnection(keyboardId, source.id, instrumentNodeId, target.id)!;
            const connectionCount = useGraphStore.getState().connections.size;

            const rejected = useGraphStore.getState().reconnectConnection(
                originalId,
                keyboardId,
                source.id,
                instrumentNodeId,
                instrument.ports.find(port => port.direction === 'output')!.id,
            );

            expect(rejected).toBeNull();
            expect(useGraphStore.getState().connections.has(originalId)).toBe(true);
            expect(useGraphStore.getState().connections).toHaveLength(connectionCount);
            expect(useHistoryStore.getState().open).toBeNull();
        });

        it('closes reconnect history when connection creation throws', () => {
            const store = useGraphStore.getState();
            const keyboardId = store.addNode('keyboard', { x: 0, y: 0 });
            const instrumentNodeId = store.addNode('instrument', { x: 200, y: 0 });
            const keyboard = useGraphStore.getState().nodes.get(keyboardId)!;
            const instrument = useGraphStore.getState().nodes.get(instrumentNodeId)!;
            const source = keyboard.ports.find(port => port.direction === 'output')!;
            const target = instrument.ports.find(port => port.direction === 'input')!;
            const originalId = store.addConnection(keyboardId, source.id, instrumentNodeId, target.id)!;
            const originalAdd = useGraphStore.getState().addConnection;
            useGraphStore.setState({ addConnection: () => { throw new Error('plugin expansion failed'); } });

            try {
                expect(() => useGraphStore.getState().reconnectConnection(
                    originalId, keyboardId, source.id, instrumentNodeId, target.id + '-other',
                )).toThrow('plugin expansion failed');
                expect(useHistoryStore.getState().open).toBeNull();
                expect(useGraphStore.getState().connections.has(originalId)).toBe(true);
            } finally {
                useGraphStore.setState({ addConnection: originalAdd });
            }
        });

        it('reconnects an audio source end in one atomic store update without losing the cable', () => {
            const store = useGraphStore.getState();
            const firstId = store.addNode('instrument', { x: 0, y: 0 });
            const secondId = store.addNode('instrument', { x: 200, y: 0 });
            const speakerId = store.addNode('speaker', { x: 400, y: 0 });
            const first = useGraphStore.getState().nodes.get(firstId)!;
            const second = useGraphStore.getState().nodes.get(secondId)!;
            const speaker = useGraphStore.getState().nodes.get(speakerId)!;
            const firstOut = first.ports.find(port => port.direction === 'output' && port.type === 'audio')!;
            const secondOut = second.ports.find(port => port.direction === 'output' && port.type === 'audio')!;
            const input = speaker.ports.find(port => port.direction === 'input')!;
            const originalId = store.addConnection(firstId, firstOut.id, speakerId, input.id)!;
            const observed: string[][] = [];
            const unsubscribe = useGraphStore.subscribe(state => {
                observed.push(Array.from(state.connections.keys()));
            });

            const replacementId = useGraphStore.getState().reconnectConnection(
                originalId, secondId, secondOut.id, speakerId, input.id,
            )!;
            unsubscribe();

            expect(observed).toHaveLength(1);
            expect(observed[0]).toContain(replacementId);
            expect(observed[0]).not.toContain(originalId);
        });

        it('treats a same-port reconnect as a no-op with no history entry', () => {
            const store = useGraphStore.getState();
            const keyboardId = store.addNode('keyboard', { x: 0, y: 0 });
            const instrumentNodeId = store.addNode('instrument', { x: 200, y: 0 });
            const keyboard = useGraphStore.getState().nodes.get(keyboardId)!;
            const instrument = useGraphStore.getState().nodes.get(instrumentNodeId)!;
            const source = keyboard.ports.find(port => port.direction === 'output')!;
            const target = instrument.ports.find(port => port.direction === 'input')!;
            const originalId = store.addConnection(keyboardId, source.id, instrumentNodeId, target.id)!;
            const original = useGraphStore.getState().connections.get(originalId)!;
            const cursor = useHistoryStore.getState().cursor;

            expect(store.reconnectConnection(
                originalId,
                original.sourceNodeId,
                original.sourcePortId,
                original.targetNodeId,
                original.targetPortId,
            )).toBe(originalId);
            expect(useHistoryStore.getState().cursor).toBe(cursor);
            expect(useHistoryStore.getState().open).toBeNull();
        });

        it('reconnects as one undoable graph gesture', () => {
            const store = useGraphStore.getState();
            const keyboardId = store.addNode('keyboard', { x: 0, y: 0 });
            const firstId = store.addNode('instrument', { x: 200, y: 0 });
            const secondId = store.addNode('instrument', { x: 400, y: 0 });
            const keyboard = useGraphStore.getState().nodes.get(keyboardId)!;
            const first = useGraphStore.getState().nodes.get(firstId)!;
            const second = useGraphStore.getState().nodes.get(secondId)!;
            const sourceId = keyboard.ports.find(port => port.direction === 'output')!.id;
            const originalId = useGraphStore.getState().addConnection(
                keyboardId, sourceId, firstId, first.ports.find(port => port.direction === 'input')!.id,
            )!;

            const replacementId = useGraphStore.getState().reconnectConnection(
                originalId,
                keyboardId,
                sourceId,
                secondId,
                second.ports.find(port => port.direction === 'input')!.id,
            )!;
            expect(replacementId).not.toBe(originalId);
            expect(useGraphStore.getState().connections.has(originalId)).toBe(false);

            useGraphStore.getState().undo();
            expect(useGraphStore.getState().connections.has(originalId)).toBe(true);
            expect(useGraphStore.getState().connections.has(replacementId)).toBe(false);
        });

        it('deep-clones a selected container subtree and remaps hierarchy ids', () => {
            const store = useGraphStore.getState();
            const containerId = store.addNode('container', { x: 0, y: 0 });
            const childId = store.addNode('speaker', { x: 20, y: 20 }, containerId);
            store.selectNode(containerId);
            store.copySelected();
            store.pasteClipboard();

            const pastedRootId = Array.from(useGraphStore.getState().selectedNodeIds)
                .find(id => useGraphStore.getState().nodes.get(id)?.parentId === null)!;
            const pastedRoot = useGraphStore.getState().nodes.get(pastedRootId)!;
            expect(pastedRootId).not.toBe(containerId);
            const pastedSpeakerId = pastedRoot.childIds.find(
                id => useGraphStore.getState().nodes.get(id)?.type === 'speaker',
            )!;
            expect(pastedSpeakerId).not.toBe(childId);
            expect(useGraphStore.getState().nodes.get(pastedSpeakerId)?.parentId).toBe(pastedRootId);
        });

        it('duplicates selected nodes without changing the clipboard', () => {
            const store = useGraphStore.getState();
            const clipboardNode = store.addNode('speaker', { x: 0, y: 0 });
            store.selectNode(clipboardNode);
            store.copySelected();
            const clipboard = useGraphStore.getState().clipboard;
            const selectedNode = store.addNode('instrument', { x: 200, y: 0 });
            store.selectNode(selectedNode);
            const observedClipboards: unknown[] = [];
            const unsubscribe = useGraphStore.subscribe((state) => observedClipboards.push(state.clipboard));

            useGraphStore.getState().duplicateSelected();
            unsubscribe();

            expect(useGraphStore.getState().clipboard).toBe(clipboard);
            expect(observedClipboards.every((value) => value === clipboard)).toBe(true);
            expect(Array.from(useGraphStore.getState().selectedNodeIds).some(
                (id) => useGraphStore.getState().nodes.get(id)?.type === 'instrument',
            )).toBe(true);
        });

        it('pastes roots into the current container and drops references to uncloned children', () => {
            const store = useGraphStore.getState();
            const destinationId = store.addNode('container', { x: 0, y: 0 });
            const sourceId = store.addNode('container', { x: 300, y: 0 });
            const childId = store.addNode('speaker', { x: 20, y: 20 }, sourceId);
            const source = useGraphStore.getState().nodes.get(sourceId)!;
            useGraphStore.setState({
                nodes: new Map(useGraphStore.getState().nodes).set(sourceId, {
                    ...source, childIds: [...source.childIds, 'external-not-copied'],
                }),
            });
            store.selectNode(sourceId);
            store.copySelected();
            useCanvasNavigationStore.setState({ currentViewNodeId: destinationId });

            useGraphStore.getState().pasteClipboard();

            const pastedRootId = Array.from(useGraphStore.getState().selectedNodeIds)
                .find((id) => useGraphStore.getState().nodes.get(id)?.type === 'container')!;
            const pastedRoot = useGraphStore.getState().nodes.get(pastedRootId)!;
            expect(pastedRoot.parentId).toBe(destinationId);
            expect(useGraphStore.getState().nodes.get(destinationId)?.childIds).toContain(pastedRootId);
            expect(pastedRoot.childIds).not.toContain('external-not-copied');
            const pastedSpeakerId = pastedRoot.childIds.find(
                (id) => useGraphStore.getState().nodes.get(id)?.type === 'speaker',
            );
            expect(pastedSpeakerId).toBeTruthy();
            expect(pastedSpeakerId).not.toBe(childId);
        });
    });
});
