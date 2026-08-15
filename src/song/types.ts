// The shared v2 song document. Sources own media; clips are timeline windows.

import type { GraphSpec } from './spec';

/** A MIDI event timed relative to its source's zero. */
export interface ArrangementNote {
    id?: string;
    tick: number;
    durTick: number;
    pitch: number;
    vel?: number;
}

export type SourceId = string;

export interface SourceAncestry {
    of: SourceId;
    timeRatio: number;
    pitchRatio: number;
}

export interface AudioSource {
    id: SourceId;
    kind: 'audio';
    name: string;
    /** Hex form of the engine's content-addressed u32 AssetId. */
    assetId: string;
    path?: string;
    frames: number;
    sampleRate: number;
    channels: number;
    naturalBpm?: number;
    derivedFrom?: SourceAncestry;
}

export interface MidiSource {
    id: SourceId;
    kind: 'midi';
    name: string;
    notes: ArrangementNote[];
    /** Natural source length; deliberately not derived from the last note. */
    lengthTick: number;
    derivedFrom?: SourceAncestry;
}

export type Source = AudioSource | MidiSource;

export type FadeShape = 'linear' | 'constantPower' | 'fast' | 'slow' | 'symmetric';
export interface ClipFade {
    lengthTick: number;
    shape?: FadeShape;
}
export interface ClipEnvelopePoint {
    tick: number;
    gain: number;
}

/** A POSITION / START / LENGTH window onto one source. */
export interface ArrangementClip {
    id?: string;
    sourceId: SourceId;
    startTick: number;
    lengthTick: number;
    /** Ticks for MIDI, frames for audio. Absent means zero. */
    sourceStart?: number;
    domain?: 'beats' | 'samples';
    opaque?: boolean;
    layerIndex?: number;
    mute?: boolean;
    gain?: number;
    envelope?: ClipEnvelopePoint[];
    fadeIn?: ClipFade;
    fadeOut?: ClipFade;
    name?: string;
}

export interface AutomationPoint {
    tick: number;
    value: number;
}

export interface AutomationLane {
    id?: string;
    ref: string;
    param: number;
    points: AutomationPoint[];
}

export interface ArrangementTrack {
    id?: string;
    name?: string;
    ref: string;
    /** Position-sorted; ties retain their existing order. */
    clips: ArrangementClip[];
    automation?: AutomationLane[];
    mute?: boolean;
}

export type LocationKind = 'mark' | 'range' | 'section' | 'loop' | 'punch' | 'songRange';
export interface Location {
    id?: string;
    name: string;
    kind: LocationKind;
    startTick: number;
    endTick?: number;
    domain?: 'beats' | 'samples';
    locked?: boolean;
}

export interface CodeNode {
    id: string;
    faustSource: string;
    onTrack: string;
}

/** Kept opaque in Wave 1; the unified persisted history lands in a later wave. */
export interface HistoryLog {
    entries: unknown[];
    cursor: number;
    cleanCursor: number;
    baseHash: string;
}

export interface Arrangement {
    name: string;
    schemaVersion?: number;
    /** Next in-band minted-id counter. */
    idCounter?: number;
    tempoBpm: number;
    ppq?: number;
    timeSignature?: [number, number];
    sampleRate?: number;
    blockSize?: number;
    sources?: Record<SourceId, Source>;
    locations?: Location[];
    graph: GraphSpec;
    tracks: ArrangementTrack[];
    codeNodes?: CodeNode[];
    history?: HistoryLog;
}

export type ScheduleEvent =
    | { at: number; cmd: 'noteOn'; node: number; note: number; vel: number }
    | { at: number; cmd: 'noteOff'; node: number; note: number }
    | { at: number; cmd: 'setParam'; node: number; param: number; value: number };
