import { describe, expect, it } from 'vitest';
import { importWorkflow } from '../serialization';
import type { SerializedWorkflow } from '../types';

describe('workflow serialization', () => {
    it('drops imported connections that reference removed ports', () => {
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Old looper workflow',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'looper-1',
                    type: 'looper',
                    category: 'routing',
                    position: { x: 0, y: 0 },
                    data: { duration: 10, isRecording: false, loops: [], currentTime: 0 }
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 }
                }
            ],
            connections: [
                {
                    id: 'stale-conn',
                    sourceNodeId: 'looper-1',
                    sourcePortId: 'sample-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                },
                {
                    id: 'valid-conn',
                    sourceNodeId: 'looper-1',
                    sourcePortId: 'audio-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                }
            ]
        };

        const imported = importWorkflow(workflow);
        const looper = imported.nodes.find(node => node.id === 'looper-1');

        expect(looper?.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out']);
        expect(imported.connections.map(connection => connection.id)).toEqual(['valid-conn']);
    });

    it('prefers persisted per-instance ports over registry defaults', () => {
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Looper with grown ports',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'looper-1',
                    type: 'looper',
                    category: 'routing',
                    position: { x: 0, y: 0 },
                    data: { duration: 10, isRecording: false, loops: [], currentTime: 0 },
                    // Instance has an extra port not present in registry defaults.
                    ports: [
                        { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input' },
                        { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output' },
                        { id: 'sample-out', name: 'Sample', type: 'audio', direction: 'output' }
                    ]
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 }
                }
            ],
            connections: [
                {
                    id: 'sample-conn',
                    sourceNodeId: 'looper-1',
                    sourcePortId: 'sample-out',
                    targetNodeId: 'speaker-1',
                    targetPortId: 'audio-in',
                    type: 'audio'
                }
            ]
        };

        const imported = importWorkflow(workflow);
        const looper = imported.nodes.find(node => node.id === 'looper-1');

        expect(looper?.ports.map(port => port.id)).toEqual(['audio-in', 'audio-out', 'sample-out']);
        // Connection to the persisted port is kept because the port now exists.
        expect(imported.connections.map(connection => connection.id)).toEqual(['sample-conn']);
    });

    it('drops nodes with an unknown (missing-definition) type', () => {
        const workflow: SerializedWorkflow = {
            version: '1.0.0',
            name: 'Workflow with future node',
            createdAt: '2026-06-15T00:00:00.000Z',
            nodes: [
                {
                    id: 'mystery-1',
                    // Pretend a newer build saved a node type this build does not know.
                    type: 'future-node' as never,
                    category: 'utility',
                    position: { x: 0, y: 0 },
                    data: {}
                },
                {
                    id: 'speaker-1',
                    type: 'speaker',
                    category: 'output',
                    position: { x: 300, y: 0 },
                    data: { isMuted: false, volume: 1 }
                }
            ],
            connections: []
        };

        const imported = importWorkflow(workflow);

        expect(imported.nodes.map(node => node.id)).toEqual(['speaker-1']);
    });
});
