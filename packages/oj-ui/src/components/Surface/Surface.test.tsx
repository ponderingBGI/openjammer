import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Surface } from './Surface';

describe('Surface', () => {
    it('renders the base class with rest/lg defaults', () => {
        const { container } = render(<Surface>card</Surface>);
        const el = container.querySelector('div')!;
        expect(el.className).toBe(
            'oj-surface oj-surface--elevation-rest oj-surface--radius-lg',
        );
        expect(el.textContent).toBe('card');
    });

    it('applies the elevation and radius modifiers', () => {
        const { container } = render(
            <Surface elevation="lifted" radius="xl">
                x
            </Surface>,
        );
        const cls = container.querySelector('div')!.className;
        expect(cls).toContain('oj-surface--elevation-lifted');
        expect(cls).toContain('oj-surface--radius-xl');
        expect(cls).not.toContain('oj-surface--elevation-rest');
        expect(cls).not.toContain('oj-surface--radius-lg');
    });

    it('maps the menu elevation', () => {
        const { container } = render(<Surface elevation="menu">m</Surface>);
        expect(container.querySelector('div')!.className).toContain(
            'oj-surface--elevation-menu',
        );
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
