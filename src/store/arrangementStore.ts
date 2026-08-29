// src/store/arrangementStore.ts — the runtime single source of truth for the ONE
// song timeline. A human GUI drag, the in-app Pi agent, and a headless agent all
// drive THIS store through the same reversible `Verb`s (src/song/verbs.ts), and one
// command-log gives them one Ctrl+Z. The store never lowers audio itself — `conduct`
// does — it holds the authoring document, selection, and transport.
//
// Invariant: `arrangement` is ALWAYS normalized (every track/clip/note/lane/section
// has a stable id), so selection and the command-log can name any entity. Transport
// mirrors EngineFrame::Transport. User intent is optimistic for controls, while the
// visible playhead waits for the engine's confirming sample position.

import { create } from 'zustand';
import { getExecutor } from '../audio/executor';
import { isRollingMotion, type TransportFrame } from '../audio/executor/timelinePlayback';
import { conduct } from '../song/conduct';
import { normalizeArrangement } from '../song/normalize';
import { buildTempoMap, sampleToTick, tickToSample } from '../song/tempoMap';
import { applyVerbs, type Verb } from '../song/verbs';
import { arrangementLengthTicks } from '../song/time';
import type { Arrangement } from '../song/types';
import type { CapturedNote } from '@openjammer/oj-protocol';
import { captureResultToVerbs, recordBindings, trackRecordKind, wasmTapToCapturedNote, type RecordTrackBinding } from '../song/recording';
import { logger } from '../utils/log';
import { registerHistoryDriver, useHistoryStore, type EditVerb } from './historyStore';
import { appendMidiRecordJournal, beginMidiRecordJournal, clearMidiRecordJournal } from '../persistence/recovery/midiRecordJournal';
import type { SurfaceId } from './uiViewStore';

const log = logger('song');

const visualNow = (): number => globalThis.performance?.now() ?? Date.now();

/** The auto-stop timer: fires the internal end halt when playback reaches the song's end (incl. the
 *  conduct release tail), so isPlaying never lies and the canvas graph is restored. */
let endTimer: ReturnType<typeof setTimeout> | null = null;
let gesturePublishTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTransportTimer: ReturnType<typeof setTimeout> | null = null;
let transportGeneration = 0;
let documentGeneration = 0;
let recordSessionGeneration = 0;
const GESTURE_WATCHDOG_MS = 5_000;
const activePointers = new Set<number>();
function verbValueEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => verbValueEqual(value, b[index]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const aRecord = a as Record<string, unknown>;
        const bRecord = b as Record<string, unknown>;
        const keys = Object.keys(aRecord);
        return keys.length === Object.keys(bRecord).length && keys.every((key) => verbValueEqual(aRecord[key], bRecord[key]));
    }
    return false;
}
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', (event) => activePointers.add(event.pointerId), true);
    const releasePointer = (event: PointerEvent) => activePointers.delete(event.pointerId);
    window.addEventListener('pointerup', releasePointer, true);
    window.addEventListener('pointercancel', releasePointer, true);
}
function clearEndTimer(): void {
    if (endTimer !== null) {
        clearTimeout(endTimer);
        endTimer = null;
    }
}

function clearPendingTransportTimer(): void {
    if (pendingTransportTimer !== null) clearTimeout(pendingTransportTimer);
    pendingTransportTimer = null;
}

function armPendingTransportTimeout(generation: number): void {
    clearPendingTransportTimer();
    pendingTransportTimer = setTimeout(() => {
        if (generation !== transportGeneration) return;
        useArrangementStore.setState({ transportPending: null, pendingSeekSample: null, transportError: 'The audio engine did not acknowledge the transport command. The last confirmed position was preserved.' });
        pendingTransportTimer = null;
    }, 1500);
}

/**
 * Start (or re-anchor) live audio preview of `arr` from `playheadTick`, and arm the
 * end-of-song auto-stop. Conducts to the wasm backend and hands the graph + schedule
 * to the executor's look-ahead scheduler. Publication fails closed: callers restore
 * the last good graph and expose an actionable transport error.
 */
let transportUnsubscribe: (() => void) | null = null;

function ensureTransportSubscription(): void {
    if (transportUnsubscribe) return;
    transportUnsubscribe = getExecutor().subscribeTransport((frame) => {
        useArrangementStore.getState().receiveTransportFrame(frame);
    });
}

function lowerPreview(arr: Arrangement, capture?: { armedTrackIds: readonly string[]; countInBars: 0 | 1 | 2 }) {
    const executor = getExecutor();
    const result = conduct(arr, executor.getTimelineBackend(), { lenient: true });
    if (capture) {
        const bindings = recordBindings(arr, capture.armedTrackIds, result.trackIndex);
        result.timeline.armed_tracks = bindings.map((binding) => ({ node: binding.node, align: 0 }));
        result.timeline.count_in_beats = capture.countInBars * (arr.timeSignature?.[0] ?? 4);
    }
    return { executor, result };
}

function startPreview(arr: Arrangement, playheadTick: number, onEnd: () => void, recording = false): RecordTrackBinding[] {
    clearEndTimer();
    const state = useArrangementStore.getState();
    const { executor, result } = lowerPreview(arr, { armedTrackIds: state.armedTrackIds, countInBars: state.countInBars });
        const { graph, tempoMap, timeline, meterIndex, seconds, skipped } = result;
        if (skipped.length > 0) {
            log.warn('timeline preview skipped tracks with unresolved refs (the rest plays)', {
                detail: skipped.join(', '),
            });
        }
        ensureTransportSubscription();
        const startSample = tickToSample(tempoMap, playheadTick);
        const looping = state.loopEnabled && (arr.locations ?? []).some((location) => location.kind === 'loop' && location.endTick !== undefined);
        executor.startArrangementPreview({ graph, tempoMap, timeline, meterIndex }, startSample, {
            loop: looping,
            punch: state.punchEnabled,
            click: state.clickEnabled,
            countIn: state.countInBars > 0,
            record: recording,
        });
        // Auto-stop at the end of the song (conduct.seconds includes the release tail),
        // so the UI never claims to be playing a finished song and the canvas graph is
        // restored. A small slop keeps a final note/tail from being clipped.
        const remainSec = Math.max(0, seconds - startSample / tempoMap.sample_rate);
    if (!looping) endTimer = setTimeout(onEnd, remainSec * 1000 + 80);
    return recordBindings(arr, state.armedTrackIds, result.trackIndex);
}

function republishPreview(arr: Arrangement, playheadTick: number, onEnd: () => void): void {
    clearEndTimer();
    try {
        const state = useArrangementStore.getState();
        const { executor, result } = lowerPreview(arr, { armedTrackIds: state.armedTrackIds, countInBars: state.countInBars });
        const { graph, tempoMap, timeline, meterIndex, seconds, skipped } = result;
        if (skipped.length > 0) {
            log.warn('timeline preview skipped tracks with unresolved refs (the rest plays)', {
                detail: skipped.join(', '),
            });
        }
        executor.updateArrangementPreview({ graph, tempoMap, timeline, meterIndex });
        const remainSec = Math.max(0, seconds - tickToSample(tempoMap, playheadTick) / tempoMap.sample_rate);
        const looping = state.loopEnabled && (arr.locations ?? []).some((location) => location.kind === 'loop' && location.endTick !== undefined);
        if (!looping) endTimer = setTimeout(onEnd, remainSec * 1000 + 80);
    } catch (err) {
        log.warn('timeline edit could not be published; the last good snapshot keeps playing', {
            detail: err instanceof Error ? err.message : String(err),
        });
    }
}

/** Stop live audio preview (release held notes + restore the canvas graph). Never throws. */
function stopPreview(): void {
    clearEndTimer();
    if (gesturePublishTimer !== null) {
        clearTimeout(gesturePublishTimer);
        gesturePublishTimer = null;
    }
    try {
        getExecutor().stopArrangementPreview();
    } catch {
        // No executor / already stopped — the transport state is authoritative.
    }
}

/**
 * Restore the in-band counter. Legacy regex scanning remains only as a defensive
 * fallback for documents that reached the store without going through migration.
 */
function seedCounter(arr: Arrangement): number {
    if (arr.idCounter !== undefined) return arr.idCounter;
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
        }
        for (const l of t.automation ?? []) scan(l.id);
    }
    for (const source of Object.values(arr.sources ?? {})) {
        scan(source.id);
        if (source.kind === 'midi') for (const note of source.notes) scan(note.id);
    }
    for (const location of arr.locations ?? []) scan(location.id);
    return max + 1;
}

export interface QueuedEditResult {
    id: number;
    status: 'queued' | 'applied' | 'rejected';
    summary: string;
}

export interface ArrangementApplyResult {
    status: 'applied' | 'queued';
    queuedEdit?: QueuedEditResult;
    requestUndo?: () => void;
}

export interface ArrangementStore {
    /** The current song (always normalized), or null when no song is open. */
    arrangement: Arrangement | null;

    /** Monotonic authoring-document revision. Transport, selection, and previews do not bump it. */
    docVersion: number;

    // ── selection (UI) ──
    selectedClipId: string | null;

    // ── transport ──
    isPlaying: boolean;
    /** Latest engine-confirmed musical position. */
    playheadTick: number;
    transportSample: number;
    transportMotion: number;
    transportFrameAtMs: number | null;
    transportPending: 'play' | 'stop' | 'seek' | null;
    transportError: string | null;
    lastQueuedEditResult: QueuedEditResult | null;
    pendingSeekSample: number | null;
    playOriginTick: number;
    loopOn: boolean;
    loopEnabled: boolean;
    armedTrackIds: string[];
    clickEnabled: boolean;
    countInBars: 0 | 1 | 2;
    punchEnabled: boolean;
    isRecording: boolean;
    recordStartTick: number | null;
    ghostNotes: CapturedNote[];
    recordingBindings: RecordTrackBinding[];
    recordError: string | null;

    // ── actions ──
    /** Load a song (normalized on entry); resets the command-log + transport. */
    setArrangement: (arr: Arrangement | null) => void;
    /** Apply one verb or an atomic batch. Preview applications are transient; the
     * next non-preview application commits one history entry and re-anchors once. */
    apply: (verb: Verb | Verb[], options?: { preview?: boolean; surface?: Extract<SurfaceId, 'arrangement' | 'pianoroll'> }) => ArrangementApplyResult;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    beginGesture: (label: string, surface?: Extract<SurfaceId, 'arrangement' | 'pianoroll'>) => number;
    isGestureOpen: (id?: number) => boolean;
    previewGesture: (verbs: Verb | Verb[]) => void;
    commitGesture: (id?: number) => void;
    abortGesture: () => void;
    /** Mint a fresh, collision-free entity id (e.g. `mintId('clip')` → `clip-7`). */
    mintId: (prefix: string) => string;

    selectClip: (clipId: string | null) => void;

    play: () => void;
    stop: () => void;
    haltAtEnd: () => void;
    /** Move the playhead to a tick (keeps playing if it was playing). */
    seek: (tick: number) => void;
    returnToStart: () => void;
    setTempo: (tempoBpm: number) => void;
    setLoopEnabled: (on: boolean) => void;
    setPunchEnabled: (on: boolean) => void;
    setClick: (on: boolean) => void;
    setCountIn: (bars: 0 | 1 | 2) => void;
    armTrack: (trackId: string, on: boolean) => { ok: boolean; message?: string };
    record: () => Promise<void>;
    receiveTransportFrame: (frame: TransportFrame) => void;
    /** Visual interpolation from the last complete engine snapshot. */
    currentTick: () => number;
}

let idCounter = 1;
let liveNoteUnsubscribe: (() => void) | null = null;
let activeRecordBindings: RecordTrackBinding[] = [];

export const useArrangementStore = create<ArrangementStore>((set, get) => {
    let previewBase: Arrangement | null = null;
    let previewVerbs: Verb[] = [];
    let previewSurface: 'arrangement' | 'pianoroll' = 'arrangement';
    let gestureDepth = 0;
    let gestureId = 0;
    let gestureIds: number[] = [];
    let gestureFrames: Array<{ committed: Verb[]; preview: Verb[] }> = [];
    let gestureWatchdog: ReturnType<typeof setTimeout> | null = null;
    let returnToOriginArmed = false;
    let queuedEditId = 0;
    let queuedApplies: Array<{ verbs: Verb[]; surface: 'arrangement' | 'pianoroll'; result: QueuedEditResult; undoRequested: boolean }> = [];

    const clearGestureWatchdog = (): void => {
        if (gestureWatchdog !== null) clearTimeout(gestureWatchdog);
        gestureWatchdog = null;
    };

    const armGestureWatchdog = (): void => {
        clearGestureWatchdog();
        gestureWatchdog = setTimeout(() => {
            gestureWatchdog = null;
            if (gestureDepth === 0) return;
            if (activePointers.size > 0) {
                armGestureWatchdog();
                return;
            }
            log.warn('timeline gesture watchdog auto-closed an ownerless gesture', { detail: `${gestureDepth} frame(s) were open for over ${GESTURE_WATCHDOG_MS}ms` });
            const framesToClose = gestureDepth;
            for (let index = 0; index < framesToClose && gestureDepth > 0; index += 1) get().commitGesture();
        }, GESTURE_WATCHDOG_MS);
    };

    const applyAtomic = (verbs: Verb[], surface: 'arrangement' | 'pianoroll'): { ok: boolean; summary: string } => {
        const arr = get().arrangement;
        if (!arr || verbs.length === 0) return { ok: false, summary: 'Timeline edit was rejected: no song or verbs.' };
        try {
            const { next, inverse } = applyVerbs(arr, verbs);
            set({ arrangement: next, docVersion: get().docVersion + 1, transportError: null });
            useHistoryStore.getState().record(
                verbs.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                inverse.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                verbs.length === 1 ? verbs[0]!.kind : 'Edit timeline',
                surface,
            );
            if (get().isPlaying) republishPreview(next, get().currentTick(), () => get().haltAtEnd());
            return { ok: true, summary: `Applied ${verbs.length} queued timeline edit(s).` };
        } catch (error) {
            const message = `Timeline edit was rejected: ${error instanceof Error ? error.message : String(error)}`;
            log.warn('queued timeline edit was rejected atomically', { detail: message });
            set({ transportError: message });
            return { ok: false, summary: message };
        }
    };

    const flushQueuedApplies = (): void => {
        if (gestureDepth > 0 || queuedApplies.length === 0) return;
        const queue = queuedApplies;
        queuedApplies = [];
        for (const item of queue) {
            const applied = applyAtomic(item.verbs, item.surface);
            item.result.status = applied.ok ? 'applied' : 'rejected';
            item.result.summary = applied.summary;
            set({ lastQueuedEditResult: { ...item.result } });
            if (applied.ok && item.undoRequested) get().undo();
        }
    };

    const finishRecording = async (): Promise<void> => {
        const state = get();
        if (!state.isRecording || !state.arrangement || state.recordStartTick === null) return;
        const captureDocumentGeneration = documentGeneration;
        const captureSessionGeneration = recordSessionGeneration;
        const endTick = Math.max(state.recordStartTick, state.currentTick());
        const punch = state.punchEnabled
            ? state.arrangement.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined)
            : undefined;
        const span = {
            startTick: Math.max(state.recordStartTick, punch?.startTick ?? state.recordStartTick),
            endTick: Math.min(endTick, punch?.endTick ?? endTick),
        };
        const wasmNotes = state.ghostNotes;
        set({ isRecording: false, isPlaying: false, transportPending: 'stop', pendingSeekSample: null });
        clearEndTimer();
        liveNoteUnsubscribe?.();
        liveNoteUnsubscribe = null;
        const native = getExecutor().getTimelineBackend() === 'native';
        let result;
        try {
            result = await getExecutor().stopArrangementRecording();
        } catch (error) {
            set({ recordError: `Recording could not be finalized: ${error instanceof Error ? error.message : String(error)}`, transportPending: null });
            return;
        }
        const capture = native ? result : {
            take_id: Date.now(), segments: [], notes: wasmNotes, recovered: false,
        };
        const latest = get().arrangement;
        if (captureDocumentGeneration !== documentGeneration || captureSessionGeneration !== recordSessionGeneration) {
            clearMidiRecordJournal();
            activeRecordBindings = [];
            set({ recordStartTick: null, ghostNotes: [], recordingBindings: [], transportPending: null, recordError: 'Recording capture belongs to a different song session and was not applied.' });
            return;
        }
        if (capture && latest && span.endTick > span.startTick) {
            const verbs = captureResultToVerbs({ arrangement: latest, result: capture, bindings: activeRecordBindings, span, mint: get().mintId });
            if (verbs.length) get().apply(verbs);
        }
        clearMidiRecordJournal();
        activeRecordBindings = [];
        set({ recordStartTick: null, ghostNotes: [], recordingBindings: [] });
    };

    return {
        arrangement: null,
        docVersion: 0,
        selectedClipId: null,
        isPlaying: false,
        playheadTick: 0,
        transportSample: 0,
        transportMotion: 0,
        transportFrameAtMs: null,
        transportPending: null,
        transportError: null,
        lastQueuedEditResult: null,
        pendingSeekSample: null,
        playOriginTick: 0,
        loopOn: false,
        loopEnabled: false,
        armedTrackIds: [],
        clickEnabled: false,
        countInBars: 0,
        punchEnabled: false,
        isRecording: false,
        recordStartTick: null,
        ghostNotes: [],
        recordingBindings: [],
        recordError: null,

        setArrangement: (arr) => {
            // Loading a new song stops any preview of the old one (release + restore).
            stopPreview();
            const normalized = arr ? normalizeArrangement(arr) : null;
            previewBase = null;
            previewVerbs = [];
            gestureDepth = 0;
            gestureIds = [];
            gestureFrames = [];
            clearGestureWatchdog();
            queuedApplies = [];
            returnToOriginArmed = false;
            idCounter = normalized ? seedCounter(normalized) : 1;
            documentGeneration += 1;
            recordSessionGeneration += 1;
            transportGeneration += 1;
            clearPendingTransportTimer();
            set({
                // Loading a song IS an authoring-document change: the emergency
                // crash backup keys off `getDocumentVersion()`, and without this
                // bump a freshly opened starter was never backed up at all — a
                // SIGKILL right after "Start from …" lost the whole song (N2's
                // recovery journey reproduced exactly that: crash detected, no
                // payload to restore). Transport/selection resets still don't bump.
                docVersion: get().docVersion + 1,
                arrangement: normalized,
                selectedClipId: null,
                isPlaying: false,
                playheadTick: 0,
                transportSample: 0,
                transportMotion: 0,
                transportFrameAtMs: null,
                transportPending: null,
                transportError: null,
                lastQueuedEditResult: null,
                pendingSeekSample: null,
                playOriginTick: 0,
                loopOn: false,
                loopEnabled: false,
                armedTrackIds: [],
                punchEnabled: false,
                isRecording: false,
                recordStartTick: null,
                ghostNotes: [],
                recordingBindings: [],
                recordError: null,
            });
            useHistoryStore.getState().clear();
        },

        apply: (verb, options) => {
            const current = get().arrangement;
            const isPreview = options?.preview === true;
            const arr = previewBase ?? current;
            if (!arr) return { status: 'applied' };
            const verbs = Array.isArray(verb) ? verb : [verb];
            if (verbs.length === 0) return { status: 'applied' };
            if (previewBase && useHistoryStore.getState().open && !isPreview) {
                const result: QueuedEditResult = { id: ++queuedEditId, status: 'queued', summary: 'Queued behind a live performer gesture.' };
                const queued = { verbs: structuredClone(verbs), surface: options?.surface ?? 'arrangement' as const, result, undoRequested: false };
                queuedApplies.push(queued);
                set({ lastQueuedEditResult: { ...result } });
                return {
                    status: 'queued',
                    queuedEdit: result,
                    requestUndo: () => {
                        if (result.status === 'applied') get().undo();
                        else if (result.status === 'queued') queued.undoRequested = true;
                    },
                };
            }
            const { next, inverse } = applyVerbs(arr, verbs);
            if (isPreview) {
                previewBase ??= arr;
                previewVerbs = verbs;
                set({ arrangement: next });
                return { status: 'applied' };
            }
            previewBase = null;
            set({
                arrangement: next,
                docVersion: get().docVersion + 1,
            });
            useHistoryStore.getState().record(
                verbs.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                inverse.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                verbs.length === 1 ? verbs[0]!.kind : 'Edit timeline',
                options?.surface ?? 'arrangement',
            );
            if (get().isPlaying) republishPreview(next, get().currentTick(), () => get().stop());
            return { status: 'applied' };
        },

        undo: () => useHistoryStore.getState().undo(),
        redo: () => useHistoryStore.getState().redo(),
        canUndo: () => useHistoryStore.getState().canUndo(),
        canRedo: () => useHistoryStore.getState().canRedo(),
        beginGesture: (label, surface = 'arrangement') => {
            if (!previewBase) {
                previewBase = get().arrangement;
                previewVerbs = [];
                previewSurface = surface;
            }
            gestureDepth += 1;
            gestureId += 1;
            gestureIds.push(gestureId);
            gestureFrames.push({ committed: [], preview: [] });
            useHistoryStore.getState().begin(label, surface);
            armGestureWatchdog();
            return gestureId;
        },
        isGestureOpen: (id) => previewBase !== null && (id === undefined || gestureIds.at(-1) === id),
        previewGesture: (verb) => {
            if (!previewBase) return;
            armGestureWatchdog();
            const verbs = Array.isArray(verb) ? verb : [verb];
            const frame = gestureFrames.at(-1);
            if (frame) frame.preview = verbs;
            previewVerbs = gestureFrames.length
                ? gestureFrames.flatMap((item) => [...item.committed, ...item.preview])
                : verbs;
            const { next } = applyVerbs(previewBase, verbs);
            set({ arrangement: next });
            // Mixer/automation gestures are audible while rolling, but graph
            // publication is bounded to 20 Hz so pointer-rate input cannot flood
            // the worklet/native bridge.
            if (get().isPlaying && gesturePublishTimer === null) {
                gesturePublishTimer = setTimeout(() => {
                    gesturePublishTimer = null;
                    const latest = get().arrangement;
                    if (latest && get().isPlaying) republishPreview(latest, get().currentTick(), () => get().stop());
                }, 50);
            }
        },
        commitGesture: (id) => {
            if (!previewBase) return;
            if (id !== undefined && gestureIds.at(-1) !== id) return;
            if (gestureDepth > 1) {
                gestureDepth -= 1;
                gestureIds.pop();
                const inner = gestureFrames.pop();
                const parent = gestureFrames.at(-1);
                if (inner && parent) parent.committed.push(...inner.committed, ...inner.preview);
                useHistoryStore.getState().commit();
                armGestureWatchdog();
                return;
            }
            const base = previewBase;
            const verbs = previewVerbs;
            previewBase = null;
            previewVerbs = [];
            gestureDepth = 0;
            gestureIds = [];
            gestureFrames = [];
            clearGestureWatchdog();
            if (gesturePublishTimer !== null) {
                clearTimeout(gesturePublishTimer);
                gesturePublishTimer = null;
            }
            if (!verbs.length) {
                set({ arrangement: base });
                useHistoryStore.getState().commit();
                flushQueuedApplies();
                return;
            }
            const { next, inverse } = applyVerbs(base, verbs);
            // Returning a gesture to its exact origin is not an edit. Keep the
            // document version and unified history cursor unchanged.
            if (verbs.length === inverse.length && verbs.every((verb, index) => verbValueEqual(verb, inverse[inverse.length - 1 - index]!))) {
                set({ arrangement: base });
                useHistoryStore.getState().commit();
                flushQueuedApplies();
                return;
            }
            set({ arrangement: next, docVersion: get().docVersion + 1 });
            useHistoryStore.getState().record(
                verbs.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                inverse.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                undefined,
                previewSurface,
            );
            useHistoryStore.getState().commit();
            if (get().isPlaying) republishPreview(next, get().currentTick(), () => get().haltAtEnd());
            flushQueuedApplies();
        },
        abortGesture: () => {
            if (previewBase) set({ arrangement: previewBase });
            previewBase = null;
            previewVerbs = [];
            gestureDepth = 0;
            gestureIds = [];
            gestureFrames = [];
            clearGestureWatchdog();
            if (gesturePublishTimer !== null) {
                clearTimeout(gesturePublishTimer);
                gesturePublishTimer = null;
            }
            useHistoryStore.getState().abort();
            flushQueuedApplies();
        },

        mintId: (prefix) => {
            const id = `${prefix}-${idCounter++}`;
            const arrangement = get().arrangement;
            if (previewBase) previewBase = { ...previewBase, idCounter };
            if (arrangement) set({ arrangement: { ...arrangement, idCounter } });
            return id;
        },

        selectClip: (clipId) => set({ selectedClipId: clipId }),

        play: () => {
            if (get().isPlaying) return;
            const arr = get().arrangement;
            if (!arr) return;
            const state = get();
            const origin = state.transportPending === 'seek' && state.pendingSeekSample !== null
                ? sampleToTick(buildTempoMap(arr), state.pendingSeekSample)
                : state.playheadTick;
            returnToOriginArmed = false;
            try {
                startPreview(arr, origin, () => get().haltAtEnd());
                const generation = ++transportGeneration;
                set({ isPlaying: true, playOriginTick: origin, transportPending: 'play', transportError: null });
                armPendingTransportTimeout(generation);
            } catch (error) {
                stopPreview();
                const message = `Playback could not start: ${error instanceof Error ? error.message : String(error)}`;
                log.error('playback could not start', { detail: message });
                set({ isPlaying: false, transportPending: null, transportError: message });
            }
        },

        stop: () => {
            if (!get().isPlaying) {
                if (returnToOriginArmed && get().playheadTick !== get().playOriginTick) {
                    const origin = get().playOriginTick;
                    returnToOriginArmed = false;
                    get().seek(origin);
                }
                return;
            }
            if (get().isRecording) {
                void finishRecording();
                return;
            }
            const generation = ++transportGeneration;
            set({ isPlaying: false, transportPending: 'stop', transportError: null, pendingSeekSample: null });
            returnToOriginArmed = true;
            stopPreview();
            armPendingTransportTimeout(generation);
        },

        haltAtEnd: () => {
            if (!get().isPlaying) return;
            const generation = ++transportGeneration;
            set({ isPlaying: false, transportPending: 'stop', transportError: null, pendingSeekSample: null });
            returnToOriginArmed = false;
            stopPreview();
            armPendingTransportTimeout(generation);
        },

        seek: (tick) => {
            const arr = get().arrangement;
            const max = arr ? arrangementLengthTicks(arr) : 0;
            const clamped = Math.max(0, Math.min(tick, max));
            if (!arr) return;
            const map = buildTempoMap(arr);
            const samples = tickToSample(map, clamped);
            const generation = ++transportGeneration;
            returnToOriginArmed = false;
            set({ playOriginTick: clamped, transportPending: 'seek', transportError: null, pendingSeekSample: samples });
            try {
                ensureTransportSubscription();
                getExecutor().seekArrangement(samples);
                armPendingTransportTimeout(generation);
            } catch (error) {
                set({ transportPending: null, pendingSeekSample: null, transportError: `Seek failed: ${error instanceof Error ? error.message : String(error)}` });
            }
        },
        returnToStart: () => get().seek(0),
        setTempo: (tempoBpm) => {
            if (!Number.isFinite(tempoBpm)) return;
            get().apply({ kind: 'setTempo', tempoBpm: Math.max(20, Math.min(300, tempoBpm)) });
        },

        setLoopEnabled: (on) => {
            set({ loopEnabled: on, punchEnabled: on ? false : get().punchEnabled });
            if (on) getExecutor().setArrangementPunch(false);
            getExecutor().setArrangementLoop(on);
            const arr = get().arrangement;
            if (arr && get().isPlaying) republishPreview(arr, get().currentTick(), () => get().haltAtEnd());
        },

        setPunchEnabled: (on) => {
            set({ punchEnabled: on, loopEnabled: on ? false : get().loopEnabled });
            if (on) getExecutor().setArrangementLoop(false);
            getExecutor().setArrangementPunch(on);
            const arr = get().arrangement;
            if (arr && get().isPlaying) republishPreview(arr, get().currentTick(), () => get().stop());
        },

        setClick: (on) => {
            set({ clickEnabled: on });
            getExecutor().setArrangementClick(on);
        },

        setCountIn: (bars) => {
            const safe = bars === 1 || bars === 2 ? bars : 0;
            set({ countInBars: safe });
            getExecutor().setArrangementCountIn(safe > 0);
            const arr = get().arrangement;
            if (arr && get().isPlaying) republishPreview(arr, get().currentTick(), () => get().stop());
        },

        armTrack: (trackId, on) => {
            const arr = get().arrangement;
            const track = arr?.tracks.find((item) => (item.id ?? item.ref) === trackId);
            if (!arr || !track) return { ok: false, message: `Track ${trackId} was not found.` };
            if (on && trackRecordKind(arr, track) === 'audio' && getExecutor().getTimelineBackend() === 'wasm') {
                const message = 'Audio recording is native-only for now. MIDI recording remains available in the browser.';
                set({ recordError: message });
                return { ok: false, message };
            }
            const armed = new Set(get().armedTrackIds);
            if (on) armed.add(trackId); else armed.delete(trackId);
            set({ armedTrackIds: [...armed], recordError: null });
            if (get().isPlaying) republishPreview(arr, get().currentTick(), () => get().stop());
            return { ok: true };
        },

        record: async () => {
            if (get().isRecording) {
                await finishRecording();
                return;
            }
            const state = get();
            if (!state.arrangement || state.armedTrackIds.length === 0) {
                set({ recordError: 'Arm at least one track before recording.' });
                return;
            }
            const startTick = state.currentTick();
            try {
                activeRecordBindings = startPreview(state.arrangement, startTick, () => void finishRecording(), true);
                if (activeRecordBindings.length === 0) throw new Error('No armed track could be bound to the audio engine.');
            } catch (error) {
                stopPreview();
                set({ isPlaying: state.isPlaying, isRecording: false, recordStartTick: null, ghostNotes: [], recordingBindings: [], transportPending: null, recordError: `Recording could not start: ${error instanceof Error ? error.message : String(error)}` });
                return;
            }
            recordSessionGeneration += 1;
            const generation = ++transportGeneration;
            set({ isPlaying: true, isRecording: true, playOriginTick: startTick, recordStartTick: startTick, ghostNotes: [], recordError: null, transportError: null, transportPending: 'play' });
            armPendingTransportTimeout(generation);
            set({ recordingBindings: activeRecordBindings });
            beginMidiRecordJournal(startTick, activeRecordBindings);
            const armedNodes = new Set(activeRecordBindings.filter((binding) => binding.kind === 'midi').map((binding) => binding.node));
            liveNoteUnsubscribe?.();
            liveNoteUnsubscribe = getExecutor().subscribeLiveNotes((event) => {
                const current = get();
                if (!current.isRecording || !armedNodes.has(event.node)) return;
                const note = wasmTapToCapturedNote(event, current.currentTick());
                appendMidiRecordJournal(note);
                set({ ghostNotes: [...current.ghostNotes, note] });
            });
        },

        receiveTransportFrame: (frame) => {
            const state = get();
            const pending = state.transportPending;
            if (pending === 'play' && !isRollingMotion(frame.motion) && frame.motion !== 5) return;
            if (pending === 'stop' && frame.motion !== 0) return;
            if (!pending && !state.isPlaying) return;
            if (pending === 'seek' && state.pendingSeekSample !== null &&
                Math.abs(frame.sample - state.pendingSeekSample) > 256) {
                return;
            }
            const arr = state.arrangement;
            if (!arr) return;
            const map = buildTempoMap(arr);
            const tick = Math.max(0, Math.min(sampleToTick(map, frame.sample), arrangementLengthTicks(arr)));
            set({
                playheadTick: tick,
                transportSample: frame.sample,
                transportMotion: frame.motion,
                transportFrameAtMs: visualNow(),
                transportPending: null,
                transportError: null,
                pendingSeekSample: null,
                isPlaying: pending === 'stop' || frame.motion === 0 ? false : state.isPlaying,
                loopOn: frame.loop_on,
                loopEnabled: frame.loop_on,
            });
            if (frame.motion === 0) clearEndTimer();
            clearPendingTransportTimer();
        },

        currentTick: () => {
            const state = get();
            const { arrangement, playheadTick, transportFrameAtMs } = state;
            if (!arrangement || transportFrameAtMs === null || !state.isPlaying ||
                state.transportPending === 'play' || state.transportMotion !== 1) return playheadTick;
            const map = buildTempoMap(arrangement);
            const elapsedSamples = Math.max(0, visualNow() - transportFrameAtMs) * map.sample_rate / 1000;
            return Math.min(
                sampleToTick(map, state.transportSample + elapsedSamples),
                arrangementLengthTicks(arrangement),
            );
        },
    };
});

registerHistoryDriver((verbs) => {
    const arrangementVerbs = verbs
        .filter((item): item is Extract<EditVerb, { domain: 'arrangement' }> => item.domain === 'arrangement')
        .map((item) => item.verb);
    if (!arrangementVerbs.length) return;
    const store = useArrangementStore.getState();
    if (!store.arrangement) return;
    const { next } = applyVerbs(store.arrangement, arrangementVerbs);
    useArrangementStore.setState({ arrangement: next, docVersion: store.docVersion + 1 });
    if (store.isPlaying) republishPreview(next, store.currentTick(), () => useArrangementStore.getState().stop());
});

// Playwright's production-bundle gate cannot instantiate a physical MIDI device.
// Under browser automation only, expose the same block-quantized tap shape the
// executor emits so the end-to-end test still crosses the real record/store/history/UI
// path. This listener is inert for every human session.
if (typeof window !== 'undefined' && navigator.webdriver) {
    window.addEventListener('openjammer:test-live-note', ((event: CustomEvent<{ note: number; velocity: number; on: boolean; tick: number }>) => {
        const state = useArrangementStore.getState();
        if (!state.isRecording) return;
        const binding = state.recordingBindings.find((item) => item.kind === 'midi');
        if (!binding) return;
        const tick = Math.max(0, Math.round(event.detail.tick));
        const note = { node: binding.node, note: event.detail.note, velocity: event.detail.velocity, on: event.detail.on, tick };
        appendMidiRecordJournal(note);
        useArrangementStore.setState({
            playheadTick: Math.max(state.playheadTick, tick),
            transportFrameAtMs: null,
            ghostNotes: [...state.ghostNotes, note],
        });
    }) as EventListener);
}
