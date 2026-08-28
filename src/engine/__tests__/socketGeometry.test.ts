/**
 * Socket geometry — the registry's port coordinates against the real card.
 *
 * Cables are anchored by measuring the socket in the DOM. The registry's
 * normalized `position` is the FALLBACK, used on the frames where a node's DOM
 * does not exist yet (a project load, a node the canvas has not painted). If the
 * fallback disagrees with the card, the player sees cables hooked to the card's
 * corner for a frame and then snapping — the covenant calls that a bug.
 *
 * These tests pin both halves of the agreement: that `getPortPosition` pulls an
 * edge-anchored x in to the in-body socket column, and that the y literals the
 * registry carries for the cards built on `NodeShell` really are that card's
 * first body row.
 */
import { describe, expect, it } from 'vitest';
import { nodeDefinitions } from '../registry';
import type { NodeType } from '../types';
import {
    SOCKET_INSET_PX,
    SOCKET_ROW_STEP_PX,
    SOCKET_ROW_TOP_PX,
    getPortPosition,
    socketColumnX,
    socketRowY,
} from '../../utils/portPositions';
import { useGraphStore } from '../../store/graphStore';

function addNode(type: NodeType) {
    const id = useGraphStore.getState().addNode(type, { x: 0, y: 0 });
    return useGraphStore.getState().nodes.get(id)!;
}

describe('socket geometry constants', () => {
    it('matches the rendered card: 14px body padding + 9px socket radius', () => {
        expect(SOCKET_INSET_PX).toBe(14 + 9);
    });

    it('matches the first body row: 39px header + 12px body padding + 9px radius', () => {
        expect(SOCKET_ROW_TOP_PX).toBe(39 + 12 + 9);
    });

    it('steps one 18px well plus an 8px row gap per row', () => {
        expect(SOCKET_ROW_STEP_PX).toBe(18 + 8);
        expect(socketRowY(100, 1) - socketRowY(100, 0)).toBeCloseTo(0.26, 6);
    });

    it('never lets the two socket columns cross on a narrow card', () => {
        // keyboard-key declares a 50px nominal box; an un-clamped 23px inset
        // would put its input and output within 4px of each other.
        expect(socketColumnX(50, 'input')).toBeLessThan(socketColumnX(50, 'output'));
        expect(socketColumnX(50, 'output') - socketColumnX(50, 'input')).toBeGreaterThan(0.35);
    });
});

describe('edge-anchored ports resolve to the in-body socket column', () => {
    it('pulls an input from the card edge to the socket column', () => {
        const node = addNode('effect');
        const width = nodeDefinitions.effect.dimensions!.width;
        const position = getPortPosition(node, 'audio-in')!;
        expect(position.x).toBeCloseTo(SOCKET_INSET_PX, 5);
        expect(position.x).toBeCloseTo(socketColumnX(width, 'input') * width, 5);
    });

    it('pulls an output the same distance in from the right edge', () => {
        const node = addNode('effect');
        const width = nodeDefinitions.effect.dimensions!.width;
        const position = getPortPosition(node, 'audio-out')!;
        expect(position.x).toBeCloseTo(width - SOCKET_INSET_PX, 5);
    });

    it('leaves every faceplate coordinate alone', () => {
        // A coordinate strictly between the rails was placed by the node author
        // on its own artwork (MiniLab's pitch-bend strip, the visual keyboard's
        // keys). The socket column resolution must never touch those.
        let checked = 0;
        for (const [type, definition] of Object.entries(nodeDefinitions)) {
            const width = definition.dimensions!.width;
            const node = addNode(type as NodeType);
            for (const port of node.ports) {
                const declared = port.position?.x;
                if (declared === undefined || declared <= 0 || declared >= 1) continue;
                const position = getPortPosition(node, port.id)!;
                expect(position.x, `${type}: ${port.id} was moved`).toBeCloseTo(declared * width, 5);
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(20);
    });
});

/**
 * The node types whose ports are laid out by the shared `NodeShell` port row —
 * for these, and only these, the registry y literal must be the card's own body
 * row, computed from that node's declared height.
 */
const SHARED_CARD_SOCKETS: { type: NodeType; rows: Record<string, number> }[] = [
    { type: 'effect' as NodeType, rows: { 'audio-in': 0, 'audio-out': 0 } },
    { type: 'pan' as NodeType, rows: { 'audio-in': 0, 'audio-out': 0 } },
    { type: 'width' as NodeType, rows: { 'audio-in': 0, 'audio-out': 0 } },
    { type: 'multiplier' as NodeType, rows: { 'in-1': 0, 'in-2': 1, out: 0 } },
];

describe('registry y literals are the shared card body rows', () => {
    it.each(SHARED_CARD_SOCKETS)('$type', ({ type, rows }) => {
        const definition = nodeDefinitions[type];
        const height = definition.dimensions!.height;
        for (const [portId, row] of Object.entries(rows)) {
            const port = definition.defaultPorts.find((candidate) => candidate.id === portId)!;
            expect(port.position, `${type}: ${portId} has no position`).toBeDefined();
            expect(port.position!.y, `${type}: ${portId} is not on body row ${row}`).toBeCloseTo(
                socketRowY(height, row),
                2,
            );
        }
    });
});
