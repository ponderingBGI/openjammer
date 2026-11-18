/**
 * 1C-04 — the live region has to actually SPEAK on a repeat.
 *
 * A screen reader ignores a region whose text is byte-identical to what it last
 * read, so the announcer pads a repeat with a no-break space. The first version
 * derived that padding from `nonce % 2` over ALL announcements, which is exactly
 * wrong for the cycle it exists for: `Ctrl+Z` → `Ctrl+Shift+Z` → `Ctrl+Z` puts
 * two identical "Undo …" strings an EVEN number of steps apart, so the second
 * rendered byte-identical to the first and was never read. Measured at gate time:
 * `"Undo Add Speaker"`, `"Redo Add Speaker "`, `"Undo Add Speaker"`.
 *
 * The law under test: **no two consecutive renders of the region are ever the
 * same string**, whatever came between.
 */

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiveAnnouncer } from '../LiveAnnouncer';
import { announce } from '../announce';
import { useGraphStore } from '../../store/graphStore';
import { useHistoryStore } from '../../store/historyStore';

const region = () => document.querySelector('[data-history-live]')!.textContent ?? '';

describe('LiveAnnouncer', () => {
    beforeEach(() => {
        useGraphStore.setState({
            nodes: new Map(), connections: new Map(), connectionsByNode: new Map(),
            rootNodeIds: [], selectedNodeIds: new Set(), selectedConnectionIds: new Set(),
            clipboard: null, version: 0,
        });
        useHistoryStore.getState().clear();
    });

    it('speaks again on the undo → redo → undo cycle', () => {
        render(<LiveAnnouncer />);
        act(() => { useGraphStore.getState().addNode('speaker', { x: 0, y: 0 }); });
        const added = region();
        expect(added).toContain('Added Speaker');

        act(() => useHistoryStore.getState().undo());
        const undo1 = region();
        expect(undo1).toContain('Undo Add Speaker');

        act(() => useHistoryStore.getState().redo());
        const redo = region();
        expect(redo).toContain('Redo Add Speaker');

        act(() => useHistoryStore.getState().undo());
        const undo2 = region();
        expect(undo2).toContain('Undo Add Speaker');

        // THE regression: the second undo must not render the same bytes as the
        // first, or an assistive technology stays silent on it.
        expect(undo2).not.toBe(undo1);
        // ...and still says the same words.
        expect(undo2.trim()).toBe(undo1.trim());
    });

    it('never renders the same string twice in a row, however long the run', () => {
        render(<LiveAnnouncer />);
        const seen: string[] = [];
        for (let i = 0; i < 6; i += 1) {
            // The same message, over and over — an armed socket, a refused drop.
            act(() => announce('Two outputs cannot connect. Reach for an input.'));
            seen.push(region());
        }
        for (let i = 1; i < seen.length; i += 1) {
            expect(seen[i], `render ${i} must differ from ${i - 1}`).not.toBe(seen[i - 1]);
        }
        // And every one of them says exactly the same sentence.
        expect(new Set(seen.map((text) => text.trim())).size).toBe(1);
    });

    it('changes words without padding when the words change', () => {
        render(<LiveAnnouncer />);
        act(() => announce('Cable released.'));
        expect(region()).toBe('Cable released.');
        act(() => announce('A card cannot be wired to itself.'));
        expect(region()).toBe('A card cannot be wired to itself.');
    });

    it('lives on the body, polite and atomic, so an inert surface cannot mute it', () => {
        render(<LiveAnnouncer />);
        const el = document.querySelector('[data-history-live]')!;
        expect(el.parentElement).toBe(document.body);
        expect(el.getAttribute('aria-live')).toBe('polite');
        expect(el.getAttribute('role')).toBe('status');
        expect(el.getAttribute('aria-atomic')).toBe('true');
    });
});
