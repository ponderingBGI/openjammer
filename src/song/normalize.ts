// Deterministic, idempotent v2 identity stamping.

import type {
    Arrangement,
    ArrangementClip,
    ArrangementNote,
    ArrangementTrack,
    AutomationLane,
    Location,
    Source,
} from './types';

export class IdMint {
    private readonly seen = new Set<string>();
    private counter: number;

    constructor(counter = 0) {
        this.counter = Math.max(0, Math.floor(counter));
    }

    take(existing: string | undefined, fallback: string): string {
        let id = existing && existing.length > 0 ? existing : fallback;
        if (this.seen.has(id)) {
            let n = 2;
            while (this.seen.has(`${id}#${n}`)) n++;
            id = `${id}#${n}`;
        }
        this.seen.add(id);
        return id;
    }

    midiSourceId(): string {
        let id: string;
        do id = `src:midi:m${this.counter++}`;
        while (this.seen.has(id));
        this.seen.add(id);
        return id;
    }

    get nextCounter(): number {
        return this.counter;
    }
}

function stableClips(clips: ArrangementClip[]): ArrangementClip[] {
    return clips
        .map((clip, index) => ({ clip, index }))
        .sort((a, b) => a.clip.startTick - b.clip.startTick || a.index - b.index)
        .map(({ clip }) => clip);
}

function normalizeLane(lane: AutomationLane, mint: IdMint, trackId: string, index: number): AutomationLane {
    return { ...lane, id: mint.take(lane.id, `${trackId}.a${index}`) };
}

function normalizeTrack(track: ArrangementTrack, mint: IdMint, index: number): ArrangementTrack {
    const id = mint.take(track.id, `t${index}`);
    const clips = stableClips(track.clips).map((clip, clipIndex) => ({
        ...clip,
        id: mint.take(clip.id, `${id}.c${clipIndex}`),
    }));
    const out: ArrangementTrack = { ...track, id, clips };
    if (track.automation) out.automation = track.automation.map((lane, i) => normalizeLane(lane, mint, id, i));
    return out;
}

function normalizeLocation(location: Location, mint: IdMint, index: number): Location {
    return { ...location, id: mint.take(location.id, `l${index}`) };
}

function normalizeNote(note: ArrangementNote, mint: IdMint, sourceId: string, index: number): ArrangementNote {
    return { ...note, id: mint.take(note.id, `${sourceId}.n${index}`) };
}

/** Stamp every entity id, position-sort clips, and persist the next source counter. */
export function normalizeArrangement(arr: Arrangement): Arrangement {
    const mint = new IdMint(arr.idCounter ?? 0);
    const sourceAliases = new Map<string, string>();
    const normalizedSources: Record<string, Source> = {};
    for (const [key, source] of Object.entries(arr.sources ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        const audioContentId = source.kind === 'audio' ? `src:audio:${source.assetId.toLowerCase()}` : undefined;
        if (audioContentId && normalizedSources[audioContentId]) {
            sourceAliases.set(key, audioContentId);
            sourceAliases.set(source.id, audioContentId);
            continue;
        }
        const preferred =
            source.kind === 'audio'
                ? audioContentId
                : source.id || (key.length > 0 ? key : undefined);
        const id = source.kind === 'midi' && !preferred ? mint.midiSourceId() : mint.take(preferred, `s${Object.keys(normalizedSources).length}`);
        sourceAliases.set(key, id);
        sourceAliases.set(source.id, id);
        normalizedSources[id] =
            source.kind === 'midi'
                ? { ...source, id, notes: source.notes.map((note, i) => normalizeNote(note, mint, id, i)) }
                : { ...source, id };
    }

    const tracks = arr.tracks.map((track, i) => normalizeTrack(track, mint, i)).map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, sourceId: sourceAliases.get(clip.sourceId) ?? clip.sourceId })),
    }));
    const out: Arrangement = { ...arr, tracks, idCounter: mint.nextCounter };
    if (Object.keys(normalizedSources).length > 0) {
        out.sources = Object.fromEntries(Object.entries(normalizedSources).sort(([a], [b]) => a.localeCompare(b)));
    } else {
        delete out.sources;
    }
    if (arr.locations) out.locations = arr.locations.map((location, i) => normalizeLocation(location, mint, i));
    return out;
}

/** Regenerate addressable ids for paste/import. Audio content ids remain immutable. */
export function regenerateIds<T>(subtree: T, mint = new IdMint()): T {
    const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit);
        if (value === null || typeof value !== 'object') return value;
        const input = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(input)) out[key] = visit(child);
        if (typeof input.id === 'string') {
            if (input.kind === 'audio' && typeof input.assetId === 'string') out.id = `src:audio:${input.assetId.toLowerCase()}`;
            else if (input.kind === 'midi') out.id = mint.midiSourceId();
            else out.id = mint.take(undefined, 'pasted');
        }
        return out;
    };
    return visit(subtree) as T;
}
