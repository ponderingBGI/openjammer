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
import type { TransportFrame } from '../audio/executor/timelinePlayback';
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

const log = logger('song');

const visualNow = (): number => globalThis.performance?.now() ?? Date.now();

/** The auto-stop timer: fires `stop()` when playback reaches the song's end (incl. the
 *  conduct release tail), so isPlaying never lies and the canvas graph is restored. */
let endTimer: ReturnType<typeof setTimeout> | null = null;
let gesturePublishTimer: ReturnType<typeof setTimeout> | null = null;
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
    try {
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
        executor.startArrangementPreview({ graph, tempoMap, timeline, meterIndex }, startSample, {
            loop: state.loopEnabled,
            punch: state.punchEnabled,
            click: state.clickEnabled,
            countIn: state.countInBars > 0,
            record: recording,
        });
        // Auto-stop at the end of the song (conduct.seconds includes the release tail),
        // so the UI never claims to be playing a finished song and the canvas graph is
        // restored. A small slop keeps a final note/tail from being clipped.
        const remainSec = Math.max(0, seconds - startSample / tempoMap.sample_rate);
        endTimer = setTimeout(onEnd, remainSec * 1000 + 80);
        return recordBindings(arr, state.armedTrackIds, result.trackIndex);
    } catch (err) {
        log.warn('timeline preview could not start; the transport still runs (visual only)', {
            detail: err instanceof Error ? err.message : String(err),
        });
    }
    return [];
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
        endTimer = setTimeout(onEnd, remainSec * 1000 + 80);
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

export interface ArrangementStore {
    /** The current song (always normalized), or null when no song is open. */
    arrangement: Arrangement | null;

    /** Monotonic authoring-document revision. Transport, selection, and previews do not bump it. */
    docVersion: number;

    // ── selection (UI) ──
    selectedClipId: string | null;
    selectedNoteIds: string[];

    // ── transport ──
    isPlaying: boolean;
    /** Latest engine-confirmed musical position. */
    playheadTick: number;
    transportSample: number;
    transportMotion: number;
    transportFrameAtMs: number | null;
    transportPending: 'play' | 'stop' | 'seek' | null;
    pendingSeekSample: number | null;
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
    apply: (verb: Verb | Verb[], options?: { preview?: boolean }) => void;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    beginGesture: (label: string) => void;
    previewGesture: (verbs: Verb | Verb[]) => void;
    commitGesture: () => void;
    abortGesture: () => void;
    /** Mint a fresh, collision-free entity id (e.g. `mintId('clip')` → `clip-7`). */
    mintId: (prefix: string) => string;

    selectClip: (clipId: string | null) => void;
    selectNotes: (noteIds: string[]) => void;

    play: () => void;
    stop: () => void;
    /** Move the playhead to a tick (keeps playing if it was playing). */
    seek: (tick: number) => void;
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

    const finishRecording = async (): Promise<void> => {
        const state = get();
        if (!state.isRecording || !state.arrangement || state.recordStartTick === null) return;
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
        const result = await getExecutor().stopArrangementRecording();
        const capture = native ? result : {
            take_id: Date.now(), segments: [], notes: wasmNotes, recovered: false,
        };
        const latest = get().arrangement;
        if (capture && latest && span.endTick > span.startTick) {
            const verbs = captureResultToVerbs({ arrangement: latest, result: capture, bindings: activeRecordBindings, span, mint: get().mintId });
            if (verbs.length) get().apply(verbs);
        }
        activeRecordBindings = [];
        set({ recordStartTick: null, ghostNotes: [], recordingBindings: [] });
    };

    return {
        arrangement: null,
        docVersion: 0,
        selectedClipId: null,
        selectedNoteIds: [],
        isPlaying: false,
        playheadTick: 0,
        transportSample: 0,
        transportMotion: 0,
        transportFrameAtMs: null,
        transportPending: null,
        pendingSeekSample: null,
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
            idCounter = normalized ? seedCounter(normalized) : 1;
            set({
                arrangement: normalized,
                selectedClipId: null,
                selectedNoteIds: [],
                isPlaying: false,
                playheadTick: 0,
                transportSample: 0,
                transportMotion: 0,
                transportFrameAtMs: null,
                transportPending: null,
                pendingSeekSample: null,
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
            if (!arr) return;
            const verbs = Array.isArray(verb) ? verb : [verb];
            if (verbs.length === 0) return;
            const { next, inverse } = applyVerbs(arr, verbs);
            if (isPreview) {
                previewBase ??= arr;
                previewVerbs = verbs;
                set({ arrangement: next });
                return;
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
                'arrangement',
            );
            if (get().isPlaying) republishPreview(next, get().currentTick(), () => get().stop());
        },

        undo: () => useHistoryStore.getState().undo(),
        redo: () => useHistoryStore.getState().redo(),
        canUndo: () => useHistoryStore.getState().canUndo(),
        canRedo: () => useHistoryStore.getState().canRedo(),
        beginGesture: (label) => {
            if (previewBase) return;
            previewBase = get().arrangement;
            previewVerbs = [];
            useHistoryStore.getState().begin(label, 'arrangement');
        },
        previewGesture: (verb) => {
            if (!previewBase) return;
            const verbs = Array.isArray(verb) ? verb : [verb];
            previewVerbs = verbs;
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
        commitGesture: () => {
            if (!previewBase) return;
            const base = previewBase;
            const verbs = previewVerbs;
            previewBase = null;
            previewVerbs = [];
            if (gesturePublishTimer !== null) {
                clearTimeout(gesturePublishTimer);
                gesturePublishTimer = null;
            }
            if (!verbs.length) {
                set({ arrangement: base });
                useHistoryStore.getState().commit();
                return;
            }
            const { next, inverse } = applyVerbs(base, verbs);
            // Returning a gesture to its exact origin is not an edit. Keep the
            // document version and unified history cursor unchanged.
            if (JSON.stringify(next) === JSON.stringify(base)) {
                set({ arrangement: base });
                useHistoryStore.getState().commit();
                return;
            }
            set({ arrangement: next, docVersion: get().docVersion + 1 });
            useHistoryStore.getState().record(
                verbs.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                inverse.map((item): EditVerb => ({ domain: 'arrangement', verb: item })),
                undefined,
                'arrangement',
            );
            useHistoryStore.getState().commit();
            if (get().isPlaying) republishPreview(next, get().currentTick(), () => get().stop());
        },
        abortGesture: () => {
            if (previewBase) set({ arrangement: previewBase });
            previewBase = null;
            previewVerbs = [];
            if (gesturePublishTimer !== null) {
                clearTimeout(gesturePublishTimer);
                gesturePublishTimer = null;
            }
            useHistoryStore.getState().abort();
        },

        mintId: (prefix) => {
            const id = `${prefix}-${idCounter++}`;
            const arrangement = get().arrangement;
            if (arrangement) set({ arrangement: { ...arrangement, idCounter } });
            return id;
        },

        selectClip: (clipId) => set({ selectedClipId: clipId, selectedNoteIds: [] }),
        selectNotes: (noteIds) => set({ selectedNoteIds: noteIds }),

        play: () => {
            if (get().isPlaying) return;
            const arr = get().arrangement;
            set({ isPlaying: true, transportPending: 'play' });
            if (arr) startPreview(arr, get().playheadTick, () => get().stop());
        },

        stop: () => {
            if (!get().isPlaying) return;
            if (get().isRecording) {
                void finishRecording();
                return;
            }
            set({ isPlaying: false, transportPending: 'stop', pendingSeekSample: null });
            stopPreview();
        },

        seek: (tick) => {
            const arr = get().arrangement;
            const max = arr ? arrangementLengthTicks(arr) : 0;
            const clamped = Math.max(0, Math.min(tick, max));
            if (!arr) return;
            const map = buildTempoMap(arr);
            const samples = tickToSample(map, clamped);
            set({ transportPending: 'seek', pendingSeekSample: samples });
            ensureTransportSubscription();
            getExecutor().seekArrangement(samples);
        },

        setLoopEnabled: (on) => {
            set({ loopEnabled: on, punchEnabled: on ? false : get().punchEnabled });
            if (on) getExecutor().setArrangementPunch(false);
            getExecutor().setArrangementLoop(on);
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
            set({ isPlaying: true, isRecording: true, recordStartTick: startTick, ghostNotes: [], recordError: null, transportPending: 'play' });
            activeRecordBindings = startPreview(state.arrangement, startTick, () => void finishRecording(), true);
            set({ recordingBindings: activeRecordBindings });
            const armedNodes = new Set(activeRecordBindings.filter((binding) => binding.kind === 'midi').map((binding) => binding.node));
            liveNoteUnsubscribe?.();
            liveNoteUnsubscribe = getExecutor().subscribeLiveNotes((event) => {
                const current = get();
                if (!current.isRecording || !armedNodes.has(event.node)) return;
                set({ ghostNotes: [...current.ghostNotes, wasmTapToCapturedNote(event, current.currentTick())] });
            });
        },

        receiveTransportFrame: (frame) => {
            const state = get();
            const pending = state.transportPending;
            if (pending === 'play' && frame.motion !== 1) return;
            if (pending === 'stop' && frame.motion !== 0) return;
            if (!pending && !state.isPlaying) return;
            if (pending === 'seek' && state.pendingSeekSample !== null &&
                Math.abs(frame.sample - state.pendingSeekSample) > 1) {
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
                pendingSeekSample: null,
                isPlaying: pending === 'stop' || frame.motion === 0 ? false : state.isPlaying,
                loopOn: frame.loop_on,
                loopEnabled: frame.loop_on,
            });
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
        useArrangementStore.setState({
            playheadTick: Math.max(state.playheadTick, tick),
            transportFrameAtMs: null,
            ghostNotes: [...state.ghostNotes, { node: binding.node, note: event.detail.note, velocity: event.detail.velocity, on: event.detail.on, tick }],
        });
    }) as EventListener);
}
