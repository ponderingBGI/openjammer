#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

type CoreVersion = {
  major: number;
  minor: number;
  patch: number;
};

type ReleaseLike = {
  tag_name?: string;
  tagName?: string;
  draft?: boolean;
  isDraft?: boolean;
  prerelease?: boolean;
  isPrerelease?: boolean;
};

const STABLE_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CANARI_RE = /^v?(\d+)\.(\d+)\.(\d+)-canari\.(\d+)$/;

const VERSION_FILES = [
  { path: 'Cargo.toml', re: /^version\s*=\s*"([^"]*)"/m },
  { path: 'package.json', re: /"version"\s*:\s*"([^"]*)"/ },
  { path: 'src-tauri/tauri.conf.json', re: /"version"\s*:\s*"([^"]*)"/ },
  { path: 'packages/oj-protocol-ts/package.json', re: /"version"\s*:\s*"([^"]*)"/ },
];

function tagName(release: ReleaseLike): string {
  return release.tag_name ?? release.tagName ?? '';
}

function isDraft(release: ReleaseLike): boolean {
  return release.draft ?? release.isDraft ?? false;
}

function isPrerelease(release: ReleaseLike): boolean {
  return release.prerelease ?? release.isPrerelease ?? false;
}

export function parseStableTag(tag: string): CoreVersion | null {
  const m = tag.match(STABLE_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function parseCanariTag(tag: string): (CoreVersion & { canari: number }) | null {
  const m = tag.match(CANARI_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    canari: Number(m[4]),
  };
}

function formatCore(v: CoreVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function compareCore(a: CoreVersion, b: CoreVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function parseExactCore(input: string): CoreVersion {
  const parsed = parseStableTag(input);
  if (!parsed || input.startsWith('v')) {
    throw new Error(`target_version must be an exact SemVer core like 0.1.0, got ${input}`);
  }
  return parsed;
}

export function latestStable(releases: ReleaseLike[]): CoreVersion | null {
  let latest: CoreVersion | null = null;
  for (const release of releases) {
    if (isDraft(release) || isPrerelease(release)) continue;
    const parsed = parseStableTag(tagName(release));
    if (!parsed) continue;
    if (!latest || compareCore(parsed, latest) > 0) latest = parsed;
  }
  return latest;
}

export function nextStableVersion(
  releases: ReleaseLike[],
  targetVersion?: string | null,
): string {
  const latest = latestStable(releases);
  if (targetVersion && targetVersion.trim()) {
    const target = parseExactCore(targetVersion.trim());
    if (latest && compareCore(target, latest) <= 0) {
      throw new Error(
        `target_version ${formatCore(target)} must be greater than latest stable ${formatCore(latest)}`,
      );
    }
    return formatCore(target);
  }
  if (!latest) return '0.0.1';
  return formatCore({ ...latest, patch: latest.patch + 1 });
}

export function nextCanariVersion(releases: ReleaseLike[], stableBase: string): string {
  const base = parseExactCore(stableBase);
  let maxCanari = 0;
  for (const release of releases) {
    if (isDraft(release) || !isPrerelease(release)) continue;
    const parsed = parseCanariTag(tagName(release));
    if (!parsed) continue;
    if (compareCore(parsed, base) !== 0) continue;
    maxCanari = Math.max(maxCanari, parsed.canari);
  }
  return `${formatCore(base)}-canari.${maxCanari + 1}`;
}

export async function stampVersion(version: string): Promise<string[]> {
  const changed: string[] = [];
  for (const spec of VERSION_FILES) {
    const text = await readFile(spec.path, 'utf8');
    const m = text.match(spec.re);
    if (!m) throw new Error(`could not find version in ${spec.path}`);
    const current = m[1];
    if (current === version) continue;
    const next = text.replace(spec.re, (whole) => whole.replace(`"${current}"`, `"${version}"`));
    await writeFile(spec.path, next);
    changed.push(spec.path);
  }
  return changed;
}

async function fetchReleases(repo: string): Promise<ReleaseLike[]> {
  if (process.env.OJ_RELEASES_JSON) {
    return JSON.parse(process.env.OJ_RELEASES_JSON) as ReleaseLike[];
  }

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const releases: ReleaseLike[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openjammer-release-script',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub releases fetch failed: ${res.status} ${await res.text()}`);
    }
    const pageReleases = (await res.json()) as ReleaseLike[];
    releases.push(...pageReleases);
    if (pageReleases.length < 100) break;
  }
  return releases;
}

function readArg(name: string): string | null {
  const arg = process.argv.find((v) => v.startsWith(`${name}=`));
  if (arg) return arg.slice(name.length + 1);
  const ix = process.argv.indexOf(name);
  return ix >= 0 ? (process.argv[ix + 1] ?? null) : null;
}

async function appendGithubOutput(values: Record<string, string>): Promise<void> {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  await writeFile(out, `${body}\n`, { flag: 'a' });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    console.log('usage: release.ts <next-stable|next-canari|stamp> [--repo owner/repo]');
    return;
  }

  if (command === 'stamp') {
    const version = process.argv[3];
    if (!version) throw new Error('stamp requires a version');
    const changed = await stampVersion(version);
    console.log(changed.length ? changed.join('\n') : 'versions already aligned');
    return;
  }

  const repo = readArg('--repo') || process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('--repo or GITHUB_REPOSITORY is required');
  const releases = await fetchReleases(repo);

  if (command === 'next-stable') {
    const target = readArg('--target-version');
    const version = nextStableVersion(releases, target);
    const tag = `v${version}`;
    console.log(version);
    await appendGithubOutput({ version, tag });
    return;
  }

  if (command === 'next-canari') {
    const base = readArg('--base') || nextStableVersion(releases);
    const version = nextCanariVersion(releases, base);
    const tag = `v${version}`;
    console.log(version);
    await appendGithubOutput({ base, version, tag });
    return;
  }

  throw new Error(`unknown release command: ${command}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
