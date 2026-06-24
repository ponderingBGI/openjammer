import { describe, expect, it } from 'vitest';
import { buildPaperSketch } from '../songs/paperSketch';
import { conduct } from '../conduct';
import { specToGraph } from '../spec';
import { arrangementForExport, readArrangement } from '../project';
import { exportWorkflow, importWorkflow } from '../../engine/serialization';
import type { SerializedWorkflow } from '../../engine/types';

describe('Paper Sketch No. 1', () => {
    it('is a multi-track, multi-section arrangement', () => {
        const arr = buildPaperSketch();
        expect(arr.tracks.length).toBeGreaterThanOrEqual(3);
        expect((arr.sections ?? []).length).toBeGreaterThanOrEqual(3);
        expect(arr.tempoBpm).toBe(84);
    });

    it('conducts to a non-trivial schedule with notes for every track', () => {
        const r = conduct(buildPaperSketch());
        const noteOns = r.events.filter((e) => e.cmd === 'noteOn');
        expect(noteOns.length).toBeGreaterThan(100);
        // automation lowered to setParam (the filter sweep).
        expect(r.events.some((e) => e.cmd === 'setParam')).toBe(true);
        // every track's instrument got an IR node id.
        for (const t of buildPaperSketch().tracks) {
            expect(typeof r.trackIndex[t.ref]).toBe('number');
        }
        expect(r.seconds).toBeGreaterThan(40);
    });

    it('EXPORTS a project that round-trips through importWorkflow (openable, lossless)', () => {
        const arr = buildPaperSketch();
        const { nodes, connections } = specToGraph(arr.graph);
        const exported = exportWorkflow(nodes, connections, arr.name);
        const imported = importWorkflow(exported);
        // Every graph node survives the export -> open round-trip (no dropped work).
        expect(new Set(imported.nodes.map((n) => n.id))).toEqual(
            new Set(arr.graph.nodes.map((n) => n.ref)),
        );
        // Connections survive too.
        expect(imported.connections.length).toBe(arr.graph.connections?.length ?? 0);
    });

    it('round-trips the ARRANGEMENT (not just the graph) through export -> JSON -> import (FROZEN-3)', () => {
        const arr = buildPaperSketch();
        const { nodes, connections } = specToGraph(arr.graph);
        const exported: SerializedWorkflow = {
            ...exportWorkflow(nodes, connections, arr.name),
            arrangement: arrangementForExport(arr),
        };
        // Through the REAL on-disk path: serialize to JSON and read it back.
        const imported = importWorkflow(JSON.stringify(exported));
        const reread = readArrangement(imported.arrangement);
        expect(reread).toBeDefined();
        expect(reread!.schemaVersion).toBe(1);
        // Lossless where it matters: the re-read arrangement lowers IDENTICALLY, so a
        // reopened song plays exactly what was saved (the export's reason to exist).
        expect(conduct(reread!)).toEqual(conduct(arr));
    });

    it('readArrangement refuses a future major version + ignores a non-arrangement blob', () => {
        expect(readArrangement({ ...buildPaperSketch(), schemaVersion: 999 })).toBeUndefined();
        expect(readArrangement({ nope: true })).toBeUndefined();
        expect(readArrangement(null)).toBeUndefined();
    });
});
