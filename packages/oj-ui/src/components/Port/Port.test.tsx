import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { Port } from './Port';

const portCss = readFileSync('packages/oj-ui/src/components/Port/Port.css', 'utf8');

describe('Port', () => {
    it('renders the socket well with its kind class', () => {
        const { container } = render(<Port kind="audio" direction="input" />);
        const cls = container.querySelector('span')!.className;
        expect(cls).toContain('oj-port');
        expect(cls).toContain('oj-port--audio');
    });

    it('pins the socket core to a true 8px square', () => {
        const coreRule = portCss.match(/\.oj-port::after\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(coreRule).toMatch(/width:\s*8px;/);
        expect(coreRule).toMatch(/height:\s*8px;/);
        expect(coreRule).not.toMatch(/(?:width|height):\s*[^;]*%/);
    });

    it('carries the kind class even without a direction (D7: direction is layout, not color)', () => {
        const { container } = render(<Port kind="control" />);
        expect(container.querySelector('span')!.className).toContain('oj-port--control');
    });

    it('never leaks the direction prop onto the DOM', () => {
        const { container } = render(<Port kind="audio" direction="output" />);
        const el = container.querySelector('span')!;
        expect(el.getAttribute('direction')).toBeNull();
        expect(el.className).not.toContain('oj-port--audio-output');
    });

    it('marks a connected port so the core takes the wiring color', () => {
        const { container } = render(<Port kind="control" direction="output" connected />);
        const cls = container.querySelector('span')!.className;
        expect(cls).toContain('oj-port--control');
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
        expect(cls).toContain('oj-port--audio');
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

    it('renders an empty dashed placeholder slot', () => {
        const { container } = render(<Port kind="universal" placeholder />);
        expect(container.querySelector('span')!.className).toContain('is-placeholder');
    });

    it('marks an active (firing) control port', () => {
        const { container } = render(<Port kind="control" direction="output" active />);
        expect(container.querySelector('span')!.className).toContain('is-active');
    });

    it('merges a caller className without dropping the base classes', () => {
        const { container } = render(<Port kind="audio" className="sampler-side-port output" />);
        const cls = container.querySelector('span')!.className;
        expect(cls).toContain('oj-port');
        expect(cls).toContain('sampler-side-port');
    });
});
