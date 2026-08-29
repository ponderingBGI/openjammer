/**
 * W5-P7 — the media faceplates: Looper, Sampler, SamplerVisual, Library.
 *
 * What the redesign is only allowed to claim if it is pinned here:
 *
 *  1. The port DOM contract survives the rebuild on `NodeShell` — every port
 *     these four types advertise is still findable at
 *     `[data-node-id][data-port-id]` AND is (or wraps) the shared `.oj-port`
 *     carrying `data-port-type`. Their sockets moved from bespoke absolute
 *     positions into the body, so this is the assertion that says the cables
 *     still land.
 *  2. The Looper's transport states are visibly distinct and engine-driven —
 *     idle / recording / playing each render a different button and a different
 *     header read, and the recording state is carried by a CLASS plus a word,
 *     never by colour alone.
 *  3. The Looper's live trace and level meter never re-render the node: a frame
 *     writes SVG attributes and a custom property, and nothing else.
 *  4. A Sampler pad is a real, keyboard-operable patch point: Enter on a pad
 *     starts a connection (it is not a decorative tile).
 *  5. The Library never calls a native `confirm()` (UI-021) — it asks in the
 *     card, in an `alertdialog`, and only acts when the answer is yes. And the
 *     selection stays on the LAST GOOD sample when a delivery fails (UI-020).
 *  6. The duration and note-name helpers each live in exactly one place.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useCanvasStore } from '../../../store/canvasStore';
import { useLibraryStore, type LibraryItem } from '../../../store/libraryStore';
import { LooperState } from '../../../../packages/oj-protocol-ts/src/index';

// ---- The two shared frames, captured so a level/frame can be pushed by hand --
let levelWriter: ((levels: ReadonlyMap<string, number>) => void) | null = null;
let frameWriter: (() => void) | null = null;

vi.mock('../../Arrangement/timelineSignalLevels', () => ({
    registerTimelineLevelWriter: (write: (levels: ReadonlyMap<string, number>) => void) => {
        levelWriter = write;
        return () => { levelWriter = null; };
    },
}));

vi.mock('../../Arrangement/sharedAnimationFrame', () => ({
    registerTimelineFrameWriter: (write: () => void) => {
        frameWriter = write;
        write();
        return () => { frameWriter = null; };
    },
}));

// ---- A looper handle that behaves like the engine one ----------------------
type WaveCb = (history: number[], playhead: number) => void;

class FakeLooper {
    state: LooperState = LooperState.IDLE;
    loops: { id: string; buffer: null; isMuted: boolean; waveformData: number[]; libraryItemId?: string }[] = [];
    onWave: WaveCb = () => {};
    startRecording = vi.fn(async () => { this.state = LooperState.RECORDING; });
    stopRecording = vi.fn(() => { this.state = LooperState.PLAYING; });
    toggleLoopMute = vi.fn((id: string) => {
        const l = this.loops.find((x) => x.id === id);
        if (l) l.isMuted = !l.isMuted;
    });
    deleteLoop = vi.fn((id: string) => {
        this.loops = this.loops.filter((x) => x.id !== id);
    });
    undoLast = vi.fn(() => { this.loops = this.loops.slice(0, -1); });
    addLoopFromBuffer = vi.fn();
    setDuration = vi.fn();
    setWet = vi.fn();
    getWet = () => 1;
    getDuration = () => 10;
    getLoops = () => this.loops;
    getEngineState = () => this.state;
    setOnLoopAdded = vi.fn();
    setOnLoopDeleted = vi.fn();
    setOnLoopUpdated = vi.fn();
    setOnWaveformHistoryUpdate = (cb: WaveCb) => { this.onWave = cb; };
    /** Drive one engine return frame, exactly like `onEngineFrame` does. */
    frame(history: number[], playhead: number, state: LooperState) {
        this.state = state;
        this.onWave(history, playhead);
    }
}

let looper: FakeLooper;
const samplerAdapter = {
    getBuffer: () => null,
    setBuffer: vi.fn(),
    setRootNote: vi.fn(),
    setGain: vi.fn(),
    setAttack: vi.fn(),
    setRelease: vi.fn(),
};

vi.mock('../../../audio/executor', async () => {
    const actual = await vi.importActual<typeof import('../../../audio/executor')>(
        '../../../audio/executor',
    );
    return {
        ...actual,
        getExecutor: () => ({
            getLooper: () => looper,
            getSamplerAdapter: () => samplerAdapter,
            waitForSamplerAdapter: async () => samplerAdapter,
            sendSampleBuffer: vi.fn(),
            subscribeSignalLevels: () => () => {},
        }),
    };
});

const { LooperNode } = await import('../LooperNode');
const { SamplerNode } = await import('../SamplerNode');
const { SamplerVisualNode } = await import('../SamplerVisualNode');
const { LibraryNode } = await import('../LibraryNode');
const { NodeWrapper } = await import('../NodeWrapper');
const { noteLabel } = await import('../../controls/noteNames');
const { formatSampleDuration } = await import('../../../utils/audioMetadata');

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
}

/** The shared props every schematic faceplate is handed by `NodeWrapper`. */
function faceProps(nodeId: string) {
    return {
        node: useGraphStore.getState().nodes.get(nodeId)!,
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
}

beforeEach(() => {
    resetGraph();
    looper = new FakeLooper();
    levelWriter = null;
    frameWriter = null;
    // The Looper only wires its engine callbacks once the context is ready.
    void import('../../../store/audioStore').then(({ useAudioStore }) => {
        useAudioStore.setState({ isAudioContextReady: true });
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The port DOM contract, restated for the four types this lane rebuilt
// ---------------------------------------------------------------------------

describe('P7 port contract', () => {
    it.each(['looper', 'sampler', 'sampler-visual', 'library'] as const)(
        '%s: every advertised port is the shared socket, inside the body',
        (type) => {
            const id = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
            const node = useGraphStore.getState().nodes.get(id)!;
            const { container } = render(<NodeWrapper node={node} />);

            expect(node.ports.length).toBeGreaterThan(0);
            for (const port of node.ports) {
                const marker = container.querySelector(
                    `[data-node-id="${CSS.escape(id)}"][data-port-id="${CSS.escape(port.id)}"]`,
                );
                expect(marker, `${type}: no marker for "${port.id}"`).not.toBeNull();
                const socket = marker!.classList.contains('oj-port')
                    ? marker
                    : marker!.querySelector('.oj-port');
                expect(socket, `${type}: "${port.id}" is not an .oj-port`).not.toBeNull();
                expect(marker!.getAttribute('data-port-type')).toBeTruthy();
            }
        },
    );

    it.each(['looper', 'sampler', 'sampler-visual', 'library'] as const)(
        '%s: renders exactly one NodeShell header and no legacy .schematic-header',
        (type) => {
            const id = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
            const { container } = render(
                <NodeWrapper node={useGraphStore.getState().nodes.get(id)!} />,
            );
            expect(container.querySelectorAll('.oj-node__header').length).toBe(1);
            expect(container.querySelectorAll('.schematic-header').length).toBe(0);
        },
    );
});

// ---------------------------------------------------------------------------
// 2 + 3. The Looper's transport, and the frame that never re-renders it
// ---------------------------------------------------------------------------

describe('Looper faceplate', () => {
    it('renders idle, recording and playing as three distinct states', () => {
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);

        // Idle: the button offers to record, and the header says nothing.
        const record = container.querySelector<HTMLButtonElement>('.looper-record')!;
        expect(record.textContent).toContain('Record');
        expect(record.getAttribute('aria-pressed')).toBe('false');
        expect(container.querySelector('.looper-state')).toBeNull();

        // Recording: the same button becomes Stop, the card and the button both
        // carry the state as a CLASS, and the header says the word.
        act(() => { looper.frame([0.2, 0.4], 12, LooperState.RECORDING); });
        expect(record.textContent).toContain('Stop');
        expect(record.getAttribute('aria-pressed')).toBe('true');
        expect(record.className).toContain('is-recording');
        expect(container.querySelector('.oj-node')!.className).toContain('is-recording');
        expect(container.querySelector('.looper-state')!.textContent).toBe('REC');

        // Overdubbing is its own word — the engine, not the UI, decides which.
        act(() => { looper.frame([0.2, 0.4], 40, LooperState.OVERDUBBING); });
        expect(container.querySelector('.looper-state')!.textContent).toBe('DUB');

        // Playing: back to an offer to record, with the loop rolling.
        act(() => { looper.frame([], 60, LooperState.PLAYING); });
        expect(record.className).not.toContain('is-recording');
        expect(container.querySelector('.looper-state')!.textContent).toBe('LOOP');
    });

    it('drives the engine, never a local guess, when record is pressed', async () => {
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        const record = container.querySelector<HTMLButtonElement>('.looper-record')!;

        await act(async () => { fireEvent.click(record); });
        expect(looper.startRecording).toHaveBeenCalledTimes(1);

        act(() => { looper.frame([0.1], 5, LooperState.RECORDING); });
        await act(async () => { fireEvent.click(record); });
        expect(looper.stopRecording).toHaveBeenCalledTimes(1);
    });

    it('paints the live trace and the meter from the shared frame, not from state', () => {
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);

        const trace = container.querySelector<SVGPolylineElement>('.looper-live__trace')!;
        const playhead = container.querySelector<SVGLineElement>('.looper-live__playhead')!;
        const meter = container.querySelector<HTMLElement>('.oj-meter')!;
        expect(trace.getAttribute('points')).toBe('');

        // A run of engine frames lands in refs; the shared frame turns the last
        // one into two attributes.
        act(() => {
            looper.frame([0, 0.5, 1], 10, LooperState.RECORDING);
            looper.frame([0, 0.5, 1], 50, LooperState.RECORDING);
            frameWriter?.();
        });
        expect(trace.getAttribute('points')!.length).toBeGreaterThan(0);
        expect(Number(playhead.getAttribute('x1'))).toBeCloseTo(500, 0);

        // The meter rides the same dB scale as every other meter in the app.
        act(() => { levelWriter?.(new Map([[id, 0.5]])); });
        const signal = Number(meter.style.getPropertyValue('--oj-meter-signal'));
        expect(signal).toBeGreaterThan(0.85);
        expect(signal).toBeLessThanOrEqual(1);
    });

    it('asks before it clears, in the card — and only then deletes every layer', () => {
        const nativeConfirm = vi.spyOn(window, 'confirm');
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 0.5, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        expect(container.querySelectorAll('.looper-layer').length).toBe(2);

        fireEvent.click(screen.getByRole('button', { name: 'Clear every layer' }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog.textContent).toContain('Delete all 2 layers?');
        expect(nativeConfirm).not.toHaveBeenCalled();
        expect(looper.deleteLoop).not.toHaveBeenCalled();

        // "Keep them" is a real answer: nothing happens.
        fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
        expect(looper.deleteLoop).not.toHaveBeenCalled();
        expect(container.querySelectorAll('.looper-layer').length).toBe(2);

        fireEvent.click(screen.getByRole('button', { name: 'Clear every layer' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
        expect(looper.deleteLoop).toHaveBeenCalledTimes(2);
        expect(container.querySelectorAll('.looper-layer').length).toBe(0);
        expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it('mutes a layer through the engine, and says so without relying on colour', () => {
        looper.loops = [{ id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] }];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        const mute = screen.getByRole('button', { name: 'Mute Loop 1' });
        expect(mute.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(mute);
        expect(looper.toggleLoopMute).toHaveBeenCalledWith('a');
        expect(container.querySelector('.looper-layer')!.className).toContain('is-muted');
        expect(screen.getByRole('button', { name: 'Unmute Loop 1' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('undoes the last layer through the engine UNDO_LAST, not the app history', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        fireEvent.click(screen.getByRole('button', { name: /Undo layer/ }));
        expect(looper.undoLast).toHaveBeenCalledTimes(1);
        expect(container.querySelectorAll('.looper-layer').length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// 4. The Sampler and its pads
// ---------------------------------------------------------------------------

describe('Sampler faceplate', () => {
    it('shows the empty slot as an invitation, and the root note in the shared note voice', () => {
        const id = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        const { container } = render(<SamplerNode {...faceProps(id)} />);

        expect(screen.getByRole('button', { name: /Load audio/ })).not.toBeNull();
        // No sample yet, so no root note and no clip card.
        expect(container.querySelector('.sampler-root')).toBeNull();

        act(() => {
            useGraphStore.getState().updateNodeData(id, {
                sampleName: 'kick.wav', sampleId: 'lib:1', duration: 0.4, waveformData: [0, 1, 0],
            });
        });
    });

    it('reads its root note from the ONE note-name helper', () => {
        const id = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, {
            sampleName: 'kick.wav', sampleId: 'lib:1', duration: 0.4, waveformData: [0, 0.8, 0],
        });
        const { container } = render(<SamplerNode {...faceProps(id)} />);

        const root = container.querySelector('.sampler-root')!;
        expect(root.textContent).toContain(noteLabel(60));
        expect(root.textContent).toContain('C4');
        // And the exact length reads in the ONE duration voice.
        expect(container.textContent).toContain(formatSampleDuration(0.4));
    });

    it('turns a bounded parameter into a keyboard-operable dial that writes node.data', () => {
        const id = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        render(<SamplerNode {...faceProps(id)} />);

        const gain = screen.getByRole('slider', { name: /GAIN/i });
        fireEvent.keyDown(gain, { key: 'ArrowDown' });
        const after = useGraphStore.getState().nodes.get(id)!.data as { gain: number };
        expect(after.gain).toBeLessThan(1);
    });
});

describe('SamplerVisual pads', () => {
    function withRow(nodeId: string, parentId: string) {
        useGraphStore.getState().updateNodeData(parentId, {
            rows: [{
                rowId: 'row-1',
                label: 'Keys',
                portCount: 4,
                gain: 1,
                spread: 1,
                sourceNodeId: 'kbd',
                sourcePortId: 'row-1',
                targetPortId: 'bundle-in',
            }],
        });
        return useGraphStore.getState().nodes.get(nodeId)!;
    }

    it('draws one KeyTile pad per key port, each carrying the shared socket', () => {
        const parentId = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        const visualId = useGraphStore.getState().addNode('sampler-visual', { x: 0, y: 0 });
        useGraphStore.setState((s) => {
            const nodes = new Map(s.nodes);
            nodes.set(visualId, { ...nodes.get(visualId)!, parentId });
            return { nodes };
        });
        withRow(visualId, parentId);

        const { container } = render(
            <SamplerVisualNode {...faceProps(visualId)} node={useGraphStore.getState().nodes.get(visualId)!} />,
        );
        const pads = container.querySelectorAll('.oj-key-tile--pad');
        expect(pads.length).toBe(4);
        for (const pad of pads) {
            expect(pad.querySelector('.oj-port[data-port-type="control"]')).not.toBeNull();
        }
    });

    it('a pad HIT starts a connection from that key — it is a real patch point', () => {
        const parentId = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        const visualId = useGraphStore.getState().addNode('sampler-visual', { x: 0, y: 0 });
        useGraphStore.setState((s) => {
            const nodes = new Map(s.nodes);
            nodes.set(visualId, { ...nodes.get(visualId)!, parentId });
            return { nodes };
        });
        withRow(visualId, parentId);

        const hits: string[] = [];
        const { container } = render(
            <SamplerVisualNode
                {...faceProps(visualId)}
                node={useGraphStore.getState().nodes.get(visualId)!}
                handlePortMouseDown={(portId) => hits.push(portId)}
            />,
        );

        const pads = container.querySelectorAll<HTMLButtonElement>('.oj-key-tile--pad');
        fireEvent.mouseDown(pads[2]);
        expect(hits).toEqual(['row-1-key-2']);

        // And from the keyboard, which is the half a mouse-only pad would lose.
        fireEvent.keyDown(pads[0], { key: 'Enter' });
        expect(hits).toEqual(['row-1-key-2', 'row-1-key-0']);
    });
});

// ---------------------------------------------------------------------------
// 5. The Library: no native dialog, and a selection that never moves on failure
// ---------------------------------------------------------------------------

function item(over: Partial<LibraryItem> = {}): LibraryItem {
    return {
        id: 'i1',
        fileName: 'clap.wav',
        relativePath: 'drums/clap.wav',
        libraryId: 'lib',
        duration: 1.5,
        sampleRate: 48000,
        channels: 1,
        fileSize: 1024,
        lastModified: 0,
        tags: [],
        status: 'available',
        ...over,
    } as LibraryItem;
}

function seedLibrary(items: LibraryItem[], tags: string[] = []) {
    useLibraryStore.setState({
        libraries: {
            lib: {
                id: 'lib',
                name: 'Drums',
                rootHandleKey: 'k',
                itemCount: items.length,
                lastScanAt: 1,
                status: 'ready',
            } as never,
        },
        items: Object.fromEntries(items.map((i) => [i.id, i])),
        allTags: tags,
        pinnedTags: [],
        activeFilterTag: null,
        scanProgress: null,
        projectLibraryId: null,
    });
}

describe('Library faceplate', () => {
    it('asks before a permanent delete IN the card — never with a native confirm', async () => {
        const nativeConfirm = vi.spyOn(window, 'confirm');
        const permanentlyDeleteItem = vi.fn().mockResolvedValue(undefined);
        seedLibrary([item({ tags: ['trash'] })]);
        useLibraryStore.setState({ permanentlyDeleteItem });

        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        render(<LibraryNode {...faceProps(id)} />);
        // The card clears the tag filter when its library resolves, so ask for
        // the trash AFTER mount — the way a player does.
        act(() => { useLibraryStore.getState().setActiveFilterTag('trash'); });

        fireEvent.click(screen.getByRole('button', { name: /Permanently delete clap\.wav/ }));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog.textContent).toContain('Permanently delete "clap.wav"?');
        expect(nativeConfirm).not.toHaveBeenCalled();
        expect(permanentlyDeleteItem).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(permanentlyDeleteItem).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Permanently delete clap\.wav/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        });
        expect(permanentlyDeleteItem).toHaveBeenCalledWith('i1');
        expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it('asks before deleting a tag, and says what it costs', () => {
        const deleteTag = vi.fn();
        seedLibrary([item()], ['drums']);
        useLibraryStore.setState({ deleteTag });

        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        render(<LibraryNode {...faceProps(id)} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete tag drums' }));
        expect(screen.getByRole('alertdialog').textContent).toContain('Delete the tag "drums"?');
        expect(deleteTag).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(deleteTag).toHaveBeenCalledWith('drums');
    });

    it('keeps the LAST GOOD selection when a sample fails to arrive (UI-020)', async () => {
        seedLibrary([item({ id: 'good', fileName: 'good.wav' }), item({ id: 'bad', fileName: 'bad.wav' })]);

        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib', currentItemId: 'good' });
        render(<LibraryNode {...faceProps(id)} />);

        // `getSampleFile` resolves to null in this environment (no IndexedDB
        // handle), which is exactly the "the file went away" path.
        await act(async () => {
            fireEvent.click(screen.getByText('bad.wav'));
        });

        const after = useGraphStore.getState().nodes.get(id)!.data as { currentItemId?: string };
        expect(after.currentItemId).toBe('good');
    });

    it('offers the empty state as one primary action, not a bare button', () => {
        useLibraryStore.setState({ libraries: {}, items: {}, allTags: [], pinnedTags: [], projectLibraryId: null });
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        const { container } = render(<LibraryNode {...faceProps(id)} />);

        expect(container.querySelector('.oj-callout')).not.toBeNull();
        expect(screen.getByRole('button', { name: /Link a folder/ }).className).toContain('oj-btn--primary');
    });
});

// ---------------------------------------------------------------------------
// 6. One helper each
// ---------------------------------------------------------------------------

describe('shared helpers', () => {
    it('the sample-length voice is one function, imported by everyone who speaks it', async () => {
        expect(formatSampleDuration(0.42)).toBe('0.4s');
        expect(formatSampleDuration(3.2)).toBe('3s');
        expect(formatSampleDuration(0)).toBe('0s');

        const sources = await Promise.all(
            [
                '../../Clips/AudioClipVisual.tsx',
                '../SamplerNode.tsx',
                '../LibraryNode.tsx',
                '../LooperNode.tsx',
            ].map(async (rel) => {
                const fs = await import('node:fs/promises');
                const path = await import('node:path');
                return fs.readFile(path.resolve(__dirname, rel), 'utf8');
            }),
        );
        for (const src of sources) {
            expect(src).toContain('formatSampleDuration');
            // Nobody keeps a private copy any more.
            expect(src).not.toMatch(/function formatDuration/);
        }
    });

    it('the note-name voice is one function too', async () => {
        expect(noteLabel(60)).toBe('C4');
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const src = await fs.readFile(path.resolve(__dirname, '../SamplerNode.tsx'), 'utf8');
        expect(src).toContain("from '../controls/noteNames'");
        expect(src).not.toMatch(/const NOTE_NAMES/);
        expect(src).not.toMatch(/function midiToNoteName/);
    });
});
