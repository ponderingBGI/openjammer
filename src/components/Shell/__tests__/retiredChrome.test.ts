import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const ROOTS = ['src', 'packages', 'e2e'].map((dir) => join(REPO, dir));

/*
 * A migration is finished when the thing it replaced is GONE (values #7 and #8).
 * `LatencyChip` took over the latency warning — the same diagnosis, the same
 * store, the same dismissal key — and the banner it replaced sat on disk for a
 * whole review cycle with zero importers, which is dormant production code that
 * a future reader would reasonably assume was still wired.
 */
const RETIRED = [
    'src/components/LatencyWarningBanner.tsx',
    'src/components/LatencyWarningBanner.css',
    'src/components/Toolbar/Toolbar.tsx',
    'src/components/Toolbar/Toolbar.css',
    'src/components/Arrangement/SharedSurfaceChrome.tsx',
];

async function* sourceFiles(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* sourceFiles(path);
        else if (/\.(tsx?|css)$/.test(entry.name)) yield path;
    }
}

describe('retired chrome stays retired', () => {
    it.each(RETIRED)('%s is deleted, not merely unused', (relative) => {
        expect(existsSync(join(REPO, relative))).toBe(false);
    });

    // The whole tree, read in parallel — sequentially this outlives the default
    // 5s budget once the suite is running 199 files at once.
    it('nothing in the app still names the retired components', async () => {
        const names = ['LatencyWarningBanner', 'SharedSurfaceChrome', 'toolbar-wrapper', 'oj-welcome'];
        const files: string[] = [];
        for (const root of ROOTS) for await (const file of sourceFiles(root)) if (file !== __filename) files.push(file);

        const offenders = (await Promise.all(files.map(async (file) => {
            const text = await readFile(file, 'utf8');
            return names.filter((name) => text.includes(name)).map((name) => `${file}: ${name}`);
        }))).flat();

        expect(offenders).toEqual([]);
    }, 30_000);
});
