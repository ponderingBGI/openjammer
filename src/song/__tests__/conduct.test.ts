import { describe, expect, it } from 'vitest';
import { conduct } from '../conduct';
import type { Arrangement } from '../types';

const base: Arrangement = {
    name: 'unit',
    tempoBpm: 120,
    ppq: 960,
    graph: {
        nodes: [
            { ref: 'keys', type: 'keys' },
            { ref: 'spk', type: 'speaker' },
        ],
        connections: [{ from: 'keys', to: 'spk' }],
    },
    tracks: [
        {
            ref: 'keys',
            clips: [{ startTick: 0, notes: [{ tick: 0, durTick: 960, pitch: 60, vel: 100 }] }],
        },
    ],
};

describe('conduct', () => {
    it('lowers a clip to noteOn/noteOff at the right seconds', () => {
        const r = conduct(base);
        const node = r.trackIndex['keys'];
        expect(typeof node).toBe('number');
        // 120 BPM, 960 PPQ: one quarter note = 0.5s.
        expect(r.events).toEqual([
            { at: 0, cmd: 'noteOn', node, note: 60, vel: 100 },
            { at: 0.5, cmd: 'noteOff', node, note: 60 },
        ]);
        // The lowered graph is real IR with a master sink.
        expect(r.graph.nodes.length).toBeGreaterThanOrEqual(2);
        // Release tail extends the render past the last event.
        expect(r.seconds).toBeGreaterThan(0.5);
    });

    it('is deterministic (same arrangement -> identical lowering)', () => {
        expect(conduct(base)).toEqual(conduct(base));
    });

    it('a muted track emits no notes (the always-correct gate)', () => {
        const muted: Arrangement = {
            ...base,
            tracks: [{ ...base.tracks[0]!, mute: true }],
        };
        expect(conduct(muted).events).toEqual([]);
    });

    it('lowers automation to stepped setParam events', () => {
        const arr: Arrangement = {
            ...base,
            tracks: [
                {
                    ref: 'keys',
                    clips: [],
                    automation: [{ ref: 'keys', param: 0, points: [
                        { tick: 0, value: 0.2 },
                        { tick: 1920, value: 0.9 },
                    ] }],
                },
            ],
        };
        const r = conduct(arr);
        const node = r.trackIndex['keys'];
        expect(r.events).toEqual([
            { at: 0, cmd: 'setParam', node, param: 0, value: 0.2 },
            { at: 1, cmd: 'setParam', node, param: 0, value: 0.9 },
        ]);
    });

    it('rejects a track that references a node which did not survive lowering', () => {
        const bad: Arrangement = {
            ...base,
            tracks: [{ ref: 'nope', clips: [] }],
        };
        expect(() => conduct(bad)).toThrow(/did not survive/);
    });
});
