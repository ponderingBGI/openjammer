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
import { useArrangementStore } from '../../store/arrangementStore';
import { useAudioStore } from '../../store/audioStore';
import { useTransportStore } from '../../store/transportStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { formatBarBeat, timebase } from '../../song/time';
import { punchRecordState } from '../../song/recording';
import { registerTimelineFrameWriter } from '../Arrangement/sharedAnimationFrame';
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

    const isGloballyPaused = useTransportStore((state) => state.isGloballyPaused);
    const isAudioContextReady = useAudioStore((state) => state.isAudioContextReady);
    const currentMode = useAudioStore((state) => state.currentMode);

    const positionRef = useRef<HTMLSpanElement>(null);
    const meterRef = useRef<MeterHandle>(null);

    // The meter: ONE subscription, the app's ONE frame, one style write.
    useEffect(() => subscribeMasterSignal((level) => meterRef.current?.setSignal(level)), []);

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
     *   • `transportError` — the engine refused or went silent. Play. The next
     *     confirmed frame clears the error, so a transient failure heals itself.
     *   • a `'seek'` or `'stop'` pending — the transport's state is not in doubt,
     *     only its position, so the glyph does not flicker mid-scrub.
     * Stopping is instantaneous in the other direction: `isPlaying` goes false
     * the moment the gesture lands, and so does the glyph.
     */
    const rolling = arrangement
        ? isPlaying && transportPending !== 'play' && transportError === null
        : isAudioContextReady && !isGloballyPaused;

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
        <div className="oj-transport-host" onClick={releaseChromeFocus}>
            <TransportPill
                playing={rolling}
                onPlayToggle={onPlayToggle}
                playLabel={arrangement ? 'Play' : 'Start sound'}
                stopLabel={arrangement ? 'Stop' : 'Hold all sound'}
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
        </div>
    );
}
