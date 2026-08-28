import { describe, expect, it } from 'vitest';
import Color from 'colorjs.io';
import light from '../../../../packages/oj-tokens/tokens/themes/light.json';
import dark from '../../../../packages/oj-tokens/tokens/themes/dark.json';

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

describe('theme token schema', () => {
    it('declares the same digit-free key set in both themes', () => {
        const keys = Object.keys(light.color).sort();
        expect(Object.keys(dark.color).sort()).toEqual(keys);
        expect(keys.filter((key) => /\d/.test(key))).toEqual([]);
    });
});
