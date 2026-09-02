/**
 * TransportPillHost — the app's one transport, wired to the real engine.
 *
 * The pill itself (`oj-ui`) is presentational; this is where it meets the truth:
 *   • the gesture goes through `transportStore.toggleGlobalPause()`, the SAME
 *     call Space makes on the canvas, so the key and the button can never
 *     disagree about what just happened;
 *   • on the browser tier it also unlocks audio, synchronously, because a click
 *     on the play button IS the user gesture the autoplay policy is waiting for;
 *   • the bar.beat readout and the meter are written straight onto the DOM from
 *     the app's shared animation frame — never through React state, so a rolling
 *     transport costs zero renders.
 *
 * Zones appear only when they are TRUE. Without a Song there is no timeline, so
 * there is no position, no loop, no click and no record — and the tempo says why
 * it is inert rather than pretending to be a number you can change.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Meter, TransportPill, type MeterHandle } from '@openjammer/oj-ui';
import { stopReturnsToOrigin, transportAwaitingEngine, useArrangementStore } from '../../store/arrangementStore';
import { useAudioStore } from '../../store/audioStore';
import { useTransportStore } from '../../store/transportStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { formatBarBeat, timebase } from '../../song/time';
import { punchRecordState } from '../../song/recording';
import { registerTimelineFrameWriter } from '../Arrangement/sharedAnimationFrame';
import { useBindingSet } from '../../keymap/useKeymap';
import { subscribeMasterSignal } from './masterSignal';
import { parseBarBeat } from './barBeat';
import { releaseChromeFocus } from './chromeFocus';
import { isTauri } from '../../audio/executor';
import './TransportPillHost.css';

export function TransportPillHost({ onRequestAudio }: { onRequestAudio: () => void }) {
    const surface = useUiViewStore((state) => state.surface);
    const arrangement = useArrangementStore((state) => state.arrangement);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const isRecording = useArrangementStore((state) => state.isRecording);
    const transportPending = useArrangementStore((state) => state.transportPending);
    const transportError = useArrangementStore((state) => state.transportError);
    const playheadTick = useArrangementStore((state) => state.playheadTick);
    const loopEnabled = useArrangementStore((state) => state.loopEnabled);
    const punchEnabled = useArrangementStore((state) => state.punchEnabled);
    const clickEnabled = useArrangementStore((state) => state.clickEnabled);
    const countInBars = useArrangementStore((state) => state.countInBars);
    const armedTrackIds = useArrangementStore((state) => state.armedTrackIds);
    /**
     * Spec §7's second Stop. `stopReturnsToOrigin` is the SAME predicate
     * `transportStore.toggleGlobalPause` consults before it decides what this
     * button's click means, read here through the fields it depends on so the
     * glyph re-renders the instant the arm changes. The pill may not show a play
     * triangle over a press that will rewind instead.
     */
    const returnArmed = useArrangementStore((state) => stopReturnsToOrigin(state));

    const isGloballyPaused = useTransportStore((state) => state.isGloballyPaused);
    const isAudioContextReady = useAudioStore((state) => state.isAudioContextReady);
    const currentMode = useAudioStore((state) => state.currentMode);

    const positionRef = useRef<HTMLSpanElement>(null);
    const meterRef = useRef<MeterHandle>(null);
    const hostRef = useRef<HTMLDivElement>(null);

    // The meter: ONE subscription, the app's ONE frame, one style write.
    useEffect(() => subscribeMasterSignal((level) => meterRef.current?.setSignal(level)), []);

    /**
     * The pill PUBLISHES ITS WIDTH, because the ruled surfaces have to reserve a
     * lane for it and it is the only thing that knows how wide it is.
     *
     * The pill is `position: fixed; left: 50%` — centred on the window, not on
     * any column — so the arrangement's sky band reserves its middle
     * symmetrically. That reserve used to be a literal 432px copied off a
     * measurement, which meant adding a zone here would slide the pill back over
     * the armed edit-mode control with every test still green (W4-TBb §12.2).
     * Now `--arrangement-sky-pill-reserve` is `calc(this + 4px)`, so the
     * geometric promise is a coupling rather than a coincidence.
     *
     * ONE observer, and a write only when the number actually changes: this
     * fires during a transport zone appearing or disappearing, and a custom
     * property written on `documentElement` invalidates style for the whole
     * document — not something to do on every animation frame of a resize.
     */
    useEffect(() => {
        const element = hostRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        let published = -1;
        const publish = () => {
            const width = element.getBoundingClientRect().width;
            if (width <= 0 || Math.abs(width - published) < 0.5) return;
            published = width;
            document.documentElement.style.setProperty('--oj-transport-pill-width', `${width}px`);
        };
        publish();
        const observer = new ResizeObserver(publish);
        observer.observe(element);
        return () => {
            observer.disconnect();
            // Back to the stylesheet's declared fallback rather than a stale width.
            document.documentElement.style.removeProperty('--oj-transport-pill-width');
        };
    }, []);

    // The readout. While the transport is still we write once; while it rolls we
    // ride the shared frame. Either way React never sees the number.
    useEffect(() => {
        if (!arrangement) return;
        const write = () => {
            const state = useArrangementStore.getState();
            if (!state.arrangement || !positionRef.current) return;
            positionRef.current.textContent = formatBarBeat(timebase(state.arrangement), state.currentTick());
        };
        if (!isPlaying) {
            write();
            return;
        }
        return registerTimelineFrameWriter(write);
    }, [arrangement, isPlaying, playheadTick]);

    /**
     * THE PANIC PATH.
     *
     * While a start is unconfirmed the pill shows Play and its press asks again
     * — which is right, and leaves a performer with no gesture that ends a song
     * the engine may well be sounding. Escape is that gesture. It calls `stop()`
     * unconditionally: whatever the transport is waiting for, the stop command
     * goes out and the pill reads stopped.
     *
     * It claims the key ONLY in that wedged state (returning `false` otherwise
     * leaves Escape to everything else that wants it), and it is routed through
     * the keymap rather than a bare window listener so an open modal still wins.
     * The reason on the button names it, because a gesture nothing on screen
     * mentions is a gesture only its author knows.
     */
    useBindingSet(useMemo(() => ({
        id: 'transport-stop-anyway',
        scope: 'global' as const,
        entries: [{
            actionId: 'transport.stopAnyway',
            defaultBinding: { key: 'Escape' },
            run: () => {
                if (!transportAwaitingEngine(useArrangementStore.getState())) return false;
                useArrangementStore.getState().stop();
                return true;
            },
        }],
    }), []));

    /**
     * The transport gesture. `initAudioContext` runs FIRST and synchronously —
     * this handler is the user gesture the browser's autoplay policy wants, and
     * deferring the unlock into a promise chain or an effect loses it.
     */
    const onPlayToggle = useCallback(() => {
        if (!isAudioContextReady) onRequestAudio();
        useTransportStore.getState().toggleGlobalPause();
    }, [isAudioContextReady, onRequestAudio]);

    /**
     * Is it ACTUALLY rolling? The pill is the one place a performer looks to ask
     * that, so a Stop glyph over a frozen playhead is the worst lie this
     * component can tell — and `arrangementStore.isPlaying` is optimistic: it
     * flips the instant `play()` is called and STAYS true when the engine never
     * acknowledges (the 1.5 s timeout clears `transportPending` and raises
     * `transportError`, but leaves `isPlaying` alone).
     *
     * So the glyph waits for the engine's word:
     *   • `transportPending === 'play'` — the start is unconfirmed. Play, with
     *     the readout muted (spec §2.2: `--text-muted` while a command is in
     *     flight). Confirmation is one `TransportFrame` away, so on a healthy
     *     engine this is a frame, not a delay a hand can feel.
     *   • `transportError` on a PLAY — the engine refused or went silent on the
     *     start we sent. Play. The next confirmed frame clears the error, so a
     *     transient failure heals itself.
     *   • a `'seek'` or `'stop'` pending — the transport's state is not in doubt,
     *     only its position, so the glyph does not flicker mid-scrub.
     *   • a `'seek'` or `'stop'` that TIMED OUT on a rolling song — still Stop.
     *     What is unconfirmed is the position, not whether it is running, and a
     *     Play glyph there would take away the only gesture that ends the song.
     *   • a RECORD start, confirmed or not — still Stop, because Stop is what a
     *     performer means about a take, and it finishes it instead of orphaning it.
     * Stopping is instantaneous in the other direction: `isPlaying` goes false
     * the moment the gesture lands, and so does the glyph.
     */
    const awaitingEngine = useArrangementStore((state) => transportAwaitingEngine(state));
    const rolling = arrangement ? isPlaying && !awaitingEngine : isAudioContextReady && !isGloballyPaused;

    /**
     * WHERE the transport is reported, and it is here.
     *
     * `transportError` used to render on the arrangement's sky band and nowhere
     * else — a surface the player is not looking at while they press Play, on the
     * canvas, on the roll (HA-03). The pill is documented as the one place a
     * performer is told about the transport, so the reason rides the pill: a
     * `--warning-ink` dot on the button that is waiting, the sentence in the
     * PLAY BUTTON's `title`, and the same sentence as that button's accessible
     * description (`TransportPill`'s `faultReason`). On the group they were
     * unreachable: hovering the button that wears the dot showed "Play (space)",
     * and a keyboard user landing on it heard "Play, button" and nothing else.
     *
     * The sky band still mirrors it — a second view of one truth, not a second
     * truth. But the sky band lives INSIDE the arrangement surface, which is
     * `inert` and `aria-hidden` whenever the canvas is active, so it cannot be
     * the one announcement for a player pressing Play on the canvas. The pill's
     * own region takes that duty exactly when the arrangement cannot: `polite`,
     * because a report must never steal the moment.
     */
    const announceHere = surface !== 'arrangement';
    /*
     * The sentence the button carries, plus the way out of the state it is
     * reporting. Escape is the only gesture that always means stop while a start
     * is unconfirmed, so the tooltip that explains the dot also names it — a
     * hidden gesture with no visible twin is a secret.
     */
    const faultReason = transportError
        ? (awaitingEngine ? `${transportError} Press Esc to stop.` : transportError)
        : undefined;

    /**
     * The pulse is an explanation, not a decoration: it exists only because the
     * browser has not let sound through yet. Native unlocks on mount, so it never
     * appears there — saying "press me to start audio" on a desktop app that is
     * already running would be a lie in an animation.
     */
    const pulse = !isTauri() && !isAudioContextReady;

    /**
     * Space only carries the transport where it is actually bound: on the canvas
     * that is config mode (modes 2–9 give Space to the sustain pedal), and on the
     * piano roll it is not bound at all. An advertised key that does nothing is
     * worse than no hint.
     */
    const spaceHint =
        surface === 'arrangement' || (surface === 'canvas' && currentMode === 1) ? 'space' : undefined;

    const punch = arrangement?.locations?.find((location) => location.kind === 'punch' && location.endTick !== undefined);
    const outsidePunch = punchRecordState(punchEnabled, punch, playheadTick) === 'outside';

    const tempo = useMemo(
        () =>
            arrangement
                ? {
                      value: arrangement.tempoBpm,
                      onCommit: (bpm: number) => useArrangementStore.getState().setTempo(bpm),
                  }
                : {
                      // There is no global tempo without a song — `transportStore`
                      // holds a pause flag, not a clock. Say so.
                      value: 120,
                      onCommit: () => undefined,
                      disabled: true,
                      disabledReason: 'Add a Song node to set the tempo',
                  },
        [arrangement],
    );

    const position = useMemo(
        () =>
            arrangement
                ? {
                      display: formatBarBeat(timebase(arrangement), playheadTick),
                      pending: transportPending !== null,
                      onSeek: (text: string) => {
                          const state = useArrangementStore.getState();
                          if (!state.arrangement) return;
                          const tb = timebase(state.arrangement);
                          const tick = parseBarBeat(text, tb.ticksPerBar, tb.ticksPerBeat);
                          if (tick !== null) state.seek(tick);
                      },
                  }
                : undefined,
        [arrangement, playheadTick, transportPending],
    );

    return (
        <div
            className="oj-transport-host"
            ref={hostRef}
            data-transport-fault={transportError ? 'true' : undefined}
            onClick={releaseChromeFocus}
        >
            <TransportPill
                playing={rolling}
                faultReason={faultReason}
                onPlayToggle={onPlayToggle}
                playLabel={arrangement ? 'Play' : 'Start sound'}
                stopLabel={arrangement ? 'Stop' : 'Hold all sound'}
                returnArmed={returnArmed}
                pulse={pulse}
                onReturnToStart={arrangement ? () => useArrangementStore.getState().returnToStart() : undefined}
                record={
                    arrangement
                        ? {
                              recording: isRecording,
                              disabled: armedTrackIds.length === 0 && !isRecording,
                              disabledReason: 'Arm a track first — open the arrangement with Tab',
                              outsidePunch,
                              onToggle: () => void useArrangementStore.getState().record(),
                          }
                        : undefined
                }
                position={position}
                positionRef={positionRef}
                tempo={tempo}
                loop={
                    arrangement
                        ? { on: loopEnabled, onToggle: () => useArrangementStore.getState().setLoopEnabled(!loopEnabled) }
                        : undefined
                }
                metronome={
                    arrangement
                        ? {
                              on: clickEnabled,
                              countInBars,
                              onToggle: () => useArrangementStore.getState().setClick(!clickEnabled),
                              onCountIn: (bars) => useArrangementStore.getState().setCountIn(bars),
                          }
                        : undefined
                }
                meter={<Meter ref={meterRef} label="Master output level" />}
                hint={spaceHint}
            />
            {/*
              * The ONE live announcement, and only where the sky band's cannot
              * reach: on the canvas and the roll. Empty (not absent) at rest, so
              * the region exists before it has anything to say.
              */}
            <span className="oj-transport-host__reason" role="status" aria-live="polite">
                {announceHere && transportError ? transportError : ''}
            </span>
        </div>
    );
}
