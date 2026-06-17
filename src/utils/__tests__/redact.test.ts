/**
 * Secret-corpus redaction test (L5). A maintained corpus of strings that MUST be
 * scrubbed before anything is attached to a public GitHub issue. A regression
 * here is a real secret-leak risk, so the corpus errs toward over-coverage.
 */

import { describe, expect, it } from 'vitest';
import { redactText, redactValue, SECRET_ENV_VARS } from '../redact';

const MASK = '«redacted»';

describe('redactText — secrets are scrubbed', () => {
    // Each case: a raw string, and a substring that MUST NOT survive redaction.
    const leaks: { name: string; raw: string; mustNotContain: string }[] = [
        {
            name: 'OpenAI sk- key',
            raw: 'using key sk-ABCDEF1234567890abcdef',
            mustNotContain: 'sk-ABCDEF1234567890abcdef',
        },
        {
            name: 'Anthropic sk-ant- key',
            raw: 'Authorization failed for sk-ant-api03-Xy12_-Zz',
            mustNotContain: 'sk-ant-api03-Xy12_-Zz',
        },
        {
            name: 'Bearer token',
            raw: 'Authorization: Bearer eyJhbGciOi.JIUzI1NiJ9.abc-_123',
            mustNotContain: 'eyJhbGciOi.JIUzI1NiJ9.abc-_123',
        },
        {
            name: 'OPENJAMMER_PROVIDER_KEY env var',
            raw: 'spawn env OPENJAMMER_PROVIDER_KEY=super-secret-value-123',
            mustNotContain: 'super-secret-value-123',
        },
        {
            name: 'OPENJAMMER_AI_KEY_VAR env var',
            raw: 'OPENJAMMER_AI_KEY_VAR: my-key-name-leak',
            mustNotContain: 'my-key-name-leak',
        },
        {
            name: 'labelled api_key',
            raw: 'config { api_key: "hunter2secret", port: 8080 }',
            mustNotContain: 'hunter2secret',
        },
        {
            name: 'labelled password',
            raw: 'login password=p@ssw0rd! ok',
            mustNotContain: 'p@ssw0rd!',
        },
        {
            name: 'labelled token',
            raw: 'token=ghp_0123456789abcdefABCDEF',
            mustNotContain: 'ghp_0123456789abcdefABCDEF',
        },
        {
            name: 'Windows home dir username',
            raw: 'failed to open C:\\Users\\miloPresedo\\AppData\\file.wav',
            mustNotContain: 'miloPresedo',
        },
        {
            name: 'macOS home dir username',
            raw: 'sample at /Users/milo/Music/loop.wav not found',
            mustNotContain: '/Users/milo/',
        },
        {
            name: 'Linux home dir username',
            raw: 'reading /home/milo/.config/openjammer',
            mustNotContain: '/home/milo/',
        },
        {
            name: 'LAN peer IPv4',
            raw: 'peer joined from 192.168.1.42:9000',
            mustNotContain: '192.168.1.42',
        },
        {
            name: 'bare GitHub PAT (ghp_)',
            raw: 'git push failed: ghp_0123456789ABCDEFabcdef0123456789AAAA',
            mustNotContain: 'ghp_0123456789ABCDEFabcdef0123456789AAAA',
        },
        {
            name: 'bare fine-grained GitHub PAT (github_pat_)',
            raw: 'token github_pat_11ABCDEFG0123456789_abcdefghijklmnop here',
            mustNotContain: 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
        },
        {
            name: 'bare AWS access key id (AKIA)',
            raw: 'aws creds AKIAIOSFODNN7EXAMPLE rotated',
            mustNotContain: 'AKIAIOSFODNN7EXAMPLE',
        },
        {
            name: 'bare Google API key (AIza)',
            raw: 'maps key AIzaSyD-1234567890abcdefghijklmnopqrstu loaded',
            mustNotContain: 'AIzaSyD-1234567890abcdefghijklmnopqrstu',
        },
        {
            name: 'bare Slack token (xoxb-)',
            raw: 'slack xoxb-1234567890-ABCDEFabcdef connected',
            mustNotContain: 'xoxb-1234567890-ABCDEFabcdef',
        },
    ];

    for (const { name, raw, mustNotContain } of leaks) {
        it(`scrubs: ${name}`, () => {
            const out = redactText(raw);
            expect(out).not.toContain(mustNotContain);
            expect(out).toContain(MASK);
        });
    }

    it('pins the redactor to the verified ai.rs env-var names', () => {
        expect(SECRET_ENV_VARS).toContain('OPENJAMMER_PROVIDER_KEY');
        expect(SECRET_ENV_VARS).toContain('OPENJAMMER_AI_KEY_VAR');
    });

    it('keeps the path STRUCTURE while scrubbing only the user segment', () => {
        const out = redactText('C:\\Users\\milo\\AppData\\Roaming\\openjammer');
        // The directory structure stays useful; only the identifying user is gone.
        expect(out).toContain('C:\\Users\\');
        expect(out).toContain('\\AppData\\Roaming\\openjammer');
        expect(out).not.toContain('milo');
    });

    it('preserves loopback addresses (useful, non-identifying)', () => {
        expect(redactText('bound to 127.0.0.1:48000')).toContain('127.0.0.1');
    });

    it('leaves harmless diagnostic text untouched', () => {
        const safe = 'engine started: 48000 Hz, 64-frame buffer, 2 channels';
        expect(redactText(safe)).toBe(safe);
    });

    it('does not over-clip ordinary ids/hashes (the token formats are prefix-specific)', () => {
        // A git short sha, a 40-char hex digest, and a UUID carry no secret-token
        // prefix (ghp_/AKIA/AIza/xox/sk-), so they survive intact — they are useful
        // diagnostics, not secrets.
        for (const id of [
            'commit a1b2c3d',
            'sha256 da39a3ee5e6b4b0d3255bfef95601890afd80709',
            'session 550e8400-e29b-41d4-a716-446655440000',
        ]) {
            expect(redactText(id)).toBe(id);
        }
    });
});

describe('redactValue — recursive scrub of structured fields', () => {
    it('scrubs string values nested in objects and arrays', () => {
        const fields = {
            note: 'normal',
            path: '/Users/milo/x.wav',
            nested: { auth: 'token=abcdEFGH1234' },
            list: ['ok', 'sk-deadbeef0000', 42, true],
        };
        const out = redactValue(fields) as typeof fields;
        expect(out.note).toBe('normal');
        expect(out.path).not.toContain('/Users/milo/');
        expect(out.nested.auth).not.toContain('abcdEFGH1234');
        expect((out.list as unknown[])[1]).toBe(MASK);
        // Non-string scalars pass through unchanged.
        expect((out.list as unknown[])[2]).toBe(42);
        expect((out.list as unknown[])[3]).toBe(true);
    });
});
