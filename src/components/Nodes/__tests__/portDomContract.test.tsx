/**
 * The port DOM contract, for EVERY registered node type.
 *
 * `NodeCanvas` finds a socket with `[data-node-id="…"][data-port-id="…"]` and
 * takes its bounding box centre — that one query is how a cable knows where to
 * land and how a drag knows what it grabbed. It is the most load-bearing DOM in
 * the app, and it is spread across ~20 bespoke faceplates that each emit their
 * own markers.
 *
 * So this walks the whole registry, renders each node once, and asserts (1) that
 * every port a node advertises is reachable through that query, and (2) that the
 * marker is — or wraps — an `.oj-port` socket carrying `data-port-type`: one
 * socket language, no faceplate left behind. A node type that renders a port the
 * canvas cannot find is a node you cannot plug anything into.
 */
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeWrapper } from '../NodeWrapper';
import { nodeDefinitions } from '../../../engine/registry';
import type { NodeType } from '../../../engine/types';
import { useGraphStore } from '../../../store/graphStore';
import { useHistoryStore } from '../../../store/historyStore';
import { useCanvasStore } from '../../../store/canvasStore';

const TYPES = Object.keys(nodeDefinitions) as NodeType[];

/**
 * Types whose faceplate legitimately renders something OTHER than its ports.
 *
 * The set is EMPTY, and that is the finding: it used to hold `midi`,
 * `minilab-3` and `instrument-visual`, and none of those exemptions were really
 * about ports. The two MIDI nodes replaced their whole body with a "Web MIDI
 * unavailable" card, so a graph you had already wired lost every visible socket
 * the moment you opened it in a browser without a MIDI bridge; and
 * `instrument-visual` advertised a `row-in` port it never drew. W5-P8 fixed the
 * behaviour rather than the assertion: the node, its ports and its cables are
 * all still real when the hardware is missing.
 */
const NO_SOCKETS_HERE = new Set<NodeType>([] as NodeType[]);

/**
 * Faceplates that DO place a findable marker but have not been rebuilt on the
 * shared socket yet — their marker is a hand-rolled div rather than an
 * `.oj-port`, and/or it omits `data-port-type`. Cables land correctly on all of
 * them; what is missing is the one visual language. Wave 5 owns these files and
 * this list must only ever shrink.
 *
 * `add` / `subtract` left this list in W5-P6: the Math faceplate is built on
 * `PortRow` now and emits `data-port-type` like everything else.
 *
 * `minilab3-visual` left it in W5-P8 — the last one. Its `.minilab3-key-port`
 * bare divs are gone: keys and pads are `KeyTile`s (which embed the shared
 * well), and every knob, fader and strip carries a real `Port`. The set is now
 * empty, which is the only acceptable end state; it may never gain a member.
 */
const NOT_YET_ON_THE_SHARED_SOCKET = new Set<NodeType>([] as NodeType[]);

function renderType(type: NodeType) {
    const nodeId = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.get(nodeId)!;
    const { container } = render(<NodeWrapper node={node} />);
    return { nodeId, node, container };
}

beforeEach(() => {
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
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('port DOM contract', () => {
    it('covers every registered node type', () => {
        expect(TYPES.length).toBeGreaterThan(30);
    });

    it.each(TYPES)('%s renders', (type) => {
        const { container } = renderType(type);
        expect(container.firstElementChild).not.toBeNull();
    });

    it.each(TYPES.filter((type) => !NO_SOCKETS_HERE.has(type)))(
        '%s: the canvas can find every port it advertises',
        (type) => {
            const { nodeId, node, container } = renderType(type);
            for (const port of node.ports) {
                const marker = container.querySelector(
                    `[data-node-id="${CSS.escape(nodeId)}"][data-port-id="${CSS.escape(port.id)}"]`,
                );
                expect(marker, `${type}: no DOM marker for port "${port.id}"`).not.toBeNull();
            }
        },
    );

    it.each(
        TYPES.filter(
            (type) => !NO_SOCKETS_HERE.has(type) && !NOT_YET_ON_THE_SHARED_SOCKET.has(type),
        ),
    )('%s: every port is the shared socket', (type) => {
        const { nodeId, node, container } = renderType(type);
        for (const port of node.ports) {
            const marker = container.querySelector(
                `[data-node-id="${CSS.escape(nodeId)}"][data-port-id="${CSS.escape(port.id)}"]`,
            )!;
            expect(
                marker.getAttribute('data-port-type'),
                `${type}: port "${port.id}" is missing data-port-type`,
            ).toBe(port.type);
            // Either the marker IS the socket, or it is a playable surface (a
            // KeyTile) that embeds one. Both are the same well.
            const isSocket =
                marker.classList.contains('oj-port') || marker.querySelector('.oj-port') !== null;
            expect(isSocket, `${type}: port "${port.id}" renders no .oj-port well`).toBe(true);
        }
    });

    it('the not-yet-migrated list only ever shrinks', () => {
        // A guard on the guard: if a faceplate is fixed, delete it from the set;
        // if a NEW one appears here, that is a regression, not a backlog item.
        expect([...NOT_YET_ON_THE_SHARED_SOCKET].sort()).toEqual([]);
        expect([...NO_SOCKETS_HERE].sort()).toEqual([]);
    });
});
