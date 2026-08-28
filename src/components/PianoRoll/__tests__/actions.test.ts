import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    state: { arrangement: {}, isPlaying: false },
    backend: 'ojcore-wasm' as 'ojcore-wasm' | 'native',
    auditionNote: vi.fn(),
    updateArrangementPreview: vi.fn(),
    stopArrangementPreview: vi.fn(),
}));

vi.mock('../../../store/arrangementStore', () => ({
    useArrangementStore: { getState: () => harness.state },
}));

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({
        auditionNote: harness.auditionNote,
        updateArrangementPreview: harness.updateArrangementPreview,
        stopArrangementPreview: harness.stopArrangementPreview,
        getTimelineBackend: () => harness.backend,
    }),
}));

vi.mock('../../../song/conduct', () => ({
    conduct: () => ({
        graph: {},
        tempoMap: [],
        timeline: [],
        trackIndex: { trackA: 7 },
    }),
}));

import {
    auditionPianoRollNote,
    cancelPianoRollAuditions,
    releasePianoRollAudition,
} from '../actions';

describe('piano-roll audition ownership', () => {
    beforeEach(() => {
        cancelPianoRollAuditions();
        vi.useFakeTimers();
        harness.state.arrangement = {};
        harness.state.isPlaying = false;
        harness.backend = 'ojcore-wasm';
        harness.auditionNote.mockClear();
        harness.updateArrangementPreview.mockClear();
        harness.stopArrangementPreview.mockClear();
    });

    it('tokenizes overlapping voices so each note-on receives exactly one note-off', () => {
        const first = auditionPianoRollNote('trackA', 60, 96, 'on');
        const second = auditionPianoRollNote('trackA', 60, 80, 'on');
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
        vi.runAllTimers();

        releasePianoRollAudition(second!, 17);
        auditionPianoRollNote('trackA', 60, 23, 'off');
        releasePianoRollAudition(second!, 17);

        expect(harness.auditionNote.mock.calls).toEqual([
            [7, 60, 48, true],
            [7, 60, 48, true],
            [7, 60, 17, false],
            [7, 60, 23, false],
        ]);
        expect(harness.stopArrangementPreview).toHaveBeenCalledTimes(1);
    });

    it('releases a sounding audition after playback starts without stopping transport', () => {
        const token = auditionPianoRollNote('trackA', 64, 40, 'on');
        vi.runAllTimers();
        harness.state.isPlaying = true;

        releasePianoRollAudition(token!);

        expect(harness.auditionNote.mock.calls).toEqual([
            [7, 64, 40, true],
            [7, 64, 0, false],
        ]);
        expect(harness.stopArrangementPreview).not.toHaveBeenCalled();
    });

    it('cancels pending and sounding voices on close without delayed interference', () => {
        harness.backend = 'native';
        auditionPianoRollNote('trackA', 67, 96, 'on');
        cancelPianoRollAuditions();
        vi.runAllTimers();
        expect(harness.auditionNote).not.toHaveBeenCalled();

        auditionPianoRollNote('trackA', 69, 96, 'on');
        vi.advanceTimersByTime(24);
        cancelPianoRollAuditions();
        vi.runAllTimers();

        expect(harness.auditionNote.mock.calls).toEqual([
            [7, 69, 48, true],
            [7, 69, 0, false],
        ]);
        expect(harness.stopArrangementPreview).toHaveBeenCalledTimes(2);
    });
});
