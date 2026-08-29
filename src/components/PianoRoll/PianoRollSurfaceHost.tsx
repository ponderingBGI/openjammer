import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { arrangementLengthTicks, timebase } from '../../song/time';
import { RulerStack } from '../Arrangement/RulerStack';
import { SkyBand } from '../Arrangement/SkyBand';
import { PianoRollSurface, SURFACE_GUTTER } from './PianoRoll';
import { applyPianoRollQuantize, auditionPianoRollNote } from './actions';

/*
 * The ruler's corner is exactly the roll's key-bed gutter, so bar 1's tick sits
 * on tick 0 of the notes. With the arrangement's 200px corner it sat 124px to
 * the right — a ruled surface whose ruler measured the wrong place.
 */
const HEADER_WIDTH = SURFACE_GUTTER;
/*
 * Everything this host paints ABOVE the roll: sky band 56 + ruler 64 + the
 * clip-bracket strip 18. The roll gets the rest exactly, so its velocity lane
 * lands on the bottom edge instead of hanging off it.
 */
const CHROME_ABOVE_ROLL = 56 + 64 + 18;

export function PianoRollSurfaceHost({ active, visible = active, transition }: { active: boolean; visible?: boolean; transition?: 'in' | 'out' }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const clipId = useUiViewStore((state) => state.pianoRollClipId);
    const viewport = useEditingContextStore((state) => state.viewports.pianoroll);
    const gridUnit = useEditingContextStore((state) => state.gridUnit);
    const snapMode = useEditingContextStore((state) => state.snapMode);
    const rootRef = useRef<HTMLDivElement>(null);
    const [hostSize, setHostSize] = useState({ width: 1000, height: 700 });
    const track = arrangement?.tracks.find((item) => item.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((item) => item.id === clipId);
    const source = clip && arrangement?.sources?.[clip.sourceId];
    const width = hostSize.width;
    const wheelTicksPerBar = arrangement ? timebase(arrangement).ticksPerBar : 3840;
    const canRender = Boolean(arrangement && track && clip && source?.kind === 'midi' && clipId);

    useEffect(() => {
        if (!active) return;
        rootRef.current?.focus({ preventScroll: true });
        useEditingContextStore.setState({ enteredTrackId: track?.id ?? track?.ref ?? null, enteredClipId: clipId });
        return () => useEditingContextStore.setState({ enteredClipId: null });
    }, [active, clipId, track?.id, track?.ref]);
    useEffect(() => {
        const element = rootRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const measure = () => setHostSize({ width: element.clientWidth || 1000, height: element.clientHeight || 700 });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!canRender) return;
        const element = rootRef.current;
        if (!element) return;
        const onWheel = (event: WheelEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            event.preventDefault();
            useEditingContextStore.getState().zoomAt('pianoroll', Math.max(0, event.clientX - HEADER_WIDTH), Math.exp(-event.deltaY * .002), wheelTicksPerBar);
        };
        element.addEventListener('wheel', onWheel, { passive: false });
        return () => element.removeEventListener('wheel', onWheel);
    }, [canRender, wheelTicksPerBar]);
    if (!arrangement || !track || !clip || source?.kind !== 'midi' || !clipId) return null;
    const tb = timebase(arrangement);
    const fieldWidth = Math.max(1, width - HEADER_WIDTH);
    const contentWidth = Math.max(fieldWidth, arrangementLengthTicks(arrangement) * viewport.pxPerTick + fieldWidth * .25);
    const sections = (arrangement.locations ?? []).filter((location) => location.kind !== 'loop' && location.kind !== 'punch');
    const loop = (arrangement.locations ?? []).find((location) => location.kind === 'loop');
    const close = () => useUiViewStore.getState().closePianoRoll();

    return <div ref={rootRef} className={`arrangement-surface piano-roll-surface-host song-interior ${transition ? `surface-transition-${transition}` : ''}`} style={{ '--arrangement-header-width': `${HEADER_WIDTH}px` } as CSSProperties} data-surface-root="pianoroll" tabIndex={-1} role="region" aria-label={`Piano roll — ${track.name ?? track.ref}`} hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active} onKeyDownCapture={(event) => { if (event.key !== 'Escape') return; const target = event.target as HTMLElement; if (target.matches('input, select, textarea, [contenteditable="true"]')) { event.preventDefault(); event.stopPropagation(); target.blur(); } }}>
        <SkyBand fieldWidth={fieldWidth} />
        <RulerStack surface="pianoroll" fieldWidth={fieldWidth} contentWidth={contentWidth} scrollLeft={viewport.leftTick * viewport.pxPerTick} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} snapOn={snapMode === 'magnetic'} sections={sections} songEnd={arrangementLengthTicks(arrangement)} loop={loop} onToggleSnap={() => useEditingContextStore.getState().toggleSnap()} />
        <div className="piano-roll__clip-brackets" aria-label={`Clip bounds ${clip.startTick} to ${clip.startTick + clip.lengthTick}`}><i style={{ left: HEADER_WIDTH + (clip.startTick - viewport.leftTick) * viewport.pxPerTick }}>[</i><i style={{ left: HEADER_WIDTH + (clip.startTick + clip.lengthTick - viewport.leftTick) * viewport.pxPerTick }}>]</i></div>
        <PianoRollSurface trackId={track.id ?? track.ref} clipId={clipId} pxPerTick={viewport.pxPerTick} leftTick={viewport.leftTick} height={Math.max(320, hostSize.height - CHROME_ABOVE_ROLL)} onClose={close} onQuantize={applyPianoRollQuantize} onAudition={(pitch, velocity, phase) => auditionPianoRollNote(track.ref, pitch, velocity, phase)} />
    </div>;
}
