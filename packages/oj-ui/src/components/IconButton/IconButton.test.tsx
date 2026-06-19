import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
    it('renders a square icon-only button with the base class', () => {
        const { container } = render(<IconButton label="Close">x</IconButton>);
        const btn = container.querySelector('button')!;
        expect(btn.className).toContain('oj-icon-btn');
        expect(btn.className).toContain('oj-btn--icon-only');
        expect(btn.getAttribute('type')).toBe('button');
    });

    it('uses the required label as the aria-label', () => {
        const { container } = render(<IconButton label="Dismiss">x</IconButton>);
        expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Dismiss');
    });

    it('defaults to the ghost variant and omits a variant modifier', () => {
        const { container } = render(<IconButton label="Close">x</IconButton>);
        expect(container.querySelector('button')!.className).toContain('oj-btn--ghost');
    });

    it('applies the node variant and active modifier', () => {
        const { container } = render(
            <IconButton label="Mute" variant="node" active>
                x
            </IconButton>,
        );
        const cls = container.querySelector('button')!.className;
        expect(cls).not.toContain('oj-btn--ghost');
        expect(cls).toContain('is-active');
    });

    it('prefers icon over children when both are given', () => {
        const { container } = render(
            <IconButton label="Close" icon={<span data-testid="glyph">i</span>}>
                fallback
            </IconButton>,
        );
        const btn = container.querySelector('button')!;
        expect(btn.querySelector('[data-testid="glyph"]')).not.toBeNull();
        expect(btn.textContent).toBe('i');
    });

    it('forwards native props (onClick, disabled)', () => {
        const onClick = vi.fn();
        const { container } = render(
            <IconButton label="Close" disabled onClick={onClick}>
                x
            </IconButton>,
        );
        const btn = container.querySelector('button')! as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });
});
