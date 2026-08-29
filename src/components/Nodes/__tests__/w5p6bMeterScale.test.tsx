/**
 * W5-P6b — the two must-fixes from the P6 review.
 *
 *  1. M1 — the Microphone's and the Recorder's meters ride the SAME dB scale as
 *     the readouts beside them (the shared `meterScale`), not the raw linear
 *     level. A meter that disagrees with its own number is worse than no meter:
 *     a normal −34 dB input is 0.02 linear, an empty bar under a live readout.
 *  2. M2 — the shared refusal pulse starts immediately. `--motion-fast` is
 *     `<duration> <easing>`, so an explicit duration in front of it would slide
 *     the token's own 120ms into `animation-delay`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useAudioStore } from '../../../store/audioStore';
import { meterScale } from '../../Shell/masterSignal';

/** The shared frame writer, captured so a level can be pushed synchronously. */
let levelWriter: ((levels: ReadonlyMap<string, number>) => void) | null = null;

vi.mock('../../Arrangement/timelineSignalLevels', () => ({
    registerTimelineLevelWriter: (write: (levels: ReadonlyMap<string, number>) => void) => {
        levelWriter = write;
        return () => { levelWriter = null; };
    },
}));

const recorderStub = {
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    getRecordings: () => [],
    setOnRecordingComplete: vi.fn(),
    setOnRecordingDeleted: vi.fn(),
    setOnTimeUpdate: vi.fn(),
};

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        setMicrophoneInput: vi.fn(),
        subscribeSignalLevels: () => () => {},
        getRecorder: () => recorderStub,
    }),
}));

const { MicrophoneNode } = await import('../MicrophoneNode');
const { RecorderNode } = await import('../RecorderNode');

/** The canvas-supplied props the faceplate needs to render at all. */
const micProps = {
    hasConnection: () => false,
    handleHeaderMouseDown: () => {},
    handleNodeMouseEnter: () => {},
    handleNodeMouseLeave: () => {},
    isSelected: false,
    isDragging: false,
    isHoveredWithConnections: false,
    incomingConnectionCount: 0,
    style: {},
};

/** A level a performer actually plays at — and the empty bar it used to draw. */
const SAMPLE_LEVEL = 0.1;
const SCALED = meterScale(SAMPLE_LEVEL).toFixed(3); // '0.667', not '0.100'

function resetGraph() {
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
}

beforeEach(() => {
    resetGraph();
    levelWriter = null;
    useAudioStore.setState({ isAudioContextReady: true });
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            enumerateDevices: vi.fn().mockResolvedValue([
                { deviceId: 'mic-a', kind: 'audioinput', label: 'Built-in Mic', groupId: '' },
            ]),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        },
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('M1 — every meter is on the readout’s own dB scale', () => {
    it('Microphone: the meter is written with meterScale(level), never the raw linear level', () => {
        const id = useGraphStore.getState().addNode('microphone', { x: 0, y: 0 });
        const { container } = render(
            <MicrophoneNode node={useGraphStore.getState().nodes.get(id)!} {...micProps} />,
        );

        const meter = container.querySelector<HTMLElement>('.oj-meter')!;
        expect(meter).not.toBeNull();

        act(() => { levelWriter?.(new Map([[id, SAMPLE_LEVEL]])); });
        expect(meter.style.getPropertyValue('--oj-meter-signal')).toBe(SCALED);
        expect(meter.style.getPropertyValue('--oj-meter-signal')).not.toBe(SAMPLE_LEVEL.toFixed(3));

        // Silence stays silence — the scale has a floor, not an offset.
        act(() => { levelWriter?.(new Map([[id, 0]])); });
        expect(meter.style.getPropertyValue('--oj-meter-signal')).toBe('0.000');
    });

    it('Recorder: the armed meter is written with meterScale(level), never the raw linear level', () => {
        const id = useGraphStore.getState().addNode('recorder', { x: 0, y: 0 });
        const { container } = render(<RecorderNode node={useGraphStore.getState().nodes.get(id)!} />);

        const meter = container.querySelector<HTMLElement>('.oj-meter')!;
        expect(meter).not.toBeNull();

        // Idle, a recorder has nothing to report.
        act(() => { levelWriter?.(new Map([[id, SAMPLE_LEVEL]])); });
        expect(meter.style.getPropertyValue('--oj-meter-signal')).toBe('0.000');

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Record' })); });
        act(() => { levelWriter?.(new Map([[id, SAMPLE_LEVEL]])); });
        expect(meter.style.getPropertyValue('--oj-meter-signal')).toBe(SCALED);
        expect(meter.style.getPropertyValue('--oj-meter-signal')).not.toBe(SAMPLE_LEVEL.toFixed(3));
    });
});

describe('M2 — the refusal pulse starts the moment the refusal does', () => {
    // The stylesheet as it ships, read off disk — the assertion is about the
    // declaration a browser will parse, not about a mocked value.
    const css = readFileSync(
        resolve(process.cwd(), 'src/components/Nodes/SchematicBase.css'),
        'utf8',
    );

    /** The one shared refusal rule, as it ships. */
    const rule = css.slice(
        css.indexOf('.schematic-node.flashing'),
        css.indexOf('@keyframes oj-node-refuse'),
    );

    it('passes --motion-fast as the whole timing, with no duration in front of it', () => {
        expect(rule).toContain('oj-node-refuse');
        const animation = /animation:\s*([^;]+);/.exec(rule)?.[1].trim();
        expect(animation).toBe('oj-node-refuse var(--motion-fast) 2 alternate');
        // A second time value before/after the token would land in the delay slot.
        expect(/\d+m?s/.test(animation!.replace('var(--motion-fast)', ''))).toBe(false);
    });

    it('declares no animation-delay (or an explicit 0s)', () => {
        const delay = /animation-delay:\s*([^;]+);/.exec(rule)?.[1].trim();
        expect(delay === undefined || delay === '0s' || delay === '0ms').toBe(true);
    });

    it('takes its duration and easing from the motion token, not a literal', () => {
        expect(rule).toContain('var(--motion-fast)');
        expect(rule).not.toMatch(/animation-duration:\s*\d/);
        expect(rule).not.toMatch(/cubic-bezier/);
    });
});
