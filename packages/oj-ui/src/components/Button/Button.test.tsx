import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
    it('renders the base class and defaults to type=button', () => {
        const { container } = render(<Button>Go</Button>);
        const btn = container.querySelector('button')!;
        expect(btn.className).toContain('oj-btn');
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
    it('keeps the label and reports aria-busy while loading', () => {
        const { container } = render(<Button loading>Export</Button>);
        const btn = container.querySelector('button')! as HTMLButtonElement;
        expect(btn.className).toContain('is-loading');
        expect(btn.getAttribute('aria-busy')).toBe('true');
        // The label keeps its box so nothing on the toolbar reflows.
        expect(container.querySelector('.oj-btn__label')!.textContent).toBe('Export');
        expect(container.querySelectorAll('.oj-btn__loader i').length).toBe(3);
        // A button that is already working cannot be asked to work again.
        expect(btn.disabled).toBe(true);
    });

    it('does not wrap the label when it is not loading', () => {
        const { container } = render(<Button>Export</Button>);
        expect(container.querySelector('.oj-btn__label')).toBeNull();
        expect(container.querySelector('.oj-btn__loader')).toBeNull();
        expect(container.querySelector('button')!.getAttribute('aria-busy')).toBeNull();
    });

    it('does not fire onClick while loading', () => {
        const onClick = vi.fn();
        const { container } = render(
            <Button loading onClick={onClick}>
                x
            </Button>,
        );
        (container.querySelector('button') as HTMLButtonElement).click();
        expect(onClick).not.toHaveBeenCalled();
    });
});
