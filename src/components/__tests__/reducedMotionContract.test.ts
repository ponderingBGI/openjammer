/**
 * W6-SHIP item 8 — what a `prefers-reduced-motion: reduce` block may contain.
 *
 * The branch's reduced-motion behaviour was audited and passed: under `reduce`,
 * `document.getAnimations()` returns `[]` on the canvas, the arrangement, both
 * palette surfaces and fresh onboarding, and every rule substitutes a STATIC
 * equivalent rather than dropping the meaning (the cold-load pulse becomes a fixed
 * ring, the recording dot holds `opacity: 1`, the recording waveform switches to
 * `--accent-danger`). That is the part most codebases get wrong and it is worth
 * keeping.
 *
 * Two smaller things were not right, and both are the kind that come back:
 *
 *  1. An EMPTY `@media (prefers-reduced-motion: reduce) { }` block shipped. Dead
 *     CSS in the one place a reader goes to find out what the app does when a
 *     player asks for less motion.
 *  2. `Slider.css` RE-ADDED `transition: box-shadow var(--motion-fast)` inside a
 *     `reduce` block — the only rule in the app that put motion back under the
 *     preference. The global clamp in `global.css` zeroed it again immediately, so
 *     it bought nothing and read as an exemption.
 *
 * Both are now closed as CLASSES rather than as instances, because "we removed the
 * one we found" is how the second one gets written.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function cssFiles(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : cssFiles(path);
        return path.endsWith('.css') ? [path] : [];
    });
}

const SHEETS = ['src', 'packages/oj-ui/src']
    .flatMap((root) => cssFiles(join(process.cwd(), root)))
    .map((path) => ({ path: path.slice(process.cwd().length + 1).replace(/\\/g, '/'), css: readFileSync(path, 'utf8') }));

/** The body of every `@media` at-rule in a sheet, brace-matched. */
function mediaBlocks(css: string): { query: string; body: string }[] {
    const blocks: { query: string; body: string }[] = [];
    for (const match of css.matchAll(/@media([^{]*)\{/g)) {
        let index = match.index! + match[0].length;
        let depth = 1;
        while (index < css.length && depth > 0) {
            if (css[index] === '{') depth += 1;
            else if (css[index] === '}') depth -= 1;
            index += 1;
        }
        blocks.push({ query: match[1]!.trim(), body: css.slice(match.index! + match[0].length, index - 1) });
    }
    return blocks;
}

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('reduced-motion blocks', () => {
    it('ships no empty at-rule or rule anywhere', () => {
        const offenders = SHEETS.flatMap(({ path, css }) =>
            [...withoutComments(css).matchAll(/([^{}]+)\{\s*\}/g)].map((m) => `${path}: ${m[1]!.trim().replace(/\s+/g, ' ')}`),
        );
        expect(offenders).toEqual([]);
    });

    it('never RE-ADDS a transition or an animation under reduce', () => {
        // Under the preference a block may say `none`, or substitute a static
        // equivalent (a fixed transform, an opacity, a box-shadow VALUE) — it may
        // not hand back a duration. `--motion-*` in a `transition`/`animation`
        // shorthand inside a reduce block is exactly that.
        const offenders: string[] = [];
        for (const { path, css } of SHEETS) {
            for (const block of mediaBlocks(withoutComments(css))) {
                if (!/prefers-reduced-motion:\s*reduce/.test(block.query)) continue;
                for (const [, property, value] of block.body.matchAll(/(transition|animation)(?:-duration)?:\s*([^;]+);/g)) {
                    if (/^\s*none\b/.test(value!)) continue;
                    // A duration is fine if it is effectively instant. The global
                    // clamp in `global.css` writes `.01ms !important`, which IS the
                    // rule this gate exists to protect, not a violation of it.
                    const durations = [...value!.matchAll(/([\d.]+)(ms|s)\b/g)]
                        .map(([, amount, unit]) => Number(amount) * (unit === 's' ? 1000 : 1));
                    if (durations.length && durations.every((ms) => ms <= 1)) continue;
                    offenders.push(`${path}: ${property}: ${value!.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('still exempts the signal-carrying motion the global rule protects', () => {
        // The blanket clamp deliberately spares `.oj-cable` and `.oj-meter`: those
        // move because sound is moving, so silencing them would make the app LESS
        // honest, not more restful. Pinned so a future tidy-up cannot "simplify"
        // the selector and go deaf.
        const global = readFileSync(join(process.cwd(), 'src/styles/global.css'), 'utf8');
        expect(global).toContain(':not(.oj-cable)');
        expect(global).toContain(':not(.oj-meter)');
    });
});
