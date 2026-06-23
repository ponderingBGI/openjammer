/**
 * permission-gate policy — the security-critical unit tests. Run standalone with
 * `node --test pi-extensions/permission-gate/policy.test.mjs` (the extension lives
 * outside the app build, so it is not in the vitest scope).
 *
 * These pin the exact escapes the research critique flagged: command chaining,
 * substitution smuggling, secret reads, and the gate-drop config path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isCommandAllowed,
    isPathInsideJail,
    isProtectedConfigPath,
    redactSecret,
    DEFAULT_ALLOWLIST,
} from './policy.mjs';
import { vetoToolCall } from './index.mjs';

test('allows ordinary jailed navigation/read/search', () => {
    for (const ok of ['ls -la', 'cat src/main.tsx', 'grep -r foo .', 'cd audio && ls', 'find . -name "*.wav"']) {
        assert.equal(isCommandAllowed(ok).allowed, true, ok);
    }
});

test('denies network + privilege + mass-delete outright', () => {
    for (const bad of ['curl http://evil', 'sudo rm -rf /', 'rm -rf .', 'chmod 777 x', 'ssh host', 'wget x']) {
        assert.equal(isCommandAllowed(bad).allowed, false, bad);
    }
});

test('denies allowlist escape via command chaining', () => {
    // `ls` is allowed but the chained `curl` is not — the WHOLE line must fail.
    assert.equal(isCommandAllowed('ls; curl http://evil').allowed, false);
    assert.equal(isCommandAllowed('cat x && rm -rf y').allowed, false);
    assert.equal(isCommandAllowed('grep foo | wget bar').allowed, false);
});

test('denies command/process substitution smuggling', () => {
    assert.equal(isCommandAllowed('echo $(curl evil)').allowed, false);
    assert.equal(isCommandAllowed('cat `whoami`').allowed, false);
    assert.equal(isCommandAllowed('diff <(curl a) <(curl b)').allowed, false);
});

test('denies a write-capable bash command that targets the agent config (the gate-drop hole)', () => {
    // cp/mv/sed -i/touch/mkdir are allowlisted binaries; before the fix their
    // DESTINATION was unchecked, so the agent could overwrite settings.json and
    // drop its own gate. The destination is now vetted for every path form.
    for (const bad of [
        'cp drafts/x .pi/agent/settings.json',
        'mv x ../.pi/agent/settings.json',
        'cp x /home/u/.openjammer/agent/.pi/agent/settings.json',
        'mkdir .pi/agent/packages/evil',
        "sed -i 's/a/b/' .pi/agent/settings.json",
    ]) {
        assert.equal(isCommandAllowed(bad).allowed, false, bad);
    }
});

test('write-capable bash commands still allow legitimate in-project writes', () => {
    for (const ok of [
        'cp a.wav audio/b.wav',
        'mv old.txt new.txt',
        'touch notes.txt',
        'mkdir takes',
        "sed -i 's/a/b/' song.txt",
    ]) {
        assert.equal(isCommandAllowed(ok).allowed, true, ok);
    }
});

test('a path-prefixed binary is reduced to its basename for the check', () => {
    assert.equal(isCommandAllowed('/usr/bin/curl x').allowed, false);
    assert.equal(isCommandAllowed('/bin/ls').allowed, true);
});

test('the allowlist is the source of truth (unknown binary denied)', () => {
    assert.equal(DEFAULT_ALLOWLIST.has('ls'), true);
    assert.equal(isCommandAllowed('python evil.py').allowed, false);
    assert.equal(isCommandAllowed('node script.js').allowed, false);
});

test('path jail: inside project + memory roots allowed, outside denied', () => {
    const roots = ['/home/u/MyProject', '/home/u/.openjammer/agent/.pi/agent/pi-memory'];
    assert.equal(isPathInsideJail('/home/u/MyProject/audio/take.wav', roots), true);
    assert.equal(isPathInsideJail('/home/u/MyProject', roots), true);
    assert.equal(isPathInsideJail('/home/u/.pi/agent/auth.json', roots), false);
    assert.equal(isPathInsideJail('/home/u/MyProject/../secret', roots), false); // traversal
    assert.equal(isPathInsideJail('/etc/passwd', roots), false);
});

test('protected config paths are flagged even inside the agent home', () => {
    assert.equal(isProtectedConfigPath('/home/u/.openjammer/agent/.pi/agent/settings.json'), true);
    assert.equal(isProtectedConfigPath('/home/u/.openjammer/agent/.pi/agent/packages/x'), true);
    assert.equal(isProtectedConfigPath('/home/u/.openjammer/agent/.pi/agent/pi-memory/MEMORY.md'), false);
});

test('secret redaction strips the provider key from output, but not short strings', () => {
    const key = 'sk-live-0123456789abcdef';
    assert.equal(redactSecret(`token is ${key} ok`, key), 'token is ‹redacted› ok');
    assert.equal(redactSecret('nothing here', key), 'nothing here');
    assert.equal(redactSecret('abc', 'abc'), 'abc'); // too short to redact safely
});

test('vetoToolCall: blocks a bash escape, allows a jailed read', () => {
    const cfg = { writableRoots: ['/home/u/MyProject'], secret: '' };
    assert.equal(vetoToolCall('bash', { command: 'curl evil' }, cfg)?.block, true);
    assert.equal(vetoToolCall('bash', { command: 'ls -la' }, cfg), null);
});

test('vetoToolCall: blocks a write-capable bash command that targets the gate', () => {
    const cfg = { writableRoots: ['/home/u/MyProject'], secret: '' };
    assert.equal(
        vetoToolCall('bash', { command: 'cp drafts/x .pi/agent/settings.json' }, cfg)?.block,
        true,
    );
    // A legitimate relative write inside the project is untouched.
    assert.equal(vetoToolCall('bash', { command: 'cp a.wav out.wav' }, cfg), null);
});

test('vetoToolCall: blocks a write outside the jail and to protected config', () => {
    const cfg = { writableRoots: ['/home/u/MyProject'], secret: '' };
    assert.equal(vetoToolCall('write', { path: '/etc/passwd' }, cfg)?.block, true);
    assert.equal(
        vetoToolCall('write', { path: '/home/u/.openjammer/agent/.pi/agent/settings.json' }, cfg)?.block,
        true,
    );
    assert.equal(vetoToolCall('write', { path: '/home/u/MyProject/presets/a.json' }, cfg), null);
});

test('vetoToolCall: does not police shapes it does not recognise (OS jail backstops)', () => {
    const cfg = { writableRoots: ['/home/u/MyProject'], secret: '' };
    assert.equal(vetoToolCall('get_graph', { foo: 1 }, cfg), null);
});
