import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Meter, type MeterHandle } from './Meter';

afterEach(() => vi.useRealTimers());

function mount(props: Partial<Parameters<typeof Meter>[0]> = {}) {
    const ref = createRef<MeterHandle>();
    const { container } = render(<Meter ref={ref} {...props} />);
    const root = container.firstElementChild as HTMLElement;
    return { ref, root };
}

describe('Meter', () => {
    it('renders the requested number of bars', () => {
        const { root } = mount({ bars: 6 });
        expect(root.querySelectorAll('.oj-meter__bar')).toHaveLength(6);
        expect(root.className).toContain('oj-meter');
    });

    it('writes the level to a custom property and NEVER re-renders', () => {
        const { ref, root } = mount();
        // A rendered React tree would produce a new element; the meter must not.
        const before = root.querySelector('.oj-meter__bar');
        act(() => ref.current?.setSignal(0.42));
        expect(root.style.getPropertyValue('--oj-meter-signal')).toBe('0.420');
        expect(root.querySelector('.oj-meter__bar')).toBe(before);
    });

    it('clamps out-of-range and non-finite levels to silence rather than lying', () => {
        const { ref, root } = mount();
        act(() => ref.current?.setSignal(4));
        expect(root.style.getPropertyValue('--oj-meter-signal')).toBe('1.000');
        act(() => ref.current?.setSignal(-2));
        expect(root.style.getPropertyValue('--oj-meter-signal')).toBe('0.000');
        act(() => ref.current?.setSignal(Number.NaN));
        expect(root.style.getPropertyValue('--oj-meter-signal')).toBe('0.000');
    });

    it('latches the clip indication for the full latch window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { ref, root } = mount({ clipLatchMs: 1200 });
        act(() => ref.current?.setSignal(1));
        expect(root.className).toContain('is-clipping');

        vi.setSystemTime(1100);
        act(() => ref.current?.setSignal(0.1));
        expect(root.className).toContain('is-clipping');

        vi.setSystemTime(1400);
        act(() => ref.current?.setSignal(0.1));
        expect(root.className).not.toContain('is-clipping');
    });

    it('is decorative without a label and a real meter with one', () => {
        const { root } = mount();
        expect(root.getAttribute('aria-hidden')).toBe('true');

        const { ref } = mount({ label: 'Master level' });
        const meter = screen.getByRole('meter', { name: 'Master level' });
        expect(meter.getAttribute('aria-valuenow')).toBe('0');
        act(() => ref.current?.setSignal(0.5));
        expect(meter.getAttribute('aria-valuenow')).toBe('50');
    });

    it('gives each bar its own coefficient so the row arches', () => {
        const { root } = mount({ bars: 5 });
        const ks = [...root.querySelectorAll<HTMLElement>('.oj-meter__bar')].map((bar) =>
            Number(bar.style.getPropertyValue('--oj-meter-k')),
        );
        expect(ks).toHaveLength(5);
        expect(ks[2]).toBeGreaterThan(ks[0]!);
        expect(ks[0]).toBeCloseTo(ks[4]!, 3);
    });
});
