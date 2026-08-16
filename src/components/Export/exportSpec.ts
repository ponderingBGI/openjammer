import type { Arrangement } from '../../song/types';
import { conduct } from '../../song/conduct';
import type { BounceSpec, ExportArrangementArgs } from './types';

export function safeExportFilename(name: string | null | undefined): string {
    const cleaned = (name || 'OpenJammer song')
        .replace(/[\\/:*?"<>|]/g, '-')
        .split('').filter((character) => character.charCodeAt(0) >= 32).join('')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'OpenJammer song';
}

export function extensionFor(spec: Pick<BounceSpec, 'format'>): string {
    return spec.format === 'flac' ? 'flac' : 'wav';
}

export function joinExportPath(directory: string, filename: string, spec: BounceSpec): string {
    const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
    return `${directory.replace(/[\\/]+$/, '')}${separator}${safeExportFilename(filename)}.${extensionFor(spec)}`;
}

/** The one strict arrangement lowering shared with timeline playback and the agent tool. */
export function assembleExportArgs(
    arrangement: Arrangement,
    spec: BounceSpec,
    outPath: string,
    backend: 'native' | 'wasm',
): ExportArrangementArgs {
    const published = conduct({ ...arrangement, sampleRate: spec.sampleRate }, backend);
    return {
        graph: published.graph,
        timeline: published.timeline,
        tempoMap: published.tempoMap,
        spec,
        outPath,
    };
}

export function peakWarning(peakDbfs: number): boolean {
    return Number.isFinite(peakDbfs) && peakDbfs > -1;
}

export function clipWarning(clippedSampleCount: number): boolean {
    return clippedSampleCount > 0;
}
