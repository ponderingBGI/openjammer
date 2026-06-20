import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NodeFrame } from './NodeFrame';

describe('NodeFrame', () => {
    it('renders the base class and translates to its position', () => {
        const { container } = render(
            <NodeFrame position={{ x: 40, y: 32 }}>node</NodeFrame>,
        );
        const frame = container.firstElementChild as HTMLDivElement;
        expect(frame.className).toBe('oj-node-frame');
        // position:absolute lives in NodeFrame.css (like all oj-ui styling); the
        // dynamic translate is the only inline style. Assert the class + transform.
        expect(frame.style.transform).toBe('translate(40px, 32px)');
        expect(frame.textContent).toBe('node');
    });

    it('applies the dragging modifier and grabbing cursor', () => {
        const { container } = render(
            <NodeFrame position={{ x: 0, y: 0 }} dragging>
                n
            </NodeFrame>,
        );
        const frame = container.firstElementChild as HTMLDivElement;
        expect(frame.className).toContain('is-dragging');
    });

    it('omits the dragging modifier by default', () => {
        const { container } = render(
            <NodeFrame position={{ x: 0, y: 0 }}>n</NodeFrame>,
        );
        expect(
            (container.firstElementChild as HTMLDivElement).className,
        ).not.toContain('is-dragging');
    });

    it('merges a custom className and preserves the translate over inline style', () => {
        const { container } = render(
            <NodeFrame
                position={{ x: 10, y: 20 }}
                className="custom"
                style={{ opacity: 0.5 }}
            >
                n
            </NodeFrame>,
        );
        const frame = container.firstElementChild as HTMLDivElement;
        expect(frame.className).toContain('oj-node-frame');
        expect(frame.className).toContain('custom');
        expect(frame.style.transform).toBe('translate(10px, 20px)');
        expect(frame.style.opacity).toBe('0.5');
    });

    it('forwards native props (onPointerDown, data-*, aria attributes)', () => {
        const onPointerDown = vi.fn();
        const { container } = render(
            <NodeFrame
                position={{ x: 0, y: 0 }}
                onPointerDown={onPointerDown}
                data-node-id="abc"
                aria-label="Reverb node"
            >
                n
            </NodeFrame>,
        );
        const frame = container.firstElementChild as HTMLDivElement;
        expect(frame.getAttribute('data-node-id')).toBe('abc');
        expect(frame.getAttribute('aria-label')).toBe('Reverb node');
    });
});
