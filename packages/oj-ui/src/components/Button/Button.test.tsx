import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
    it('renders the base class and defaults to type=button', () => {
        const { container } = render(<Button>Go</Button>);
        const btn = container.querySelector('button')!;
        expect(btn.className).toBe('oj-btn');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.textContent).toBe('Go');
    });

    it('omits a variant modifier for the default node variant', () => {
        const { container } = render(<Button>n</Button>);
        expect(container.querySelector('button')!.className).not.toContain('oj-btn--');
    });

    it('applies variant, active and iconOnly modifiers', () => {
        const { container } = render(
            <Button variant="primary" active iconOnly>
                x
            </Button>,
        );
        const cls = container.querySelector('button')!.className;
        expect(cls).toContain('oj-btn--primary');
        expect(cls).toContain('is-active');
        expect(cls).toContain('oj-btn--icon-only');
    });

    it('forwards native props (onClick, disabled, aria-label)', () => {
        const onClick = vi.fn();
        const { container } = render(
            <Button disabled onClick={onClick} aria-label="lbl">
                x
            </Button>,
        );
        const btn = container.querySelector('button')!;
        expect(btn.getAttribute('aria-label')).toBe('lbl');
        expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
});
