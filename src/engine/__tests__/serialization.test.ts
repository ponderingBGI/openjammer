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
});
