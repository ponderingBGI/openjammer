/**
 * U7 — the transport names the cause it can see.
 *
 * "The audio engine did not acknowledge the transport command" is honest about
 * the SYMPTOM and silent about the CAUSE, and the cause a first-time player hits
 * is not the engine: a track bound to nothing cannot be voiced, so there is
 * nothing for the engine to play. FH-1 spent 150 seconds believing the app's
 * engine was broken while the fix was one chip away on her own track (F11).
 *
 * The engine wording has to survive for the genuine case — sometimes it IS the
 * engine — so both branches are pinned.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../audio/executor', () => ({
    getExecutor: () => ({
        subscribeTransport: () => () => {},
        startArrangementPreview: vi.fn(),
        updateArrangementPreview: vi.fn(),
        stopArrangementPreview: vi.fn(),
        seekArrangement: vi.fn(),
        setArrangementLoop: vi.fn(),
        setArrangementPunch: vi.fn(),
        setArrangementClick: vi.fn(),
        setArrangementCountIn: vi.fn(),
        getTimelineBackend: () => 'wasm',
    }),
    isTauri: () => false,
}));

const { useArrangementStore, transportAwaitingEngine } = await import('../arrangementStore');
const { useTransportStore } = await import('../transportStore');
import type { Arrangement } from '../../song/types';

function song(bound: boolean): Arrangement {
    return {
        name: 'Untitled song',
        tempoBpm: 120,
        ppq: 960,
        timeSignature: [4, 4],
        graph: bound ? { nodes: [{ ref: 'voice', type: 'instrument' }], connections: [] } : { nodes: [], connections: [] },
        tracks: [{ id: 'track-1', name: 'Track 1', ref: bound ? 'voice' : 'track-1', clips: [] }],
    };
}

/** A song whose first track sounds and whose second does not. */
function withSecondUnboundTrack(): Arrangement {
    const base = song(true);
    return { ...base, tracks: [...base.tracks, { id: 'track-2', name: 'Track 2', ref: 'track-2', clips: [] }] };
}

beforeEach(() => {
    vi.useFakeTimers();
    useArrangementStore.getState().setArrangement(null);
});

describe('when the transport goes unanswered', () => {
    const UNBOUND = 'Track 1 has no instrument yet — choose one on the track and it will play.';
    const ENGINE = /audio engine did not acknowledge/i;

    it('names the unbound track instead of blaming the engine, on a PLAY', () => {
        useArrangementStore.getState().setArrangement(song(false));
        useArrangementStore.getState().play();
        vi.advanceTimersByTime(1600);
        expect(useArrangementStore.getState().transportError).toBe(UNBOUND);
    });

    it('keeps the engine wording when every track IS bound', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();
        vi.advanceTimersByTime(1600);
        expect(useArrangementStore.getState().transportError).toMatch(ENGINE);
    });

    /*
     * An unbound track explains why nothing SOUNDED. It explains nothing about a
     * seek or a stop, and "it will play" answers a question the player did not
     * ask - the gate reproduced exactly that by pressing Home on a song that had
     * never been played.
     */
    it('does NOT blame a track for a SEEK that went unanswered', () => {
        useArrangementStore.getState().setArrangement(song(false));
        useArrangementStore.getState().seek(960);
        vi.advanceTimersByTime(1600);
        expect(useArrangementStore.getState().transportError).toMatch(ENGINE);
        expect(useArrangementStore.getState().transportAwaitedCommand).toBe('seek');
    });

    it('does NOT blame a track for a STOP that went unanswered', () => {
        useArrangementStore.getState().setArrangement(song(false));
        useArrangementStore.getState().play();
        useArrangementStore.getState().stop();
        vi.advanceTimersByTime(1600);
        expect(useArrangementStore.getState().transportError).toMatch(ENGINE);
        expect(useArrangementStore.getState().transportAwaitedCommand).toBe('stop');
    });

    /*
     * A record on an all-unbound song never starts at all (nothing to bind), so
     * the case that matters is the honest one: an armed BOUND track beside an
     * unbound one. The take runs, the ack never comes, and the thing the player
     * can act on is the track that will not sound.
     */
    it('DOES blame an unbound track for a RECORD start that went unanswered', () => {
        useArrangementStore.getState().setArrangement(withSecondUnboundTrack());
        useArrangementStore.setState({ armedTrackIds: ['track-1'] });
        void useArrangementStore.getState().record();
        vi.advanceTimersByTime(1600);
        expect(useArrangementStore.getState().transportError).toMatch(/Track 2 has no instrument yet/);
        expect(useArrangementStore.getState().transportAwaitedCommand).toBe('record');
    });
});

describe('transportAwaitingEngine', () => {
    it('is the gap between what was asked for and what was confirmed', () => {
        useArrangementStore.getState().setArrangement(song(true));
        expect(transportAwaitingEngine()).toBe(false);

        useArrangementStore.getState().play();
        expect(transportAwaitingEngine()).toBe(true);
    });

    /*
     * The press that must never become a stop: while the engine is silent, a
     * retry re-asks for the same intent rather than taking it back.
     */
    it('retrying asks again — it does not stop the song', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();
        vi.advanceTimersByTime(1600);
        expect(useArrangementStore.getState().transportError).not.toBeNull();

        useArrangementStore.getState().retryTransport();

        expect(useArrangementStore.getState().isPlaying).toBe(true);
        expect(useArrangementStore.getState().transportPending).toBe('play');
        expect(useArrangementStore.getState().transportError).toBeNull();
    });

    it('does nothing when the transport is not waiting on anyone', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().retryTransport();
        expect(useArrangementStore.getState().isPlaying).toBe(false);
    });

    const rolling = () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();
        useArrangementStore.getState().receiveTransportFrame({
            sample: 4800, tick: 0, bar: 1, beat: 1, phase: 0, motion: 1, rec: false, loop_on: false,
        });
    };

    /*
     * G-03. Defined as "an error is set and we think we are playing", this also
     * caught a SEEK timeout on a genuinely rolling song: the pill flipped to Play
     * mid-performance and its press re-issued the song from the origin, with no
     * gesture left anywhere that stopped it. It is about the START we sent.
     */
    it('is FALSE for a seek that timed out on a rolling song, so the glyph stays Stop', () => {
        rolling();
        expect(transportAwaitingEngine()).toBe(false);

        useArrangementStore.getState().seek(9600);
        vi.advanceTimersByTime(1600);

        expect(useArrangementStore.getState().transportError).not.toBeNull();
        expect(useArrangementStore.getState().isPlaying).toBe(true);
        expect(transportAwaitingEngine()).toBe(false);
    });

    it('and the ordinary Stop gesture still stops it', () => {
        rolling();
        useArrangementStore.getState().seek(9600);
        vi.advanceTimersByTime(1600);

        useTransportStore.getState().toggleGlobalPause();

        expect(useArrangementStore.getState().isPlaying).toBe(false);
        expect(useArrangementStore.getState().transportPending).toBe('stop');
    });

    /*
     * G-04. A record start also sets `transportPending: 'play'`. Retrying it
     * re-entered `play()` WITHOUT the record flag while `isRecording`, the
     * bindings and the MIDI journal still pointed at the dead session — a
     * phantom take. The pill keeps showing Stop instead, which finishes it.
     */
    it('is FALSE during an unconfirmed RECORD start, so the gesture stays Stop', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.setState({ armedTrackIds: ['track-1'] });
        void useArrangementStore.getState().record();

        expect(useArrangementStore.getState().isRecording).toBe(true);
        expect(transportAwaitingEngine()).toBe(false);
    });

    it('never retries a recording behind the performers back', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.setState({ armedTrackIds: ['track-1'] });
        void useArrangementStore.getState().record();
        vi.advanceTimersByTime(1600);

        useArrangementStore.getState().retryTransport();

        expect(useArrangementStore.getState().isRecording).toBe(true);
        expect(useArrangementStore.getState().transportPending).toBeNull();
    });
});

/**
 * The stale-frame latch.
 *
 * The engine publishes what the transport IS, so a frame describing the instant
 * before it drained our Play command carries `motion: 0`. Landing after the play
 * was acknowledged, that frame used to set `isPlaying` false — and the guard
 * after it (`!pending && !isPlaying`) then swallowed every later frame, so the
 * playhead froze and the pill flickered back to Play over a rolling transport.
 * The engine no longer emits such a frame; the store must not depend on that.
 */
describe('a transport frame that predates the command it answers', () => {
    const frame = (sample: number, motion: number) => ({
        sample, tick: 0, bar: 1, beat: 1, phase: 0, motion, rec: false, loop_on: false,
    });

    it('never stops a transport that was just told to play', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();

        // [stale motion: 0 at (or before) the sample we asked to start from]
        useArrangementStore.getState().receiveTransportFrame(frame(0, 0));
        expect(useArrangementStore.getState().isPlaying).toBe(true);

        // [the real answer: rolling]
        useArrangementStore.getState().receiveTransportFrame(frame(4_800, 1));
        const state = useArrangementStore.getState();
        expect(state.isPlaying).toBe(true);
        expect(state.transportPending).toBeNull();
        expect(state.transportMotion).toBe(1);
    });

    it('still stops on a frame that POST-dates the command', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();
        useArrangementStore.getState().receiveTransportFrame(frame(4_800, 1));

        useArrangementStore.getState().receiveTransportFrame(frame(96_000, 0));

        expect(useArrangementStore.getState().isPlaying).toBe(false);
    });

    /*
     * G-05, the other way round. The guard covers the send -> first-ack window
     * and nothing else. Left armed for the whole of playback it would drop every
     * later `motion: 0` at that sample too, so an engine that genuinely stopped
     * at bar 1 could never say so and the pill would show Stop over a dead
     * transport.
     */
    it('is disarmed by the first frame that post-dates the command', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();
        useArrangementStore.getState().receiveTransportFrame(frame(4800, 1));
        expect(useArrangementStore.getState().isPlaying).toBe(true);

        // A genuine stop back at the origin sample is now heard.
        useArrangementStore.getState().receiveTransportFrame(frame(0, 0));

        expect(useArrangementStore.getState().isPlaying).toBe(false);
        expect(useArrangementStore.getState().transportMotion).toBe(0);
    });

    it('does not gate the answer to a deliberate Stop', () => {
        useArrangementStore.getState().setArrangement(song(true));
        useArrangementStore.getState().play();
        useArrangementStore.getState().receiveTransportFrame(frame(4_800, 1));
        useArrangementStore.getState().stop();

        useArrangementStore.getState().receiveTransportFrame(frame(0, 0));

        const state = useArrangementStore.getState();
        expect(state.isPlaying).toBe(false);
        expect(state.transportPending).toBeNull();
    });
});
