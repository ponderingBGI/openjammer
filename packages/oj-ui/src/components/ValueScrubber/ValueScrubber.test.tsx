import { act, fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ValueScrubber } from './ValueScrubber';

const props = { value: 0.5, display: '0.50 dB', onCommit: () => {} };

describe('ValueScrubber', () => {
    it('renders the base + editable classes and the mono display', () => {
        const { container } = render(<ValueScrubber {...props} />);
        const root = container.querySelector('.oj-value-scrubber')!;
        expect(root.className).toContain('oj-value-scrubber');
        expect(root.className).toContain('oj-value-scrubber--editable');
        expect(container.querySelector('.oj-value-scrubber__value')!.textContent).toBe('0.50 dB');
    });

    it('renders the label only when provided', () => {
        const { container: without } = render(<ValueScrubber {...props} />);
        expect(without.querySelector('.oj-value-scrubber__label')).toBeNull();

        const { container: with_ } = render(<ValueScrubber {...props} label="Gain" />);
        expect(with_.querySelector('.oj-value-scrubber__label')!.textContent).toBe('Gain');
    });

    it('marks the value as a button with focusable tabindex when editable', () => {
        const { container } = render(<ValueScrubber {...props} />);
        const value = container.querySelector('.oj-value-scrubber__value')!;
        expect(value.getAttribute('role')).toBe('button');
        expect(value.getAttribute('tabindex')).toBe('0');
    });

    it('is not editable when editable=false: no role, no editor on click', () => {
        const { container } = render(<ValueScrubber {...props} editable={false} />);
        const root = container.querySelector('.oj-value-scrubber')!;
        expect(root.className).not.toContain('oj-value-scrubber--editable');
        const value = container.querySelector('.oj-value-scrubber__value')! as HTMLElement;
        expect(value.getAttribute('role')).toBeNull();
        act(() => value.click());
        expect(container.querySelector('input')).toBeNull();
    });

    it('applies is-disabled and blocks editing', () => {
        const { container } = render(<ValueScrubber {...props} disabled />);
        expect(container.querySelector('.oj-value-scrubber')!.className).toContain('is-disabled');
        const value = container.querySelector('.oj-value-scrubber__value')! as HTMLElement;
        act(() => value.click());
        expect(container.querySelector('input')).toBeNull();
    });

    it('opens an inline number input on click, seeded with the value', () => {
        const { container } = render(<ValueScrubber {...props} />);
        const value = container.querySelector('.oj-value-scrubber__value')! as HTMLElement;
        act(() => value.click());
        const input = container.querySelector('input')! as HTMLInputElement;
        expect(input.getAttribute('type')).toBe('number');
        expect(input.value).toBe('0.5');
        expect(container.querySelector('.oj-value-scrubber')!.className).toContain('is-editing');
    });

    it('commits the parsed number on Enter via onCommit', () => {
        const onCommit = vi.fn();
        const { container } = render(<ValueScrubber {...props} onCommit={onCommit} />);
        act(() => (container.querySelector('.oj-value-scrubber__value')! as HTMLElement).click());
        const input = container.querySelector('input')! as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1.25' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onCommit).toHaveBeenCalledWith(1.25);
        expect(container.querySelector('input')).toBeNull();
    });

    it('commits on blur', () => {
        const onCommit = vi.fn();
        const { container } = render(<ValueScrubber {...props} onCommit={onCommit} />);
        act(() => (container.querySelector('.oj-value-scrubber__value')! as HTMLElement).click());
        const input = container.querySelector('input')! as HTMLInputElement;
        fireEvent.change(input, { target: { value: '3' } });
        fireEvent.blur(input);
        expect(onCommit).toHaveBeenCalledWith(3);
    });

    it('reverts on Escape without committing', () => {
        const onCommit = vi.fn();
        const { container } = render(<ValueScrubber {...props} onCommit={onCommit} />);
        act(() => (container.querySelector('.oj-value-scrubber__value')! as HTMLElement).click());
        const input = container.querySelector('input')! as HTMLInputElement;
        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(onCommit).not.toHaveBeenCalled();
        expect(container.querySelector('input')).toBeNull();
    });

    it('does not commit when the value is unchanged or unparseable', () => {
        const onCommit = vi.fn();
        const { container } = render(<ValueScrubber {...props} onCommit={onCommit} />);
        act(() => (container.querySelector('.oj-value-scrubber__value')! as HTMLElement).click());
        const input = container.querySelector('input')! as HTMLInputElement;
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('forwards parent-wired native handlers (onWheel/onPointerDown) onto the display span', () => {
        const onWheel = vi.fn();
        const onPointerDown = vi.fn();
        const { container } = render(
            <ValueScrubber {...props} onWheel={onWheel} onPointerDown={onPointerDown} />,
        );
        const value = container.querySelector('.oj-value-scrubber__value')!;
        fireEvent.wheel(value);
        fireEvent.pointerDown(value);
        expect(onWheel).toHaveBeenCalledTimes(1);
        expect(onPointerDown).toHaveBeenCalledTimes(1);
    });

    it('merges a custom className onto the root', () => {
        const { container } = render(<ValueScrubber {...props} className="custom" />);
        expect(container.querySelector('.oj-value-scrubber')!.className).toContain('custom');
    });
});
