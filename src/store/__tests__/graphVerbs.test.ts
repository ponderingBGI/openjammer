import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../engine/types';
import { applyGraphVerb, applyGraphVerbs, type GraphStateSlice, type GraphVerb } from '../graphVerbs';

const node = (id: string): GraphNode => ({ id, type: 'effect', category: 'effects', position: { x: 1, y: 2 }, data: { rate: 3 }, ports: [], parentId: null, childIds: [] });
const empty = (): GraphStateSlice => ({ nodes: new Map(), connections: new Map(), rootNodeIds: [] });

describe('GraphVerbs exact inverses', () => {
    it('round-trips add, move, data, ports, plugin identity, connection, and root order', () => {
        const before = empty();
        const verbs: GraphVerb[] = [
            { kind: 'addNode', node: node('a') },
            { kind: 'moveNode', nodeId: 'a', position: { x: 9, y: 8 } },
            { kind: 'setNodeData', nodeId: 'a', data: { rate: 7 } },
            { kind: 'setNodePorts', nodeId: 'a', ports: [] },
            { kind: 'setNodePluginId', nodeId: 'a', pluginId: 'ai.effect' },
            { kind: 'addNode', node: node('b') },
            { kind: 'addConnection', connection: { id: 'c', sourceNodeId: 'a', sourcePortId: 'out', targetNodeId: 'b', targetPortId: 'in', type: 'audio' } },
            { kind: 'setRootNodeIds', rootNodeIds: ['b', 'a'] },
        ];
        const result = applyGraphVerbs(before, verbs);
        expect(applyGraphVerbs(result.next, result.inverse).next).toEqual(before);
    });

    it('fails closed for an unknown referent', () => {
        expect(() => applyGraphVerb(empty(), { kind: 'removeNode', nodeId: 'missing' })).toThrow(/no node/);
    });
});
