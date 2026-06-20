import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
    it('renders the base class and its label for the default neutral tone', () => {
        const { container } = render(<Chip>Tag</Chip>);
        const chip = container.querySelector('span.oj-chip')!;
        expect(chip.className).toBe('oj-chip');
        expect(chip.querySelector('.oj-chip__label')!.textContent).toBe('Tag');
    });

    it('omits a tone modifier for the default neutral tone', () => {
        const { container } = render(<Chip>n</Chip>);
        expect(container.querySelector('span.oj-chip')!.className).not.toContain('oj-chip--');
    });

    it('applies tone and pressed modifiers', () => {
        const { container } = render(
            <Chip tone="danger" pressed>
                x
            </Chip>,
        );
        const cls = container.querySelector('span.oj-chip')!.className;
        expect(cls).toContain('oj-chip--danger');
        expect(cls).toContain('is-pressed');
    });

    it('renders the glyph (aria-hidden) and exact count when provided', () => {
        const { container } = render(
            <Chip glyph="●" count={7}>
                reverb
            </Chip>,
        );
        const glyph = container.querySelector('.oj-chip__glyph')!;
        expect(glyph.textContent).toBe('●');
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
        expect(container.querySelector('.oj-chip__count')!.textContent).toBe('7');
    });

    it('omits glyph and count slots when not provided', () => {
        const { container } = render(<Chip>bare</Chip>);
        expect(container.querySelector('.oj-chip__glyph')).toBeNull();
        expect(container.querySelector('.oj-chip__count')).toBeNull();
    });

    it('renders a zero count rather than dropping it', () => {
        const { container } = render(<Chip count={0}>z</Chip>);
        expect(container.querySelector('.oj-chip__count')!.textContent).toBe('0');
    });

    it('forwards native props (className merge, title, data-*)', () => {
        const { container } = render(
            <Chip className="extra" title="hint" data-id="42">
                x
            </Chip>,
        );
        const chip = container.querySelector('span.oj-chip')!;
        expect(chip.className).toContain('oj-chip');
        expect(chip.className).toContain('extra');
        expect(chip.getAttribute('title')).toBe('hint');
        expect(chip.getAttribute('data-id')).toBe('42');
    });
});
