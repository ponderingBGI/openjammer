// src/store/arrangementStore.ts — the runtime single source of truth for the ONE
// song timeline. A human GUI drag, the in-app Pi agent, and a headless agent all
// drive THIS store through the same reversible `Verb`s (src/song/verbs.ts), and one
// command-log gives them one Ctrl+Z. The store never lowers audio itself — `conduct`
// does — it holds the authoring document, selection, and transport.
//
// Invariant: `arrangement` is ALWAYS normalized (every track/clip/note/lane/section
// has a stable id), so selection and the command-log can name any entity. Transport
// is anchored to AudioContext.currentTime so the playhead is sample-accurate and
// FREEZES (never jumps) on stop — the Live Performance Rule at the timeline surface.

import { create } from 'zustand';
import { getAudioContext } from '../audio/audioContext';
import { normalizeArrangement } from '../song/normalize';
import { applyVerbs, type Verb } from '../song/verbs';
import { arrangementLengthTicks, secondsPerTick } from '../song/time';
import type { Arrangement } from '../song/types';

/** Read AudioContext.currentTime, or 0 when there is no context (tests / pre-audio). */
function clockNow(): number {
    return getAudioContext()?.currentTime ?? 0;
}

/**
 * Seed a monotonic id counter ABOVE any `${prefix}-<n>` already present in the
 * arrangement, so ids minted this session never collide with ones a prior session
 * (reloaded from disk) already used. Structural normalize ids (`t0`, `t0.c1`) use a
 * different shape and are left alone.
 */
function seedCounter(arr: Arrangement): number {
    let max = 0;
    const scan = (id: string | undefined) => {
        if (!id) return;
        const m = /-(\d+)$/.exec(id);
        if (m) max = Math.max(max, Number(m[1]));
    };
    for (const t of arr.tracks) {
        scan(t.id);
        for (const c of t.clips) {
            scan(c.id);
            for (const n of c.notes) scan(n.id);
        }
        for (const l of t.automation ?? []) scan(l.id);
    }
    for (const s of arr.sections ?? []) scan(s.id);
    return max + 1;
}

export interface ArrangementStore {
    /** The current song (always normalized), or null when no song is open. */
    arrangement: Arrangement | null;

    // ── command-log: one shared undo for human + agent ──
    /** Stacks of inverse/forward verb batches (LIFO). Not for direct UI reads. */
    undoStack: Verb[][];
    redoStack: Verb[][];

    // ── selection (UI) ──
    selectedClipId: string | null;
    selectedNoteIds: string[];

    // ── transport ──
    isPlaying: boolean;
    /** Playhead tick anchor: the frozen position when stopped, or the position at
     * `playAnchorSec` when playing. */
    playheadTick: number;
    /** AudioContext.currentTime when playback started (null when stopped). */
    playAnchorSec: number | null;

    // ── actions ──
    /** Load a song (normalized on entry); resets the command-log + transport. */
    setArrangement: (arr: Arrangement | null) => void;
    /** Apply one verb or an atomic batch, logging the inverse for undo. */
    apply: (verb: Verb | Verb[]) => void;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** Mint a fresh, collision-free entity id (e.g. `mintId('clip')` → `clip-7`). */
    mintId: (prefix: string) => string;

    selectClip: (clipId: string | null) => void;
    selectNotes: (noteIds: string[]) => void;

    play: () => void;
    stop: () => void;
    /** Move the playhead to a tick (keeps playing if it was playing). */
    seek: (tick: number) => void;
    /** The live playhead tick RIGHT NOW (derived from the clock while playing). */
    currentTick: () => number;
}

let idCounter = 1;

export const useArrangementStore = create<ArrangementStore>((set, get) => ({
    arrangement: null,
    undoStack: [],
    redoStack: [],
    selectedClipId: null,
    selectedNoteIds: [],
    isPlaying: false,
    playheadTick: 0,
    playAnchorSec: null,

    setArrangement: (arr) => {
        const normalized = arr ? normalizeArrangement(arr) : null;
        idCounter = normalized ? seedCounter(normalized) : 1;
        set({
            arrangement: normalized,
            undoStack: [],
            redoStack: [],
            selectedClipId: null,
            selectedNoteIds: [],
            isPlaying: false,
            playheadTick: 0,
            playAnchorSec: null,
        });
    },

    apply: (verb) => {
        const arr = get().arrangement;
        if (!arr) return;
        const verbs = Array.isArray(verb) ? verb : [verb];
        if (verbs.length === 0) return;
        const { next, inverse } = applyVerbs(arr, verbs);
        // A new edit clears the redo branch (standard linear-history semantics).
        set({ arrangement: next, undoStack: [...get().undoStack, inverse], redoStack: [] });
    },

    undo: () => {
        const arr = get().arrangement;
        const undoStack = get().undoStack;
        if (!arr || undoStack.length === 0) return;
        const inverseBatch = undoStack[undoStack.length - 1]!;
        const { next, inverse } = applyVerbs(arr, inverseBatch);
        set({
            arrangement: next,
            undoStack: undoStack.slice(0, -1),
            redoStack: [...get().redoStack, inverse], // inverse-of-inverse = the redo
        });
    },

    redo: () => {
        const arr = get().arrangement;
        const redoStack = get().redoStack;
        if (!arr || redoStack.length === 0) return;
        const forwardBatch = redoStack[redoStack.length - 1]!;
        const { next, inverse } = applyVerbs(arr, forwardBatch);
        set({
            arrangement: next,
            redoStack: redoStack.slice(0, -1),
            undoStack: [...get().undoStack, inverse],
        });
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,

    mintId: (prefix) => `${prefix}-${idCounter++}`,

    selectClip: (clipId) => set({ selectedClipId: clipId, selectedNoteIds: [] }),
    selectNotes: (noteIds) => set({ selectedNoteIds: noteIds }),

    play: () => {
        if (get().isPlaying) return;
        set({ isPlaying: true, playAnchorSec: clockNow() });
    },

    stop: () => {
        if (!get().isPlaying) return;
        // Freeze the playhead exactly where it is (never snap back to 0).
        set({ isPlaying: false, playheadTick: get().currentTick(), playAnchorSec: null });
    },

    seek: (tick) => {
        const arr = get().arrangement;
        const max = arr ? arrangementLengthTicks(arr) : 0;
        const clamped = Math.max(0, Math.min(tick, max));
        // Re-anchor so a seek while playing continues smoothly from the new spot.
        set({ playheadTick: clamped, playAnchorSec: get().isPlaying ? clockNow() : null });
    },

    currentTick: () => {
        const { arrangement, isPlaying, playheadTick, playAnchorSec } = get();
        if (!isPlaying || playAnchorSec === null || !arrangement) return playheadTick;
        const elapsedSec = clockNow() - playAnchorSec;
        const tick = playheadTick + elapsedSec / secondsPerTick(arrangement);
        // The playhead stops at the song end (it does not run off the ruler).
        return Math.min(tick, arrangementLengthTicks(arrangement));
    },
}));
