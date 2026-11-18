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
    /** The real handle reports every removal on the SAME synchronous call
     *  (`ojcoreHandles.ts` → `this.onLoopDeleted?.(removed)`), and the card's
     *  callback commits a layer-metadata step when it does. A double that stays
     *  quiet here is a double that cannot see how many undo entries a removal
     *  actually costs — which is exactly how W5-P7b shipped an N-entry
     *  "clear every layer". */
    deleteLoop = vi.fn((id: string) => {
        const removed = this.loops.find((x) => x.id === id);
        this.loops = this.loops.filter((x) => x.id !== id);
        if (removed) this.onDeleted(removed);
    });
    undoLast = vi.fn(() => {
        const removed = this.loops[this.loops.length - 1];
        this.loops = this.loops.slice(0, -1);
        if (removed) this.onDeleted(removed);
    });
    addLoopFromBuffer = vi.fn();
    setDuration = vi.fn();
    setWet = vi.fn();
    getWet = () => 1;
    getDuration = () => 10;
    getLoops = () => this.loops;
    getEngineState = () => this.state;
    onAdded: (loop: unknown) => void = () => {};
    onDeleted: (loop: unknown) => void = () => {};
    setOnLoopAdded = vi.fn((cb: (loop: never) => void) => { this.onAdded = cb as (loop: unknown) => void; });
    setOnLoopDeleted = vi.fn((cb: (loop: never) => void) => { this.onDeleted = cb as (loop: unknown) => void; });
    setOnLoopUpdated = vi.fn();
    /** Commit a pass the way the engine does: append the layer, then report it. */
    commit(id: string) {
        const layer = { id, buffer: null, isMuted: false, waveformData: [0, 0.6, 0] };
        this.loops = [...this.loops, layer];
        this.state = LooperState.PLAYING;
        this.onAdded(layer);
    }
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

/** The Looper as the canvas mounts it: SUBSCRIBED, so a `node.data` write —
 *  from a click or from `Ctrl+Z` — reaches the card and its reconciler. */
function LiveLooper({ id }: { id: string }) {
    const node = useGraphStore((s) => s.nodes.get(id));
    if (!node) return null;
    return <LooperNode {...faceProps(id)} node={node} />;
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
        // "PLAY", not "LOOP": the header already carries the TYPE chip "LOOP",
        // and a card that says the same word twice says nothing twice.
        expect(container.querySelector('.looper-state')!.textContent).toBe('PLAY');
        expect(container.querySelector('.oj-node__type')!.textContent).not.toBe(
            container.querySelector('.looper-state')!.textContent,
        );
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
        // W5-P7b: mute is written to `node.data.layers` and RECONCILED onto the
        // engine, so the card has to be mounted the way the canvas mounts it —
        // subscribed to the store — for the SET_MUTE to reach the handle. That
        // one-way flow is what makes an undone mute really un-mute the audio.
        const { container } = render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        const mute = screen.getByRole('button', { name: 'Mute Loop 1' });
        expect(mute.getAttribute('aria-pressed')).toBe('false');
        act(() => { fireEvent.click(mute); });
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
        const { container } = render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        // W5-P7b: the take it removes cannot be brought back (the kernel owns the
        // PCM and the wire has no ADD_LAYER), so like the other two removals it
        // asks first — in the card, never a native dialog.
        act(() => { fireEvent.click(screen.getByRole('button', { name: /Undo layer/ })); });
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Take it off' })); });
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

// ---------------------------------------------------------------------------
// 7. The confirm actually TAKES the keyboard (the other half of UI-021)
//
// Refusing `confirm()` only helps if what replaces it behaves like a dialog.
// An `alertdialog` nobody is focused on announces into nothing and leaves Tab
// walking the card behind it — the native bug with better paint. The app has
// one rule and one place that keeps it (`Shell/confirmFocus`): the SAFE answer
// takes focus on open, Escape is an answer, and focus goes back to something
// real on close — never to the document body.
// ---------------------------------------------------------------------------

describe('in-card confirms take the keyboard', () => {
    it('Looper: clear-all focuses the safe answer, Escape closes it, focus comes back', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LooperNode {...faceProps(id)} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        const clear = screen.getByRole('button', { name: 'Clear every layer' });
        act(() => { clear.focus(); });
        fireEvent.click(clear);

        const keep = screen.getByRole('button', { name: 'Keep them' });
        expect(document.activeElement).toBe(keep);
        // The destructive answer is never the focused one.
        expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Delete all' }));

        fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(looper.deleteLoop).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Clear every layer' }),
        );
    });

    it('Looper: a layer delete focuses "Keep", and lands back on that same row', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        fireEvent.click(screen.getByRole('button', { name: 'Delete Loop 2' }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));

        fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
        expect(looper.deleteLoop).not.toHaveBeenCalled();
        // Answering re-renders the row's actions, so `activeElement` can only be
        // right if the restore ran — and it has to be THIS row, not row one.
        const row = container.querySelector('[data-loop-id="b"]')!;
        expect(row.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete Loop 2' }));
    });

    it('Library: the question is focused on open and Escape is a real answer', () => {
        const deleteTag = vi.fn();
        seedLibrary([item()], ['drums']);
        useLibraryStore.setState({ deleteTag });

        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        render(<LibraryNode {...faceProps(id)} />);

        const trigger = screen.getByRole('button', { name: 'Delete tag drums' });
        act(() => { trigger.focus(); });
        fireEvent.click(trigger);

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }));

        fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(deleteTag).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete tag drums' }));
    });
});

// ---------------------------------------------------------------------------
// 8. The four stylesheets, held to the DESIGN.md floors a screenshot cannot
//    catch and a reviewer only notices by re-reading the whole file.
// ---------------------------------------------------------------------------

describe('P7 stylesheet floors', () => {
    // `_sockets.css` is edited by this lane too, so it is held to the same
    // floors — the P7 gate caught it sitting outside the list while carrying
    // four orphan blocks (W5-P7b deleted them; the gate keeps it honest).
    const SHEETS = [
        'LooperNode.css',
        'SamplerNode.css',
        'SamplerVisual.css',
        'LibraryNode.css',
        '_sockets.css',
    ];

    /** The 11px and 9.5px steps are the MONO voice (DESIGN.md §3, "The 13px
     *  Floor"). A sans run at either size is a bug. A block earns an exemption
     *  by declaring the mono face — or by being on this list, with a reason. */
    const MONO_BY_INHERITANCE = new Set([
        // `EditableLabel mono` puts `--font-mono` on this element itself.
        '.looper-layer__name .oj-editable-label__text',
    ]);

    async function read(name: string) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        return fs.readFile(path.resolve(__dirname, '..', name), 'utf8');
    }

    /** Rule blocks as `{ selector, body }`, comments stripped. */
    function blocks(css: string) {
        const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
        return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
            selector: m[1].trim().replace(/\s+/g, ' '),
            body: m[2],
        }));
    }

    it.each(SHEETS)('%s: no sans run below the 13px floor', async (name) => {
        for (const rule of blocks(await read(name))) {
            if (!/font-size:\s*var\(--text-(xs|micro)\)/.test(rule.body)) continue;
            const isMono =
                /font-family:\s*var\(--font-mono\)/.test(rule.body) ||
                rule.selector.split(',').every((s) => MONO_BY_INHERITANCE.has(s.trim()));
            expect(
                isMono,
                `${name}: "${rule.selector}" sets 11px/9.5px without the mono face`,
            ).toBe(true);
        }
    });

    it.each(SHEETS)('%s: no literal colour, no glow, no bespoke reduced-motion block', async (name) => {
        const css = await read(name);
        expect(css, 'a literal colour is a bug — every value is a token').not.toMatch(
            /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/,
        );
        expect(css, 'only a live cable or meter may glow').not.toMatch(/drop-shadow|filter\s*:/);
        expect(css, 'global.css owns the blanket reduced-motion rule').not.toContain(
            'prefers-reduced-motion',
        );
    });

    it.each(SHEETS)('%s: mixes in oklab, like the other 80 rules in the app', async (name) => {
        expect(await read(name)).not.toContain('color-mix(in srgb');
    });
});

// ---------------------------------------------------------------------------
// 9. W5-P7b — one gesture, one Ctrl+Z, and never the card.
//
// The P7 gate measured the worst outcome in the wave: no Looper action and no
// Library action reached the undo stack, so `Ctrl+Z` after one of them replayed
// the last GRAPH entry — which on a fresh canvas is still "add this node" — and
// the whole card left the screen with every take on it. These tests fail on the
// pre-P7b code for exactly that reason: the node count goes to zero.
// ---------------------------------------------------------------------------

/** `addNode` also builds a card's internal panel children, so a Looper is more
 *  than one entry. The question these tests ask is "did the card survive", so
 *  they pin the whole map size and the card itself. */
const nodeCount = () => useGraphStore.getState().nodes.size;
const layersOf = (id: string) =>
    ((useGraphStore.getState().nodes.get(id)?.data as { layers?: { id: string; isMuted: boolean; name: string }[] })
        ?.layers) ?? [];

describe('P7b — Looper actions are undoable, and never eat the node', () => {
    it('mute -> Ctrl+Z un-mutes the AUDIO, not just the row, and the node stays', () => {
        looper.loops = [{ id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] }];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });
        const cards = nodeCount();

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Mute Loop 1' })); });
        expect(looper.loops[0]!.isMuted).toBe(true);
        expect(layersOf(id)[0]!.isMuted).toBe(true);

        act(() => { useHistoryStore.getState().undo(); });
        // The engine really moved back — this is a SET_MUTE on the handle, not a
        // repaint — and the card is still on the canvas.
        expect(looper.loops[0]!.isMuted).toBe(false);
        expect(nodeCount()).toBe(cards);
        expect(screen.getByRole('button', { name: 'Mute Loop 1' })).toBeTruthy();
    });

    it('mute is ONE step: a second Ctrl+Z is needed before the node is reachable', () => {
        looper.loops = [{ id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] }];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        const before = useHistoryStore.getState().entries.length;
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Mute Loop 1' })); });
        expect(useHistoryStore.getState().entries.length).toBe(before + 1);
    });

    it('silence-every-layer is one press and therefore one step', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        const before = useHistoryStore.getState().entries.length;
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Silence every layer' })); });
        expect(useHistoryStore.getState().entries.length).toBe(before + 1);
        expect(looper.loops.every((l) => l.isMuted)).toBe(true);

        act(() => { useHistoryStore.getState().undo(); });
        expect(looper.loops.every((l) => !l.isMuted)).toBe(true);
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('looper');
    });

    it('a layer rename is undoable, and it is the name the export lands under', () => {
        looper.loops = [{ id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] }];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        const label = container.querySelector<HTMLElement>('.looper-layer__name .oj-editable-label__text')!;
        act(() => { fireEvent.doubleClick(label); });
        const input = container.querySelector<HTMLInputElement>('.looper-layer__name input')!;
        act(() => {
            fireEvent.change(input, { target: { value: 'Bassline' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        expect(layersOf(id)[0]!.name).toBe('Bassline');

        act(() => { useHistoryStore.getState().undo(); });
        expect(layersOf(id)[0]?.name ?? 'Loop 1').toBe('Loop 1');
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('looper');
    });

    it('deleting a layer costs ONE Ctrl+Z — the card and the other takes survive', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });
        const cards = nodeCount();

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete Loop 2' })); });
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
        expect(looper.loops.map((l) => l.id)).toEqual(['a']);

        // The step is the layer's METADATA, so undo consumes it and stops there.
        // The kernel owns the take's PCM and `ojproto::looper_action` has no
        // ADD_LAYER, so the take itself does not come back — but the card does
        // not vanish either, which is what used to happen here.
        act(() => { useHistoryStore.getState().undo(); });
        expect(nodeCount()).toBe(cards);
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('looper');
    });

    it('every removal asks first — delete, clear all AND take-the-last-off', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        // W5-P7 fired UNDO_LAST straight off the click. It destroys a take that
        // cannot be restored, so it is confirm-gated like the other two now.
        act(() => { fireEvent.click(screen.getByRole('button', { name: /Undo layer/ })); });
        expect(looper.undoLast).not.toHaveBeenCalled();
        const dialog = screen.getByRole('alertdialog', { name: 'Take the last layer back off' });
        expect(dialog).toBeTruthy();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }));

        act(() => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
        expect(looper.undoLast).not.toHaveBeenCalled();
        expect(looper.loops.length).toBe(2);
    });

    it('a committed take is its own step — Ctrl+Z after recording never deletes the card', () => {
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.IDLE); });
        const cards = nodeCount();

        act(() => { looper.commit('take-1'); });
        expect(layersOf(id).map((l) => l.id)).toEqual(['take-1']);

        act(() => { useHistoryStore.getState().undo(); });
        expect(nodeCount()).toBe(cards);
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('looper');
    });
});

describe('P7b — Library actions are undoable, and never eat the card', () => {
    // Section 7 swaps a spy in for `deleteTag`; these tests drive the REAL store
    // actions, so they put the real one back first.
    const realDeleteTag = useLibraryStore.getState().deleteTag;
    beforeEach(() => { useLibraryStore.setState({ deleteTag: realDeleteTag }); });

    function renderLibrary() {
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        render(<LibraryNode {...faceProps(id)} />);
        return id;
    }

    it('rename -> Ctrl+Z puts the old name back, and the card stays', () => {
        seedLibrary([item()]);
        const id = renderLibrary();
        const cards = nodeCount();

        act(() => { fireEvent.doubleClick(screen.getByText('clap.wav')); });
        const input = screen.getByLabelText('File name') as HTMLInputElement;
        act(() => {
            fireEvent.change(input, { target: { value: 'kick' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        expect(useLibraryStore.getState().items.i1!.fileName).toBe('kick.wav');

        act(() => { useHistoryStore.getState().undo(); });
        expect(useLibraryStore.getState().items.i1!.fileName).toBe('clap.wav');
        expect(nodeCount()).toBe(cards);
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('library');
    });

    it('trash -> Ctrl+Z brings the row back out of the trash', () => {
        seedLibrary([item()]);
        const id = renderLibrary();

        act(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Move clap.wav to trash' }));
        });
        expect(useLibraryStore.getState().items.i1!.tags).toContain('trash');

        act(() => { useHistoryStore.getState().undo(); });
        expect(useLibraryStore.getState().items.i1!.tags).not.toContain('trash');
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('library');
    });

    it('taking a tag off a file is a labelled control, works from the keyboard, and undoes', () => {
        seedLibrary([item({ tags: ['drums'] })], ['drums']);
        const id = renderLibrary();

        // M2: a real control with an accessible name — not a tooltip-only
        // double-click on a Chip whose own Enter/Space is spent on filtering.
        const remove = screen.getByRole('button', { name: 'Remove drums tag' });
        act(() => { fireEvent.keyDown(remove, { key: 'Enter' }); });
        expect(useLibraryStore.getState().items.i1!.tags).not.toContain('drums');

        act(() => { useHistoryStore.getState().undo(); });
        expect(useLibraryStore.getState().items.i1!.tags).toContain('drums');
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('library');
    });

    it('deleting a tag comes back — the files were never touched', async () => {
        seedLibrary([item({ tags: ['drums'] })], ['drums']);
        const id = renderLibrary();

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete tag drums' })); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
        expect(useLibraryStore.getState().allTags).not.toContain('drums');
        expect(useLibraryStore.getState().items.i1!.tags).not.toContain('drums');

        act(() => { useHistoryStore.getState().undo(); });
        expect(useLibraryStore.getState().allTags).toContain('drums');
        expect(useLibraryStore.getState().items.i1!.tags).toContain('drums');
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('library');
    });
});

// ---------------------------------------------------------------------------
// 10. W5-P7b — the gate's three blocking findings and the lane follow-ups.
// ---------------------------------------------------------------------------

describe('P7b — M1: a tag hue is identity, never a contrast ground', () => {
    async function css() {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        return fs.readFile(path.resolve(__dirname, '..', 'LibraryNode.css'), 'utf8');
    }

    /** Rule blocks as `{ selector, body }`, comments stripped. */
    function blocks(text: string) {
        const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
        return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
            selector: m[1]!.trim().replace(/\s+/g, ' '),
            body: m[2]!,
        }));
    }

    it('no chip anywhere sits on a --tag-color ground', async () => {
        for (const rule of blocks(await css())) {
            if (!/chip|__tag\b/.test(rule.selector)) continue;
            expect(
                /background[^;]*--tag-color/.test(rule.body),
                `"${rule.selector}" grounds text on an hsl(hash(user text)) wash, `
                    + 'which cannot be proven AA for an arbitrary tag name',
            ).toBe(false);
        }
    });

    it('the hue is still spent where it costs nothing: the left-panel dot', async () => {
        expect(await css()).toMatch(/\.library-tag__dot[\s\S]*?background:\s*var\(--tag-color\)/);
    });
});

describe('P7b — M3: a row the marquee caught announces itself', () => {
    it('is-multi-selected implies aria-selected', async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const src = await fs.readFile(path.resolve(__dirname, '../LibraryNode.tsx'), 'utf8');
        // `ListRow` emits `aria-selected` from `selected`; a row that paints as
        // selected has to report it too.
        expect(src).toContain('selected={isActive || isMultiSelected}');
        // And the removal-by-double-click is gone with M2.
        expect(src).not.toMatch(/onDoubleClick=\{\(e\) => \{ e\.stopPropagation\(\); removeTagFromItem/);
    });
});

describe('P7b — lane follow-ups', () => {
    async function read(rel: string) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        return fs.readFile(path.resolve(__dirname, rel), 'utf8');
    }

    it('_sockets.css keeps only the block that still has an emitter', async () => {
        const sheet = await read('../_sockets.css');
        for (const orphan of ['.port-row', '.port-label', '.keyboard-schematic-body', '.instrument-output-port']) {
            expect(sheet.split('*/').join('')).not.toContain(`${orphan} {`);
        }
        // The `!important` port-size rule out-ranked inline sizes that no longer
        // exist, and restated what `Port.css` already declares.
        expect(sheet).not.toContain('!important');
        expect(sheet).toContain('.bundle-port-row');
    });

    it('the record button is the shared danger Button, not a fork of it', () => {
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        const record = container.querySelector('.looper-record')!;
        expect(record.classList.contains('oj-btn')).toBe(true);
        expect(record.classList.contains('oj-btn--danger')).toBe(true);
    });

    it('the playhead comment quotes the measurement that was actually taken', async () => {
        const sheet = await read('../LooperNode.css');
        expect(sheet).toContain('5.34 light / 5.96 dark');
        expect(sheet).not.toContain('5.03 light / 5.42 dark');
    });

    it('ERR-1 has an accessible name and a title that agrees with its body', async () => {
        const src = await read('../SamplerNode.tsx');
        expect(src).toContain('title="Sample not found"');
        expect(src).toContain('aria-label="Sample failed to load"');
        expect(src).not.toContain('title="Sample is silent"');
    });

    it('the key map prints notes, not indices', () => {
        const parentId = useGraphStore.getState().addNode('sampler', { x: 0, y: 0 });
        const visualId = useGraphStore.getState().addNode('sampler-visual', { x: 0, y: 0 });
        useGraphStore.setState((s) => {
            const nodes = new Map(s.nodes);
            nodes.set(visualId, { ...nodes.get(visualId)!, parentId });
            return { nodes };
        });
        useGraphStore.getState().updateNodeData(parentId, {
            rootNote: 60,
            rows: [{
                rowId: 'row-1',
                label: 'Keys',
                portCount: 3,
                gain: 1,
                spread: 2,
                sourceNodeId: 'kbd',
                sourcePortId: 'row-1',
                targetPortId: 'bundle-in',
            }],
        });

        const { container } = render(
            <SamplerVisualNode {...faceProps(visualId)} node={useGraphStore.getState().nodes.get(visualId)!} />,
        );

        // ROOT C4, SPREAD 2 semitones -> C4, D4, E4. The pad PRINTS the note and
        // keeps the exact offset in its accessible name.
        expect([...container.querySelectorAll('.oj-key-tile--pad')].map((p) => p.textContent))
            .toEqual(['C4', 'D4', 'E4']);
        expect(screen.getByRole('button', { name: 'Key 2, D4, +2.0 semitones from root' })).toBeTruthy();
    });
});

// ---------------------------------------------------------------------------
// 12. W5-P7c — the three fixes the P7b gate blocked on, each pinned by the
//     property it broke rather than by the text of the rule that fixes it.
// ---------------------------------------------------------------------------

describe('P7c — F1: one destructive press is ONE undo entry', () => {
    const threeLayers = () => [
        { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        { id: 'c', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
    ];

    it('clearing THREE layers costs one Ctrl+Z, not three', () => {
        looper.loops = threeLayers();
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear every layer' })); });
        const before = useHistoryStore.getState().entries.length;
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete all' })); });

        expect(looper.deleteLoop).toHaveBeenCalledTimes(3);
        expect(looper.loops).toEqual([]);
        // Each `deleteLoop` reports back synchronously and the card commits a
        // layer-metadata step when it does; without an outer bracket that is one
        // entry PER LAYER, and the player presses Ctrl+Z three times watching
        // nothing happen before the stack reaches a step that matters.
        expect(useHistoryStore.getState().entries.length).toBe(before + 1);
    });

    it('deleting ONE layer is also exactly one entry', () => {
        looper.loops = threeLayers();
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete Loop 2' })); });
        const before = useHistoryStore.getState().entries.length;
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });

        expect(looper.loops.map((l) => l.id)).toEqual(['a', 'c']);
        expect(useHistoryStore.getState().entries.length).toBe(before + 1);
    });

    it('taking the last layer off is one entry', () => {
        looper.loops = threeLayers();
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        act(() => { fireEvent.click(screen.getByRole('button', { name: /Undo layer/ })); });
        const before = useHistoryStore.getState().entries.length;
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Take it off' })); });

        expect(looper.loops.map((l) => l.id)).toEqual(['a', 'b']);
        expect(useHistoryStore.getState().entries.length).toBe(before + 1);
    });
});

describe('P7c — the Looper seals what it cannot bring back', () => {
    it('one Ctrl+Z after a confirmed delete consumes the step and changes nothing', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete Loop 2' })); });
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
        const after = layersOf(id).map((l) => l.id);
        const cursor = useHistoryStore.getState().cursor;

        act(() => { useHistoryStore.getState().undo(); });
        // Sealed, exactly like the two destroyers in `libraryVerbs.ts`: the kernel
        // owns the take's PCM, so restoring its metadata would put a row on screen
        // that plays nothing. The step is CONSUMED — it does not fall through into
        // the entry that would delete the card.
        expect(layersOf(id).map((l) => l.id)).toEqual(after);
        expect(useHistoryStore.getState().cursor).toBe(cursor - 1);
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('looper');
    });

    it('clearing every layer is sealed too', () => {
        looper.loops = [
            { id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
            { id: 'b', buffer: null, isMuted: false, waveformData: [0, 1, 0] },
        ];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Clear every layer' })); });
        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Delete all' })); });
        expect(layersOf(id)).toEqual([]);

        act(() => { useHistoryStore.getState().undo(); });
        expect(layersOf(id)).toEqual([]);
        expect(useGraphStore.getState().nodes.get(id)!.type).toBe('looper');
    });

    it('a mute is NOT sealed — the reversible edits still reverse', () => {
        looper.loops = [{ id: 'a', buffer: null, isMuted: false, waveformData: [0, 1, 0] }];
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        render(<LiveLooper id={id} />);
        act(() => { looper.frame([], 0, LooperState.PLAYING); });

        act(() => { fireEvent.click(screen.getByRole('button', { name: 'Mute Loop 1' })); });
        act(() => { useHistoryStore.getState().undo(); });
        expect(looper.loops[0]!.isMuted).toBe(false);
    });
});

describe('P7c — the confirms say where the take goes, not that it is gone', () => {
    it('all three name the Library trash instead of overstating the loss', async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const src = await fs.readFile(path.resolve(__dirname, '../LooperNode.tsx'), 'utf8');
        // Every committed take is auto-saved to the project Library and a delete
        // only TRASHES that copy, so "the kernel owns their audio" was false in
        // the direction that matters to a player who wants it back.
        expect(src).not.toContain('the kernel owns their audio');
        expect(src).not.toContain('the kernel owns its audio');
        expect(src).toContain('These cannot go back into the loop — their takes stay in the Library trash.');
        expect(src).toContain('This cannot go back into the loop — its take stays in the Library trash.');
        // A promise would be a lie: the auto-save is best-effort and swallows its
        // error, so the copy says where to LOOK.
        expect(src).not.toMatch(/is safe in the Library|can be restored from the Library/);
    });
});

// ---------------------------------------------------------------------------
// F2 / F3 — properties a stylesheet grep cannot see. The sheet is injected into
// the document so jsdom's cascade answers, rather than a regex.
// ---------------------------------------------------------------------------

async function injectSheet(name: string) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const style = document.createElement('style');
    style.setAttribute('data-sheet', name);
    style.textContent = await fs.readFile(path.resolve(__dirname, '..', name), 'utf8');
    document.head.appendChild(style);
    return () => style.remove();
}

describe('P7c — F2: the tag identity dot actually renders', () => {
    let drop: (() => void) | null = null;
    afterEach(() => { drop?.(); drop = null; });

    /**
     * W6-P7D item 3 — the local restatement is GONE, and this is the assertion
     * that says the deletion was safe.
     *
     * P7c added `.library-tag .oj-list-row__body { display: flex; … }` because
     * `ListRow`'s body slot was a bare inline `<span>`: a non-replaced inline
     * box ignores width/height, so the dot painted 0x0 and M1's whole
     * justification ("the hue now buys exactly one thing: the 8px dot") bought
     * nothing on screen. The rule carried its own removal instruction — "the
     * day `.oj-list-row__body` is a flex line in the component, DELETE this".
     * `ListRow.css` landed that in 06fa8c7, so the copy is gone.
     *
     * The test therefore loads BOTH sheets, which is the real cascade: the flex
     * line has to come from the COMPONENT now. Injecting only `LibraryNode.css`
     * would pass on the pre-deletion file and fail on this one, which is
     * exactly backwards — it would pin the duplication in place.
     */
    it('inherits ListRow\'s flex body — no local copy — and the 8px dot still measures', async () => {
        const dropRow = await injectSheet(
            '../../../packages/oj-ui/src/components/ListRow/ListRow.css',
        );
        const dropLib = await injectSheet('LibraryNode.css');
        drop = () => { dropLib(); dropRow(); };
        seedLibrary([item({ tags: ['drums'] })], ['drums']);
        const id = useGraphStore.getState().addNode('library', { x: 0, y: 0 });
        useGraphStore.getState().updateNodeData(id, { libraryId: 'lib' });
        const { container } = render(<LibraryNode {...faceProps(id)} />);

        const dot = container.querySelector<HTMLElement>('.library-tag__dot');
        expect(dot, 'the seeded tag row did not render').toBeTruthy();
        const body = dot!.closest('.oj-list-row__body') as HTMLElement;
        expect(getComputedStyle(body).display).toBe('flex');
        expect(getComputedStyle(body).alignItems).toBe('center');
        expect(getComputedStyle(dot!).width).toBe('8px');
        expect(getComputedStyle(dot!).height).toBe('8px');
        // The one measured delta the deletion accepts: the dot-to-name gap is
        // the component's `--space-xs` (4px) where the local copy hard-coded
        // 6px. The token wins — a tag row's in-row gap is the same gap every
        // other list row in the app spends.
        expect(getComputedStyle(body).gap).toBe('var(--space-xs)');
    });

    it('keeps no private restatement of ListRow\'s body layout', async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        // Comments stripped: the file explains the deletion by NAMING the rule
        // it deleted, which is the point of the comment and would otherwise
        // fail its own assertion.
        const css = (await fs.readFile(path.resolve(__dirname, '../LibraryNode.css'), 'utf8'))
            .replace(/\/\*[\s\S]*?\*\//g, '');
        expect(css).not.toContain('.library-tag .oj-list-row__body');
        // The file-row rule survives, but ONLY for the two declarations that
        // really override the component (the filename's 120px floor and the
        // flex that lets the trailing cluster be the side that gives).
        const fileRow = css.match(/\.library-file-row \.oj-list-row__body\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(fileRow).toContain('min-width: 120px');
        expect(fileRow).not.toContain('display: flex');
        expect(fileRow).not.toContain('align-items');
    });
});

describe('P7c — F3: the record button keeps its focus ring while recording', () => {
    let drop: (() => void) | null = null;
    afterEach(() => { drop?.(); drop = null; });

    it('the breath rides a pseudo-element, so no animation outranks :focus-visible', async () => {
        drop = await injectSheet('LooperNode.css');
        // The button is disabled until the engine is up, and a disabled button
        // cannot take focus — so the state a performer is actually in has to be
        // the state under test.
        const { useAudioStore } = await import('../../../store/audioStore');
        act(() => { useAudioStore.setState({ isAudioContextReady: true }); });
        const id = useGraphStore.getState().addNode('looper', { x: 0, y: 0 });
        const { container } = render(<LooperNode {...faceProps(id)} />);
        act(() => { looper.frame([], 0, LooperState.RECORDING); });

        const record = container.querySelector<HTMLButtonElement>('.looper-record')!;
        expect(record.classList.contains('is-recording')).toBe(true);
        act(() => { record.focus(); });
        expect(document.activeElement).toBe(record);

        // The ring the performer needs, read out of the CSSOM rather than
        // grepped. (jsdom's `:focus-visible` matcher does not fire on a
        // programmatic focus inside this suite, so the computed value of the
        // focused button cannot be trusted here — the RULE can.)
        const live = [...document.styleSheets].find(
            (sh) => (sh.ownerNode as HTMLElement | null)?.dataset.sheet === 'LooperNode.css',
        )!;
        const liveRules = [...live.cssRules].filter((r): r is CSSStyleRule => 'selectorText' in r);
        const focusRule = liveRules.find(
            (r) => r.selectorText === '.looper-record.oj-btn.is-recording:focus-visible',
        );
        expect(focusRule, 'the recording button has no focus-visible rule at all').toBeTruthy();
        expect(focusRule!.style.boxShadow).toContain('var(--focus-ring)');

        // jsdom has no animation cascade, so the assertion above passes either
        // way; THIS is the pin. A CSS animation outranks every author-normal
        // declaration, `:focus-visible` included — so the element that breathes
        // must not be the element that carries the ring.
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const sheetText = await fs.readFile(path.resolve(__dirname, '../LooperNode.css'), 'utf8');
        const sourceRules = [...sheetText.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
            .map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
        for (const rule of sourceRules) {
            if (!/animation:[^;]*looper-record-breathe/.test(rule.body)) continue;
            expect(
                rule.selector.includes('::after') || rule.selector.includes('::before'),
                `"${rule.selector}" animates the breath on the button itself, which `
                    + 'outranks :focus-visible and hides the ring while recording',
            ).toBe(true);
        }
        // And the keyframes must not touch the button's own 2px ring inset either.
        const frames = /@keyframes looper-record-breathe\s*\{([\s\S]*?)\n\}/.exec(sheetText)?.[1] ?? '';
        expect(frames).toContain('box-shadow');
        expect(frames).not.toContain('inset');

        // Reduced motion is still handled by the blanket rule, which covers the
        // pseudo-element the breath just moved onto.
        const globalCss = await fs.readFile(path.resolve(__dirname, '../../../styles/global.css'), 'utf8');
        expect(globalCss).toContain('prefers-reduced-motion');
        expect(globalCss).toContain('*::after');
    });
});
