import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Knob, type KnobProps } from './Knob';
import { knobNorm, knobValue } from './knobMath';

/** A controlled host — the knob holds no value, so the tests must. */
type HostProps = Omit<Partial<KnobProps>, 'value'> & { initial?: number };

function Host({ initial = 50, min = 0, max = 100, label = 'CUTOFF', onChange, ...props }: HostProps) {
    const [value, setValue] = useState(initial);
    return (
        <Knob
            {...props}
            label={label}
            min={min}
            max={max}
            value={value}
            onChange={(v) => {
                setValue(v);
                onChange?.(v);
            }}
        />
    );
}

const dial = () => screen.getByRole('slider');
const now = () => Number(dial().getAttribute('aria-valuenow'));
const rot = () => dial().getAttribute('style') ?? '';

/** One vertical pointer gesture: press, move by `dy` px (up is negative), release. */
function drag(dy: number, opts: { shiftKey?: boolean; end?: 'up' | 'cancel' | 'none' } = {}) {
    const el = dial();
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientY: 300 });
    act(() => {
        fireEvent.pointerMove(window, {
            pointerId: 1,
            clientY: 300 + dy,
            shiftKey: opts.shiftKey ?? false,
        });
    });
    if (opts.end === 'cancel') fireEvent.pointerCancel(window, { pointerId: 1 });
    else if (opts.end !== 'none') fireEvent.pointerUp(window, { pointerId: 1 });
}

describe('Knob mapping', () => {
    it('maps a linear range to 0..1 and back', () => {
        expect(knobNorm(0, 0, 100)).toBe(0);
        expect(knobNorm(50, 0, 100)).toBe(0.5);
        expect(knobNorm(100, 0, 100)).toBe(1);
        expect(knobValue(0.25, 0, 100)).toBe(25);
        expect(knobValue(0, -60, 6)).toBe(-60);
    });

    it('round-trips a logarithmic range', () => {
        for (const v of [20, 100, 440, 5000, 20000]) {
            expect(knobValue(knobNorm(v, 20, 20000, true), 20, 20000, true)).toBeCloseTo(v, 6);
        }
        // The geometric mean sits dead centre on a log dial.
        expect(knobNorm(Math.sqrt(20 * 20000), 20, 20000, true)).toBeCloseTo(0.5, 9);
    });

    it('clamps out-of-range values instead of running off the dial', () => {
        expect(knobNorm(-10, 0, 100)).toBe(0);
        expect(knobNorm(999, 0, 100)).toBe(1);
        expect(knobValue(-3, 0, 100)).toBe(0);
        expect(knobValue(7, 0, 100)).toBe(100);
    });

    it('falls back to linear when a log range is not well-defined', () => {
        // min = 0 has no logarithm; it must not produce NaN under a finger.
        expect(knobNorm(50, 0, 100, true)).toBe(0.5);
        expect(knobValue(0.5, 0, 100, true)).toBe(50);
    });
});

describe('Knob rendering', () => {
    it('exposes a slider with the full value contract and a mono readout', () => {
        render(<Host initial={25} format={(v) => `${v.toFixed(0)} Hz`} />);
        const el = dial();
        expect(el.getAttribute('aria-label')).toBe('CUTOFF');
        expect(el.getAttribute('aria-valuenow')).toBe('25');
        expect(el.getAttribute('aria-valuemin')).toBe('0');
        expect(el.getAttribute('aria-valuemax')).toBe('100');
        expect(el.getAttribute('aria-valuetext')).toBe('25 Hz');
        expect(el.getAttribute('tabindex')).toBe('0');
        expect(document.querySelector('.oj-knob__label')!.textContent).toBe('CUTOFF');
        expect(document.querySelector('.oj-knob__value')!.textContent).toBe('25 Hz');
    });

    it('sweeps the tick from -135deg to +135deg', () => {
        const { rerender } = render(
            <Knob label="L" min={0} max={100} value={0} onChange={() => {}} />,
        );
        expect(rot()).toContain('-135deg');
        rerender(<Knob label="L" min={0} max={100} value={50} onChange={() => {}} />);
        expect(rot()).toContain('0deg');
        rerender(<Knob label="L" min={0} max={100} value={100} onChange={() => {}} />);
        expect(rot()).toContain('135deg');
    });

    it('scales every part off one size custom property', () => {
        const { container } = render(
            <Knob label="L" min={0} max={1} value={0} size={34} onChange={() => {}} />,
        );
        expect(container.querySelector('.oj-knob-wrap')!.getAttribute('style')).toContain(
            '--oj-knob-size: 34px',
        );
    });
});

describe('Knob pointer physics', () => {
    it('travels the full range over dragRange px', () => {
        render(<Host initial={0} />);
        drag(-150);
        expect(now()).toBe(100);
    });

    it('halves the range over half the drag', () => {
        render(<Host initial={0} />);
        drag(-75);
        expect(now()).toBeCloseTo(50, 6);
    });

    it('honours a custom dragRange', () => {
        render(<Host initial={0} dragRange={50} />);
        drag(-25);
        expect(now()).toBeCloseTo(50, 6);
    });

    it('drags DOWN to lower the value', () => {
        render(<Host initial={100} />);
        drag(75);
        expect(now()).toBeCloseTo(50, 6);
    });

    it('gives a tenth of the travel with Shift held (fine mode)', () => {
        render(<Host initial={0} />);
        drag(-150, { shiftKey: true });
        expect(now()).toBeCloseTo(10, 6);
    });

    it('clamps at the ends however far the pointer travels', () => {
        render(<Host initial={50} />);
        drag(-1000);
        expect(now()).toBe(100);
    });

    it('maps a log range geometrically while dragging', () => {
        render(<Host initial={20} min={20} max={20000} log />);
        drag(-75);
        expect(now()).toBeCloseTo(Math.sqrt(20 * 20000), 3);
    });

    it('fires onCommit exactly once, on release', () => {
        const onCommit = vi.fn();
        render(<Host initial={0} onCommit={onCommit} />);
        drag(-30);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(20);
    });

    it('streams onChange during the drag and never after release', () => {
        const onChange = vi.fn();
        render(<Host initial={0} onChange={onChange} />);
        drag(-30);
        const calls = onChange.mock.calls.length;
        expect(calls).toBeGreaterThan(0);
        act(() => {
            fireEvent.pointerMove(window, { pointerId: 1, clientY: 0 });
        });
        expect(onChange.mock.calls.length).toBe(calls);
    });

    it.each(['cancel', 'window-blur', 'unmount'] as const)(
        'closes an open gesture exactly once on %s',
        (ending) => {
            const onCommit = vi.fn();
            const view = render(<Host initial={0} onCommit={onCommit} />);
            drag(-30, { end: 'none' });
            if (ending === 'cancel') {
                fireEvent.pointerCancel(window, { pointerId: 1 });
                fireEvent.pointerUp(window, { pointerId: 1 });
            } else if (ending === 'window-blur') {
                fireEvent.blur(window);
            } else {
                view.unmount();
            }
            expect(onCommit).toHaveBeenCalledTimes(1);
            if (ending !== 'unmount') view.unmount();
            expect(onCommit).toHaveBeenCalledTimes(1);
        },
    );

    it('ignores a non-primary button', () => {
        render(<Host initial={40} />);
        fireEvent.pointerDown(dial(), { button: 2, pointerId: 1, clientY: 300 });
        act(() => {
            fireEvent.pointerMove(window, { pointerId: 1, clientY: 100 });
        });
        expect(now()).toBe(40);
    });

    it('resets to defaultValue on double-click', () => {
        const onCommit = vi.fn();
        render(<Host initial={90} defaultValue={25} onCommit={onCommit} />);
        fireEvent.doubleClick(dial());
        expect(now()).toBe(25);
        expect(onCommit).toHaveBeenCalledWith(25);
    });

    it('does nothing on double-click without a defaultValue', () => {
        render(<Host initial={90} />);
        fireEvent.doubleClick(dial());
        expect(now()).toBe(90);
    });
});

describe('Knob keyboard', () => {
    afterEach(() => vi.useRealTimers());

    it('steps by 1% of the range with the arrows', () => {
        render(<Host initial={50} />);
        fireEvent.keyDown(dial(), { key: 'ArrowUp' });
        expect(now()).toBeCloseTo(51, 6);
        fireEvent.keyDown(dial(), { key: 'ArrowDown' });
        fireEvent.keyDown(dial(), { key: 'ArrowDown' });
        expect(now()).toBeCloseTo(49, 6);
    });

    it('uses an explicit step when given', () => {
        render(<Host initial={50} step={5} />);
        fireEvent.keyDown(dial(), { key: 'ArrowUp' });
        expect(now()).toBe(55);
        fireEvent.keyDown(dial(), { key: 'ArrowLeft' });
        expect(now()).toBe(50);
    });

    it('steps ten at a time with PageUp/PageDown', () => {
        render(<Host initial={50} />);
        fireEvent.keyDown(dial(), { key: 'PageUp' });
        expect(now()).toBeCloseTo(60, 6);
        fireEvent.keyDown(dial(), { key: 'PageDown' });
        expect(now()).toBeCloseTo(50, 6);
    });

    it('jumps to the ends with Home/End', () => {
        render(<Host initial={50} />);
        fireEvent.keyDown(dial(), { key: 'End' });
        expect(now()).toBe(100);
        fireEvent.keyDown(dial(), { key: 'Home' });
        expect(now()).toBe(0);
    });

    it('clamps at the ends and commits after the quiet period', () => {
        vi.useFakeTimers();
        const onCommit = vi.fn();
        render(<Host initial={100} onCommit={onCommit} />);
        fireEvent.keyDown(dial(), { key: 'ArrowUp' });
        expect(now()).toBe(100);
        expect(onCommit).not.toHaveBeenCalled();
        fireEvent.keyDown(dial(), { key: 'ArrowDown' });
        expect(onCommit).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(180));
        expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('steps a log range evenly across its sweep', () => {
        render(<Host initial={20} min={20} max={20000} log />);
        fireEvent.keyDown(dial(), { key: 'PageUp' });
        // 10 steps of 1% of the NORMALISED range = a tenth of the sweep.
        expect(now()).toBeCloseTo(20 * Math.pow(1000, 0.1), 6);
    });

    it('leaves unrelated keys to the page', () => {
        render(<Host initial={50} />);
        fireEvent.keyDown(dial(), { key: 'Tab' });
        expect(now()).toBe(50);
    });
});

describe('Knob quiet commit coalescing', () => {
    afterEach(() => vi.useRealTimers());

    it('streams 20 wheel notches but commits only once', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        const onCommit = vi.fn();
        render(<Host initial={50} onChange={onChange} onCommit={onCommit} />);
        const el = dial();
        el.focus();
        for (let i = 0; i < 20; i += 1) fireEvent.wheel(el, { deltaY: -1 });
        expect(onChange).toHaveBeenCalledTimes(20);
        expect(onCommit).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(179));
        expect(onCommit).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit.mock.lastCall?.[0]).toBeCloseTo(70, 9);
    });

    it('coalesces held ArrowUp repeat events into one commit', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        const onCommit = vi.fn();
        render(<Host initial={50} onChange={onChange} onCommit={onCommit} />);
        const el = dial();
        for (let i = 0; i < 20; i += 1) {
            fireEvent.keyDown(el, { key: 'ArrowUp', repeat: i > 0 });
        }
        expect(onChange).toHaveBeenCalledTimes(20);
        expect(onCommit).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(180));
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit.mock.lastCall?.[0]).toBeCloseTo(70, 9);
    });

    it.each(['blur', 'pointer-down', 'unmount'] as const)(
        'flushes a pending keyboard commit on %s',
        (ending) => {
            vi.useFakeTimers();
            const onCommit = vi.fn();
            const view = render(<Host initial={50} onCommit={onCommit} />);
            const el = dial();
            fireEvent.keyDown(el, { key: 'ArrowUp' });
            if (ending === 'blur') fireEvent.blur(el);
            else if (ending === 'pointer-down') {
                fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientY: 300 });
            } else view.unmount();
            expect(onCommit).toHaveBeenCalledTimes(1);
            expect(onCommit).toHaveBeenLastCalledWith(51);
            act(() => vi.advanceTimersByTime(180));
            expect(onCommit).toHaveBeenCalledTimes(1);
            if (ending !== 'unmount') view.unmount();
        },
    );
});

describe('Knob disabled', () => {
    it('leaves the tab order, reports aria-disabled and ignores every gesture', () => {
        const onChange = vi.fn();
        const onCommit = vi.fn();
        render(<Host initial={50} disabled onChange={onChange} onCommit={onCommit} />);
        const el = dial();
        expect(el.getAttribute('tabindex')).toBe('-1');
        expect(el.getAttribute('aria-disabled')).toBe('true');
        drag(-150);
        fireEvent.keyDown(el, { key: 'ArrowUp' });
        fireEvent.doubleClick(el);
        expect(now()).toBe(50);
        expect(onChange).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('marks the wrapper so the whole cluster reads as unavailable', () => {
        const { container } = render(<Host initial={50} disabled />);
        expect(container.querySelector('.oj-knob-wrap')!.className).toContain('is-disabled');
    });
});
