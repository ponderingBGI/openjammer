/**
 * IssueReporter (L5) — the one-click "report a problem" surface.
 *
 * Opened by the `openjammer:report-issue` window event (dispatched from the
 * About panel / any "report a problem" affordance). It gathers a fail-closed
 * diagnostic snapshot ({@link gatherDiagnostics}) plus a tail of the in-app
 * DevLog and renders a REDACTED markdown report ({@link buildIssueReport}).
 *
 * Nothing is sent automatically: the user sees the EXACT body in a live preview
 * (updated as they edit the title + description), can "Copy full report", and
 * only on "Open GitHub issue" is a pre-filled `issues/new` tab opened. Secrets,
 * home-directory paths, and LAN addresses are auto-redacted; the preview makes
 * that reviewable before posting.
 *
 * Always mounted (production users must be able to report). The overlay chrome
 * (portal, scrim, Escape, focus-trap) is the oj-ui Modal; the fields/preview/
 * actions are oj-ui primitives.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, PanelHeader, Field, Input, Textarea, CodeBlock, Button } from '@openjammer/oj-ui';
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

    const close = useCallback(() => setOpen(false), []);

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

    return (
        <Modal open={open} onClose={close} ariaLabel="Report a problem" size="lg">
            <PanelHeader title="Report a problem" onClose={close} />

            <div className="issue-body">
                <Field label="Title">
                    <Input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Short summary of the problem"
                    />
                </Field>

                <Field label="What happened?">
                    <Textarea
                        value={whatHappened}
                        onChange={(e) => setWhatHappened(e.target.value)}
                        rows={4}
                        placeholder="What did you do, and what went wrong? Steps to reproduce help a lot."
                    />
                </Field>

                <p className="issue-preview-note">
                    Preview — <strong>this exact text is what gets posted</strong>. Secrets,
                    home-directory paths, and LAN addresses are auto-redacted; please review.
                    {report.truncated && (
                        <em>
                            {' '}
                            The GitHub link carries a shortened log tail — use “Copy full report”
                            to paste everything.
                        </em>
                    )}
                </p>

                <CodeBlock maxHeight="320px">{report.body}</CodeBlock>
            </div>

            <footer className="issue-footer">
                <Button onClick={copyReport}>{copied ? 'Copied!' : 'Copy full report'}</Button>
                <span className="issue-footer__spacer" />
                <Button variant="primary" onClick={openIssue}>
                    Open GitHub issue →
                </Button>
            </footer>
        </Modal>
    );
}
