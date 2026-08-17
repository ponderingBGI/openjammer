import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assembleCanariRelease,
  expectedCanariAssetNames,
} from '../release-artifacts';

const cleanups: string[] = [];
afterAll(async () => {
  for (const dir of cleanups) await rm(dir, { recursive: true, force: true });
});

async function fixture(version: string): Promise<{ input: string; output: string }> {
  const root = await mkdtemp(join(tmpdir(), 'oj-release-artifacts-'));
  cleanups.push(root);
  const input = join(root, 'downloaded');
  const output = join(root, 'publish');

  const files: Record<string, string> = {
    [`canari-aarch64-apple-darwin/target/aarch64-apple-darwin/release/bundle/dmg/OpenJammer_${version}_aarch64.dmg`]:
      'arm dmg',
    'canari-aarch64-apple-darwin/target/aarch64-apple-darwin/release/bundle/macos/OpenJammer.app.tar.gz':
      'arm updater',
    'canari-aarch64-apple-darwin/target/aarch64-apple-darwin/release/bundle/macos/OpenJammer.app.tar.gz.sig':
      'arm signature',
    [`canari-x86_64-apple-darwin/target/x86_64-apple-darwin/release/bundle/dmg/OpenJammer_${version}_x64.dmg`]:
      'x64 dmg',
    'canari-x86_64-apple-darwin/target/x86_64-apple-darwin/release/bundle/macos/OpenJammer.app.tar.gz':
      'x64 updater',
    'canari-x86_64-apple-darwin/target/x86_64-apple-darwin/release/bundle/macos/OpenJammer.app.tar.gz.sig':
      'x64 signature',
    [`canari-x86_64-unknown-linux-gnu/target/release/bundle/deb/OpenJammer_${version}_amd64.deb`]:
      'deb',
    [`canari-x86_64-unknown-linux-gnu/target/release/bundle/deb/OpenJammer_${version}_amd64.deb.sig`]:
      'deb signature',
    [`canari-x86_64-unknown-linux-gnu/target/release/bundle/appimage/OpenJammer_${version}_amd64.AppImage`]:
      'appimage',
    [`canari-x86_64-unknown-linux-gnu/target/release/bundle/appimage/OpenJammer_${version}_amd64.AppImage.sig`]:
      'appimage signature',
    [`canari-x86_64-pc-windows-msvc/target/release/bundle/nsis/OpenJammer_${version}_x64-setup.exe`]:
      'nsis',
    [`canari-x86_64-pc-windows-msvc/target/release/bundle/nsis/OpenJammer_${version}_x64-setup.exe.sig`]:
      'nsis signature',
  };
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(input, relative);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, contents);
  }
  return { input, output };
}

describe('canari release artifact assembly', () => {
  test('assembles the exact public asset set and a complete updater manifest', async () => {
    const version = '0.0.4-canari.3';
    const dirs = await fixture(version);
    const manifest = await assembleCanariRelease({
      inputDir: dirs.input,
      outputDir: dirs.output,
      version,
      repo: 'ponderingBGI/openjammer',
      tag: `v${version}`,
      notes: 'Canari fixture.',
      publishedAt: new Date('2026-08-17T12:00:00.000Z'),
    });

    expect((await Array.fromAsync(new Bun.Glob('*').scan({ cwd: dirs.output }))).sort()).toEqual(
      expectedCanariAssetNames(version),
    );
    expect(manifest.version).toBe(version);
    expect(manifest.pub_date).toBe('2026-08-17T12:00:00.000Z');
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      'darwin-aarch64',
      'darwin-aarch64-app',
      'darwin-x86_64',
      'darwin-x86_64-app',
      'linux-x86_64',
      'linux-x86_64-appimage',
      'linux-x86_64-deb',
      'windows-x86_64',
      'windows-x86_64-nsis',
    ]);
    expect(manifest.platforms['linux-x86_64']).toEqual({
      signature: 'appimage signature',
      url: `https://github.com/ponderingBGI/openjammer/releases/download/v${version}/OpenJammer_${version}_amd64.AppImage`,
    });
    expect(manifest.platforms['darwin-aarch64']?.signature).toBe('arm signature');
    expect(manifest.platforms['windows-x86_64']?.signature).toBe('nsis signature');

    const written = JSON.parse(await readFile(join(dirs.output, 'latest.json'), 'utf8'));
    expect(written).toEqual(manifest);
  });

  test('fails closed when a required platform artifact is absent', async () => {
    const version = '0.0.4-canari.3';
    const dirs = await fixture(version);
    await unlink(
      join(
        dirs.input,
        `canari-x86_64-pc-windows-msvc/target/release/bundle/nsis/OpenJammer_${version}_x64-setup.exe.sig`,
      ),
    );

    expect(
      assembleCanariRelease({
        inputDir: dirs.input,
        outputDir: dirs.output,
        version,
        repo: 'ponderingBGI/openjammer',
        tag: `v${version}`,
        notes: 'Canari fixture.',
      }),
    ).rejects.toThrow(/expected exactly one Windows NSIS signature; found 0/);
  });
});
