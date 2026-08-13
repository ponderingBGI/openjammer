#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const run = (args: string[]) =>
  spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const rootResult = run(["rev-parse", "--show-toplevel"]);
if (rootResult.status !== 0) {
  // Installing from a source archive or package cache without .git: nothing to configure.
  process.exit(0);
}

const root = rootResult.stdout.trim();
const hooksDir = join(root, ".githooks");
if (!existsSync(hooksDir)) {
  console.warn("OpenJammer: .githooks is missing; skipping git hook setup.");
  process.exit(0);
}

const configResult = run(["config", "core.hooksPath", ".githooks"]);
if (configResult.status !== 0) {
  console.warn("OpenJammer: could not configure git hooks automatically.");
  if (configResult.stderr.trim()) console.warn(configResult.stderr.trim());
  console.warn("Run manually: git config core.hooksPath .githooks");
  process.exit(0);
}

console.log("OpenJammer: git hooks enabled (core.hooksPath=.githooks).");
