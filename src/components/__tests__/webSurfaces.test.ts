/**
 * The two public web surfaces speak the New DNA — `public/download` (a static
 * page with no build step) and `apps/docs` (the Starlight site).
 *
 * They live outside `src/`, which is exactly why they were the last two places
 * the retired Living Sketchbook survived (W6-CAP D1/D2: a private `#4A90C2`
 * palette, 2px ink borders, three zero-blur offset shadows, and a
 * `<meta color-scheme="light">` that gave the download page no dark theme at
 * all). This gate parses the shipped stylesheets and holds them to the same
 * three rules the app is held to:
 *
 *   1. tokens only — a literal colour in a styling sheet is a bug;
 *   2. hairlines only — 1px, 1.5px at the very most, never a 2px ink border;
 *   3. soft layered depth — never a zero-blur offset shadow.
 *
 * Every assertion here fails on the pre-fix files.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/** Comments carry the reasoning (and name the retired values); code is judged. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `<style>` body of an Astro component — its only styling surface. */
const astroStyle = (source: string) =>
    /<style>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? '';

const SURFACES = {
    'public/download/download.css': stripComments(read('public/download/download.css')),
    'apps/docs/src/styles/custom.css': stripComments(read('apps/docs/src/styles/custom.css')),
    'apps/docs/src/components/Hero.astro': stripComments(
        astroStyle(read('apps/docs/src/components/Hero.astro')),
    ),
} as const;

describe.each(Object.entries(SURFACES))('%s', (_name, css) => {
    it('names no literal colour — every value is a token', () => {
        // `@font-face` and layout are colour-free, so any hex / rgb() / oklch()
        // outside `var(--…)` is a hand-typed colour.
        expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
        expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
        expect(css.match(/\boklch\(/g) ?? []).toEqual([]);
    });

    it('draws no border wider than the 1.5px maximum', () => {
        const widths = [...css.matchAll(/border[\w-]*:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
        for (const width of widths) expect(width).toBeLessThanOrEqual(1.5);
        expect(css).not.toMatch(/\b2px solid\b/);
        // Starlight's asides ship a 4px inline-start bar; the New DNA has no
        // side stripe, so if this file touches that width it flattens it.
        const inlineStart = /border-inline-start-width:\s*([\d.]+)px/.exec(css);
        if (inlineStart) expect(Number(inlineStart[1])).toBeLessThanOrEqual(1.5);
    });

    it('writes no zero-blur offset shadow', () => {
        // `2px 3px 0 …` — the retired sticker shadow. Depth is soft and layered,
        // so a shadow either comes from a token or does not exist.
        for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
            if (value.trim() === 'none') continue;
            expect(value).toMatch(/var\(--(shadow-|focus-ring)/);
        }
        expect(css).not.toMatch(/\d+px\s+\d+px\s+0(\s|,|;|\))/);
    });

    it('uses no display face — Outfit and JetBrains Mono only, through the tokens', () => {
        for (const [, value] of css.matchAll(/font-family:\s*([^;]+);/g)) {
            if (value.includes('@font-face')) continue;
            expect(value).toMatch(/var\(--font-(sans|mono)\)|inherit|'Outfit'|'JetBrains Mono'/);
        }
        expect(css).not.toMatch(/Caveat|cursive/i);
    });
});

describe('both colour schemes ship', () => {
    it.each([
        'public/download/oj-tokens.css',
        'apps/docs/src/styles/oj-tokens.css',
    ])('%s answers the OS preference and an explicit choice', (path) => {
        const css = read(path);
        expect(css).toContain('@media (prefers-color-scheme: dark)');
        expect(css).toContain("[data-theme='dark']");
        expect(css).toContain("[data-theme='light']");
    });

    it('apps/docs maps Starlight onto the tokens once, not twice', () => {
        // ONE mapping serves both themes because every right-hand side is a
        // token that flips itself. A second, hand-maintained dark block is the
        // shape the old file had, and the shape that drifted.
        const css = stripComments(read('apps/docs/src/styles/custom.css'));
        expect(css).toContain("@import './oj-tokens.css';");
        for (const [, , value] of css.matchAll(/(--sl-[\w-]+):\s*([^;]+);/g)) {
            expect(value).toMatch(/var\(--|color-mix\(/);
        }
        expect(css).not.toMatch(/:root\[data-theme=/);
    });

    it('apps/docs points Starlight\'s shadow scale at the depth tokens', () => {
        const css = stripComments(read('apps/docs/src/styles/custom.css'));
        for (const name of ['--sl-shadow-sm', '--sl-shadow-md', '--sl-shadow-lg']) {
            expect(new RegExp(`${name}:\\s*var\\(--shadow-(raised|overlay)\\)`).test(css)).toBe(true);
        }
    });
});

/**
 * DESIGN.md §3 makes ONE blanket reduced-motion rule a structural floor, next to
 * the one focus ring and the 13px floor. Neither web surface loads
 * `src/styles/global.css`, so each has to carry its own copy — and the docs sheet
 * did not, which left `.sl-link-button.primary`'s colour + press-scale
 * transitions running under `prefers-reduced-motion: reduce` (measured: 2 live
 * transitions on the docs home, both schemes).
 */
describe('the blanket reduced-motion rule', () => {
    it.each([
        'public/download/download.css',
        'apps/docs/src/styles/custom.css',
    ])('%s carries one, because it loads no global.css', (path) => {
        const css = stripComments(read(path));
        const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(at).toBeGreaterThanOrEqual(0);
        const rule = css.slice(at, css.indexOf('}', css.indexOf('}', at) + 1) + 1);
        // The universal selector with its two pseudo-elements — a rule scoped to
        // one class is not a blanket rule.
        expect(rule).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after/);
        expect(rule).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
        expect(rule).toMatch(/animation-iteration-count:\s*1\s*!important/);
        expect(rule).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
        expect(rule).toMatch(/scroll-behavior:\s*auto\s*!important/);
    });
});

/**
 * A rule that matches nothing is dead code that also tells a lie — the sheet's
 * own comment claimed "headings pinned to the token scale" while the page title
 * stayed at Starlight's 42px, off the 30/22/15/14/13 scale.
 */
describe('apps/docs — no dead selectors', () => {
    const css = stripComments(read('apps/docs/src/styles/custom.css'));

    it('pins the page title through the container it actually lives in', () => {
        // Starlight renders the title as `<h1 id="_top">` from `PageTitle`,
        // inside `ContentPanel` and ABOVE `.sl-markdown-content` — so the old
        // `.sl-markdown-content h1` matched 0 elements on every page.
        expect(css).not.toContain('.sl-markdown-content h1');
        expect(css).toContain('.content-panel h1');
        const rule = /\.content-panel h1\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(rule).toMatch(/font-size:\s*var\(--text-2xl\)/);
    });

    it('styles no bare `pre.astro-code` — code arrives through expressive-code only', () => {
        expect(css).not.toContain('pre.astro-code');
        expect(css).toContain('.expressive-code .frame');
    });
});

/**
 * `font-display: swap` paints the page in a fallback face and re-lays-out when
 * Outfit lands; that reflow was the whole of the download page's layout shift
 * (CLS 0.084 light / 0.069 dark before this). The faces are only discoverable
 * after the stylesheet parses — `custom.css` even reaches them through a nested
 * `@import` — so each surface's HEAD names them itself.
 */
describe('the self-hosted faces are preloaded', () => {
    // Each surface preloads exactly the faces it paints, which are NOT the same
    // two: walking every text run, the download page is Outfit + `JetBrains
    // Mono @ 500` (the version string and the chip) and never renders mono 400,
    // while every docs page renders mono 400 and only some render 500. A
    // preload for an unpainted face is a wasted fetch on the critical path.
    const DOWNLOAD_FACES = ['outfit-variable.woff2', 'jetbrains-mono-medium.woff2'];
    const DOCS_FACES = ['outfit-variable.woff2', 'jetbrains-mono-regular.woff2'];

    it('public/download/index.html preloads both', () => {
        const html = read('public/download/index.html');
        // Comments here name the face the page does NOT preload and why, so the
        // tags are read, not the prose.
        const head = html.slice(0, html.indexOf('</head>')).replace(/<!--[\s\S]*?-->/g, '');
        const preloaded = [...head.matchAll(/<link[^>]*rel="preload"[^>]*>/gs)]
            .map((m) => /href="([^"]*)"/.exec(m[0])?.[1] ?? '')
            .map((href) => href.split('/').pop());
        // Exactly the painted faces — no more (a preload for a face the page
        // never renders is a wasted fetch on the critical path).
        expect(preloaded.sort()).toEqual([...DOWNLOAD_FACES].sort());
        for (const face of DOWNLOAD_FACES) {
            const tag = new RegExp(`<link[^>]*${face}[^>]*>`, 's').exec(head)?.[0] ?? '';
            expect(tag).toMatch(/rel="preload"/);
            expect(tag).toMatch(/as="font"/);
            expect(tag).toMatch(/type="font\/woff2"/);
            // Required even same-origin: a font is always CORS-fetched, and
            // without it the preload is discarded and fetched a second time.
            expect(tag).toMatch(/\bcrossorigin\b/);
        }
    });

    it('apps/docs wires its own two through Starlight\'s head', () => {
        const config = read('apps/docs/astro.config.mjs');
        const preloaded = [...config.matchAll(/href:\s*'([^']*\.woff2)'/g)].map((m) =>
            m[1].split('/').pop(),
        );
        expect(preloaded.sort()).toEqual([...DOCS_FACES].sort());
        for (const face of DOCS_FACES) {
            const at = config.indexOf(face);
            expect(at).toBeGreaterThanOrEqual(0);
            const tag = config.slice(config.lastIndexOf('{', config.lastIndexOf('attrs', at)), at);
            expect(tag).toMatch(/rel:\s*'preload'/);
            expect(tag).toMatch(/as:\s*'font'/);
            expect(tag).toMatch(/type:\s*'font\/woff2'/);
            // Spelled out, not `true` — Astro renders `true` as the invalid
            // `crossorigin="true"`, which only works by the enumerated
            // attribute's invalid-value default.
            expect(tag).toMatch(/crossorigin:\s*'anonymous'/);
            // Starlight serves the site under `/openjammer`, like fonts.css's
            // own `src:` URLs — a root-relative preload would 404 in production.
            expect(config.slice(at - 40, at)).toContain('/openjammer/fonts/');
        }
    });
});

/**
 * The meta description is the page's brand line in a search result and a link
 * preview — the last place the retired system's own name survived.
 */
describe('public/download/index.html speaks the New DNA', () => {
    const html = read('public/download/index.html');
    const description =
        /<meta\s+name="description"\s+content="([^"]*)"/s.exec(html.replace(/\s+/g, ' '))?.[1] ?? '';

    it('names a real instrument, not a sketchbook canvas', () => {
        expect(description).not.toMatch(/sketchbook/i);
        expect(description).toMatch(/real instrument/i);
    });

    it('is one sentence, and still says both tiers honestly', () => {
        expect(description.length).toBeGreaterThan(60);
        // One terminal full stop, at the very end.
        expect(description.replace(/\.$/, '')).not.toContain('. ');
        expect(description).toMatch(/browser/i);
        expect(description).toMatch(/macOS|Windows|Linux/);
    });

    it('leaves no retired name anywhere in the page', () => {
        expect(html).not.toMatch(/Living Sketchbook|#4A90C2|oj-blue|oj-paper|oj-pine|oj-ochre/i);
    });
});

/**
 * The "Recommended" chip was the page's one surface-nested-inside-a-control: it
 * made "Apple Silicon" wider than its "Intel" peer so the row stopped reading as
 * a pair of equals, and its `--bg-node` fill read lifted in light but recessed in
 * dark. It is a caption above the pair now — in the static HTML and in the
 * enhanced card `download.js` builds, which must agree.
 */
describe('the Recommended chip is a caption, not a badge', () => {
    const html = read('public/download/index.html');
    const js = read('public/download/download.js');
    const css = stripComments(read('public/download/download.css'));

    it('sits outside every `.oj-btn`, in both the HTML and the JS', () => {
        const anchors = [...html.matchAll(/<a\b[^>]*class="oj-btn"[\s\S]*?<\/a>/g)].map((m) => m[0]);
        expect(anchors.length).toBeGreaterThan(0);
        for (const anchor of anchors) expect(anchor).not.toContain('oj-chip');
        expect(html).toMatch(/class="oj-pick"[\s\S]*?<span class="oj-chip">Recommended<\/span>/);
        // The JS builder appends the chip to a `<p class="oj-pick">`, never to
        // the anchor — `btn()` no longer takes a `recommended` option at all.
        expect(js).not.toMatch(/opts\.recommended/);
        expect(js).toMatch(/className = 'oj-pick'/);
    });

    it('wears the neutral inset and the mono micro voice', () => {
        const chip = /\.oj-chip\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(chip).toMatch(/background:\s*var\(--bg-tertiary\)/);
        expect(chip).toMatch(/color:\s*var\(--text-primary\)/);
        expect(chip).toMatch(/font-family:\s*var\(--font-mono\)/);
        expect(chip).toMatch(/font-size:\s*var\(--text-xs\)/);
    });

    it('lands the version line on the cards\' own left edge', () => {
        // One gutter, named once on `.oj-page`, so the two card paddings and the
        // version line that floats on the ground below them all agree.
        expect(css).toMatch(/\.oj-page\s*\{[^}]*--oj-card-pad:/);
        // Both card paddings and the version line all take it — three things
        // that read as one column used to begin in three places.
        expect((css.match(/var\(--oj-card-pad\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
        const version = /\.oj-version-line\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
        expect(version).toMatch(/padding-inline:\s*var\(--oj-card-pad\)/);
    });
});
