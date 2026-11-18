/**
 * U5 — an output fans out; an input carries its cable with it.
 *
 * The bug this pins (UX-INV Q5, FH-1 finding F7): `handlePortMouseDown` armed a
 * pending disconnect on ANY port that already carried a cable, and the lookup
 * was symmetric. So mousedown on an output that was already wired MOVED its
 * cable — measured on the shipping build as `6 connections before, 6 after`,
 * with the Speaker silently unfed — and no gesture in the whole application
 * could send one output to two places.
 *
 * The asymmetry is the topology, not a special case: a cable is uniquely
 * identified by its INPUT end (an audio input holds one, enforced in
 * `graphStore.addConnection`), while an output end has no cardinality at all.
 *
 * The compensating half is here too, and it is the one the gate review caught
 * missing (1C-02): with the output grab now fanning out, the documented way to
 * MOVE a cable is to grab it at its input end and drop it on another input. That
 * gesture did nothing at all — `addConnection(input, input)` is refused by
 * `canConnect` — so the most natural DAW gesture in the app failed silently.
 *
 * These tests drive the real `NodeWrapper` port handlers rather than the store,
 * because the store was never the bug: `graphStore` will happily hold N cables
 * from one output, and did all along.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeWrapper } from '../NodeWrapper';
import { useCanvasStore } from '../../../store/canvasStore';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { subscribeAnnounce } from '../../../a11y/announce';

/** A stand-in faceplate that exposes the two port handlers as real buttons. */
function portHarness(testId: string) {
    return ({
        node,
        handlePortMouseDown,
        handlePortMouseUp,
    }: {
        node: { ports: { id: string; direction: string }[] };
        handlePortMouseDown?: (id: string, event: MouseEvent) => void;
        handlePortMouseUp?: (id: string, event: MouseEvent) => void;
    }) => (
        <div data-testid={testId}>
            {node.ports.map((port) => (
                <button
                    key={port.id}
                    type="button"
                    data-testid={`${testId}:${port.id}`}
                    onMouseDown={(event) => handlePortMouseDown?.(port.id, event)}
                    onMouseUp={(event) => handlePortMouseUp?.(port.id, event)}
                >
                    {port.id}
                </button>
            ))}
        </div>
    );
}

vi.mock('../SpeakerNode', () => ({ SpeakerNode: portHarness('speaker') }));
vi.mock('../LooperNode', () => ({ LooperNode: portHarness('looper') }));

function resetStores() {
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
    useCanvasStore.setState({ isConnecting: false, connectingFrom: null, pendingDisconnect: null, hoverTarget: null });
}

describe('U5 — outputs fan out', () => {
    /** Everything the live region was asked to say during a test. */
    let spoken: string[] = [];
    let unsubscribe: (() => void) | null = null;

    beforeEach(() => {
        resetStores();
        spoken = [];
        unsubscribe?.();
        unsubscribe = subscribeAnnounce((message) => spoken.push(message));
    });
    afterEach(() => { unsubscribe?.(); unsubscribe = null; });

    it('grabbing a CONNECTED output starts a new cable and keeps the old one', () => {
        const graph = useGraphStore.getState();
        const effectId = graph.addNode('effect', { x: 0, y: 0 });
        const speakerId = graph.addNode('speaker', { x: 300, y: 0 });
        const looperId = graph.addNode('looper', { x: 300, y: 300 });

        const source = useGraphStore.getState().nodes.get(effectId)!.ports.find((p) => p.direction === 'output')!;
        const speakerIn = useGraphStore.getState().nodes.get(speakerId)!.ports.find((p) => p.direction === 'input')!;
        const looperIn = useGraphStore.getState().nodes.get(looperId)!.ports.find((p) => p.direction === 'input')!;

        const first = graph.addConnection(effectId, source.id, speakerId, speakerIn.id)!;
        expect(first).toBeTruthy();

        // Grab the output that is already wired. Rendered through NodeWrapper so
        // the real `handlePortMouseDown` runs.
        render(<NodeWrapper node={useGraphStore.getState().nodes.get(effectId)!} />);
        const outputSocket = document.querySelector<HTMLElement>(`[data-port-id="${source.id}"]`)!;
        act(() => fireEvent.mouseDown(outputSocket, { button: 0 }));

        // THE fix: no pending disconnect is armed on an output.
        expect(useCanvasStore.getState().isConnecting).toBe(true);
        expect(useCanvasStore.getState().pendingDisconnect).toBeNull();

        // Land it on a second target.
        render(<NodeWrapper node={useGraphStore.getState().nodes.get(looperId)!} />);
        act(() => fireEvent.mouseUp(screen.getByTestId(`looper:${looperIn.id}`)));

        const after = useGraphStore.getState();
        const fanned = Array.from(after.connections.values()).filter(
            (conn) => conn.sourceNodeId === effectId && conn.sourcePortId === source.id,
        );
        expect(fanned).toHaveLength(2);
        expect(after.connections.has(first)).toBe(true);
    });

    /*
     * 1C-02 / 1C-09. The previous version of this test was named "…and moves it"
     * and asserted only that `pendingDisconnect` was armed — so its name was the
     * strongest evidence for a behaviour the build did not have. It lands the
     * cable now.
     */
    it('grabbing a CONNECTED input and dropping on another input MOVES the cable', () => {
        const graph = useGraphStore.getState();
        const effectId = graph.addNode('effect', { x: 0, y: 0 });
        const speakerId = graph.addNode('speaker', { x: 300, y: 0 });
        const looperId = graph.addNode('looper', { x: 300, y: 300 });

        const source = useGraphStore.getState().nodes.get(effectId)!.ports.find((p) => p.direction === 'output')!;
        const speakerIn = useGraphStore.getState().nodes.get(speakerId)!.ports.find((p) => p.direction === 'input')!;
        const looperIn = useGraphStore.getState().nodes.get(looperId)!.ports.find((p) => p.direction === 'input')!;
        const cable = graph.addConnection(effectId, source.id, speakerId, speakerIn.id)!;
        const cursorBefore = useHistoryStore.getState().cursor;

        render(<NodeWrapper node={useGraphStore.getState().nodes.get(speakerId)!} />);
        act(() => fireEvent.mouseDown(screen.getByTestId(`speaker:${speakerIn.id}`), { button: 0 }));
        expect(useCanvasStore.getState().pendingDisconnect).toBe(cable);

        render(<NodeWrapper node={useGraphStore.getState().nodes.get(looperId)!} />);
        act(() => fireEvent.mouseUp(screen.getByTestId(`looper:${looperIn.id}`)));

        const after = useGraphStore.getState();
        const cables = Array.from(after.connections.values());
        // ONE cable, same source, new destination — a move, not an add.
        expect(cables).toHaveLength(1);
        expect(cables[0]).toMatchObject({
            sourceNodeId: effectId,
            sourcePortId: source.id,
            targetNodeId: looperId,
            targetPortId: looperIn.id,
        });
        // And one gesture, so one Ctrl+Z puts it back where it was.
        expect(useHistoryStore.getState().cursor).toBe(cursorBefore + 1);
        act(() => useHistoryStore.getState().undo());
        const restored = Array.from(useGraphStore.getState().connections.values());
        expect(restored).toHaveLength(1);
        expect(restored[0]).toMatchObject({ targetNodeId: speakerId, targetPortId: speakerIn.id });
    });

    /*
     * RG-01 — a "move" that did not happen must not be announced as one.
     *
     * `addConnection` short-circuits on a duplicate edge and hands back the
     * EXISTING connection's id without touching the graph. So when one output
     * already feeds both the grabbed input and the target, `reconnectConnection`
     * returns truthy having moved nothing — and the branch announced "Moved cable
     * from X to Y" while the history frame committed no verbs, which left the
     * player's next `Ctrl+Z` undoing the PREVIOUS gesture. A false confirmation
     * followed by an undo that lands somewhere else.
     */
    it('refuses honestly when the cable is already where it is being dropped', () => {
        const graph = useGraphStore.getState();
        const effectId = graph.addNode('effect', { x: 0, y: 0 });
        const speakerId = graph.addNode('speaker', { x: 300, y: 0 });
        const looperId = graph.addNode('looper', { x: 300, y: 300 });

        const source = useGraphStore.getState().nodes.get(effectId)!.ports.find((p) => p.direction === 'output')!;
        const speakerIn = useGraphStore.getState().nodes.get(speakerId)!.ports.find((p) => p.direction === 'input')!;
        const looperIn = useGraphStore.getState().nodes.get(looperId)!.ports.find((p) => p.direction === 'input')!;

        // The gate's exact topology: ONE output feeding BOTH inputs.
        graph.addConnection(effectId, source.id, speakerId, speakerIn.id);
        graph.addConnection(effectId, source.id, looperId, looperIn.id);
        const edgesBefore = [...useGraphStore.getState().connections.keys()].sort();
        const cursorBefore = useHistoryStore.getState().cursor;

        render(<NodeWrapper node={useGraphStore.getState().nodes.get(speakerId)!} />);
        act(() => fireEvent.mouseDown(screen.getByTestId(`speaker:${speakerIn.id}`), { button: 0 }));
        render(<NodeWrapper node={useGraphStore.getState().nodes.get(looperId)!} />);
        act(() => fireEvent.mouseUp(screen.getByTestId(`looper:${looperIn.id}`)));

        // Nothing moved...
        expect([...useGraphStore.getState().connections.keys()].sort()).toEqual(edgesBefore);
        // ...nothing was recorded, so Ctrl+Z still points at the previous edit...
        expect(useHistoryStore.getState().cursor).toBe(cursorBefore);
        expect(useHistoryStore.getState().open).toBeNull();
        // ...and the player was told the truth rather than "Moved cable".
        expect(spoken).toContain('That cable is already there.');
        expect(spoken.join(' ')).not.toMatch(/Moved cable/);
    });

    /*
     * 1C-05. The keyboard route used to carry a private self-wire prohibition
     * while the identical pointer drag created the loop. The rule lives in
     * `graphStore.addConnection` now, so BOTH routes get the same answer — and
     * the store is the one place a future route has to pass through.
     */
    it('refuses a card wiring to itself, through the store, on the pointer route', () => {
        const graph = useGraphStore.getState();
        const effectId = graph.addNode('effect', { x: 0, y: 0 });
        const effect = useGraphStore.getState().nodes.get(effectId)!;
        const out = effect.ports.find((p) => p.direction === 'output')!;
        const input = effect.ports.find((p) => p.direction === 'input')!;

        expect(graph.addConnection(effectId, out.id, effectId, input.id)).toBeNull();
        expect(useGraphStore.getState().connections.size).toBe(0);
    });
});
