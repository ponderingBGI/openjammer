/**
 * Loro ↔ durable journal integration tests (Track B P1). Uses loro-crdt in node;
 * proves persist → recover → converge, compaction, and torn-tail safety.
 */

import { describe, it, expect } from 'vitest';
import { CrdtGraphProjection } from '../../../collab/CrdtGraphProjection';
import type { CrdtNode } from '../../../collab/types';
import { Journal, MemoryJournalStore } from '../journal';
import { LoroPersistence } from '../loroPersistence';

function makeNode(id: string, overrides: Partial<CrdtNode> = {}): CrdtNode {
    return {
        id,
        type: 'multiplier',
        category: 'utility',
        position: { x: 0, y: 0 },
        data: { gain: 1 },
        ports: [],
        parentId: null,
        childIds: [],
        specialNodes: [],
        ...overrides,
    };
}

function normalize(p: CrdtGraphProjection) {
    const s = p.snapshot();
    return {
        nodes: [...s.nodes].sort((a, b) => a.id.localeCompare(b.id)).map((n) => JSON.stringify(n)),
        connections: [...s.connections].sort((a, b) => a.id.localeCompare(b.id)).map((c) => JSON.stringify(c)),
    };
}

describe('LoroPersistence', () => {
    it('persists local updates so a fresh projection recovers the SAME document', () => {
        const journal = new Journal(new MemoryJournalStore());
        const a = new CrdtGraphProjection();
        a.setPeerId(1);
        const persistence = new LoroPersistence(journal);
        persistence.attach(a);

        a.transactLocal(() => a.writeNode(makeNode('n1', { position: { x: 10, y: 20 } })));
        a.transactLocal(() => a.writeNode(makeNode('n2', { data: { gain: 5 } })));

        // A crash + relaunch: recover into a brand-new projection from the journal.
        const recovered = new CrdtGraphProjection();
        recovered.setPeerId(1);
        const { truncated } = LoroPersistence.recoverInto(journal, recovered);

        expect(truncated).toBe(false);
        expect(normalize(recovered)).toEqual(normalize(a));
        expect(recovered.snapshot().nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);

        persistence.detach();
        a.destroy();
        recovered.destroy();
    });

    it('recovers across a compaction (snapshot baseline + later deltas)', () => {
        const journal = new Journal(new MemoryJournalStore());
        const a = new CrdtGraphProjection();
        a.setPeerId(1);
        const persistence = new LoroPersistence(journal);
        persistence.attach(a);

        a.transactLocal(() => a.writeNode(makeNode('before')));
        persistence.compact(a); // fold into a snapshot, truncate the log
        a.transactLocal(() => a.writeNode(makeNode('after')));

        const recovered = new CrdtGraphProjection();
        recovered.setPeerId(1);
        LoroPersistence.recoverInto(journal, recovered);

        expect(recovered.snapshot().nodes.map((n) => n.id).sort()).toEqual(['after', 'before']);
        expect(normalize(recovered)).toEqual(normalize(a));

        persistence.detach();
        a.destroy();
        recovered.destroy();
    });

    it('a torn log tail (crash mid-append) recovers the prior committed updates', () => {
        const store = new MemoryJournalStore();
        const journal = new Journal(store);
        const a = new CrdtGraphProjection();
        a.setPeerId(1);
        new LoroPersistence(journal).attach(a);

        a.transactLocal(() => a.writeNode(makeNode('committed')));
        a.transactLocal(() => a.writeNode(makeNode('also-committed')));
        // Simulate a crash partway through appending the NEXT update: a partial,
        // unframed tail is left after the two complete records.
        store.appendBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

        const recovered = new CrdtGraphProjection();
        recovered.setPeerId(1);
        const { truncated } = LoroPersistence.recoverInto(journal, recovered);

        expect(truncated).toBe(true);
        // Both fully-committed nodes survive; the torn tail was dropped, not fatal.
        expect(recovered.snapshot().nodes.map((n) => n.id).sort()).toEqual(['also-committed', 'committed']);

        a.destroy();
        recovered.destroy();
    });
});
