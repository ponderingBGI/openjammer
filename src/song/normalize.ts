// src/song/normalize.ts — stamp a stable identity onto every addressable entity of
// an Arrangement (tracks, clips, notes, automation lanes, sections). The timeline
// GUI's selection, drag, and the agent's reversible verbs all name an entity by id;
// the command-log undo replays a verb against the same id after other edits. So an
// id must (1) be present on every entity, (2) survive edits to that entity's content
// (you can move a clip without its id changing), and (3) round-trip through a saved
// project. `normalizeArrangement` provides (1) by stamping wherever an id is absent;
// the verb layer provides fresh ids for new entities so (2) holds across edits.
//
// CRUCIAL INVARIANT: `conduct` keys off `ref`/`tick`/`param`/`pitch` and NEVER reads
// an id, so `conduct(arr)` is byte-identical to `conduct(normalizeArrangement(arr))`.
// Ids are a Tier-4 authoring/UI concern that the lowering is blind to (proven by a
// conduct-equality test). Stamping is deterministic and idempotent: a second
// normalize is a no-op, and the same structure always yields the same ids — so a
// golden arrangement (paperSketch) gets the same ids every run.

import type {
    Arrangement,
    ArrangementClip,
    ArrangementNote,
    ArrangementSection,
    ArrangementTrack,
    AutomationLane,
} from './types';

/**
 * A deterministic, collision-free id allocator. Prefers an entity's EXISTING id (so
 * normalize is idempotent and stable across edits); falls back to a readable,
 * structure-derived id where absent. If two entities would collide (a hand-authored
 * duplicate, or a fallback that clashes with a pre-existing explicit id), the later
 * one is de-collided deterministically with a `#n` suffix — never silently merged.
 */
class IdMint {
    private readonly seen = new Set<string>();

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
}

function normalizeNote(note: ArrangementNote, mint: IdMint, clipId: string, i: number): ArrangementNote {
    return { ...note, id: mint.take(note.id, `${clipId}.n${i}`) };
}

function normalizeClip(clip: ArrangementClip, mint: IdMint, trackId: string, i: number): ArrangementClip {
    const id = mint.take(clip.id, `${trackId}.c${i}`);
    // A second, INNER mint per clip keeps note fallbacks unique within the clip while
    // staying stable regardless of how many notes other clips hold (a note's id is
    // derived from its OWN clip's id, never a global counter).
    const noteMint = new IdMint();
    return { ...clip, id, notes: clip.notes.map((n, ni) => normalizeNote(n, noteMint, id, ni)) };
}

function normalizeLane(lane: AutomationLane, mint: IdMint, trackId: string, i: number): AutomationLane {
    return { ...lane, id: mint.take(lane.id, `${trackId}.a${i}`) };
}

function normalizeTrack(track: ArrangementTrack, mint: IdMint, i: number): ArrangementTrack {
    const id = mint.take(track.id, `t${i}`);
    const clipMint = new IdMint();
    const clips = track.clips.map((c, ci) => normalizeClip(c, clipMint, id, ci));
    const out: ArrangementTrack = { ...track, id, clips };
    if (track.automation) {
        const laneMint = new IdMint();
        out.automation = track.automation.map((l, li) => normalizeLane(l, laneMint, id, li));
    }
    return out;
}

function normalizeSection(section: ArrangementSection, mint: IdMint, i: number): ArrangementSection {
    return { ...section, id: mint.take(section.id, `s${i}`) };
}

/**
 * Return a structurally-identical Arrangement in which every track, clip, note,
 * automation lane, and section carries a stable `id`. Pure: the input is not
 * mutated, existing ids are preserved verbatim, and the result deep-equals the input
 * everywhere except the added/filled `id` fields. Idempotent:
 * `normalizeArrangement(normalizeArrangement(a))` deep-equals `normalizeArrangement(a)`.
 */
export function normalizeArrangement(arr: Arrangement): Arrangement {
    const trackMint = new IdMint();
    const tracks = arr.tracks.map((t, i) => normalizeTrack(t, trackMint, i));
    const out: Arrangement = { ...arr, tracks };
    if (arr.sections) {
        const sectionMint = new IdMint();
        out.sections = arr.sections.map((s, i) => normalizeSection(s, sectionMint, i));
    }
    return out;
}
