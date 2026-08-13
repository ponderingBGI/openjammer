// src/song/verbs.ts — the ONE reversible authoring vocabulary for the timeline.
//
// A human GUI drag, the in-app Pi agent, and a headless agent all edit an
// Arrangement through these SAME verbs (extend, never fork — code-value #2). A verb
// is plain serializable DATA (a discriminated union), never a closure: the agent is
// an UNTRUSTED GENERATOR that emits verbs as data, which can be logged, inspected,
// replayed, and — the whole point — inverted. `applyVerb` returns both the next
// Arrangement AND the exact structural inverse, so one command-log holds the deltas
// and a single Ctrl+Z undoes a human drag or an agent edit identically.
//
// Every verb is PURE and FAIL-CLOSED: it throws if it references an id that does not
// exist, rather than silently no-op'ing (a silent miss would desync the undo log).
// `conduct` is blind to ids, so applying verbs never changes the bounce except
// through the musical data the verb actually edits.

import type {
    Arrangement,
    ArrangementClip,
    ArrangementNote,
    ArrangementSection,
    ArrangementTrack,
    AutomationLane,
    AutomationPoint,
} from './types';

/** The fields of a note an `editNote` verb may change (any subset). */
export interface NotePatch {
    tick?: number;
    durTick?: number;
    pitch?: number;
    vel?: number;
}

/**
 * A single reversible edit. Add-verbs carry a FULLY-FORMED entity (with its `id`
 * already minted by the caller) so the inverse can name it; the helpers in this
 * module's caller (the store / agent verb-compiler) mint those ids.
 */
export type Verb =
    | { kind: 'addTrack'; index: number; track: ArrangementTrack }
    | { kind: 'removeTrack'; trackId: string }
    | { kind: 'setTrackMute'; trackId: string; mute: boolean }
    | { kind: 'setTrackName'; trackId: string; name?: string }
    | { kind: 'addClip'; trackId: string; index: number; clip: ArrangementClip }
    | { kind: 'removeClip'; clipId: string }
    | { kind: 'moveClip'; clipId: string; startTick: number }
    | { kind: 'addNote'; clipId: string; index: number; note: ArrangementNote }
    | { kind: 'removeNote'; noteId: string }
    | { kind: 'editNote'; noteId: string; patch: NotePatch }
    | { kind: 'addSection'; index: number; section: ArrangementSection }
    | { kind: 'removeSection'; sectionId: string }
    | { kind: 'setTempo'; tempoBpm: number }
    | { kind: 'addAutomationLane'; trackId: string; index: number; lane: AutomationLane }
    | { kind: 'removeAutomationLane'; laneId: string }
    | { kind: 'setAutomationPoint'; laneId: string; point: AutomationPoint }
    | { kind: 'removeAutomationPoint'; laneId: string; tick: number };

/** The kind tag, for exhaustiveness + UI labels. */
export type VerbKind = Verb['kind'];

function fail(msg: string): never {
    throw new Error(`verb: ${msg}`);
}

// ── locators (fail-closed; return the entity AND its array position so an inverse
//    can restore it exactly where it was) ────────────────────────────────────────

function locateTrack(arr: Arrangement, trackId: string): { ti: number; track: ArrangementTrack } {
    const ti = arr.tracks.findIndex((t) => t.id === trackId);
    if (ti < 0) fail(`no track "${trackId}"`);
    return { ti, track: arr.tracks[ti]! };
}

function locateClip(
    arr: Arrangement,
    clipId: string,
): { ti: number; ci: number; track: ArrangementTrack; clip: ArrangementClip } {
    for (let ti = 0; ti < arr.tracks.length; ti++) {
        const ci = arr.tracks[ti]!.clips.findIndex((c) => c.id === clipId);
        if (ci >= 0) return { ti, ci, track: arr.tracks[ti]!, clip: arr.tracks[ti]!.clips[ci]! };
    }
    return fail(`no clip "${clipId}"`);
}

function locateNote(
    arr: Arrangement,
    noteId: string,
): { ti: number; ci: number; ni: number; clip: ArrangementClip; note: ArrangementNote } {
    for (let ti = 0; ti < arr.tracks.length; ti++) {
        const clips = arr.tracks[ti]!.clips;
        for (let ci = 0; ci < clips.length; ci++) {
            const ni = clips[ci]!.notes.findIndex((n) => n.id === noteId);
            if (ni >= 0)
                return { ti, ci, ni, clip: clips[ci]!, note: clips[ci]!.notes[ni]! };
        }
    }
    return fail(`no note "${noteId}"`);
}

function locateLane(
    arr: Arrangement,
    laneId: string,
): { ti: number; li: number; track: ArrangementTrack; lane: AutomationLane } {
    for (let ti = 0; ti < arr.tracks.length; ti++) {
        const lanes = arr.tracks[ti]!.automation ?? [];
        const li = lanes.findIndex((l) => l.id === laneId);
        if (li >= 0) return { ti, li, track: arr.tracks[ti]!, lane: lanes[li]! };
    }
    return fail(`no automation lane "${laneId}"`);
}

function locateSection(arr: Arrangement, sectionId: string): { si: number; section: ArrangementSection } {
    const sections = arr.sections ?? [];
    const si = sections.findIndex((s) => s.id === sectionId);
    if (si < 0) fail(`no section "${sectionId}"`);
    return { si, section: sections[si]! };
}

// ── immutable array helpers ─────────────────────────────────────────────────────

function insertAt<T>(xs: readonly T[], i: number, x: T): T[] {
    const clamped = Math.max(0, Math.min(i, xs.length));
    return [...xs.slice(0, clamped), x, ...xs.slice(clamped)];
}
function removeAt<T>(xs: readonly T[], i: number): T[] {
    return [...xs.slice(0, i), ...xs.slice(i + 1)];
}
function replaceAt<T>(xs: readonly T[], i: number, x: T): T[] {
    return [...xs.slice(0, i), x, ...xs.slice(i + 1)];
}

/** Replace track `ti` with a transformed copy (other tracks untouched). */
function mapTrack(arr: Arrangement, ti: number, f: (t: ArrangementTrack) => ArrangementTrack): Arrangement {
    return { ...arr, tracks: replaceAt(arr.tracks, ti, f(arr.tracks[ti]!)) };
}

/**
 * Apply one verb to an Arrangement. Returns the next Arrangement and the exact
 * inverse verb (apply the inverse to `next` and you get the original back, value-
 * equal). Pure — the input is not mutated.
 */
export function applyVerb(arr: Arrangement, verb: Verb): { next: Arrangement; inverse: Verb } {
    switch (verb.kind) {
        case 'addTrack': {
            if (!verb.track.id) fail('addTrack needs a track with an id');
            const next = { ...arr, tracks: insertAt(arr.tracks, verb.index, verb.track) };
            return { next, inverse: { kind: 'removeTrack', trackId: verb.track.id } };
        }
        case 'removeTrack': {
            const { ti, track } = locateTrack(arr, verb.trackId);
            const next = { ...arr, tracks: removeAt(arr.tracks, ti) };
            return { next, inverse: { kind: 'addTrack', index: ti, track } };
        }
        case 'setTrackMute': {
            const { ti, track } = locateTrack(arr, verb.trackId);
            const old = track.mute === true;
            // Canonical lean form: a muted track carries `mute: true`; an unmuted one
            // carries NO `mute` key (default = absent), so an inverse restores the
            // original byte-for-byte (never a stray `mute: false`).
            const next = mapTrack(arr, ti, (t) => {
                const copy: ArrangementTrack = { ...t };
                if (verb.mute) copy.mute = true;
                else delete copy.mute;
                return copy;
            });
            return { next, inverse: { kind: 'setTrackMute', trackId: verb.trackId, mute: old } };
        }
        case 'setTrackName': {
            const { ti, track } = locateTrack(arr, verb.trackId);
            const old = track.name;
            // Same canonicalization: an empty name is ABSENT, not `name: undefined`.
            const next = mapTrack(arr, ti, (t) => {
                const copy: ArrangementTrack = { ...t };
                if (verb.name === undefined) delete copy.name;
                else copy.name = verb.name;
                return copy;
            });
            return { next, inverse: { kind: 'setTrackName', trackId: verb.trackId, name: old } };
        }
        case 'addClip': {
            if (!verb.clip.id) fail('addClip needs a clip with an id');
            const { ti } = locateTrack(arr, verb.trackId);
            const next = mapTrack(arr, ti, (t) => ({ ...t, clips: insertAt(t.clips, verb.index, verb.clip) }));
            return { next, inverse: { kind: 'removeClip', clipId: verb.clip.id } };
        }
        case 'removeClip': {
            const { ti, ci, track, clip } = locateClip(arr, verb.clipId);
            const next = mapTrack(arr, ti, (t) => ({ ...t, clips: removeAt(t.clips, ci) }));
            return { next, inverse: { kind: 'addClip', trackId: track.id!, index: ci, clip } };
        }
        case 'moveClip': {
            const { ti, ci, clip } = locateClip(arr, verb.clipId);
            const old = clip.startTick;
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                clips: replaceAt(t.clips, ci, { ...clip, startTick: verb.startTick }),
            }));
            return { next, inverse: { kind: 'moveClip', clipId: verb.clipId, startTick: old } };
        }
        case 'addNote': {
            if (!verb.note.id) fail('addNote needs a note with an id');
            const { ti, ci } = locateClip(arr, verb.clipId);
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                clips: replaceAt(t.clips, ci, {
                    ...t.clips[ci]!,
                    notes: insertAt(t.clips[ci]!.notes, verb.index, verb.note),
                }),
            }));
            return { next, inverse: { kind: 'removeNote', noteId: verb.note.id } };
        }
        case 'removeNote': {
            const { ti, ci, ni, clip, note } = locateNote(arr, verb.noteId);
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                clips: replaceAt(t.clips, ci, { ...clip, notes: removeAt(clip.notes, ni) }),
            }));
            return { next, inverse: { kind: 'addNote', clipId: clip.id!, index: ni, note } };
        }
        case 'editNote': {
            const { ti, ci, ni, clip, note } = locateNote(arr, verb.noteId);
            // The inverse restores ONLY the keys this patch actually changed.
            const before: NotePatch = {};
            for (const k of Object.keys(verb.patch) as (keyof NotePatch)[]) {
                before[k] = note[k] as number | undefined;
            }
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                clips: replaceAt(t.clips, ci, {
                    ...clip,
                    notes: replaceAt(clip.notes, ni, { ...note, ...verb.patch }),
                }),
            }));
            return { next, inverse: { kind: 'editNote', noteId: verb.noteId, patch: before } };
        }
        case 'addSection': {
            if (!verb.section.id) fail('addSection needs a section with an id');
            const next = { ...arr, sections: insertAt(arr.sections ?? [], verb.index, verb.section) };
            return { next, inverse: { kind: 'removeSection', sectionId: verb.section.id } };
        }
        case 'removeSection': {
            const { si, section } = locateSection(arr, verb.sectionId);
            const sections = removeAt(arr.sections ?? [], si);
            // Canonical: no sections = the key ABSENT, never an empty array, so
            // removing the last section restores a pristine arrangement exactly.
            const next: Arrangement = { ...arr };
            if (sections.length > 0) next.sections = sections;
            else delete next.sections;
            return { next, inverse: { kind: 'addSection', index: si, section } };
        }
        case 'setTempo': {
            const old = arr.tempoBpm;
            const next = { ...arr, tempoBpm: verb.tempoBpm };
            return { next, inverse: { kind: 'setTempo', tempoBpm: old } };
        }
        case 'addAutomationLane': {
            if (!verb.lane.id) fail('addAutomationLane needs a lane with an id');
            const { ti } = locateTrack(arr, verb.trackId);
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                automation: insertAt(t.automation ?? [], verb.index, verb.lane),
            }));
            return { next, inverse: { kind: 'removeAutomationLane', laneId: verb.lane.id } };
        }
        case 'removeAutomationLane': {
            const { ti, li, track, lane } = locateLane(arr, verb.laneId);
            const next = mapTrack(arr, ti, (t) => {
                const lanes = removeAt(t.automation ?? [], li);
                // Canonical: a track with no automation carries NO `automation` key,
                // so removing the last lane restores the track shape exactly.
                const copy: ArrangementTrack = { ...t };
                if (lanes.length > 0) copy.automation = lanes;
                else delete copy.automation;
                return copy;
            });
            return { next, inverse: { kind: 'addAutomationLane', trackId: track.id!, index: li, lane } };
        }
        case 'setAutomationPoint': {
            const { ti, li, lane } = locateLane(arr, verb.laneId);
            const existingIdx = lane.points.findIndex((p) => p.tick === verb.point.tick);
            // Keep points sorted by tick (a stepped lane reads left-to-right).
            const without = existingIdx >= 0 ? removeAt(lane.points, existingIdx) : lane.points;
            const points = [...without, verb.point].sort((a, b) => a.tick - b.tick);
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                automation: replaceAt(t.automation ?? [], li, { ...lane, points }),
            }));
            const inverse: Verb =
                existingIdx >= 0
                    ? { kind: 'setAutomationPoint', laneId: verb.laneId, point: lane.points[existingIdx]! }
                    : { kind: 'removeAutomationPoint', laneId: verb.laneId, tick: verb.point.tick };
            return { next, inverse };
        }
        case 'removeAutomationPoint': {
            const { ti, li, lane } = locateLane(arr, verb.laneId);
            const idx = lane.points.findIndex((p) => p.tick === verb.tick);
            if (idx < 0) fail(`lane "${verb.laneId}" has no point at tick ${verb.tick}`);
            const removed = lane.points[idx]!;
            const next = mapTrack(arr, ti, (t) => ({
                ...t,
                automation: replaceAt(t.automation ?? [], li, { ...lane, points: removeAt(lane.points, idx) }),
            }));
            return { next, inverse: { kind: 'setAutomationPoint', laneId: verb.laneId, point: removed } };
        }
    }
}

/** Apply a batch of verbs in order, returning the final Arrangement and the inverse
 * batch (the inverses in REVERSE order — undo the last edit first). An intent
 * compiler ("add a 4-bar lofi drum clip") lowers to one batch so the undo log holds
 * one reversible step the player Ctrl+Z's atomically. */
export function applyVerbs(arr: Arrangement, verbs: Verb[]): { next: Arrangement; inverse: Verb[] } {
    let cur = arr;
    const inverses: Verb[] = [];
    for (const v of verbs) {
        const { next, inverse } = applyVerb(cur, v);
        cur = next;
        inverses.unshift(inverse); // reverse order for correct undo
    }
    return { next: cur, inverse: inverses };
}
