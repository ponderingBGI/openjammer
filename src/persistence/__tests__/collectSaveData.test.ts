import { beforeEach, describe, expect, it } from 'vitest';
import { useArrangementStore } from '../../store/arrangementStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useGraphStore } from '../../store/graphStore';
import type { Arrangement } from '../../song/types';
import { collectSaveData } from '../collectSaveData';
import { EMERGENCY_KEY, writeEmergencyBackup } from '../recovery/webPayloads';

const arrangement: Arrangement = {
    name: 'Autosave song',
    tempoBpm: 120,
    graph: { nodes: [], connections: [] },
    tracks: [],
};

describe('collectSaveData', () => {
    beforeEach(() => {
        useGraphStore.getState().clearGraph();
        useGraphStore.getState().addNode('speaker', { x: 10, y: 20 });
        useCanvasStore.getState().setPan({ x: 30, y: 40 });
        useCanvasStore.getState().setZoom(1.25);
        useArrangementStore.getState().setArrangement(arrangement);
    });

    it('gives every project/autosave path one complete payload shape', () => {
        const saveData = collectSaveData();

        expect(saveData.nodes.length).toBeGreaterThan(0);
        expect(saveData.viewport).toEqual({ x: 30, y: 40, zoom: 1.25 });
        expect(saveData.arrangement).toMatchObject({
            name: 'Autosave song',
            schemaVersion: 2,
        });
    });

    it('carries the same arrangement into the emergency-backup payload', () => {
        writeEmergencyBackup({ ...collectSaveData(), now: 123 });

        const backup = JSON.parse(localStorage.getItem(EMERGENCY_KEY)!) as {
            arrangement: Arrangement;
        };
        expect(backup.arrangement).toMatchObject({
            name: 'Autosave song',
            schemaVersion: 2,
        });
    });
});
