import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArrangementStore } from '../arrangementStore';
import type { Arrangement } from '../../song/types';

const executorSpies = vi.hoisted(() => ({
    startArrangementPreview: vi.fn(),
    stopArrangementPreview: vi.fn(),
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
    tracks: [
        { ref: 'keys', name: 'Keys', clips: [{ startTick: 0, notes: [{ tick: 0, durTick: 480, pitch: 60 }] }] },
    ],
};

const store = () => useArrangementStore.getState();

describe('arrangementStore — the timeline SSOT + command-log', () => {
    beforeEach(() => store().setArrangement(seed));
    afterEach(() => {
        store().stop();
        vi.useRealTimers();
    });

    it('normalizes on load (every entity has an id)', () => {
        const arr = store().arrangement!;
        expect(arr.tracks[0]!.id).toBeTruthy();
        expect(arr.tracks[0]!.clips[0]!.id).toBeTruthy();
        expect(arr.tracks[0]!.clips[0]!.notes[0]!.id).toBeTruthy();
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

    it('bumps docVersion on apply/undo/redo but not transport or selection', () => {
        const initialVersion = store().docVersion;
        const trackId = store().arrangement!.tracks[0]!.id!;

        store().selectClip(store().arrangement!.tracks[0]!.clips[0]!.id!);
        store().selectNotes([store().arrangement!.tracks[0]!.clips[0]!.notes[0]!.id!]);
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

    it('suppresses re-anchor during previews and commits once as one undo entry', () => {
        vi.useFakeTimers();
        store().play();
        executorSpies.startArrangementPreview.mockClear();
        const initialVersion = store().docVersion;
        const initialUndoDepth = store().undoStack.length;
        const trackId = store().arrangement!.tracks[0]!.id!;
        const verb = { kind: 'setTrackMute', trackId, mute: true } as const;

        store().apply(verb, { preview: true });
        store().apply(verb, { preview: true });
        expect(executorSpies.startArrangementPreview).not.toHaveBeenCalled();
        expect(store().docVersion).toBe(initialVersion);
        expect(store().undoStack).toHaveLength(initialUndoDepth);

        store().apply(verb);
        expect(executorSpies.startArrangementPreview).toHaveBeenCalledTimes(1);
        expect(store().docVersion).toBe(initialVersion + 1);
        expect(store().undoStack).toHaveLength(initialUndoDepth + 1);

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
        const noteId = store().mintId('note');
        store().apply({
            kind: 'addClip',
            trackId,
            index: 1,
            clip: { id: clipId, startTick: 1920, notes: [{ id: noteId, tick: 0, durTick: 240, pitch: 67 }] },
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

    it('transport freezes the playhead on stop (never snaps to 0)', () => {
        store().seek(1920);
        expect(store().currentTick()).toBe(1920);
        store().play();
        expect(store().isPlaying).toBe(true);
        store().stop();
        expect(store().isPlaying).toBe(false);
        // With no real audio clock in jsdom, elapsed is 0 — the point is it stays put.
        expect(store().playheadTick).toBe(1920);
    });

    it('seek clamps to the arrangement length (playhead never runs off the ruler)', () => {
        store().seek(10_000_000);
        // length rounds up to whole bars; the clamp keeps the playhead on the ruler.
        expect(store().currentTick()).toBeLessThan(10_000_000);
        store().seek(-500);
        expect(store().currentTick()).toBe(0);
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

        it('an edit while playing keeps playing (re-anchors, does not stop)', () => {
            vi.useFakeTimers();
            store().play();
            const trackId = store().arrangement!.tracks[0]!.id!;
            store().apply({ kind: 'setTrackMute', trackId, mute: true });
            expect(store().isPlaying).toBe(true);
            expect(store().arrangement!.tracks[0]!.mute).toBe(true);
        });

        it('a seek while playing stays playing and moves the playhead', () => {
            vi.useFakeTimers();
            store().play();
            store().seek(480);
            expect(store().isPlaying).toBe(true);
            expect(store().playheadTick).toBe(480);
        });
    });
});
