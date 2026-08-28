import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('../../../ai/tauri', () => ({ getInvoke: () => invoke, listen }));

import { exportNative } from '../nativeExport';
import type { ExportArrangementArgs, ExportProgress } from '../types';

describe('native export progress', () => {
    beforeEach(() => { invoke.mockReset(); listen.mockReset(); });

    it('routes only progress for its path and always unlistens', async () => {
        let handler: ((payload: ExportProgress) => void) | undefined;
        const unlisten = vi.fn();
        listen.mockImplementation(async (_name, next) => { handler = next; return unlisten; });
        const stats = { path: '/a.wav', maxSamplePeakDbfs: -2, clippedSampleCount: 0, frames: 10, sampleRate: 48_000, channels: 2 };
        invoke.mockImplementation(async () => {
            handler?.({ outPath: '/else.wav', blocksRendered: 1, totalBlocksEstimate: 2 });
            handler?.({ outPath: '/a.wav', blocksRendered: 2, totalBlocksEstimate: 4 });
            return stats;
        });
        const progress = vi.fn();
        const args = { outPath: '/a.wav' } as ExportArrangementArgs;
        await expect(exportNative(args, progress)).resolves.toEqual(stats);
        expect(invoke).toHaveBeenCalledWith('export_arrangement', args);
        expect(progress).toHaveBeenCalledOnce();
        expect(progress).toHaveBeenCalledWith({ outPath: '/a.wav', blocksRendered: 2, totalBlocksEstimate: 4 });
        expect(unlisten).toHaveBeenCalledOnce();
    });
});
