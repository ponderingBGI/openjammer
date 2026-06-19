import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Kbd } from './Kbd';

describe('Kbd', () => {
    it('renders a kbd element with the base class and its children', () => {
        const { container } = render(<Kbd>Esc</Kbd>);
        const kbd = container.querySelector('kbd')!;
        expect(kbd.className).toBe('oj-kbd');
        expect(kbd.textContent).toBe('Esc');
    });

    it('omits the custom modifier by default', () => {
        const { container } = render(<Kbd>K</Kbd>);
        expect(container.querySelector('kbd')!.className).not.toContain('oj-kbd--custom');
    });

    it('applies the custom modifier for a remapped binding', () => {
        const { container } = render(<Kbd custom>F2</Kbd>);
        expect(container.querySelector('kbd')!.className).toContain('oj-kbd--custom');
    });

    it('merges a caller className onto the base class', () => {
        const { container } = render(<Kbd className="extra">↵</Kbd>);
        const cls = container.querySelector('kbd')!.className;
        expect(cls).toContain('oj-kbd');
        expect(cls).toContain('extra');
    });

    it('forwards native props (title, aria-label)', () => {
        const { container } = render(
            <Kbd title="Command" aria-label="command key">
                ⌘
            </Kbd>,
        );
        const kbd = container.querySelector('kbd')!;
        expect(kbd.getAttribute('title')).toBe('Command');
        expect(kbd.getAttribute('aria-label')).toBe('command key');
    });
});
