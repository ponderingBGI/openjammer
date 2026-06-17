/**
 * Issue-report builder tests (L5). Pin the redaction of the attached log tail +
 * user text, the env block, the pre-filled URL shape, and the URL-length cap.
 */

import { describe, expect, it } from 'vitest';
import { buildIssueReport, githubIssueUrl, type DiagnosticSnapshot } from '../diagnostics';
import type { LogEntry } from '../../store/logStore';

const SNAP: DiagnosticSnapshot = {
    version: '0.0.0',
    channel: 'stable',
    executor: 'ojcore-wasm',
    crossOriginIsolated: true,
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 TestUA',
};

function entry(over: Partial<LogEntry> = {}): LogEntry {
    return {
        id: over.id ?? 1,
        ts: over.ts ?? 0,
        level: over.level ?? 'Info',
        source: over.source ?? 'Ui',
        scope: over.scope ?? 'app',
        message: over.message ?? 'hello',
        ...(over.fields !== undefined ? { fields: over.fields } : {}),
        ...(over.corr !== undefined ? { corr: over.corr } : {}),
    };
}

describe('buildIssueReport', () => {
    it('renders env + a redacted log tail + a valid pre-filled URL', () => {
        const logs = [
            entry({ id: 1, level: 'Error', scope: 'audio', message: 'open /Users/milo/x.wav failed' }),
            entry({ id: 2, level: 'Warn', scope: 'ai', message: 'OPENJAMMER_PROVIDER_KEY=sk-leak123 rejected' }),
        ];
        const r = buildIssueReport({ title: 'crash on load', whatHappened: 'it broke', snapshot: SNAP, logs });

        expect(r.body).toContain('OpenJammer: 0.0.0 (stable)');
        expect(r.body).toContain('Executor: ojcore-wasm');
        expect(r.body).toContain('it broke');
        // The log tail is REDACTED in the report.
        expect(r.body).not.toContain('/Users/milo/');
        expect(r.body).not.toContain('sk-leak123');
        expect(r.url.startsWith('https://github.com/PonderingBGI/openjammer/issues/new?')).toBe(true);
        // Title + body are URL-encoded params.
        const q = new URL(r.url).searchParams;
        expect(q.get('title')).toBe('crash on load');
        expect(q.get('body')).toContain('## Environment');
        expect(r.truncated).toBe(false);
    });

    it('redacts secrets the USER pastes into the description', () => {
        const r = buildIssueReport({
            title: 't',
            whatHappened: 'my key is sk-abcdef123456 btw',
            snapshot: SNAP,
            logs: [],
        });
        expect(r.body).not.toContain('sk-abcdef123456');
    });

    it('caps the pre-filled URL body but keeps the full body intact', () => {
        const logs = Array.from({ length: 600 }, (_, i) =>
            entry({ id: i, message: `event number ${i} ${'x'.repeat(40)}` }),
        );
        const r = buildIssueReport({ title: 't', whatHappened: '', snapshot: SNAP, logs });
        expect(r.truncated).toBe(true);
        // Full body retains the whole tail; the URL is bounded well below it.
        expect(r.body.length).toBeGreaterThan(6000);
        const urlBodyLen = new URL(r.url).searchParams.get('body')!.length;
        expect(urlBodyLen).toBeLessThan(6300);
    });

    it('honours a custom logTailCount (only the last N entries)', () => {
        const logs = Array.from({ length: 10 }, (_, i) => entry({ id: i, message: `m${i}` }));
        const r = buildIssueReport({ title: 't', whatHappened: '', snapshot: SNAP, logs, logTailCount: 3 });
        expect(r.body).toContain('last 3');
        expect(r.body).toContain('m9');
        expect(r.body).not.toContain('m6');
    });

    it('falls back to a default title when blank', () => {
        const r = buildIssueReport({ title: '   ', whatHappened: '', snapshot: SNAP, logs: [] });
        expect(r.title).toBe('OpenJammer issue report');
    });
});

describe('githubIssueUrl', () => {
    it('encodes title + body as query params', () => {
        const url = githubIssueUrl('a b&c', 'body #1');
        const u = new URL(url);
        expect(u.pathname).toBe('/PonderingBGI/openjammer/issues/new');
        expect(u.searchParams.get('title')).toBe('a b&c');
        expect(u.searchParams.get('body')).toBe('body #1');
    });
});
