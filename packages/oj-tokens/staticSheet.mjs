/**
 * THE STATIC WEB SURFACES' TOKEN SHEET — one renderer, used twice.
 *
 * `public/download` and `apps/docs` have no React, so they have no
 * `applyTheme()` to inject the semantic colours at runtime: they need the whole
 * palette as a stylesheet. That transcription used to be a throwaway script run
 * by hand, which is a second copy of the tokens by any other name (covenant #2:
 * extend, never fork). It lives here instead, it is called by `build.mjs`, and
 * `bun run tokens` is the only thing that writes those two files.
 *
 * Both themes ship, selected two ways: the OS preference
 * (`prefers-color-scheme`) and an explicit `[data-theme]` on the root, so a
 * toggle always wins over the OS.
 *
 * The same function is imported by
 * `src/components/__tests__/webSurfaceTokens.test.ts`, which asserts the
 * committed files are byte-identical to a fresh render — so a stale sheet is a
 * red test, not a silent drift, and the gate cannot agree with itself by
 * restating the emitter.
 */

const camelToKebab = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const block = (colors, indent) =>
    Object.entries(colors)
        .map(([key, value]) => `${indent}--${camelToKebab(key)}: ${value};`)
        .join('\n');

/**
 * @param {string} surface   human name for the header comment
 * @param {string} primitives the theme-invariant `:root` block, header stripped
 * @param {Record<string,string>} light  resolved light colours (camelCase -> value)
 * @param {Record<string,string>} dark   resolved dark colours
 * @returns {string} the whole stylesheet, deterministic and newline-stable
 */
export function renderStaticTokenSheet(surface, primitives, light, dark) {
    return (
        `/*
 * OpenJammer design tokens — ${surface}.
 *
 * GENERATED from the DTCG sources in packages/oj-tokens/tokens/ (primitive.json
 * + themes/{light,dark}.json) by packages/oj-tokens/build.mjs. This surface is
 * static: it has no React and no applyTheme() to inject the semantic values at
 * runtime, so they ship here as a stylesheet instead. DO NOT HAND-EDIT — run
 * \`bun run tokens\`. src/components/__tests__/webSurfaceTokens.test.ts asserts
 * this file is byte-identical to a fresh render, so a palette move turns that
 * test red instead of drifting silently.
 *
 * Two themes, selected two ways: the OS preference (prefers-color-scheme) and an
 * explicit [data-theme] on the root, so a toggle can override the OS.
 */

` +
        primitives +
        '\n\n/* Light — the default theme. */\n:root {\n' +
        block(light, '    ') +
        '\n}\n\n/* Dark, when the OS asks for it. */\n@media (prefers-color-scheme: dark) {\n    :root {\n' +
        block(dark, '        ') +
        "\n    }\n}\n\n/* An explicit choice always wins over the OS preference. */\n:root[data-theme='dark'] {\n" +
        block(dark, '    ') +
        "\n}\n\n:root[data-theme='light'] {\n" +
        block(light, '    ') +
        '\n}\n'
    );
}

/** Where each sheet lands, relative to the repo root, and how it names itself. */
export const STATIC_TOKEN_SHEETS = [
    { path: 'public/download/oj-tokens.css', surface: 'public/download' },
    { path: 'apps/docs/src/styles/oj-tokens.css', surface: 'apps/docs (Starlight)' },
];
