import { cleanup, render } from '@testing-library/react';
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

    // ── U8 / HA-02: a socket is a control, and it says so ──────────────────

    it('gives every socket a role, a name and a title', () => {
        const { container } = render(<Port kind="audio" direction="output" />);
        const el = container.querySelector('span')!;
        expect(el.getAttribute('role')).toBe('button');
        expect(el.getAttribute('aria-label')).toBe('Audio out — drag to connect, or press Enter');
        expect(el.getAttribute('title')).toBe(el.getAttribute('aria-label'));
    });

    it('names the socket when the row hands it one, and stays quiet when the name only repeats the type', () => {
        const named = render(<Port kind="control" direction="input" name="Level" />).container.querySelector('span')!;
        expect(named.getAttribute('aria-label')).toBe('Control in — Level — drag to connect, or press Enter');

        cleanup();
        const bare = render(<Port kind="audio" direction="input" name="Audio In" />).container.querySelector('span')!;
        expect(bare.getAttribute('aria-label')).toBe('Audio in — drag to connect, or press Enter');
    });

    it('a placeholder slot invites rather than instructing', () => {
        const { container } = render(<Port kind="universal" direction="input" placeholder />);
        expect(container.querySelector('span')!.getAttribute('aria-label')).toMatch(/empty slot/i);
    });

    it('lets a caller override the derived name (a gated port explains itself)', () => {
        const { container } = render(
            <Port kind="audio" direction="input" aria-label="Not wired yet" title="Routing lands later" />,
        );
        const el = container.querySelector('span')!;
        expect(el.getAttribute('aria-label')).toBe('Not wired yet');
        expect(el.getAttribute('title')).toBe('Routing lands later');
    });

    it('never puts a socket in the tab order on its own — the canvas owns one stop per card', () => {
        const { container } = render(<Port kind="audio" direction="input" />);
        expect(container.querySelector('span')!.hasAttribute('tabindex')).toBe(false);
    });

    // ── U8 / HA-12 + HA-19: the legend reads before the cable, and the target
    //    is bigger than the drawing ───────────────────────────────────────────

    it('tints an IDLE socket with its own type, at reduced chroma', () => {
        const idleAudio = portCss.match(/\.oj-port--audio::after\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(idleAudio).toMatch(/color-mix\([^)]*--audio-connection/);
        const liveAudio = portCss.match(/\.oj-port--audio\.is-connected::after\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(liveAudio).toMatch(/background:\s*var\(--audio-connection\)/);
        // Control and universal follow the same two-strength rule.
        expect(portCss).toMatch(/\.oj-port--control::after[\s\S]*?--control-connection/);
        expect(portCss).toMatch(/\.oj-port--universal::after[\s\S]*?--universal-connection/);
    });

    it('carries an invisible hit pad of at least 24px, without moving the drawing', () => {
        const pad = portCss.match(/\.oj-port::before\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(pad).toMatch(/position:\s*absolute/);
        expect(pad).toMatch(/max\(var\(--oj-port-hit\), 100%\)/);
        expect(portCss).toMatch(/--oj-port-hit:\s*24px/);
        // No scale, ever — the target a performer is aiming at does not move.
        expect(portCss).not.toMatch(/transform:\s*scale/);
    });

    it('keeps exactly one focus ring and no glow', () => {
        expect(portCss).toMatch(/--focus-ring/);
        expect(portCss).not.toMatch(/filter:\s*drop-shadow/);
    });
});
