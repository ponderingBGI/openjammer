import type { OjGraph, TempoMap, Timeline } from '@openjammer/oj-protocol';

export type ExportSampleRate = 44_100 | 48_000 | 88_200 | 96_000;
export type ExportBitDepth = '16' | '24' | '32f';
export type ExportFormat = 'wav' | 'flac';
export type ExportTail = { mode: 'auto' } | { mode: 'fixed'; seconds: number };

export interface BounceSpec {
    sampleRate: ExportSampleRate;
    bitDepth: ExportBitDepth;
    format: ExportFormat;
    tail: ExportTail;
}

export interface ExportArrangementArgs {
    graph: OjGraph;
    timeline: Timeline;
    tempoMap: TempoMap;
    spec: BounceSpec;
    outPath: string;
}

export interface ExportStats {
    path: string;
    maxSamplePeakDbfs: number;
    clippedSampleCount: number;
    frames: number;
    sampleRate: number;
    channels: number;
}

export interface ExportProgress {
    outPath: string;
    blocksRendered: number;
    totalBlocksEstimate: number;
}
