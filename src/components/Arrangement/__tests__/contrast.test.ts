import { describe, expect, it } from 'vitest';
import cream from '../../../../packages/oj-tokens/tokens/themes/cream.json';

type RGB = [number, number, number];
const hex = (value: string): RGB => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) as RGB;
const luminance = ([r, g, b]: RGB) => [r, g, b].map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
const ratio = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const blend = (foreground: RGB, background: RGB, alpha: number): RGB => foreground.map((channel, index) => channel * alpha + background[index]! * (1 - alpha)) as RGB;
const value = (key: keyof typeof cream.color) => cream.color[key].$value;

describe('Cream arrangement contrast floors', () => {
    it.each([
        ['textSecondary', 'timelineChromeBg', 4.5],
        ['timelineClipBorder', 'timelineClipBg', 3],
        ['timelineNoteFill', 'timelineClipBg', 3],
        ['timelinePlayhead', 'timelineLaneBg', 3],
        ['timelinePlayhead', 'timelineClipBg', 3],
    ] as const)('%s clears its floor against %s', (foreground, background, floor) => {
        expect(ratio(hex(value(foreground)), hex(value(background)))).toBeGreaterThanOrEqual(floor);
    });

    it('keeps selection at the signed-off near-3:1 value and supplies an ink structural cue', () => {
        expect(ratio(hex(value('timelineSelection')), hex(value('timelineClipBg')))).toBeGreaterThanOrEqual(2.9);
        expect(ratio(hex(value('sketchBlack')), hex(value('timelineClipBg')))).toBeGreaterThanOrEqual(3);
    });

    it('keeps the bar rhythm at 1.5:1 against the lane', () => {
        const bar = blend(hex('#1A1A1A'), hex(value('timelineLaneBg')), 0.24);
        expect(ratio(bar, hex(value('timelineLaneBg')))).toBeGreaterThanOrEqual(1.5);
    });
});
