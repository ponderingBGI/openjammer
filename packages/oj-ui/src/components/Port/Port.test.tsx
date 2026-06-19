import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Port } from './Port';

describe('Port', () => {
    it('colors by kind + direction', () => {
        const { container } = render(<Port kind="audio" direction="input" />);
        expect(container.querySelector('span')!.className).toContain('oj-port--audio-input');
    });

    it('marks a connected port', () => {
        const { container } = render(<Port kind="control" direction="output" connected />);
        const cls = container.querySelector('span')!.className;
        expect(cls).toContain('oj-port--control-output');
        expect(cls).toContain('is-connected');
    });

    it('universal uses the violet class regardless of direction', () => {
        const { container } = render(<Port kind="universal" direction="input" />);
        const cls = container.querySelector('span')!.className;
        expect(cls).toContain('oj-port--universal');
        expect(cls).not.toContain('oj-port--universal-input');
    });

    it('resolvedKind overrides a universal port color', () => {
        const { container } = render(<Port kind="universal" resolvedKind="audio" direction="output" />);
        const cls = container.querySelector('span')!.className;
        expect(cls).toContain('oj-port--audio-output');
        expect(cls).not.toContain('oj-port--universal');
    });

    it('forwards the data-* DOM contract used for connection lookup', () => {
        const { container } = render(
            <Port kind="audio" direction="output" data-node-id="n1" data-port-id="p2" data-port-type="audio" />,
        );
        const el = container.querySelector('span')!;
        expect(el.getAttribute('data-node-id')).toBe('n1');
        expect(el.getAttribute('data-port-id')).toBe('p2');
        expect(el.getAttribute('data-port-type')).toBe('audio');
    });

    it('renders a faint dashed placeholder slot', () => {
        const { container } = render(<Port kind="universal" placeholder />);
        expect(container.querySelector('span')!.className).toContain('is-placeholder');
    });
});
