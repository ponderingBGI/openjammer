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
    transportCallback: null as null | ((frame: {
        sample: number; tick: number; bar: number; beat: number; phase: number;
        motion: number; rec: boolean; loop_on: boolean;
    }) => void),
    subscribeTransport: vi.fn((callback) => {
        executorSpies.transportCallback = callback;
        return () => {};
    }),
}));

vi.mock('../../audio/executor', () => ({
    getExecutor: () => executorSpies,
}));

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
        const source = store().arrangement!.sources!.midi!;
        store().selectNotes([source.kind === 'midi' ? source.notes[0]!.id! : '']);
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
});
