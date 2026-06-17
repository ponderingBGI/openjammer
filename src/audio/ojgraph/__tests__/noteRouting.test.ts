import { describe, it, expect } from 'vitest';
import { resolveKeyboardNotes } from '../noteRouting';
import type { Connection, GraphNode, PortDefinition } from '../../../engine/types';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function node(
    id: string,
    type: string,
    ports: PortDefinition[],
    data: Record<string, unknown> = {},
): GraphNode {
    return {
        id,
        type: type as GraphNode['type'],
        category: 'input',
        position: { x: 0, y: 0 },
        data: data as GraphNode['data'],
        ports,
        parentId: null,
        childIds: [],
    };
}

function out(id: string, name: string): PortDefinition {
    return { id, name, type: 'control', direction: 'output' };
}

function conn(sourceNodeId: string, sourcePortId: string, targetNodeId: string): Connection {
    return {
        id: `${sourceNodeId}->${targetNodeId}`,
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId: 'bundle-in',
        type: 'control',
    };
}

/** A 'keys' instrument node (no rows; uses the default offset branch). */
function keys(id: string): GraphNode {
    return node(id, 'keys', [
        { id: 'bundle-in', name: 'Bundle', type: 'control', direction: 'input' },
        { id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' },
    ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveKeyboardNotes — hardware MIDI (minilab-3) → instrument', () => {
    it('routes a MiniLab keys-bundle cable to the connected Keys instrument', () => {
        // The minilab-3 node exposes ONE composite output port '<panel>:bundle-keys'
        // named 'Keys' (not 'bundle-out' / 'Row N'). The cable carries that id.
        const PORT = 'outputPanel-1:bundle-keys';
        const ml = node('ml', 'minilab-3', [out(PORT, 'Keys')]);
        const inst = keys('keys-1');
        const nodes = new Map([
            [ml.id, ml],
            [inst.id, inst],
        ]);
        const connections = new Map([[`c1`, conn('ml', PORT, 'keys-1')]]);

        const notes = resolveKeyboardNotes('ml', 1, 0, 0.8, nodes, connections);

        expect(notes).toHaveLength(1);
        expect(notes[0].targetNodeId).toBe('keys-1');
        // Default rowOctaves [4,3,2]: row 1 -> octave 4, keyIndex 0 -> C4 -> MIDI 60.
        expect(notes[0].midiNote).toBe(60);
        expect(notes[0].velocity).toBeCloseTo(0.8);
    });

    it('still resolves keys when the device also exposes a pad port that sorts first (Bug A)', () => {
        // Regression: keyboardSourcePort used to fall back to the FIRST output port.
        // With a pad port ahead of the keys bundle, that fallback picked the pad and
        // the keys cable no longer matched -> silence. The keys-bundle preference
        // must win regardless of port order.
        const PADS = 'outputPanel-1:pad-1';
        const KEYS = 'outputPanel-1:bundle-keys';
        const ml = node('ml', 'minilab-3', [out(PADS, 'Pad 1'), out(KEYS, 'Keys')]);
        const inst = keys('keys-1');
        const nodes = new Map([
            [ml.id, ml],
            [inst.id, inst],
        ]);
        // The user's cable is on the KEYS bundle, not the pad.
        const connections = new Map([['c1', conn('ml', KEYS, 'keys-1')]]);

        const notes = resolveKeyboardNotes('ml', 1, 5, 1, nodes, connections);

        expect(notes).toHaveLength(1);
        expect(notes[0].targetNodeId).toBe('keys-1');
        expect(notes[0].midiNote).toBe(65); // C4 + 5 semitones = F4
    });

    it('resolves notes across rows (low and high keys differ in pitch)', () => {
        const PORT = 'outputPanel-1:bundle-keys';
        const ml = node('ml', 'minilab-3', [out(PORT, 'Keys')]);
        const inst = keys('keys-1');
        const nodes = new Map([
            [ml.id, ml],
            [inst.id, inst],
        ]);
        const connections = new Map([['c1', conn('ml', PORT, 'keys-1')]]);

        const row1 = resolveKeyboardNotes('ml', 1, 0, 1, nodes, connections); // octave 4
        const row3 = resolveKeyboardNotes('ml', 3, 0, 1, nodes, connections); // octave 2
        expect(row1[0].midiNote).toBe(60);
        expect(row3[0].midiNote).toBe(36);
        expect(row3[0].midiNote).toBeLessThan(row1[0].midiNote);
    });
});
