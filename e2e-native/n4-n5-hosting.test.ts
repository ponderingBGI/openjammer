import { describe, test } from 'bun:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

async function cargoTest(testTarget: string, filter: string): Promise<void> {
    const child = Bun.spawn([
        'cargo', 'test', '-p', 'ojhost', '--features', 'clap-host',
        '--test', testTarget, filter, '--', '--nocapture',
    ], { cwd: root, env: process.env, stdout: 'inherit', stderr: 'inherit' });
    const code = await child.exited;
    if (code !== 0) throw new Error(`${testTarget}/${filter} exited with ${code}`);
}

describe.skipIf(process.platform !== 'linux')('P4 native plugin journeys', () => {
    test('N4 — synth timeline, automation, state reload and audible export', async () => {
        await cargoTest('native_journeys', 'n4_timeline_synth_automation_state_reload_and_export');
    }, 300_000);

    test('N5 — hostile track is bypassed while the other tracks remain bit-identical', async () => {
        await cargoTest('robustness', 'reliability_contract_three_track_unaffected_fingerprint_is_bit_identical');
    }, 300_000);
});
