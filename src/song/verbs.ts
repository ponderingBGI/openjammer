// Pure, fail-closed, structurally reversible v2 timeline edits.

import type {
    Arrangement,
    ArrangementClip,
    ArrangementNote,
    ArrangementTrack,
    AutomationLane,
    AutomationPoint,
    ClipEnvelopePoint,
    ClipFade,
    Location,
    Source,
} from './types';

export interface NotePatch {
    tick?: number;
    durTick?: number;
    pitch?: number;
    vel?: number;
}

export type Verb =
    | { kind: 'compound'; verbs: Verb[] }
    | { kind: 'addSource'; source: Source }
    | { kind: 'removeSource'; sourceId: string }
    | { kind: 'addTrack'; index: number; track: ArrangementTrack }
    | { kind: 'removeTrack'; trackId: string }
    | { kind: 'setTrackMute'; trackId: string; mute: boolean }
    | { kind: 'setTrackName'; trackId: string; name?: string }
    | { kind: 'addClip'; trackId: string; clip: ArrangementClip }
    | { kind: 'removeClip'; clipId: string }
    | { kind: 'moveClip'; clipId: string; startTick: number; trackId?: string; index?: number }
    | { kind: 'setClipWindow'; clipId: string; startTick?: number; lengthTick?: number; sourceStart?: number }
    | { kind: 'setClipLocked'; clipId: string; locked: boolean }
    | { kind: 'trimClipStart'; clipId: string; startTick: number }
    | { kind: 'trimClipEnd'; clipId: string; endTick: number }
    | { kind: 'slipClip'; clipId: string; sourceStart: number }
    | { kind: 'splitClip'; clipId: string; atTick: number; left: ArrangementClip; right: ArrangementClip }
    | { kind: 'setClipGain'; clipId: string; gain?: number }
    | { kind: 'setClipEnvelope'; clipId: string; envelope?: ClipEnvelopePoint[] }
    | { kind: 'setClipFade'; clipId: string; edge: 'in' | 'out'; fade?: ClipFade }
    | { kind: 'setClipFades'; clipId: string; fadeIn?: ClipFade; fadeOut?: ClipFade }
    | { kind: 'setClipMute'; clipId: string; mute: boolean }
    | { kind: 'setClipLayerIndex'; clipId: string; layerIndex?: number }
    | { kind: 'setClipSource'; clipId: string; sourceId: string; sourceStart?: number; lengthTick?: number }
    | { kind: 'duplicateClip'; clipId: string; startTick: number; fork: boolean; clip: ArrangementClip; source?: Source }
    | { kind: 'addNote'; sourceId: string; index: number; note: ArrangementNote }
    | { kind: 'removeNote'; noteId: string }
    | { kind: 'editNote'; noteId: string; patch: NotePatch }
    | { kind: 'addLocation'; index: number; location: Location }
    | { kind: 'removeLocation'; locationId: string }
    | { kind: 'moveLocation'; locationId: string; startTick: number; endTick?: number }
    | { kind: 'setLocationName'; locationId: string; name: string }
    | { kind: 'setLocationLocked'; locationId: string; locked: boolean }
    | { kind: 'setLoopRange'; location?: Location }
    | { kind: 'setPunchRange'; location?: Location }
    | { kind: 'rippleTracks'; atTick: number; deltaTick: number; trackIds: string[]; excludeClipIds?: string[]; includeLocations: boolean; clipIds?: string[]; locationIds?: string[] }
    | { kind: 'ripple'; atTick: number; deltaTick: number; trackIds: string[]; excludeClipIds?: string[]; includeLocations: boolean; clipIds?: string[]; locationIds?: string[] }
    | { kind: 'insertTime'; atTick: number; durationTick: number; trackIds: string[]; splitIntersected: boolean; moveLocations: boolean }
    | { kind: 'removeTime'; atTick: number; durationTick: number; trackIds: string[]; moveLocations: boolean }
    | { kind: 'stretchClip'; clipId: string; timeRatio: number; pitchRatio: number; anchor: 'start' | 'end'; newSource: Source; newClip: ArrangementClip }
    | { kind: 'bounceClips'; trackId: string; fromTick: number; toTick: number; newSource: Source; newClip: ArrangementClip }
    | { kind: 'setTempo'; tempoBpm: number }
    | { kind: 'setTimeSignature'; timeSignature: [number, number] }
    | { kind: 'addAutomationLane'; trackId: string; index: number; lane: AutomationLane }
    | { kind: 'removeAutomationLane'; laneId: string }
    | { kind: 'setAutomationPoint'; laneId: string; point: AutomationPoint }
    | { kind: 'removeAutomationPoint'; laneId: string; tick: number };

export type VerbKind = Verb['kind'];

function fail(message: string): never {
    throw new Error(`verb: ${message}`);
}
function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
    const at = Math.max(0, Math.min(index, items.length));
    return [...items.slice(0, at), item, ...items.slice(at)];
}
function removeAt<T>(items: readonly T[], index: number): T[] {
    return [...items.slice(0, index), ...items.slice(index + 1)];
}
function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
    return [...items.slice(0, index), item, ...items.slice(index + 1)];
}
function sortedClips(clips: ArrangementClip[]): ArrangementClip[] {
    return clips.map((clip, index) => ({ clip, index })).sort((a, b) => a.clip.startTick - b.clip.startTick || a.index - b.index).map(({ clip }) => clip);
}
function mapTrack(arr: Arrangement, ti: number, transform: (track: ArrangementTrack) => ArrangementTrack): Arrangement {
    return { ...arr, tracks: replaceAt(arr.tracks, ti, transform(arr.tracks[ti]!)) };
}
function withOptional<T extends object, K extends keyof T>(object: T, key: K, value: T[K] | undefined, keep: (value: T[K]) => boolean = () => true): T {
    const copy = { ...object };
    if (value === undefined || !keep(value)) delete copy[key];
    else copy[key] = value;
    return copy;
}

function locateTrack(arr: Arrangement, trackId: string): { ti: number; track: ArrangementTrack } {
    const ti = arr.tracks.findIndex((track) => track.id === trackId);
    if (ti < 0) fail(`no track "${trackId}"`);
    return { ti, track: arr.tracks[ti]! };
}
function locateClip(arr: Arrangement, clipId: string): { ti: number; ci: number; track: ArrangementTrack; clip: ArrangementClip } {
    for (let ti = 0; ti < arr.tracks.length; ti++) {
        const ci = arr.tracks[ti]!.clips.findIndex((clip) => clip.id === clipId);
        if (ci >= 0) return { ti, ci, track: arr.tracks[ti]!, clip: arr.tracks[ti]!.clips[ci]! };
    }
    return fail(`no clip "${clipId}"`);
}
function locateSource(arr: Arrangement, sourceId: string): Source {
    return arr.sources?.[sourceId] ?? fail(`no source "${sourceId}"`);
}
function locateNote(arr: Arrangement, noteId: string): { sourceId: string; source: Extract<Source, { kind: 'midi' }>; ni: number; note: ArrangementNote } {
    for (const [sourceId, source] of Object.entries(arr.sources ?? {})) {
        if (source.kind !== 'midi') continue;
        const ni = source.notes.findIndex((note) => note.id === noteId);
        if (ni >= 0) return { sourceId, source, ni, note: source.notes[ni]! };
    }
    return fail(`no note "${noteId}"`);
}
function locateLane(arr: Arrangement, laneId: string): { ti: number; li: number; track: ArrangementTrack; lane: AutomationLane } {
    for (let ti = 0; ti < arr.tracks.length; ti++) {
        const lanes = arr.tracks[ti]!.automation ?? [];
        const li = lanes.findIndex((lane) => lane.id === laneId);
        if (li >= 0) return { ti, li, track: arr.tracks[ti]!, lane: lanes[li]! };
    }
    return fail(`no automation lane "${laneId}"`);
}
function locateLocation(arr: Arrangement, locationId: string): { index: number; location: Location } {
    const index = (arr.locations ?? []).findIndex((location) => location.id === locationId);
    if (index < 0) fail(`no location "${locationId}"`);
    return { index, location: arr.locations![index]! };
}
function replaceSource(arr: Arrangement, sourceId: string, source: Source): Arrangement {
    return { ...arr, sources: { ...(arr.sources ?? {}), [sourceId]: source } };
}
function validateClip(clip: ArrangementClip): void {
    if (!clip.id) fail('clip needs an id');
    if (!(clip.lengthTick > 0)) fail('clip length must be greater than zero');
    if (clip.startTick < 0 || (clip.sourceStart ?? 0) < 0) fail('clip window cannot be negative');
}
function validateLocation(arr: Arrangement, location: Location, replacingId?: string): void {
    if (!location.id) fail('location needs an id');
    if (location.startTick < 0) fail('location cannot start below zero');
    if (['range', 'loop', 'punch', 'songRange'].includes(location.kind) && !(location.endTick! > location.startTick)) fail(`${location.kind} needs an end after its start`);
    if (['loop', 'punch', 'songRange'].includes(location.kind) && (arr.locations ?? []).some((item) => item.kind === location.kind && item.id !== replacingId)) fail(`only one ${location.kind} location is allowed`);
}
function addClip(arr: Arrangement, trackId: string, clip: ArrangementClip): Arrangement {
    validateClip(clip);
    locateSource(arr, clip.sourceId);
    if (arr.tracks.some((track) => track.clips.some((item) => item.id === clip.id))) fail(`clip "${clip.id}" already exists`);
    const { ti } = locateTrack(arr, trackId);
    return mapTrack(arr, ti, (track) => ({ ...track, clips: sortedClips([...track.clips, clip]) }));
}
function updateClip(arr: Arrangement, clipId: string, transform: (clip: ArrangementClip) => ArrangementClip): Arrangement {
    const { ti, ci, clip } = locateClip(arr, clipId);
    const changed = transform(clip);
    validateClip(changed);
    return mapTrack(arr, ti, (track) => ({ ...track, clips: sortedClips(replaceAt(track.clips, ci, changed)) }));
}
function restoreTracksInverse(before: Arrangement, after: Arrangement, trackIds: string[]): Verb {
    const ids = new Set(trackIds);
    const verbs: Verb[] = [];
    for (const track of after.tracks) if (track.id && ids.has(track.id)) for (const clip of track.clips) verbs.push({ kind: 'removeClip', clipId: clip.id! });
    for (const track of before.tracks) if (track.id && ids.has(track.id)) for (const clip of track.clips) verbs.push({ kind: 'addClip', trackId: track.id, clip });
    return { kind: 'compound', verbs };
}

export function applyVerb(arr: Arrangement, verb: Verb): { next: Arrangement; inverse: Verb } {
    switch (verb.kind) {
        case 'compound': {
            const result = applyVerbs(arr, verb.verbs);
            return { next: result.next, inverse: { kind: 'compound', verbs: result.inverse } };
        }
        case 'addSource': {
            if (!verb.source.id) fail('addSource needs an id');
            if (arr.sources?.[verb.source.id]) fail(`source "${verb.source.id}" already exists`);
            if (verb.source.kind === 'audio' && verb.source.id !== `src:audio:${verb.source.assetId.toLowerCase()}`) fail('audio source id must be its content address');
            return { next: { ...arr, sources: { ...(arr.sources ?? {}), [verb.source.id]: verb.source } }, inverse: { kind: 'removeSource', sourceId: verb.source.id } };
        }
        case 'removeSource': {
            const source = locateSource(arr, verb.sourceId);
            if (arr.tracks.some((track) => track.clips.some((clip) => clip.sourceId === verb.sourceId))) fail(`source "${verb.sourceId}" is still referenced`);
            const sources = { ...(arr.sources ?? {}) };
            delete sources[verb.sourceId];
            const next = { ...arr };
            if (Object.keys(sources).length > 0) next.sources = sources;
            else delete next.sources;
            return { next, inverse: { kind: 'addSource', source } };
        }
        case 'addTrack': {
            if (!verb.track.id) fail('addTrack needs an id');
            if (arr.tracks.some((track) => track.id === verb.track.id)) fail(`track "${verb.track.id}" already exists`);
            return { next: { ...arr, tracks: insertAt(arr.tracks, verb.index, verb.track) }, inverse: { kind: 'removeTrack', trackId: verb.track.id } };
        }
        case 'removeTrack': {
            const { ti, track } = locateTrack(arr, verb.trackId);
            return { next: { ...arr, tracks: removeAt(arr.tracks, ti) }, inverse: { kind: 'addTrack', index: ti, track } };
        }
        case 'setTrackMute': {
            const { ti, track } = locateTrack(arr, verb.trackId);
            return { next: mapTrack(arr, ti, (item) => withOptional(item, 'mute', verb.mute ? true : undefined)), inverse: { kind: 'setTrackMute', trackId: verb.trackId, mute: track.mute === true } };
        }
        case 'setTrackName': {
            const { ti, track } = locateTrack(arr, verb.trackId);
            return { next: mapTrack(arr, ti, (item) => withOptional(item, 'name', verb.name)), inverse: { kind: 'setTrackName', trackId: verb.trackId, name: track.name } };
        }
        case 'addClip':
            return { next: addClip(arr, verb.trackId, verb.clip), inverse: { kind: 'removeClip', clipId: verb.clip.id! } };
        case 'removeClip': {
            const { ti, ci, track, clip } = locateClip(arr, verb.clipId);
            return { next: mapTrack(arr, ti, (item) => ({ ...item, clips: removeAt(item.clips, ci) })), inverse: { kind: 'addClip', trackId: track.id!, clip } };
        }
        case 'moveClip': {
            const found = locateClip(arr, verb.clipId);
            if (verb.startTick < 0) fail('clip cannot move below zero');
            const targetId = verb.trackId ?? found.track.id!;
            locateTrack(arr, targetId);
            let next = mapTrack(arr, found.ti, (track) => ({ ...track, clips: removeAt(track.clips, found.ci) }));
            if (verb.index === undefined) next = addClip(next, targetId, { ...found.clip, startTick: verb.startTick });
            else {
                const target = locateTrack(next, targetId);
                next = mapTrack(next, target.ti, (track) => ({ ...track, clips: insertAt(track.clips, verb.index!, { ...found.clip, startTick: verb.startTick }) }));
            }
            return { next, inverse: { kind: 'moveClip', clipId: verb.clipId, startTick: found.clip.startTick, trackId: found.track.id, index: found.ci } };
        }
        case 'setClipWindow': {
            const { clip } = locateClip(arr, verb.clipId);
            let changed = { ...clip };
            const inverse: Extract<Verb, { kind: 'setClipWindow' }> = { kind: 'setClipWindow', clipId: verb.clipId };
            if ('startTick' in verb) { inverse.startTick = clip.startTick; changed.startTick = verb.startTick!; }
            if ('lengthTick' in verb) { inverse.lengthTick = clip.lengthTick; changed.lengthTick = verb.lengthTick!; }
            if ('sourceStart' in verb) { inverse.sourceStart = clip.sourceStart; changed = withOptional(changed, 'sourceStart', verb.sourceStart, (value) => value !== 0); }
            return { next: updateClip(arr, verb.clipId, () => changed), inverse };
        }
        case 'setClipLocked': {
            const { clip } = locateClip(arr, verb.clipId);
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, 'locked', verb.locked || undefined)), inverse: { kind: 'setClipLocked', clipId: verb.clipId, locked: clip.locked === true } };
        }
        case 'trimClipStart': {
            const { clip } = locateClip(arr, verb.clipId);
            const delta = verb.startTick - clip.startTick;
            const sourceStart = (clip.sourceStart ?? 0) + delta;
            const lengthTick = clip.lengthTick - delta;
            if (sourceStart < 0 || !(lengthTick > 0)) fail('invalid front trim');
            const envelope = clip.envelope?.filter((point) => point.tick >= delta).map((point) => ({ ...point, tick: point.tick - delta }));
            const changed: ArrangementClip = { ...clip, startTick: verb.startTick, lengthTick, sourceStart };
            if (sourceStart === 0) delete changed.sourceStart;
            if (envelope?.length) changed.envelope = envelope; else delete changed.envelope;
            if (changed.fadeIn && changed.fadeIn.lengthTick > lengthTick) changed.fadeIn = { ...changed.fadeIn, lengthTick };
            if (changed.fadeOut && changed.fadeOut.lengthTick > lengthTick) changed.fadeOut = { ...changed.fadeOut, lengthTick };
            return { next: updateClip(arr, verb.clipId, () => changed), inverse: { kind: 'compound', verbs: [{ kind: 'removeClip', clipId: verb.clipId }, { kind: 'addClip', trackId: locateClip(arr, verb.clipId).track.id!, clip }] } };
        }
        case 'trimClipEnd': {
            const { clip, track } = locateClip(arr, verb.clipId);
            const lengthTick = verb.endTick - clip.startTick;
            if (!(lengthTick > 0)) fail('invalid end trim');
            const changed: ArrangementClip = { ...clip, lengthTick };
            const envelope = clip.envelope?.filter((point) => point.tick <= lengthTick);
            if (envelope?.length) changed.envelope = envelope; else delete changed.envelope;
            if (changed.fadeIn && changed.fadeIn.lengthTick > lengthTick) changed.fadeIn = { ...changed.fadeIn, lengthTick };
            if (changed.fadeOut && changed.fadeOut.lengthTick > lengthTick) changed.fadeOut = { ...changed.fadeOut, lengthTick };
            return { next: updateClip(arr, verb.clipId, () => changed), inverse: { kind: 'compound', verbs: [{ kind: 'removeClip', clipId: verb.clipId }, { kind: 'addClip', trackId: track.id!, clip }] } };
        }
        case 'slipClip': {
            if (verb.sourceStart < 0) fail('source start cannot be negative');
            const { clip } = locateClip(arr, verb.clipId);
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, 'sourceStart', verb.sourceStart || undefined)), inverse: { kind: 'slipClip', clipId: verb.clipId, sourceStart: clip.sourceStart ?? 0 } };
        }
        case 'splitClip': {
            const { clip, track } = locateClip(arr, verb.clipId);
            if (!(verb.atTick > clip.startTick && verb.atTick < clip.startTick + clip.lengthTick)) fail('split point must be inside the clip');
            const delta = verb.atTick - clip.startTick;
            const defaultFade = Math.max(1, Math.round((arr.ppq ?? 960) * arr.tempoBpm / 60_000));
            const left = { ...verb.left, sourceId: clip.sourceId, startTick: clip.startTick, lengthTick: delta, sourceStart: clip.sourceStart, fadeOut: verb.left.fadeOut ?? { lengthTick: Math.min(defaultFade, delta) } };
            const right = { ...verb.right, sourceId: clip.sourceId, startTick: verb.atTick, lengthTick: clip.lengthTick - delta, sourceStart: (clip.sourceStart ?? 0) + delta, fadeIn: verb.right.fadeIn ?? { lengthTick: Math.min(defaultFade, clip.lengthTick - delta) } };
            if (left.sourceStart === 0) delete left.sourceStart;
            let next = applyVerb(arr, { kind: 'removeClip', clipId: verb.clipId }).next;
            next = addClip(next, track.id!, left);
            next = addClip(next, track.id!, right);
            return { next, inverse: { kind: 'compound', verbs: [{ kind: 'removeClip', clipId: left.id! }, { kind: 'removeClip', clipId: right.id! }, { kind: 'addClip', trackId: track.id!, clip }] } };
        }
        case 'setClipGain': {
            const { clip } = locateClip(arr, verb.clipId);
            if (verb.gain !== undefined && verb.gain < 0) fail('gain cannot be negative');
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, 'gain', verb.gain, (value) => value !== 1)), inverse: { kind: 'setClipGain', clipId: verb.clipId, gain: clip.gain } };
        }
        case 'setClipEnvelope': {
            const { clip } = locateClip(arr, verb.clipId);
            const envelope = verb.envelope?.length ? verb.envelope : undefined;
            if (envelope?.some((point) => point.tick < 0 || point.tick > clip.lengthTick || point.gain < 0)) fail('invalid clip envelope');
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, 'envelope', envelope)), inverse: { kind: 'setClipEnvelope', clipId: verb.clipId, envelope: clip.envelope } };
        }
        case 'setClipFade': {
            const { clip } = locateClip(arr, verb.clipId);
            if (verb.fade && (verb.fade.lengthTick < 0 || verb.fade.lengthTick > clip.lengthTick)) fail('invalid clip fade');
            const key = verb.edge === 'in' ? 'fadeIn' : 'fadeOut';
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, key, verb.fade)), inverse: { kind: 'setClipFade', clipId: verb.clipId, edge: verb.edge, fade: clip[key] } };
        }
        case 'setClipFades': {
            const { clip } = locateClip(arr, verb.clipId);
            if (verb.fadeIn && verb.fadeIn.lengthTick > clip.lengthTick || verb.fadeOut && verb.fadeOut.lengthTick > clip.lengthTick) fail('invalid clip fades');
            let changed = withOptional(clip, 'fadeIn', verb.fadeIn);
            changed = withOptional(changed, 'fadeOut', verb.fadeOut);
            return { next: updateClip(arr, verb.clipId, () => changed), inverse: { kind: 'setClipFades', clipId: verb.clipId, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut } };
        }
        case 'setClipMute': {
            const { clip } = locateClip(arr, verb.clipId);
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, 'mute', verb.mute ? true : undefined)), inverse: { kind: 'setClipMute', clipId: verb.clipId, mute: clip.mute === true } };
        }
        case 'setClipLayerIndex': {
            const { clip } = locateClip(arr, verb.clipId);
            return { next: updateClip(arr, verb.clipId, (item) => withOptional(item, 'layerIndex', verb.layerIndex)), inverse: { kind: 'setClipLayerIndex', clipId: verb.clipId, layerIndex: clip.layerIndex } };
        }
        case 'setClipSource': {
            locateSource(arr, verb.sourceId);
            const { clip } = locateClip(arr, verb.clipId);
            let changed: ArrangementClip = { ...clip, sourceId: verb.sourceId };
            changed = withOptional(changed, 'sourceStart', verb.sourceStart, (value) => value !== 0);
            if (verb.lengthTick !== undefined) changed.lengthTick = verb.lengthTick;
            return { next: updateClip(arr, verb.clipId, () => changed), inverse: { kind: 'setClipSource', clipId: verb.clipId, sourceId: clip.sourceId, sourceStart: clip.sourceStart, lengthTick: clip.lengthTick } };
        }
        case 'duplicateClip': {
            const { clip, track } = locateClip(arr, verb.clipId);
            let next = arr;
            if (verb.fork) {
                if (!verb.source) fail('forked duplicate needs a source');
                next = applyVerb(next, { kind: 'addSource', source: verb.source }).next;
            }
            const duplicate = { ...verb.clip, sourceId: verb.fork ? verb.source!.id : clip.sourceId, startTick: verb.startTick };
            next = addClip(next, track.id!, duplicate);
            const undo: Verb[] = [{ kind: 'removeClip', clipId: duplicate.id! }];
            if (verb.fork) undo.push({ kind: 'removeSource', sourceId: verb.source!.id });
            return { next, inverse: { kind: 'compound', verbs: undo } };
        }
        case 'addNote': {
            if (!verb.note.id) fail('addNote needs an id');
            const source = locateSource(arr, verb.sourceId);
            if (source.kind !== 'midi') fail('notes can only be added to MIDI sources');
            return { next: replaceSource(arr, verb.sourceId, { ...source, notes: insertAt(source.notes, verb.index, verb.note) }), inverse: { kind: 'removeNote', noteId: verb.note.id } };
        }
        case 'removeNote': {
            const { sourceId, source, ni, note } = locateNote(arr, verb.noteId);
            return { next: replaceSource(arr, sourceId, { ...source, notes: removeAt(source.notes, ni) }), inverse: { kind: 'addNote', sourceId, index: ni, note } };
        }
        case 'editNote': {
            const { sourceId, source, ni, note } = locateNote(arr, verb.noteId);
            const before: NotePatch = {};
            const changed = { ...note };
            for (const key of Object.keys(verb.patch) as (keyof NotePatch)[]) {
                before[key] = note[key] as number | undefined;
                const value = verb.patch[key];
                if (value === undefined) delete changed[key];
                else changed[key] = value;
            }
            return { next: replaceSource(arr, sourceId, { ...source, notes: replaceAt(source.notes, ni, changed) }), inverse: { kind: 'editNote', noteId: verb.noteId, patch: before } };
        }
        case 'addLocation': {
            validateLocation(arr, verb.location);
            if ((arr.locations ?? []).some((location) => location.id === verb.location.id)) fail(`location "${verb.location.id}" already exists`);
            return { next: { ...arr, locations: insertAt(arr.locations ?? [], verb.index, verb.location) }, inverse: { kind: 'removeLocation', locationId: verb.location.id! } };
        }
        case 'removeLocation': {
            const { index, location } = locateLocation(arr, verb.locationId);
            if (location.kind === 'songRange') fail('songRange cannot be removed');
            const locations = removeAt(arr.locations ?? [], index);
            const next = { ...arr };
            if (locations.length) next.locations = locations; else delete next.locations;
            return { next, inverse: { kind: 'addLocation', index, location } };
        }
        case 'moveLocation': {
            const { index, location } = locateLocation(arr, verb.locationId);
            if (location.locked) fail(`location "${verb.locationId}" is locked`);
            let changed: Location = { ...location, startTick: verb.startTick };
            changed = withOptional(changed, 'endTick', verb.endTick);
            validateLocation(arr, changed, location.id);
            return { next: { ...arr, locations: replaceAt(arr.locations ?? [], index, changed) }, inverse: { kind: 'moveLocation', locationId: verb.locationId, startTick: location.startTick, endTick: location.endTick } };
        }
        case 'setLocationName': {
            const { index, location } = locateLocation(arr, verb.locationId);
            return { next: { ...arr, locations: replaceAt(arr.locations ?? [], index, { ...location, name: verb.name }) }, inverse: { kind: 'setLocationName', locationId: verb.locationId, name: location.name } };
        }
        case 'setLocationLocked': {
            const { index, location } = locateLocation(arr, verb.locationId);
            return { next: { ...arr, locations: replaceAt(arr.locations ?? [], index, withOptional(location, 'locked', verb.locked ? true : undefined)) }, inverse: { kind: 'setLocationLocked', locationId: verb.locationId, locked: location.locked === true } };
        }
        case 'setLoopRange':
        case 'setPunchRange': {
            const kind = verb.kind === 'setLoopRange' ? 'loop' : 'punch';
            const existingIndex = (arr.locations ?? []).findIndex((location) => location.kind === kind);
            const existing = existingIndex >= 0 ? arr.locations![existingIndex]! : undefined;
            let locations = arr.locations ?? [];
            if (verb.location) {
                const location: Location = { ...verb.location, kind };
                validateLocation(arr, location, existing?.id);
                locations = existing ? replaceAt(locations, existingIndex, location) : [...locations, location];
            } else if (existing) locations = removeAt(locations, existingIndex);
            else fail(`no ${kind} range to remove`);
            const next = { ...arr };
            if (locations.length) next.locations = locations; else delete next.locations;
            return { next, inverse: { kind: verb.kind, location: existing } };
        }
        case 'ripple':
        case 'rippleTracks': {
            if (verb.deltaTick === 0) fail('ripple delta cannot be zero');
            const trackIds = new Set(verb.trackIds);
            for (const id of trackIds) locateTrack(arr, id);
            const excluded = new Set(verb.excludeClipIds ?? []);
            const explicit = verb.clipIds ? new Set(verb.clipIds) : undefined;
            const movedIds: string[] = [];
            const tracks = arr.tracks.map((track) => {
                if (!track.id || !trackIds.has(track.id)) return track;
                const moving = new Set(track.clips.filter((clip) => explicit ? explicit.has(clip.id!) : clip.startTick >= verb.atTick && !excluded.has(clip.id!)).map((clip) => clip.id!));
                const changed = track.clips.map((clip) => moving.has(clip.id!) ? { ...clip, startTick: clip.startTick + verb.deltaTick } : clip);
                if (changed.some((clip) => clip.startTick < 0)) fail('ripple would move a clip below zero');
                for (let i = 0; i < changed.length; i++) for (let j = i + 1; j < changed.length; j++) {
                    if (moving.has(changed[i]!.id!) === moving.has(changed[j]!.id!)) continue;
                    const overlaps = changed[i]!.startTick < changed[j]!.startTick + changed[j]!.lengthTick && changed[j]!.startTick < changed[i]!.startTick + changed[i]!.lengthTick;
                    if (overlaps) fail('ripple would create a clip overlap');
                }
                movedIds.push(...moving);
                return { ...track, clips: sortedClips(changed) };
            });
            const allowedLocation = (location: Location) => !location.locked && !['loop', 'punch', 'songRange'].includes(location.kind);
            const explicitLocations = verb.locationIds ? new Set(verb.locationIds) : undefined;
            const locationIds: string[] = [];
            const locations = (arr.locations ?? []).map((location) => {
                const moving = verb.includeLocations && allowedLocation(location) && (explicitLocations ? explicitLocations.has(location.id!) : location.startTick >= verb.atTick);
                if (!moving) return location;
                const startTick = location.startTick + verb.deltaTick;
                const endTick = location.endTick === undefined ? undefined : location.endTick + verb.deltaTick;
                if (startTick < 0) fail('ripple would move a location below zero');
                locationIds.push(location.id!);
                return withOptional({ ...location, startTick }, 'endTick', endTick);
            });
            const next: Arrangement = { ...arr, tracks };
            if (arr.locations) next.locations = locations;
            return { next, inverse: { ...verb, deltaTick: -verb.deltaTick, clipIds: movedIds, locationIds } };
        }
        case 'insertTime': {
            if (!(verb.durationTick > 0) || verb.atTick < 0) fail('invalid insert range');
            const ids = new Set(verb.trackIds);
            for (const id of ids) locateTrack(arr, id);
            const existingIds = new Set(arr.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
            const tracks = arr.tracks.map((track) => {
                if (!track.id || !ids.has(track.id)) return track;
                const clips: ArrangementClip[] = [];
                for (const clip of track.clips) {
                    const end = clip.startTick + clip.lengthTick;
                    if (clip.startTick >= verb.atTick) clips.push({ ...clip, startTick: clip.startTick + verb.durationTick });
                    else if (end > verb.atTick && verb.splitIntersected) {
                        const leftLength = verb.atTick - clip.startTick;
                        let rightId = `${clip.id}.split`;
                        let suffix = 2;
                        while (existingIds.has(rightId)) rightId = `${clip.id}.split#${suffix++}`;
                        existingIds.add(rightId);
                        clips.push({ ...clip, lengthTick: leftLength });
                        clips.push({ ...clip, id: rightId, startTick: verb.atTick + verb.durationTick, lengthTick: end - verb.atTick, sourceStart: (clip.sourceStart ?? 0) + leftLength });
                    } else clips.push(clip);
                }
                return { ...track, clips: sortedClips(clips) };
            });
            const locations = verb.moveLocations ? (arr.locations ?? []).map((location) => location.startTick >= verb.atTick && !location.locked ? withOptional({ ...location, startTick: location.startTick + verb.durationTick }, 'endTick', location.endTick === undefined ? undefined : location.endTick + verb.durationTick) : location) : arr.locations;
            const next: Arrangement = { ...arr, tracks };
            if (locations) next.locations = locations;
            const inverse = restoreTracksInverse(arr, next, verb.trackIds) as Extract<Verb, { kind: 'compound' }>;
            if (verb.moveLocations && arr.locations) for (const location of arr.locations) {
                const changed = next.locations?.find((item) => item.id === location.id);
                if (changed && (changed.startTick !== location.startTick || changed.endTick !== location.endTick)) inverse.verbs.push({ kind: 'moveLocation', locationId: location.id!, startTick: location.startTick, endTick: location.endTick });
            }
            return { next, inverse };
        }
        case 'removeTime': {
            if (!(verb.durationTick > 0) || verb.atTick < 0) fail('invalid remove range');
            const cutEnd = verb.atTick + verb.durationTick;
            const ids = new Set(verb.trackIds);
            for (const id of ids) locateTrack(arr, id);
            const existingIds = new Set(arr.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
            const tracks = arr.tracks.map((track) => {
                if (!track.id || !ids.has(track.id)) return track;
                const clips: ArrangementClip[] = [];
                for (const clip of track.clips) {
                    const end = clip.startTick + clip.lengthTick;
                    if (end <= verb.atTick) clips.push(clip);
                    else if (clip.startTick >= cutEnd) clips.push({ ...clip, startTick: clip.startTick - verb.durationTick });
                    else if (clip.startTick >= verb.atTick && end <= cutEnd) continue;
                    else if (clip.startTick < verb.atTick && end <= cutEnd) clips.push({ ...clip, lengthTick: verb.atTick - clip.startTick });
                    else if (clip.startTick >= verb.atTick && end > cutEnd) clips.push({ ...clip, startTick: verb.atTick, lengthTick: end - cutEnd, sourceStart: (clip.sourceStart ?? 0) + (cutEnd - clip.startTick) });
                    else {
                        let rightId = `${clip.id}.remove-right`;
                        let suffix = 2;
                        while (existingIds.has(rightId)) rightId = `${clip.id}.remove-right#${suffix++}`;
                        existingIds.add(rightId);
                        clips.push({ ...clip, lengthTick: verb.atTick - clip.startTick });
                        clips.push({ ...clip, id: rightId, startTick: verb.atTick, lengthTick: end - cutEnd, sourceStart: (clip.sourceStart ?? 0) + (cutEnd - clip.startTick) });
                    }
                }
                return { ...track, clips: sortedClips(clips) };
            });
            const locations = verb.moveLocations ? (arr.locations ?? []).map((location) => {
                if (location.locked || location.startTick < cutEnd) return location;
                return withOptional({ ...location, startTick: location.startTick - verb.durationTick }, 'endTick', location.endTick === undefined ? undefined : location.endTick - verb.durationTick);
            }) : arr.locations;
            const next: Arrangement = { ...arr, tracks };
            if (locations) next.locations = locations;
            const inverse = restoreTracksInverse(arr, next, verb.trackIds) as Extract<Verb, { kind: 'compound' }>;
            if (verb.moveLocations && arr.locations) for (const location of arr.locations) {
                const changed = next.locations?.find((item) => item.id === location.id);
                if (changed && (changed.startTick !== location.startTick || changed.endTick !== location.endTick)) inverse.verbs.push({ kind: 'moveLocation', locationId: location.id!, startTick: location.startTick, endTick: location.endTick });
            }
            return { next, inverse };
        }
        case 'stretchClip': {
            if (!(verb.timeRatio > 0) || !(verb.pitchRatio > 0)) fail('stretch ratios must be positive');
            const { clip, track } = locateClip(arr, verb.clipId);
            let next = applyVerb(arr, { kind: 'addSource', source: verb.newSource }).next;
            next = applyVerb(next, { kind: 'removeClip', clipId: verb.clipId }).next;
            next = addClip(next, track.id!, verb.newClip);
            return { next, inverse: { kind: 'compound', verbs: [{ kind: 'removeClip', clipId: verb.newClip.id! }, { kind: 'addClip', trackId: track.id!, clip }, { kind: 'removeSource', sourceId: verb.newSource.id }] } };
        }
        case 'bounceClips': {
            if (!(verb.toTick > verb.fromTick)) fail('invalid bounce range');
            const { track } = locateTrack(arr, verb.trackId);
            const originals = track.clips.filter((clip) => clip.startTick < verb.toTick && clip.startTick + clip.lengthTick > verb.fromTick);
            let next = applyVerb(arr, { kind: 'addSource', source: verb.newSource }).next;
            for (const clip of originals) next = applyVerb(next, { kind: 'removeClip', clipId: clip.id! }).next;
            next = addClip(next, verb.trackId, verb.newClip);
            return { next, inverse: { kind: 'compound', verbs: [{ kind: 'removeClip', clipId: verb.newClip.id! }, { kind: 'removeSource', sourceId: verb.newSource.id }, ...originals.map((clip) => ({ kind: 'addClip', trackId: verb.trackId, clip } as Verb))] } };
        }
        case 'setTempo':
            return { next: { ...arr, tempoBpm: verb.tempoBpm }, inverse: { kind: 'setTempo', tempoBpm: arr.tempoBpm } };
        case 'setTimeSignature': {
            const previous = arr.timeSignature ?? [4, 4];
            return { next: { ...arr, timeSignature: verb.timeSignature }, inverse: { kind: 'setTimeSignature', timeSignature: previous } };
        }
        case 'addAutomationLane': {
            if (!verb.lane.id) fail('addAutomationLane needs an id');
            const { ti } = locateTrack(arr, verb.trackId);
            return { next: mapTrack(arr, ti, (track) => ({ ...track, automation: insertAt(track.automation ?? [], verb.index, verb.lane) })), inverse: { kind: 'removeAutomationLane', laneId: verb.lane.id } };
        }
        case 'removeAutomationLane': {
            const { ti, li, track, lane } = locateLane(arr, verb.laneId);
            const next = mapTrack(arr, ti, (item) => {
                const lanes = removeAt(item.automation ?? [], li);
                return withOptional(item, 'automation', lanes.length ? lanes : undefined);
            });
            return { next, inverse: { kind: 'addAutomationLane', trackId: track.id!, index: li, lane } };
        }
        case 'setAutomationPoint': {
            const { ti, li, lane } = locateLane(arr, verb.laneId);
            const index = lane.points.findIndex((point) => point.tick === verb.point.tick);
            const points = [...(index >= 0 ? removeAt(lane.points, index) : lane.points), verb.point].sort((a, b) => a.tick - b.tick);
            const next = mapTrack(arr, ti, (track) => ({ ...track, automation: replaceAt(track.automation ?? [], li, { ...lane, points }) }));
            return { next, inverse: index >= 0 ? { kind: 'setAutomationPoint', laneId: verb.laneId, point: lane.points[index]! } : { kind: 'removeAutomationPoint', laneId: verb.laneId, tick: verb.point.tick } };
        }
        case 'removeAutomationPoint': {
            const { ti, li, lane } = locateLane(arr, verb.laneId);
            const index = lane.points.findIndex((point) => point.tick === verb.tick);
            if (index < 0) fail(`lane "${verb.laneId}" has no point at tick ${verb.tick}`);
            const next = mapTrack(arr, ti, (track) => ({ ...track, automation: replaceAt(track.automation ?? [], li, { ...lane, points: removeAt(lane.points, index) }) }));
            return { next, inverse: { kind: 'setAutomationPoint', laneId: verb.laneId, point: lane.points[index]! } };
        }
    }
}

export function applyVerbs(arr: Arrangement, verbs: Verb[]): { next: Arrangement; inverse: Verb[] } {
    let next = arr;
    const inverse: Verb[] = [];
    for (const verb of verbs) {
        const result = applyVerb(next, verb);
        next = result.next;
        inverse.unshift(result.inverse);
    }
    return { next, inverse };
}
