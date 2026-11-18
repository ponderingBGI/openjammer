import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Arrangement, ArrangementClip, ArrangementNote } from '../../song/types';
import type { Verb } from '../../song/verbs';
import { copyNotes, drawNotes, eraseNotes, moveNotes, noteDragFloor, resizeNotes, setVelocity as lowerVelocity, splitNotes, transposeNotes } from '../../song/ops';
import { InstrumentLoader } from '../../audio/instrumentCatalog';
import { gridTicks, snapTimeline, type GridUnit } from '../../store/editingContextStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { copySelection, cutSelection, paste } from '../../song/editingActions';
import { stopReturnsToOrigin, useArrangementStore } from '../../store/arrangementStore';
import { useHistoryStore } from '../../store/historyStore';
import { getGridLadder } from '../../song/rulerMarks';
import { growPitchRange, initialPitchRange, useTrackLaneViewStore, type PitchRange } from '../../store/trackLaneViewStore';
import {
    clippedNoteGeometry,
    DRUM_ROW_HEIGHT,
    inlineOpeningPxPerTick,
    GM_DRUM_NAMES,
    isBlackPitch,
    isKeyboardSeam,
    KEY_COLUMN_WIDTH,
    pitchName,
    pitchRowHeight,
    resizeEdge,
    SCROOMER_WIDTH,
    shouldAutoDetectDrums,
    velocityOpacity,
    VELOCITY_LANE_HEIGHT,
} from './geometry';
import './PianoRoll.css';
import { cancelPianoRollAuditions, type PianoRollAuditionToken } from './actions';
import { ownPointerGesture } from '../Arrangement/pointerGestureLifetime';
import { useBindingSet } from '../../keymap/useKeymap';
import { registerTimelineFrameWriter } from '../Arrangement/sharedAnimationFrame';

export type PianoRollMode = 'inline' | 'surface';

export interface PianoRollProps {
    trackId: string;
    clipId: string;
    mode?: PianoRollMode;
    /** The arrangement's value. Supplying it is what keeps the shared time axis exact. */
    pxPerTick: number;
    /** Timeline origin visible at the left edge, in song ticks. */
    leftTick?: number;
    height?: number;
    drumMode?: boolean;
    onDrumModeChange?: (enabled: boolean) => void;
    onClose?: () => void;
    onOpenSurface?: () => void;
    onQuantize?: (noteIds: string[]) => void;
    onAudition?: (pitch: number, velocity: number, phase: 'on' | 'off', token?: PianoRollAuditionToken) => PianoRollAuditionToken | null | void;
}

interface DragState {
    kind: 'move' | 'resize-start' | 'resize-end' | 'velocity';
    pointerId: number;
    startX: number;
    startY: number;
    notes: ArrangementNote[];
    primary: ArrangementNote;
    base: Arrangement;
    copyIds: string[] | null;
    cleanup: () => void;
}

function noteRange(notes: readonly ArrangementNote[]): PitchRange {
    if (!notes.length) return initialPitchRange(60, 60);
    return initialPitchRange(Math.min(...notes.map((note) => note.pitch)), Math.max(...notes.map((note) => note.pitch)));
}

function findClip(track: { clips: ArrangementClip[] }, clipId: string): ArrangementClip | undefined {
    return track.clips.find((item) => item.id === clipId);
}

/**
 * V · B · X · K · T — Select, Draw, Erase, Knife, Step. Same five letters, same
 * order, on the arrangement and here, so the hand learns one tool grammar.
 */
const ROLL_TOOLS = [
    ['select', 'V', 'Select tool'],
    ['draw', 'B', 'Draw tool'],
    ['erase', 'X', 'Erase tool'],
    ['knife', 'K', 'Knife tool'],
    ['step', 'T', 'Step entry'],
] as const;

/**
 * The full surface's key bed is a CONSTANT width in both pitched and drum mode.
 * The ruler above it is offset by the same number, and a gutter that changed
 * with drum auto-detection would slide every bar number 20px sideways the moment
 * a part looked percussive. Fits a GM name; the inline lane keeps the narrower
 * pitched bed, where nothing above it claims to measure the notes.
 */
/**
 * The lane's own bar strip (F1). 14px, the micro mono voice, inside the lane —
 * a second viewport that does not say where it is is worse than one that shares
 * an axis it does not honour.
 */
export const LANE_RULER_HEIGHT = 14;

export const SURFACE_KEY_WIDTH = 64;
/** Scroomer + key bed — what the surface's ruler corner has to match exactly. */
export const SURFACE_GUTTER = SCROOMER_WIDTH + SURFACE_KEY_WIDTH;

/** The quantize ladder the grid chip cycles. */
const QUANTIZE_GRIDS: GridUnit[] = ['1/4', '1/8', '1/16', '1/32', '1/8t'];

export function PianoRoll(props: PianoRollProps) {
    const { clipId, onClose, trackId } = props;
    const mode = props.mode ?? 'inline';
    const height = props.height ?? (mode === 'inline' ? 220 : 560);
    const arrangement = useArrangementStore((state) => state.arrangement);
    const selectionSurface = mode === 'surface' ? 'pianoroll' : 'arrangement';
    const selectedNoteIds = useEditingContextStore((state) => state.viewports[selectionSurface].selection.noteIds);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const gridUnit = useEditingContextStore((state) => state.gridUnit);
    const snapMode = useEditingContextStore((state) => state.snapMode);
    const drawLength = useEditingContextStore((state) => state.drawLength);
    const drawVelocity = useEditingContextStore((state) => state.drawVelocity);
    const stepEntry = useEditingContextStore((state) => state.stepEntry);
    const quantizeGrid = useEditingContextStore((state) => state.quantizeGrid);
    const quantizeStrength = useEditingContextStore((state) => state.quantizeStrength);
    const quantizeSwing = useEditingContextStore((state) => state.quantizeSwing);
    const tool = useEditingContextStore((state) => state.viewports[mode === 'surface' ? 'pianoroll' : 'arrangement'].tool);
    const trackRange = useTrackLaneViewStore((state) => state.pitchRanges[props.trackId]);
    const rememberPitchRange = useTrackLaneViewStore((state) => state.rememberPitchRange);
    const rootRef = useRef<HTMLDivElement>(null);
    const fieldRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const drawRef = useRef<{ pointerId: number; clientX: number; tick: number; pitch: number; cleanup: () => void } | null>(null);
    const marqueeRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number; cleanup: () => void } | null>(null);
    const velocityWheelTimer = useRef<number | null>(null);
    const velocityWheelBase = useRef<Arrangement | null>(null);
    const velocityWheelDelta = useRef(0);
    const velocityGestureId = useRef<number | null>(null);
    const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
    const auditionTokens = useRef(new Map<number, PianoRollAuditionToken[]>());
    const keyBedDrag = useRef<{ pointerId: number; y: number; range: PitchRange; cleanup: () => void } | null>(null);
    /** The Erase tool's swept stroke — one open gesture, one Ctrl+Z (U11). */
    const eraseRef = useRef<{ pointerId: number; base: Arrangement; ids: Set<string>; cleanup: () => void } | null>(null);
    /** The notice line's self-clear, owned so an unmount cannot leave it running (N3). */
    const noticeTimer = useRef<number | null>(null);
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [ghost, setGhost] = useState<{ tick: number; pitch: number; durTick: number } | null>(null);
    const [rejection, setRejection] = useState('');
    /*
     * The spoken half of a tool that DELETES or CUTS (U11). Erase and Knife are
     * the two gestures whose whole result is that something is no longer where
     * it was, so silence is the one response that cannot be read. A polite
     * `role="status"` line, self-clearing, never focus-stealing — the same shape
     * as the rejection line beside it, in the affirmative.
     */
    const [notice, setNotice] = useState('');
    const [quantizeOpen, setQuantizeOpen] = useState(false);
    /*
     * The full surface gets no `onDrumModeChange` from its host, so its "Drums"
     * button was pressed-looking and inert — auto-detection with no way out.
     * Own the override locally when nobody else does; §9 promises an explicit
     * override, and a control that cannot be un-pressed is worse than none.
     */
    const [localDrumMode, setLocalDrumMode] = useState<boolean | undefined>(undefined);
    /*
     * ROVING TABINDEX (W6-SHIP item 6).
     *
     * Every note is a real `<button>` — which is right, they are the primary
     * object of this editor and they should be operable — but all of them were
     * `tabIndex 0`. The starter's first clip has 128 notes, so tabbing INTO the
     * roll cost 128 presses to get back out again: the roll was a tab trap, and
     * a worse one than an unreachable control, because the notes INVITE the
     * keyboard and then hold it.
     *
     * The fix is the standard composite-widget pattern: the roll is ONE tab stop.
     * One note is tabbable at a time, the rest are `-1`, and the arrows move the
     * roving focus between them. `Tab` then leaves the roll in a single press.
     *
     * This is deliberately NOT selection. Selection is what the edit verbs act on
     * and it already has its own grammar (click, shift-click, marquee, Ctrl+A);
     * roving focus is only "which note would `Tab` land on". They are kept apart
     * so nothing about the existing edit semantics moves.
     */
    const [rovingNoteId, setRovingNoteId] = useState<string | null>(null);

    const track = arrangement?.tracks.find((item) => item.id === props.trackId);
    const clip = track && findClip(track, props.clipId);
    const source = clip && arrangement?.sources?.[clip.sourceId];
    const midiSource = source?.kind === 'midi' ? source : null;
    const ppq = arrangement?.ppq ?? 960;
    const beatsPerBar = arrangement?.timeSignature?.[0] ?? 4;
    const ticksPerBar = ppq * beatsPerBar;
    /*
     * THE INLINE ROLL'S OWN ZOOM (HA-18).
     *
     * The lane roll used to draw at the Song's `pxPerTick`, where a half-beat
     * note is 4.8px wide — under `resizeEdge`'s floor, so the first clip a
     * player ever opens could be moved but never trimmed, and the only zoom was
     * a `Ctrl+wheel` nothing on screen mentioned. So the inline roll opens on its
     * own floor (`inlineOpeningPxPerTick`) and never below the Song's value: a
     * player who has already zoomed the Song past that floor keeps their axis.
     *
     * `null` means "still following the Song". The moment the player uses the
     * roll's own zoom the value pins, so the axis stops moving under their hand
     * when the Song is zoomed behind them.
     */
    const [inlinePxPerTick, setInlinePxPerTick] = useState<number | null>(null);
    /*
     * THE LANE IS A SECOND VIEWPORT (F1).
     *
     * The first cut of HA-18 gave the lane its own zoom and left it inside the
     * Song's viewport, so the ruler 60px above drew bars every 38.7px over a
     * roll drawing them every 192px — a 4.95x disagreement on a surface whose
     * whole contract is "a clip edge lands exactly on its grid line at every
     * zoom" (spec 2.1). One viewport cannot have two axes.
     *
     * So the lane stops pretending to be part of the Song's viewport and
     * becomes what a DAW's clip view is: its OWN horizontal scroller, its OWN
     * bar strip inside the lane, its OWN playhead on its own axis. The Song's
     * ruler above it stays the Song's, and it is now honestly measuring only
     * the lanes that are still on the Song's axis. Both playheads read the same
     * TICK from the same clock; only their pixels differ, exactly as they
     * already do between the Song and the full roll surface.
     */
    const [laneScrollLeftPx, setLaneScrollLeftPx] = useState(0);
    const pxPerTick = mode === 'inline'
        ? inlinePxPerTick ?? Math.max(props.pxPerTick, inlineOpeningPxPerTick(ppq))
        : props.pxPerTick;
    const zoomBy = (factor: number) => {
        const next = Math.max(4 / ticksPerBar, Math.min(4000 / ticksPerBar, pxPerTick * factor));
        if (mode === 'inline') setInlinePxPerTick(next);
        else useEditingContextStore.getState().setViewport('pianoroll', { pxPerTick: next });
    };
    /*
     * The lane scrolls itself, so its origin is its own scroll offset rather
     * than the Song's `leftTick`. The surface keeps taking the host's value: it
     * has a real ruler above it that is pixel-locked to exactly this number.
     */
    const contentOriginTick = mode === 'inline' ? 0 : props.leftTick ?? 0;
    /** The tick at the left edge of what is actually on screen. */
    const viewLeftTick = mode === 'inline' ? laneScrollLeftPx / pxPerTick : props.leftTick ?? 0;
    const allTrackNotes = (() => {
        if (!track || !arrangement?.sources) return [];
        return track.clips.flatMap((item) => {
            const itemSource = arrangement.sources?.[item.sourceId];
            return itemSource?.kind === 'midi' ? itemSource.notes : [];
        });
    })();
    const instrumentId = arrangement?.graph.nodes.find((node) => node.ref === track?.ref)?.data?.instrumentId;
    const instrumentDrums = typeof instrumentId === 'string' && InstrumentLoader.getDefinition(instrumentId)?.category === 'percussion';
    // Every kit signal the app HAS, handed to one predicate: the instrument's
    // registry category (a fact), the two names (weak evidence), and the shape of
    // the material (the last resort). `instrumentDrums` used to be OR'd in here
    // and nowhere else, so the inline roll in `TrackLaneView` — the roll a player
    // actually meets first — was making the decision on the guess alone.
    const autoDrum = shouldAutoDetectDrums(allTrackNotes, {
        instrumentIsPercussion: instrumentDrums,
        trackName: track?.name,
        instrumentId: typeof instrumentId === 'string' ? instrumentId : undefined,
        ppq: arrangement?.ppq,
    });
    const drumMode = props.drumMode ?? localDrumMode ?? autoDrum;
    const range = trackRange ?? noteRange(allTrackNotes);
    const trackPitchMin = allTrackNotes.length ? Math.min(...allTrackNotes.map((note) => note.pitch)) : null;
    const trackPitchMax = allTrackNotes.length ? Math.max(...allTrackNotes.map((note) => note.pitch)) : null;
    const laneRulerHeight = mode === 'inline' ? LANE_RULER_HEIGHT : 0;
    const noteFieldHeight = Math.max(90, height - VELOCITY_LANE_HEIGHT - laneRulerHeight);
    const rowHeight = pitchRowHeight(noteFieldHeight, range, drumMode);
    const pitches = Array.from({ length: range.hi - range.lo + 1 }, (_, index) => range.hi - index);
    const contentHeight = drumMode ? pitches.length * DRUM_ROW_HEIGHT : Math.max(noteFieldHeight, pitches.length * rowHeight);
    const contentWidth = Math.max(1, (Math.max(clip?.startTick ?? 0, ...(track?.clips.map((item) => item.startTick + item.lengthTick) ?? [ticksPerBar])) + ticksPerBar) * pxPerTick);
    /*
     * The bar numbers the lane's own strip prints. Stride laddering, the same
     * idea the Song's ruler uses: never crowd the labels below 56px, so a
     * zoomed-out lane reads 1 · 5 · 9 rather than a grey smear.
     */
    const laneBars = (() => {
        if (mode !== 'inline') return [] as number[];
        const pxPerBar = ticksPerBar * pxPerTick;
        const stride = Math.max(1, Math.ceil(56 / Math.max(1, pxPerBar)));
        const bars: number[] = [];
        for (let bar = 0; bar * pxPerBar <= contentWidth; bar += stride) bars.push(bar);
        return bars;
    })();
    const noteIdSet = new Set(selectedNoteIds);

    useEffect(() => {
        if (!trackRange) rememberPitchRange(props.trackId, range);
        else if (trackPitchMin !== null && trackPitchMax !== null) {
            const grown = growPitchRange(trackRange, trackPitchMin, trackPitchMax);
            if (grown !== trackRange) rememberPitchRange(props.trackId, grown);
        }
    }, [props.trackId, range, rememberPitchRange, trackPitchMax, trackPitchMin, trackRange]);

    useEffect(() => () => {
        const drag = dragRef.current;
        if (drag) {
            drag.cleanup();
            dragRef.current = null;
            useArrangementStore.getState().abortGesture();
        }
        drawRef.current?.cleanup();
        drawRef.current = null;
        marqueeRef.current?.cleanup();
        marqueeRef.current = null;
        if (eraseRef.current) {
            eraseRef.current.cleanup();
            eraseRef.current = null;
            useArrangementStore.getState().abortGesture();
        }
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
        if (velocityWheelTimer.current !== null) window.clearTimeout(velocityWheelTimer.current);
        if (velocityGestureId.current !== null && useArrangementStore.getState().isGestureOpen(velocityGestureId.current)) useArrangementStore.getState().commitGesture();
        velocityWheelTimer.current = null;
        velocityWheelBase.current = null;
        velocityWheelDelta.current = 0;
        velocityGestureId.current = null;
        auditionTokens.current.clear();
        cancelPianoRollAuditions();
    }, [props.clipId, props.trackId, selectionSurface]);

    const grid = gridTicks(gridUnit, ppq, ticksPerBar, pxPerTick);
    const drawGrid = gridTicks(drawLength, ppq, ticksPerBar, pxPerTick, true) ?? ppq / 4;
    const stepLength = gridTicks(stepEntry.length, ppq, ticksPerBar, pxPerTick, true) ?? grid ?? ppq / 4;
    const snap = (tick: number, invert = false) => {
        const anchors = (midiSource?.notes ?? []).flatMap((note) => [note.tick, note.tick + note.durTick]);
        const result = snapTimeline({ rawTick: tick, gridUnitTicks: grid, anchorTicks: anchors, pxPerTick, mode: snapMode, invert });
        useEditingContextStore.getState().setSnapIndicatorTick(result.indicatorTick);
        return result.tick;
    };
    const yToPitch = (clientY: number) => {
        const bounds = fieldRef.current?.getBoundingClientRect();
        if (!bounds) return range.hi;
        return Math.max(range.lo, Math.min(range.hi, range.hi - Math.floor((clientY - bounds.top + fieldRef.current!.scrollTop) / rowHeight)));
    };
    const xToTick = (clientX: number) => {
        const bounds = fieldRef.current?.getBoundingClientRect();
        if (!bounds) return viewLeftTick;
        // The scroller carries the lane's origin; the surface carries it in the
        // content transform. Exactly one of the two is ever non-zero.
        return Math.max(0, contentOriginTick + (clientX - bounds.left + fieldRef.current!.scrollLeft) / pxPerTick);
    };

    const audition = (pitch: number, velocity: number, phase: 'on' | 'off') => {
        if (isPlaying) return;
        if (phase === 'on') {
            const token = props.onAudition?.(pitch, velocity, phase);
            if (typeof token === 'number') auditionTokens.current.set(pitch, [...(auditionTokens.current.get(pitch) ?? []), token]);
            return;
        }
        const tokens = auditionTokens.current.get(pitch) ?? [];
        const token = tokens.shift();
        if (tokens.length) auditionTokens.current.set(pitch, tokens); else auditionTokens.current.delete(pitch);
        props.onAudition?.(pitch, velocity, phase, token);
    };

    const selectNote = (event: ReactPointerEvent, note: ArrangementNote) => {
        if (!note.id) return;
        const context = useEditingContextStore.getState();
        const current = context.viewports[selectionSurface].selection.noteIds;
        let noteIds: string[];
        if (event.ctrlKey || event.metaKey) {
            noteIds = current.includes(note.id) ? current.filter((id) => id !== note.id) : [...current, note.id];
        } else if (event.shiftKey) {
            noteIds = [...new Set([...current, note.id])];
        } else if (!current.includes(note.id)) {
            noteIds = [note.id];
        } else noteIds = current;
        context.setSelection(selectionSurface, { noteIds });
    };

    const finishVelocityWheelGesture = () => {
        if (velocityWheelTimer.current !== null) window.clearTimeout(velocityWheelTimer.current);
        const id = velocityGestureId.current;
        velocityWheelTimer.current = null;
        velocityWheelBase.current = null;
        velocityWheelDelta.current = 0;
        velocityGestureId.current = null;
        if (id !== null) useArrangementStore.getState().commitGesture(id);
    };

    wheelHandlerRef.current = (event) => {
        /*
         * HA-18: the inline roll owns `Ctrl+wheel` on its own axis. Without this
         * the notch fell through to the Song's zoom, which is exactly why the
         * lane roll had no reachable zoom at all — and why the hint in the zoom
         * control's `title` would have been a lie. The full surface keeps its
         * host's handler (`PianoRollSurfaceHost`), which zooms around the pointer
         * because it has a whole viewport to anchor in.
         */
        if (mode === 'inline' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            zoomBy(Math.exp(-event.deltaY * .002));
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
            event.preventDefault();
            const span = range.hi - range.lo + 1;
            const nextSpan = Math.max(6, Math.min(128, span + (event.deltaY > 0 ? 2 : -2)));
            const center = Math.round((range.hi + range.lo) / 2);
            const lo = Math.max(0, Math.min(128 - nextSpan, center - Math.floor(nextSpan / 2)));
            rememberPitchRange(props.trackId, { lo, hi: lo + nextSpan - 1 });
            return;
        }
        if (!event.altKey || !selectedNoteIds.length || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const amount = (event.shiftKey ? 10 : 1) * (event.deltaY < 0 ? 1 : -1);
        const request = { mode: 'delta' as const, amount };
        const store = useArrangementStore.getState();
        if (!velocityWheelBase.current) {
            velocityWheelBase.current = arrangement;
            velocityWheelDelta.current = 0;
            velocityGestureId.current = store.beginGesture('Adjust note velocity', selectionSurface);
        }
        const base = velocityWheelBase.current;
        if (!event.shiftKey) velocityWheelDelta.current += amount;
        const burstRequest = { ...request, amount: velocityWheelDelta.current };
        if (base) store.previewGesture(lowerVelocity(base, selectedNoteIds, burstRequest).verbs);
        if (velocityWheelTimer.current !== null) window.clearTimeout(velocityWheelTimer.current);
        velocityWheelTimer.current = window.setTimeout(finishVelocityWheelGesture, 180);
    };
    /*
     * FOLLOW, in the lane's own pixels (F1).
     *
     * The lane has its own axis, so the Song's follow-scroll cannot page it: at
     * 0.05px/tick the playhead leaves a 1 200px lane five times sooner than it
     * leaves the Song's viewport. Same page rule as `PlayheadLayer.follow`
     * (cross the last 15%, jump to one sixth from the left) and the same `F`
     * toggle, so "follow" means one thing in this app and the two viewports page
     * in step.
     *
     * It rides the roll's EXISTING playhead writer rather than registering a
     * second one: two subscriptions to the shared frame are two clocks, and the
     * whole point of `registerTimelineFrameWriter` is that there is one.
     */
    const followLane = (tick: number) => {
        const field = fieldRef.current;
        if (mode !== 'inline' || !field || !useEditingContextStore.getState().followPlayhead) return;
        const x = tick * pxPerTick;
        const page = Math.max(1, field.clientWidth);
        if (x < field.scrollLeft || x > field.scrollLeft + page * 0.85) field.scrollLeft = Math.max(0, x - page / 6);
    };
    const followLaneRef = useRef(followLane);
    followLaneRef.current = followLane;

    const canRender = Boolean(arrangement && track && clip && midiSource);
    useEffect(() => {
        if (!canRender) return;
        const root = rootRef.current;
        if (!root) return;
        const onWheel = (event: WheelEvent) => wheelHandlerRef.current(event);
        root.addEventListener('wheel', onWheel, { passive: false });
        return () => root.removeEventListener('wheel', onWheel);
    }, [canRender]);

    const startNoteDrag = (event: ReactPointerEvent<HTMLButtonElement>, note: ArrangementNote, width: number) => {
        if (!note.id || event.button === 2) return;
        selectNote(event, note);
        audition(note.pitch, Math.min(48, note.vel ?? 96), 'on');
        const selected = useEditingContextStore.getState().viewports[selectionSurface].selection.noteIds;
        const notes = (midiSource?.notes ?? []).filter((item) => item.id && (selected.includes(item.id) || item.id === note.id));
        const edge = resizeEdge(event.nativeEvent.offsetX, width);
        if (!arrangement) return;
        const copy = !edge && (event.ctrlKey || event.metaKey);
        // A wheel burst owns a short-lived gesture. Land it before the pointer
        // gesture begins so its timer can never orphan an outer history frame.
        finishVelocityWheelGesture();
        useArrangementStore.getState().beginGesture(edge ? 'Resize notes' : copy ? 'Copy notes' : 'Move notes', selectionSurface);
        const pointerId = event.pointerId;
        dragRef.current = { kind: edge ? `resize-${edge}` : 'move', pointerId, startX: event.clientX, startY: event.clientY, notes, primary: note, base: arrangement, copyIds: copy ? notes.map(() => useArrangementStore.getState().mintId('note')) : null, cleanup: () => undefined };
        dragRef.current.cleanup = ownPointerGesture(pointerId, {
            move: moveNoteDrag,
            commit: (nativeEvent) => endDrag(nativeEvent.pointerId),
            abort: () => cancelNoteDrag(),
        }, 'pianoroll');
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ }
    };

    function moveNoteDrag(event: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'shiftKey'>) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaPitch = drag.kind === 'move' ? Math.round((drag.startY - event.clientY) / rowHeight) : 0;
        const rawDelta = (event.clientX - drag.startX) / pxPerTick;
        const targetTick = snap(drag.primary.tick + rawDelta);
        const deltaTick = Math.round(targetTick - drag.primary.tick);
        const ids = drag.notes.flatMap((note) => note.id ? [note.id] : []);
        const result = drag.kind === 'move'
            ? drag.copyIds
                ? copyNotes(drag.base, ids, deltaTick, deltaPitch, (() => { let index = 0; return () => drag.copyIds![index++]!; })())
                : moveNotes(drag.base, ids, deltaTick, deltaPitch)
            : resizeNotes(drag.base, ids, drag.kind === 'resize-start' ? 'start' : 'end', { deltaTick, mode: event.shiftKey ? 'absolute' : 'relative' });
        useArrangementStore.getState().previewGesture(result.verbs);
    }

    function endDrag(pointerId: number) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== pointerId) return;
        audition(drag.primary.pitch, Math.min(48, drag.primary.vel ?? 96), 'off');
        if (drag.copyIds) {
            useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: drag.copyIds });
        }
        drag.cleanup();
        dragRef.current = null;
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        useArrangementStore.getState().commitGesture();
    }

    const cancelNoteDrag = () => {
        const drag = dragRef.current;
        if (!drag) return;
        audition(drag.primary.pitch, Math.min(48, drag.primary.vel ?? 96), 'off');
        drag.cleanup();
        dragRef.current = null;
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        useArrangementStore.getState().abortGesture();
    };

    /** One polite line, 1.6s, never focus-stealing. */
    const say = (message: string) => {
        setNotice(message);
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => { noticeTimer.current = null; setNotice(''); }, 1600);
    };

    /**
     * ERASE (U11) — click deletes the note under the pointer, drag deletes
     * everything the stroke sweeps.
     *
     * One `beginGesture` spans the whole stroke and the preview is recomputed
     * from the SAME base every move, so a sweep across nine notes is one preview
     * chain, one commit and one Ctrl+Z — the §1 law, not nine separate deletes
     * the player has to undo nine times. A stroke that touches nothing aborts
     * instead of committing, so a miss never lands an empty history entry.
     */
    const beginEraseStroke = (event: ReactPointerEvent, first?: ArrangementNote) => {
        const base = useArrangementStore.getState().arrangement;
        if (!base || eraseRef.current) return;
        const pointerId = event.pointerId;
        const store = useArrangementStore.getState();
        store.beginGesture('Erase notes', selectionSurface);
        eraseRef.current = { pointerId, base, ids: new Set<string>(), cleanup: () => undefined };
        eraseRef.current.cleanup = ownPointerGesture(pointerId, {
            move: (nativeEvent) => sweepErase(nativeEvent.clientX, nativeEvent.clientY),
            commit: () => finishEraseStroke(true),
            abort: () => finishEraseStroke(false),
        }, 'pianoroll');
        try { (event.currentTarget as HTMLElement).setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ }
        if (first?.id) addErased(first.id);
        else sweepErase(event.clientX, event.clientY);
    };

    function addErased(noteId: string) {
        const stroke = eraseRef.current;
        if (!stroke || stroke.ids.has(noteId)) return;
        stroke.ids.add(noteId);
        useArrangementStore.getState().previewGesture(eraseNotes(stroke.base, { noteIds: [...stroke.ids] }).verbs);
    }

    /*
     * Hit-testing by `elementFromPoint` rather than by tick/pitch arithmetic:
     * the notes are real DOM buttons, so the element under the pointer IS the
     * answer, at any zoom, in drum mode, and through the clipped geometry — and
     * a note already removed by the live preview is no longer there to be hit.
     */
    function sweepErase(clientX: number, clientY: number) {
        if (!eraseRef.current) return;
        const noteId = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-note-id]')?.dataset.noteId;
        if (noteId) addErased(noteId);
    }

    function finishEraseStroke(commit: boolean) {
        const stroke = eraseRef.current;
        if (!stroke) return;
        stroke.cleanup();
        eraseRef.current = null;
        const count = stroke.ids.size;
        if (!commit || !count) { useArrangementStore.getState().abortGesture(); return; }
        useArrangementStore.getState().commitGesture();
        useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: [] });
        say(count === 1 ? 'Note erased.' : `${count} notes erased.`);
    }

    const erase = (event: ReactPointerEvent, note: ArrangementNote) => {
        if (!note.id) return;
        // Right-click is the pointer's own erase and stays a single act; the tool
        // is what touch and pen have instead of a right button (spec §3.4).
        if (event.button === 2) {
            event.preventDefault();
            if (arrangement) useArrangementStore.getState().apply(eraseNotes(arrangement, { noteIds: [note.id] }).verbs, { surface: selectionSurface });
            say('Note erased.');
            return;
        }
        if (event.button !== 0 || tool !== 'erase') return;
        event.preventDefault();
        beginEraseStroke(event, note);
    };

    /**
     * KNIFE (U11) — one click cuts the note under the pointer in two, at the
     * snapped tick, through `splitNotes` (an `editNote` + an `addNote`, batched).
     *
     * The left half keeps the original id, so a selection survives the cut. A cut
     * that lands on the note's own start or end is not a cut and says so rather
     * than minting a zero-length note.
     */
    const knifeNote = (event: ReactPointerEvent, note: ArrangementNote) => {
        if (!note.id || !arrangement || !clip) return;
        event.preventDefault();
        event.stopPropagation();
        // Snap applies, and `Ctrl` suspends it — the same override every other
        // gesture on these surfaces already uses.
        const invert = event.ctrlKey || event.metaKey;
        const rawTick = xToTick(event.clientX);
        const toSource = (tick: number) => Math.round((clip.sourceStart ?? 0) + tick - clip.startTick);
        const sourceTick = toSource(snap(rawTick, invert));
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        /*
         * NO SLIVERS (F3). Both halves have to clear one snap unit — or a 1/32
         * note when snapping is suspended, which is the finest thing this editor
         * lets a hand ask for. Without it, `Ctrl` plus a press one pixel inside a
         * note's edge minted a 99-tick fragment: about a pixel wide, under the
         * draw floor, and impossible to grab back.
         */
        const minHalf = Math.max(1, Math.round(invert || !grid ? ppq / 8 : grid));
        const result = splitNotes(arrangement, [note.id], sourceTick, useArrangementStore.getState().mintId, minHalf);
        if (!result.verbs.length) {
            const raw = toSource(rawTick);
            const inside = (tick: number) => tick > note.tick && tick < note.tick + note.durTick;
            /*
             * Three different refusals, three different answers. A note exactly
             * one grid unit long can only be cut on its own edges, so "cut
             * inside the note" would be a lie — the player DID; the grid moved
             * it, and `Ctrl` is the way out. A cut that IS inside but too near an
             * end is refused for length, and says so.
             */
            say(inside(sourceTick) ? 'Too close to the edge to split.'
                : inside(raw) ? 'The grid moved that cut to the note edge — hold Ctrl to cut anywhere.'
                : 'Cut inside the note, not on its edge.');
            return;
        }
        useArrangementStore.getState().apply(result.verbs, { surface: selectionSurface });
        useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: result.selectedNoteIds ?? [] });
        say('Note split.');
    };

    const drawAt = (tick: number, pitch: number, duration = drawGrid) => {
        if (!arrangement || !midiSource || !clip) return;
        const absoluteTick = Math.max(clip.startTick, snap(tick));
        if (absoluteTick + duration > clip.startTick + clip.lengthTick) { setRejection('The note would extend beyond this clip.'); window.setTimeout(() => setRejection(''), 1200); return; }
        const sourceTick = Math.round((clip.sourceStart ?? 0) + absoluteTick - clip.startTick);
        // BC-30: an exact time+pitch duplicate is never minted. Refusing is right;
        // refusing SILENTLY was not — a deliberate gesture that produces nothing and
        // says nothing reads as a broken editor, and the branch immediately above
        // has always said why. Report without stealing focus: the same 1.2s
        // `role="status"` line, no dialog, no sound, nothing to dismiss.
        if (midiSource.notes.some((note) => note.tick === sourceTick && note.pitch === pitch)) { setRejection('That note is already there.'); window.setTimeout(() => setRejection(''), 1200); return; }
        const note: ArrangementNote = { tick: sourceTick, durTick: drumMode ? 1 : Math.max(1, Math.round(duration)), pitch, vel: drawVelocity };
        const result = drawNotes(arrangement, clip.id!, [note], useArrangementStore.getState().mintId, useEditingContextStore.getState().overlapPolicy);
        useArrangementStore.getState().apply(result.verbs, { surface: selectionSurface });
        const noteIds = result.selectedNoteIds ?? [];
        useEditingContextStore.getState().setSelection(selectionSurface, { noteIds });
        audition(pitch, Math.min(48, drawVelocity), 'on');
        window.setTimeout(() => audition(pitch, Math.min(48, drawVelocity), 'off'), 100);
    };

    const onFieldPointerMove = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
        const tick = snap(xToTick(event.clientX));
        const drawing = drawRef.current;
        if (drawing) {
            const floor = noteDragFloor(ppq);
            const end = snap(xToTick(event.clientX));
            setGhost({ tick: Math.min(drawing.tick, end), pitch: drawing.pitch, durTick: Math.max(floor, Math.abs(end - drawing.tick)) });
        } else setGhost({ tick, pitch: yToPitch(event.clientY), durTick: drawGrid });
        const mark = marqueeRef.current;
        if (mark) setMarquee({ x: Math.min(mark.x, mark.x + event.clientX - mark.clientX), y: Math.min(mark.y, mark.y + event.clientY - mark.clientY), width: Math.abs(event.clientX - mark.clientX), height: Math.abs(event.clientY - mark.clientY) });
    };

    const finishFieldDraw = (pointerId: number, clientX: number) => {
        const drawing = drawRef.current;
        if (!drawing || drawing.pointerId !== pointerId) return false;
        const end = snap(xToTick(clientX));
        const dragged = Math.abs(clientX - drawing.clientX) >= 3;
        const duration = dragged ? Math.max(noteDragFloor(ppq), Math.abs(end - drawing.tick)) : drawGrid;
        drawing.cleanup();
        drawRef.current = null;
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        drawAt(Math.min(drawing.tick, end), drawing.pitch, duration);
        return true;
    };

    const cancelFieldDraw = (pointerId: number) => {
        const drawing = drawRef.current;
        if (!drawing || drawing.pointerId !== pointerId) return;
        drawing.cleanup();
        drawRef.current = null;
        useEditingContextStore.getState().setSnapIndicatorTick(null);
        setGhost(null);
    };

    const finishMarquee = (pointerId: number, clientX: number, clientY: number) => {
        const mark = marqueeRef.current;
        if (!mark || mark.pointerId !== pointerId) return;
        const bounds = fieldRef.current?.getBoundingClientRect();
        const dx = clientX - mark.clientX;
        const dy = clientY - mark.clientY;
        let noteIds: string[] = [];
        if (bounds && Math.hypot(dx, dy) >= 4) {
            const left = bounds.left + Math.min(mark.x, mark.x + dx);
            const top = bounds.top + Math.min(mark.y, mark.y + dy);
            const right = left + Math.abs(dx);
            const bottom = top + Math.abs(dy);
            noteIds = [...fieldRef.current!.querySelectorAll<HTMLElement>('[data-note-id]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top; }).map((element) => element.dataset.noteId!);
        }
        mark.cleanup();
        useEditingContextStore.getState().setSelection(selectionSurface, { noteIds });
        marqueeRef.current = null;
        setMarquee(null);
    };

    const cancelMarquee = () => {
        marqueeRef.current?.cleanup();
        marqueeRef.current = null;
        setMarquee(null);
    };

    const onFieldPointerDown = (event: ReactPointerEvent) => {
        if (event.target !== event.currentTarget && (event.target as HTMLElement).closest('.piano-roll-note')) return;
        // An erase stroke may START on empty grid and sweep INTO notes — that is
        // how a player rubs a bar out. Beginning it here rather than only on a
        // note is what makes the gesture continuous.
        if (event.button === 0 && tool === 'erase') { beginEraseStroke(event); return; }
        if (event.button === 0 && (tool === 'draw' || event.ctrlKey || event.metaKey)) {
            const pointerId = event.pointerId;
            drawRef.current = { pointerId, clientX: event.clientX, tick: snap(xToTick(event.clientX)), pitch: yToPitch(event.clientY), cleanup: () => undefined };
            // Keep completion on the real pointer stream even when capture or a
            // React re-render retargets pointerup. This mirrors arrangement clip
            // gestures and is essential for pen/touch as well as automation.
            drawRef.current.cleanup = ownPointerGesture(pointerId, {
                move: onFieldPointerMove,
                commit: (nativeEvent) => { finishFieldDraw(nativeEvent.pointerId, nativeEvent.clientX); },
                abort: () => cancelFieldDraw(pointerId),
            }, 'pianoroll');
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ }
        }
        else if (event.button === 0) {
            const bounds = fieldRef.current?.getBoundingClientRect();
            if (bounds) {
                const pointerId = event.pointerId;
                marqueeRef.current = { pointerId, clientX: event.clientX, clientY: event.clientY, x: event.clientX - bounds.left, y: event.clientY - bounds.top, cleanup: () => undefined };
                marqueeRef.current.cleanup = ownPointerGesture(pointerId, {
                    move: onFieldPointerMove,
                    commit: (nativeEvent) => finishMarquee(nativeEvent.pointerId, nativeEvent.clientX, nativeEvent.clientY),
                    abort: cancelMarquee,
                }, 'pianoroll');
                try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ }
            }
        }
    };

    const onFieldPointerUp = (event: ReactPointerEvent) => {
        if (finishFieldDraw(event.pointerId, event.clientX)) return;
        finishMarquee(event.pointerId, event.clientX, event.clientY);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (!arrangement || !midiSource) return;
        const stepKeys: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11 };
        if (stepEntry.trackId === props.trackId && !event.ctrlKey && !event.metaKey) {
            if (event.repeat) return;
            if (event.key === ' ') {
                event.preventDefault();
                useEditingContextStore.getState().setStepEntry({ positionTick: stepEntry.positionTick + stepLength });
                return;
            }
            if (!selectedNoteIds.length && event.key === 'Backspace') {
                event.preventDefault();
                useEditingContextStore.getState().setStepEntry({ positionTick: Math.max(clip?.startTick ?? 0, stepEntry.positionTick - stepLength) });
                return;
            }
            const offset = stepKeys[event.key.toLowerCase()];
            if (offset !== undefined && clip) {
                event.preventDefault();
                if (stepEntry.positionTick + stepLength > clip.startTick + clip.lengthTick) { setRejection('The step cursor is at the end of this clip.'); window.setTimeout(() => setRejection(''), 1200); return; }
                const pitch = Math.max(0, Math.min(127, (stepEntry.octave + 1) * 12 + offset));
                const sourceTick = Math.round((clip.sourceStart ?? 0) + stepEntry.positionTick - clip.startTick);
                const result = drawNotes(arrangement, clip.id!, [{ tick: sourceTick, durTick: Math.max(1, Math.round(stepLength)), pitch, vel: stepEntry.velocity }], useArrangementStore.getState().mintId, useEditingContextStore.getState().overlapPolicy);
                useArrangementStore.getState().apply(result.verbs, { surface: selectionSurface });
                useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: result.selectedNoteIds ?? [] });
                useEditingContextStore.getState().setStepEntry({ positionTick: stepEntry.positionTick + stepLength, pitch });
                audition(pitch, Math.min(48, stepEntry.velocity), 'on');
                window.setTimeout(() => audition(pitch, Math.min(48, stepEntry.velocity), 'off'), 100);
                return;
            }
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            const noteIds = midiSource.notes.flatMap((note) => note.id ? [note.id] : []);
            useEditingContextStore.getState().setSelection(selectionSurface, { noteIds });
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            useEditingContextStore.getState().undoSelection(selectionSurface);
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            useEditingContextStore.getState().redoSelection(selectionSurface);
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection('pianoroll'); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelection('pianoroll'); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); paste({ surface: 'pianoroll' }); return; }
        if (!selectedNoteIds.length) return;
        const selected = midiSource.notes.filter((note) => note.id && selectedNoteIds.includes(note.id));
        let verbs: Verb[] | null = null;
        if (event.key === 'Delete' || event.key === 'Backspace') verbs = selected.map((note) => ({ kind: 'removeNote', noteId: note.id! }));
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            const result = copyNotes(arrangement, selectedNoteIds, grid ?? 1, 0, useArrangementStore.getState().mintId);
            useArrangementStore.getState().apply(result.verbs, { surface: selectionSurface });
            useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: result.selectedNoteIds ?? [] });
            return;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const amount = Math.max(1, Math.round((grid ?? 1) / (event.shiftKey ? 4 : 1)));
            verbs = moveNotes(arrangement, selectedNoteIds, (event.key === 'ArrowLeft' ? -1 : 1) * amount, 0).verbs;
        }
        else if ((event.ctrlKey || event.metaKey) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            const amount = (event.altKey ? 1 : 10) * (event.key === 'ArrowUp' ? 1 : -1);
            const request = event.shiftKey ? { mode: 'set' as const, amount: (selected[0]?.vel ?? 64) + amount, smush: true } : { mode: 'delta' as const, amount, smush: false };
            verbs = lowerVelocity(arrangement, selectedNoteIds, request).verbs;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            const amount = event.altKey ? 12 : 1;
            const delta = event.key === 'ArrowUp' ? amount : -amount;
            verbs = transposeNotes(arrangement, selectedNoteIds, delta).verbs;
        } else if (event.key === ',' || event.key === '.') {
            const delta = event.shiftKey ? -Math.max(1, Math.round((grid ?? 4) / 4)) : Math.max(1, Math.round(grid ?? 1));
            verbs = selected.map((note) => ({ kind: 'editNote', noteId: note.id!, patch: { durTick: Math.max(1, note.durTick + (event.key === '.' ? delta : -delta)) } }));
        } else if (event.key.toLowerCase() === 'q') {
            props.onQuantize?.(selectedNoteIds);
            event.preventDefault();
            return;
        } else return;
        event.preventDefault();
        if (verbs?.length) useArrangementStore.getState().apply(verbs, { surface: selectionSurface });
    };
    const keyDownRef = useRef(onKeyDown);
    keyDownRef.current = onKeyDown;

    // The arbiter owns surface keyboard dispatch. Canonical events keep the
    // existing edit implementation independent from the user's rebound key.
    const pianoRollBindings = useMemo(() => {
        const canonical: Record<string, KeyboardEventInit> = {
            'pianoroll.selectAll': { key: 'a', ctrlKey: true },
            'pianoroll.selectionUndo': { key: 'z', ctrlKey: true, altKey: true },
            'pianoroll.selectionRedo': { key: 'y', ctrlKey: true, altKey: true },
            'pianoroll.cut': { key: 'x', ctrlKey: true },
            'pianoroll.copy': { key: 'c', ctrlKey: true },
            'pianoroll.paste': { key: 'v', ctrlKey: true },
            'pianoroll.delete': { key: 'Delete' },
            'pianoroll.deleteBackspace': { key: 'Backspace' },
            'pianoroll.duplicate': { key: 'd', ctrlKey: true },
            'pianoroll.nudgeLeft': { key: 'ArrowLeft' },
            'pianoroll.nudgeRight': { key: 'ArrowRight' },
            'pianoroll.nudgeLeftFine': { key: 'ArrowLeft', shiftKey: true },
            'pianoroll.nudgeRightFine': { key: 'ArrowRight', shiftKey: true },
            'pianoroll.transposeUp': { key: 'ArrowUp' },
            'pianoroll.transposeDown': { key: 'ArrowDown' },
            'pianoroll.transposeOctaveUp': { key: 'ArrowUp', altKey: true },
            'pianoroll.transposeOctaveDown': { key: 'ArrowDown', altKey: true },
            'pianoroll.velocityUp': { key: 'ArrowUp', ctrlKey: true },
            'pianoroll.velocityDown': { key: 'ArrowDown', ctrlKey: true },
            'pianoroll.resizeShorter': { key: ',' },
            'pianoroll.resizeLonger': { key: '.' },
            'pianoroll.quantize': { key: 'q', ctrlKey: true },
        };
        return {
            id: `pianoroll:${clipId}`,
            scope: 'surface' as const,
            surface: 'pianoroll' as const,
            entries: [
                ...['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j'].map((key) => ({ actionId: `pianoroll.step.${key}`, defaultBinding: { key }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId === trackId, run: (event: KeyboardEvent) => { keyDownRef.current(event as unknown as React.KeyboardEvent); return true; } })),
                { actionId: 'pianoroll.step.advance', defaultBinding: { key: ' ' }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId === trackId, run: (event: KeyboardEvent) => { keyDownRef.current(event as unknown as React.KeyboardEvent); return true; } },
                { actionId: 'pianoroll.step.retreat', defaultBinding: { key: 'Backspace' }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId === trackId && useEditingContextStore.getState().viewports[selectionSurface].selection.noteIds.length === 0, run: (event: KeyboardEvent) => { keyDownRef.current(event as unknown as React.KeyboardEvent); return true; } },
                ...([['pianoroll.step.octaveDown', 'z', -1, false], ['pianoroll.step.octaveUp', 'z', 1, true]] as const).map(([actionId, key, direction, shift]) => ({ actionId, defaultBinding: { key, shift }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId === trackId, run: () => { const current = useEditingContextStore.getState().stepEntry.octave; useEditingContextStore.getState().setStepEntry({ octave: Math.max(-1, Math.min(9, current + direction)) }); return true; } })),
                { actionId: 'pianoroll.transport', defaultBinding: { key: ' ' }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId !== trackId, run: () => { const store = useArrangementStore.getState(); if (store.isPlaying || stopReturnsToOrigin(store)) store.stop(); else store.play(); return true; } },
                { actionId: 'pianoroll.undo', defaultBinding: { key: 'z', ctrl: true }, run: (): boolean => { useHistoryStore.getState().undo(); return true; } },
                { actionId: 'pianoroll.redo', defaultBinding: { key: 'z', ctrl: true, shift: true }, run: (): boolean => { useHistoryStore.getState().redo(); return true; } },
                // TL-18 / spec §4: one level of the Escape and Q grammar per press. When this
                // roll has nothing left to close, the entry returns false so the enclosing
                // arrangement's inheritable `escape` / `exit` still runs. Returning true with
                // no handler attached is what made Q and Escape dead inside an inline roll.
                { actionId: 'pianoroll.escape', defaultBinding: { key: 'Escape' }, run: () => { const context = useEditingContextStore.getState(); const selection = context.viewports[selectionSurface].selection; if (selection.noteIds.length || selection.clipIds.length || selection.timeRange) { context.clearSelection(selectionSurface); return true; } if (!onClose) return false; onClose(); return true; } },
                { actionId: 'pianoroll.exit', defaultBinding: { key: 'q' }, run: () => { if (!onClose) return false; onClose(); return true; } },
                { actionId: 'pianoroll.tool.step', defaultBinding: { key: 't' }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId !== trackId, run: () => { useEditingContextStore.getState().setStepEntry({ trackId, positionTick: clip?.startTick ?? 0 }); return true; } },
                /*
                  * ONE TOOL PER VIEWPORT, WRITTEN WHERE IT IS READ (F2).
                  *
                  * These entries used to write `setViewport('pianoroll', …)`
                  * unconditionally while the INLINE roll reads
                  * `viewports.arrangement.tool` — so inside a lane every tool
                  * key was dead: `X` armed a tool nothing could see and `V`
                  * could not disarm the Erase the strip had armed. That is
                  * HA-13's "a key that does nothing", one level down, on the
                  * surface a first-run player meets first. The toolbar's own
                  * `onClick` had always picked the right viewport; the keys now
                  * pick the same one.
                  */
                ...([['select', 'v'], ['draw', 'b'], ['erase', 'x'], ['knife', 'k']] as const).map(([nextTool, key]) => ({ actionId: `pianoroll.tool.${nextTool}`, defaultBinding: { key }, guard: (event: KeyboardEvent) => !event.repeat && useEditingContextStore.getState().stepEntry.trackId !== trackId, run: () => { useEditingContextStore.getState().setViewport(mode === 'surface' ? 'pianoroll' : 'arrangement', { tool: nextTool }); return true; } })),
                ...Object.entries(canonical).map(([actionId, init]) => ({ actionId, defaultBinding: { key: init.key!, ctrl: init.ctrlKey, alt: init.altKey, shift: init.shiftKey }, guard: (event: KeyboardEvent) => !event.repeat, run: () => { keyDownRef.current(new KeyboardEvent('keydown', init) as unknown as React.KeyboardEvent); return true; } })),
            ],
        };
    }, [clip?.startTick, clipId, mode, onClose, selectionSurface, trackId]);
    useBindingSet(pianoRollBindings);

    const currentNotes = midiSource?.notes ?? [];
    /*
     * The notes that actually reach the DOM: a note outside the visible pitch
     * range or clipped away entirely renders `null`, so the roving target has to
     * be chosen from THIS list or the one tabbable note could be one that is not
     * on screen — a tab stop into nothing.
     */
    const renderedNotes = currentNotes.filter((note) => {
        if (note.pitch < range.lo || note.pitch > range.hi) return false;
        return clippedNoteGeometry(note, clip?.startTick ?? 0, clip?.sourceStart ?? 0, clip?.lengthTick ?? 0, pxPerTick) !== null;
    });
    /*
     * Exactly one tabbable note, chosen in the order a player would expect to
     * find it: wherever the roving focus was last left, else the first note they
     * have selected (that is the one they are working on), else the first note in
     * the clip. Each candidate is checked against `renderedNotes`, so a note that
     * scrolls out of pitch range hands the tab stop on instead of taking it away.
     */
    const focusableNoteId = (() => {
        const has = (id: string | null | undefined) => !!id && renderedNotes.some((note) => note.id === id);
        if (has(rovingNoteId)) return rovingNoteId;
        const selected = selectedNoteIds.find(has);
        if (selected) return selected;
        return renderedNotes.find((note) => !!note.id)?.id ?? null;
    })();
    /** Put focus on a note, or on that note's velocity handle. */
    const focusRow = (noteId: string, row: 'note' | 'velocity') => {
        const selector = row === 'note'
            ? `button[data-note-id="${CSS.escape(noteId)}"]`
            : `[data-lollipop-note-id="${CSS.escape(noteId)}"]`;
        requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(selector)?.focus());
    };
    /**
     * Move the roving focus by `delta` notes in render order, and take focus with
     * it — on whichever ROW the player is already on. Walking the velocity lane
     * must not throw the player back up to the note grid; it is the same roving
     * index seen from one row down.
     */
    const moveRovingFocus = (delta: number, row: 'note' | 'velocity' = 'note') => {
        if (!renderedNotes.length) return;
        const at = renderedNotes.findIndex((note) => note.id === focusableNoteId);
        const next = renderedNotes[Math.max(0, Math.min(renderedNotes.length - 1, (at < 0 ? 0 : at) + delta))];
        if (!next?.id || next.id === focusableNoteId) return;
        setRovingNoteId(next.id);
        // Focus follows the roving index — that IS the pattern; a tabindex that
        // moves without the focus moving is just a different note being unreachable.
        focusRow(next.id, row);
    };
    const otherClipNotes = track?.clips.flatMap((other) => {
        if (other.id === clip?.id) return [];
        const otherSource = arrangement?.sources?.[other.sourceId];
        if (otherSource?.kind !== 'midi') return [];
        return otherSource.notes.map((note) => ({ note, clip: other }));
    }) ?? [];

    if (!arrangement || !track || !clip || !midiSource) return null;

    /*
     * THE ROLL'S OWN ZOOM CONTROL (HA-18).
     *
     * `Ctrl+wheel` was the only way to widen a note and it was advertised
     * nowhere — a capability with no affordance is a capability the player does
     * not have. Two 24px buttons, and the shortcut named in the `title` so the
     * hand can graduate from the button to the wheel. It sits on the roll's own
     * strip on both heights: in the toolbar on the full surface, and in the
     * inline lane's corner strip, because the inline lane has no toolbar (its
     * chrome is the track's lane menu) and a zoom that lives on the SONG's
     * chrome would be the very confusion HA-22 is about.
     */
    const zoomControl = (
        <div className="piano-roll__zoom" role="group" aria-label="Zoom the piano roll">
            <button type="button" aria-label="Zoom the piano roll out" title="Zoom out — Ctrl+wheel" onClick={() => zoomBy(1 / 1.5)}>−</button>
            <button type="button" aria-label="Zoom the piano roll in" title="Zoom in — Ctrl+wheel" onClick={() => zoomBy(1.5)}>+</button>
        </div>
    );

    return (
        <section
            ref={rootRef}
            className={`piano-roll piano-roll--${mode}${drumMode ? ' is-drums' : ''}${isPlaying ? ' is-rolling' : ''}`}
            style={{ '--piano-roll-height': `${height}px`, '--piano-roll-key-width': `${mode === 'surface' ? SURFACE_KEY_WIDTH : drumMode ? 64 : KEY_COLUMN_WIDTH}px`, '--piano-roll-scroomer-width': `${SCROOMER_WIDTH}px` } as CSSProperties}
            aria-label={`${track.name ?? 'MIDI track'} piano roll, ${currentNotes.length} notes${drumMode ? ', drum mode' : ''}`}
            tabIndex={0}
            data-keymap-surface="pianoroll"
            data-keymap-set-id={`pianoroll:${props.clipId}`}
            onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('.piano-roll-note')) props.onOpenSurface?.();
                else drawAt(xToTick(event.clientX), yToPitch(event.clientY));
            }}
        >
            {/*
             * The toolbar carries only what a hand reaches for mid-take: the
             * five tools, the grid, quantize, and the drum-row override. The
             * three quantize NUMBER fields live behind `⋯` — they are set once a
             * session, and permanent chrome should cost nothing to ignore.
             */}
            {/*
              * HA-22: the toolbar is the SURFACE's strip, and it is not rendered
              * at all in a lane. It used to be rendered and then hidden with
              * `display: none`, which meant an inline roll shipped a second,
              * invisible `V B X` tool group in the DOM beside the Song's — one
              * of the two identical strips the audit found. The lane's chrome is
              * the track's own lane menu plus the zoom strip below.
              */}
            {mode === 'surface' && <header className="piano-roll__toolbar">
                <span className="piano-roll__title">{clip.name ?? midiSource.name}</span>
                {/*
                  * HA-22: the strip says WHICH surface it governs. Two `V B X`
                  * triples reading "Tool" is how the player came to believe the
                  * Song's strip and the roll's strip were the same control.
                  */}
                <div className="piano-roll__tools" role="group" aria-label="Tool — piano roll">
                    {ROLL_TOOLS.map(([id, glyph, label]) => (
                        <button
                            key={id}
                            type="button"
                            aria-label={label}
                            aria-pressed={id === 'step' ? stepEntry.trackId === props.trackId : stepEntry.trackId !== props.trackId && tool === id}
                            onClick={() => {
                                const context = useEditingContextStore.getState();
                                if (id === 'step') { context.setStepEntry({ trackId: stepEntry.trackId === props.trackId ? null : props.trackId, positionTick: clip.startTick }); return; }
                                if (stepEntry.trackId === props.trackId) context.setStepEntry({ trackId: null });
                                context.setViewport(mode === 'surface' ? 'pianoroll' : 'arrangement', { tool: id });
                            }}
                        >{glyph}</button>
                    ))}
                </div>
                <button type="button" className="piano-roll__grid-chip" aria-label={`Quantize grid: ${quantizeGrid}`} title="Quantize grid" onClick={() => {
                    const index = QUANTIZE_GRIDS.indexOf(quantizeGrid);
                    useEditingContextStore.getState().setQuantize({ quantizeGrid: QUANTIZE_GRIDS[(index + 1) % QUANTIZE_GRIDS.length]! });
                }}>Q {quantizeGrid}</button>
                {zoomControl}
                <button type="button" className="piano-roll__tool" disabled={!selectedNoteIds.length} title="Quantize the selection (Ctrl+Q)" onClick={() => { if (selectedNoteIds.length) props.onQuantize?.(selectedNoteIds); }}>Quantize</button>
                <button type="button" className="piano-roll__tool" aria-pressed={drumMode} onClick={() => (props.onDrumModeChange ?? setLocalDrumMode)(!drumMode)}>Drums</button>
                <span className="piano-roll__more">
                    <button type="button" className="piano-roll__close" aria-label="Quantize options" aria-expanded={quantizeOpen} onClick={() => setQuantizeOpen((open) => !open)}>⋯</button>
                    {quantizeOpen && <div className="piano-roll__popover" role="group" aria-label="Quantize options">
                        <label className="piano-roll__quantize-field">Grid<select aria-label="Quantize grid" value={quantizeGrid} onChange={(event) => useEditingContextStore.getState().setQuantize({ quantizeGrid: event.target.value as typeof quantizeGrid })}><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option><option value="1/8t">1/8T</option></select></label>
                        <label className="piano-roll__quantize-field">Strength<input aria-label="Quantize strength" type="number" min="0" max="100" value={quantizeStrength} onChange={(event) => useEditingContextStore.getState().setQuantize({ quantizeStrength: Number(event.target.value) })} /></label>
                        <label className="piano-roll__quantize-field">Swing<input aria-label="Quantize swing" type="number" min="-150" max="150" value={quantizeSwing} onChange={(event) => useEditingContextStore.getState().setQuantize({ quantizeSwing: Number(event.target.value) })} /></label>
                    </div>}
                </span>
                <span className="piano-roll__mode-note" aria-live="polite">{drumMode ? 'Drum rows auto-detected' : 'Pitched notes'}</span>
                {props.onClose && <button type="button" className="piano-roll__close" aria-label="Close piano roll" onClick={props.onClose}>⌃</button>}
            </header>}
            {rejection && <span className="piano-roll__rejection" role="status">{rejection}</span>}
            {notice && <span className="piano-roll__notice" role="status">{notice}</span>}
            {mode === 'inline' && <div className="piano-roll__inline-strip">{zoomControl}</div>}
            {/*
              * THE LANE'S OWN BAR STRIP (F1). It measures the lane's axis, in
              * the micro mono voice, inside the lane — so the Song's ruler above
              * is never asked to describe a viewport it does not own.
              */}
            {mode === 'inline' && <div className="piano-roll__lane-ruler" aria-hidden="true" style={{ height: LANE_RULER_HEIGHT }}>
                <div className="piano-roll__lane-ruler-track" style={{ width: contentWidth, transform: `translateX(${-laneScrollLeftPx}px)` }}>
                    {laneBars.map((bar) => <i key={bar} style={{ left: bar * ticksPerBar * pxPerTick }}>{bar + 1}</i>)}
                </div>
            </div>}
            <div className="piano-roll__body">
                <PitchScroomer trackId={props.trackId} range={range} pitchesWithNotes={new Set(allTrackNotes.map((note) => note.pitch))} />
                <div className="piano-roll__keys" role="list" aria-label="Pitch rows" style={{ height: contentHeight }}>
                    {pitches.map((pitch) => <div key={pitch} role="listitem" aria-label={drumMode ? (GM_DRUM_NAMES[pitch] ?? pitchName(pitch)) : pitchName(pitch)} className={`piano-roll__key${isBlackPitch(pitch) ? ' is-black' : ''}${isKeyboardSeam(pitch) ? ' is-seam' : ''}`} style={{ height: rowHeight }} onPointerDown={(event) => { if (event.button !== 0) return; audition(pitch, 48, 'on'); const pointerId = event.pointerId; keyBedDrag.current = { pointerId, y: event.clientY, range, cleanup: () => undefined }; keyBedDrag.current.cleanup = ownPointerGesture(pointerId, { move: (move) => { const current = keyBedDrag.current; if (!current) return; const delta = Math.round((current.y - move.clientY) / Math.max(1, rowHeight)); const span = current.range.hi - current.range.lo; const lo = Math.max(0, Math.min(127 - span, current.range.lo + delta)); rememberPitchRange(props.trackId, { lo, hi: lo + span }); }, commit: () => { audition(pitch, 48, 'off'); keyBedDrag.current?.cleanup(); keyBedDrag.current = null; }, abort: () => { audition(pitch, 48, 'off'); rememberPitchRange(props.trackId, range); keyBedDrag.current?.cleanup(); keyBedDrag.current = null; } }, 'pianoroll'); try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ } }}>{drumMode ? (GM_DRUM_NAMES[pitch] ?? pitchName(pitch)) : pitch % 12 === 0 && rowHeight >= 7 ? pitchName(pitch) : ''}</div>)}
                </div>
                <div ref={fieldRef} className="piano-roll__field" onScroll={mode === 'inline' ? (event) => setLaneScrollLeftPx(event.currentTarget.scrollLeft) : undefined} onPointerMove={onFieldPointerMove} onPointerLeave={() => { if (!drawRef.current) setGhost(null); }} onPointerDown={onFieldPointerDown} onPointerUp={onFieldPointerUp} onPointerCancel={(event) => { cancelFieldDraw(event.pointerId); cancelMarquee(); setGhost(null); }}>
                    <div className="piano-roll__content" style={{ width: contentWidth, height: contentHeight, transform: `translateX(${-contentOriginTick * pxPerTick}px)` }}>
                        <TimeGrid width={contentWidth} height={contentHeight} pxPerTick={pxPerTick} ticksPerBar={ticksPerBar} beatsPerBar={beatsPerBar} gridUnit={gridUnit} />
                        {pitches.map((pitch, index) => <div key={pitch} className={`piano-roll__row${isBlackPitch(pitch) ? ' is-black' : ''}${pitch % 12 === 0 ? ' is-c' : ''}`} style={{ top: index * rowHeight, height: rowHeight }} />)}
                        {otherClipNotes.map(({ note, clip: other }, index) => {
                            const geometry = clippedNoteGeometry(note, other.startTick, other.sourceStart ?? 0, other.lengthTick, pxPerTick);
                            if (!geometry || note.pitch < range.lo || note.pitch > range.hi) return null;
                            return <span key={`${other.id}-${note.id ?? index}`} className="piano-roll-note piano-roll-note--elsewhere" style={{ left: geometry.left, top: (range.hi - note.pitch) * rowHeight + Math.max(1, (rowHeight - 5) / 2), width: drumMode ? 10 : geometry.width, height: drumMode ? 10 : Math.max(3, rowHeight - 2) }} />;
                        })}
                        {currentNotes.map((note, index) => {
                            const geometry = clippedNoteGeometry(note, clip.startTick, clip.sourceStart ?? 0, clip.lengthTick, pxPerTick);
                            if (!geometry || note.pitch < range.lo || note.pitch > range.hi) return null;
                            const selected = !!note.id && noteIdSet.has(note.id);
                            return <button key={note.id ?? index} type="button" data-note-id={note.id} className={`piano-roll-note${selected ? ' is-selected' : ''}${drumMode ? ' is-drum' : ''}`} style={{ left: geometry.left, top: (range.hi - note.pitch) * rowHeight + Math.max(1, (rowHeight - (drumMode ? 10 : Math.max(3, rowHeight - 2))) / 2), width: drumMode ? 10 : geometry.width, height: drumMode ? 10 : Math.max(3, rowHeight - 2), '--note-opacity': `${velocityOpacity(note.vel) * 100}%` } as CSSProperties} aria-label={`${pitchName(note.pitch)}, tick ${note.tick}, duration ${note.durTick}, velocity ${note.vel ?? 96}`} aria-pressed={selected} tabIndex={note.id && note.id === focusableNoteId ? 0 : -1} onFocus={() => { if (note.id) setRovingNoteId(note.id); }} onKeyDown={(event) => {
                                /*
                                 * Arrows move the roving focus ONLY when nothing is
                                 * selected. That is not a new rule — it is exactly the
                                 * guard the surface handler already uses (`if
                                 * (!selectedNoteIds.length) return`), so the two are
                                 * complementary: with a selection the arrows nudge,
                                 * transpose and set velocity as they always did, and
                                 * with none they walk the notes. Neither shadows the
                                 * other and the edit grammar is untouched.
                                 */
                                /*
                                 * Shift+ArrowDown drops onto THIS note's velocity
                                 * handle; Shift+ArrowUp on the handle comes back.
                                 * It is navigation, not an edit, so it runs whether
                                 * or not there is a selection — and it stops
                                 * propagating so the surface's raw arrow handler
                                 * (which does not test Shift) cannot also transpose.
                                 * No entry in `pianoRollBindings` pairs Shift with a
                                 * vertical arrow, so nothing is shadowed.
                                 */
                                if (event.shiftKey && event.key === 'ArrowDown' && note.id) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setRovingNoteId(note.id);
                                    focusRow(note.id, 'velocity');
                                    return;
                                }
                                if (selectedNoteIds.length) return;
                                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveRovingFocus(1); }
                                else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveRovingFocus(-1); }
                                else if (event.key === 'Home') { event.preventDefault(); moveRovingFocus(-renderedNotes.length); }
                                else if (event.key === 'End') { event.preventDefault(); moveRovingFocus(renderedNotes.length); }
                            }} onPointerDown={(event) => { if (event.button === 0 && tool === 'knife') { knifeNote(event, note); return; } erase(event, note); if (event.button === 0 && tool !== 'erase') startNoteDrag(event, note, geometry.width); }} onPointerMove={moveNoteDrag} onPointerUp={(event) => endDrag(event.pointerId)} onPointerCancel={cancelNoteDrag} onContextMenu={(event) => event.preventDefault()} />;
                        })}
                        {ghost && <span className={`piano-roll-note piano-roll-note--draw${drumMode ? ' is-drum' : ''}`} style={{ left: ghost.tick * pxPerTick, top: (range.hi - ghost.pitch) * rowHeight + Math.max(1, (rowHeight - (drumMode ? 10 : Math.max(3, rowHeight - 2))) / 2), width: drumMode ? 10 : Math.max(2, ghost.durTick * pxPerTick), height: drumMode ? 10 : Math.max(3, rowHeight - 2) }} />}
                        {stepEntry.trackId === props.trackId && <span className="piano-roll__step-cursor" style={{ left: stepEntry.positionTick * pxPerTick, top: (range.hi - stepEntry.pitch) * rowHeight, width: Math.max(2, stepLength * pxPerTick), height: rowHeight }} />}
                        {marquee && <span className="piano-roll__marquee" style={marquee} />}
                        {!currentNotes.length && <p className="piano-roll__empty">press B, then draw.</p>}
                        <Playhead pxPerTick={pxPerTick} onTick={followLaneRef} />
                    </div>
                </div>
            </div>
            <VelocityLane notes={currentNotes} clip={clip} pxPerTick={pxPerTick} leftTick={viewLeftTick} selectedIds={noteIdSet} onSelect={(id) => { useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: [id] }); }} onRove={(delta) => moveRovingFocus(delta, 'velocity')} onBackToNote={(id) => { setRovingNoteId(id); focusRow(id, 'note'); }} />
        </section>
    );
}

function TimeGrid({ width, height, pxPerTick, ticksPerBar, beatsPerBar, gridUnit }: { width: number; height: number; pxPerTick: number; ticksPerBar: number; beatsPerBar: number; gridUnit: ReturnType<typeof useEditingContextStore.getState>['gridUnit'] }) {
    const marks: { tick: number; kind: 'bar' | 'beat' | 'sub' }[] = [];
    const ladder = getGridLadder(pxPerTick * ticksPerBar, beatsPerBar, gridUnit);
    const divisions = gridUnit === '1/8t' ? 12 : gridUnit === '1/16' || gridUnit === 'adaptive' ? 16 : gridUnit === '1/8' ? 8 : 4;
    /*
     * Every mark is clamped to the content box. The loop only tested the BAR's
     * own left edge, so the last bar's beats and subdivisions were drawn up to a
     * full bar past `width` — invisible while the field was `overflow: hidden`,
     * and 181px of empty ruled space to scroll into the moment the lane got its
     * own scroller (F1). A grid that draws past the end of the song is the same
     * kind of lie as a ruler that measures the wrong axis.
     */
    const within = (tick: number) => tick * pxPerTick <= width;
    for (let bar = 0; within(bar * ticksPerBar); bar++) {
        const start = bar * ticksPerBar;
        if (bar % ladder.barStride === 0) marks.push({ tick: start, kind: 'bar' });
        if (ladder.drawBeats) for (let beat = 1; beat < beatsPerBar; beat++) {
            const tick = start + beat * ticksPerBar / beatsPerBar;
            if (within(tick)) marks.push({ tick, kind: 'beat' });
        }
        if (ladder.drawSubdivisions) for (let sub = 1; sub < divisions; sub++) {
            const tick = start + sub * ticksPerBar / divisions;
            if (sub % (divisions / beatsPerBar) !== 0 && within(tick)) marks.push({ tick, kind: 'sub' });
        }
    }
    return <div className="piano-roll__time-grid" aria-hidden="true" style={{ height }}>{marks.map((mark) => <i key={mark.tick} className={`is-${mark.kind}`} style={{ left: mark.tick * pxPerTick }} />)}</div>;
}

function Playhead({ pxPerTick, onTick }: { pxPerTick: number; onTick?: RefObject<(tick: number) => void> }) {
    const ref = useRef<HTMLSpanElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    useEffect(() => {
        // `onTick` arrives as a REF so the subscription's identity does not
        // change when the parent re-renders: the gate in `PianoRoll.test.tsx`
        // is that this roll holds exactly one shared-frame writer, and a
        // callback in the dep array would re-register it on every keystroke.
        const write = () => {
            const tick = useArrangementStore.getState().currentTick();
            if (ref.current) ref.current.style.transform = `translateX(${tick * pxPerTick}px)`;
            onTick?.current?.(tick);
        };
        write();
        if (isPlaying) return registerTimelineFrameWriter(write);
        return useArrangementStore.subscribe((state, previous) => { if (state.playheadTick !== previous.playheadTick) write(); });
        // `onTick` is a ref object: stable for the component's life, so naming it
        // here costs nothing and keeps the dependency list honest.
    }, [isPlaying, onTick, pxPerTick]);
    return <span ref={ref} className="piano-roll__playhead" aria-hidden="true" />;
}

function PitchScroomer({ trackId, range, pitchesWithNotes }: { trackId: string; range: PitchRange; pitchesWithNotes: Set<number> }) {
    const remember = useTrackLaneViewStore((state) => state.rememberPitchRange);
    const start = useRef<{ pointerId: number; y: number; range: PitchRange; height: number; cleanup: () => void } | null>(null);
    const top = (127 - range.hi) / 128 * 100;
    const height = (range.hi - range.lo + 1) / 128 * 100;
    return <div className="piano-roll__scroomer" aria-label={`Pitch range ${pitchName(range.lo)} to ${pitchName(range.hi)}`} role="slider" aria-valuemin={0} aria-valuemax={127} aria-valuenow={range.hi} tabIndex={0} onPointerDown={(event) => { if (event.button !== 0) return; const pointerId = event.pointerId; const move = (nativeEvent: Pick<PointerEvent, 'clientY'>) => { const current = start.current; if (!current) return; const delta = Math.round((current.y - nativeEvent.clientY) / Math.max(1, current.height) * 128); const span = current.range.hi - current.range.lo; const lo = Math.max(0, Math.min(127 - span, current.range.lo + delta)); remember(trackId, { lo, hi: lo + span }); }; start.current = { pointerId, y: event.clientY, range, height: event.currentTarget.clientHeight, cleanup: () => undefined }; start.current.cleanup = ownPointerGesture(pointerId, { move, commit: () => { start.current?.cleanup(); start.current = null; }, abort: () => { remember(trackId, range); start.current?.cleanup(); start.current = null; } }, 'pianoroll'); try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ } }}>
        {[...pitchesWithNotes].map((pitch) => <i key={pitch} style={{ top: `${(127 - pitch) / 128 * 100}%` }} />)}
        <span className="piano-roll__scroomer-window" style={{ top: `${top}%`, height: `${height}%` }}><b /><b /></span>
    </div>;
}

/**
 * The velocity lane — one lollipop per note.
 *
 * ROVING TABINDEX, continued. Fixing the note grid alone left an identical trap
 * one row down: every lollipop was a tab stop, so the roll still held 139 of them
 * and forty consecutive `Tab` presses never escaped. The lane is not a second tab
 * stop and it does not get its own roving index — it is the SAME index seen from
 * one row down. Every lollipop is `-1`; the player reaches the focused note's
 * handle with `Shift+ArrowDown` and comes back with `Shift+ArrowUp` or `Escape`.
 * Arrows then walk the lane, staying in the lane.
 */
function VelocityLane({ notes, clip, pxPerTick, leftTick, selectedIds, onSelect, onRove, onBackToNote }: { notes: readonly ArrangementNote[]; clip: ArrangementClip; pxPerTick: number; leftTick: number; selectedIds: Set<string>; onSelect: (id: string) => void; onRove: (delta: number) => void; onBackToNote: (noteId: string) => void }) {
    const laneRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointerId: number; noteId?: string; base: Arrangement; startX: number; startVelocity: number; ramp: boolean; cleanup: () => void } | null>(null);
    const previewVelocity = (event: Pick<PointerEvent, 'clientY'>, note: ArrangementNote) => {
        if (!note.id || !laneRef.current) return;
        const bounds = laneRef.current.getBoundingClientRect();
        const vel = Math.max(0, Math.min(127, Math.round((bounds.bottom - event.clientY) / bounds.height * 127)));
        const base = drag.current?.base;
        if (base) useArrangementStore.getState().previewGesture(lowerVelocity(base, [note.id], { mode: 'set', amount: vel }).verbs);
    };
    const previewPaint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => {
        const current = drag.current;
        const lane = laneRef.current;
        if (!current || !lane) return;
        const bounds = lane.getBoundingClientRect();
        const from = Math.min(current.startX, event.clientX);
        const to = Math.max(current.startX, event.clientX);
        const crossed = notes.filter((note) => {
            const x = bounds.left + (clip.startTick + note.tick - (clip.sourceStart ?? 0) - leftTick) * pxPerTick;
            return note.id && x >= from && x <= to;
        }).flatMap((note) => note.id ? [note.id] : []);
        if (!crossed.length) return;
        const velocity = Math.max(0, Math.min(127, Math.round((bounds.bottom - event.clientY) / bounds.height * 127)));
        const request = current.ramp ? { mode: 'ramp' as const, from: current.startVelocity, to: velocity } : { mode: 'set' as const, amount: velocity };
        useArrangementStore.getState().previewGesture(lowerVelocity(current.base, crossed, request).verbs);
    };
    const finish = (pointerId: number, commit: boolean) => {
        const current = drag.current;
        if (!current || current.pointerId !== pointerId) return;
        current.cleanup();
        drag.current = null;
        if (commit) useArrangementStore.getState().commitGesture();
        else useArrangementStore.getState().abortGesture();
    };
    useEffect(() => () => {
        const current = drag.current;
        if (!current) return;
        current.cleanup();
        drag.current = null;
        useArrangementStore.getState().abortGesture();
    }, []);
    return <div ref={laneRef} className="piano-roll__velocity" aria-label="Velocity lane" onPointerDown={(event) => { if (event.button !== 0 || event.target !== event.currentTarget) return; const base = useArrangementStore.getState().arrangement; if (!base) return; const bounds = event.currentTarget.getBoundingClientRect(); const pointerId = event.pointerId; drag.current = { pointerId, base, startX: event.clientX, startVelocity: Math.max(0, Math.min(127, Math.round((bounds.bottom - event.clientY) / bounds.height * 127))), ramp: event.altKey, cleanup: () => undefined }; drag.current.cleanup = ownPointerGesture(pointerId, { move: previewPaint, commit: () => finish(pointerId, true), abort: () => finish(pointerId, false) }, 'pianoroll'); useArrangementStore.getState().beginGesture(event.altKey ? 'Ramp note velocity' : 'Paint note velocity'); previewPaint(event); try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ } }}>
        <i className="is-guide is-96" /><i className="is-guide is-64" /><i className="is-guide is-32" />
        {notes.map((note) => note.id && <button key={note.id} type="button" tabIndex={-1} data-lollipop-note-id={note.id} onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.shiftKey && event.key === 'ArrowUp')) { event.preventDefault(); event.stopPropagation(); onBackToNote(note.id!); return; }
            if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onRove(1); }
            else if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); onRove(-1); }
        }} className={`piano-roll__lollipop${selectedIds.has(note.id) ? ' is-selected' : ''}`} style={{ left: (clip.startTick + note.tick - (clip.sourceStart ?? 0) - leftTick) * pxPerTick, height: `${(note.vel ?? 96) / 127 * 100}%` }} aria-label={`${pitchName(note.pitch)} velocity ${note.vel ?? 96}`} onPointerDown={(event) => { const base = useArrangementStore.getState().arrangement; if (!base) return; onSelect(note.id!); const pointerId = event.pointerId; drag.current = { pointerId, noteId: note.id!, base, startX: event.clientX, startVelocity: note.vel ?? 96, ramp: false, cleanup: () => undefined }; drag.current.cleanup = ownPointerGesture(pointerId, { move: (nativeEvent) => previewVelocity(nativeEvent, note), commit: () => finish(pointerId, true), abort: () => finish(pointerId, false) }, 'pianoroll'); try { event.currentTarget.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ } useArrangementStore.getState().beginGesture('Set note velocity'); previewVelocity(event, note); }} onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) previewVelocity(event, note); }} onPointerUp={(event) => finish(event.pointerId, true)} onPointerCancel={(event) => finish(event.pointerId, false)} />)}
    </div>;
}

export function PianoRollLane(props: Omit<PianoRollProps, 'mode'>) {
    return <PianoRoll {...props} mode="inline" height={props.height ?? 220} />;
}

export function PianoRollSurface(props: Omit<PianoRollProps, 'mode'>) {
    return <PianoRoll {...props} mode="surface" />;
}
