/**
 * W6-T / F1 — the ONE transport gesture is a three-state grammar, not a toggle.
 *
 * Spec §7: "Stop … the playhead freezes where it is (honest). A second Stop
 * returns it to the tick where playback last started." §4.2 names the same thing
 * for the key: "`Space` ×2 (stop then stop) — return the playhead to where the
 * last playback started".
 *
 * `arrangementStore.stop()` has always carried that behaviour. What made it
 * unreachable was every CALLER asking one question too few — `if (isPlaying)
 * stop() else play()` — so the second press played and §7's sentence could not be
 * performed by any human (W6-E2E finding F1). These tests drive the shipped
 * callers, not `stop()` directly: `transportStore.toggleGlobalPause` is the pill's
 * only handler and the canvas's `Space`, and `stopReturnsToOrigin` is the shared
 * predicate the two DAW surfaces' `Space` bindings and the pill's glyph read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopReturnsToOrigin, useArrangementStore } from '../arrangementStore';
import { useTransportStore } from '../transportStore';
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
    pauseContinuousSources: vi.fn(),
    resumeContinuousSources: vi.fn(),
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
    isTauri: () => false,
}));
vi.mock('../../utils/log', () => ({ logger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) }));

/** 120 BPM at PPQ 960 and 48 kHz: one tick is exactly 25 samples. */
const SAMPLES_PER_TICK = 25;
const PPQ = 960;
const BAR = 4 * PPQ;
/** Bar 5 starts after four bars. */
const BAR_5 = 4 * BAR;
/** Somewhere later, so "frozen where it is" is distinguishable from "at origin". */
const LATER = BAR_5 + BAR;

const seed: Arrangement = {
    name: 'transport gesture',
    tempoBpm: 120,
    ppq: PPQ,
    graph: { nodes: [{ ref: 'keys', type: 'keys' }, { ref: 'spk', type: 'speaker' }], connections: [{ from: 'keys', to: 'spk' }] },
    sources: { midi: { id: 'midi', kind: 'midi', name: 'MIDI', lengthTick: 40_000, notes: [{ tick: 0, durTick: 480, pitch: 60 }] } },
    tracks: [{ ref: 'keys', name: 'Keys', clips: [{ sourceId: 'midi', startTick: 0, lengthTick: 40_000 }] }],
};

const store = () => useArrangementStore.getState();
/** The gesture a hand actually makes: the pill's click handler and canvas `Space`. */
const press = () => useTransportStore.getState().toggleGlobalPause();
const acknowledge = (tick: number, motion: number) =>
    executorSpies.transportCallback!({ sample: tick * SAMPLES_PER_TICK, tick, bar: 1, beat: 1, phase: 0, motion, rec: false, loop_on: false });

describe('W6-T F1 — the transport gesture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        store().setArrangement(seed);
    });
    afterEach(() => {
        useArrangementStore.setState({ isPlaying: false, returnToOriginArmed: false });
        store().setArrangement(null);
    });

    it('press ×2 freezes honestly, press ×3 returns to where playback started', () => {
        store().seek(BAR_5);
        acknowledge(BAR_5, 0);

        press();
        expect(store().isPlaying, 'the first press plays').toBe(true);
        expect(store().playOriginTick).toBe(BAR_5);

        acknowledge(LATER, 1);
        press();
        expect(store().isPlaying, 'the second press stops').toBe(false);
        expect(store().playheadTick, 'and the playhead freezes exactly where it was').toBe(LATER);
        expect(stopReturnsToOrigin(), 'which arms the second Stop').toBe(true);

        executorSpies.seekArrangement.mockClear();
        press();
        expect(store().isPlaying, 'the third press must NOT play — it is the second Stop').toBe(false);
        expect(executorSpies.seekArrangement).toHaveBeenCalledTimes(1);
        expect(executorSpies.seekArrangement).toHaveBeenLastCalledWith(BAR_5 * SAMPLES_PER_TICK);
        expect(store().playOriginTick).toBe(BAR_5);
    });

    it('a fourth press plays again, from the origin it just returned to', () => {
        store().seek(BAR_5);
        acknowledge(BAR_5, 0);
        press();
        acknowledge(LATER, 1);
        press();
        press();
        expect(stopReturnsToOrigin(), 'the rewind disarms itself — a third Stop stays put').toBe(false);

        press();
        expect(store().isPlaying).toBe(true);
        // Not `LATER`: the press before this one moved the origin back to bar 5.
        expect(store().playOriginTick).toBe(BAR_5);
    });

    it('an end-of-song halt never arms the rewind — the next press plays', () => {
        store().seek(BAR_5);
        acknowledge(BAR_5, 0);
        press();
        acknowledge(LATER, 1);

        store().haltAtEnd();
        expect(store().isPlaying).toBe(false);
        expect(stopReturnsToOrigin(), 'the song ending is not a Stop the player pressed').toBe(false);

        press();
        expect(store().isPlaying, 'so the next press is a Play, from where the song ended').toBe(true);
        expect(store().playOriginTick).toBe(LATER);
    });

    it('a seek between the two Stops re-aims the transport, so the press plays', () => {
        store().seek(BAR_5);
        acknowledge(BAR_5, 0);
        press();
        acknowledge(LATER, 1);
        press();

        store().seek(BAR);
        acknowledge(BAR, 0);
        expect(stopReturnsToOrigin(), 'a locate is a new intention, not a rewind').toBe(false);

        press();
        expect(store().isPlaying).toBe(true);
        expect(store().playOriginTick).toBe(BAR);
    });

    it('is never armed while rolling, and never without a song', () => {
        store().seek(BAR_5);
        acknowledge(BAR_5, 0);
        press();
        acknowledge(LATER, 1);
        expect(stopReturnsToOrigin(), 'a rolling transport shows Stop, not Return').toBe(false);

        press();
        store().setArrangement(null);
        expect(stopReturnsToOrigin(), 'no song, no timeline, no origin').toBe(false);
    });
});
