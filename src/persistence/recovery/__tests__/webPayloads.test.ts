/**
 * Browser payload adapter tests (Track B P0). Uses jsdom localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    WebPayloadSource,
    writeEmergencyBackup,
    validateRecoveredGraph,
    loadQuarantined,
    newestQuarantinedId,
    clearEmergencyBackup,
    EMERGENCY_KEY,
    type EmergencyBackup,
} from '../webPayloads';
import { WebMarkerStore } from '../markerStore';
import { serializeMarker } from '../breaker';
import { runRecovery } from '../recover';
import type { Marker } from '../types';

beforeEach(() => {
    localStorage.clear();
});

const goodGraph = {
    nodes: [{ id: 'n1', type: 'multiplier' }],
    edges: [{ id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n1' }],
};

describe('validateRecoveredGraph (fail-closed)', () => {
    it('accepts arrays of id-bearing nodes and edges', () => {
        const b: EmergencyBackup = { timestamp: 1, ...goodGraph };
        expect(validateRecoveredGraph(b)).not.toBeNull();
    });
    it('rejects nodes without string ids', () => {
        const b: EmergencyBackup = { timestamp: 1, nodes: [{ type: 'x' }], edges: [] };
        expect(validateRecoveredGraph(b)).toBeNull();
    });
});

describe('WebPayloadSource', () => {
    it('lists the emergency backup, then nothing after a clean clear', () => {
        writeEmergencyBackup({ nodes: goodGraph.nodes, edges: goodGraph.edges, now: 100 });
        const src = new WebPayloadSource();
        expect(src.list().map((p) => p.id)).toEqual(['emergency:100']);
        clearEmergencyBackup();
        expect(src.list()).toHaveLength(0);
    });

    it('quarantine MOVES the suspect aside (preserved, recoverable, not re-listed)', () => {
        writeEmergencyBackup({ nodes: goodGraph.nodes, edges: goodGraph.edges, now: 200 });
        const src = new WebPayloadSource();
        const id = 'emergency:200';

        src.quarantine(id, { bootSeq: 3, reason: 'snapshot-crashed-on-load' });

        // No longer auto-listed, and the live key is gone (moved, not deleted)...
        expect(src.list()).toHaveLength(0);
        expect(localStorage.getItem(EMERGENCY_KEY)).toBeNull();
        // ...but still recoverable on demand.
        expect(newestQuarantinedId()).toBe(id);
        expect(loadQuarantined(id)).not.toBeNull();
    });

    it('does not re-list a quarantined backup even if an identical one is rewritten', () => {
        writeEmergencyBackup({ nodes: goodGraph.nodes, edges: goodGraph.edges, now: 300 });
        const src = new WebPayloadSource();
        src.quarantine('emergency:300', { bootSeq: 1, reason: 'corrupt-or-invalid' });
        writeEmergencyBackup({ nodes: goodGraph.nodes, edges: goodGraph.edges, now: 300 });
        expect(src.list()).toHaveLength(0);
    });
});

describe('quarantine index is read fail-closed (malformed members never crash consumers)', () => {
    const QUARANTINE_INDEX_KEY = 'openjammer-recovery-quarantine';

    it('survives a non-array index (returns no recoverable id)', () => {
        localStorage.setItem(QUARANTINE_INDEX_KEY, JSON.stringify({ not: 'an array' }));
        expect(newestQuarantinedId()).toBeNull();
    });

    it('drops null / primitive / id-less members and keeps the well-formed one', () => {
        localStorage.setItem(
            QUARANTINE_INDEX_KEY,
            JSON.stringify([
                null,
                42,
                'a string',
                { bootSeq: 9, reason: 'no-id' }, // missing id ⇒ dropped
                { id: 'emergency:1', bootSeq: 5, reason: 'ok' },
            ]),
        );
        // The only valid member wins; the malformed ones are silently dropped and
        // never reach the `b.bootSeq` reducer as a `null`/primitive.
        expect(newestQuarantinedId()).toBe('emergency:1');
    });

    it('coerces a non-finite bootSeq to 0 so the newest-by-bootSeq reducer is safe', () => {
        localStorage.setItem(
            QUARANTINE_INDEX_KEY,
            JSON.stringify([
                { id: 'emergency:nan', bootSeq: 'oops' }, // coerced to 0
                { id: 'emergency:2', bootSeq: 2 },
            ]),
        );
        expect(newestQuarantinedId()).toBe('emergency:2');
    });

    it('a backup IS listed when the index is garbage (its quarantine check yields nothing)', () => {
        writeEmergencyBackup({ nodes: goodGraph.nodes, edges: goodGraph.edges, now: 700 });
        localStorage.setItem(QUARANTINE_INDEX_KEY, 'not json at all {');
        expect(new WebPayloadSource().list().map((p) => p.id)).toEqual(['emergency:700']);
    });
});

describe('runRecovery end-to-end over localStorage', () => {
    function seedDirty(loadedSnapshotId: string | null) {
        const m: Marker = {
            v: 1,
            open: true,
            bootSeq: 0,
            instanceId: 'i',
            loadedSnapshotId,
            crashes: [],
        };
        new WebMarkerStore().write(serializeMarker(m));
    }

    it('restores the emergency backup on a dirty boot', () => {
        writeEmergencyBackup({ nodes: goodGraph.nodes, edges: goodGraph.edges, now: 500 });
        seedDirty(null);
        const out = runRecovery({
            store: new WebMarkerStore(),
            source: new WebPayloadSource(),
            validate: validateRecoveredGraph,
            now: () => 0,
            instanceId: 'i',
        });
        expect(out.mode).toBe('restore');
        expect(out.restored?.graph.nodes[0]?.id).toBe('n1');
    });

    it('quarantines a corrupt emergency backup and opens clean (keeps last-good baseline)', () => {
        // A backup that parses but fails validation (a node missing its id).
        localStorage.setItem(
            EMERGENCY_KEY,
            JSON.stringify({ v: 1, timestamp: 600, nodes: [{ type: 'broken' }], edges: [] }),
        );
        seedDirty(null);
        const out = runRecovery({
            store: new WebMarkerStore(),
            source: new WebPayloadSource(),
            validate: validateRecoveredGraph,
            now: () => 0,
            instanceId: 'i',
        });
        expect(out.mode).toBe('clean');
        expect(out.quarantined).toContain('emergency:600');
        expect(localStorage.getItem(EMERGENCY_KEY)).toBeNull(); // moved to quarantine
    });
});
