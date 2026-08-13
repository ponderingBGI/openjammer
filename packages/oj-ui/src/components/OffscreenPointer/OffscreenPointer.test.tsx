import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OffscreenPointer } from './OffscreenPointer';

describe('OffscreenPointer', () => {
    it('renders the base class and defaults to type=button', () => {
        const { container } = render(
            <OffscreenPointer rotation={0} label="Back to nodes" onClick={() => {}} />,
        );
        const btn = container.querySelector('button')!;
        expect(btn.className).toBe('oj-offscreen-pointer');
        expect(btn.getAttribute('type')).toBe('button');
    });

    it('renders the arrow glyph and the label', () => {
        const { container } = render(
            <OffscreenPointer rotation={0} label="Back to nodes" onClick={() => {}} />,
        );
        const arrow = container.querySelector('.oj-offscreen-pointer__arrow')!;
        const label = container.querySelector('.oj-offscreen-pointer__label')!;
        expect(arrow.textContent).toBe('→');
        expect(arrow.getAttribute('aria-hidden')).toBe('true');
        expect(label.textContent).toBe('Back to nodes');
    });

    it('feeds rotation into the --oj-pointer-rotation custom property', () => {
        const { container } = render(
            <OffscreenPointer rotation={135} label="x" onClick={() => {}} />,
        );
        const btn = container.querySelector('button')! as HTMLButtonElement;
        expect(btn.style.getPropertyValue('--oj-pointer-rotation')).toBe('135deg');
    });

    it('invokes onClick when pressed', () => {
        const onClick = vi.fn();
        const { container } = render(
            <OffscreenPointer rotation={0} label="x" onClick={onClick} />,
        );
        container.querySelector('button')!.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('merges a custom className and preserves the inline rotation property', () => {
        const { container } = render(
            <OffscreenPointer
                rotation={45}
                label="x"
                onClick={() => {}}
                className="extra"
                style={{ top: '10px' }}
            />,
        );
        const btn = container.querySelector('button')! as HTMLButtonElement;
        expect(btn.className).toBe('oj-offscreen-pointer extra');
        expect(btn.style.getPropertyValue('--oj-pointer-rotation')).toBe('45deg');
        expect(btn.style.top).toBe('10px');
    });

    it('forwards native props (aria-label)', () => {
        const { container } = render(
            <OffscreenPointer
                rotation={0}
                label="x"
                onClick={() => {}}
                aria-label="Jump back to nodes"
            />,
        );
        expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(
            'Jump back to nodes',
        );
    });
});
