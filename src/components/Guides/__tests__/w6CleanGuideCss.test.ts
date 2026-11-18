/**
 * W6-CLEAN #5 — the last three dead rules in `Guide.css`.
 *
 * `.guide-code`, `.guide-code-block` and `.guide-latency-unit` styled elements
 * the guides stopped rendering. Unlike the `ResizeHandles` / `PanelSeparator`
 * families they are NOT template-generated, so nothing can reach them: they were
 * bytes shipped to every player for markup that does not exist (code value #8 —
 * every production line is used).
 *
 * The guard is two-sided on purpose: the rule must be gone from the stylesheet
 * AND the class must be absent from the source, so re-adding one without the
 * other fails here rather than in a browser.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GUIDES_DIR = resolve(process.cwd(), 'src/components/Guides');
const GUIDE_CSS = readFileSync(join(GUIDES_DIR, 'Guide.css'), 'utf8');

const RETIRED = ['guide-code', 'guide-code-block', 'guide-latency-unit'] as const;

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

const GUIDE_SOURCE = sourceFiles(GUIDES_DIR)
    .filter((file) => !file.includes('__tests__'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

describe('W6-CLEAN — Guide.css ships no rule nothing can reach', () => {
    it.each(RETIRED)('has no `.%s` rule left in the stylesheet', (name) => {
        expect(GUIDE_CSS).not.toMatch(new RegExp(`\\.${name}\\b`));
    });

    it.each(RETIRED)('renders no `%s` element either', (name) => {
        expect(GUIDE_SOURCE).not.toContain(name);
    });

    it('kept the rules the guides DO use', () => {
        // A guard against an over-eager delete: these three carry live state.
        expect(GUIDE_CSS).toContain('.guide-latency-value.good');
        expect(GUIDE_CSS).toContain('.guide-step.in-progress');
        expect(GUIDE_CSS).toContain('.guide-external-link');
    });
});
