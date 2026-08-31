/**
 * W6-UI — the oj-ui gates three reviews in a row asked for and no lane owned.
 *
 * Four of the five "oj-ui claims" in `W5-P7-REVIEW.md` §4 are contrast or type
 * decisions that live in a stylesheet, and a stylesheet is the one place a
 * measurement can rot without a single test going red. So the numbers are
 * computed here, from the DTCG token sources, against the ground each mark is
 * actually painted on — not copied out of a report.
 *
 * On the pre-fix code every gate in this file fails:
 *   - `WaveformView.css` said `--border-subtle` (1.31:1 light / 1.27:1 dark)
 *   - `Meter.css` said `--accent-success` (2.61:1 light on the meter bed)
 *   - `Chip.css` said a literal `12px`, below DESIGN.md §3's 13px floor
 *   - `TransportPill.css` drew the record dot with a 2px ink border
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Color from 'colorjs.io';
import light from '../../../../oj-tokens/tokens/themes/light.json';
import dark from '../../../../oj-tokens/tokens/themes/dark.json';
import { Waveform } from '../Waveform/Waveform';

const css = (name: string) =>
    readFileSync(`packages/oj-ui/src/components/${name}`, 'utf8');

type RGB = [number, number, number];
type ColorKey = keyof typeof light.color;
type ThemeFile = { color: Record<ColorKey, { $value: string }> };

const rgb = (value: string): RGB =>
    new Color(value).to('srgb').coords.map((channel) => Math.max(0, Math.min(1, channel)) * 255) as RGB;
const luminance = ([r, g, b]: RGB) =>
    [r, g, b]
        .map((channel) => channel / 255)
        .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
const ratio = (a: RGB, b: RGB) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const contrast = (theme: ThemeFile, foreground: ColorKey, background: ColorKey) =>
    ratio(rgb(theme.color[foreground].$value), rgb(theme.color[background].$value));

const THEMES = [
    ['light', light as ThemeFile],
    ['dark', dark as ThemeFile],
] as const;

describe('WaveformView — the clip edge is a content boundary', () => {
    const sheet = css('WaveformView/WaveformView.css');

    it('draws its edge with the timeline clip-border token, not the chrome hairline', () => {
        expect(sheet).toMatch(/\.oj-waveform-view\s*{[^}]*border:\s*1px solid var\(--timeline-clip-border\);/s);
        expect(sheet, 'the subtle hairline was the 1.3:1 edge').not.toMatch(/\.oj-waveform-view\s*{[^}]*border:\s*1px solid var\(--border-subtle\);/s);
    });

    /*
     * WCAG 1.4.11: the boundary of a meaningful graphical object is a non-text
     * contrast case, 3:1 against what is adjacent. The card sits on `--bg-node`
     * and, in the Sampler, on the canvas behind it — both are measured.
     */
    it.each(THEMES)('clears 3:1 on both adjacent grounds in %s', (_name, theme) => {
        expect(contrast(theme, 'timelineClipBorder', 'bgNode')).toBeGreaterThanOrEqual(3);
        expect(contrast(theme, 'timelineClipBorder', 'bgCanvas')).toBeGreaterThanOrEqual(3);
        // ...and the token it replaces would not have.
        expect(contrast(theme, 'borderSubtle', 'bgNode')).toBeLessThan(3);
    });
});

describe('Meter — the lit bar is a readout', () => {
    const sheet = css('Meter/Meter.css');

    it('fills with the success INK, and the bed and the clip latch are unchanged', () => {
        expect(sheet).toContain('background: var(--success-ink);');
        expect(sheet, 'the bed stays the inset tone').toContain('background: var(--bg-tertiary);');
        expect(sheet, 'clipping stays the danger accent').toContain('background: var(--accent-danger);');
    });

    /*
     * Three states have to stay three: the bed a meter rests at, the lit bar,
     * and the latched clip. Only the first pair carries a WCAG floor (the lit
     * bar is the mark, the bed is its ground); the second pair only has to be
     * TELLABLE APART, which is why it is asserted at a lower bar — a clipping
     * meter is also red, animated and latched.
     */
    it.each(THEMES)('keeps lit-vs-bed above 3:1 and lit-vs-clipping legible in %s', (_name, theme) => {
        expect(contrast(theme, 'successInk', 'bgTertiary')).toBeGreaterThanOrEqual(3);
        expect(ratio(rgb(theme.color.successInk.$value), rgb(theme.color.accentDanger.$value))).toBeGreaterThan(1.3);
    });

    /*
     * The claim is a LIGHT-theme one and it should stay that way in the record:
     * `--accent-success` reads fine on the dark bed (5.91) and fails on the
     * light one (2.61), which is exactly why a token that flips with the theme
     * was the fix rather than a nudge to the accent.
     */
    it('records that the accent it replaces failed in light and passed in dark', () => {
        expect(contrast(light as ThemeFile, 'accentSuccess', 'bgTertiary')).toBeLessThan(3);
        expect(contrast(dark as ThemeFile, 'accentSuccess', 'bgTertiary')).toBeGreaterThanOrEqual(3);
    });
});

describe('Chip — the 13px floor', () => {
    const sheet = css('Chip/Chip.css');

    it('sets its label from the scale, with no bare pixel literal left', () => {
        expect(sheet).toContain('font-size: var(--text-sm);');
        expect(sheet, 'DESIGN.md §3: Field is the ONE 12px sans exception').not.toMatch(/font-size:\s*12px/);
    });

    it('keeps the count in mono, where the floor does not apply', () => {
        expect(sheet).toMatch(/\.oj-chip__count\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
        expect(sheet).toMatch(/\.oj-chip__count\s*{[^}]*font-size:\s*var\(--text-xs\)/s);
    });

    it('is what DESIGN.md §5 now says', () => {
        const design = readFileSync('DESIGN.md', 'utf8');
        expect(design).toMatch(/\*\*Chip\*\* \(`\.oj-chip`\)[^\n]*13px\/600/);
        expect(design, '§5 must not still specify a 12px chip').not.toMatch(/\*\*Chip\*\* \(`\.oj-chip`\)[^\n]*12px\/600/);
    });
});

/*
 * THE SECOND PLACE §5 AND §3 DISAGREED. A menu category header was a 10.5px
 * SANS run: off the primitive scale entirely, and below the 13px floor that only
 * `Field` is excused from. 13px sans would have made the header as loud as the
 * 14px item it introduces, so the fix changes FACE, not size — `--text-micro`
 * is the voice the DNA already keeps for uppercase, tracked markers that NAME a
 * group, and the floor exempts mono by construction.
 *
 * On the pre-fix sheet the first two assertions fail and the last one passes,
 * which is the whole point of pinning the doc beside the stylesheet.
 */
describe('Menu category — the micro voice, not a sub-floor sans run', () => {
    const sheet = css('Menu/Menu.css');
    const rule = /\.oj-menu-category\s*{([^}]*)}/.exec(sheet)?.[1] ?? '';

    it('sets the mono face and the micro size together, from tokens', () => {
        expect(rule).toMatch(/font-family:\s*var\(--font-mono\);/);
        expect(rule).toMatch(/font-size:\s*var\(--text-micro\);/);
        expect(rule).toMatch(/letter-spacing:\s*var\(--tracking-micro\);/);
        expect(rule, 'uppercase is what makes the micro voice legible at 9.5px').toMatch(/text-transform:\s*uppercase;/);
    });

    it('leaves no 10.5px literal anywhere in the component library', () => {
        for (const file of ['Menu/Menu.css', 'Chip/Chip.css', 'ListRow/ListRow.css']) {
            expect(css(file), `${file} still hard-codes an off-scale size`).not.toMatch(/font-size:\s*10\.5px/);
        }
    });

    /*
     * A micro-label is still held to the full 4.5:1 body bar (DESIGN.md §3) —
     * small type is the case where contrast matters most, not least. The header
     * sits on the menu's own surface, which is `--bg-node`.
     */
    it.each(THEMES)('keeps the muted header at 4.5:1 on the menu surface in %s', (_name, theme) => {
        expect(contrast(theme, 'textMuted', 'bgNode')).toBeGreaterThanOrEqual(4.5);
    });

    it('is what DESIGN.md §5 now says', () => {
        const design = readFileSync('DESIGN.md', 'utf8');
        expect(design).toMatch(/category headers are the \*\*Micro voice\*\* \(`--text-micro`/);
        expect(design, '§5 must not still specify a 10.5px category header').not.toContain('10.5px/600 uppercase');
    });
});

describe('TransportPill — ink is capped at 1.5px', () => {
    const sheet = css('TransportPill/TransportPill.css');

    it('draws the record dot with a 1.5px ring and still fills it while recording', () => {
        expect(sheet).toContain('border: 1.5px solid var(--accent-danger);');
        expect(sheet, 'the DNA caps ink at 1.5px').not.toMatch(/border:\s*2px solid/);
        expect(sheet).toMatch(/\.oj-transport__record\.is-recording \.oj-transport__record-dot\s*{[^}]*background:\s*var\(--accent-danger\)/s);
        expect(sheet, 'the recording pulse survives').toMatch(/animation:\s*oj-transport-rec/);
    });
});

describe('Waveform — the extremes are painted, not clipped', () => {
    const sheet = css('Waveform/Waveform.css');

    /*
     * W5-P7 claimed the shared `Waveform` clips a full-scale sample; the gate
     * found `overflow: visible` and half-agreed. Both halves are pinned here so
     * the next reader does not have to re-litigate it: the mapping DOES put a
     * peak of 1.0 on the viewBox edge, and the stroke that hangs half its width
     * outside is painted because the svg does not clip. A future
     * `overflow: hidden` on this element would CREATE the bug the report feared.
     */
    it('maps a full-scale square wave onto the viewBox edges', () => {
        const { container } = render(<Waveform data={[1, -1, 1, -1, 1, -1]} aria-label="square" />);
        const points = container.querySelector('.oj-waveform__trace')!.getAttribute('points')!;
        const ys = points.split(' ').map((pair) => Number(pair.split(',')[1]));
        expect(Math.min(...ys)).toBe(0);
        expect(Math.max(...ys)).toBe(100);
    });

    it('does not clip that stroke', () => {
        expect(sheet).toMatch(/\.oj-waveform__svg\s*{[^}]*overflow:\s*visible/s);
        expect(sheet, 'the trace is a true 1.5px at any aspect').toMatch(/vector-effect:\s*non-scaling-stroke/);
    });
});
