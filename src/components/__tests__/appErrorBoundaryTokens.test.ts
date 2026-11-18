/**
 * W6-CAP D7 — the error boundary's transcription had drifted off the palette.
 *
 * `AppErrorBoundary.css` is the one stylesheet in `src/` that is literal-only on
 * purpose: `main.tsx` mounts the boundary OUTSIDE the app tree, so it renders
 * exactly when `applyTheme()` may never have run and every `var(--x)` resolves
 * to nothing. Its own header calls that out and says "if the palette moves, this
 * file must be updated BY HAND".
 *
 * It wasn't. The dark title shipped `#F84B4B` — which is `--accent-danger`, the
 * FILL — where the ink belongs, measuring 4.80:1 on `#201F19` against the real
 * ink's 6.39:1. The light block transcribed `--danger-ink` correctly, so the bug
 * was invisible in the theme most people develop in.
 *
 * "BY HAND" is fine; "by memory" is not. This gate reads the DTCG token files,
 * converts them the way a browser paints them, and holds every literal in the
 * file to its token — in both scheme blocks. It fails on the pre-fix value.
 */

import { describe, expect, it } from 'vitest';
import Color from 'colorjs.io';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import light from '../../../packages/oj-tokens/tokens/themes/light.json';
import dark from '../../../packages/oj-tokens/tokens/themes/dark.json';

const CSS = readFileSync(resolve(process.cwd(), 'src/components/AppErrorBoundary.css'), 'utf8');

/** Everything before `@media (prefers-color-scheme: dark)` is the light theme. */
const DARK_AT = CSS.indexOf('@media (prefers-color-scheme: dark)');
const BLOCKS = { light: CSS.slice(0, DARK_AT), dark: CSS.slice(DARK_AT) } as const;
const THEMES = { light: light.color, dark: dark.color } as const;

type ColorKey = keyof typeof light.color;

/**
 * A token as sRGB hex. Several tokens are `oklch()` outside the sRGB gamut, and
 * a literal transcription has to land where the browser actually paints them —
 * Chromium clips the out-of-range channels rather than gamut-mapping, so this
 * clips too (the same convention `Arrangement/__tests__/contrast.test.ts` uses).
 * Verified in Chromium for `--danger-ink` dark: `oklch(0.785 0.21 25)` → #FF7771.
 */
function hex(value: string): string {
    const coords = new Color(value)
        .to('srgb')
        .coords.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
    return `#${coords.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** The value of `prop` in the first rule matching `selector` inside `block`. */
function declared(block: string, selector: string, prop: string): string | null {
    const at = block.indexOf(`${selector} {`);
    if (at < 0) return null;
    const body = block.slice(at, block.indexOf('}', at));
    // Anchored to the start of a declaration, so `color` never matches inside
    // `border-color`.
    return new RegExp(`(?:^|[;{]|\\s)${prop}:\\s*([^;]+);`).exec(body)?.[1]?.trim().toUpperCase() ?? null;
}

/** Every literal the file transcribes, and the token it is transcribing. */
const TRANSCRIPTIONS: readonly [selector: string, prop: string, token: ColorKey][] = [
    ['.app-error-card', 'border-color', 'borderSubtle'],
    ['.app-error-card', 'background', 'bgNode'],
    ['.app-error-card', 'color', 'textPrimary'],
    ['.app-error-title', 'color', 'dangerInk'],
    ['.app-error-msg', 'background', 'bgTertiary'],
    ['.app-error-msg', 'color', 'textPrimary'],
    ['.app-error-note', 'color', 'textSecondary'],
    ['.app-error-btn', 'background', 'bgTertiary'],
    ['.app-error-btn', 'color', 'textPrimary'],
    ['.app-error-btn.primary', 'background', 'accentPrimary'],
    ['.app-error-btn.primary', 'color', 'textOnAccent'],
];

describe.each(['light', 'dark'] as const)('AppErrorBoundary.css — %s', (theme) => {
    const block = BLOCKS[theme];

    it.each(TRANSCRIPTIONS)('%s { %s } is the %s token', (selector, prop, token) => {
        const value = declared(block, selector, prop);
        // The dark block only re-declares what changes; anything it leaves alone
        // is inherited from the light block and already checked there.
        if (value === null) return;
        expect(value).toBe(hex(THEMES[theme][token].$value));
    });
});

describe('AppErrorBoundary.css', () => {
    it('declares both colour schemes without any JS of ours running', () => {
        expect(DARK_AT).toBeGreaterThan(-1);
        // `prefers-color-scheme`, not `applyTheme` — the OS answers it even when
        // the theme bootstrap is what crashed.
        expect(CSS).not.toContain('data-theme');
    });

    it('sets no type size that is off the scale', () => {
        // 30 / 22 / 15 / 14 / 13 sans, 11 / 9.5 mono. `18px` shipped here.
        for (const [, value] of CSS.matchAll(/font-size:\s*([^;]+);/g)) {
            expect(value.trim()).toMatch(/^(30|22|15|14|13|11|9\.5)px$/);
        }
    });

    it('uses the soft layered depth roles, never a zero-blur offset shadow', () => {
        for (const [, value] of CSS.matchAll(/box-shadow:\s*([^;]+);/g)) {
            expect(value).not.toMatch(/^\s*\d+px\s+\d+px\s+0\b/);
        }
    });

    it('draws hairlines only', () => {
        for (const [, width] of CSS.matchAll(/border:\s*([\d.]+)px/g)) {
            expect(Number(width)).toBeLessThanOrEqual(1.5);
        }
    });
});
