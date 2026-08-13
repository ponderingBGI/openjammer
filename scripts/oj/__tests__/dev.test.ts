// scripts/oj/__tests__/dev.test.ts — pure arg parsing for the native dev front-door.

import { expect, test } from 'bun:test';
import { parseNativeDevOptions, withPluginHostFeature } from '../dev';

test('native --all selects the full JUCE plugin host and consumes the flag', () => {
  const opts = parseNativeDevOptions(['--all']);

  expect(opts).not.toHaveProperty('error');
  if ('error' in opts) throw new Error(opts.error);
  expect(opts.pluginHost).toBe('juce');
  expect(opts.hostSource).toBe('flag');
  expect(opts.passthrough).toEqual([]);
  expect(withPluginHostFeature(opts.passthrough, opts.pluginHost)).toEqual([
    '--features',
    'plugin-host-juce',
  ]);
});

test('plugin-host value all is an alias for the full JUCE host', () => {
  const opts = parseNativeDevOptions(['--plugin-host', 'all', '--release']);

  expect(opts).not.toHaveProperty('error');
  if ('error' in opts) throw new Error(opts.error);
  expect(opts.pluginHost).toBe('juce');
  expect(opts.passthrough).toEqual(['--release']);
});

test('native --all conflicts with the pure-Rust CLAP host selector', () => {
  const opts = parseNativeDevOptions(['--all', '--clap']);

  expect(opts).toHaveProperty('error');
});
