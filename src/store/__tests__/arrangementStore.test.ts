import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArrangementStore } from '../arrangementStore';
import { useHistoryStore } from '../historyStore';
import type { Arrangement } from '../../song/types';

const executorSpies = vi.hoisted(() => ({
    getTimelineBackend: vi.fn(() => 'wasm' as const),
    startArrangementPreview: vi.fn(),
    updateArrangementPreview: vi.fn(),
    stopArrangementPreview: vi.fn(),
    seekArrangement: vi.fn(),
    setArrangementLoop: vi.fn(),
    setArrangementPunch: vi.fn(),
    setArrangementClick: vi.fn(),
    setArrangementCountIn: vi.fn(),
    subscribeLiveNotes: vi.fn(() => () => {}),
    stopArrangementRecording: vi.fn(async () => null),
    transportCallback: null as null | ((frame: {
        sample: number; tick: number; bar: number; beat: number; phase: number;
        motion: number; rec: boolean; loop_on: boolean;
    }) => void),
    subscribeTransport: vi.fn((callback) => {
        executorSpies.transportCallback = callback;
        return () => {};
    }),
}));
const logWarn = vi.hoisted(() => vi.fn());

vi.mock('../../audio/executor', () => ({
    getExecutor: () => executorSpies,
}));
vi.mock('../../utils/log', () => ({ logger: () => ({ warn: logWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }) }));

const seed: Arrangement = {
    name: 'store',
    tempoBpm: 120,
    ppq: 960,
    graph: {
        nodes: [
            { ref: 'keys', type: 'keys' },
            { ref: 'spk', type: 'speaker' },
        ],
        connections: [{ from: 'keys', to: 'spk' }],
    },
    sources: { midi: { id: 'midi', kind: 'midi', name: 'MIDI', lengthTick: 3840, notes: [{ tick: 0, durTick: 480, pitch: 60 }] } },
    tracks: [
        { ref: 'keys', name: 'Keys', clips: [{ sourceId: 'midi', startTick: 0, lengthTick: 3840 }] },
    ],
};

const store = () => useArrangementStore.getState();

describe('arrangementStore — the timeline SSOT + command-log', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store().setArrangement(seed);
    });
    afterEach(() => {
        store().stop();
        vi.useRealTimers();
    });

    it('normalizes on load (every entity has an id)', () => {
        const arr = store().arrangement!;
        expect(arr.tracks[0]!.id).toBeTruthy();
        expect(arr.tracks[0]!.clips[0]!.id).toBeTruthy();
        const source = arr.sources!.midi!;
        expect(source.kind === 'midi' && source.notes[0]!.id).toBeTruthy();
    });

    it('apply → undo → redo restores exactly (one shared history)', () => {
        const before = store().arrangement!;
        const trackId = before.tracks[0]!.id!;
        store().apply({ kind: 'setTrackMute', trackId, mute: true });
        expect(store().arrangement!.tracks[0]!.mute).toBe(true);

        store().undo();
        expect(store().arrangement).toEqual(before); // byte-exact restore
        expect(store().arrangement!.tracks[0]!.mute).toBeUndefined();

        store().redo();
        expect(store().arrangement!.tracks[0]!.mute).toBe(true);
    });

    it('bumps docVersion when a song is loaded (the crash backup must arm)', () => {
        // The emergency crash backup schedules off getDocumentVersion(); loading
        // a starter IS a document change, or a SIGKILL right after "Start from …"
        // has nothing to restore (the N2 native journey reproduced that loss).
        const initialVersion = store().docVersion;
        store().setArrangement(seed);
        expect(store().docVersion).toBe(initialVersion + 1);
    });

    it('bumps docVersion on apply/undo/redo but not transport or selection', () => {
        const initialVersion = store().docVersion;
        const trackId = store().arrangement!.tracks[0]!.id!;

        store().selectClip(store().arrangement!.tracks[0]!.clips[0]!.id!);
        store().seek(120);
        store().play();
        store().stop();
        expect(store().docVersion).toBe(initialVersion);

        store().apply({ kind: 'setTrackMute', trackId, mute: true });
        expect(store().docVersion).toBe(initialVersion + 1);
        store().undo();
        expect(store().docVersion).toBe(initialVersion + 2);
        store().redo();
        expect(store().docVersion).toBe(initialVersion + 3);
    });

    it('suppresses publication during previews and republishes once on commit', () => {
        vi.useFakeTimers();
        store().play();
        executorSpies.updateArrangementPreview.mockClear();
        const initialVersion = store().docVersion;
        const initialUndoDepth = useHistoryStore.getState().cursor;
        const trackId = store().arrangement!.tracks[0]!.id!;
        const verb = { kind: 'setTrackMute', trackId, mute: true } as const;

        store().apply(verb, { preview: true });
        store().apply(verb, { preview: true });
        expect(executorSpies.updateArrangementPreview).not.toHaveBeenCalled();
        expect(store().docVersion).toBe(initialVersion);
        expect(useHistoryStore.getState().cursor).toBe(initialUndoDepth);

        store().apply(verb);
        expect(executorSpies.updateArrangementPreview).toHaveBeenCalledTimes(1);
        expect(store().docVersion).toBe(initialVersion + 1);
        expect(useHistoryStore.getState().cursor).toBe(initialUndoDepth + 1);

        store().undo();
        expect(store().arrangement!.tracks[0]!.mute).toBeUndefined();
    });

    it('a new edit clears the redo branch (linear history)', () => {
        const trackId = store().arrangement!.tracks[0]!.id!;
        store().apply({ kind: 'setTrackMute', trackId, mute: true });
        store().undo();
        expect(store().canRedo()).toBe(true);
        store().apply({ kind: 'setTempo', tempoBpm: 90 });
        expect(store().canRedo()).toBe(false);
    });

    it('apply with a fresh clip via mintId round-trips through undo', () => {
        const trackId = store().arrangement!.tracks[0]!.id!;
        const clipId = store().mintId('clip');
        store().apply({
            kind: 'addClip',
            trackId,
            clip: { id: clipId, sourceId: 'midi', startTick: 1920, lengthTick: 240 },
        });
        expect(store().arrangement!.tracks[0]!.clips).toHaveLength(2);
        store().undo();
        expect(store().arrangement!.tracks[0]!.clips).toHaveLength(1);
    });

    it('mintId never repeats and never collides with existing ids', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) ids.add(store().mintId('x'));
        expect(ids.size).toBe(100);
    });

    it('transport intent stays pending until frames confirm, then freezes on stop', () => {
        store().seek(1920);
        expect(store().currentTick()).toBe(0);
        expect(store().transportPending).toBe('seek');
        executorSpies.transportCallback!({ sample: 48_000, tick: 1920, bar: 1, beat: 3, phase: 0, motion: 0, rec: false, loop_on: false });
        expect(store().currentTick()).toBe(1920);
        store().play();
        expect(store().isPlaying).toBe(true);
        expect(store().transportPending).toBe('play');
        executorSpies.transportCallback!({ sample: 48_000, tick: 1920, bar: 1, beat: 3, phase: 0, motion: 1, rec: false, loop_on: false });
        expect(store().transportPending).toBeNull();
        store().stop();
        expect(store().isPlaying).toBe(false);
        expect(store().transportPending).toBe('stop');
        executorSpies.transportCallback!({ sample: 60_000, tick: 2400, bar: 1, beat: 3, phase: 0, motion: 1, rec: false, loop_on: false });
        expect(store().playheadTick).toBe(1920);
        executorSpies.transportCallback!({ sample: 48_128, tick: 1925, bar: 1, beat: 3, phase: 0, motion: 0, rec: false, loop_on: false });
        expect(store().transportPending).toBeNull();
        const frozen = store().playheadTick;
        executorSpies.transportCallback!({ sample: 70_000, tick: 2800, bar: 1, beat: 3, phase: 0, motion: 1, rec: false, loop_on: false });
        expect(store().playheadTick).toBe(frozen);
    });

    it('seek clamps to the arrangement length (playhead never runs off the ruler)', () => {
        store().seek(10_000_000);
        expect(executorSpies.seekArrangement).toHaveBeenLastCalledWith(96_000);
        store().seek(-500);
        expect(executorSpies.seekArrangement).toHaveBeenLastCalledWith(0);
    });

    describe('transport honesty (playback stays in sync)', () => {
        it('auto-stops at the end of the song — isPlaying never lies', () => {
            vi.useFakeTimers();
            store().play();
            expect(store().isPlaying).toBe(true);
            // Advance well past the song + release tail: the end-timer fires stop().
            vi.advanceTimersByTime(60_000);
            expect(store().isPlaying).toBe(false);
        });

        it('TL-01 keeps a real loop range rolling past the non-loop end watchdog', () => {
            vi.useFakeTimers();
            store().setArrangement({ ...seed, locations: [{ id: 'loop-1', kind: 'loop', name: 'Loop', startTick: 0, endTick: 1920 }] });
            store().setLoopEnabled(true);
            store().play();
            vi.advanceTimersByTime(60_000);
            expect(store().isPlaying).toBe(true);
        });

        it('loop enabled without a range still stops honestly at song end', () => {
            vi.useFakeTimers();
            store().setLoopEnabled(true);
            store().play();
            vi.advanceTimersByTime(60_000);
            expect(store().isPlaying).toBe(false);
        });

        it('keeps the end watchdog armed across loop toggles during playback without a range', () => {
            vi.useFakeTimers();
            store().play();
            vi.advanceTimersByTime(100);
            store().setLoopEnabled(true);
            vi.advanceTimersByTime(60_000);
            expect(store().isPlaying).toBe(false);

            store().seek(0);
            executorSpies.transportCallback!({ sample: 0, tick: 0, bar: 1, beat: 1, phase: 0, motion: 0, rec: false, loop_on: false });
            store().play();
            store().setLoopEnabled(true);
            store().setLoopEnabled(false);
            vi.advanceTimersByTime(60_000);
            expect(store().isPlaying).toBe(false);
        });

        it('freezes at an engine-reported song end and cancels the later watchdog', () => {
            vi.useFakeTimers();
            store().play();
            executorSpies.transportCallback!({ sample: 96_000, tick: 3840, bar: 2, beat: 1, phase: 0, motion: 0, rec: false, loop_on: false });
            const frozen = store().playheadTick;
            vi.advanceTimersByTime(60_000);
            expect(store().isPlaying).toBe(false);
            expect(store().playheadTick).toBe(frozen);
            expect(executorSpies.seekArrangement).not.toHaveBeenCalled();
        });

        it('tears down a partially started preview when play publication throws', () => {
            executorSpies.startArrangementPreview.mockImplementationOnce(() => { throw new Error('published then failed'); });
            store().play();
            expect(executorSpies.stopArrangementPreview).toHaveBeenCalled();
            expect(store().transportError).toContain('published then failed');
        });

        it('accepts count-in as a valid play acknowledgement', () => {
            vi.useFakeTimers();
            store().play();
            executorSpies.transportCallback!({ sample: 0, tick: 0, bar: 1, beat: 1, phase: 0, motion: 5, rec: false, loop_on: false });
            vi.advanceTimersByTime(2_000);
            expect(store().transportPending).toBeNull();
            expect(store().transportError).toBeNull();
        });

        it('TL-15 clears a failed seek honestly while preserving the last confirmed tick', () => {
            executorSpies.seekArrangement.mockImplementationOnce(() => { throw new Error('bridge unavailable'); });
            store().seek(480);
            expect(store().transportPending).toBeNull();
            expect(store().playheadTick).toBe(0);
            expect(store().transportError).toContain('bridge unavailable');
        });

        it('accepts a seek acknowledgement within one engine block', () => {
            store().seek(480);
            executorSpies.transportCallback!({ sample: 12_128, tick: 480, bar: 1, beat: 1, phase: 0.5, motion: 0, rec: false, loop_on: false });
            expect(store().transportPending).toBeNull();
        });

        it('an edit while playing republishes whole and does not restart transport', () => {
            vi.useFakeTimers();
            store().play();
            executorSpies.startArrangementPreview.mockClear();
            const trackId = store().arrangement!.tracks[0]!.id!;
            store().apply({ kind: 'setTrackMute', trackId, mute: true });
            expect(store().isPlaying).toBe(true);
            expect(store().arrangement!.tracks[0]!.mute).toBe(true);
            expect(executorSpies.updateArrangementPreview).toHaveBeenCalledTimes(1);
            expect(executorSpies.startArrangementPreview).not.toHaveBeenCalled();
        });

        it('a rolling seek keeps the button active but waits for the engine jump', () => {
            vi.useFakeTimers();
            store().play();
            store().seek(480);
            expect(store().isPlaying).toBe(true);
            expect(store().playheadTick).toBe(0);
            executorSpies.transportCallback!({ sample: 12_000, tick: 480, bar: 1, beat: 1, phase: 0.5, motion: 1, rec: false, loop_on: false });
            expect(store().playheadTick).toBe(480);
        });
    });

    it('stores IDs allocated during a gesture in the committed document and after reload', () => {
        const original = store().arrangement!;
        const trackId = original.tracks[0]!.id!;
        store().beginGesture('copy');
        const firstId = store().mintId('clip');
        store().previewGesture({ kind: 'addClip', trackId, clip: { id: firstId, sourceId: 'midi', startTick: 100, lengthTick: 120 } });
        store().commitGesture();
        const saved = JSON.parse(JSON.stringify(store().arrangement)) as Arrangement;
        store().setArrangement(saved);
        expect(store().mintId('clip')).not.toBe(firstId);
    });

    it('keeps nested UI gestures inside one outer transaction', () => {
        const trackId = store().arrangement!.tracks[0]!.id!;
        store().beginGesture('A');
        store().previewGesture({ kind: 'setTrackPan', trackId, pan: 0.5 });
        store().beginGesture('B');
        store().previewGesture({ kind: 'setTrackGain', trackId, gainDb: -6 });
        store().commitGesture();
        expect(useHistoryStore.getState().open).not.toBeNull();
        store().commitGesture();
        expect(store().arrangement!.tracks[0]!.pan).toBe(0.5);
        expect(store().arrangement!.tracks[0]!.gainDb).toBe(-6);
        expect(useHistoryStore.getState().cursor).toBe(1);
    });

    it('closes a velocity burst before a note drag so both edits stay undoable', () => {
        const trackId = store().arrangement!.tracks[0]!.id!;
        const burst = store().beginGesture('Adjust note velocity');
        store().previewGesture({ kind: 'setTrackPan', trackId, pan: 0.5 });
        store().commitGesture(burst);
        store().beginGesture('Move notes');
        store().previewGesture({ kind: 'setTrackGain', trackId, gainDb: -6 });
        store().commitGesture();

        expect(store().isGestureOpen()).toBe(false);
        expect(useHistoryStore.getState().open).toBeNull();
        expect(useHistoryStore.getState().cursor).toBe(2);
        store().undo();
        expect(store().arrangement!.tracks[0]!.gainDb).toBeUndefined();
        store().undo();
        expect(store().arrangement!.tracks[0]!.pan).toBeUndefined();
    });

    it('watchdog closes an ownerless gesture instead of wedging history', () => {
        vi.useFakeTimers();
        const trackId = store().arrangement!.tracks[0]!.id!;
        store().beginGesture('Orphan');
        store().previewGesture({ kind: 'setTrackPan', trackId, pan: 0.25 });

        vi.advanceTimersByTime(5_001);

        expect(store().isGestureOpen()).toBe(false);
        expect(useHistoryStore.getState().open).toBeNull();
        expect(store().arrangement!.tracks[0]!.pan).toBe(0.25);
        expect(logWarn).toHaveBeenCalledWith(expect.stringMatching(/watchdog/i), expect.anything());
    });

    it('queues an atomic edit behind a gesture, then records both as undoable entries', () => {
        const trackId = store().arrangement!.tracks[0]!.id!;
        store().beginGesture('A');
        store().previewGesture({ kind: 'setTrackPan', trackId, pan: 0.5 });
        store().apply({ kind: 'setTrackMute', trackId, mute: true });
        expect(store().arrangement!.tracks[0]!.pan).toBe(0.5);
        expect(store().arrangement!.tracks[0]!.mute).toBeUndefined();
        store().commitGesture();
        expect(store().arrangement!.tracks[0]!.pan).toBe(0.5);
        expect(store().arrangement!.tracks[0]!.mute).toBe(true);
        expect(useHistoryStore.getState().cursor).toBe(2);
        store().undo();
        expect(store().arrangement!.tracks[0]!.mute).toBeUndefined();
        store().undo();
        expect(store().arrangement!.tracks[0]!.pan).toBeUndefined();
    });

    it('rejects a queued edit wholly when the gesture deleted its target', () => {
        const clipId = store().arrangement!.tracks[0]!.clips[0]!.id!;
        store().beginGesture('Delete clip');
        store().previewGesture({ kind: 'removeClip', clipId });
        store().apply([{ kind: 'setClipMute', clipId, mute: true }, { kind: 'setTempo', tempoBpm: 222 }]);
        store().commitGesture();
        expect(store().arrangement!.tempoBpm).toBe(seed.tempoBpm);
        expect(store().transportError).toMatch(/rejected/i);
        expect(useHistoryStore.getState().cursor).toBe(1);
    });

    it('first Stop freezes and second Stop returns to the play origin', () => {
        store().seek(480);
        executorSpies.transportCallback!({ sample: 12_000, tick: 480, bar: 1, beat: 1, phase: 0.5, motion: 0, rec: false, loop_on: false });
        store().play();
        executorSpies.transportCallback!({ sample: 12_000, tick: 480, bar: 1, beat: 1, phase: 0.5, motion: 1, rec: false, loop_on: false });
        executorSpies.transportCallback!({ sample: 24_000, tick: 960, bar: 1, beat: 2, phase: 0, motion: 1, rec: false, loop_on: false });
        store().stop();
        expect(store().playheadTick).toBe(960);
        executorSpies.seekArrangement.mockClear();
        store().stop();
        expect(executorSpies.seekArrangement).toHaveBeenLastCalledWith(12_000);
    });

    it('seeks to bar 5 and starts playback from that parked playhead', () => {
        const midi = seed.sources!.midi!;
        if (midi.kind !== 'midi') throw new Error('fixture source must be MIDI');
        store().setArrangement({
            ...seed,
            sources: { midi: { ...midi, lengthTick: 20_000 } },
            tracks: [{ ...seed.tracks[0]!, clips: [{ ...seed.tracks[0]!.clips[0]!, lengthTick: 20_000 }] }],
        });
        const bar5 = 4 * 4 * seed.ppq!;
        store().seek(bar5);
        executorSpies.transportCallback!({ sample: 384_000, tick: bar5, bar: 5, beat: 1, phase: 0, motion: 0, rec: false, loop_on: false });
        store().play();
        expect(store().isPlaying).toBe(true);
        expect(store().playOriginTick).toBe(bar5);
    });

    it('starts from an in-flight seek target instead of the stale acknowledged playhead', () => {
        store().seek(1_920);
        expect(store().playheadTick).toBe(0);
        expect(store().transportPending).toBe('seek');
        store().play();
        expect(store().isPlaying).toBe(true);
        expect(store().playOriginTick).toBe(1_920);
        expect(executorSpies.startArrangementPreview).toHaveBeenLastCalledWith(expect.anything(), 48_000, expect.anything());
    });

    it('play stop seek play uses the new seek point instead of rewinding', () => {
        store().play();
        executorSpies.transportCallback!({ sample: 24_000, tick: 960, bar: 1, beat: 2, phase: 0, motion: 1, rec: false, loop_on: false });
        store().stop();
        store().seek(1_920);
        executorSpies.transportCallback!({ sample: 48_000, tick: 1_920, bar: 1, beat: 3, phase: 0, motion: 0, rec: false, loop_on: false });
        store().play();
        expect(store().isPlaying).toBe(true);
        expect(store().playOriginTick).toBe(1_920);
    });

    it('an end-of-song halt freezes without arming the user-only second Stop rewind', () => {
        store().seek(480);
        executorSpies.transportCallback!({ sample: 12_000, tick: 480, bar: 1, beat: 1, phase: 0.5, motion: 0, rec: false, loop_on: false });
        store().setLoopEnabled(true);
        store().play();
        executorSpies.transportCallback!({ sample: 24_000, tick: 960, bar: 1, beat: 2, phase: 0, motion: 1, rec: false, loop_on: true });
        store().haltAtEnd();
        expect(store().playheadTick).toBe(960);
        expect(store().loopEnabled).toBe(true);
        executorSpies.seekArrangement.mockClear();
        store().stop();
        expect(executorSpies.seekArrangement).not.toHaveBeenCalled();
        expect(store().loopEnabled).toBe(true);
    });

    it('clamps tempo through the document verb path', () => {
        store().setTempo(999);
        expect(store().arrangement!.tempoBpm).toBe(300);
        store().setTempo(1);
        expect(store().arrangement!.tempoBpm).toBe(20);
    });

    it('TL-16 enters recording only after lowering and engine start succeed', async () => {
        const trackId = store().arrangement!.tracks[0]!.id!;
        store().armTrack(trackId, true);
        executorSpies.startArrangementPreview.mockImplementationOnce(() => { throw new Error('publish rejected'); });
        await store().record();
        expect(store().isRecording).toBe(false);
        expect(store().isPlaying).toBe(false);
        expect(store().recordError).toContain('publish rejected');
    });

    it('TL-17 rejects recording completion from an earlier document generation', async () => {
        let releaseCapture!: () => void;
        executorSpies.stopArrangementRecording.mockImplementationOnce(() => new Promise((resolve) => {
            releaseCapture = () => resolve(null);
        }));
        const trackId = store().arrangement!.tracks[0]!.id!;
        store().armTrack(trackId, true);
        await store().record();
        expect(store().isRecording).toBe(true);
        const stopping = store().record();
        store().setArrangement({ ...seed, name: 'replacement' });
        releaseCapture();
        await stopping;
        expect(store().arrangement!.name).toBe('replacement');
        expect(store().recordError).toContain('different song session');
    });
});
