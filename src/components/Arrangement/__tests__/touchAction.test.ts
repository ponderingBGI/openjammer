/**
 * W6-T / F3 — a finger must be able to move a clip.
 *
 * Spec §3's first gesture law: "`touch-action: none` on clips, notes, the ruler,
 * braces, points, faders and lane dividers; `touch-action: pan-x pan-y` on the
 * scroll container." Nothing in the field declared it, so the whole timeline was
 * pointer-only in practice: `.arrangement-clip` computed `touch-action: auto`
 * inside an `overflow: auto` scroller, and the moment a touch drag crossed
 * Chromium's slop the compositor claimed it as a scroll and fired
 * `pointercancel` (W6-E2E finding F3).
 *
 * This is a CSS gate rather than a render test on purpose: `touch-action` has no
 * observable effect in jsdom (there is no compositor to lose the gesture to), so
 * the only honest unit-level assertion is that the declaration is present on the
 * elements the hand grabs — and absent from the one place it must NOT be, the
 * lane ground a finger still has to scroll from. The behavioural half is
 * `T39 — Touch parity` in `e2e/timeline-tlist.spec.ts`, driven through CDP touch.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const arrangementCss = ['src/components/Arrangement/gestureHandles.css', 'src/components/Arrangement/ArrangementSurface.css'].map(read).join('\n');
const pianoRollCss = read('src/components/PianoRoll/PianoRoll.css');
const allCss = `${arrangementCss}\n${pianoRollCss}`;

/**
 * The `touch-action` a selector declares, or null. Deliberately literal: it reads
 * the rule as written rather than a cascade, because what is being pinned is that
 * SOMEONE wrote the declaration down next to the geometry it belongs to.
 */
function touchAction(css: string, selector: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The selector may be alone or in a comma list; the block may hold other props.
    const pattern = new RegExp(`(?:^|,|\\})[^{}]*?${escaped}\\s*(?:,[^{}]*?)?\\{([^}]*)\\}`, 'gs');
    for (const match of css.matchAll(pattern)) {
        const found = /touch-action\s*:\s*([^;}]+)/.exec(match[1]!);
        if (found) return found[1]!.trim();
    }
    return null;
}

/** Everything §3 names as a grab target, with the class the hand actually hits. */
const GRAB_TARGETS: Array<[what: string, selector: string]> = [
    ['a clip (and therefore its trim, fade and slip zones)', '.arrangement-clip'],
    ['the ruler stack — scrub, sections, braces and marks', '.arrangement-ruler-viewport'],
    ['the lane-height divider', '.arrangement-lane__resize'],
    ['the header-width divider', '.arrangement-header-resize'],
    ['the track reorder grip', '.arrangement-track__grab'],
    ['an automation point', '.arrangement-automation__point'],
    ['a mixer fader', '.mixer-strip__fader'],
    ['a mixer pan scrubber', '.mixer-strip__pan'],
    ['the piano-roll note field', '.piano-roll__field'],
    ['the piano-roll key bed', '.piano-roll__keys'],
    ['the piano-roll velocity lane', '.piano-roll__velocity'],
    ['the piano-roll scroomer', '.piano-roll__scroomer'],
];

describe('W6-T F3 — touch-action across the ruled surfaces', () => {
    it.each(GRAB_TARGETS)('%s takes the gesture away from the compositor', (_what, selector) => {
        expect(touchAction(allCss, selector)).toBe('none');
    });

    it('the field scroller keeps both axes for a finger on empty ground', () => {
        // NOT `none`: empty lane space is how the field is panned by touch, and a
        // surface a finger cannot scroll is worse than a time range it cannot draw.
        expect(touchAction(arrangementCss, '.arrangement-scroll')).toBe('pan-x pan-y');
    });

    it('a lane never claims the finger it does not need', () => {
        expect(touchAction(arrangementCss, '.arrangement-lane')).toBeNull();
    });
});
