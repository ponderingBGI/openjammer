import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Arrangement } from '../../song/types';
import { WaveformCanvas } from '@openjammer/oj-ui';
import { useEditingContextStore } from '../../store/editingContextStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { getWaveform } from '../../store/libraryStore';
import { base64ToPeaks } from '../../utils/audioMetadata';
import { formatBarBeat, timebase, type Timebase } from '../../song/time';
import { initialPitchRange } from '../../store/trackLaneViewStore';
import { paintClipCanvas } from './clipPaint';
import { trackTint } from './trackTint';

/**
 * A DURATION in bars.beats.ticks — zero-based, unlike a POSITION.
 * `formatBarBeat` counts the first bar as 1, so reusing it for a delta would
 * report a nudge of zero as "1.1" and a two-bar move as "3.1". A distance and a
 * place are not the same number, and on a ruled surface they must never look
 * like one.
 */
function formatTickDelta(tb: Timebase, ticks: number): string {
    const bars = Math.floor(ticks / tb.ticksPerBar);
    const beats = Math.floor((ticks % tb.ticksPerBar) / tb.ticksPerBeat);
    const rest = Math.round(ticks % tb.ticksPerBeat);
    return rest === 0 ? `${bars}.${beats}` : `${bars}.${beats}.${rest}`;
}

/** The dragged clip, its track (for the tint) and its source, in one lookup. */
function locateClip(arrangement: Arrangement | null, clipId: string | undefined) {
    if (!arrangement || !clipId) return null;
    for (const track of arrangement.tracks) {
        const clip = track.clips.find((item) => item.id === clipId);
        if (clip) return { clip, track, source: arrangement.sources?.[clip.sourceId] };
    }
    return null;
}

/**
 * The drag ghost, and the readout that travels with it.
 *
 * Two rules from the spec's transient-overlay section decide everything here:
 *
 * 1. **The ghost carries the clip's real content.** An empty rectangle cannot
 *    confirm you grabbed the right part; the name bar and the notes (or the
 *    waveform) can, at a glance, mid-gesture. The original stays visible
 *    underneath at 35% so you can see what you are changing — that is what
 *    makes the undo you have not pressed yet feel safe.
 * 2. **The readout is exact, so it is mono.** `4.1.240 +1.2.0` — where the clip
 *    will land and how far it moved, both in bar.beat, both reproducible.
 *
 * Nothing here is a second interaction model: it reads the same
 * `clipDragPreview` the gesture already publishes and renders it.
 *
 * `bounds` is the field overlay pane in SURFACE coordinates. The ghost itself
 * is clipped by that pane — a ghost sliced at the header edge still reads,
 * because it is a rectangle you can see the rest of. The READOUT is different:
 * half a number is worse than a moved number, so it is clamped whole inside the
 * pane rather than cropped.
 */
export interface FieldBounds { left: number; top: number; right: number; bottom: number }

export function DragGhostLayer({ bounds }: { bounds?: FieldBounds }) {
    const preview = useEditingContextStore((state) => state.clipDragPreview);
    const arrangement = useArrangementStore((state) => state.arrangement);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const readoutRef = useRef<HTMLDivElement>(null);
    const [peaks, setPeaks] = useState<Float32Array | null>(null);

    const located = locateClip(arrangement, preview?.clipId);

    const source = located?.source;
    useEffect(() => {
        let live = true;
        if (source?.kind === 'audio') {
            void getWaveform(source.assetId).then((encoded) => {
                if (!live || !encoded) return;
                const legacy = base64ToPeaks(encoded);
                const interleaved = new Float32Array(legacy.length * 2);
                legacy.forEach((peak, index) => { interleaved[index * 2] = -Math.abs(peak); interleaved[index * 2 + 1] = Math.abs(peak); });
                setPeaks(interleaved);
            });
        }
        return () => { live = false; };
    }, [source]);

    const width = preview?.width ?? 0;
    const height = preview?.height ?? 0;
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !located || located.source?.kind !== 'midi' || width <= 0 || height <= 0) return;
        const notes = located.source.notes;
        const lo = notes.reduce((value, note) => Math.min(value, note.pitch), Infinity);
        const hi = notes.reduce((value, note) => Math.max(value, note.pitch), -Infinity);
        paintClipCanvas(canvas, located.source, located.clip, width, height, initialPitchRange(lo, hi));
    }, [located, width, height]);

    /*
     * The readout is placed after layout because its width is its TEXT: a
     * `12.4.480 +3.2.240` chip and a `±0` chip cannot be clamped by the same
     * constant, and a guessed constant would either crop the long one or park
     * the short one early. One measurement per drag frame, on a frame the
     * browser was going to lay out anyway.
     */
    useLayoutEffect(() => {
        const element = readoutRef.current;
        if (!element || !preview) return;
        const x = preview.x + 14;
        const y = preview.y + 16;
        if (!bounds) { element.style.transform = `translate3d(${x}px, ${y}px, 0)`; return; }
        const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
        element.style.transform = `translate3d(${clamp(x, bounds.left + 8, bounds.right - 8 - element.offsetWidth)}px, ${clamp(y, bounds.top + 8, bounds.bottom - 8 - element.offsetHeight)}px, 0)`;
    });

    if (!preview || !arrangement) return <div className="arrangement-drag-ghost-layer" aria-hidden="true" />;

    const tb = timebase(arrangement);
    const delta = preview.tick - preview.originTick;
    const sign = delta === 0 ? '' : delta > 0 ? '+' : '−';
    const invalid = preview.locked;
    const name = located?.clip.name ?? (located?.source?.kind ? located.source.name : undefined);
    const showBody = width >= 36 && height >= 30;

    return (
        <div className="arrangement-drag-ghost-layer" aria-hidden="true">
            <div
                className={`arrangement-drag-ghost${invalid ? ' is-invalid' : ''}`}
                data-drag-ghost
                data-clip-id={preview.clipId}
                data-hovered-track-id={preview.hoveredTrackId}
                data-copy={preview.copy ? 'true' : 'false'}
                style={{
                    width: preview.width,
                    height: preview.height,
                    '--track-tint': located ? trackTint(located.track) : undefined,
                    transform: `translate3d(${preview.x - preview.width / 2}px, ${preview.y - preview.height / 2}px, 0)`,
                } as CSSProperties}
            >
                {showBody && name && <span className="arrangement-clip__name"><span>{name}</span></span>}
                {located?.source?.kind === 'midi'
                    ? <canvas ref={canvasRef} className="arrangement-clip__canvas" />
                    : located?.source?.kind === 'audio'
                        ? <WaveformCanvas peaks={peaks} width={preview.width} height={Math.max(1, preview.height - (showBody ? 18 : 0))} gain={located.clip.gain} className="arrangement-clip__waveform" label="" />
                        : null}
            </div>
            <div
                ref={readoutRef}
                className={`arrangement-drag-readout${invalid ? ' is-invalid' : ''}`}
            >
                {invalid ? <span>locked</span> : <>
                    <span>{formatBarBeat(tb, Math.max(0, preview.tick))}</span>
                    <b>{delta === 0 ? '±0' : `${sign}${formatTickDelta(tb, Math.abs(delta))}`}</b>
                </>}
            </div>
        </div>
    );
}
