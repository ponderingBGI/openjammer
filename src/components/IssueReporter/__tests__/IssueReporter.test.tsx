/**
 * IssueReporter wiring test (L5) — verifies the parts the pure redact/diagnostics
 * unit tests can't: the `openjammer:report-issue` open seam, the live preview
 * rendering an end-to-end REDACTED report from the real log store, and Esc-close.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IssueReporter } from '../IssueReporter';
import { useLogStore } from '../../../store/logStore';

describe('IssueReporter', () => {
    afterEach(() => {
        cleanup();
        useLogStore.getState().clear();
    });

    it('stays closed until the report-issue event fires', () => {
        render(<IssueReporter />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens on openjammer:report-issue and shows an end-to-end redacted preview', () => {
        // Seed a log line carrying a home path + a secret — both must be scrubbed.
        useLogStore.getState().clear();
        useLogStore.getState().append({
            level: 'Error',
            source: 'Ui',
            scope: 'audio',
            message: 'open /Users/milo/x.wav failed (token=ghp_DEADBEEF0123)',
        });

        render(<IssueReporter />);
        fireEvent(window, new CustomEvent('openjammer:report-issue'));

        expect(screen.getByRole('dialog', { name: /report a problem/i })).toBeInTheDocument();

        const preview = document.querySelector('.issue-preview');
        expect(preview).toBeTruthy();
        expect(preview?.textContent).toContain('## Environment');
        // The seeded secret + home path are redacted in the rendered preview.
        expect(preview?.textContent).not.toContain('/Users/milo/');
        expect(preview?.textContent).not.toContain('ghp_DEADBEEF0123');

        // Both actions are offered.
        expect(screen.getByText(/Open GitHub issue/i)).toBeInTheDocument();
        expect(screen.getByText(/Copy full report/i)).toBeInTheDocument();
    });

    it('closes on Escape', () => {
        render(<IssueReporter />);
        fireEvent(window, new CustomEvent('openjammer:report-issue'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
