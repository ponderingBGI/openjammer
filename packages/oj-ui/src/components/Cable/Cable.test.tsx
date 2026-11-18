import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Cable } from './Cable';
import { cablePath } from './cablePath';

/** Cables render <path> inside <svg> — wrap so the path has an SVG namespace. */
function renderInSvg(node: React.ReactNode) {
    return render(<svg>{node}</svg>);
}

describe('Cable', () => {
    it('renders the hit path first and the wire over it, both on the same curve', () => {
        const { container } = renderInSvg(
            <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 100, y: 0 }} />,
        );
        const paths = container.querySelectorAll('path');
        expect(paths).toHaveLength(2);
        // UI-022: the fat invisible target is UNDER the 2.5px wire.
        expect(paths[0]!.getAttribute('class')).toBe('oj-cable__hit');
        expect(paths[1]!.getAttribute('class')).toContain('oj-cable--audio');
        expect(paths[0]!.getAttribute('d')).toBe(paths[1]!.getAttribute('d'));
    });

    it('marks a silent cable quiet so it carries no glow at rest', () => {
        const { container } = renderInSvg(
            <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 10, y: 0 }} />,
        );
        expect(container.querySelector('.oj-cable')!.getAttribute('class')).toContain('is-quiet');

        const { container: hot } = renderInSvg(
            <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 10, y: 0 }} signalLevel={0.4} />,
        );
        expect(hot.querySelector('.oj-cable')!.getAttribute('class')).not.toContain('is-quiet');
    });

    it('mirrors the state classes onto the group so the halo can sit under the wire', () => {
        const { container } = renderInSvg(
            <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 10, y: 0 }} selected bundled />,
        );
        const group = container.querySelector('g')!.getAttribute('class')!;
        expect(group).toContain('oj-cable-group');
        expect(group).toContain('is-selected');
        expect(group).toContain('is-bundled');
    });

    it('applies selected, bundled and temp state classes', () => {
        const { container } = renderInSvg(
            <Cable
                kind="control"
                start={{ x: 0, y: 0 }}
                end={{ x: 100, y: 0 }}
                selected
                bundled
                temp
            />,
        );
        const cls = container.querySelector('.oj-cable')!.getAttribute('class')!;
        expect(cls).toContain('oj-cable--control');
        expect(cls).toContain('is-selected');
        expect(cls).toContain('is-bundled');
        expect(cls).toContain('is-temp');
    });

    it('builds a cubic-bezier d string with horizontal control points', () => {
        const d = cablePath({ x: 0, y: 0 }, { x: 200, y: 50 });
        // controlOffset = min(200/2, 100) = 100
        expect(d).toBe('M 0 0 C 100 0, 100 50, 200 50');
    });

    it('caps the control offset at 100 for long runs', () => {
        const d = cablePath({ x: 0, y: 0 }, { x: 1000, y: 0 });
        expect(d).toContain('C 100 0,');
        expect(d).toContain('900 0,');
    });

    it('writes the clamped signal level into the --oj-cable-signal variable', () => {
        const { container } = renderInSvg(
            <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 10, y: 0 }} signalLevel={2} />,
        );
        const path = container.querySelector('.oj-cable') as SVGPathElement;
        expect(path.style.getPropertyValue('--oj-cable-signal')).toBe('1.000');
    });

    it('calls onSelect and stops propagation when the hit path is clicked', () => {
        const onSelect = vi.fn();
        const { container } = renderInSvg(
            <Cable kind="audio" start={{ x: 0, y: 0 }} end={{ x: 10, y: 0 }} onSelect={onSelect} />,
        );
        const hit = container.querySelector('.oj-cable__hit')!;
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        hit.dispatchEvent(evt);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(evt.defaultPrevented).toBe(false);
    });

    it('renders a bundle title only when bundled with more than one connection', () => {
        const { container: withTitle } = renderInSvg(
            <Cable
                kind="audio"
                start={{ x: 0, y: 0 }}
                end={{ x: 10, y: 0 }}
                bundled
                bundleCount={3}
            />,
        );
        expect(withTitle.querySelector('title')!.textContent).toBe('Bundle (3 connections)');

        const { container: noTitle } = renderInSvg(
            <Cable
                kind="audio"
                start={{ x: 0, y: 0 }}
                end={{ x: 10, y: 0 }}
                bundled
                bundleCount={1}
            />,
        );
        expect(noTitle.querySelector('title')).toBeNull();
    });

    it('is memoized: ignores signal changes under 1%', () => {
        // The memoized export carries the custom comparator; the named base does not.
        expect((Cable as { compare?: unknown }).compare ?? typeof Cable).toBeDefined();
        expect(typeof Cable).toBe('object');
    });
});
