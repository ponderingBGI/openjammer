/**
 * The two STATIC web surfaces — `public/download` and `apps/docs` — carry the
 * New DNA palette as a stylesheet, because neither has React and therefore
 * neither has `applyTheme()` to inject the semantic tokens at runtime.
 *
 * That transcription is the only place the palette can drift silently, so this
 * gate reads the DTCG sources (`packages/oj-tokens/tokens/`) and asserts, value
 * for value, that both sheets still say what the tokens say — in BOTH themes,
 * through BOTH selection mechanisms (`prefers-color-scheme` and `[data-theme]`).
 *
 * On the pre-fix code these sheets did not exist at all and both surfaces
 * carried a private literal palette (`--oj-blue: #4A90C2`, the value DESIGN.md
 * §2 names as stale), so every assertion below fails.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import light from '../../../packages/oj-tokens/tokens/themes/light.json';
import dark from '../../../packages/oj-tokens/tokens/themes/dark.json';
import { renderStaticTokenSheet, STATIC_TOKEN_SHEETS } from '../../../packages/oj-tokens/staticSheet.mjs';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const SHEETS = {
    'public/download/oj-tokens.css': read('public/download/oj-tokens.css'),
    'apps/docs/src/styles/oj-tokens.css': read('apps/docs/src/styles/oj-tokens.css'),
} as const;

const PRIMITIVES = read('packages/oj-tokens/dist/variables.css');

const camelToKebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Every `--name: value` pair inside the first block that follows `selector`. */
function blockAfter(sheet: string, selector: string): Record<string, string> {
    const at = sheet.indexOf(selector);
    if (at < 0) return {};
    const open = sheet.indexOf('{', at + selector.length);
    const close = sheet.indexOf('}', open);
    const out: Record<string, string> = {};
    for (const line of sheet.slice(open + 1, close).split('\n')) {
        const m = /^\s*(--[\w-]+):\s*(.+?);\s*$/.exec(line);
        if (m) out[m[1]!] = m[2]!;
    }
    return out;
}

const expected = (theme: typeof light) =>
    Object.fromEntries(
        Object.entries(theme.color).map(([key, token]) => [`--${camelToKebab(key)}`, token.$value]),
    );

describe.each(Object.entries(SHEETS))('%s', (_name, sheet) => {
    it.each([
        // The default `:root` is light; the OS preference and the explicit
        // attribute both get a full, independent copy of the other theme.
        // (The sheet's FIRST `:root` is the theme-invariant primitives, so the
        // light block is addressed through its own comment marker.)
        ['/* Light — the default theme. */', light, 'light'],
        ['@media (prefers-color-scheme: dark)', dark, 'dark'],
        ["[data-theme='dark']", dark, 'dark'],
        ["[data-theme='light']", light, 'light'],
    ] as const)('%s declares the whole %s palette, value for value', (selector, theme, _label) => {
        const declared = blockAfter(sheet, selector);
        expect(declared).toEqual(expected(theme));
    });

    it('carries the theme-invariant primitives verbatim', () => {
        for (const line of PRIMITIVES.split('\n')) {
            const m = /^\s*(--[\w-]+):\s*(.+?);\s*$/.exec(line);
            if (m) expect(sheet).toContain(`${m[1]}: ${m[2]};`);
        }
    });

    it('names no colour the tokens do not', () => {
        // Every literal in the sheet has to be a token value. Anything else is a
        // hand-typed colour, which is the exact failure this file exists to stop.
        const known = new Set([
            ...Object.values(light.color).map((t) => t.$value),
            ...Object.values(dark.color).map((t) => t.$value),
        ]);
        const literals = sheet.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi) ?? [];
        for (const literal of literals) {
            expect([...known].some((value) => value.includes(literal))).toBe(true);
        }
    });
});

describe('public/download/index.html', () => {
    const html = read('public/download/index.html');

    it('declares both colour schemes', () => {
        expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    });

    it('pins each theme-color to that theme\'s --bg-canvas', () => {
        // `theme-color` cannot take a custom property, so these two literals are
        // the only hand-written colours on the surface — and they are pinned.
        for (const [theme, tokens] of [['light', light], ['dark', dark]] as const) {
            expect(html).toContain(
                `<meta name="theme-color" content="${tokens.color.bgCanvas.$value}" media="(prefers-color-scheme: ${theme})" />`,
            );
        }
    });

    it('loads the token sheet before the page styles', () => {
        expect(html.indexOf('/download/oj-tokens.css')).toBeGreaterThan(-1);
        expect(html.indexOf('/download/oj-tokens.css')).toBeLessThan(
            html.indexOf('/download/download.css'),
        );
    });
});

/*
 * W6-UI item 11 — AND THE TRANSCRIPTION IS NOT A TRANSCRIPTION ANY MORE.
 *
 * The two sheets above started life as a hand-run scratch emitter, which is a
 * second copy of the palette by another name (covenant #2: extend, never fork —
 * and #7: after a migration, keep no parallel path). The renderer now lives in
 * `packages/oj-tokens/staticSheet.mjs`, `bun run tokens` calls it, and this gate
 * calls the SAME function: the committed file has to be byte-identical to a
 * fresh render, header and whitespace included. A stale sheet is red here; a
 * hand-edit is red here; a value that drifts is red both here and above.
 */
describe('the static sheets are generated, not transcribed', () => {
    const primitives = PRIMITIVES.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trimEnd();
    const colors = (theme: typeof light) =>
        Object.fromEntries(Object.entries(theme.color).map(([key, token]) => [key, token.$value]));

    it.each(STATIC_TOKEN_SHEETS.map((sheet) => [sheet.path, sheet.surface]))(
        '%s is byte-identical to a fresh `bun run tokens`',
        (path, surface) => {
            expect(read(path)).toBe(
                renderStaticTokenSheet(surface, primitives, colors(light), colors(dark)),
            );
        },
    );

    it('emits both sheets the build knows about, and no orphan emitter is left', () => {
        expect(STATIC_TOKEN_SHEETS.map((sheet) => sheet.path)).toEqual(Object.keys(SHEETS));
        const build = read('packages/oj-tokens/build.mjs');
        expect(build, 'the build has to be the thing that writes them').toContain('renderStaticTokenSheet');
        expect(build).toContain('STATIC_TOKEN_SHEETS');
    });
});
