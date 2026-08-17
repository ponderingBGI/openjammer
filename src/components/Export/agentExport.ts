import { useArrangementStore } from '../../store/arrangementStore';
import type { ExportSongArgs } from '../../ai/types';
import { assembleExportArgs } from './exportSpec';
import { exportNative } from './nativeExport';
import type { BounceSpec, ExportStats } from './types';

export async function exportSongForAgent(args: ExportSongArgs): Promise<ExportStats> {
    const arrangement = useArrangementStore.getState().arrangement;
    if (!arrangement) throw new Error('There is no arrangement to export.');
    const spec: BounceSpec = {
        sampleRate: args.sampleRate,
        bitDepth: args.bitDepth,
        format: args.format,
        tail: args.tail,
    };
    return exportNative(assembleExportArgs(arrangement, spec, args.outPath, 'native'), () => {});
}
