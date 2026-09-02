import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function cssFiles(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
    });
}

/**
 * The SOURCE files of a surface, tests excluded.
 *
 * The gate below used to scan `.css` only. That is why `#4A90C2` — the blue this
 * branch's own `5b412f5` retired, and which `AGENTS.md` and `DESIGN.md` both name
 * as the example of a stale literal — shipped for a whole redesign inside
 * `TrackLaneView.tsx`: a colour written in TSX was simply outside the gate's file
 * glob. Colour does not become less of a colour for being typed in a component,
 * so the glob now follows the surface, not the extension.
 */
function sourceFiles(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.tsx?$/.test(path) ? [path] : [];
    });
}

/** Any authored colour literal: hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`. */
const COLOR_LITERAL = /#[\da-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i;

function customProperties(source: string, pattern: RegExp): Set<string> {
    return new Set([...source.matchAll(pattern)].map((match) => match[1]!));
}

const SURFACE_ROOTS = ['src/components/Arrangement', 'src/components/Export', 'src/components/Plugins', 'src/components/Bench'];

/**
 * The ONE colour literal the arrangement is allowed to author, and it is not a
 * colour choice: `#000000` is the HTML default `value` of `<input type="color">`,
 * used only when there is no DOM to resolve `--track-tint` against. Named here
 * so adding a second exception is a deliberate edit to the gate, not a silence.
 */
const SANCTIONED_LITERALS = new Map<string, readonly string[]>([
    ['src/components/Arrangement/trackTint.ts', ['#000000']],
]);

describe('Arrangement semantic color gate', () => {
    it('contains no hex, rgb, rgba, hsl, or hsla literals', () => {
        const root = join(process.cwd(), 'src/components/Arrangement');
        const offenders = cssFiles(root).filter((path) => COLOR_LITERAL.test(readFileSync(path, 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('authors no colour literal in TS/TSX either — the glob follows the surface', () => {
        // `#4A90C2` shipped in `TrackLaneView.tsx` for the whole New DNA redesign
        // because this gate only ever opened `.css` files. A colour is a colour
        // wherever it is typed.
        const offenders: string[] = [];
        for (const root of SURFACE_ROOTS) {
            for (const path of sourceFiles(join(process.cwd(), root))) {
                const relative = path.slice(process.cwd().length + 1).replace(/\\/g, '/');
                const sanctioned = SANCTIONED_LITERALS.get(relative) ?? [];
                const source = readFileSync(path, 'utf8')
                    // Strip only what this file is explicitly allowed to name.
                    .split(sanctioned.length ? new RegExp(sanctioned.join('|'), 'g') : /\0/)
                    .join('');
                if (COLOR_LITERAL.test(source)) offenders.push(relative);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('names the retired blue nowhere in the app or the design system', () => {
        // AGENTS.md §"Port types and colors" and DESIGN.md §2 both say this hex is
        // stale. Said once here so it cannot come back through any file type.
        const offenders: string[] = [];
        for (const root of ['src', 'packages/oj-ui/src']) {
            const base = join(process.cwd(), root);
            for (const path of [...sourceFiles(base), ...cssFiles(base)]) {
                if (/#4a90c2/i.test(readFileSync(path, 'utf8'))) {
                    offenders.push(path.slice(process.cwd().length + 1).replace(/\\/g, '/'));
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('uses no undeclared CSS variables in Arrangement or Export', () => {
        const roots = ['src/components/Arrangement', 'src/components/Export', 'src/components/Plugins', 'src/components/Bench'].map((root) => join(process.cwd(), root));
        const files = roots.flatMap(cssFiles);
        const sources = files.map((path) => readFileSync(path, 'utf8'));
        const generated = readFileSync(join(process.cwd(), 'packages/oj-ui/oj-tokens.css'), 'utf8');
        const defined = customProperties([generated, ...sources].join('\n'), /(--[\w-]+)\s*:/g);
        const used = sources.flatMap((source) => [...customProperties(source, /var\(\s*(--[\w-]+)/g)]);
        expect([...new Set(used)].filter((name) => !defined.has(name))).toEqual([]);
    });
});

describe('Plugin component color gate', () => {
    it('contains no literal colors', () => {
        const roots = ['src/components/Plugins', 'src/components/Bench'].map((root) => join(process.cwd(), root));
        const offenders = roots.flatMap(cssFiles).filter((path) => /#[\da-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i.test(readFileSync(path, 'utf8')));
        expect(offenders).toEqual([]);
    });
});

describe('S2b CSS invariants', () => {
    it('keeps every port state free of glow shadows', () => {
        // D7: no glow on a port, ever. The recessed socket well needs exactly two
        // shadows — the inset depth that makes it a hole, and the one shared focus
        // ring — so the gate now allows those and rejects anything else, which is
        // a stricter statement than "no box-shadow at all" (that version would
        // have been satisfied by a port with no depth AND no focus ring).
        const port = readFileSync(join(process.cwd(), 'packages/oj-ui/src/components/Port/Port.css'), 'utf8');
        const shadows = [...port.matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => match[1]!.trim());
        expect(shadows.filter((value) => !/^(none|var\(--shadow-inset\)(,\s*var\(--focus-ring\))?)$/.test(value))).toEqual([]);
        expect(port).not.toContain('drop-shadow');
    });

    it('keeps the Speaker faceplate off raw range inputs', () => {
        // The old invariant pinned a `.speaker-volume-slider` rule that stripped a
        // native range input's outer track. W5-P6 replaced that control with the
        // oj-ui `Knob`, so the stronger statement is the one that holds now: the
        // Speaker owns no bespoke range styling at all, and its level control is a
        // shared part. A raw `<input type="range">` reappearing here would mean a
        // second slider language on the canvas.
        const css = readFileSync(join(process.cwd(), 'src/components/Nodes/SpeakerNode.css'), 'utf8');
        const tsx = readFileSync(join(process.cwd(), 'src/components/Nodes/SpeakerNode.tsx'), 'utf8');
        expect(css).not.toContain('slider-runnable-track');
        expect(css).not.toContain('speaker-volume-slider');
        expect(tsx).not.toContain('type="range"');
        expect(tsx).toContain('<Knob');
    });

    it('uses the single fast-motion token in CSS', () => {
        const roots = ['src', 'packages/oj-ui/src'].map((root) => join(process.cwd(), root));
        const sources = roots.flatMap(cssFiles).map((path) => readFileSync(path, 'utf8'));
        expect(sources.some((source) => source.includes('--transition-fast'))).toBe(false);
        expect(sources.some((source) => source.includes('--motion-fast'))).toBe(true);
    });
});
