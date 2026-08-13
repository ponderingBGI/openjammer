import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KeyTile } from './KeyTile';

describe('KeyTile', () => {
    it('renders the base + variant classes and defaults to type=button', () => {
        const { container } = render(<KeyTile variant="key" label="A" />);
        const btn = container.querySelector('button')!;
        expect(btn.className).toContain('oj-key-tile');
        expect(btn.className).toContain('oj-key-tile--key');
        expect(btn.getAttribute('type')).toBe('button');
    });

    it('renders the label and an embedded control Port', () => {
        const { container } = render(<KeyTile variant="white" label="C" />);
        expect(container.querySelector('.oj-key-tile__label')!.textContent).toBe('C');
        const port = container.querySelector('.oj-key-tile__port')!;
        expect(port.className).toContain('oj-port');
        expect(port.className).toContain('oj-port--control-output');
    });

    it('omits the label span when no label is given', () => {
        const { container } = render(<KeyTile variant="pad" />);
        expect(container.querySelector('.oj-key-tile__label')).toBeNull();
    });

    it('applies active and connected state classes', () => {
        const { container } = render(<KeyTile variant="pad" active connected label="x" />);
        const cls = container.querySelector('button')!.className;
        expect(cls).toContain('is-active');
        expect(cls).toContain('is-connected');
        // the connected state propagates to the embedded port's glow class
        expect(container.querySelector('.oj-key-tile__port')!.className).toContain('is-connected');
    });

    it('selects each variant modifier', () => {
        for (const v of ['key', 'pad', 'black', 'white'] as const) {
            const { container } = render(<KeyTile variant={v} />);
            expect(container.querySelector('button')!.className).toContain(`oj-key-tile--${v}`);
        }
    });

    it('forwards data-* attributes and pointer handlers to the tile', () => {
        const onPointerDown = vi.fn();
        const { container } = render(
            <KeyTile
                variant="key"
                label="A"
                data-node-id="n1"
                data-port-id="out"
                data-port-type="control"
                onPointerDown={onPointerDown}
            />,
        );
        const btn = container.querySelector('button')!;
        expect(btn.getAttribute('data-node-id')).toBe('n1');
        expect(btn.getAttribute('data-port-id')).toBe('out');
        expect(btn.getAttribute('data-port-type')).toBe('control');
    });

    it('merges a custom className', () => {
        const { container } = render(<KeyTile variant="key" className="mine" />);
        expect(container.querySelector('button')!.className).toContain('mine');
    });
});
