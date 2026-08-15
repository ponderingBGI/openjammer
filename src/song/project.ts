// Arrangement persistence and the sole v1 -> v2 compatibility boundary.

import { barToTick, timebase } from './time';
import { normalizeArrangement } from './normalize';
import type { Arrangement, ArrangementNote, MidiSource, Source } from './types';

export const ARRANGEMENT_SCHEMA_VERSION = 2;

interface V1Clip {
    id?: string;
    startTick: number;
    notes: ArrangementNote[];
}
interface V1Track {
    id?: string;
    name?: string;
    ref: string;
    clips: V1Clip[];
    automation?: Arrangement['tracks'][number]['automation'];
    mute?: boolean;
}
interface V1Section {
    id?: string;
    name: string;
    startBar: number;
}
interface V1Arrangement extends Omit<Arrangement, 'tracks' | 'sources' | 'locations'> {
    tracks: V1Track[];
    sections?: V1Section[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Losslessly move every v1 clip's inline notes into a minted MIDI source. */
export function migrateV1toV2(input: V1Arrangement): Arrangement {
    const tb = timebase(input);
    const sources: Record<string, Source> = {};
    let counter = Math.max(0, Math.floor(input.idCounter ?? 0));
    const mintMidiId = (): string => {
        let id: string;
        do id = `src:midi:m${counter++}`;
        while (sources[id]);
        return id;
    };

    const tracks = input.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
            const sourceId = mintMidiId();
            const noteEnd = clip.notes.reduce((end, note) => Math.max(end, note.tick + Math.max(0, note.durTick)), 0);
            const lengthTick = Math.max(tb.ticksPerBar, Math.ceil(noteEnd / tb.ticksPerBar) * tb.ticksPerBar);
            const source: MidiSource = {
                id: sourceId,
                kind: 'midi',
                name: clip.id ? `MIDI ${clip.id}` : track.name ?? track.ref,
                notes: clip.notes.map((note) => ({ ...note })),
                lengthTick,
            };
            sources[sourceId] = source;
            return { id: clip.id, sourceId, startTick: clip.startTick, lengthTick };
        }),
    }));

    const out: Arrangement = {
        ...input,
        schemaVersion: ARRANGEMENT_SCHEMA_VERSION,
        idCounter: counter,
        tracks,
    };
    delete (out as Arrangement & { sections?: unknown }).sections;
    if (Object.keys(sources).length > 0) out.sources = sources;
    else delete out.sources;
    if (input.sections && input.sections.length > 0) {
        out.locations = input.sections.map((section) => ({
            id: section.id,
            name: section.name,
            kind: 'section' as const,
            startTick: barToTick(tb, section.startBar),
        }));
    }
    return normalizeArrangement(out);
}

export function arrangementForExport(arr: Arrangement): Arrangement {
    const version = arr.schemaVersion ?? ARRANGEMENT_SCHEMA_VERSION;
    if (version < ARRANGEMENT_SCHEMA_VERSION) return migrateV1toV2(arr as unknown as V1Arrangement);
    return normalizeArrangement({ ...arr, schemaVersion: ARRANGEMENT_SCHEMA_VERSION });
}

export function readArrangement(blob: unknown): Arrangement | undefined {
    if (!isRecord(blob)) return undefined;
    const version = typeof blob.schemaVersion === 'number' ? blob.schemaVersion : 1;
    if (version > ARRANGEMENT_SCHEMA_VERSION) return undefined;
    if (typeof blob.tempoBpm !== 'number' || !isRecord(blob.graph) || !Array.isArray(blob.tracks)) return undefined;
    if (version < ARRANGEMENT_SCHEMA_VERSION) return migrateV1toV2(blob as unknown as V1Arrangement);
    return blob as unknown as Arrangement;
}
