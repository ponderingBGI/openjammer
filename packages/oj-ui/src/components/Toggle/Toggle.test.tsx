import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Toggle } from './Toggle';

describe('Toggle', () => {
    it('renders the base class with a real checkbox and the label', () => {
        const { container } = render(<Toggle checked={false} onChange={() => {}} label="Auto-update" />);
        const root = container.querySelector('label.oj-toggle')!;
        expect(root.className).toBe('oj-toggle');
        const input = container.querySelector('input.oj-toggle__input') as HTMLInputElement;
        expect(input.getAttribute('type')).toBe('checkbox');
        expect(input.checked).toBe(false);
        expect(container.querySelector('.oj-toggle__label')!.textContent).toBe('Auto-update');
    });

    it('applies is-checked when checked and reflects it on the input', () => {
        const { container } = render(<Toggle checked onChange={() => {}} label="On" />);
        expect(container.querySelector('label.oj-toggle')!.className).toContain('is-checked');
        expect((container.querySelector('input.oj-toggle__input') as HTMLInputElement).checked).toBe(true);
    });

    it('applies is-disabled and disables the input', () => {
        const { container } = render(<Toggle checked={false} onChange={() => {}} disabled label="Off" />);
        expect(container.querySelector('label.oj-toggle')!.className).toContain('is-disabled');
        expect((container.querySelector('input.oj-toggle__input') as HTMLInputElement).disabled).toBe(true);
    });

    it('renders the description only when provided', () => {
        const { container: without } = render(<Toggle checked={false} onChange={() => {}} label="L" />);
        expect(without.querySelector('.oj-toggle__desc')).toBeNull();

        const { container: with_ } = render(
            <Toggle checked={false} onChange={() => {}} label="L" description="Explains it." />,
        );
        expect(with_.querySelector('.oj-toggle__desc')!.textContent).toBe('Explains it.');
    });

    it('forwards the id to the checkbox', () => {
        const { container } = render(<Toggle checked={false} onChange={() => {}} label="L" id="autoupd" />);
        expect(container.querySelector('input.oj-toggle__input')!.getAttribute('id')).toBe('autoupd');
    });

    it('calls onChange with the next value when toggled', () => {
        const onChange = vi.fn();
        const { container } = render(<Toggle checked={false} onChange={onChange} label="L" />);
        const input = container.querySelector('input.oj-toggle__input') as HTMLInputElement;
        input.click();
        expect(onChange).toHaveBeenCalledWith(true);
    });
});
