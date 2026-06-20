// scripts/oj/checks/coi-headers.ts — verify the cross-origin-isolation (COOP/COEP)
// headers are PRESENT (forward-compatibility), without asserting a fast path that
// the committed build does not contain.
//
// HONESTY NOTE: cross-origin isolation only matters once a SharedArrayBuffer
// (atomics / shared-memory) wasm build exists — and the committed `build-wasm.sh`
// build has NO atomics/shared-memory, so `crossOriginIsolated` is INERT today
// (there is no fast postMessage-vs-SAB difference to gate). This check therefore
// asserts only that the headers are present and forward-compatible; it must NOT
// claim a SharedArrayBuffer "fast path" exists or that its absence "degrades to a
// slow path", because that path is not in the committed wasm build yet.
//
// vite.config.ts sets the headers for the dev AND preview servers. Those only
// cover local dev — a PRODUCTION host (Vercel/Netlify/nginx) must re-emit them so
// that WHEN a shared-memory build lands the isolation precondition is already in
// place. No vercel.json / _headers exists in the tree today, so this check WARNs
// loudly with a note (never fails). Pure TS.

import type { CheckResult } from '../lib/report';
import { resolve } from 'node:path';

export const id = 'coi-headers';
export const name = 'COOP/COEP cross-origin isolation headers';

const COOP = 'Cross-Origin-Opener-Policy';
const COEP = 'Cross-Origin-Embedder-Policy';
const COOP_VALUE = 'same-origin';
const COEP_VALUE = 'require-corp';

// Cross-origin isolation requires the correct VALUES, not just the header names —
// a config with COOP set to anything other than `same-origin` (or COEP not
// `require-corp`) still fails crossOriginIsolated. Match the header name within
// ~120 chars of its required value, tolerating the various vite/JSON/_headers
// syntaxes ('H': 'V' / "H": "V" / H = "V" / H "V").
function hasHeaderValue(text: string, header: string, value: string): boolean {
  return new RegExp(`${header}[\\s\\S]{0,120}${value}`, 'i').test(text);
}

// Committed hosting configs that could re-emit headers in production.
const HOSTING_CONFIGS = ['vercel.json', '_headers', 'public/_headers', 'netlify.toml'];

export async function run(): Promise<CheckResult> {
  const viteAbs = resolve('vite.config.ts');
  let viteText: string;
  try {
    viteText = await Bun.file(viteAbs).text();
  } catch {
    return {
      id,
      name,
      status: 'fail',
      detail: 'vite.config.ts not found — cannot verify dev/preview COI headers.',
      fix: 'add Cross-Origin-Opener-Policy: same-origin + Cross-Origin-Embedder-Policy: require-corp to the vite server/preview headers.',
    };
  }

  const hasCoop = hasHeaderValue(viteText, COOP, COOP_VALUE);
  const hasCoep = hasHeaderValue(viteText, COEP, COEP_VALUE);
  // Count occurrences so we can tell dev-only vs dev+preview.
  const coopCount = countOccurrences(viteText, COOP);
  const coepCount = countOccurrences(viteText, COEP);

  if (!hasCoop || !hasCoep) {
    const missing = [!hasCoop ? COOP : null, !hasCoep ? COEP : null].filter(Boolean).join(', ');
    return {
      id,
      name,
      status: 'fail',
      detail: `vite.config.ts is missing ${missing}. These are forward-compatible: no shared-memory (atomics) wasm build exists yet, so cross-origin isolation is inert today — but the headers must be in place so that WHEN a SharedArrayBuffer build lands the isolation precondition is already satisfied (no scramble at the last minute).`,
      fix: `add ${missing} to the vite server and preview headers blocks.`,
    };
  }

  // Look for any committed hosting config that would carry the prod headers.
  const present: string[] = [];
  for (const cfg of HOSTING_CONFIGS) {
    try {
      if (await Bun.file(resolve(cfg)).exists()) present.push(cfg);
    } catch {
      // ignore
    }
  }

  if (present.length === 0) {
    return {
      id,
      name,
      status: 'warn',
      detail: [
        `vite.config.ts COI headers present (COOP x${coopCount}, COEP x${coepCount}; dev + preview).`,
        'No committed hosting config (vercel.json / _headers / netlify.toml) re-emits them for production.',
        'These headers are forward-compatible only: no shared-memory (atomics) wasm build exists yet, so cross-origin isolation is INERT today (crossOriginIsolated gates a SharedArrayBuffer fast path the committed wasm build does not contain). Keep them present so that WHEN such a build lands the isolation precondition is already in place.',
      ].join('\n'),
      fix: 'when a PWA host is chosen, commit a vercel.json `headers` (or _headers) block re-emitting COOP: same-origin + COEP: require-corp, then add a post-deploy crossOriginIsolated check.',
    };
  }

  // A hosting config exists — confirm it also carries both header names.
  const hostMissing: string[] = [];
  for (const cfg of present) {
    try {
      const t = await Bun.file(resolve(cfg)).text();
      if (!hasHeaderValue(t, COOP, COOP_VALUE) || !hasHeaderValue(t, COEP, COEP_VALUE)) hostMissing.push(cfg);
    } catch {
      hostMissing.push(cfg);
    }
  }

  if (hostMissing.length > 0) {
    return {
      id,
      name,
      status: 'warn',
      detail: [
        'vite.config.ts COI headers present.',
        `but these committed hosting configs do not clearly re-emit both headers: ${hostMissing.join(', ')}`,
      ].join('\n'),
      fix: 'ensure the hosting config emits both COOP: same-origin and COEP: require-corp on the app HTML/JS.',
    };
  }

  return {
    id,
    name,
    status: 'pass',
    detail: `COI headers present in vite.config.ts and in hosting config(s): ${present.join(', ')}`,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}
