import { createRef } from 'react';
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

    /*
     * W5-P7-REVIEW claim 4. `Button` has always forwarded its ref and
     * `IconButton` — the control a menu trigger, a popover anchor and an in-card
     * confirm are most likely to be — did not, so a caller that needed to focus
     * or measure it had no choice but to fork it.
     *
     * Honest note on what was actually broken: under React 19 a `ref` written on
     * a plain function component arrives in `props`, so the OLD `IconButton`
     * spread it into `Button` through `...rest` and the ref happened to land.
     * The defect was in the TYPE — `IconButtonProps` has no `ref`, so
     * `tsc -p packages/oj-ui/tsconfig.json` rejected the line below with
     * "Property 'ref' does not exist" and no caller could write it. The first
     * assertion here is the runtime half of the same statement; the shape, not
     * the accident, is the contract.
     */
    it('forwards its ref to the underlying button, and still spreads the rest', () => {
        expect(
            (IconButton as unknown as { $$typeof?: symbol }).$$typeof,
            'IconButton must be a forwardRef component, like Button',
        ).toBe(Symbol.for('react.forward_ref'));

        const ref = createRef<HTMLButtonElement>();
        const { container } = render(
            <IconButton ref={ref} label="Close" title="Close it" data-testid="ib" />,
        );
        const button = container.querySelector('button')!;
        expect(ref.current).toBe(button);
        expect(ref.current?.tagName).toBe('BUTTON');
        expect(button.getAttribute('aria-label')).toBe('Close');
        expect(button.getAttribute('title')).toBe('Close it');
        expect(button.getAttribute('data-testid')).toBe('ib');
        // ...and the ref is the thing a caller actually wanted it for.
        ref.current?.focus();
        expect(document.activeElement).toBe(button);
    });
});
