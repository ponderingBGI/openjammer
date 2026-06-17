#!/usr/bin/env bun
/**
 * Build the OpenJammer-bundled Pi RPC runtime.
 *
 * Pi is an npm/Node package, but the OpenJammer desktop app must not require a
 * global `pi` install or a user-managed Node toolchain. We compile Pi's Bun entry
 * into a platform sidecar and copy the runtime assets Pi resolves relative to
 * that executable (themes, docs, export-html assets, image wasm, package.json).
 */
import { existsSync, mkdirSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dir, '..');
const piPkg = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
const piEntry = join(piPkg, 'dist', 'bun', 'cli.js');
const outDir = join(root, 'src-tauri', 'binaries');

interface RuntimeTarget {
  suffix: string;
  bunTarget?: string;
}

function target(): RuntimeTarget {
  const explicit = process.env.OPENJAMMER_PI_TARGET;
  if (explicit) return targetFromTriple(explicit);

  const os = process.platform;
  const arch = process.arch;
  if (os === 'win32' && arch === 'x64') return targetFromTriple('x86_64-pc-windows-msvc');
  if (os === 'win32' && arch === 'arm64') return targetFromTriple('aarch64-pc-windows-msvc');
  if (os === 'darwin' && arch === 'x64') return targetFromTriple('x86_64-apple-darwin');
  if (os === 'darwin' && arch === 'arm64') return targetFromTriple('aarch64-apple-darwin');
  if (os === 'linux' && arch === 'x64') return targetFromTriple('x86_64-unknown-linux-gnu');
  if (os === 'linux' && arch === 'arm64') return targetFromTriple('aarch64-unknown-linux-gnu');
  throw new Error(`Unsupported Pi sidecar platform: ${os}/${arch}`);
}

function targetFromTriple(triple: string): RuntimeTarget {
  switch (triple) {
    case 'x86_64-pc-windows-msvc':
      return { suffix: `${triple}.exe`, bunTarget: 'bun-windows-x64' };
    case 'aarch64-pc-windows-msvc':
      return { suffix: `${triple}.exe`, bunTarget: 'bun-windows-arm64' };
    case 'x86_64-apple-darwin':
      return { suffix: triple, bunTarget: 'bun-darwin-x64' };
    case 'aarch64-apple-darwin':
      return { suffix: triple, bunTarget: 'bun-darwin-arm64' };
    case 'x86_64-unknown-linux-gnu':
      return { suffix: triple, bunTarget: 'bun-linux-x64' };
    case 'aarch64-unknown-linux-gnu':
      return { suffix: triple, bunTarget: 'bun-linux-arm64' };
    default:
      throw new Error(`Unsupported OPENJAMMER_PI_TARGET: ${triple}`);
  }
}

function copyDir(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`Missing Pi runtime asset: ${from}`);
  cpSync(from, to, { recursive: true });
}

if (!existsSync(piEntry)) {
  throw new Error(`Missing Pi Bun entry: ${piEntry}. Run bun install first.`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const runtimeTarget = target();
const suffix = runtimeTarget.suffix;
const outBin = join(outDir, `openjammer-pi-${suffix}`);
const compileArgs = ['build', '--compile'];
if (runtimeTarget.bunTarget) compileArgs.push('--target', runtimeTarget.bunTarget);
compileArgs.push(piEntry, '--outfile', outBin);

const compile = spawnSync(
  'bun',
  compileArgs,
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (compile.status !== 0) {
  throw new Error(`bun build --compile failed with status ${compile.status}`);
}

copyFileSync(join(piPkg, 'package.json'), join(outDir, 'package.json'));
copyDir(join(piPkg, 'dist', 'modes', 'interactive', 'theme'), join(outDir, 'theme'));
copyDir(join(piPkg, 'dist', 'modes', 'interactive', 'assets'), join(outDir, 'assets'));
copyDir(join(piPkg, 'dist', 'core', 'export-html'), join(outDir, 'export-html'));
copyDir(join(piPkg, 'docs'), join(outDir, 'docs'));
copyDir(join(piPkg, 'examples'), join(outDir, 'examples'));

// Pi's compiled image path expects photon_rs_bg.wasm beside the executable.
const photonCandidates = [
  join(root, 'node_modules', '@silvia-odwyer', 'photon-node', 'photon_rs_bg.wasm'),
  join(piPkg, 'node_modules', '@silvia-odwyer', 'photon-node', 'photon_rs_bg.wasm'),
];
const photon = photonCandidates.find(existsSync);
if (photon) copyFileSync(photon, join(outDir, 'photon_rs_bg.wasm'));

const version = JSON.parse(await Bun.file(join(piPkg, 'package.json')).text()).version;
await Bun.write(
  join(outDir, 'openjammer-pi-runtime.json'),
  JSON.stringify({ package: '@earendil-works/pi-coding-agent', version, binary: `openjammer-pi-${suffix}` }, null, 2) + '\n',
);

console.log(`Built OpenJammer Pi runtime ${version}: ${outBin}`);
