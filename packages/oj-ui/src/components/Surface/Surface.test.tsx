import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Surface } from './Surface';

describe('Surface', () => {
    it('renders the base class with raised/lg defaults', () => {
        const { container } = render(<Surface>card</Surface>);
        const el = container.querySelector('div')!;
        expect(el.className).toContain('oj-surface');
        expect(el.textContent).toBe('card');
    });

    it('applies the elevation and radius modifiers', () => {
        const { container } = render(
            <Surface elevation="overlay" radius="xl">
                x
            </Surface>,
        );
        const cls = container.querySelector('div')!.className;
        expect(cls).toContain('oj-surface--elevation-overlay');
        expect(cls).toContain('oj-surface--radius-xl');
        expect(cls).not.toContain('oj-surface--elevation-raised');
        expect(cls).not.toContain('oj-surface--radius-lg');
    });

    it('maps deprecated elevations onto the two New DNA depths', () => {
        const { container, rerender } = render(<Surface elevation="menu">m</Surface>);
        expect(container.querySelector('div')!.className).toContain('oj-surface--elevation-overlay');
        rerender(<Surface elevation="lifted">m</Surface>);
        expect(container.querySelector('div')!.className).toContain('oj-surface--elevation-raised');
    });

    it('merges a custom className after the base classes', () => {
        const { container } = render(<Surface className="extra">x</Surface>);
        const cls = container.querySelector('div')!.className;
        expect(cls).toContain('oj-surface');
        expect(cls.endsWith('extra')).toBe(true);
    });

    it('forwards native props (id, role, data-*)', () => {
        const { container } = render(
            <Surface id="panel" role="dialog" data-testid="surf">
                x
            </Surface>,
        );
        const el = container.querySelector('div')!;
        expect(el.getAttribute('id')).toBe('panel');
        expect(el.getAttribute('role')).toBe('dialog');
        expect(el.getAttribute('data-testid')).toBe('surf');
    });
});
