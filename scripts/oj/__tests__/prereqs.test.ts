// scripts/oj/__tests__/prereqs.test.ts — the per-OS matrix shape + install-command
// construction (pure logic; no probes run here). Detection is host-specific and
// covered live by `oj doctor --check native-readiness`.

import { test, expect } from 'bun:test';
import { nativePrereqs, glyph, DEBIAN_TAURI_LIBS, WASM_NIGHTLY } from '../lib/prereqs';
import type { Prereq } from '../lib/prereqs';

const byId = (list: Prereq[], id: string): Prereq => {
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error(`prereq "${id}" not found`);
  return p;
};

test('every OS matrix includes rust + the tier-2 extras', () => {
  for (const os of ['win32', 'darwin', 'linux'] as const) {
    const ids = nativePrereqs(os).map((p) => p.id);
    expect(ids).toContain('rust');
    expect(ids).toContain('wasm-target');
    expect(ids).toContain('wasm-nightly');
    expect(ids).toContain('just');
    expect(ids).toContain('bacon');
  }
});

test('Windows matrix has MSVC + WebView2 with winget installs', () => {
  const list = nativePrereqs('win32');
  expect(list.map((p) => p.id)).toEqual(
    expect.arrayContaining(['msvc', 'webview2', 'rust']),
  );

  const msvc = byId(list, 'msvc').install(null);
  expect(msvc?.argv).toContain('winget');
  expect(msvc?.argv).toContain('Microsoft.VisualStudio.2022.BuildTools');
  // the VC workload + a --wait override are required for a usable toolchain
  expect(msvc?.argv?.join(' ')).toContain('Microsoft.VisualStudio.Workload.VCTools');
  expect(msvc?.argv?.join(' ')).toContain('--wait');
  expect(msvc?.elevated).toBe(true);

  const wv2 = byId(list, 'webview2').install(null);
  expect(wv2?.argv).toContain('Microsoft.EdgeWebView2Runtime');

  const rust = byId(list, 'rust').install(null);
  expect(rust?.argv).toContain('Rustlang.Rustup');
});

test('macOS matrix uses xcode-select + the rustup curl|sh shell install', () => {
  const list = nativePrereqs('darwin');
  expect(byId(list, 'xcode-clt').install(null)?.argv).toEqual(['xcode-select', '--install']);
  const rust = byId(list, 'rust').install(null);
  expect(rust?.shell).toContain('sh.rustup.rs');
  expect(rust?.argv).toBeUndefined();
});

test('Linux libs install maps to the right command per package manager', () => {
  const libs = byId(nativePrereqs('linux'), 'linux-libs');

  const apt = libs.install('apt');
  expect(apt?.argv?.slice(0, 4)).toEqual(['sudo', 'apt-get', 'install', '-y']);
  for (const pkg of DEBIAN_TAURI_LIBS) expect(apt?.argv).toContain(pkg);
  expect(apt?.argv).toContain('pkg-config');

  const dnf = libs.install('dnf');
  expect(dnf?.argv?.slice(0, 3)).toEqual(['sudo', 'dnf', 'install']);
  expect(dnf?.argv).toContain('webkit2gtk4.1-devel');

  const pacman = libs.install('pacman');
  expect(pacman?.argv?.slice(0, 2)).toEqual(['sudo', 'pacman']);
  expect(pacman?.argv).toContain('webkit2gtk-4.1');

  // No known package manager => no auto-install command.
  expect(libs.install(null)).toBeNull();
});

test('wasm-nightly install pins the documented nightly date', () => {
  const nightly = byId(nativePrereqs('linux'), 'wasm-nightly').install(null);
  expect(nightly?.argv).toContain(`nightly-${WASM_NIGHTLY}`);
  expect(nightly?.argv).toContain('rust-src');
});

test('DEBIAN_TAURI_LIBS is the six Tauri/cpal -dev libraries', () => {
  expect(DEBIAN_TAURI_LIBS).toHaveLength(6);
  expect(DEBIAN_TAURI_LIBS).toContain('libasound2-dev');
  expect(DEBIAN_TAURI_LIBS).toContain('libwebkit2gtk-4.1-dev');
});

test('glyph renders present/absent/unknown', () => {
  expect(glyph(true).trim()).toBe('ok');
  expect(glyph(false).trim()).toBe('--');
  expect(glyph(null).trim()).toBe('??');
});
