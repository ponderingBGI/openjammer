/**
 * W6-CAP D4 — the 13px sans floor, in the four shipped surfaces that broke it.
 *
 * DESIGN.md §3: `--text-xs` (11px) and `--text-micro` (9.5px) exist ONLY for
 * uppercase JetBrains Mono micro-labels, where the letterforms are wide and
 * spaced and still held to the full 4.5:1 body bar. Functional sans text never
 * goes below `--text-sm` (13px); `Field`'s 12px label is the one documented
 * exception, and it lives in oj-ui.
 *
 * W6-CAP measured five sans runs at 11px across four panels — Settings section
 * captions, Safe Mode's actions ("Open a different project", "Send a report",
 * and the onboarding footer's "Skip, take me in"), the Help panel's mode chip
 * and honesty copy, and the plugin window strip's "on <node>" / "Unsaved". All
 * five are prose or an actionable label, not a micro-label, so all five lift to
 * the floor rather than changing face.
 *
 * The rule this pins is deliberately strict: a block that sets a sub-13px size
 * must SAY it is mono, in the same block. Inheritance is invisible to a reader
 * and to this gate, and "it happens to inherit mono from an ancestor" is exactly
 * how an 11px sans run gets shipped.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHEETS = [
    'src/components/Settings/SettingsPanel.css',
    'src/components/SafeMode/SafeModeScreen.css',
    'src/components/Toolbar/HelpPanel.css',
    'src/components/Plugins/PluginWindowShell.css',
] as const;

/** `selector { … }` pairs, comments stripped so a comment can quote a token. */
function rules(css: string): { selector: string; body: string }[] {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selector: m[1]!.trim().replace(/\s+/g, ' '),
        body: m[2]!,
    }));
}

const MICRO = /font-size:\s*var\(--text-(xs|micro)\)|font-size:\s*(9\.5|1[012])px/;

describe.each(SHEETS)('%s', (path) => {
    const css = readFileSync(resolve(process.cwd(), path), 'utf8');

    it('sets no sub-13px size without declaring the mono face beside it', () => {
        const offenders = rules(css)
            .filter((rule) => MICRO.test(rule.body))
            .filter((rule) => !/font-family:\s*var\(--font-mono\)/.test(rule.body))
            .map((rule) => rule.selector);
        expect(offenders).toEqual([]);
    });

    it('names only sizes that are on the scale', () => {
        // 30 / 22 / 15 / 14 / 13 sans, 11 / 9.5 mono — through their tokens.
        for (const [, value] of css.matchAll(/font-size:\s*([^;]+);/g)) {
            expect(value.trim()).toMatch(
                /^var\(--text-(2xl|xl|lg|md|sm|xs|micro)\)$|^(30|22|15|14|13|11|9\.5)px$|^inherit$|^1em$/,
            );
        }
    });
});
