/**
 * W6-CLEAN #7 — the Speaker's meter reads the SHARED dB scale.
 *
 * `SpeakerNode` carried a byte-identical private copy of `meterScale` (P6b
 * §M1 flagged it while wiring the Microphone and the Recorder to the shared
 * one). Two definitions of "how loud does this look" is one too many: the
 * canvas meter and the transport pill's master meter must agree, and the only
 * way to guarantee that is for there to be one function (code value #2 — extend
 * the pillar, never fork a parallel version).
 *
 * The behavioural half of this test is deliberately a no-change assertion: the
 * numbers the meter writes must be exactly what they were before the copy went.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { meterScale } from '../../Shell/masterSignal';

/** The shared frame writer, captured so a level can be pushed synchronously. */
let levelWriter: ((levels: ReadonlyMap<string, number>) => void) | null = null;

vi.mock('../../Arrangement/timelineSignalLevels', () => ({
    registerTimelineLevelWriter: (write: (levels: ReadonlyMap<string, number>) => void) => {
        levelWriter = write;
        return () => { levelWriter = null; };
    },
}));

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        setSpeakerDevice: vi.fn(),
        setSpeakerVolume: vi.fn(),
        subscribeSignalLevels: () => () => {},
    }),
}));

const { SpeakerNode } = await import('../SpeakerNode');

const SPEAKER_SOURCE = readFileSync(
    resolve(process.cwd(), 'src/components/Nodes/SpeakerNode.tsx'),
    'utf8',
);

beforeEach(() => {
    levelWriter = null;
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
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            enumerateDevices: vi.fn().mockResolvedValue([]),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        },
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('W6-CLEAN — one meter scale, imported not copied', () => {
    it('imports the shared meterScale and defines none of its own', () => {
        expect(SPEAKER_SOURCE).toContain("from '../Shell/masterSignal'");
        expect(SPEAKER_SOURCE).not.toMatch(/function\s+meterScale\s*\(/);
    });

    it.each([0.1, 0.02, 0.5, 1])(
        'writes meterScale(%f) to the bar — the same number as before the copy went',
        (level) => {
            const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
            const { container } = render(
                <SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />,
            );
            const meter = container.querySelector<HTMLElement>('.oj-meter')!;
            expect(meter).not.toBeNull();

            act(() => { levelWriter?.(new Map([[id, level]])); });

            expect(meter.style.getPropertyValue('--oj-meter-signal'))
                .toBe(meterScale(level).toFixed(3));
        },
    );

    it('keeps silence at the floor and a muted speaker silent', () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { isMuted: true });
        const { container } = render(
            <SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />,
        );
        const meter = container.querySelector<HTMLElement>('.oj-meter')!;

        act(() => { levelWriter?.(new Map([[id, 0]])); });
        expect(meter.style.getPropertyValue('--oj-meter-signal')).toBe('0.000');

        // Muted is silent on the bar too — the mute is the reading, not a filter
        // applied after it.
        act(() => { levelWriter?.(new Map([[id, 0.5]])); });
        expect(meter.style.getPropertyValue('--oj-meter-signal')).toBe('0.000');
    });
});
