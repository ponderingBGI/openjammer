import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrangement } from '../../song/types';
import { readArrangement } from '../../song/project';
import { collectSaveData } from '../../persistence/collectSaveData';
import { useArrangementStore } from '../arrangementStore';

const fsMocks = vi.hoisted(() => ({
    restoreHandle: vi.fn(),
    verifyPermission: vi.fn(),
}));

vi.mock('../../utils/fileSystemAccess', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/fileSystemAccess')>()),
    restoreHandle: fsMocks.restoreHandle,
    verifyPermission: fsMocks.verifyPermission,
}));

vi.mock('idb-keyval', () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    del: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
}));

import { useProjectStore, type ProjectManifest } from '../projectStore';

const arrangement: Arrangement = {
    name: 'Round trip',
    tempoBpm: 96,
    graph: { nodes: [], connections: [] },
    tracks: [{ ref: 'keys', clips: [] }],
};

function memoryProject(initial: ProjectManifest) {
    let text = JSON.stringify(initial);
    const fileHandle = {
        getFile: vi.fn(async () => ({ text: async () => text })),
        createWritable: vi.fn(async () => ({
            write: async (value: string) => {
                text = value;
            },
            close: async () => undefined,
            abort: async () => undefined,
        })),
    };
    const handle = {
        getFileHandle: vi.fn(async () => fileHandle),
    } as unknown as FileSystemDirectoryHandle;
    return { handle, read: () => JSON.parse(text) as ProjectManifest };
}

describe('projectStore arrangement persistence', () => {
    beforeEach(() => {
        useProjectStore.setState({ handleKey: 'project-test', isSaving: false });
        useArrangementStore.getState().setArrangement(arrangement);
        fsMocks.verifyPermission.mockResolvedValue(true);
    });

    it('saveProject round-trips the arrangement through the manifest', async () => {
        const project = memoryProject({
            name: 'Test',
            version: '1.0.0',
            engine: 'openjammer',
            engineVersion: '0.1.0',
            created: '2026-01-01T00:00:00.000Z',
            modified: '2026-01-01T00:00:00.000Z',
        });
        fsMocks.restoreHandle.mockResolvedValue(project.handle);

        const saveData = collectSaveData();
        await useProjectStore.getState().saveProject(saveData);

        expect(readArrangement(project.read().arrangement)).toEqual(saveData.arrangement);
    });

    it('an older graph-only save cannot erase an existing arrangement', async () => {
        const project = memoryProject({
            name: 'Test',
            version: '1.0.0',
            engine: 'openjammer',
            engineVersion: '0.1.0',
            created: '2026-01-01T00:00:00.000Z',
            modified: '2026-01-01T00:00:00.000Z',
            arrangement,
        });
        fsMocks.restoreHandle.mockResolvedValue(project.handle);

        await useProjectStore.getState().saveProject({ nodes: [], edges: [] });

        expect(readArrangement(project.read().arrangement)).toEqual(readArrangement(arrangement));
    });
});
