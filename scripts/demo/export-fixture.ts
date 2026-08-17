import { resolve } from 'node:path';
import { buildDenseEdit, buildFirstLight, buildHundredTracks, buildPathological } from '../../src/song/fixtures';

const fixtures = {
    'first-light': buildFirstLight,
    'hundred-tracks': buildHundredTracks,
    'dense-edit': buildDenseEdit,
    pathological: buildPathological,
} as const;

if (import.meta.main) {
    const name = Bun.argv[2] as keyof typeof fixtures | undefined;
    const outIndex = Bun.argv.indexOf('--out');
    const requested = outIndex >= 0 ? Bun.argv[outIndex + 1] : undefined;
    const seedIndex = Bun.argv.indexOf('--seed');
    const seedText = seedIndex >= 0 ? Bun.argv[seedIndex + 1] : undefined;
    const seed = seedText === undefined ? undefined : Number(seedText);
    if (!name || !(name in fixtures) || !requested || (seedText !== undefined && !Number.isFinite(seed))) {
        console.error(`Usage: bun scripts/demo/export-fixture.ts <${Object.keys(fixtures).join('|')}> --out <path.json> [--seed <integer>]`);
        process.exitCode = 2;
    } else {
        const out = resolve(requested);
        const fixture = fixtures[name](seed as never);
        await Bun.write(out, `${JSON.stringify(fixture, null, 2)}\n`);
        console.log(`${fixture.name} -> ${out}`);
    }
}
