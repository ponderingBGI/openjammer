/**
 * U8 / HA-02 — a keyboard-only player can wire a rig.
 *
 * Measured before this: 0 of 84 ports tabbable and 42 of 42 with no role and no
 * name, so a keyboard-only session could build a rig's cards from Ctrl+K and had
 * NO route to connect any of them — no shortcut, no palette command, no menu
 * item, and the documented fallback (the agent) is desktop-only.
 * `docs/shell.md` recorded this as an open product decision; U8 closes it.
 *
 * The law under test: ONE roving tab stop per card (not one per port — the piano
 * roll already learned what 128 stops feels like), Arrow keys to walk that card's
 * sockets, Enter to arm, Enter on a compatible socket to land, Escape to drop.
 * Landing goes through the SAME `addConnection` path the pointer uses.
 */

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCanvas } from '../NodeCanvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { resolveKeydown } from '../../../keymap/arbiter';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ subscribeSignalLevels: () => () => {} }),
}));

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const socket = (nodeId: string, portId: string) =>
    document.querySelector<HTMLElement>(`.oj-port[data-node-id="${nodeId}"][data-port-id="${portId}"]`)!;

/** What the one polite live region is saying right now. */
const live = () => document.querySelector('[data-history-live]')?.textContent ?? '';

const portsOf = (nodeId: string) =>
    Array.from(document.querySelectorAll<HTMLElement>(`.oj-port[data-node-id="${nodeId}"]`));

describe('keyboard connect', () => {
    beforeEach(() => {
        vi.stubGlobal('ResizeObserver', ResizeObserverStub);
        useGraphStore.setState({
            nodes: new Map(), connections: new Map(), connectionsByNode: new Map(),
            rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(),
            clipboard: null, version: 0,
        });
        useHistoryStore.getState().clear();
        useCanvasStore.getState().resetView();
        useCanvasStore.setState({ isConnecting: false, connectingFrom: null, pendingDisconnect: null });
    });

    afterEach(() => vi.unstubAllGlobals());

    function twoCards() {
        const graph = useGraphStore.getState();
        const aId = graph.addNode('effect', { x: 0, y: 0 });
        const bId = graph.addNode('effect', { x: 400, y: 0 });
        render(<NodeCanvas />);
        const a = useGraphStore.getState().nodes.get(aId)!;
        const b = useGraphStore.getState().nodes.get(bId)!;
        return {
            aId, bId,
            aOut: a.ports.find((p) => p.direction === 'output')!,
            aIn: a.ports.find((p) => p.direction === 'input')!,
            bIn: b.ports.find((p) => p.direction === 'input')!,
        };
    }

    it('gives each card exactly one tab stop, and every socket a name', () => {
        const { aId, bId } = twoCards();
        for (const nodeId of [aId, bId]) {
            const ports = portsOf(nodeId);
            expect(ports.length).toBeGreaterThan(1);
            expect(ports.filter((el) => el.tabIndex === 0)).toHaveLength(1);
            for (const el of ports) {
                expect(el.getAttribute('role')).toBe('button');
                expect(el.getAttribute('aria-label')).toMatch(/drag to connect|empty slot/i);
            }
        }
    });

    it('Arrow keys move the tab stop between one card’s sockets', () => {
        const { aId } = twoCards();
        const ports = portsOf(aId);
        const first = ports.find((el) => el.tabIndex === 0)!;
        act(() => { first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' }); });

        const stops = portsOf(aId).filter((el) => el.tabIndex === 0);
        expect(stops).toHaveLength(1);
        expect(stops[0]).not.toBe(first);
        expect(document.activeElement).toBe(stops[0]);
    });

    it('Enter arms a socket, Enter on a compatible socket lands the cable', () => {
        const { aId, bId, aOut, bIn } = twoCards();

        act(() => fireEvent.keyDown(socket(aId, aOut.id), { key: 'Enter' }));
        expect(useCanvasStore.getState().isConnecting).toBe(true);
        // The armed socket is painted the same way the pointer path paints it.
        expect(socket(aId, aOut.id).hasAttribute('data-armed')).toBe(true);

        act(() => fireEvent.keyDown(socket(bId, bIn.id), { key: 'Enter' }));

        const wired = Array.from(useGraphStore.getState().connections.values());
        expect(wired).toHaveLength(1);
        expect(wired[0]).toMatchObject({ sourceNodeId: aId, targetNodeId: bId, targetPortId: bIn.id });
        expect(useCanvasStore.getState().isConnecting).toBe(false);
        // ...and it is one entry on the shared history, so Ctrl+Z reaches it.
        expect(useHistoryStore.getState().cursor).toBeGreaterThan(0);
    });

    it('refuses an incompatible socket without wiring anything', () => {
        const { aId, bId, aOut } = twoCards();
        const bOut = useGraphStore.getState().nodes.get(bId)!.ports.find((p) => p.direction === 'output')!;

        act(() => fireEvent.keyDown(socket(aId, aOut.id), { key: 'Enter' }));
        act(() => fireEvent.keyDown(socket(bId, bOut.id), { key: 'Enter' }));

        expect(useGraphStore.getState().connections.size).toBe(0);
        // Still armed — a refusal drops the target, never the cable in hand.
        expect(useCanvasStore.getState().isConnecting).toBe(true);
    });

    /*
     * 1C-05 — ONE opinion about what is legal.
     *
     * The keyboard used to carry a private pre-flight refusal set, so it turned
     * down a card wiring to itself while the identical pointer drag CREATED the
     * loop (measured at gate time: `6 -> 7`, "Connected Effect to Effect"). The
     * rule lives in `graphStore.addConnection` now; the keyboard reports the
     * store's answer instead of pre-judging it, and both routes agree.
     */
    it('refuses a self-wire the same way the pointer does, and says why', () => {
        const { aId, aOut, aIn } = twoCards();

        act(() => fireEvent.keyDown(socket(aId, aOut.id), { key: 'Enter' }));
        act(() => fireEvent.keyDown(socket(aId, aIn.id), { key: 'Enter' }));

        expect(useGraphStore.getState().connections.size).toBe(0);
        expect(document.querySelector('[data-history-live]')?.textContent)
            .toContain('A card cannot be wired to itself');
        // The pointer route gets the same answer from the same place.
        const a = useGraphStore.getState().nodes.get(aId)!;
        expect(useGraphStore.getState().addConnection(aId, aOut.id, aId, aIn.id)).toBeNull();
        expect(a.ports.length).toBeGreaterThan(1);
    });

    it('Escape drops the cable', () => {
        const { aId, aOut } = twoCards();
        act(() => fireEvent.keyDown(socket(aId, aOut.id), { key: 'Enter' }));
        act(() => fireEvent.keyDown(socket(aId, aOut.id), { key: 'Escape' }));
        expect(useCanvasStore.getState().isConnecting).toBe(false);
        expect(socket(aId, aOut.id).hasAttribute('data-armed')).toBe(false);
        expect(live()).toContain('Cable released.');
    });

    /*
     * RG-02 — a cable in the air can be let go from four places, and three of
     * them used to do it in silence. The one that matters most is this: arm a
     * socket, `Tab` away, `Escape`. Focus is no longer on the socket, so the
     * socket-scoped handler never runs and the GLOBAL escape cascade takes it —
     * leaving the live region still saying "…armed. Move to another card's
     * socket…" while the cable was already gone.
     */
    it('says so when the GLOBAL Escape drops an armed cable', () => {
        const { aId, aOut, bId, bIn } = twoCards();
        act(() => fireEvent.keyDown(socket(aId, aOut.id), { key: 'Enter' }));
        expect(live()).toContain('armed');

        // Focus somewhere that is not the armed socket, then Escape through the
        // arbiter, exactly as `Tab` + `Escape` does.
        act(() => { socket(bId, bIn.id).focus(); });
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

        expect(useCanvasStore.getState().isConnecting).toBe(false);
        expect(live()).toContain('Cable released.');
    });

    /*
     * RG-04 — copy and select-all record no history, so `LiveAnnouncer` can never
     * name them. Two of HA-26's five new pointer verbs answered with nothing.
     */
    it('Copy and Select all answer out loud', () => {
        const { aId } = twoCards();
        act(() => useGraphStore.getState().selectNode(aId));
        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); });
        expect(live()).toContain('Copied 1 node');

        act(() => { resolveKeydown(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })); });
        expect(live()).toContain('Selected all 2 nodes');
    });
});
