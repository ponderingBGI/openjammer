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
import { getExecutor } from '../audio/executor';
import { conduct } from '../song/conduct';
import { normalizeArrangement } from '../song/normalize';
import { applyVerbs, type Verb } from '../song/verbs';
import { arrangementLengthTicks, secondsPerTick } from '../song/time';
import type { Arrangement } from '../song/types';
import { logger } from '../utils/log';

const log = logger('song');

/** Read AudioContext.currentTime, or 0 when there is no context (tests / pre-audio). */
function clockNow(): number {
    return getAudioContext()?.currentTime ?? 0;
}

/** The auto-stop timer: fires `stop()` when playback reaches the song's end (incl. the
 *  conduct release tail), so isPlaying never lies and the canvas graph is restored. */
let endTimer: ReturnType<typeof setTimeout> | null = null;
function clearEndTimer(): void {
    if (endTimer !== null) {
        clearTimeout(endTimer);
        endTimer = null;
    }
}

/**
 * Start (or re-anchor) live audio preview of `arr` from `playheadTick`, and arm the
 * end-of-song auto-stop. Conducts to the wasm backend and hands the graph + schedule
 * to the executor's look-ahead scheduler. Wrapped so a lowering/engine hiccup NEVER
 * breaks the transport — the playhead still moves; a held note beats a glitch. The
 * browser tier plays; the native tier logs + no-ops. `onEnd` is the store's `stop`.
 */
function startPreview(arr: Arrangement, playheadTick: number, onEnd: () => void): void {
    clearEndTimer();
    try {
        const startSec = playheadTick * secondsPerTick(arr);
        // LENIENT: a track with an unresolved ref is skipped (the rest of the song still
        // plays) — a held note beats a glitch. The headless bounce stays strict.
        const { graph, events, seconds, skipped } = conduct(arr, 'wasm', { lenient: true });
        if (skipped.length > 0) {
            log.warn('timeline preview skipped tracks with unresolved refs (the rest plays)', {
                detail: skipped.join(', '),
            });
        }
        getExecutor().startArrangementPreview(graph, events, startSec);
        // Auto-stop at the end of the song (conduct.seconds includes the release tail),
        // so the UI never claims to be playing a finished song and the canvas graph is
        // restored. A small slop keeps a final note/tail from being clipped.
        const remainSec = Math.max(0, seconds - startSec);
        endTimer = setTimeout(onEnd, remainSec * 1000 + 80);
    } catch (err) {
        log.warn('timeline preview could not start; the transport still runs (visual only)', {
            detail: err instanceof Error ? err.message : String(err),
        });
    }
}

/** Stop live audio preview (release held notes + restore the canvas graph). Never throws. */
function stopPreview(): void {
    clearEndTimer();
    try {
        getExecutor().stopArrangementPreview();
    } catch {
        // No executor / already stopped — the transport state is authoritative.
    }
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
    /** Monotonic authoring-document revision. Transport, selection, and previews do not bump it. */
    docVersion: number;

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
    /** Apply one verb or an atomic batch. Preview applications are transient; the
     * next non-preview application commits one history entry and re-anchors once. */
    apply: (verb: Verb | Verb[], options?: { preview?: boolean }) => void;
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

export const useArrangementStore = create<ArrangementStore>((set, get) => {
    let previewBase: Arrangement | null = null;
    /**
     * (Re)anchor BOTH clocks to `fromTick` and (re)start the audio preview from there.
     * The ONE path that keeps the playhead, the audio, and isPlaying in lockstep — used
     * on play, on seek-while-playing, and on edit-while-playing — so a seek never strands
     * a note and an edit is always HEARD (the agent-first-class promise). Only ever
     * called while playing.
     */
    const reanchor = (arr: Arrangement, fromTick: number): void => {
        set({ playheadTick: fromTick, playAnchorSec: clockNow() });
        startPreview(arr, fromTick, () => get().stop());
    };

    return {
        arrangement: null,
        undoStack: [],
        redoStack: [],
        docVersion: 0,
        selectedClipId: null,
        selectedNoteIds: [],
        isPlaying: false,
        playheadTick: 0,
        playAnchorSec: null,

        setArrangement: (arr) => {
            // Loading a new song stops any preview of the old one (release + restore).
            stopPreview();
            const normalized = arr ? normalizeArrangement(arr) : null;
            previewBase = null;
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

        apply: (verb, options) => {
            const current = get().arrangement;
            const isPreview = options?.preview === true;
            const arr = previewBase ?? current;
            if (!arr) return;
            const verbs = Array.isArray(verb) ? verb : [verb];
            if (verbs.length === 0) return;
            const { next, inverse } = applyVerbs(arr, verbs);
            if (isPreview) {
                previewBase ??= arr;
                set({ arrangement: next });
                return;
            }
            previewBase = null;
            // A new edit clears the redo branch (standard linear-history semantics).
            set({
                arrangement: next,
                undoStack: [...get().undoStack, inverse],
                redoStack: [],
                docVersion: get().docVersion + 1,
            });
            // Edit-while-playing: re-conduct + restart from the live position so the
            // edit is HEARD and audio/playhead stay in sync.
            if (get().isPlaying) reanchor(next, Math.floor(get().currentTick()));
        },

        undo: () => {
            const arr = previewBase ?? get().arrangement;
            const undoStack = get().undoStack;
            if (!arr || undoStack.length === 0) return;
            previewBase = null;
            const inverseBatch = undoStack[undoStack.length - 1]!;
            const { next, inverse } = applyVerbs(arr, inverseBatch);
            set({
                arrangement: next,
                undoStack: undoStack.slice(0, -1),
                redoStack: [...get().redoStack, inverse], // inverse-of-inverse = the redo
                docVersion: get().docVersion + 1,
            });
            if (get().isPlaying) reanchor(next, Math.floor(get().currentTick()));
        },

        redo: () => {
            const arr = previewBase ?? get().arrangement;
            const redoStack = get().redoStack;
            if (!arr || redoStack.length === 0) return;
            previewBase = null;
            const forwardBatch = redoStack[redoStack.length - 1]!;
            const { next, inverse } = applyVerbs(arr, forwardBatch);
            set({
                arrangement: next,
                redoStack: redoStack.slice(0, -1),
                undoStack: [...get().undoStack, inverse],
                docVersion: get().docVersion + 1,
            });
            if (get().isPlaying) reanchor(next, Math.floor(get().currentTick()));
        },

        canUndo: () => get().undoStack.length > 0,
        canRedo: () => get().redoStack.length > 0,

        mintId: (prefix) => `${prefix}-${idCounter++}`,

        selectClip: (clipId) => set({ selectedClipId: clipId, selectedNoteIds: [] }),
        selectNotes: (noteIds) => set({ selectedNoteIds: noteIds }),

        play: () => {
            if (get().isPlaying) return;
            const arr = get().arrangement;
            set({ isPlaying: true, playAnchorSec: clockNow() });
            if (arr) reanchor(arr, get().playheadTick);
        },

        stop: () => {
            if (!get().isPlaying) return;
            // Freeze the playhead exactly where it is (never snap back to 0).
            set({ isPlaying: false, playheadTick: get().currentTick(), playAnchorSec: null });
            stopPreview();
        },

        seek: (tick) => {
            const arr = get().arrangement;
            const max = arr ? arrangementLengthTicks(arr) : 0;
            const clamped = Math.max(0, Math.min(tick, max));
            if (get().isPlaying && arr) {
                // Re-anchor BOTH clocks + restart the audio from the new spot, releasing
                // any note that was sounding (no stranded voice while the playhead moves).
                reanchor(arr, clamped);
            } else {
                set({ playheadTick: clamped, playAnchorSec: null });
            }
        },

        currentTick: () => {
            const { arrangement, isPlaying, playheadTick, playAnchorSec } = get();
            if (!isPlaying || playAnchorSec === null || !arrangement) return playheadTick;
            const elapsedSec = clockNow() - playAnchorSec;
            const tick = playheadTick + elapsedSec / secondsPerTick(arrangement);
            // The playhead stops at the song end (it does not run off the ruler).
            return Math.min(tick, arrangementLengthTicks(arrangement));
        },
    };
});
