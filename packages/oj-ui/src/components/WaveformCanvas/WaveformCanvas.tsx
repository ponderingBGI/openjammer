import { useEffect, useRef } from 'react';
import './WaveformCanvas.css';

export interface WaveformCanvasProps {
    peaks?: Float32Array | null;
    width: number;
    height: number;
    gain?: number;
    className?: string;
    label: string;
}

export function WaveformCanvas({ peaks, width, height, gain = 1, className, label }: WaveformCanvasProps) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.ceil(width * ratio));
        canvas.height = Math.max(1, Math.ceil(height * ratio));
        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        const styles = getComputedStyle(canvas);
        if (!peaks?.length) {
            context.strokeStyle = styles.getPropertyValue('--timeline-clip-border');
            context.globalAlpha = 0.12;
            for (let x = -height; x < width + height; x += 6) { context.beginPath(); context.moveTo(x, height); context.lineTo(x + height, 0); context.stroke(); }
            context.globalAlpha = 1;
            return;
        }
        const center = height / 2;
        const count = Math.floor(peaks.length / 2);
        for (let x = 0; x < Math.ceil(width); x++) {
            const index = Math.min(count - 1, Math.floor(x / width * count)) * 2;
            const min = Math.max(-1, peaks[index]! * gain);
            const max = Math.min(1, peaks[index + 1]! * gain);
            const clipped = Math.abs(min) >= 0.999 || Math.abs(max) >= 0.999;
            context.fillStyle = styles.getPropertyValue(clipped ? '--accent-danger' : '--timeline-waveform-fill');
            if (Math.abs(max - min) < 0.0001) { context.globalAlpha = 0.5; context.fillRect(x, Math.round(center), 1, 1); context.globalAlpha = 1; }
            else { const top = center - max * (height - 8) / 2; const bottom = center - min * (height - 8) / 2; context.fillRect(x, top, 1, Math.max(1, bottom - top)); }
        }
    }, [peaks, width, height, gain]);
    return <canvas ref={ref} className={['oj-waveform-canvas', className].filter(Boolean).join(' ')} style={{ width, height }} role="img" aria-label={label} />;
}
