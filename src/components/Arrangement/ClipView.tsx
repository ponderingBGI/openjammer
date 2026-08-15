import { useEffect, useRef, useState } from 'react';
import type { ArrangementClip, Source } from '../../song/types';
import { getWaveform } from '../../store/libraryStore';
import { base64ToPeaks } from '../../utils/audioMetadata';
import type { PitchRange } from '../../store/trackLaneViewStore';
import { clipGeometry } from './geometry';
import { WaveformCanvas } from '@openjammer/oj-ui';
import { useClipGesture } from './useClipGesture';

function paintCanvas(
    canvas: HTMLCanvasElement,
    source: Source,
    clip: ArrangementClip,
    width: number,
    height: number,
    range: PitchRange,
) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.ceil(width * ratio));
    canvas.height = Math.max(1, Math.ceil(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const styles = getComputedStyle(canvas);
    context.clearRect(0, 0, width, height);
    if (source.kind === 'midi') {
        const sourceStart = clip.sourceStart ?? 0;
        const sourceEnd = sourceStart + clip.lengthTick;
        const notes = source.notes.filter((note) => note.tick + note.durTick > sourceStart && note.tick < sourceEnd);
        const bodyTop = width >= 36 && height >= 30 ? 20 : 4;
        const available = Math.max(2, height - bodyTop - 4);
        const span = Math.max(1, range.hi - range.lo);
        for (const note of notes) {
            const x = Math.max(0, (note.tick - sourceStart) / clip.lengthTick * width);
            const noteWidth = Math.max(1, note.durTick / clip.lengthTick * width);
            const y = bodyTop + (range.hi - note.pitch) / span * available;
            const noteHeight = Math.max(2, Math.min(4, available / span));
            context.globalAlpha = 0.55 + 0.45 * (note.vel ?? 96) / 127;
            context.fillStyle = styles.getPropertyValue('--timeline-note-fill');
            context.fillRect(x, y, noteWidth, noteHeight);
        }
        context.globalAlpha = 1;
        return;
    }
}

export function ClipView({
    clip,
    source,
    trackName,
    range,
    pxPerTick,
    laneHeight,
    selected,
    onSelect,
    trackId,
}: {
    clip: ArrangementClip;
    source: Source;
    trackName: string;
    range: PitchRange;
    pxPerTick: number;
    laneHeight: number;
    selected: boolean;
    onSelect: (event: React.PointerEvent, phase: 'press' | 'release') => void;
    trackId: string;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [peaks, setPeaks] = useState<Float32Array | null>(null);
    const geometry = clipGeometry(clip.startTick, clip.lengthTick, 0, pxPerTick);
    const height = laneHeight - 8;
    const gesture = useClipGesture(clip, trackId, pxPerTick, geometry.width, onSelect);
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
        if (canvas && source.kind === 'midi') paintCanvas(canvas, source, clip, geometry.width, height, range);
    }, [source, clip, geometry.width, height, range, peaks]);
    const noteCount = source.kind === 'midi' ? source.notes.length : 0;
    const startBar = Math.floor(clip.startTick / 3840) + 1;
    const endBar = Math.ceil((clip.startTick + clip.lengthTick) / 3840) + 1;
    return (
        <button
            type="button"
            className={`arrangement-clip${selected ? ' is-selected' : ''}${clip.mute ? ' is-muted' : ''}${gesture.dragging ? ' is-dragging' : ''}`}
            style={{ left: geometry.left, width: geometry.width, height }}
            onPointerDown={gesture.onPointerDown}
            onPointerCancel={gesture.onPointerCancel}
            onClick={(event) => onSelect(event as unknown as React.PointerEvent, 'release')}
            role="listitem"
            data-clip-id={clip.id}
            aria-label={`${trackName} — bars ${startBar} to ${endBar}, ${noteCount} notes${clip.mute ? ', muted' : ''}`}
        >
            {geometry.width >= 36 && laneHeight >= 30 && <span className="arrangement-clip__name">{clip.name ?? source.name}</span>}
            {source.kind === 'midi' ? <canvas ref={canvasRef} className="arrangement-clip__canvas" role="img" aria-label={`midi content for ${clip.name ?? source.name}`} /> : <WaveformCanvas peaks={peaks} width={geometry.width} height={Math.max(1, height - (geometry.width >= 36 && laneHeight >= 30 ? 18 : 0))} gain={clip.gain} className="arrangement-clip__waveform" label={`audio content for ${clip.name ?? source.name}`} />}
            {selected && <><span className="arrangement-clip__handle is-left" /><span className="arrangement-clip__handle is-right" /></>}
        </button>
    );
}
