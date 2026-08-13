import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Swatch } from './Swatch';

describe('Swatch', () => {
    it('renders the base class, name and defaults to type=button', () => {
        const { container } = render(<Swatch bg="#fff" node="#eee" name="Sketchbook" />);
        const btn = container.querySelector('button')!;
        expect(btn.className).toBe('oj-swatch');
        expect(btn.getAttribute('type')).toBe('button');
        expect(container.querySelector('.oj-swatch__name')!.textContent).toBe('Sketchbook');
    });

    it('applies the bg and node colors as inline data, not CSS literals', () => {
        const { container } = render(<Swatch bg="#123456" node="#abcdef" name="x" />);
        const preview = container.querySelector('.oj-swatch__preview') as HTMLElement;
        const chip = container.querySelector('.oj-swatch__chip') as HTMLElement;
        expect(preview.style.background).toBe('rgb(18, 52, 86)');
        expect(chip.style.background).toBe('rgb(171, 205, 239)');
    });

    it('omits the selected modifier and reflects aria-pressed when not selected', () => {
        const { container } = render(<Swatch bg="#fff" node="#eee" name="x" />);
        const btn = container.querySelector('button')!;
        expect(btn.className).not.toContain('is-selected');
        expect(btn.getAttribute('aria-pressed')).toBe('false');
    });

    it('applies the selected modifier and aria-pressed when selected', () => {
        const { container } = render(<Swatch bg="#fff" node="#eee" name="x" selected />);
        const btn = container.querySelector('button')!;
        expect(btn.className).toContain('is-selected');
        expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    it('calls onSelect when clicked', () => {
        const onSelect = vi.fn();
        const { container } = render(
            <Swatch bg="#fff" node="#eee" name="x" onSelect={onSelect} />,
        );
        container.querySelector('button')!.click();
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('merges a custom className and forwards native props (aria-label)', () => {
        const { container } = render(
            <Swatch bg="#fff" node="#eee" name="x" className="extra" aria-label="lbl" />,
        );
        const btn = container.querySelector('button')!;
        expect(btn.className).toContain('oj-swatch');
        expect(btn.className).toContain('extra');
        expect(btn.getAttribute('aria-label')).toBe('lbl');
    });
});
