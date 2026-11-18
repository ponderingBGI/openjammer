import { useEffect, useRef } from 'react';
import type { Story } from '@ladle/react';
import { Meter, type MeterHandle } from './Meter';

export default { title: 'Canvas/Meter' };

/** A gentle synthetic level so the catalogue shows a meter doing its job. */
function Driven({ bars, height, peak = 0.8, label }: { bars?: number; height?: number; peak?: number; label?: string }) {
    const handle = useRef<MeterHandle>(null);
    useEffect(() => {
        let raf = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const t = (now - start) / 1000;
            const value = Math.max(0, peak * (0.55 + 0.45 * Math.sin(t * 2.1)) * (0.7 + 0.3 * Math.sin(t * 7.3)));
            handle.current?.setSignal(value);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [peak]);
    return <Meter ref={handle} bars={bars} height={height} label={label} />;
}

export const Live: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-xl)', alignItems: 'flex-end' }}>
        <Driven label="Master level" />
        <Driven bars={12} height={46} />
        <Driven bars={3} height={12} peak={0.35} />
    </div>
);
Live.storyName = 'Live level';

export const Clipping: Story = () => (
    <div style={{ display: 'flex', gap: 'var(--space-xl)', alignItems: 'flex-end' }}>
        <Driven peak={1} label="Clipping master" />
    </div>
);

export const Silent: Story = () => {
    const handle = useRef<MeterHandle>(null);
    useEffect(() => handle.current?.setSignal(0), []);
    return <Meter ref={handle} label="Silent" />;
};
