import { describe, expect, test } from 'bun:test';

import {
  latestStable,
  nextCanariVersion,
  nextStableVersion,
  parseCanariTag,
  parseStableTag,
} from '../release';

describe('release version planning', () => {
  test('starts stable releases at 0.0.1 when no stable release exists', () => {
    expect(
      nextStableVersion([
        { tag_name: 'v0.1.0-alpha.2', draft: true, prerelease: false },
        { tag_name: 'v0.1.0-alpha.2', draft: false, prerelease: true },
        { tag_name: 'v0.0.1-canari.1', draft: false, prerelease: true },
      ]),
    ).toBe('0.0.1');
  });

  test('increments only the patch number for automatic stable releases', () => {
    expect(
      nextStableVersion([
        { tag_name: 'v0.0.1', draft: false, prerelease: false },
        { tag_name: 'v0.0.2-canari.3', draft: false, prerelease: true },
      ]),
    ).toBe('0.0.2');
  });

  test('accepts a manual higher stable target and rejects lower targets', () => {
    const releases = [{ tag_name: 'v0.0.9', draft: false, prerelease: false }];
    expect(nextStableVersion(releases, '0.1.0')).toBe('0.1.0');
    expect(() => nextStableVersion(releases, '0.0.9')).toThrow(/greater than latest stable/);
  });

  test('counts canari releases under the stable version they preview', () => {
    expect(
      nextCanariVersion(
        [
          { tag_name: 'v0.0.1-canari.1', draft: false, prerelease: true },
          { tag_name: 'v0.0.1-canari.2', draft: false, prerelease: true },
          { tag_name: 'v0.0.2-canari.9', draft: false, prerelease: true },
          { tag_name: 'v0.0.1-canari.4', draft: true, prerelease: true },
          { tag_name: 'v0.0.1', draft: false, prerelease: false },
        ],
        '0.0.1',
      ),
    ).toBe('0.0.1-canari.3');
  });

  test('parses only the supported stable and canari tag shapes', () => {
    expect(parseStableTag('v0.0.1')).toEqual({ major: 0, minor: 0, patch: 1 });
    expect(parseStableTag('v0.0.1-canari.1')).toBeNull();
    expect(parseCanariTag('v0.0.1-canari.12')).toEqual({
      major: 0,
      minor: 0,
      patch: 1,
      canari: 12,
    });
    expect(parseCanariTag('v0.0.1.canari.12')).toBeNull();
  });

  test('latest stable ignores drafts and prereleases', () => {
    expect(
      latestStable([
        { tag_name: 'v0.1.0', draft: true, prerelease: false },
        { tag_name: 'v0.0.5-canari.1', draft: false, prerelease: true },
        { tag_name: 'v0.0.4', draft: false, prerelease: false },
      ]),
    ).toEqual({ major: 0, minor: 0, patch: 4 });
  });
});
