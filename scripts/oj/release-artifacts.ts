#!/usr/bin/env bun

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type UpdaterManifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
};

type BundleOptions = {
  inputDir: string;
  outputDir: string;
  version: string;
  repo: string;
  tag: string;
  notes: string;
  publishedAt?: Date;
};

type LocatedFile = {
  path: string;
  name: string;
};

type StagedUpdater = {
  assetName: string;
  signatureName: string;
  platforms: string[];
};

const PRODUCT = 'OpenJammer';

async function walkFiles(root: string): Promise<LocatedFile[]> {
  const files: LocatedFile[] = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        files.push({ path, name: entry.name });
      }
    }
  }

  await walk(root);
  return files;
}

function exactlyOne(
  files: LocatedFile[],
  description: string,
  predicate: (file: LocatedFile) => boolean,
): LocatedFile {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    const found = matches.length ? matches.map((file) => file.path).join(', ') : 'none';
    throw new Error(`expected exactly one ${description}; found ${matches.length}: ${found}`);
  }
  return matches[0]!;
}

function releaseDownloadUrl(repo: string, tag: string, assetName: string): string {
  const parts = repo.split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`repo must be owner/name, got ${repo}`);
  }
  const encodedRepo = parts.map(encodeURIComponent).join('/');
  return `https://github.com/${encodedRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export function expectedCanariAssetNames(version: string): string[] {
  const prefix = `${PRODUCT}_${version}`;
  return [
    `${prefix}_aarch64.dmg`,
    `${prefix}_aarch64.app.tar.gz`,
    `${prefix}_aarch64.app.tar.gz.sig`,
    `${prefix}_x64.dmg`,
    `${prefix}_x64.app.tar.gz`,
    `${prefix}_x64.app.tar.gz.sig`,
    `${prefix}_amd64.deb`,
    `${prefix}_amd64.deb.sig`,
    `${prefix}_amd64.AppImage`,
    `${prefix}_amd64.AppImage.sig`,
    `${prefix}_x64-setup.exe`,
    `${prefix}_x64-setup.exe.sig`,
    'latest.json',
  ].sort();
}

export async function assembleCanariRelease(options: BundleOptions): Promise<UpdaterManifest> {
  const { inputDir, outputDir, version, repo, tag, notes } = options;
  const files = await walkFiles(inputDir);
  const prefix = `${PRODUCT}_${version}`;

  await mkdir(outputDir, { recursive: true });

  async function stage(
    description: string,
    outputName: string,
    predicate: (file: LocatedFile) => boolean,
  ): Promise<void> {
    const source = exactlyOne(files, description, predicate);
    await copyFile(source.path, join(outputDir, outputName));
  }

  const stagedUpdaters: StagedUpdater[] = [];
  for (const mac of [
    { target: 'aarch64-apple-darwin', arch: 'aarch64' },
    { target: 'x86_64-apple-darwin', arch: 'x64' },
  ]) {
    const stem = `${prefix}_${mac.arch}`;
    await stage(
      `macOS ${mac.arch} DMG`,
      `${stem}.dmg`,
      (file) => file.name === `${stem}.dmg`,
    );
    await stage(
      `macOS ${mac.arch} updater archive`,
      `${stem}.app.tar.gz`,
      (file) => file.name === `${PRODUCT}.app.tar.gz` && file.path.includes(mac.target),
    );
    await stage(
      `macOS ${mac.arch} updater signature`,
      `${stem}.app.tar.gz.sig`,
      (file) => file.name === `${PRODUCT}.app.tar.gz.sig` && file.path.includes(mac.target),
    );
    const manifestArch = mac.arch === 'x64' ? 'x86_64' : mac.arch;
    stagedUpdaters.push({
      assetName: `${stem}.app.tar.gz`,
      signatureName: `${stem}.app.tar.gz.sig`,
      platforms: [`darwin-${manifestArch}`, `darwin-${manifestArch}-app`],
    });
  }

  for (const extension of ['deb', 'AppImage'] as const) {
    const assetName = `${prefix}_amd64.${extension}`;
    await stage(`Linux ${extension} bundle`, assetName, (file) => file.name === assetName);
    await stage(
      `Linux ${extension} signature`,
      `${assetName}.sig`,
      (file) => file.name === `${assetName}.sig`,
    );
    stagedUpdaters.push({
      assetName,
      signatureName: `${assetName}.sig`,
      platforms:
        extension === 'AppImage'
          ? ['linux-x86_64', 'linux-x86_64-appimage']
          : ['linux-x86_64-deb'],
    });
  }

  const windowsAsset = `${prefix}_x64-setup.exe`;
  await stage('Windows NSIS bundle', windowsAsset, (file) => file.name === windowsAsset);
  await stage(
    'Windows NSIS signature',
    `${windowsAsset}.sig`,
    (file) => file.name === `${windowsAsset}.sig`,
  );
  stagedUpdaters.push({
    assetName: windowsAsset,
    signatureName: `${windowsAsset}.sig`,
    platforms: ['windows-x86_64', 'windows-x86_64-nsis'],
  });

  const platforms: UpdaterManifest['platforms'] = {};
  for (const updater of stagedUpdaters) {
    const signature = await readFile(join(outputDir, updater.signatureName), 'utf8');
    const url = releaseDownloadUrl(repo, tag, updater.assetName);
    for (const platform of updater.platforms) {
      platforms[platform] = { signature, url };
    }
  }

  const manifest: UpdaterManifest = {
    version,
    notes,
    pub_date: (options.publishedAt ?? new Date()).toISOString(),
    platforms,
  };
  await writeFile(join(outputDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const actualNames = (await readdir(outputDir)).sort();
  const expectedNames = expectedCanariAssetNames(version);
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `assembled asset set differs from the release contract\nexpected: ${expectedNames.join(', ')}\nactual: ${actualNames.join(', ')}`,
    );
  }

  return manifest;
}

function readArg(name: string): string | null {
  const arg = process.argv.find((value) => value.startsWith(`${name}=`));
  if (arg) return arg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    console.log(
      'usage: release-artifacts.ts assemble-canari --input DIR --output DIR --version VERSION --repo OWNER/REPO --tag TAG --notes TEXT',
    );
    return;
  }
  if (command !== 'assemble-canari') throw new Error(`unknown command: ${command}`);

  const required = (name: string): string => {
    const value = readArg(name);
    if (!value) throw new Error(`${name} is required`);
    return value;
  };

  const outputDir = required('--output');
  const manifest = await assembleCanariRelease({
    inputDir: required('--input'),
    outputDir,
    version: required('--version'),
    repo: required('--repo'),
    tag: required('--tag'),
    notes: required('--notes'),
  });
  console.log(
    `Assembled ${expectedCanariAssetNames(manifest.version).length} complete release assets in ${outputDir}.`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
