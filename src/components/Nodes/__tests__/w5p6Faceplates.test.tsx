/**
 * W5-P6 — the utility / IO faceplates.
 *
 * Four things the redesign is only allowed to claim if they are pinned:
 *  1. The Speaker's meter and dB readout are DOM writes, not React state.
 *  2. Both device pickers are reachable and operable from the keyboard.
 *  3. Renaming a panel port is ONE undo step — the visible name and the
 *     `portLabels` metadata revert together (UI-032).
 *  4. A refused action draws the shared feedback class AND says why in an
 *     aria-live region (UI-029). Colour is never the only carrier.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useCanvasStore } from '../../../store/canvasStore';
import { useUIFeedbackStore } from '../../../store/uiFeedbackStore';
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
        setMicrophoneInput: vi.fn(),
        subscribeSignalLevels: () => () => {},
    }),
}));

const { SpeakerNode } = await import('../SpeakerNode');
const { MicrophoneNode } = await import('../MicrophoneNode');
const { OutputPanelNode } = await import('../OutputPanelNode');
const { MathNode } = await import('../MathNode');

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
    useHistoryStore.getState().clear();
    useCanvasStore.setState({
        isConnecting: false,
        connectingFrom: null,
        pendingDisconnect: null,
        hoverTarget: null,
    });
    useUIFeedbackStore.setState({ flashingNodes: new Set() });
}

beforeEach(() => {
    resetGraph();
    levelWriter = null;
    Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
            enumerateDevices: vi.fn().mockResolvedValue([
                { deviceId: 'default', kind: 'audiooutput', label: 'Default Output', groupId: '' },
                { deviceId: 'iface', kind: 'audiooutput', label: 'Focusrite Scarlett', groupId: '' },
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

describe('Speaker faceplate', () => {
    it('writes the level to a custom property and the dB readout to a text node — never to state', () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        const { container } = render(<SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />);

        const meter = container.querySelector<HTMLElement>('.oj-meter')!;
        const readout = container.querySelector<HTMLElement>('.speaker-db')!;
        expect(meter).not.toBeNull();
        expect(readout.textContent).toContain('dB');

        // A level arrives on the shared frame. Nothing re-renders; the DOM moves.
        act(() => { levelWriter?.(new Map([[id, 0.5]])); });
        const signal = Number(meter.style.getPropertyValue('--oj-meter-signal'));
        expect(signal).toBeGreaterThan(0.85);
        expect(signal).toBeLessThanOrEqual(1);
        expect(readout.textContent).toBe('-6.0 dB');

        // Silence reads as silence, not as "0.0".
        act(() => { levelWriter?.(new Map([[id, 0]])); });
        expect(Number(meter.style.getPropertyValue('--oj-meter-signal'))).toBe(0);
        expect(readout.textContent).toBe('-∞ dB');
    });

    it('exposes the LEVEL knob as a keyboard slider and the output route as a listbox', async () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        render(<SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />);

        const knob = screen.getByRole('slider', { name: 'LEVEL' });
        expect(knob).toHaveProperty('tabIndex', 0);
        act(() => { fireEvent.keyDown(knob, { key: 'ArrowDown' }); });
        expect((useGraphStore.getState().nodes.get(id)!.data as { volume: number }).volume).toBeLessThan(1);

        const trigger = await screen.findByRole('combobox', { name: 'Speaker output device' });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); });
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(await screen.findByRole('listbox', { name: 'Speaker output device' })).not.toBeNull();
    });

    it('mute is one reversible step and silences the meter', () => {
        const id = useGraphStore.getState().addNode('speaker', { x: 0, y: 0 });
        const { container, rerender } = render(<SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />);

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Mute speaker' })); });
        expect((useGraphStore.getState().nodes.get(id)!.data as { isMuted: boolean }).isMuted).toBe(true);

        rerender(<SpeakerNode node={useGraphStore.getState().nodes.get(id)!} />);
        act(() => { levelWriter?.(new Map([[id, 0.9]])); });
        const meter = container.querySelector<HTMLElement>('.oj-meter')!;
        expect(Number(meter.style.getPropertyValue('--oj-meter-signal'))).toBe(0);

        act(() => { useHistoryStore.getState().undo(); });
        expect((useGraphStore.getState().nodes.get(id)!.data as { isMuted?: boolean }).isMuted).toBe(false);
    });
});

describe('Microphone faceplate', () => {
    it('offers its input route as a keyboard-operable listbox', async () => {
        const id = useGraphStore.getState().addNode('microphone', { x: 0, y: 0 });
        render(
            <MicrophoneNode
                node={useGraphStore.getState().nodes.get(id)!}
                hasConnection={() => false}
                handleHeaderMouseDown={() => {}}
                handleNodeMouseEnter={() => {}}
                handleNodeMouseLeave={() => {}}
                isSelected={false}
                isDragging={false}
                isHoveredWithConnections={false}
                incomingConnectionCount={0}
                style={{}}
            />,
        );

        const trigger = await screen.findByRole('combobox', { name: 'Microphone input device' });
        act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); });
        expect(await screen.findByRole('listbox', { name: 'Microphone input device' })).not.toBeNull();
        act(() => { fireEvent.keyDown(trigger, { key: 'Escape' }); });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('drives its meter from the shared frame, and reads zero while muted', () => {
        const id = useGraphStore.getState().addNode('microphone', { x: 0, y: 0 });
        const props = {
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
        const { container, rerender } = render(
            <MicrophoneNode node={useGraphStore.getState().nodes.get(id)!} {...props} />,
        );
        const meter = container.querySelector<HTMLElement>('.oj-meter')!;

        // On the readout's own dB scale (`meterScale`), not the raw linear level
        // — see `w5p6bMeterScale.test.tsx` for the pin.
        act(() => { levelWriter?.(new Map([[id, 0.6]])); });
        expect(Number(meter.style.getPropertyValue('--oj-meter-signal'))).toBeCloseTo(meterScale(0.6), 3);

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' })); });
        rerender(<MicrophoneNode node={useGraphStore.getState().nodes.get(id)!} {...props} />);
        act(() => { levelWriter?.(new Map([[id, 0.6]])); });
        expect(Number(meter.style.getPropertyValue('--oj-meter-signal'))).toBe(0);
    });
});

describe('Port panel', () => {
    it('renames a port as ONE undo step — name and metadata revert together', () => {
        const graph = useGraphStore.getState();
        const id = graph.addNode('output-panel', { x: 0, y: 0 });
        // The OUTPUTS panel ships four named rows; rename the first.
        const port = useGraphStore.getState().nodes.get(id)!.ports.find((p) => p.direction === 'input')!;

        act(() => {
            useGraphStore.getState().beginGesture();
            useGraphStore.getState().renamePort(id, port.id, 'Sustain');
            useGraphStore.getState().endGesture();
        });

        const renamed = useGraphStore.getState().nodes.get(id)!;
        expect(renamed.ports.find((p) => p.id === port.id)!.name).toBe('Sustain');
        expect((renamed.data.portLabels as Record<string, string>)[port.id]).toBe('Sustain');

        act(() => { useHistoryStore.getState().undo(); });

        const reverted = useGraphStore.getState().nodes.get(id)!;
        expect(reverted.ports.find((p) => p.id === port.id)!.name).toBe(port.name);
        expect((reverted.data.portLabels as Record<string, string>)[port.id]).toBe(port.name);
    });

    it('renames through the panel UI in one gesture', () => {
        const graph = useGraphStore.getState();
        const id = graph.addNode('output-panel', { x: 0, y: 0 });
        render(<OutputPanelNode node={useGraphStore.getState().nodes.get(id)!} />);

        // The row's name rests as an EditableLabel; double-click opens the field.
        act(() => { fireEvent.doubleClick(screen.getByText('Pedal')); });
        const input = screen.getByRole('textbox');
        act(() => { fireEvent.change(input, { target: { value: 'Pedal A' } }); });
        act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });

        const node = useGraphStore.getState().nodes.get(id)!;
        expect(node.ports.some((p) => p.name === 'Pedal A')).toBe(true);

        act(() => { useHistoryStore.getState().undo(); });
        expect(useGraphStore.getState().nodes.get(id)!.ports.some((p) => p.name === 'Pedal A')).toBe(false);
    });

    it('starts a connection from a socket with the keyboard', () => {
        const graph = useGraphStore.getState();
        const id = graph.addNode('output-panel', { x: 0, y: 0 });
        const port = useGraphStore.getState().nodes.get(id)!.ports[0];
        const started: string[] = [];

        const { container } = render(
            <OutputPanelNode
                node={useGraphStore.getState().nodes.get(id)!}
                handlePortMouseDown={(portId) => started.push(portId)}
            />,
        );

        const socket = container.querySelector<HTMLElement>(`[data-port-id="${port.id}"]`)!;
        act(() => { fireEvent.keyDown(socket, { key: 'Enter' }); });
        expect(started).toContain(port.id);
    });
});

describe('Refusal feedback', () => {
    it('draws the shared class and says why in an aria-live region', () => {
        const id = useGraphStore.getState().addNode('add', { x: 0, y: 0 });
        const node = useGraphStore.getState().nodes.get(id)!;

        const { container, rerender } = render(<MathNode node={node} />);
        const card = container.querySelector('.math-node')!;
        const live = container.querySelector('[aria-live="polite"]')!;
        expect(card.classList.contains('deletion-attempted')).toBe(false);
        expect(live.textContent).toBe('');

        act(() => { useUIFeedbackStore.getState().flashNode(id); });
        rerender(<MathNode node={node} />);

        expect(container.querySelector('.math-node')!.classList.contains('deletion-attempted')).toBe(true);
        expect(container.querySelector('[aria-live="polite"]')!.textContent).toMatch(/cannot be entered/i);
    });

    it('flips the operation with the segmented control, keeping every socket', () => {
        const id = useGraphStore.getState().addNode('add', { x: 0, y: 0 });
        const before = useGraphStore.getState().nodes.get(id)!;
        const { rerender } = render(<MathNode node={before} />);

        act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Subtract' })); });
        const after = useGraphStore.getState().nodes.get(id)!;
        expect(after.type).toBe('subtract');
        expect(after.ports.map((p) => p.id)).toEqual(before.ports.map((p) => p.id));

        rerender(<MathNode node={after} />);
        act(() => { useHistoryStore.getState().undo(); });
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('add');
    });
});
