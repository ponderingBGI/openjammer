import type { ReactNode } from 'react';
import { WaveformCanvas } from '@openjammer/oj-ui';

/**
 * `peaks` is a flat min/max pair list: [min0, max0, min1, max1, …], each in -1..1.
 * This is the shape the clip renderer stores per audio clip.
 */
function makePeaks(bins: number, envelope: (t: number) => number) {
    const out = new Float32Array(bins * 2);
    for (let i = 0; i < bins; i++) {
        const t = i / (bins - 1);
        const amp = envelope(t) * (0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 9)));
        out[i * 2] = -amp;
        out[i * 2 + 1] = amp;
    }
    return out;
}

/** A four-bar drum loop: each bar hits hard then decays. */
const loop = makePeaks(160, (t) => {
    const inBar = (t * 4) % 1;
    return Math.min(1, 0.85 * Math.exp(-inBar * 3.2) + 0.12);
});

/** A vocal take — a long swell that tails off. */
const take = makePeaks(160, (t) => Math.sin(t * Math.PI) * 0.8 + 0.05);

const clip = (caption: string, children: ReactNode) => (
    <div style={{ marginBottom: 'var(--space-md)' }}>
        <div
            style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-xs)',
            }}
        >
            {caption}
        </div>
        <div
            style={{
                width: 300,
                padding: 'var(--space-xs)',
                background: 'var(--timeline-clip-bg)',
                border: '1px solid var(--timeline-clip-border)',
                borderRadius: 'var(--radius-sm)',
            }}
        >
            {children}
        </div>
    </div>
);

export const Peaks = () => (
    <div>
        {clip('drum loop — 4 bars', <WaveformCanvas peaks={loop} width={292} height={56} label="Drum loop waveform" />)}
        {clip('vocal take — one swell', <WaveformCanvas peaks={take} width={292} height={56} label="Vocal take waveform" />)}
    </div>
);

/** `gain` scales the drawn peaks; anything reaching full scale is drawn in the danger color. */
export const Gain = () => (
    <div>
        {clip('gain 1 — as recorded', <WaveformCanvas peaks={take} width={292} height={48} gain={1} label="Take at unity gain" />)}
        {clip('gain 2.5 — clipped bins turn red', <WaveformCanvas peaks={take} width={292} height={48} gain={2.5} label="Take boosted past full scale" />)}
    </div>
);

/** No peaks yet (still decoding, or an offline clip): a diagonal hatch stands in. */
export const Missing = () => (
    <div>
        {clip('peaks unavailable', <WaveformCanvas width={292} height={56} label="Waveform peaks unavailable" />)}
    </div>
);
