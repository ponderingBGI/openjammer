// scripts/oj/__tests__/credentials.test.ts — the credential scanner flags a fake
// private-key block and secret filenames, and passes on clean input.

import { test, expect } from 'bun:test';
import {
  containsPrivateKeyBlock,
  isSecretPath,
  PRIVATE_KEY_BLOCK_RE,
} from '../checks/credentials';

// Assemble the PEM markers at runtime so this test file never embeds a contiguous
// "BEGIN ... PRIVATE KEY" literal that secret scanners (oj credentials, Betterleaks)
// would flag on the file itself. Runtime strings are identical to the real markers.
const BEGIN = '-----BEGIN ';
const PK = 'PRIVATE KEY-----';

test('flags a fake private-key fixture string', () => {
  const fixture = [
    BEGIN + PK,
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFAKEFAKEFAKE=',
    '-----END ' + PK,
  ].join('\n');
  expect(containsPrivateKeyBlock(fixture)).toBe(true);
});

test('flags RSA / EC / OPENSSH private key header variants', () => {
  expect(PRIVATE_KEY_BLOCK_RE.test(BEGIN + 'RSA ' + PK)).toBe(true);
  expect(PRIVATE_KEY_BLOCK_RE.test(BEGIN + 'EC ' + PK)).toBe(true);
  expect(PRIVATE_KEY_BLOCK_RE.test(BEGIN + 'OPENSSH ' + PK)).toBe(true);
});

test('passes clean input (no private key block)', () => {
  const clean = 'export const greeting = "hello world";\n// nothing secret here\n';
  expect(containsPrivateKeyBlock(clean)).toBe(false);
});

test('flags secret filenames and .tauri paths', () => {
  expect(isSecretPath('openjammer.key')).toBe(true);
  expect(isSecretPath('keys/release.key')).toBe(true);
  expect(isSecretPath('cert.pem')).toBe(true);
  expect(isSecretPath('cert.p12')).toBe(true);
  expect(isSecretPath('cert.pfx')).toBe(true);
  expect(isSecretPath('updater.minisign')).toBe(true);
  expect(isSecretPath('.tauri/signing.key')).toBe(true);
  expect(isSecretPath('src-tauri/.tauri/cache.json')).toBe(true);
  // Windows-style separators.
  expect(isSecretPath('keys\\release.key')).toBe(true);
});

test('does not flag ordinary source paths', () => {
  expect(isSecretPath('src/engine/manifest.ts')).toBe(false);
  expect(isSecretPath('package.json')).toBe(false);
  expect(isSecretPath('docs/creating-nodes.md')).toBe(false);
  // "key" only as a substring, not an extension, is fine.
  expect(isSecretPath('src/keyboard.ts')).toBe(false);
});
