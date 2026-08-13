import { ProgressBar } from '@openjammer/oj-ui';

export const Tones = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', width: 280 }}>
        <ProgressBar value={0.3} aria-label="Neutral progress" />
        <ProgressBar value={0.6} tone="success" aria-label="Success progress" />
        <ProgressBar value={0.5} tone="warning" aria-label="Warning progress" />
        <ProgressBar value={0.8} tone="danger" aria-label="Danger progress" />
    </div>
);

export const Levels = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', width: 280 }}>
        <ProgressBar value={0} aria-label="Empty" />
        <ProgressBar value={0.25} aria-label="Quarter" />
        <ProgressBar value={0.5} aria-label="Half" />
        <ProgressBar value={1} aria-label="Full" />
        {/* max other than 1: 7 of 10 steps complete */}
        <ProgressBar value={7} max={10} tone="success" aria-label="7 of 10" />
    </div>
);
