import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function cssFiles(root: string): string[] {
    return readdirSync(root).flatMap((name) => {
        const path = join(root, name);
        return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
    });
}

function customProperties(source: string, pattern: RegExp): Set<string> {
    return new Set([...source.matchAll(pattern)].map((match) => match[1]!));
}

describe('Arrangement semantic color gate', () => {
    it('contains no hex, rgb, rgba, hsl, or hsla literals', () => {
        const root = join(process.cwd(), 'src/components/Arrangement');
        const offenders = cssFiles(root).filter((path) => /#[\da-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i.test(readFileSync(path, 'utf8')));
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

    it('removes the Speaker range input outer track', () => {
        const nodes = readFileSync(join(process.cwd(), 'src/components/Nodes/SchematicNodes.css'), 'utf8');
        expect(nodes).toMatch(/\.speaker-volume-slider\s*{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
    });

    it('uses the single fast-motion token in CSS', () => {
        const roots = ['src', 'packages/oj-ui/src'].map((root) => join(process.cwd(), root));
        const sources = roots.flatMap(cssFiles).map((path) => readFileSync(path, 'utf8'));
        expect(sources.some((source) => source.includes('--transition-fast'))).toBe(false);
        expect(sources.some((source) => source.includes('--motion-fast'))).toBe(true);
    });
});
