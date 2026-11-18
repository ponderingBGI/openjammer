/**
 * Bundle Connection Integration Tests
 *
 * Tests for bundle detection, port expansion, and dynamic port management
 * in the node graph system.
 */

import { describe, it, expect } from 'vitest';
import type { GraphNode, Connection, PortDefinition } from '../../engine/types';
import {
    syncPortsWithInternalNodes,
    getConnectionBundleCount,
    isConnectionBundled,
    getBundleSizeFromSourcePort,
    isInstrumentNode,
    detectBundleInfo,
    expandTargetForBundle,
    checkDynamicPortAddition,
    checkDynamicPortRemoval,
    isValidPortId,
    isValidCompositePortId
} from '../portSync';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestNode(overrides: Partial<GraphNode> = {}): GraphNode {
    return {
        id: 'test-node',
        type: 'instrument',
        category: 'instruments',
        position: { x: 0, y: 0 },
        data: {},
        ports: [],
        childIds: [],
        parentId: null,
        ...overrides
    };
}

function createOutputPanel(id: string, portCount: number): GraphNode {
    const ports: PortDefinition[] = [];
    const portLabels: Record<string, string> = {};

    for (let i = 1; i <= portCount; i++) {
        const portId = `port-${i}`;
        ports.push({
            id: portId,
            name: `Port ${i}`,
            type: 'control',
            direction: 'input'
        });
        portLabels[portId] = `Row ${i}`;
    }

    return {
        id,
        type: 'output-panel',
        category: 'routing',
        position: { x: 0, y: 0 },
        data: { portLabels },
        ports,
        childIds: [],
        parentId: null
    };
}

function createInputPanel(id: string, portCount: number): GraphNode {
    const ports: PortDefinition[] = [];
    const portLabels: Record<string, string> = {};

    for (let i = 1; i <= portCount; i++) {
        const portId = `port-${i}`;
        ports.push({
            id: portId,
            name: `Port ${i}`,
            type: 'control',
            direction: 'output'
        });
        portLabels[portId] = `Input ${i}`;
    }

    return {
        id,
        type: 'input-panel',
        category: 'routing',
        position: { x: 0, y: 0 },
        data: { portLabels },
        ports,
        childIds: [],
        parentId: null
    };
}

function createConnection(
    sourceNodeId: string,
    sourcePortId: string,
    targetNodeId: string,
    targetPortId: string
): Connection {
    return {
        id: `conn-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId,
        type: 'control'
    };
}

// ============================================================================
// Port Synchronization Tests
// ============================================================================

describe('syncPortsWithInternalNodes', () => {
    it('should return empty array when no child nodes', () => {
        const parent = createTestNode({ childIds: [] });
        const result = syncPortsWithInternalNodes(parent, []);
        expect(result).toEqual([]);
    });

    it('should sync canvas-input nodes to input ports', () => {
        const canvasInput: GraphNode = {
            id: 'canvas-input-1',
            type: 'canvas-input',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: { portName: 'Audio In' },
            ports: [{ id: 'out', name: 'Out', type: 'audio', direction: 'output' }],
            childIds: [],
            parentId: null
        };

        const parent = createTestNode({
            childIds: ['canvas-input-1'],
            specialNodes: ['canvas-input-1']
        });

        const result = syncPortsWithInternalNodes(parent, [canvasInput]);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('canvas-input-1');
        expect(result[0].name).toBe('Audio In');
        expect(result[0].direction).toBe('input');
        expect(result[0].type).toBe('audio');
    });

    it('should sync canvas-output nodes to output ports', () => {
        const canvasOutput: GraphNode = {
            id: 'canvas-output-1',
            type: 'canvas-output',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: { portName: 'Audio Out' },
            ports: [{ id: 'in', name: 'In', type: 'audio', direction: 'input' }],
            childIds: [],
            parentId: null
        };

        const parent = createTestNode({
            childIds: ['canvas-output-1'],
            specialNodes: ['canvas-output-1']
        });

        const result = syncPortsWithInternalNodes(parent, [canvasOutput]);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('canvas-output-1');
        expect(result[0].name).toBe('Audio Out');
        expect(result[0].direction).toBe('output');
        expect(result[0].type).toBe('audio');
    });

    it('should only sync nodes in specialNodes array', () => {
        const specialNode: GraphNode = {
            id: 'special-1',
            type: 'canvas-output',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: { portName: 'Special' },
            ports: [{ id: 'in', name: 'In', type: 'control', direction: 'input' }],
            childIds: [],
            parentId: null
        };

        const regularNode: GraphNode = {
            id: 'regular-1',
            type: 'canvas-output',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: { portName: 'Regular' },
            ports: [{ id: 'in', name: 'In', type: 'control', direction: 'input' }],
            childIds: [],
            parentId: null
        };

        const parent = createTestNode({
            childIds: ['special-1', 'regular-1'],
            specialNodes: ['special-1'] // Only special-1 is in specialNodes
        });

        const result = syncPortsWithInternalNodes(parent, [specialNode, regularNode]);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('special-1');
    });

    it('should sync output-panel to multiple output ports with composite IDs', () => {
        const outputPanel = createOutputPanel('output-panel-1', 3);

        const parent = createTestNode({
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });

        const result = syncPortsWithInternalNodes(parent, [outputPanel]);

        expect(result).toHaveLength(3);
        expect(result[0].id).toBe('output-panel-1:port-1');
        expect(result[1].id).toBe('output-panel-1:port-2');
        expect(result[2].id).toBe('output-panel-1:port-3');
        result.forEach(port => {
            expect(port.direction).toBe('output');
            expect(isValidCompositePortId(port.id)).toBe(true);
        });
    });

    it('should sync input-panel to multiple input ports', () => {
        const inputPanel = createInputPanel('input-panel-1', 2);

        const parent = createTestNode({
            childIds: ['input-panel-1'],
            specialNodes: ['input-panel-1']
        });

        const result = syncPortsWithInternalNodes(parent, [inputPanel]);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('input-panel-1:port-1');
        expect(result[1].id).toBe('input-panel-1:port-2');
        result.forEach(port => {
            expect(port.direction).toBe('input');
        });
    });
});

// ============================================================================
// Bundle Detection Tests
// ============================================================================

describe('getConnectionBundleCount', () => {
    it('should return 1 for non-special port connections', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const sourceNode = createTestNode({
            id: 'source',
            ports: [{ id: 'out', name: 'Out', type: 'audio', direction: 'output' }]
        });
        nodes.set('source', sourceNode);

        const connection = createConnection('source', 'out', 'target', 'in');
        connections.set(connection.id, connection);

        const count = getConnectionBundleCount(connection, nodes, connections);
        expect(count).toBe(1);
    });

    it('should count internal connections to canvas-output', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        // Create canvas-output node
        const canvasOutput: GraphNode = {
            id: 'canvas-output-1',
            type: 'canvas-output',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: {},
            ports: [{ id: 'in', name: 'In', type: 'control', direction: 'input' }],
            childIds: [],
            parentId: null
        };
        nodes.set('canvas-output-1', canvasOutput);

        // Parent node with canvas-output as special node
        const parent = createTestNode({
            id: 'keyboard',
            type: 'keyboard',
            childIds: ['canvas-output-1'],
            specialNodes: ['canvas-output-1']
        });
        nodes.set('keyboard', parent);

        // Internal connections TO canvas-output (3 keys connecting)
        const conn1 = createConnection('key-1', 'out', 'canvas-output-1', 'in');
        const conn2 = createConnection('key-2', 'out', 'canvas-output-1', 'in');
        const conn3 = createConnection('key-3', 'out', 'canvas-output-1', 'in');
        connections.set(conn1.id, conn1);
        connections.set(conn2.id, conn2);
        connections.set(conn3.id, conn3);

        // External connection from keyboard using canvas-output as port
        const externalConn = createConnection('keyboard', 'canvas-output-1', 'instrument', 'in');

        const count = getConnectionBundleCount(externalConn, nodes, connections);
        expect(count).toBe(3);
    });
});

describe('isConnectionBundled', () => {
    it('should return false for single connections', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const node = createTestNode({ id: 'source' });
        nodes.set('source', node);

        const conn = createConnection('source', 'out', 'target', 'in');

        expect(isConnectionBundled(conn, nodes, connections)).toBe(false);
    });

    it('should return true when bundle count > 1', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const canvasOutput: GraphNode = {
            id: 'canvas-output-1',
            type: 'canvas-output',
            category: 'routing',
            position: { x: 0, y: 0 },
            data: {},
            ports: [],
            childIds: [],
            parentId: null
        };
        nodes.set('canvas-output-1', canvasOutput);

        const parent = createTestNode({
            id: 'keyboard',
            specialNodes: ['canvas-output-1']
        });
        nodes.set('keyboard', parent);

        // Two internal connections
        connections.set('c1', createConnection('k1', 'o', 'canvas-output-1', 'in'));
        connections.set('c2', createConnection('k2', 'o', 'canvas-output-1', 'in'));

        const externalConn = createConnection('keyboard', 'canvas-output-1', 'inst', 'in');

        expect(isConnectionBundled(externalConn, nodes, connections)).toBe(true);
    });
});

// ============================================================================
// Bundle Size Detection Tests
// ============================================================================

describe('getBundleSizeFromSourcePort', () => {
    it('should return size 1 for non-panel ports', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const node = createTestNode({ id: 'source' });
        nodes.set('source', node);

        const result = getBundleSizeFromSourcePort('source', 'audio-out', nodes, connections);
        expect(result.size).toBe(1);
        expect(result.label).toBe('In');
    });

    it('should detect bundle size from output-panel internal connections', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const outputPanel = createOutputPanel('output-panel-1', 4);
        nodes.set('output-panel-1', outputPanel);

        // Add keyboard node as source
        const keyboard = createTestNode({
            id: 'keyboard',
            type: 'keyboard',
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });
        nodes.set('keyboard', keyboard);

        // 5 internal connections to port-1
        for (let i = 0; i < 5; i++) {
            const conn = createConnection(`key-${i}`, 'out', 'output-panel-1', 'port-1');
            conn.id = `conn-${i}`;
            connections.set(conn.id, conn);
        }

        const result = getBundleSizeFromSourcePort(
            'keyboard',
            'output-panel-1:port-1',
            nodes,
            connections
        );

        expect(result.size).toBe(5);
        expect(result.label).toBe('Row 1');
    });

    it('should reject invalid port IDs', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        // Try with malicious port ID
        const result = getBundleSizeFromSourcePort(
            'source',
            '../../../etc/passwd',
            nodes,
            connections
        );

        expect(result.size).toBe(1);
        expect(result.label).toBe('In');
    });
});

describe('detectBundleInfo', () => {
    it('should return bundle info for valid bundles', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const outputPanel = createOutputPanel('output-panel-1', 2);
        nodes.set('output-panel-1', outputPanel);

        // Add keyboard node as source
        const keyboard = createTestNode({
            id: 'keyboard',
            type: 'keyboard',
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });
        nodes.set('keyboard', keyboard);

        // Add 3 connections to port-1
        for (let i = 0; i < 3; i++) {
            connections.set(`c${i}`, createConnection(`k${i}`, 'o', 'output-panel-1', 'port-1'));
        }

        const result = detectBundleInfo('keyboard', 'output-panel-1:port-1', nodes, connections);

        expect(result).not.toBeNull();
        expect(result!.size).toBe(3);
    });
});

// ============================================================================
// Instrument Node Detection Tests
// ============================================================================

describe('isInstrumentNode', () => {
    const instrumentTypes = ['strings', 'keys', 'winds', 'instrument', 'sampler'];
    const nonInstrumentTypes = ['keyboard', 'microphone', 'output', 'effect', 'looper'];

    instrumentTypes.forEach(type => {
        it(`should return true for ${type}`, () => {
            const node = createTestNode({ type: type as GraphNode['type'] });
            expect(isInstrumentNode(node)).toBe(true);
        });
    });

    nonInstrumentTypes.forEach(type => {
        it(`should return false for ${type}`, () => {
            const node = createTestNode({ type: type as GraphNode['type'] });
            expect(isInstrumentNode(node)).toBe(false);
        });
    });
});

// ============================================================================
// Target Expansion Tests
// ============================================================================

describe('expandTargetForBundle', () => {
    it('should return null for nodes without input-panel', () => {
        const nodes = new Map<string, GraphNode>();
        const node = createTestNode({ id: 'target', childIds: [], specialNodes: [] });
        nodes.set('target', node);

        const result = expandTargetForBundle('target', 5, 'Keys', nodes);
        expect(result).toBeNull();
    });

    it('should create new ports for bundle expansion', () => {
        const nodes = new Map<string, GraphNode>();

        const inputPanel = createInputPanel('input-panel-1', 1);
        nodes.set('input-panel-1', inputPanel);

        const target = createTestNode({
            id: 'instrument-1',
            type: 'instrument',
            childIds: ['input-panel-1'],
            specialNodes: ['input-panel-1']
        });
        nodes.set('instrument-1', target);

        const result = expandTargetForBundle('instrument-1', 5, 'Piano Keys', nodes);

        expect(result).not.toBeNull();
        expect(result!.panelId).toBe('input-panel-1');
        expect(result!.newPorts).toHaveLength(1);
        expect(result!.newPorts[0].name).toBe('Piano Keys');
        expect(result!.newPorts[0].direction).toBe('output');
        expect(isValidPortId(result!.newPorts[0].id)).toBe(true);
    });
});

// ============================================================================
// Dynamic Port Addition Tests
// ============================================================================

describe('checkDynamicPortAddition', () => {
    it('should return null for non-keyboard nodes', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const node = createTestNode({ id: 'inst', type: 'instrument' });
        nodes.set('inst', node);

        const result = checkDynamicPortAddition('inst', nodes, connections);
        expect(result.newNode).toBeNull();
        expect(result.updatedNode).toBeNull();
    });

    it('should add new port when all output-panel ports are connected', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const outputPanel = createOutputPanel('output-panel-1', 2);
        nodes.set('output-panel-1', outputPanel);

        const keyboard = createTestNode({
            id: 'keyboard-1',
            type: 'keyboard',
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });
        nodes.set('keyboard-1', keyboard);

        // Connect all ports
        connections.set('c1', createConnection('k1', 'o', 'output-panel-1', 'port-1'));
        connections.set('c2', createConnection('k2', 'o', 'output-panel-1', 'port-2'));

        const result = checkDynamicPortAddition('keyboard-1', nodes, connections);

        expect(result.updatedNode).not.toBeNull();
        expect(result.updatedNode!.id).toBe('output-panel-1');
        expect(result.updatedNode!.ports).toHaveLength(3);
    });

    it('should not add port when some ports are free', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const outputPanel = createOutputPanel('output-panel-1', 3);
        nodes.set('output-panel-1', outputPanel);

        const keyboard = createTestNode({
            id: 'keyboard-1',
            type: 'keyboard',
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });
        nodes.set('keyboard-1', keyboard);

        // Only connect 2 of 3 ports
        connections.set('c1', createConnection('k1', 'o', 'output-panel-1', 'port-1'));
        connections.set('c2', createConnection('k2', 'o', 'output-panel-1', 'port-2'));

        const result = checkDynamicPortAddition('keyboard-1', nodes, connections);

        expect(result.updatedNode).toBeNull();
    });
});

// ============================================================================
// Dynamic Port Removal Tests
// ============================================================================

describe('checkDynamicPortRemoval', () => {
    it('should return null for non-keyboard nodes', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const node = createTestNode({ id: 'inst', type: 'instrument' });
        nodes.set('inst', node);

        const result = checkDynamicPortRemoval('inst', nodes, connections);
        expect(result.updatedNode).toBeNull();
    });

    it('should remove excess free ports (keeping one free)', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        // Create output panel with 6 ports (more than default 4)
        const outputPanel = createOutputPanel('output-panel-1', 6);
        nodes.set('output-panel-1', outputPanel);

        const keyboard = createTestNode({
            id: 'keyboard-1',
            type: 'keyboard',
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });
        nodes.set('keyboard-1', keyboard);

        // Only connect first 3 ports (leaving 3 free)
        connections.set('c1', createConnection('k1', 'o', 'output-panel-1', 'port-1'));
        connections.set('c2', createConnection('k2', 'o', 'output-panel-1', 'port-2'));
        connections.set('c3', createConnection('k3', 'o', 'output-panel-1', 'port-3'));

        const result = checkDynamicPortRemoval('keyboard-1', nodes, connections);

        expect(result.updatedNode).not.toBeNull();
        // Should remove port-6 (highest numbered free port)
        expect(result.updatedNode!.ports).toHaveLength(5);
    });

    it('should not remove ports below default count (4)', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const outputPanel = createOutputPanel('output-panel-1', 4);
        nodes.set('output-panel-1', outputPanel);

        const keyboard = createTestNode({
            id: 'keyboard-1',
            type: 'keyboard',
            childIds: ['output-panel-1'],
            specialNodes: ['output-panel-1']
        });
        nodes.set('keyboard-1', keyboard);

        // Connect only 1 port (leaving 3 free, but at default count)
        connections.set('c1', createConnection('k1', 'o', 'output-panel-1', 'port-1'));

        const result = checkDynamicPortRemoval('keyboard-1', nodes, connections);

        expect(result.updatedNode).toBeNull();
    });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
    it('should handle missing source node gracefully', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const result = getBundleSizeFromSourcePort('missing', 'port', nodes, connections);
        expect(result.size).toBe(1);
        expect(result.label).toBe('In');
    });

    it('should handle empty connections map', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const node = createTestNode({ id: 'source' });
        nodes.set('source', node);

        const conn = createConnection('source', 'out', 'target', 'in');
        const count = getConnectionBundleCount(conn, nodes, connections);

        expect(count).toBe(1);
    });

    it('should handle missing parent node in checkDynamicPortAddition', () => {
        const nodes = new Map<string, GraphNode>();
        const connections = new Map<string, Connection>();

        const result = checkDynamicPortAddition('missing', nodes, connections);
        expect(result.newNode).toBeNull();
        expect(result.updatedNode).toBeNull();
    });

    it('should handle missing target node in expandTargetForBundle', () => {
        const nodes = new Map<string, GraphNode>();
        const result = expandTargetForBundle('missing', 5, 'Label', nodes);
        expect(result).toBeNull();
    });
});
