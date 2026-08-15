import { useEffect, useRef } from 'react';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useUiViewStore } from '../../store/uiViewStore';
import { arrangementLengthTicks, timebase } from '../../song/time';
import { RulerStack } from '../Arrangement/RulerStack';
import { TransportStrip } from '../Arrangement/TransportStrip';
import { PianoRollSurface } from './PianoRoll';
import { applyPianoRollQuantize, auditionPianoRollNote } from './actions';

const HEADER_WIDTH = 200;

export function PianoRollSurfaceHost({ active, visible = active, transition }: { active: boolean; visible?: boolean; transition?: 'in' | 'out' }) {
    const arrangement = useArrangementStore((state) => state.arrangement);
    const clipId = useUiViewStore((state) => state.pianoRollClipId);
    const viewport = useEditingContextStore((state) => state.viewports.pianoroll);
    const gridUnit = useEditingContextStore((state) => state.gridUnit);
    const snapMode = useEditingContextStore((state) => state.snapMode);
    const rootRef = useRef<HTMLDivElement>(null);
    const track = arrangement?.tracks.find((item) => item.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((item) => item.id === clipId);
    const source = clip && arrangement?.sources?.[clip.sourceId];
    const width = typeof window === 'undefined' ? 1000 : window.innerWidth;

    useEffect(() => {
        if (!active) return;
        rootRef.current?.focus({ preventScroll: true });
        useEditingContextStore.setState({ enteredTrackId: track?.id ?? track?.ref ?? null, enteredClipId: clipId });
        return () => useEditingContextStore.setState({ enteredClipId: null });
    }, [active, clipId, track?.id, track?.ref]);
    if (!arrangement || !track || !clip || source?.kind !== 'midi' || !clipId) return null;
    const tb = timebase(arrangement);
    const fieldWidth = Math.max(1, width - HEADER_WIDTH);
    const contentWidth = Math.max(fieldWidth, arrangementLengthTicks(arrangement) * viewport.pxPerTick + fieldWidth * .25);
    const sections = (arrangement.locations ?? []).filter((location) => location.kind === 'section');
    const loop = (arrangement.locations ?? []).find((location) => location.kind === 'loop');
    const close = () => useUiViewStore.getState().closePianoRoll();

    return <div ref={rootRef} className={`arrangement-surface piano-roll-surface-host song-interior ${transition ? `surface-transition-${transition}` : ''}`} data-surface-root="pianoroll" tabIndex={-1} role="region" aria-label={`Piano roll — ${track.name ?? track.ref}`} hidden={!visible} inert={!active ? true : undefined} aria-hidden={!active} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }} onWheel={(event) => { if (!(event.ctrlKey || event.metaKey)) return; event.preventDefault(); useEditingContextStore.getState().zoomAt('pianoroll', Math.max(0, event.clientX - HEADER_WIDTH), Math.exp(-event.deltaY * .002), tb.ticksPerBar); }}>
        <TransportStrip fieldWidth={fieldWidth} />
        <RulerStack fieldWidth={fieldWidth} contentWidth={contentWidth} scrollLeft={viewport.leftTick * viewport.pxPerTick} pxPerTick={viewport.pxPerTick} ticksPerBar={tb.ticksPerBar} beatsPerBar={tb.beatsPerBar} gridUnit={gridUnit} snapOn={snapMode === 'magnetic'} sections={sections} loop={loop} onSeek={(clientX) => useArrangementStore.getState().seek(viewport.leftTick + Math.max(0, clientX - HEADER_WIDTH) / viewport.pxPerTick)} onToggleSnap={() => useEditingContextStore.getState().toggleSnap()} />
        <div className="piano-roll__clip-brackets" aria-label={`Clip bounds ${clip.startTick} to ${clip.startTick + clip.lengthTick}`}><i style={{ left: HEADER_WIDTH + (clip.startTick - viewport.leftTick) * viewport.pxPerTick }}>[</i><i style={{ left: HEADER_WIDTH + (clip.startTick + clip.lengthTick - viewport.leftTick) * viewport.pxPerTick }}>]</i></div>
        <PianoRollSurface trackId={track.id ?? track.ref} clipId={clipId} pxPerTick={viewport.pxPerTick} leftTick={viewport.leftTick} height={Math.max(320, (typeof window === 'undefined' ? 700 : window.innerHeight) - 180)} onClose={close} onQuantize={applyPianoRollQuantize} onAudition={(pitch, velocity, phase) => auditionPianoRollNote(track.ref, pitch, velocity, phase)} />
    </div>;
}
