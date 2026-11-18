/**
 * W6-UI item 7 (a) — the hidden peer surface never holds the tab order.
 *
 * The app keeps all three surfaces MOUNTED so a switch is instant and no
 * scroll position is lost (`App.tsx`, `ArrangementSurface`, `PianoRollSurfaceHost`).
 * That is the right call for feel and a trap for the keyboard: two of the three
 * are off-screen at any moment, and an off-screen surface full of tabbable ports
 * and clips is a tab order a player can fall into and never get out of.
 *
 * Three things have to be true at once, and each is checked here:
 *   1. while it is not the active surface, a surface root is `inert` and
 *      `aria-hidden` — this is the state that matters during the 180ms
 *      transition, when it is still PAINTED;
 *   2. once the transition ends it is also `hidden`, i.e. `display: none`;
 *   3. every surface root declares the pair, not just the two that were easy —
 *      asserted against the source, because mounting the whole shell to prove a
 *      two-attribute contract would test the mount, not the contract.
 *
 * The arbiter half of the same fix (a `Tab` inside a surface walks controls
 * instead of swapping the surface out from under them) lives in
 * `src/keymap/__tests__/arbiter.test.ts`.
 */

import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArrangementSurface } from '../../Arrangement/ArrangementSurface';
import { useArrangementStore } from '../../../store/arrangementStore';

beforeAll(() => {
    class TestResizeObserver {
        observe() {}
        disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(cleanup);

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('the peer surface is out of the tab order', () => {
    it('is inert and aria-hidden even while it is still PAINTED (mid-transition)', () => {
        useArrangementStore.getState().setArrangement(null);
        // `visible` without `active` is the transition-out window: on screen,
        // animating, and no longer the surface the player is driving.
        const { container } = render(<ArrangementSurface active={false} visible songNodeId="song-1" />);
        const surface = container.querySelector('.arrangement-surface')!;
        expect(surface.hasAttribute('inert'), 'a painted peer is the case `hidden` cannot cover').toBe(true);
        expect(surface.getAttribute('aria-hidden')).toBe('true');
        expect(surface.hasAttribute('hidden'), 'it is still on screen').toBe(false);
    });

    it('adds display:none once the transition has finished', () => {
        useArrangementStore.getState().setArrangement(null);
        const { container } = render(<ArrangementSurface active={false} songNodeId="song-1" />);
        const surface = container.querySelector('.arrangement-surface')!;
        expect(surface.hasAttribute('hidden')).toBe(true);
        expect(surface.hasAttribute('inert')).toBe(true);
        const css = source('src/components/Arrangement/ArrangementSurface.css');
        expect(css, 'the surface sets display:flex, so [hidden] has to be re-asserted').toContain('.arrangement-surface[hidden] { display: none; }');
    });

    /*
     * The canvas layer is plain markup in `App.tsx` and the piano roll is its own
     * host; both carry the same pair. A regex is the honest gate here — the
     * alternative is mounting the entire application to read two attributes.
     */
    it.each([
        ['src/App.tsx', 'data-surface-root="canvas"'],
        ['src/components/PianoRoll/PianoRollSurfaceHost.tsx', 'data-surface-root="pianoroll"'],
        ['src/components/Arrangement/ArrangementSurface.tsx', 'data-surface-root="arrangement"'],
    ])('%s declares inert + aria-hidden on its surface root', (path, marker) => {
        const text = source(path);
        expect(text).toContain(marker);
        // Same JSX tag: `[^>]` cannot leave the element it started in.
        const inTag = (attribute: string) =>
            new RegExp(`${marker.replace(/[[\]]/g, '\\$&')}[^>]*${attribute}=\\{`);
        expect(text, `${marker} must be inert when it is not active`).toMatch(inTag('inert'));
        expect(text, `${marker} must be aria-hidden when it is not active`).toMatch(inTag('aria-hidden'));
    });

    /*
     * And the doc that teaches the law says the law. `docs/shell.md` is where a
     * contributor looks before touching `Tab`, and it was describing the old,
     * descendant-wide rule.
     */
    it('is what docs/shell.md teaches', () => {
        const doc = source('docs/shell.md');
        expect(doc).toContain('inert');
        expect(doc, 'the old rule was "inside a [data-surface-root]"').not.toMatch(/`Tab` only reaches\n`view\.toggleArrangement` when the target is `document\.body` or inside a\n`\[data-surface-root\]`/);
    });
});
