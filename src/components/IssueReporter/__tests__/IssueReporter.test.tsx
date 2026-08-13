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

        const preview = document.querySelector('.oj-code');
        expect(preview).toBeTruthy();
        expect(preview?.textContent).toContain('## Environment');
        // The seeded secret + home path are redacted in the rendered preview.
        expect(preview?.textContent).not.toContain('/Users/milo/');
        expect(preview?.textContent).not.toContain('ghp_DEADBEEF0123');

        // The local-only diagnostic affordances are offered (copy = the bundle
        // to clipboard; the GitHub link is an explicit, user-driven action).
        expect(screen.getByText(/Open GitHub issue/i)).toBeInTheDocument();
        expect(screen.getByText(/Copy diagnostics/i)).toBeInTheDocument();
    });

    it('does NOT show "Reveal log file" in a plain browser (no Tauri opener)', () => {
        render(<IssueReporter />);
        fireEvent(window, new CustomEvent('openjammer:report-issue'));
        // canRevealLogFile() is false without window.__TAURI__, so the desktop-
        // only reveal affordance is absent — local-only, never a dead button.
        expect(screen.queryByText(/Reveal log file/i)).toBeNull();
    });

    it('closes on Escape', () => {
        render(<IssueReporter />);
        fireEvent(window, new CustomEvent('openjammer:report-issue'));
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Focus is trapped inside the Modal, so a real Escape originates within
        // the dialog and bubbles to the Modal's handler (vs the old global window
        // listener). Fire it from the dialog to reflect that.
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
