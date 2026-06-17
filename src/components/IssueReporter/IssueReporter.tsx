/**
 * IssueReporter (L5) — the one-click "report a problem" surface.
 *
 * A portal overlay (mirroring DevLogPanel's `createPortal` pattern) opened by the
 * `openjammer:report-issue` window event (dispatched from the About panel / any
 * "report a problem" affordance). It gathers a fail-closed diagnostic snapshot
 * ({@link gatherDiagnostics}) plus a tail of the in-app DevLog and renders a
 * REDACTED markdown report ({@link buildIssueReport}).
 *
 * Nothing is sent automatically: the user sees the EXACT body in a live preview
 * (updated as they edit the title + description), can "Copy full report", and
 * only on "Open GitHub issue" is a pre-filled `issues/new` tab opened. Secrets,
 * home-directory paths, and LAN addresses are auto-redacted; the preview makes
 * that reviewable before posting.
 *
 * Always mounted (production users must be able to report) — unlike the DevLog,
 * there is no dev/canary gate.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLogStore } from '../../store/logStore';
import { buildIssueReport, gatherDiagnostics } from '../../utils/diagnostics';
import './IssueReporter.css';

export function IssueReporter() {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [whatHappened, setWhatHappened] = useState('');
    const [copied, setCopied] = useState(false);

    const entries = useLogStore((s) => s.entries);

    // Opened by the window event (dispatched from About / any report affordance).
    useEffect(() => {
        const onOpen = () => setOpen(true);
        window.addEventListener('openjammer:report-issue', onOpen);
        return () => window.removeEventListener('openjammer:report-issue', onOpen);
    }, []);

    // Esc closes while open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    // The environment snapshot is fixed for the page's lifetime, so capture once.
    const snapshot = useMemo(() => gatherDiagnostics(), []);
    const report = useMemo(
        () => buildIssueReport({ title, whatHappened, snapshot, logs: entries }),
        [title, whatHappened, snapshot, entries],
    );

    const copyReport = useCallback(() => {
        navigator.clipboard?.writeText(report.body).then(
            () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
            },
            () => {
                // Clipboard denied/unavailable — the preview text is selectable.
            },
        );
    }, [report.body]);

    const openIssue = useCallback(() => {
        window.open(report.url, '_blank', 'noopener,noreferrer');
    }, [report.url]);

    if (!open) return null;

    return createPortal(
        <div className="issue-overlay" onClick={() => setOpen(false)}>
            <div
                className="issue-panel"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Report a problem"
            >
                <header className="issue-header">
                    <span className="issue-title-text">Report a problem</span>
                    <span className="issue-spacer" />
                    <button className="issue-btn" onClick={() => setOpen(false)} title="Close (Esc)">
                        ✕
                    </button>
                </header>

                <div className="issue-body">
                    <label className="issue-field">
                        <span className="issue-field-label">Title</span>
                        <input
                            className="issue-input"
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Short summary of the problem"
                        />
                    </label>

                    <label className="issue-field">
                        <span className="issue-field-label">What happened?</span>
                        <textarea
                            className="issue-textarea"
                            value={whatHappened}
                            onChange={(e) => setWhatHappened(e.target.value)}
                            rows={4}
                            placeholder="What did you do, and what went wrong? Steps to reproduce help a lot."
                        />
                    </label>

                    <div className="issue-preview-note">
                        Preview — <strong>this exact text is what gets posted</strong>. Secrets,
                        home-directory paths, and LAN addresses are auto-redacted; please review.
                        {report.truncated && (
                            <em>
                                {' '}
                                The GitHub link carries a shortened log tail — use “Copy full report”
                                to paste everything.
                            </em>
                        )}
                    </div>
                    <pre className="issue-preview">{report.body}</pre>
                </div>

                <footer className="issue-footer">
                    <button className="issue-btn" onClick={copyReport}>
                        {copied ? 'Copied!' : 'Copy full report'}
                    </button>
                    <span className="issue-spacer" />
                    <button className="issue-btn issue-btn-primary" onClick={openIssue}>
                        Open GitHub issue →
                    </button>
                </footer>
            </div>
        </div>,
        document.body,
    );
}
