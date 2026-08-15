import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Arrangement, ArrangementClip, ArrangementNote } from '../../song/types';
import type { Verb } from '../../song/verbs';
import { copyNotes, drawNotes, eraseNotes, moveNotes, noteDragFloor, resizeNotes, setVelocity as lowerVelocity, transposeNotes } from '../../song/ops';
import { InstrumentLoader } from '../../audio/instrumentCatalog';
import { gridTicks } from '../../store/editingContextStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { growPitchRange, initialPitchRange, useTrackLaneViewStore, type PitchRange } from '../../store/trackLaneViewStore';
import {
    clippedNoteGeometry,
    DRUM_ROW_HEIGHT,
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

const GM_DRUM_NAMES: Record<number, string> = {
    35: 'Kick', 36: 'Kick', 37: 'Side stick', 38: 'Snare', 39: 'Clap', 40: 'Snare',
    41: 'Low tom', 42: 'Closed HH', 43: 'Low tom', 44: 'Pedal HH', 45: 'Mid tom',
    46: 'Open HH', 47: 'Mid tom', 48: 'High tom', 49: 'Crash', 50: 'High tom',
    51: 'Ride', 52: 'China', 53: 'Ride bell', 54: 'Tambourine', 55: 'Splash',
    56: 'Cowbell', 57: 'Crash', 59: 'Ride', 60: 'High bongo', 61: 'Low bongo',
};

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
    onAudition?: (pitch: number, velocity: number, phase: 'on' | 'off') => void;
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
}

function noteRange(notes: readonly ArrangementNote[]): PitchRange {
    if (!notes.length) return initialPitchRange(60, 60);
    return initialPitchRange(Math.min(...notes.map((note) => note.pitch)), Math.max(...notes.map((note) => note.pitch)));
}

function findClip(track: { clips: ArrangementClip[] }, clipId: string): ArrangementClip | undefined {
    return track.clips.find((item) => item.id === clipId);
}

export function PianoRoll(props: PianoRollProps) {
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
    const scrollVelocityEditing = useEditingContextStore((state) => state.scrollVelocityEditing);
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
    const drawRef = useRef<{ pointerId: number; clientX: number; tick: number; pitch: number } | null>(null);
    const marqueeRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [ghost, setGhost] = useState<{ tick: number; pitch: number; durTick: number } | null>(null);

    const track = arrangement?.tracks.find((item) => item.id === props.trackId);
    const clip = track && findClip(track, props.clipId);
    const source = clip && arrangement?.sources?.[clip.sourceId];
    const midiSource = source?.kind === 'midi' ? source : null;
    const ppq = arrangement?.ppq ?? 960;
    const beatsPerBar = arrangement?.timeSignature?.[0] ?? 4;
    const ticksPerBar = ppq * beatsPerBar;
    const leftTick = props.leftTick ?? 0;
    const allTrackNotes = (() => {
        if (!track || !arrangement?.sources) return [];
        return track.clips.flatMap((item) => {
            const itemSource = arrangement.sources?.[item.sourceId];
            return itemSource?.kind === 'midi' ? itemSource.notes : [];
        });
    })();
    const instrumentId = arrangement?.graph.nodes.find((node) => node.ref === track?.ref)?.data?.instrumentId;
    const instrumentDrums = typeof instrumentId === 'string' && InstrumentLoader.getDefinition(instrumentId)?.category === 'percussion';
    const autoDrum = instrumentDrums || shouldAutoDetectDrums(allTrackNotes);
    const drumMode = props.drumMode ?? autoDrum;
    const range = trackRange ?? noteRange(allTrackNotes);
    const trackPitchMin = allTrackNotes.length ? Math.min(...allTrackNotes.map((note) => note.pitch)) : null;
    const trackPitchMax = allTrackNotes.length ? Math.max(...allTrackNotes.map((note) => note.pitch)) : null;
    const noteFieldHeight = Math.max(90, height - VELOCITY_LANE_HEIGHT);
    const rowHeight = pitchRowHeight(noteFieldHeight, range, drumMode);
    const pitches = Array.from({ length: range.hi - range.lo + 1 }, (_, index) => range.hi - index);
    const contentHeight = drumMode ? pitches.length * DRUM_ROW_HEIGHT : Math.max(noteFieldHeight, pitches.length * rowHeight);
    const contentWidth = Math.max(1, (Math.max(clip?.startTick ?? 0, ...(track?.clips.map((item) => item.startTick + item.lengthTick) ?? [ticksPerBar])) + ticksPerBar) * props.pxPerTick);
    const noteIdSet = new Set(selectedNoteIds);

    useEffect(() => {
        if (!trackRange) rememberPitchRange(props.trackId, range);
        else if (trackPitchMin !== null && trackPitchMax !== null) {
            const grown = growPitchRange(trackRange, trackPitchMin, trackPitchMax);
            if (grown !== trackRange) rememberPitchRange(props.trackId, grown);
        }
    }, [props.trackId, range, rememberPitchRange, trackPitchMax, trackPitchMin, trackRange]);

    const grid = gridTicks(gridUnit, ppq, ticksPerBar, props.pxPerTick);
    const drawGrid = gridTicks(drawLength, ppq, ticksPerBar, props.pxPerTick, true) ?? ppq / 4;
    const stepLength = gridTicks(stepEntry.length, ppq, ticksPerBar, props.pxPerTick, true) ?? grid ?? ppq / 4;
    const snap = (tick: number) => grid && snapMode === 'magnetic' ? Math.round(tick / grid) * grid : tick;
    const yToPitch = (clientY: number) => {
        const bounds = fieldRef.current?.getBoundingClientRect();
        if (!bounds) return range.hi;
        return Math.max(range.lo, Math.min(range.hi, range.hi - Math.floor((clientY - bounds.top + fieldRef.current!.scrollTop) / rowHeight)));
    };
    const xToTick = (clientX: number) => {
        const bounds = fieldRef.current?.getBoundingClientRect();
        if (!bounds) return leftTick;
        return Math.max(0, leftTick + (clientX - bounds.left + fieldRef.current!.scrollLeft) / props.pxPerTick);
    };

    const audition = (pitch: number, velocity: number, phase: 'on' | 'off') => {
        if (!isPlaying) props.onAudition?.(pitch, velocity, phase);
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
        useArrangementStore.getState().selectNotes(noteIds);
    };

    const startNoteDrag = (event: ReactPointerEvent<HTMLButtonElement>, note: ArrangementNote, width: number) => {
        if (!note.id || event.button === 2) return;
        selectNote(event, note);
        audition(note.pitch, Math.min(48, note.vel ?? 96), 'on');
        const selected = useEditingContextStore.getState().viewports[selectionSurface].selection.noteIds;
        const notes = (midiSource?.notes ?? []).filter((item) => item.id && (selected.includes(item.id) || item.id === note.id));
        const edge = resizeEdge(event.nativeEvent.offsetX, width);
        if (!arrangement) return;
        const copy = !edge && (event.ctrlKey || event.metaKey);
        dragRef.current = { kind: edge ? `resize-${edge}` : 'move', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, notes, primary: note, base: arrangement, copyIds: copy ? notes.map(() => useArrangementStore.getState().mintId('note')) : null };
        event.currentTarget.setPointerCapture(event.pointerId);
        useArrangementStore.getState().beginGesture(edge ? 'Resize notes' : 'Move notes');
    };

    const moveNoteDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaPitch = drag.kind === 'move' ? Math.round((drag.startY - event.clientY) / rowHeight) : 0;
        const rawDelta = (event.clientX - drag.startX) / props.pxPerTick;
        const targetTick = snap(drag.primary.tick + rawDelta);
        const deltaTick = Math.round(targetTick - drag.primary.tick);
        const ids = drag.notes.flatMap((note) => note.id ? [note.id] : []);
        const result = drag.kind === 'move'
            ? drag.copyIds
                ? copyNotes(drag.base, ids, deltaTick, deltaPitch, (() => { let index = 0; return () => drag.copyIds![index++]!; })())
                : moveNotes(drag.base, ids, deltaTick, deltaPitch)
            : resizeNotes(drag.base, ids, drag.kind === 'resize-start' ? 'start' : 'end', { deltaTick, mode: event.shiftKey ? 'absolute' : 'relative' });
        useArrangementStore.getState().previewGesture(result.verbs);
    };

    const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        audition(drag.primary.pitch, Math.min(48, drag.primary.vel ?? 96), 'off');
        if (drag.copyIds) {
            useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: drag.copyIds });
            useArrangementStore.getState().selectNotes(drag.copyIds);
        }
        dragRef.current = null;
        useArrangementStore.getState().commitGesture();
    };

    const erase = (event: ReactPointerEvent, note: ArrangementNote) => {
        if (event.button !== 2 || !note.id) return;
        event.preventDefault();
        if (arrangement) useArrangementStore.getState().apply(eraseNotes(arrangement, { noteIds: [note.id] }).verbs);
    };

    const drawAt = (tick: number, pitch: number, duration = drawGrid) => {
        if (!arrangement || !midiSource || !clip) return;
        const absoluteTick = Math.max(clip.startTick, snap(tick));
        const sourceTick = Math.round((clip.sourceStart ?? 0) + absoluteTick - clip.startTick);
        if (midiSource.notes.some((note) => note.tick === sourceTick && note.pitch === pitch)) return;
        const note: ArrangementNote = { tick: sourceTick, durTick: drumMode ? 1 : Math.max(1, Math.round(duration)), pitch, vel: drawVelocity };
        const result = drawNotes(arrangement, clip.id!, [note], useArrangementStore.getState().mintId, useEditingContextStore.getState().overlapPolicy);
        useArrangementStore.getState().apply(result.verbs);
        const noteIds = result.selectedNoteIds ?? [];
        useEditingContextStore.getState().setSelection(selectionSurface, { noteIds });
        useArrangementStore.getState().selectNotes(noteIds);
        audition(pitch, Math.min(48, drawVelocity), 'on');
        window.setTimeout(() => audition(pitch, Math.min(48, drawVelocity), 'off'), 100);
    };

    const onFieldPointerMove = (event: ReactPointerEvent) => {
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

    const onFieldPointerDown = (event: ReactPointerEvent) => {
        if (event.target !== event.currentTarget && (event.target as HTMLElement).closest('.piano-roll-note')) return;
        if (event.button === 0 && (tool === 'draw' || event.ctrlKey || event.metaKey)) {
            drawRef.current = { pointerId: event.pointerId, clientX: event.clientX, tick: snap(xToTick(event.clientX)), pitch: yToPitch(event.clientY) };
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        else if (event.button === 0) {
            const bounds = fieldRef.current?.getBoundingClientRect();
            if (bounds) { marqueeRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: event.clientX - bounds.left, y: event.clientY - bounds.top }; event.currentTarget.setPointerCapture(event.pointerId); }
        }
    };

    const onFieldPointerUp = (event: ReactPointerEvent) => {
        const drawing = drawRef.current;
        if (drawing && drawing.pointerId === event.pointerId) {
            const end = snap(xToTick(event.clientX));
            const dragged = Math.abs(event.clientX - drawing.clientX) >= 3;
            const duration = dragged ? Math.max(noteDragFloor(ppq), Math.abs(end - drawing.tick)) : drawGrid;
            drawAt(Math.min(drawing.tick, end), drawing.pitch, duration);
            drawRef.current = null;
            return;
        }
        const mark = marqueeRef.current;
        if (!mark || mark.pointerId !== event.pointerId) return;
        const bounds = fieldRef.current?.getBoundingClientRect();
        const dx = event.clientX - mark.clientX;
        const dy = event.clientY - mark.clientY;
        let noteIds: string[] = [];
        if (bounds && Math.hypot(dx, dy) >= 4) {
            const left = bounds.left + Math.min(mark.x, mark.x + dx);
            const top = bounds.top + Math.min(mark.y, mark.y + dy);
            const right = left + Math.abs(dx);
            const bottom = top + Math.abs(dy);
            noteIds = [...fieldRef.current!.querySelectorAll<HTMLElement>('[data-note-id]')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top; }).map((element) => element.dataset.noteId!);
        }
        useEditingContextStore.getState().setSelection(selectionSurface, { noteIds });
        useArrangementStore.getState().selectNotes(noteIds);
        marqueeRef.current = null;
        setMarquee(null);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (!arrangement || !midiSource) return;
        const stepKeys: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11 };
        if (stepEntry.trackId === props.trackId && !event.ctrlKey && !event.metaKey) {
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
                const pitch = Math.max(0, Math.min(127, (stepEntry.octave + 1) * 12 + offset));
                const sourceTick = Math.round((clip.sourceStart ?? 0) + stepEntry.positionTick - clip.startTick);
                const result = drawNotes(arrangement, clip.id!, [{ tick: sourceTick, durTick: Math.max(1, Math.round(stepLength)), pitch, vel: stepEntry.velocity }], useArrangementStore.getState().mintId, useEditingContextStore.getState().overlapPolicy);
                useArrangementStore.getState().apply(result.verbs);
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
            useArrangementStore.getState().selectNotes(noteIds);
            return;
        }
        if (!selectedNoteIds.length) return;
        const selected = midiSource.notes.filter((note) => note.id && selectedNoteIds.includes(note.id));
        let verbs: Verb[] | null = null;
        if (event.key === 'Delete' || event.key === 'Backspace') verbs = selected.map((note) => ({ kind: 'removeNote', noteId: note.id! }));
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
            event.preventDefault();
            const result = copyNotes(arrangement, selectedNoteIds, grid ?? 1, 0, useArrangementStore.getState().mintId);
            useArrangementStore.getState().apply(result.verbs);
            useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: result.selectedNoteIds ?? [] });
            useArrangementStore.getState().selectNotes(result.selectedNoteIds ?? []);
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
        if (verbs?.length) useArrangementStore.getState().apply(verbs);
    };

    const currentNotes = midiSource?.notes ?? [];
    const otherClipNotes = track?.clips.flatMap((other) => {
        if (other.id === clip?.id) return [];
        const otherSource = arrangement?.sources?.[other.sourceId];
        if (otherSource?.kind !== 'midi') return [];
        return otherSource.notes.map((note) => ({ note, clip: other }));
    }) ?? [];

    if (!arrangement || !track || !clip || !midiSource) return null;

    return (
        <section
            ref={rootRef}
            className={`piano-roll piano-roll--${mode}${drumMode ? ' is-drums' : ''}`}
            style={{ '--piano-roll-height': `${height}px`, '--piano-roll-key-width': `${drumMode ? 64 : KEY_COLUMN_WIDTH}px`, '--piano-roll-scroomer-width': `${SCROOMER_WIDTH}px` } as CSSProperties}
            aria-label={`${track.name ?? 'MIDI track'} piano roll, ${currentNotes.length} notes${drumMode ? ', drum mode' : ''}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onWheel={(event) => {
                if (!scrollVelocityEditing || !selectedNoteIds.length || event.ctrlKey || event.metaKey) return;
                event.preventDefault();
                const amount = (event.altKey ? 10 : 1) * (event.deltaY < 0 ? 1 : -1);
                const selected = currentNotes.filter((note) => note.id && selectedNoteIds.includes(note.id));
                const request = event.shiftKey ? { mode: 'set' as const, amount: (selected[0]?.vel ?? 64) + amount, smush: true } : { mode: 'delta' as const, amount };
                useArrangementStore.getState().apply(lowerVelocity(arrangement, selectedNoteIds, request).verbs);
            }}
            onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('.piano-roll-note')) props.onOpenSurface?.();
                else drawAt(xToTick(event.clientX), yToPitch(event.clientY));
            }}
        >
            <header className="piano-roll__toolbar">
                <span className="piano-roll__title">{clip.name ?? midiSource.name}</span>
                <span className="piano-roll__mode-note" aria-live="polite">{drumMode ? 'Drum rows auto-detected' : 'Pitched notes'}</span>
                <button type="button" className="piano-roll__tool" aria-pressed={drumMode} onClick={() => props.onDrumModeChange?.(!drumMode)}>Drums</button>
                <label className="piano-roll__quantize-field">Grid<select aria-label="Quantize grid" value={quantizeGrid} onChange={(event) => useEditingContextStore.getState().setQuantize({ quantizeGrid: event.target.value as typeof quantizeGrid })}><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option><option value="1/8t">1/8T</option></select></label>
                <label className="piano-roll__quantize-field">Strength<input aria-label="Quantize strength" type="number" min="0" max="100" value={quantizeStrength} onChange={(event) => useEditingContextStore.getState().setQuantize({ quantizeStrength: Number(event.target.value) })} /></label>
                <label className="piano-roll__quantize-field">Swing<input aria-label="Quantize swing" type="number" min="-150" max="150" value={quantizeSwing} onChange={(event) => useEditingContextStore.getState().setQuantize({ quantizeSwing: Number(event.target.value) })} /></label>
                <button type="button" className="piano-roll__tool" onClick={() => props.onQuantize?.(selectedNoteIds)} disabled={!selectedNoteIds.length}>Quantize</button>
                <button type="button" className="piano-roll__tool" aria-pressed={stepEntry.trackId === props.trackId} onClick={() => useEditingContextStore.getState().setStepEntry({ trackId: stepEntry.trackId === props.trackId ? null : props.trackId, positionTick: clip.startTick })}>Step</button>
                {props.onClose && <button type="button" className="piano-roll__close" aria-label="Close piano roll" onClick={props.onClose}>⌃</button>}
            </header>
            <div className="piano-roll__body">
                <PitchScroomer trackId={props.trackId} range={range} pitchesWithNotes={new Set(allTrackNotes.map((note) => note.pitch))} />
                <div className="piano-roll__keys" role="list" aria-label="Pitch rows" style={{ height: contentHeight }}>
                    {pitches.map((pitch) => <div key={pitch} role="listitem" aria-label={drumMode ? (GM_DRUM_NAMES[pitch] ?? pitchName(pitch)) : pitchName(pitch)} className={`piano-roll__key${isBlackPitch(pitch) ? ' is-black' : ''}${isKeyboardSeam(pitch) ? ' is-seam' : ''}`} style={{ height: rowHeight }}>{drumMode ? (GM_DRUM_NAMES[pitch] ?? pitchName(pitch)) : pitch % 12 === 0 && rowHeight >= 7 ? pitchName(pitch) : ''}</div>)}
                </div>
                <div ref={fieldRef} className="piano-roll__field" onPointerMove={onFieldPointerMove} onPointerLeave={() => { if (!drawRef.current) setGhost(null); }} onPointerDown={onFieldPointerDown} onPointerUp={onFieldPointerUp} onPointerCancel={() => { drawRef.current = null; marqueeRef.current = null; setMarquee(null); setGhost(null); }}>
                    <div className="piano-roll__content" style={{ width: contentWidth, height: contentHeight, transform: `translateX(${-leftTick * props.pxPerTick}px)` }}>
                        <TimeGrid width={contentWidth} height={contentHeight} pxPerTick={props.pxPerTick} ticksPerBar={ticksPerBar} ppq={ppq} grid={grid} />
                        {pitches.map((pitch, index) => <div key={pitch} className={`piano-roll__row${isBlackPitch(pitch) ? ' is-black' : ''}${pitch % 12 === 0 ? ' is-c' : ''}`} style={{ top: index * rowHeight, height: rowHeight }} />)}
                        {otherClipNotes.map(({ note, clip: other }, index) => {
                            const geometry = clippedNoteGeometry(note, other.startTick, other.sourceStart ?? 0, other.lengthTick, props.pxPerTick);
                            if (!geometry || note.pitch < range.lo || note.pitch > range.hi) return null;
                            return <span key={`${other.id}-${note.id ?? index}`} className="piano-roll-note piano-roll-note--elsewhere" style={{ left: geometry.left, top: (range.hi - note.pitch) * rowHeight + Math.max(1, (rowHeight - 5) / 2), width: drumMode ? 10 : geometry.width, height: drumMode ? 10 : Math.max(3, rowHeight - 2) }} />;
                        })}
                        {currentNotes.map((note, index) => {
                            const geometry = clippedNoteGeometry(note, clip.startTick, clip.sourceStart ?? 0, clip.lengthTick, props.pxPerTick);
                            if (!geometry || note.pitch < range.lo || note.pitch > range.hi) return null;
                            const selected = !!note.id && noteIdSet.has(note.id);
                            return <button key={note.id ?? index} type="button" data-note-id={note.id} className={`piano-roll-note${selected ? ' is-selected' : ''}${drumMode ? ' is-drum' : ''}`} style={{ left: geometry.left, top: (range.hi - note.pitch) * rowHeight + Math.max(1, (rowHeight - (drumMode ? 10 : Math.max(3, rowHeight - 2))) / 2), width: drumMode ? 10 : geometry.width, height: drumMode ? 10 : Math.max(3, rowHeight - 2), '--note-opacity': `${velocityOpacity(note.vel) * 100}%` } as CSSProperties} aria-label={`${pitchName(note.pitch)}, tick ${note.tick}, duration ${note.durTick}, velocity ${note.vel ?? 96}`} aria-pressed={selected} onPointerDown={(event) => { erase(event, note); startNoteDrag(event, note, geometry.width); }} onPointerMove={moveNoteDrag} onPointerUp={endDrag} onPointerCancel={() => { dragRef.current = null; useArrangementStore.getState().abortGesture(); }} onContextMenu={(event) => event.preventDefault()} />;
                        })}
                        {ghost && <span className={`piano-roll-note piano-roll-note--draw${drumMode ? ' is-drum' : ''}`} style={{ left: ghost.tick * props.pxPerTick, top: (range.hi - ghost.pitch) * rowHeight + Math.max(1, (rowHeight - (drumMode ? 10 : Math.max(3, rowHeight - 2))) / 2), width: drumMode ? 10 : Math.max(2, ghost.durTick * props.pxPerTick), height: drumMode ? 10 : Math.max(3, rowHeight - 2) }} />}
                        {stepEntry.trackId === props.trackId && <span className="piano-roll__step-cursor" style={{ left: stepEntry.positionTick * props.pxPerTick, top: (range.hi - stepEntry.pitch) * rowHeight, width: Math.max(2, stepLength * props.pxPerTick), height: rowHeight }} />}
                        {marquee && <span className="piano-roll__marquee" style={marquee} />}
                        {!currentNotes.length && <p className="piano-roll__empty">press D, then draw.</p>}
                        <Playhead pxPerTick={props.pxPerTick} />
                    </div>
                </div>
            </div>
            <VelocityLane notes={currentNotes} clip={clip} pxPerTick={props.pxPerTick} leftTick={leftTick} selectedIds={noteIdSet} onSelect={(id) => { useEditingContextStore.getState().setSelection(selectionSurface, { noteIds: [id] }); useArrangementStore.getState().selectNotes([id]); }} />
        </section>
    );
}

function TimeGrid({ width, height, pxPerTick, ticksPerBar, ppq, grid }: { width: number; height: number; pxPerTick: number; ticksPerBar: number; ppq: number; grid: number | null }) {
    const marks: { tick: number; kind: 'bar' | 'beat' | 'sub' }[] = [];
    const step = grid ?? ticksPerBar;
    for (let tick = 0; tick * pxPerTick <= width; tick += step) marks.push({ tick, kind: tick % ticksPerBar === 0 ? 'bar' : tick % ppq === 0 ? 'beat' : 'sub' });
    return <div className="piano-roll__time-grid" aria-hidden="true" style={{ height }}>{marks.map((mark) => <i key={mark.tick} className={`is-${mark.kind}`} style={{ left: mark.tick * pxPerTick }} />)}</div>;
}

function Playhead({ pxPerTick }: { pxPerTick: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    const isPlaying = useArrangementStore((state) => state.isPlaying);
    const playheadTick = useArrangementStore((state) => state.playheadTick);
    useEffect(() => {
        const write = () => { if (ref.current) ref.current.style.transform = `translateX(${useArrangementStore.getState().currentTick() * pxPerTick}px)`; };
        write();
        if (!isPlaying) return;
        let frame = requestAnimationFrame(function loop() { write(); frame = requestAnimationFrame(loop); });
        return () => cancelAnimationFrame(frame);
    }, [isPlaying, playheadTick, pxPerTick]);
    return <span ref={ref} className="piano-roll__playhead" aria-hidden="true" />;
}

function PitchScroomer({ trackId, range, pitchesWithNotes }: { trackId: string; range: PitchRange; pitchesWithNotes: Set<number> }) {
    const remember = useTrackLaneViewStore((state) => state.rememberPitchRange);
    const start = useRef<{ y: number; range: PitchRange } | null>(null);
    const top = (127 - range.hi) / 128 * 100;
    const height = (range.hi - range.lo + 1) / 128 * 100;
    return <div className="piano-roll__scroomer" aria-label={`Pitch range ${pitchName(range.lo)} to ${pitchName(range.hi)}`} role="slider" aria-valuemin={0} aria-valuemax={127} aria-valuenow={range.hi} tabIndex={0} onPointerDown={(event) => { start.current = { y: event.clientY, range }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!start.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return; const delta = Math.round((start.current.y - event.clientY) / event.currentTarget.clientHeight * 128); const span = start.current.range.hi - start.current.range.lo; const lo = Math.max(0, Math.min(127 - span, start.current.range.lo + delta)); remember(trackId, { lo, hi: lo + span }); }} onPointerUp={() => { start.current = null; }}>
        {[...pitchesWithNotes].map((pitch) => <i key={pitch} style={{ top: `${(127 - pitch) / 128 * 100}%` }} />)}
        <span className="piano-roll__scroomer-window" style={{ top: `${top}%`, height: `${height}%` }}><b /><b /></span>
    </div>;
}

function VelocityLane({ notes, clip, pxPerTick, leftTick, selectedIds, onSelect }: { notes: readonly ArrangementNote[]; clip: ArrangementClip; pxPerTick: number; leftTick: number; selectedIds: Set<string>; onSelect: (id: string) => void }) {
    const laneRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointerId: number; noteId: string; base: Arrangement } | null>(null);
    const previewVelocity = (event: ReactPointerEvent, note: ArrangementNote) => {
        if (!note.id || !laneRef.current) return;
        const bounds = laneRef.current.getBoundingClientRect();
        const vel = Math.max(0, Math.min(127, Math.round((bounds.bottom - event.clientY) / bounds.height * 127)));
        const base = drag.current?.base;
        if (base) useArrangementStore.getState().previewGesture(lowerVelocity(base, [note.id], { mode: 'set', amount: vel }).verbs);
    };
    return <div ref={laneRef} className="piano-roll__velocity" aria-label="Velocity lane">
        <span className="piano-roll__velocity-label">Velocity</span><i className="is-guide is-96" /><i className="is-guide is-64" /><i className="is-guide is-32" />
        {notes.map((note) => note.id && <button key={note.id} type="button" className={`piano-roll__lollipop${selectedIds.has(note.id) ? ' is-selected' : ''}`} style={{ left: (clip.startTick + note.tick - (clip.sourceStart ?? 0) - leftTick) * pxPerTick, height: `${(note.vel ?? 96) / 127 * 100}%` }} aria-label={`${pitchName(note.pitch)} velocity ${note.vel ?? 96}`} onPointerDown={(event) => { const base = useArrangementStore.getState().arrangement; if (!base) return; onSelect(note.id!); drag.current = { pointerId: event.pointerId, noteId: note.id!, base }; event.currentTarget.setPointerCapture(event.pointerId); useArrangementStore.getState().beginGesture('Set note velocity'); previewVelocity(event, note); }} onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) previewVelocity(event, note); }} onPointerUp={(event) => { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; useArrangementStore.getState().commitGesture(); }} onPointerCancel={() => { drag.current = null; useArrangementStore.getState().abortGesture(); }} />)}
    </div>;
}

export function PianoRollLane(props: Omit<PianoRollProps, 'mode'>) {
    return <PianoRoll {...props} mode="inline" height={props.height ?? 220} />;
}

export function PianoRollSurface(props: Omit<PianoRollProps, 'mode'>) {
    return <PianoRoll {...props} mode="surface" />;
}
