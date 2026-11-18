import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button, Kbd } from '@openjammer/oj-ui';
import { stopReturnsToOrigin, useArrangementStore } from '../../store/arrangementStore';
import { snapTimeline, useEditingContextStore, type GridUnit } from '../../store/editingContextStore';
import { useTrackLaneViewStore } from '../../store/trackLaneViewStore';
import { useBindingSet } from '../../keymap/useKeymap';
import { arrangementLengthTicks, formatBarBeat, timebase } from '../../song/time';
import { buildTempoMap, sampleToTick } from '../../song/tempoMap';
import { buildPaperSketch } from '../../song/songs/paperSketch';
import { buildFirstLight } from '../../song/songs/firstLight';
import { SkyBand } from './SkyBand';
import { RulerStack } from './RulerStack';
import { GridLayer } from './GridLayer';
import { TrackLaneView } from './TrackLaneView';
import { PlayheadLayer } from './PlayheadLayer';
import { registerScrollWriter, writeScrollTransforms } from './usePlayheadTransform';
import { addMarker, createClip, deleteTime, duplicateClips, insertTime, loopRangeForEdge, nudge, splitAt } from '../../song/ops';
import { gridTicks } from '../../store/editingContextStore';
import { useHistoryStore } from '../../store/historyStore';
import { useUiViewStore } from '../../store/uiViewStore';
import './ArrangementSurface.css';
import './DragGhost.css';
import './gestureHandles.css';
import { DragGhostLayer } from './DragGhost';
import { MixerDrawer } from './MixerDrawer';
import { AUTOMATION_LANE_HEIGHT } from './AutomationLaneView';
import { copySelection, cutSelection, deleteSelection, duplicateSelectedRange, loopFromSelection, paste, splitSelectedRange } from '../../song/editingActions';
import { virtualizationWindow } from './geometry';
import { abortOwnedPointerGestures, ownPointerGesture } from './pointerGestureLifetime';

function parseMusicalDuration(value: string, ticksPerBeat: number, ticksPerBar: number): number | null {
    const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(bars?|beats?)?$/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!(amount > 0)) return null;
    return Math.max(1, Math.round(amount * ((match[2]?.startsWith('beat')) ? ticksPerBeat : ticksPerBar)));
}

const RULER_HEIGHT = 64;
/**
 * The sky band's height, in JS. Its twin is `--arrangement-sky-height` in
 * `ArrangementSurface.css`, and `rulerStack.test.tsx` pins them equal — the
 * field overlay pane starts at `sky + ruler`, so a drift between the two would
 * offset every transient overlay from the field it is supposed to be inside.
 */
const SKY_HEIGHT = 56;
const EMPTY_GHOST_BARS = 32;
/*
 * The paper behind the empty-state card is RULED, and nothing more.
 *
 * It used to be three lanes carrying Paper Sketch's tracks under the names
 * "Track 1 / 2 / 3" — chords, bass, lead — and a first-time player read them as
 * her song, then watched her first real action delete all three (FH-1 F9). They
 * were never tracks; they were a picture of tracks. So they keep the geometry
 * that makes an empty page look like a page and give up the names, the
 * instruments and the refs they never had: blank ruled lanes, which is exactly
 * what is there.
 */
const EMPTY_GHOST_TRACKS = [0, 1, 2].map((index) => ({ id: `empty-ghost-${index}`, name: '', ref: '', clips: [] }));
/*
 * A track drawn by hand starts UNBOUND: its `ref` names nothing in this
 * (deliberately empty) graph, so `conduct` cannot voice it and the lane header
 * says so in words, before Play. Choosing an instrument writes the node and
 * repoints the ref through `setTrackRef` — one reversible edit (`song/bindTrack`).
 */
const EMPTY_TRACK_ARRANGEMENT = { name: 'Untitled song', tempoBpm: 120, ppq: 960, timeSignature: [4, 4] as [number, number], graph: { nodes: [], connections: [] }, tracks: [{ id: 'track-1', name: 'Track 1', ref: 'track-1', clips: [] }] };

export function ArrangementSurface({ active, visible = active, transition, songNodeId }: { active: boolean; visible?: boolean; transition?: 'in' | 'out'; songNodeId: string | null; onOpenSettings?: () => void }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const viewport = useEditingContextStore((state) => state.viewports.arrangement);
    const gridUnit = useEditingContextStore((state) => state.gridUnit);
    const snapMode = useEditingContextStore((state) => state.snapMode);
    const laneHeights = useTrackLaneViewStore((state) => state.laneHeights);
    const expandedPianoRolls = useTrackLaneViewStore((state) => state.expandedPianoRolls);
    const automationLaneByTrack = useTrackLaneViewStore((state) => state.automationLaneByTrack);
    const mixerOpen = useTrackLaneViewStore((state) => state.mixerOpen);
    const headerWidth = useTrackLaneViewStore((state) => state.headerWidth);
    const dragActive = useEditingContextStore((state) => state.dragActive);
    const activeClipDragIds = useEditingContextStore((state) => state.activeClipDragIds);
    const snapIndicatorTick = useEditingContextStore((state) => state.snapIndicatorTick);
    const scrollRef = useRef<HTMLDivElement>(null);
    const overlayOriginRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ width: 1000, height: 600, left: 0, top: 0 });
    const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number; mode: 'object' | 'range' } | null>(null);
    const [timePrompt, setTimePrompt] = useState<'insert' | 'delete' | null>(null);
    const [timeAmount, setTimeAmount] = useState('1 bar');
    const [timeScope, setTimeScope] = useState<'selected-tracks' | 'all'>('selected-tracks');
    const [timeError, setTimeError] = useState('');
    const marqueeStart = useRef<{ x: number; y: number; clientX: number; clientY: number; pointerId: number; add: boolean; toggle: boolean; mode: 'object' | 'range'; tick: number; trackId: string; cleanup: () => void; element: HTMLElement } | null>(null);
    const drawStart = useRef<{ pointerId: number; trackId: string; startTick: number; cleanup: () => void; element: HTMLElement } | null>(null);
    const [drawGhost, setDrawGhost] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const scrollbarFade = useRef<number | null>(null);
    const viewportFrame = useRef<number | null>(null);
    const pendingZoom = useRef<{ pointer: number; factor: number; ticksPerBar: number } | null>(null);

    /*
     * The field overlay pane holds its children in TIMELINE-CONTENT coordinates,
     * so it counter-translates by the live scroll offsets. This is written
     * straight onto the DOM, synchronously in `onScroll`, rather than through
     * `view` — a React state hop would put the playhead and the ghost one frame
     * behind the clips they are pointing at, which on a ruled surface is the
     * same lie as an unlocked pixel.
     *
     * It registers with `registerScrollWriter` rather than being called from the
     * handler directly, so that this pane (which carries the playhead LINE) and
     * the ruler-borne playhead CAP are written by ONE call in ONE scroll event.
     * Two synchronous writes are still two clocks if anything can ever call one
     * without the other.
     */
    const writeOverlayOrigin = () => {
        const scroll = scrollRef.current;
        const origin = overlayOriginRef.current;
        if (scroll && origin) origin.style.transform = `translate3d(${-headerWidth - scroll.scrollLeft}px,${-RULER_HEIGHT - scroll.scrollTop}px,0)`;
    };
    useEffect(() => {
        writeOverlayOrigin();
        return registerScrollWriter(writeOverlayOrigin);
    });

    const scheduleViewportWrite = () => {
        if (viewportFrame.current !== null) return;
        viewportFrame.current = requestAnimationFrame(() => {
            viewportFrame.current = null;
            const scroll = scrollRef.current;
            if (!scroll) return;
            const zoom = pendingZoom.current;
            pendingZoom.current = null;
            if (zoom) {
                useEditingContextStore.getState().zoomAt('arrangement', zoom.pointer, zoom.factor, zoom.ticksPerBar);
                const next = useEditingContextStore.getState().viewports.arrangement;
                setView((current) => ({ ...current, left: next.leftTick * next.pxPerTick, top: scroll.scrollTop }));
                useEditingContextStore.getState().setViewport('arrangement', { yOrigin: scroll.scrollTop });
                requestAnimationFrame(() => {
                    const live = scrollRef.current;
                    const canonical = useEditingContextStore.getState().viewports.arrangement;
                    if (live) live.scrollLeft = canonical.leftTick * canonical.pxPerTick;
                });
                return;
            }
            const currentScale = useEditingContextStore.getState().viewports.arrangement.pxPerTick;
            setView((current) => ({ ...current, left: scroll.scrollLeft, top: scroll.scrollTop }));
            useEditingContextStore.getState().setViewport('arrangement', { leftTick: scroll.scrollLeft / currentScale, yOrigin: scroll.scrollTop });
        });
    };

    useBindingSet(useMemo(() => ({
        id: 'arrangement-surface',
        scope: 'surface' as const,
        surface: 'arrangement' as const,
        entries: [
            // `inherit: true` marks the only entries an enclosing arrangement lends to a
            // focused inline piano roll: document history, transport, marker drop, and the
            // exit/Escape cascade. Everything below is surface-local on purpose — an editor
            // must never be able to split, mute or re-tool the clip it is editing.
            // Spec §7 / §4.2 `Space` ×2: rolling → Stop; stopped away from where
            // playback started → the second Stop, which returns the playhead
            // there; otherwise → Play. `stopReturnsToOrigin` is the SAME question
            // the pill asks, so the key and the button cannot disagree.
            { actionId: 'arrangement.transport', inherit: true, guard: (event: KeyboardEvent) => !event.repeat, run: () => { const store = useArrangementStore.getState(); if (store.isPlaying || stopReturnsToOrigin(store)) store.stop(); else { useEditingContextStore.setState({ followPlayhead: true }); store.play(); } return true; } },
            { actionId: 'arrangement.undo', inherit: true, run: () => { useHistoryStore.getState().undo(); return true; } },
            { actionId: 'arrangement.redo', inherit: true, run: () => { useHistoryStore.getState().redo(); return true; } },
            { actionId: 'arrangement.selectionUndo', run: () => { useEditingContextStore.getState().undoSelection('arrangement'); return true; } },
            { actionId: 'arrangement.selectionRedo', run: () => { useEditingContextStore.getState().redoSelection('arrangement'); return true; } },
            { actionId: 'arrangement.cut', run: () => { cutSelection('arrangement'); return true; } },
            { actionId: 'arrangement.copy', run: () => { copySelection('arrangement'); return true; } },
            { actionId: 'arrangement.paste', run: () => { paste({ surface: 'arrangement' }); return true; } },
            { actionId: 'arrangement.zoomToSelection', defaultBinding: { key: 'z', shift: true }, run: () => { const context = useEditingContextStore.getState(); const range = context.viewports.arrangement.selection.timeRange; const clips = useArrangementStore.getState().arrangement?.tracks.flatMap((track) => track.clips).filter((clip) => clip.id && context.viewports.arrangement.selection.clipIds.includes(clip.id)); const from = range?.fromTick ?? (clips?.length ? Math.min(...clips.map((clip) => clip.startTick)) : null); const to = range?.toTick ?? (clips?.length ? Math.max(...clips.map((clip) => clip.startTick + clip.lengthTick)) : null); if (from !== null && to !== null && to > from) context.setViewport('arrangement', { leftTick: from, pxPerTick: Math.max(4 / 3840, (Math.max(1, view.width - headerWidth) * 0.9) / (to - from)) }); return true; } },
            ...['arrangement.delete', 'arrangement.deleteBackspace'].map((actionId) => ({ actionId, run: () => { const context = useEditingContextStore.getState(); const sectionIds = context.viewports.arrangement.selection.sectionIds; if (sectionIds.length) { useArrangementStore.getState().apply(sectionIds.map((locationId) => ({ kind: 'removeLocation' as const, locationId }))); context.setSelection('arrangement', { sectionIds: [] }); } else deleteSelection('arrangement'); return true; } })),
            { actionId: 'arrangement.duplicate', run: () => { if (duplicateSelectedRange()) return true; const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const tb = timebase(arr); const amount = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? 1; const result = duplicateClips(arr, context.viewports.arrangement.selection.clipIds, amount, store.mintId); store.apply(result.verbs); context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] }); return true; } },
            ...([['arrangement.nudgeLeft', -1, false], ['arrangement.nudgeRight', 1, false], ['arrangement.nudgeLeftFine', -1, true], ['arrangement.nudgeRightFine', 1, true]] as const).map(([actionId, direction, fine]) => ({ actionId, run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const tb = timebase(arr); const grid = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? 1; store.apply(nudge(arr, context.viewports.arrangement.selection.clipIds, fine ? Math.max(1, Math.round(grid / 16)) : grid, direction).verbs); return true; } })),
            { actionId: 'arrangement.split', run: () => { if (splitSelectedRange()) return true; const store = useArrangementStore.getState(); const arr = store.arrangement; const context = useEditingContextStore.getState(); if (!arr) return true; const editTick = store.transportPending === 'seek' && store.pendingSeekSample != null ? sampleToTick(buildTempoMap(arr), store.pendingSeekSample) : store.playheadTick; const result = splitAt(arr, context.viewports.arrangement.selection.clipIds, editTick, store.mintId); store.apply(result.verbs); context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] }); return true; } },
            { actionId: 'arrangement.toggleRipple', run: () => { const context = useEditingContextStore.getState(); context.setEditMode(context.editMode === 'ripple' ? 'slide' : 'ripple'); return true; } },
            { actionId: 'arrangement.escape', inherit: true, guard: () => !useEditingContextStore.getState().dragActive, run: () => { useEditingContextStore.getState().clearSelection('arrangement'); return true; } },
            { actionId: 'arrangement.openPianoRoll', run: () => {
                const store = useArrangementStore.getState();
                const arr = store.arrangement;
                const context = useEditingContextStore.getState();
                const clipId = context.viewports.arrangement.selection.clipIds[0];
                if (!arr || !clipId) return true;
                const clip = arr.tracks.flatMap((track) => track.clips).find((item) => item.id === clipId);
                if (!clip || arr.sources?.[clip.sourceId]?.kind !== 'midi') return true;
                const source = context.viewports.arrangement;
                context.setViewport('pianoroll', { pxPerTick: source.pxPerTick, leftTick: source.leftTick });
                context.setSelection('pianoroll', { clipIds: [clipId], noteIds: [] });
                useUiViewStore.getState().openPianoRoll(clipId);
                requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-surface-root="pianoroll"]')?.focus({ preventScroll: true }));
                return true;
            } },
            { actionId: 'arrangement.enter', defaultBinding: { key: 'e' }, run: () => { document.querySelector<HTMLElement>('[data-surface-root="arrangement"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; } },
            { actionId: 'arrangement.exit', inherit: true, defaultBinding: { key: 'q' }, run: () => { useUiViewStore.getState().setSurface('canvas'); return true; } },
            { actionId: 'arrangement.playFromSelection', inherit: true, defaultBinding: { key: ' ', shift: true }, guard: (event) => !event.repeat, run: () => { const store = useArrangementStore.getState(); const range = useEditingContextStore.getState().viewports.arrangement.selection.timeRange; const loop = store.arrangement?.locations?.find((location) => location.kind === 'loop'); store.seek(range?.fromTick ?? loop?.startTick ?? store.playheadTick); useEditingContextStore.setState({ followPlayhead: true }); store.play(); return true; } },
            { actionId: 'arrangement.fitSong', defaultBinding: { key: '0', ctrl: true }, run: () => { const arr = useArrangementStore.getState().arrangement; if (arr) useEditingContextStore.getState().setViewport('arrangement', { leftTick: 0, pxPerTick: Math.max(4 / timebase(arr).ticksPerBar, (Math.max(1, view.width - headerWidth) * 0.95) / Math.max(1, arrangementLengthTicks(arr))) }); return true; } },
            ...([['arrangement.zoomIn', '=', 1.25], ['arrangement.zoomOut', '-', 0.8]] as const).map(([actionId, key, factor]) => ({ actionId, defaultBinding: { key }, run: () => { const arr = useArrangementStore.getState().arrangement; if (arr) { const context = useEditingContextStore.getState(); const tick = useArrangementStore.getState().currentTick(); const pointer = (tick - context.viewports.arrangement.leftTick) * context.viewports.arrangement.pxPerTick; context.zoomAt('arrangement', pointer, factor, timebase(arr).ticksPerBar); context.setViewport('arrangement', { zoomFocus: 'playhead' }); useEditingContextStore.setState({ followPlayhead: false }); } return true; } })),
            { actionId: 'arrangement.snapToggle', defaultBinding: { key: 'g', alt: true }, run: () => { useEditingContextStore.getState().toggleSnap(); return true; } },
            { actionId: 'arrangement.follow', defaultBinding: { key: 'f' }, run: () => { useEditingContextStore.setState({ followPlayhead: true }); return true; } },
            { actionId: 'arrangement.home', defaultBinding: { key: 'Home' }, run: () => { useArrangementStore.getState().seek(0); return true; } },
            { actionId: 'arrangement.end', defaultBinding: { key: 'End' }, run: () => { const arr = useArrangementStore.getState().arrangement; if (arr) useArrangementStore.getState().seek(arrangementLengthTicks(arr)); return true; } },
            { actionId: 'arrangement.selectAll', defaultBinding: { key: 'a', ctrl: true }, run: () => { const arr = useArrangementStore.getState().arrangement; if (arr) useEditingContextStore.getState().setSelection('arrangement', { clipIds: arr.tracks.flatMap((track) => track.clips.map((clip) => clip.id).filter((id): id is string => Boolean(id))) }); return true; } },
            { actionId: 'arrangement.loop', defaultBinding: { key: 'l' }, run: () => { loopFromSelection(); return true; } },
            ...([['arrangement.loopIn', 'i', 'in'], ['arrangement.loopOut', 'o', 'out']] as const).map(([actionId, key, edge]) => ({ actionId, defaultBinding: { key }, run: () => {
                const store = useArrangementStore.getState();
                const arr = store.arrangement;
                if (!arr) return true;
                const loop = arr.locations?.find((location) => location.kind === 'loop');
                const timing = timebase(arr);
                const context = useEditingContextStore.getState();
                const unit = gridTicks(context.gridUnit, timing.ticksPerBeat, timing.ticksPerBar, context.viewports.arrangement.pxPerTick, true) ?? timing.ticksPerBar;
                const range = loopRangeForEdge(loop, store.currentTick(), edge, unit);
                store.apply({ kind: 'setLoopRange', location: { id: loop?.id ?? store.mintId('location'), name: loop?.name ?? 'Loop', kind: 'loop', ...range } });
                return true;
            } })),
            { actionId: 'arrangement.punch', defaultBinding: { key: 'p' }, run: () => { const store = useArrangementStore.getState(); store.setPunchEnabled(!store.punchEnabled); return true; } },
            { actionId: 'arrangement.metronome', defaultBinding: { key: 'm' }, run: () => { const store = useArrangementStore.getState(); store.setClick(!store.clickEnabled); return true; } },
            { actionId: 'arrangement.addMarker', inherit: true, defaultBinding: { key: 'm', ctrl: true }, run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; if (!arr) return false; const result = addMarker(arr, store.currentTick(), store.mintId); if (result.verbs.length) store.apply(result.verbs); return result.verbs.length > 0; } },
            { actionId: 'arrangement.muteClips', defaultBinding: { key: '0' }, run: () => { const store = useArrangementStore.getState(); const ids = new Set(useEditingContextStore.getState().viewports.arrangement.selection.clipIds); const clips = store.arrangement?.tracks.flatMap((track) => track.clips).filter((clip) => clip.id && ids.has(clip.id)); if (clips?.length) store.apply(clips.map((clip) => ({ kind: 'setClipMute' as const, clipId: clip.id!, mute: !clip.mute }))); return true; } },
            { actionId: 'arrangement.insertTime', defaultBinding: { key: 'e', ctrl: true }, run: () => { window.dispatchEvent(new CustomEvent('openjammer:time-prompt', { detail: { mode: 'insert' } })); return true; } },
            { actionId: 'arrangement.deleteTime', defaultBinding: { key: 'Backspace', ctrl: true, shift: true }, run: () => { window.dispatchEvent(new CustomEvent('openjammer:time-prompt', { detail: { mode: 'delete' } })); return true; } },
            /*
             * U11: four tools, four keys, four buttons, four behaviours. The
             * Time tool used to be a fifth entry here — a `t` binding that armed
             * a tool nothing on this surface ever read, with no button to press
             * and nothing to see. Code-value #8: it is removed, not kept.
             */
            ...([['arrangement.tool.select', 'v', 'select'], ['arrangement.tool.draw', 'b', 'draw'], ['arrangement.tool.erase', 'x', 'erase'], ['arrangement.tool.knife', 'k', 'knife']] as const).map(([actionId, key, tool]) => ({ actionId, defaultBinding: { key }, run: () => { useEditingContextStore.getState().setViewport('arrangement', { tool }); return true; } })),
            ...([['arrangement.gridCoarser', '[', -1], ['arrangement.gridFiner', ']', 1]] as const).map(([actionId, key, direction]) => ({ actionId, defaultBinding: { key }, run: () => { const units: GridUnit[] = ['none', 'bar', 'beat', '1/2', '1/4', '1/8', '1/16', '1/32']; const context = useEditingContextStore.getState(); const current = Math.max(0, units.indexOf(context.gridUnit)); context.setGridUnit(units[Math.max(0, Math.min(units.length - 1, current + direction))]!); return true; } })),
            ...([['arrangement.markerPrevious', 'ArrowLeft', -1], ['arrangement.markerNext', 'ArrowRight', 1]] as const).map(([actionId, key, direction]) => ({ actionId, defaultBinding: { key, ctrl: true }, run: () => { const store = useArrangementStore.getState(); const tick = store.currentTick(); const points = (store.arrangement?.locations ?? []).filter((item) => item.kind !== 'loop' && item.kind !== 'punch').map((item) => item.startTick).sort((a, b) => a - b); const target = direction < 0 ? points.filter((point) => point < tick).at(-1) : points.find((point) => point > tick); if (target !== undefined) store.seek(target); return true; } })),
            ...([['arrangement.nudgeBarLeft', 'ArrowLeft', -1], ['arrangement.nudgeBarRight', 'ArrowRight', 1]] as const).map(([actionId, key, direction]) => ({ actionId, defaultBinding: { key, alt: true }, run: () => { const store = useArrangementStore.getState(); const context = useEditingContextStore.getState(); if (store.arrangement) store.apply(nudge(store.arrangement, context.viewports.arrangement.selection.clipIds, timebase(store.arrangement).ticksPerBar, direction).verbs); return true; } })),
            ...([['arrangement.moveTrackUp', 'ArrowUp', -1], ['arrangement.moveTrackDown', 'ArrowDown', 1]] as const).map(([actionId, key, direction]) => ({ actionId, defaultBinding: { key }, run: () => { const store = useArrangementStore.getState(); const arr = store.arrangement; if (!arr) return true; const selected = new Set(useEditingContextStore.getState().viewports.arrangement.selection.clipIds); const verbs = arr.tracks.flatMap((track, index) => track.clips.filter((clip) => clip.id && selected.has(clip.id)).flatMap((clip) => { const target = arr.tracks[index + direction]; return target ? [{ kind: 'moveClip' as const, clipId: clip.id!, startTick: clip.startTick, trackId: target.id ?? target.ref }] : []; })); if (verbs.length) store.apply(verbs); return true; } })),
            ...([['arrangement.selectSpatialLeft', 'ArrowLeft', 'horizontal', -1], ['arrangement.selectSpatialRight', 'ArrowRight', 'horizontal', 1], ['arrangement.selectSpatialUp', 'ArrowUp', 'vertical', -1], ['arrangement.selectSpatialDown', 'ArrowDown', 'vertical', 1]] as const).map(([actionId, key, axis, direction]) => ({ actionId, defaultBinding: { key, ctrl: true, alt: true }, run: (event: KeyboardEvent) => { const context = useEditingContextStore.getState(); const arr = useArrangementStore.getState().arrangement; if (!arr) return true; const selectedIds = context.viewports.arrangement.selection.clipIds; const located = arr.tracks.flatMap((track, trackIndex) => track.clips.filter((clip) => clip.id).map((clip) => ({ clip, trackIndex }))); const current = located.find((item) => item.clip.id === selectedIds.at(-1)) ?? located[0]; if (!current) return true; let target = current; if (axis === 'horizontal') { const same = located.filter((item) => item.trackIndex === current.trackIndex).sort((a, b) => a.clip.startTick - b.clip.startTick); const index = same.indexOf(current); target = same[Math.max(0, Math.min(same.length - 1, index + direction))] ?? current; } else { const nextTrack = current.trackIndex + direction; target = located.filter((item) => item.trackIndex === nextTrack).sort((a, b) => Math.abs(a.clip.startTick - current.clip.startTick) - Math.abs(b.clip.startTick - current.clip.startTick))[0] ?? current; } const nextId = target.clip.id!; context.setSelection('arrangement', { clipIds: event.shiftKey ? [...new Set([...selectedIds, nextId])] : [nextId] }); return true; } })),
        ],
    }), [headerWidth, view.width]));

    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const measure = () => setView((current) => ({ ...current, width: element.clientWidth, height: element.clientHeight }));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [arrangement]);

    useEffect(() => {
        const element = scrollRef.current;
        if (!element || !arrangement) return;
        const ticksPerBar = timebase(arrangement).ticksPerBar;
        const wheel = (event: WheelEvent) => {
            useEditingContextStore.setState({ followPlayhead: false });
            if (!(event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            const pointer = event.clientX - element.getBoundingClientRect().left - headerWidth;
            const pending = pendingZoom.current;
            pendingZoom.current = { pointer: Math.max(0, pointer), factor: (pending?.factor ?? 1) * Math.exp(-event.deltaY * 0.002), ticksPerBar };
            scheduleViewportWrite();
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    }, [arrangement, headerWidth]);

    useEffect(() => {
        const prompt = (event: Event) => { const mode = (event as CustomEvent<{ mode: 'insert' | 'delete' }>).detail?.mode; if (mode) { setTimePrompt(mode); setTimeError(''); } };
        const loopSelection = () => loopFromSelection();
        window.addEventListener('openjammer:time-prompt', prompt);
        window.addEventListener('openjammer:loop-from-selection', loopSelection);
        return () => { window.removeEventListener('openjammer:time-prompt', prompt); window.removeEventListener('openjammer:loop-from-selection', loopSelection); };
    }, []);

    useEffect(() => () => {
        abortOwnedPointerGestures();
        if (scrollbarFade.current !== null) window.clearTimeout(scrollbarFade.current);
        if (viewportFrame.current !== null) cancelAnimationFrame(viewportFrame.current);
    }, []);

    if (!arrangement) {
        return (
            <div className={`arrangement-surface song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="arrangement" data-keymap-surface="arrangement" data-song-node={songNodeId ?? 'song'} tabIndex={-1} role="region" aria-label="Arrangement" hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active} style={{ '--arrangement-header-width': `${headerWidth}px` } as CSSProperties}>
                <SkyBand fieldWidth={view.width - headerWidth} />
                <div className="arrangement-empty-stage">
                    <div className="arrangement-empty-ghost" aria-hidden="true" inert>
                        <RulerStack fieldWidth={Math.max(1, view.width - headerWidth)} contentWidth={Math.max(1, view.width - headerWidth)} scrollLeft={0} pxPerTick={(Math.max(1, view.width - headerWidth)) / (EMPTY_GHOST_BARS * 960 * 4)} ticksPerBar={960 * 4} beatsPerBar={4} gridUnit="adaptive" snapOn sections={[]} songEnd={EMPTY_GHOST_BARS * 960 * 4} onToggleSnap={() => undefined} shell />
                        <div className="arrangement-lanes" role="list" aria-label="Tracks">
                            {EMPTY_GHOST_TRACKS.map((track, offset) => <TrackLaneView key={track.id} track={track} arrangement={{ ...EMPTY_TRACK_ARRANGEMENT, tracks: EMPTY_GHOST_TRACKS }} index={offset} pxPerTick={1} visibleStartTick={0} visibleEndTick={0} shell />)}
                        </div>
                    </div>
                    <div className="arrangement-empty-card">
                        <h1>An empty page.</h1>
                        <p>Start a sketch, or ask the agent to dream one up. Ctrl+Z undoes anything.</p>
                        {/*
                         * Every way IN is named here (spec 8.3 / D13). Two starters
                         * for "show me something that already sounds", and two paths
                         * for "I want to make it myself" — because an empty state
                         * that only offers demos teaches the player that the demos
                         * are the product.
                         */}
                        <div className="arrangement-empty-starters">
                            <Button variant="primary" onClick={() => useArrangementStore.getState().setArrangement({ ...buildPaperSketch(), codeNodes: undefined })}>Start from 'Paper Sketch'</Button>
                            <Button onClick={() => useArrangementStore.getState().setArrangement(buildFirstLight())}>Start from 'First Light'</Button>
                            <Button onClick={() => {
                                const store = useArrangementStore.getState();
                                store.setArrangement(EMPTY_TRACK_ARRANGEMENT);
                                store.armTrack(EMPTY_TRACK_ARRANGEMENT.tracks[0]!.id, true);
                            }}>Record something</Button>
                            <Button onClick={() => {
                                useArrangementStore.getState().setArrangement(EMPTY_TRACK_ARRANGEMENT);
                                useEditingContextStore.getState().setViewport('arrangement', { tool: 'draw' });
                            }}>Draw a clip</Button>
                        </div>
                        <button className="arrangement-empty-secondary" type="button" onClick={() => useArrangementStore.getState().setArrangement(EMPTY_TRACK_ARRANGEMENT)}>Add an empty track</button>
                        <div className="arrangement-empty-footer"><Kbd>Tab</Kbd><span>back to the canvas</span></div>
                    </div>
                </div>
            </div>
        );
    }

    const tb = timebase(arrangement);
    const lengthTicks = arrangementLengthTicks(arrangement);
    const fieldViewportWidth = Math.max(1, view.width - headerWidth);
    const contentWidth = Math.max(fieldViewportWidth, lengthTicks * viewport.pxPerTick + fieldViewportWidth * 0.25);
    const sections = (arrangement.locations ?? []).filter((location) => location.kind !== 'loop' && location.kind !== 'punch');
    const loop = (arrangement.locations ?? []).find((location) => location.kind === 'loop');
    const punch = (arrangement.locations ?? []).find((location) => location.kind === 'punch');
    const heights = arrangement.tracks.map((track) => (laneHeights[track.id ?? track.ref] ?? 72) + (automationLaneByTrack[track.id ?? track.ref] ? AUTOMATION_LANE_HEIGHT : 0));
    const virtual = virtualizationWindow(
        heights, view, viewport.pxPerTick, headerWidth, RULER_HEIGHT,
    );
    const pinnedTrackIndices = dragActive ? arrangement.tracks.map((track, index) => track.clips.some((clip) => clip.id && activeClipDragIds.includes(clip.id)) ? index : -1).filter((index) => index >= 0) : [];
    const { offsets, laneTop, visibleStartTick, visibleEndTick } = virtual;
    const fieldGroundHeight = Math.max(offsets.at(-1)!, view.height - RULER_HEIGHT);
    /*
     * A lane with an inline roll open is a SECOND VIEWPORT on its own axis, and
     * it draws its own playhead there. The Song's line is masked out across it
     * rather than crossing it at the Song's pixels, which would put two "now"
     * markers in one box pointing at two different places (F1).
     */
    const playheadGaps = arrangement.tracks.flatMap((track, index) => {
        const trackId = track.id ?? track.ref;
        return expandedPianoRolls[trackId] ? [{ top: offsets[index]!, height: laneHeights[trackId] ?? 72 }] : [];
    });
    const firstLane = pinnedTrackIndices.length ? Math.min(virtual.firstLane, ...pinnedTrackIndices) : virtual.firstLane;
    const lastLane = pinnedTrackIndices.length ? Math.max(virtual.lastLane, ...pinnedTrackIndices.map((index) => index + 1)) : virtual.lastLane;

    return (
        <div className={`arrangement-surface song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="arrangement" data-keymap-surface="arrangement" data-song-node={songNodeId ?? 'song'} tabIndex={-1} role="region" aria-label="Arrangement" hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active} style={{ '--arrangement-header-width': `${headerWidth}px` } as CSSProperties}>
            <SkyBand fieldWidth={fieldViewportWidth} />
            <div className="arrangement-header-resize" role="separator" aria-orientation="vertical" aria-label="Resize track headers" tabIndex={0} style={{ left: headerWidth }} onPointerDown={(event) => { if (event.button !== 0) return; const startX = event.clientX; const before = headerWidth; const cleanup = ownPointerGesture(event.pointerId, { move(move) { useTrackLaneViewStore.getState().setHeaderWidth(before + move.clientX - startX); }, commit() { cleanup(); }, abort() { useTrackLaneViewStore.getState().setHeaderWidth(before); cleanup(); } }); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners own completion. */ } }} />
            <div
                className="arrangement-scroll"
                ref={scrollRef}
                onScroll={(event) => {
                    const target = event.currentTarget;
                    /*
                     * ONE call, and every scroll-synchronous element moves in
                     * it: the overlay pane's origin (which carries the playhead
                     * LINE, the ghost, the readout, the hairline and the
                     * marquee) and the ruler's playhead CAP.
                     */
                    writeScrollTransforms();
                    target.classList.add('is-scrolling');
                    if (scrollbarFade.current !== null) window.clearTimeout(scrollbarFade.current);
                    scrollbarFade.current = window.setTimeout(() => target.classList.remove('is-scrolling'), 200);
                    scheduleViewportWrite();
                }}
            >
                <div
                    className="arrangement-timeline-content"
                    style={{ width: headerWidth + contentWidth, minHeight: RULER_HEIGHT + offsets.at(-1)! + view.height * 0.4 }}
                    onPointerDown={(event) => {
                        useEditingContextStore.setState({ followPlayhead: false });
                        /*
                         * The lane's own ground, and nothing else.
                         *
                         * A clip has always been excluded here — its gesture owns
                         * the press. The INLINE PIANO ROLL had not been: it renders
                         * INSIDE `.arrangement-lane` in place of the clips, and its
                         * elements are not `.arrangement-clip`, so every press on a
                         * note also started this range-select. The roll's own
                         * gesture ran first and set `noteIds`; this one finished
                         * last and overwrote the surface selection with a
                         * `timeRange` (or, on a click, cleared it) — and because
                         * every roll keyboard action begins `if
                         * (!selectedNoteIds.length) return`, transpose, velocity,
                         * nudge, duplicate and delete all went dead the moment a
                         * pointer touched a note. The FULL roll surface was never
                         * affected, which is exactly the tell (W6-E2E finding F4).
                         *
                         * An editor open in a lane owns its own pointers. Spec §9:
                         * the inline lane and the surface are the same component,
                         * and it "never gets a second interaction model".
                         */
                        if (event.button !== 0 || !(event.target as HTMLElement).closest('.arrangement-lane') || (event.target as HTMLElement).closest('.arrangement-clip, .piano-roll')) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const lane = (event.target as HTMLElement).closest<HTMLElement>('.arrangement-lane')!;
                        const laneRect = lane.getBoundingClientRect();
                        const trackId = lane.closest<HTMLElement>('[data-track-id]')?.dataset.trackId ?? '';
                        const context = useEditingContextStore.getState();
                        const step = gridTicks(context.gridUnit, tb.ticksPerBeat, tb.ticksPerBar, viewport.pxPerTick);
                        const anchors = arrangement.tracks.flatMap((track) => track.clips.flatMap((clip) => [clip.startTick, clip.startTick + clip.lengthTick])).concat((arrangement.locations ?? []).flatMap((location) => [location.startTick, ...(location.endTick == null ? [] : [location.endTick])]));
                        const tickAt = (clientX: number) => {
                            const rawTick = Math.max(0, (clientX - rect.left - headerWidth) / viewport.pxPerTick);
                            const result = snapTimeline({ rawTick, gridUnitTicks: step, anchorTicks: anchors, pxPerTick: viewport.pxPerTick, mode: context.snapMode, target: context.snapTarget });
                            context.setSnapIndicatorTick(result.indicatorTick);
                            return result.tick;
                        };
                        const tick = tickAt(event.clientX);
                        if (context.viewports.arrangement.tool === 'draw') {
                            if (event.detail > 1) return;
                            const pointerId = event.pointerId;
                            const element = event.currentTarget;
                            const move = (nativeEvent: PointerEvent) => {
                                const start = drawStart.current;
                                if (!start) return;
                                const endTick = tickAt(nativeEvent.clientX);
                                setDrawGhost({ x: headerWidth + Math.min(start.startTick, endTick) * viewport.pxPerTick, y: laneRect.top - rect.top, width: Math.max(2, Math.abs(endTick - start.startTick) * viewport.pxPerTick), height: laneRect.height });
                            };
                            const finish = (nativeEvent: PointerEvent, commit: boolean) => {
                                const start = drawStart.current;
                                if (!start) return;
                                const endTick = tickAt(nativeEvent.clientX);
                                const dragged = Math.abs(nativeEvent.clientX - event.clientX) >= 4;
                                start.cleanup();
                                drawStart.current = null;
                                setDrawGhost(null);
                                context.setSnapIndicatorTick(null);
                                if (!commit) return;
                                const startTick = dragged ? Math.min(start.startTick, endTick) : start.startTick;
                                const lengthTick = dragged ? Math.max(1, Math.abs(endTick - start.startTick)) : tb.ticksPerBar;
                                const result = createClip(useArrangementStore.getState().arrangement!, start.trackId, startTick, lengthTick, useArrangementStore.getState().mintId);
                                useArrangementStore.getState().apply(result.verbs);
                                context.setSelection('arrangement', { clipIds: result.selectedClipIds ?? [] });
                            };
                            drawStart.current = { pointerId, trackId, startTick: tick, element, cleanup: () => undefined };
                            drawStart.current.cleanup = ownPointerGesture(pointerId, { move, commit: (nativeEvent) => finish(nativeEvent, true), abort: (nativeEvent) => finish(nativeEvent ?? new PointerEvent('pointercancel', { pointerId }), false) }, 'arrangement');
                            setDrawGhost({ x: headerWidth + tick * viewport.pxPerTick, y: laneRect.top - rect.top, width: Math.max(2, tb.ticksPerBar * viewport.pxPerTick), height: laneRect.height });
                            try { element.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ }
                            return;
                        }
                        const mode = event.altKey ? 'object' : 'range';
                        const exactExtend = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
                        const exactToggle = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
                        context.beginSelectionOp('arrangement');
                        const pointerId = event.pointerId;
                        const element = event.currentTarget;
                        const move = (nativeEvent: PointerEvent) => {
                            const start = marqueeStart.current;
                            if (!start) return;
                            const dx = nativeEvent.clientX - start.clientX;
                            const dy = nativeEvent.clientY - start.clientY;
                            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                            if (start.mode === 'range') tickAt(nativeEvent.clientX);
                            setMarquee({ x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), width: Math.abs(dx), height: Math.abs(dy), mode: start.mode });
                        };
                        const finish = (nativeEvent: PointerEvent, commit: boolean) => {
                            const start = marqueeStart.current;
                            if (!start) return;
                            const dx = nativeEvent.clientX - start.clientX;
                            const dy = nativeEvent.clientY - start.clientY;
                            if (commit && start.mode === 'range') {
                            const endTick = tickAt(nativeEvent.clientX);
                            const top = Math.min(start.clientY, nativeEvent.clientY);
                            const bottom = Math.max(start.clientY, nativeEvent.clientY);
                            const crossed = [...element.querySelectorAll<HTMLElement>('[data-track-id]')].filter((item) => { const itemRect = item.getBoundingClientRect(); return itemRect.top < bottom + 1 && itemRect.bottom > top - 1; }).map((item) => item.dataset.trackId!).filter(Boolean);
                            const trackIds = crossed.length ? [...new Set(crossed)] : [start.trackId];
                            const previous = context.viewports.arrangement.selection.timeRange;
                            const fromTick = start.add && previous ? Math.min(previous.fromTick, start.tick, endTick) : Math.min(start.tick, endTick);
                            const toTick = start.add && previous ? Math.max(previous.toTick, start.tick, endTick) : Math.max(start.tick, endTick);
                            if (toTick > fromTick) context.setSelection('arrangement', { timeRange: { fromTick, toTick, trackIds: start.add && previous ? [...new Set([...previous.trackIds, ...trackIds])] : trackIds } });
                            else if (!start.add) context.clearSelection('arrangement');
                            } else if (commit && start.mode === 'object' && Math.hypot(dx, dy) >= 4) {
                            const left = Math.min(start.clientX, nativeEvent.clientX);
                            const top = Math.min(start.clientY, nativeEvent.clientY);
                            const right = Math.max(start.clientX, nativeEvent.clientX);
                            const bottom = Math.max(start.clientY, nativeEvent.clientY);
                            const hits = [...element.querySelectorAll<HTMLElement>('[data-clip-id]')].filter((item) => { const itemRect = item.getBoundingClientRect(); return itemRect.left < right && itemRect.right > left && itemRect.top < bottom && itemRect.bottom > top; }).map((item) => item.dataset.clipId!);
                            const current = context.viewports.arrangement.selection.clipIds;
                            const clipIds = start.toggle ? [...new Set([...current.filter((id) => !hits.includes(id)), ...hits.filter((id) => !current.includes(id))])] : start.add ? [...new Set([...current, ...hits])] : hits;
                            context.setSelection('arrangement', { clipIds });
                            } else if (commit && !start.add) context.clearSelection('arrangement');
                        start.cleanup();
                        marqueeStart.current = null;
                        setMarquee(null);
                            context.setSnapIndicatorTick(null);
                            if (commit) context.commitSelectionOp('arrangement'); else context.abortSelectionOp('arrangement');
                        };
                        marqueeStart.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, pointerId, add: exactExtend, toggle: exactToggle, mode, tick, trackId, cleanup: () => undefined, element };
                        marqueeStart.current.cleanup = ownPointerGesture(pointerId, { move, commit: (nativeEvent) => finish(nativeEvent, true), abort: (nativeEvent) => finish(nativeEvent ?? new PointerEvent('pointercancel', { pointerId }), false) }, 'arrangement');
                        try { element.setPointerCapture(pointerId); } catch { /* Window listeners own completion. */ }
                    }}
                >
                    <RulerStack fieldWidth={fieldViewportWidth} contentWidth={contentWidth} scrollLeft={view.left} scrollRef={scrollRef} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} snapOn={snapMode === 'magnetic'} sections={sections} songEnd={lengthTicks} loop={loop} punch={punch} onToggleSnap={() => useEditingContextStore.getState().toggleSnap()} />
                    {/*
                     * The PAPER runs to the bottom of the window, not to the last
                     * lane. Ending it at `offsets.at(-1)` left ~400px of bare
                     * `--bg-canvas` under the tracks — a faint seam in light, a
                     * hard black band in dark that reads as an unfinished render
                     * (W4-TB-REVIEW §8.2). The lanes still end where the tracks
                     * end; only the ground and the past-end wash continue.
                     */}
                    <div className="arrangement-field-ground" aria-hidden="true" style={{ width: contentWidth, height: fieldGroundHeight }} />
                    <div className="arrangement-song-end" aria-hidden="true" style={{ left: headerWidth + lengthTicks * viewport.pxPerTick, width: Math.max(0, contentWidth - lengthTicks * viewport.pxPerTick), height: fieldGroundHeight }} />
                    <div className="arrangement-grid-anchor" style={{ transform: `translate3d(${view.left}px,${view.top}px,0)` }}>
                        <GridLayer width={fieldViewportWidth} height={Math.max(1, Math.min(view.height - RULER_HEIGHT, offsets.at(-1)! - laneTop))} scrollLeft={view.left} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} sections={sections} />
                    </div>
                    <div className="arrangement-lanes" role="list" aria-label="Tracks" style={{ paddingTop: offsets[firstLane], height: offsets.at(-1) }}>
                        {arrangement.tracks.slice(firstLane, lastLane).map((track, offset) => <TrackLaneView key={track.id ?? track.ref} track={track} arrangement={arrangement} index={firstLane + offset} pxPerTick={viewport.pxPerTick} visibleStartTick={visibleStartTick} visibleEndTick={visibleEndTick} />)}
                    </div>
                </div>
            </div>
            {/*
             * THE FIELD OVERLAY PANE (spec 2.2 / 8.2). Every transient thing the
             * field draws lives in here and nowhere else, because the one rule
             * they share is not a z-index — it is a boundary: above the clips,
             * never on the chrome. See `.arrangement-field-overlay` for why the
             * stacking order cannot say that and a clip can.
             */}
            <div className="arrangement-field-overlay" data-field-overlay style={{ left: headerWidth, width: fieldViewportWidth, height: Math.max(0, view.height - RULER_HEIGHT) }}>
                <div className="arrangement-field-overlay__origin" ref={overlayOriginRef}>
                    {loop?.endTick != null && <div className="arrangement-loop-wash" aria-hidden="true" style={{ left: headerWidth + loop.startTick * viewport.pxPerTick, width: (loop.endTick - loop.startTick) * viewport.pxPerTick, height: offsets.at(-1) }} />}
                    {viewport.selection.timeRange && <div className="arrangement-range-selection" aria-label={`Time selection ${Math.round(viewport.selection.timeRange.fromTick)} to ${Math.round(viewport.selection.timeRange.toTick)}`} style={{ left: headerWidth + viewport.selection.timeRange.fromTick * viewport.pxPerTick, width: (viewport.selection.timeRange.toTick - viewport.selection.timeRange.fromTick) * viewport.pxPerTick, height: offsets.at(-1) }}>
                        {/* A range names itself at both edges, so it is legible without measuring. */}
                        <span>{formatBarBeat(tb, viewport.selection.timeRange.fromTick)}</span>
                        <span>{formatBarBeat(tb, viewport.selection.timeRange.toTick)}</span>
                    </div>}
                    {snapIndicatorTick !== null && <div className="arrangement-snap-indicator" aria-hidden="true" style={{ transform: `translate3d(${headerWidth + snapIndicatorTick * viewport.pxPerTick}px,0,0)`, height: offsets.at(-1) }} />}
                    <PlayheadLayer pxPerTick={viewport.pxPerTick} scrollRef={scrollRef} height={offsets.at(-1)!} gaps={playheadGaps} />
                    {marquee && <div className={`arrangement-marquee${marquee.mode === 'range' ? ' is-range' : ''}`} aria-hidden="true" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
                    {drawGhost && <div className="arrangement-clip arrangement-clip--draw" data-draw-ghost aria-hidden="true" style={{ left: drawGhost.x, top: drawGhost.y, width: drawGhost.width, height: drawGhost.height }} />}
                </div>
                <div className="arrangement-field-overlay__surface">
                    <DragGhostLayer bounds={{ left: headerWidth, top: SKY_HEIGHT + RULER_HEIGHT, right: headerWidth + fieldViewportWidth, bottom: SKY_HEIGHT + RULER_HEIGHT + Math.max(0, view.height - RULER_HEIGHT) }} />
                </div>
            </div>
            {mixerOpen && <MixerDrawer />}
            {timePrompt && <form className="arrangement-time-prompt" aria-label={`${timePrompt === 'insert' ? 'Insert' : 'Delete'} time`} onSubmit={(event) => {
                event.preventDefault();
                const current = useArrangementStore.getState();
                const arr = current.arrangement;
                if (!arr) return;
                const timing = timebase(arr);
                const duration = parseMusicalDuration(timeAmount, timing.ticksPerBeat, timing.ticksPerBar);
                if (!duration) { setTimeError('Use an amount like “2 bars” or “3 beats”.'); return; }
                const editing = useEditingContextStore.getState();
                const selected = editing.viewports.arrangement.selection.trackIds;
                const trackIds = timeScope === 'selected-tracks' && selected.length ? selected : arr.tracks.map((track) => track.id ?? track.ref);
                const range = editing.viewports.arrangement.selection.timeRange;
                const from = range?.fromTick ?? current.playheadTick;
                const to = range?.toTick ?? from + duration;
                current.apply(timePrompt === 'insert' ? insertTime(arr, from, duration, trackIds).verbs : deleteTime(arr, from, to, trackIds).verbs);
                setTimePrompt(null);
            }}>
                <strong>{timePrompt === 'insert' ? 'Open space' : 'Close time'}</strong>
                <label>Amount<input autoFocus value={timeAmount} onChange={(event) => setTimeAmount(event.target.value)} placeholder="1 bar" /></label>
                <label>Tracks<select value={timeScope} onChange={(event) => setTimeScope(event.target.value as typeof timeScope)}><option value="selected-tracks">Selected tracks</option><option value="all">All tracks</option></select></label>
                {timeError && <span role="alert">{timeError}</span>}
                <div><button type="button" onClick={() => setTimePrompt(null)}>Cancel</button><button type="submit">{timePrompt === 'insert' ? 'Insert' : 'Delete'}</button></div>
            </form>}
        </div>
    );
}
