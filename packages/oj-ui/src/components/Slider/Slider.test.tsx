import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Slider } from './Slider';

describe('Slider', () => {
    it('renders a range input with the base class and default bounds', () => {
        const { container } = render(<Slider aria-label="vol" value={50} onChange={() => {}} />);
        const input = container.querySelector('input')!;
        expect(input.className).toBe('oj-slider');
        expect(input.getAttribute('type')).toBe('range');
        expect(input.getAttribute('min')).toBe('0');
        expect(input.getAttribute('max')).toBe('100');
        expect(input.getAttribute('step')).toBe('1');
    });

    it('reflects value, custom bounds and aria-label', () => {
        const { container } = render(
            <Slider aria-label="gain" value={-6} min={-60} max={6} step={0.5} onChange={() => {}} />,
        );
        const input = container.querySelector('input')! as HTMLInputElement;
        expect(input.value).toBe('-6');
        expect(input.getAttribute('min')).toBe('-60');
        expect(input.getAttribute('max')).toBe('6');
        expect(input.getAttribute('step')).toBe('0.5');
        expect(input.getAttribute('aria-label')).toBe('gain');
    });

    it('merges a custom className after the base class', () => {
        const { container } = render(
            <Slider aria-label="x" value={0} onChange={() => {}} className="extra" />,
        );
        expect(container.querySelector('input')!.className).toBe('oj-slider extra');
    });

    it('calls onChange with the parsed numeric value', () => {
        const onChange = vi.fn();
        const { container } = render(<Slider aria-label="x" value={10} onChange={onChange} />);
        const input = container.querySelector('input')! as HTMLInputElement;
        fireEvent.change(input, { target: { value: '42' } });
        expect(onChange).toHaveBeenCalledWith(42);
    });

    it('forwards native props (disabled, onPointerDown)', () => {
        const onPointerDown = vi.fn();
        const { container } = render(
            <Slider aria-label="x" value={0} onChange={() => {}} disabled onPointerDown={onPointerDown} />,
        );
        const input = container.querySelector('input')! as HTMLInputElement;
        expect(input.disabled).toBe(true);
        fireEvent.pointerDown(input);
        expect(onPointerDown).toHaveBeenCalled();
    });
});
