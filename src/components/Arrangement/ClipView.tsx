import { useEffect, useRef, useState } from 'react';
import type { ArrangementClip, Source } from '../../song/types';
import { getWaveform } from '../../store/libraryStore';
import { base64ToPeaks } from '../../utils/audioMetadata';
import type { PitchRange } from '../../store/trackLaneViewStore';
import { clipBarSpan, clipGeometry } from './geometry';
import { paintClipCanvas } from './clipPaint';
import { WaveformCanvas } from '@openjammer/oj-ui';
import { useClipGesture } from './useClipGesture';
import type { Timebase } from '../../song/time';

export function ClipView({
    clip,
    source,
    trackName,
    range,
    pxPerTick,
    laneHeight,
    selected,
    faulted = false,
    takeCount = 1,
    onSelect,
    trackId,
    onDoubleClick,
    timebase,
}: {
    clip: ArrangementClip;
    source: Source;
    trackName: string;
    range: PitchRange;
    pxPerTick: number;
    laneHeight: number;
    selected: boolean;
    /** A plugin feeding this track is benched. The sound holds; the clip says so. */
    faulted?: boolean;
    takeCount?: number;
    onSelect: (event: React.PointerEvent, phase: 'press' | 'release') => void;
    trackId: string;
    onDoubleClick?: () => void;
    timebase: Timebase;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [peaks, setPeaks] = useState<Float32Array | null>(null);
    const geometry = clipGeometry(clip.startTick, clip.lengthTick, 0, pxPerTick);
    const height = laneHeight - 8;
    const gesture = useClipGesture(clip, trackId, pxPerTick, geometry.width, height, onSelect);
    useEffect(() => {
        let live = true;
        if (source.kind === 'audio') {
            void getWaveform(source.assetId).then((encoded) => {
                if (live && encoded) {
                    const legacy = base64ToPeaks(encoded);
                    const interleaved = new Float32Array(legacy.length * 2);
                    legacy.forEach((peak, index) => { interleaved[index * 2] = -Math.abs(peak); interleaved[index * 2 + 1] = Math.abs(peak); });
                    setPeaks(interleaved);
                }
            });
        }
        return () => { live = false; };
    }, [source]);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas && source.kind === 'midi') paintClipCanvas(canvas, source, clip, geometry.width, height, range);
    }, [source, clip, geometry.width, height, range, peaks]);
    const noteCount = source.kind === 'midi' ? source.notes.length : 0;
    const { startBar, endBar } = clipBarSpan(timebase, clip.startTick, clip.lengthTick);
    return (
        <button
            type="button"
            className={`arrangement-clip${selected ? ' is-selected' : ''}${clip.mute ? ' is-muted' : ''}${clip.locked ? ' is-locked' : ''}${faulted ? ' is-faulted' : ''}${gesture.dragging ? ' is-dragging' : ''}`}
            style={{ left: geometry.left, width: geometry.width, height }}
            onPointerDown={gesture.onPointerDown}
            onPointerCancel={gesture.onPointerCancel}
            onClick={(event) => onSelect(event as unknown as React.PointerEvent, 'release')}
            onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick?.(); }}
            role="listitem"
            data-clip-id={clip.id}
            aria-label={`${trackName} — bars ${startBar} to ${endBar}, ${noteCount} notes${clip.mute ? ', muted' : ''}`}
        >
            {geometry.width >= 36 && laneHeight >= 30 && <span className="arrangement-clip__name">{faulted && <i className="arrangement-clip__fault" aria-hidden="true">⚠</i>}<span>{clip.name ?? source.name}</span></span>}
            {takeCount > 1 && <span className="arrangement-clip__take" aria-label={`${takeCount} stacked takes`}>×{takeCount}</span>}
            {source.kind === 'midi' ? <canvas ref={canvasRef} className="arrangement-clip__canvas" role="img" aria-label={`midi content for ${clip.name ?? source.name}`} /> : <WaveformCanvas peaks={peaks} width={geometry.width} height={Math.max(1, height - (geometry.width >= 36 && laneHeight >= 30 ? 18 : 0))} gain={clip.gain} className="arrangement-clip__waveform" label={`audio content for ${clip.name ?? source.name}`} />}
            {selected && <><span className="arrangement-clip__handle is-left" /><span className="arrangement-clip__handle is-right" /></>}
        </button>
    );
}
