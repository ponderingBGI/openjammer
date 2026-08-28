import { getInvoke, listen } from '../../ai/tauri';
import type { ExportArrangementArgs, ExportProgress, ExportStats } from './types';

export async function exportNative(
    args: ExportArrangementArgs,
    onProgress: (progress: ExportProgress) => void,
): Promise<ExportStats> {
    const invoke = getInvoke();
    if (!invoke) throw new Error('Desktop export is unavailable outside the native app.');
    const unlisten = await listen<ExportProgress>('export-progress', (progress) => {
        if (progress.outPath === args.outPath) onProgress(progress);
    });
    try {
        return await invoke('export_arrangement', args as unknown as Record<string, unknown>) as ExportStats;
    } finally {
        unlisten?.();
    }
}

export async function revealExport(path: string): Promise<void> {
    const invoke = getInvoke();
    if (invoke) await invoke('reveal_path', { path });
}
