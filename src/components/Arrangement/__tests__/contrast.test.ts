import { describe, expect, it } from 'vitest';
import Color from 'colorjs.io';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import light from '../../../../packages/oj-tokens/tokens/themes/light.json';
import dark from '../../../../packages/oj-tokens/tokens/themes/dark.json';
import { velocityOpacity } from '../../PianoRoll/geometry';
import { TRACK_TINTS } from '../trackTint';

type RGB = [number, number, number];
type ColorKey = keyof typeof light.color;
type ThemeFile = { color: Record<ColorKey, { $value: string }> };
const rgb = (value: string | Color): RGB => {
    const color = (typeof value === 'string' ? new Color(value) : value).to('srgb');
    return color.coords.map((channel) => Math.max(0, Math.min(1, channel)) * 255) as RGB;
};
const blend = (foreground: RGB, background: RGB, alpha: number): RGB => foreground.map((channel, index) => channel * alpha + background[index]! * (1 - alpha)) as RGB;
const parse = (source: string, background: RGB): RGB => {
    const mix = source.match(/^color-mix\(in oklab,\s*(#[\da-f]{3,8}|rgba?\([^)]+\)|oklch\([^)]+\))\s+([\d.]+)%,\s*transparent\)$/i);
    return mix ? blend(rgb(mix[1]!), background, Number(mix[2]) / 100) : rgb(source);
};
const luminance = ([r, g, b]: RGB) => [r, g, b].map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
const ratio = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const mixOklab = (first: string, second: string, firstWeight: number): RGB =>
    rgb(Color.mix(new Color(second), new Color(first), firstWeight, { space: 'oklab' }));
const value = (theme: ThemeFile, key: ColorKey) => theme.color[key].$value;
const contrast = (theme: ThemeFile, foreground: ColorKey, background: ColorKey) => {
    const ground = rgb(value(theme, background));
    return ratio(parse(value(theme, foreground), ground), ground);
};
/**
 * The two numbers the piano-roll note is built from, read from the code that
 * paints it rather than copied here — a gate that restates a constant can only
 * ever agree with itself.
 */
const ROLL_CSS = readFileSync(resolve(process.cwd(), 'src/components/PianoRoll/PianoRoll.css'), 'utf8');
const NOTE_INK_WEIGHT = Number(/--piano-roll-note-ink:\s*color-mix\(in oklab,\s*var\(--universal-connection\)\s*([\d.]+)%,\s*var\(--text-primary\)\)/.exec(ROLL_CSS)?.[1] ?? 'NaN') / 100;
/** `.piano-roll__row.is-black` is the lane-alt tint at this alpha over the lane. */
const BLACK_ROW_ALPHA = Number(/\.piano-roll__row\.is-black\s*{\s*background:\s*color-mix\(in oklab,\s*var\(--timeline-lane-alt-bg\)\s*([\d.]+)%/.exec(ROLL_CSS)?.[1] ?? 'NaN') / 100;
const noteInk = (theme: ThemeFile) => mixOklab(value(theme, 'universalConnection'), value(theme, 'textPrimary'), NOTE_INK_WEIGHT);

/**
 * The ground an inline note is ACTUALLY painted on, read from the two files
 * that paint it.
 *
 * A clip body is not `--timeline-clip-bg`: it is that colour mixed with the
 * TRACK TINT. The two tokens happen to be identical in both themes, so the row
 * this replaces ("a clip body", `timelineClipBg`) was a duplicate of the
 * white-key row and never tested the ground that ships (W4-TBb §12.3) — the
 * tint costs another 0.19 in light and takes the softest note from 3.20 to
 * 3.01. With the tint in, §8.1's own "consider 16–18% in light" turns the gate
 * red (2.93 at 16%) instead of breaking the floor silently.
 *
 * Both halves come from the shipping code: the palette from `trackTint.ts`, the
 * 12% out of the `.arrangement-clip` rule itself.
 */
const SURFACE_CSS = readFileSync(resolve(process.cwd(), 'src/components/Arrangement/ArrangementSurface.css'), 'utf8');
const CLIP_TINT_WEIGHT = Number(/\.arrangement-clip\s*{[^}]*background:\s*color-mix\(in oklab,\s*var\(--track-tint\)\s*([\d.]+)%,\s*var\(--timeline-clip-bg\)\)/s.exec(SURFACE_CSS)?.[1] ?? 'NaN') / 100;
/** `var(--accent-secondary)` → `accentSecondary`, so the palette is never re-typed. */
const TRACK_TINT_KEYS = TRACK_TINTS.map((tint) => tint.replace(/^var\(--|\)$/g, '').replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase()) as ColorKey);

const washContrast = (
    theme: ThemeFile,
    ink: ColorKey,
    state: ColorKey,
    stateWeight: number,
) =>
    ratio(
        rgb(value(theme, ink)),
        mixOklab(value(theme, state), value(theme, 'bgTertiary'), stateWeight),
    );

describe.each([['light', light], ['dark', dark]] as const)('%s arrangement contrast floors', (_name, theme) => {
    it.each([
        ['textPrimary', 'timelineLaneBg', 4.5],
        ['textSecondary', 'timelineChromeBg', 4.5],
        ['textMuted', 'timelineClipMutedBg', 4.5],
        ['timelineClipBorder', 'timelineLaneBg', 3],
        ['timelineClipBorder', 'timelineClipBg', 3],
        ['timelineNoteFill', 'timelineLaneBg', 3],
        ['timelineNoteFill', 'timelineClipBg', 3],
        ['timelinePlayhead', 'timelineLaneBg', 3],
        ['timelinePlayhead', 'timelineClipBg', 3],
        ['timelineSelection', 'timelineClipBg', 3],
        ['textPrimary', 'timelineClipBg', 3],
    ] as const)('%s clears its floor against %s', (foreground, background, floor) => {
        expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(floor);
    });

    it('keeps the bar rhythm at 1.5:1 against the lane', () => {
        expect(contrast(theme, 'timelineGridBar', 'timelineLaneBg')).toBeGreaterThanOrEqual(1.5);
    });

    /*
     * The two graphical objects W4-TB's redesign leans on. Both are non-text UI
     * components under WCAG 1.4.11, so 3:1 against their ground is the floor —
     * and the level bead in particular is the ONE thing on this surface that
     * reports live sound, so it can never be the dimmest pixel on the header.
     */
    it.each([
        ['successInk', 'timelineChromeBg'],
        ['successInk', 'bgTertiary'],
    ] as const)('keeps the %s level bead readable on %s', (foreground, background) => {
        expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(3);
    });

    /*
     * The piano-roll note, measured the way it is PAINTED.
     *
     * The version this replaces asserted `universalConnection` vs
     * `timelineLaneBg` at FULL opacity — a gate that could not fail the way the
     * pixels failed, because a note is never painted at full opacity unless the
     * velocity is 127. Composited at the alphas `velocityOpacity` actually
     * emits, the softest note measured 1.65:1 in light (W4-TB-REVIEW M4).
     *
     * Both halves of the fix are read from the code that ships: the alpha ramp
     * from `velocityOpacity` itself, the ink weight parsed out of
     * `PianoRoll.css`. Change either and this gate moves with it.
     */
    it.each([
        ['a white-key row', () => rgb(value(theme, 'timelineLaneBg'))],
        ['a black-key row', () => blend(rgb(value(theme, 'timelineLaneAltBg')), rgb(value(theme, 'timelineLaneBg')), BLACK_ROW_ALPHA)],
        ...TRACK_TINT_KEYS.map((tint): [string, () => RGB] => [
            `a ${tint}-tinted clip body`,
            () => mixOklab(value(theme, tint), value(theme, 'timelineClipBg'), CLIP_TINT_WEIGHT),
        ]),
    ] as [string, () => RGB][])('keeps the note fill above 3:1 on %s at every velocity', (_where, groundOf) => {
        const ground = groundOf();
        for (const velocity of [0, 1, 32, 64, 96, 127]) {
            const painted = blend(noteInk(theme), ground, velocityOpacity(velocity));
            expect(ratio(painted, ground), `velocity ${velocity}`).toBeGreaterThanOrEqual(3);
        }
    });

    it('keeps velocity readable as a monotonic ramp', () => {
        const ground = rgb(value(theme, 'timelineLaneBg'));
        const ladder = [0, 32, 64, 96, 127].map((velocity) => ratio(blend(noteInk(theme), ground, velocityOpacity(velocity)), ground));
        expect(velocityOpacity(127)).toBe(1);
        for (let index = 1; index < ladder.length; index++) expect(ladder[index]!).toBeGreaterThan(ladder[index - 1]!);
    });

    /*
     * NOT a floor gate, on purpose. `--acc` and `--acc2` are near-isoluminant by
     * design (both oklch L .66 light / .72 dark), so an accent ring on a note
     * fill has never reached 3:1 — it measured 1.00 light / 1.01 dark at
     * velocity 127 before this pass, and the selected state is carried by the
     * ring PLUS the focus halo outside it, not by the ring alone. This records
     * the number so the next change to either colour is a conscious one; the
     * floor question belongs to the spec (§2.7), alongside the same issue the
     * W4-TB review raised for the selection outline on a tinted clip fill.
     */
    it('records the selection ring against the note fill', () => {
        const ground = rgb(value(theme, 'timelineLaneBg'));
        for (const velocity of [0, 127]) {
            const fill = blend(noteInk(theme), ground, velocityOpacity(velocity));
            expect(ratio(rgb(value(theme, 'timelineSelection')), fill)).toBeGreaterThan(1);
        }
    });

    it.each(['accentPrimary', 'accentSecondary'] as const)(
        'keeps text-on-accent readable on %s',
        (background) => {
            expect(contrast(theme, 'textOnAccent', background)).toBeGreaterThanOrEqual(4.5);
        },
    );

    it.each([
        ['accentInk', 'accentPrimary'],
        ['successInk', 'accentSuccess'],
        ['warningInk', 'accentWarning'],
        ['dangerInk', 'accentDanger'],
        ['audioInk', 'audioConnection'],
    ] as const)('%s clears its own %s wash', (ink, state) => {
        for (const percentage of [10, 18]) {
            expect(washContrast(theme, ink, state, percentage / 100)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each(['bgTertiary', 'bgCanvas', 'bgNode', 'bgNodeHeader'] as const)(
        'keeps danger ink readable on %s',
        (background) => {
            expect(contrast(theme, 'dangerInk', background)).toBeGreaterThanOrEqual(4.5);
        },
    );

    it.each(['bgTertiary', 'bgCanvas', 'bgNode'] as const)(
        'keeps control boundaries visible on %s',
        (background) => {
            expect(contrast(theme, 'borderControl', background)).toBeGreaterThanOrEqual(3);
        },
    );
});

describe('the note ink is derived from the shipped CSS', () => {
    it('parses both constants out of PianoRoll.css', () => {
        expect(NOTE_INK_WEIGHT).toBeGreaterThan(0);
        expect(NOTE_INK_WEIGHT).toBeLessThanOrEqual(1);
        expect(BLACK_ROW_ALPHA).toBeGreaterThan(0);
        expect(BLACK_ROW_ALPHA).toBeLessThanOrEqual(1);
    });

    /*
     * The clip ground is the one the gate above got wrong. If this parse ever
     * silently returns NaN the tinted rows become `NaN`-weighted mixes and stop
     * measuring anything, so the parse is asserted as well as used — and the
     * palette must be non-empty, or the `it.each` spread contributes no rows at
     * all and the whole clip-body case vanishes without a single failure.
     */
    it('parses the clip tint weight out of ArrangementSurface.css and knows the palette', () => {
        expect(CLIP_TINT_WEIGHT).toBeGreaterThan(0);
        expect(CLIP_TINT_WEIGHT).toBeLessThanOrEqual(1);
        expect(TRACK_TINT_KEYS.length).toBe(TRACK_TINTS.length);
        expect(TRACK_TINT_KEYS.length).toBeGreaterThan(0);
        for (const key of TRACK_TINT_KEYS) expect(Object.keys(light.color)).toContain(key);
    });

    /*
     * And the reason this row is not the one it replaced: the clip ground is
     * genuinely a different colour from the lane. `--timeline-clip-bg` equals
     * `--timeline-lane-bg` in both themes, so without the tint mixed in, "a clip
     * body" was a second copy of the white-key row.
     */
    it('measures a clip ground that is not simply the lane again', () => {
        for (const theme of [light, dark] as ThemeFile[]) {
            const lane = rgb(value(theme, 'timelineClipBg'));
            for (const tint of TRACK_TINT_KEYS) {
                const tinted = mixOklab(value(theme, tint), value(theme, 'timelineClipBg'), CLIP_TINT_WEIGHT);
                expect(tinted.some((channel, index) => Math.abs(channel - lane[index]!) > 1)).toBe(true);
            }
        }
    });
});

describe('theme token schema', () => {
    it('declares the same digit-free key set in both themes', () => {
        const keys = Object.keys(light.color).sort();
        expect(Object.keys(dark.color).sort()).toEqual(keys);
        expect(keys.filter((key) => /\d/.test(key))).toEqual([]);
    });
});
