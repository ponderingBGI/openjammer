/**
 * Diagnostic snapshot + GitHub issue-report builder for the one-click reporter (L5).
 *
 * Two halves:
 *   • {@link gatherDiagnostics} captures a fail-CLOSED ALLOWLIST of known-safe
 *     environment facts — version, channel, executor, isolation, platform, UA.
 *     It never reads device labels, LAN peers, file paths, or AI prompts, so the
 *     snapshot cannot leak by construction.
 *   • {@link buildIssueReport} (PURE) renders the snapshot + a tail of the DevLog
 *     into a redacted markdown body and a pre-filled `issues/new` URL. EVERY piece
 *     of free-form text (the user's description, log messages + fields) is run
 *     through {@link redactText} / {@link redactValue} first.
 *
 * The caller (the IssueReporter modal) shows the user the FULL rendered body
 * before anything is sent — nothing is transmitted automatically.
 */

import type { LogEntry } from '../store/logStore';
import { redactText, redactValue } from './redact';

/** The canonical issues repo (mirrors package.json `repository`). */
const ISSUES_REPO = 'PonderingBGI/openjammer';

/** Recent log entries attached by default. */
export const DEFAULT_LOG_TAIL = 80;

/**
 * GitHub rejects/truncates very long `issues/new` URLs, so the pre-filled URL
 * carries at most this many characters of body; the modal's "Copy full report"
 * always has the complete text.
 */
const URL_BODY_BUDGET = 6000;

/** The fail-closed allowlist of environment facts attached to a report. */
export interface DiagnosticSnapshot {
    /** App version (release SSOT, inlined as `__APP_VERSION__`). */
    version: string;
    /** Release channel derived from the build flags. */
    channel: 'dev' | 'canary' | 'stable';
    /** Selected audio transport (`VITE_OJ_EXECUTOR`), or `(auto)`. */
    executor: string;
    /** Whether the page is cross-origin isolated (SharedArrayBuffer fast path). */
    crossOriginIsolated: boolean;
    /** `navigator.platform` (coarse OS family, e.g. `Win32`, `MacIntel`). */
    platform: string;
    /** `navigator.userAgent` (browser/version — no app secrets). */
    userAgent: string;
}

/** Capture the allowlisted environment snapshot (safe to attach to a report). */
export function gatherDiagnostics(): DiagnosticSnapshot {
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
    const canary =
        import.meta.env.VITE_OJ_CANARY === 'true' || import.meta.env.VITE_OJ_CANARY === '1';
    const channel: DiagnosticSnapshot['channel'] = import.meta.env.DEV
        ? 'dev'
        : canary
          ? 'canary'
          : 'stable';
    const coi = typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false;
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    return {
        version,
        channel,
        executor: import.meta.env.VITE_OJ_EXECUTOR ?? '(auto)',
        crossOriginIsolated: coi,
        platform: nav?.platform ?? 'unknown',
        userAgent: nav?.userAgent ?? 'unknown',
    };
}

/** Render one log entry as a single redacted line for the report's log block. */
function formatLogEntry(e: LogEntry): string {
    const ts = new Date(e.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
    const msg = redactText(e.message);
    const fields =
        e.fields !== undefined ? ` ${redactText(JSON.stringify(redactValue(e.fields)))}` : '';
    const corr = e.corr !== undefined ? ` #${e.corr}` : '';
    return `${ts} ${e.level.padEnd(5)} ${e.scope}: ${msg}${fields}${corr}`;
}

export interface IssueReportInput {
    /** Issue title (also redacted defensively). */
    title: string;
    /** The user's free-form description (redacted defensively). */
    whatHappened: string;
    /** The captured environment snapshot. */
    snapshot: DiagnosticSnapshot;
    /** The full DevLog ring; the tail is taken from the end. */
    logs: readonly LogEntry[];
    /** How many trailing log entries to include (default {@link DEFAULT_LOG_TAIL}). */
    logTailCount?: number;
}

export interface IssueReport {
    /** Redacted title. */
    title: string;
    /** The FULL redacted markdown body (shown to the user + "Copy full report"). */
    body: string;
    /** Pre-filled `issues/new` URL (body truncated to stay under the length cap). */
    url: string;
    /** Whether the URL body was truncated relative to {@link IssueReport.body}. */
    truncated: boolean;
}

/**
 * Build the redacted issue body + a pre-filled GitHub `issues/new` URL. PURE: all
 * inputs are passed in (no globals), so it is fully unit-testable.
 */
export function buildIssueReport(input: IssueReportInput): IssueReport {
    const { snapshot, logs } = input;
    const title = redactText(input.title.trim() || 'OpenJammer issue report');
    const n = input.logTailCount ?? DEFAULT_LOG_TAIL;
    const tail = logs.slice(-n);
    const logBlock = tail.length ? tail.map(formatLogEntry).join('\n') : '(no log entries captured)';

    const env = [
        `- OpenJammer: ${snapshot.version} (${snapshot.channel})`,
        `- Executor: ${snapshot.executor}`,
        `- Cross-origin isolated: ${snapshot.crossOriginIsolated}`,
        `- Platform: ${snapshot.platform}`,
        `- User agent: ${redactText(snapshot.userAgent)}`,
    ].join('\n');

    const whatBlock = redactText(
        input.whatHappened.trim() || '_(describe what happened and the steps to reproduce)_',
    );

    const body = [
        '## What happened',
        whatBlock,
        '',
        '## Environment',
        env,
        '',
        `## Recent logs (redacted, last ${tail.length})`,
        '```',
        logBlock,
        '```',
        '',
        '<sub>Generated by OpenJammer’s in-app reporter. Secrets, home-directory paths, and LAN addresses are redacted automatically — please review before posting.</sub>',
    ].join('\n');

    let urlBody = body;
    let truncated = false;
    if (urlBody.length > URL_BODY_BUDGET) {
        urlBody =
            `${urlBody.slice(0, URL_BODY_BUDGET)}\n…\n` +
            '_(log tail truncated for the URL — use “Copy full report” to paste everything)_';
        truncated = true;
    }

    return { title, body, url: githubIssueUrl(title, urlBody), truncated };
}

/** Build a pre-filled GitHub `issues/new` URL with the given title + body. */
export function githubIssueUrl(title: string, body: string): string {
    const params = new URLSearchParams({ title, body });
    return `https://github.com/${ISSUES_REPO}/issues/new?${params.toString()}`;
}
