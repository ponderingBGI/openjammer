import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { conduct } from '../src/song/conduct';
import type { Arrangement } from '../src/song/types';

const root = resolve(import.meta.dir, '..');
const fixturePath = resolve(root, 'crates/ojcore/benches/fixtures/first-light.json');
const binary = resolve(root, 'target', 'release', process.platform === 'win32' ? 'render.exe' : 'render');
let work = '';

async function command(executable: string, args: string[], cwd = root): Promise<void> {
    const child = Bun.spawn([executable, ...args], { cwd, stdout: 'inherit', stderr: 'inherit' });
    const code = await child.exited;
    if (code !== 0) throw new Error(`${executable} exited with ${code}`);
}

beforeAll(async () => {
    work = await mkdtemp(resolve(tmpdir(), 'openjammer-n3-'));
    await mkdir(work, { recursive: true });
    const arrangement = JSON.parse(await readFile(fixturePath, 'utf8')) as Arrangement;
    const published = conduct(arrangement, 'native');
    await Promise.all([
        writeFile(resolve(work, 'graph.json'), JSON.stringify(published.graph)),
        writeFile(resolve(work, 'timeline.json'), JSON.stringify(published.timeline)),
        writeFile(resolve(work, 'tempo-map.json'), JSON.stringify(published.tempoMap)),
    ]);
    await command('cargo', ['build', '--release', '-p', 'ojcore-native', '--bin', 'render', '--features', 'demo']);
}, 600_000);

afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
});

async function render(format: 'wav' | 'flac', suffix: string): Promise<Buffer> {
    const output = resolve(work, `first-light-${suffix}.${format}`);
    await command(binary, [
        '--graph', resolve(work, 'graph.json'),
        '--timeline', resolve(work, 'timeline.json'),
        '--tempo-map', resolve(work, 'tempo-map.json'),
        '--rate', '48000',
        '--bits', '24',
        '--format', format,
        '--tail', '0',
        '--out', output,
        '--assert', 'finite',
        '--assert', 'rms>0.001',
        '--quiet',
    ]);
    return readFile(output);
}

describe('N3 — First Light native bounce determinism', () => {
    for (const format of ['wav', 'flac'] as const) {
        test(`${format.toUpperCase()} is byte-identical across two runs`, async () => {
            const first = await render(format, 'a');
            const second = await render(format, 'b');
            expect(first.byteLength).toBeGreaterThan(44);
            expect(second.equals(first)).toBe(true);
        }, 300_000);
    }
});
