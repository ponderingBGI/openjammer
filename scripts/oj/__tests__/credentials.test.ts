// scripts/oj/__tests__/credentials.test.ts — the credential scanner flags a fake
// BEGIN PRIVATE KEY block and secret filenames, and passes on clean input.

import { test, expect } from 'bun:test';
import {
  containsPrivateKeyBlock,
  isSecretPath,
  PRIVATE_KEY_BLOCK_RE,
} from '../checks/credentials';

test('flags a fake BEGIN PRIVATE KEY fixture string', () => {
  const fixture = [
    '-----BEGIN PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFAKEFAKEFAKE=',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  expect(containsPrivateKeyBlock(fixture)).toBe(true);
});

test('flags RSA / EC / OPENSSH private key header variants', () => {
  expect(PRIVATE_KEY_BLOCK_RE.test('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
  expect(PRIVATE_KEY_BLOCK_RE.test('-----BEGIN EC PRIVATE KEY-----')).toBe(true);
  expect(PRIVATE_KEY_BLOCK_RE.test('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
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
