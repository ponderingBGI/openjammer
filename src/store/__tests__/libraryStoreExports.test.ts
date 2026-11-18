/**
 * W6-UI item 9 — every production line is used (covenant #8).
 *
 * `getTagColorDark` was a second hue hash, `hsl(h, 50%, 25%)`, kept beside
 * `getTagColor` for a dark-theme tag badge that went out with HEAD's
 * `file-tag-badge`. Three gates in a row logged it as a dead export
 * (W5-P7-REVIEW #19, W5-P7b non-blocking 14) and no lane owned the file. It is
 * gone; this is the line that keeps it gone, and the one that says why the
 * survivor survives.
 *
 * On the pre-fix module `getTagColorDark` is exported and this fails.
 */

import { describe, expect, it } from 'vitest';
import * as libraryStore from '../libraryStore';

describe('libraryStore exports', () => {
    it('has no dead tag-colour twin', () => {
        expect(Object.keys(libraryStore)).not.toContain('getTagColorDark');
    });

    /*
     * The one that stays is live and theme-safe by construction: only the HUE
     * moves, so saturation and lightness are pinned and a tag's colour can never
     * become its legibility (W5-P7b §4, `LibraryNode.css`'s rule 3).
     */
    it('keeps the one hue hash the app actually calls', () => {
        expect(typeof libraryStore.getTagColor).toBe('function');
        expect(libraryStore.getTagColor('drums')).toMatch(/^hsl\(\d+, 60%, 70%\)$/);
        expect(libraryStore.getTagColor('drums')).toBe(libraryStore.getTagColor('drums'));
        expect(libraryStore.getTagColor('drums')).not.toBe(libraryStore.getTagColor('pads'));
    });
});
