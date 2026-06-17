/**
 * AuthChooser (D6, M7) render tests.
 *
 * Proves the provider-onboarding policy is visible in the UI:
 *   - opencode Zen is offered and DEFAULT-highlighted (first row);
 *   - the NON-DISMISSIBLE data-training notice is present on the Zen detail;
 *   - Anthropic is labelled "API key … NOT your Pro/Max plan";
 *   - Claude Pro/Max SUBSCRIPTION OAuth is NOT offered as a default option.
 *
 * The capability seam + external opener are mocked so the chooser renders
 * deterministically with no Tauri.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// External link open is a no-op in the test.
vi.mock('../../../ai/tauri', () => ({
    openExternal: vi.fn(),
}));

// jsdom lacks scrollIntoView + ResizeObserver, both of which cmdk uses.
beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
    if (!('ResizeObserver' in globalThis)) {
        (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }
});

import { AuthChooser } from '../AuthChooser';

describe('AuthChooser (D6)', () => {
    beforeEach(() => {
        cleanup();
    });

    it('offers opencode Zen as the first (default) option', () => {
        render(<AuthChooser onConfigured={() => {}} onBack={() => {}} />);
        const items = screen.getAllByRole('option');
        // cmdk renders Command.Item as role=option; the first is the default.
        expect(items[0]).toHaveTextContent('opencode Zen');
        // It is highlighted by default (aria-selected / data-selected).
        expect(items[0].getAttribute('data-selected') === 'true' || items[0].getAttribute('aria-selected') === 'true').toBe(true);
    });

    it('labels Anthropic as an API key, NOT the Pro/Max plan', () => {
        render(<AuthChooser onConfigured={() => {}} onBack={() => {}} />);
        // The Anthropic row's subtitle makes the billing model explicit.
        expect(
            screen.getByText(/API key — billed per token, NOT your Pro\/Max plan/i),
        ).toBeInTheDocument();
    });

    it('does NOT offer a Claude Pro/Max subscription option', () => {
        render(<AuthChooser onConfigured={() => {}} onBack={() => {}} />);
        // No "Claude Pro" / "Pro/Max subscription" choice exists.
        expect(screen.queryByText(/Claude Pro/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Pro\/Max subscription/i)).not.toBeInTheDocument();
    });

    it('shows the non-dismissible data-training notice on the Zen detail', () => {
        render(<AuthChooser onConfigured={() => {}} onBack={() => {}} />);
        // Open the opencode Zen detail.
        fireEvent.click(screen.getByText('opencode Zen'));
        expect(
            screen.getByText(
                /During its free period, collected data may be used to improve the model - do not submit personal or confidential data/i,
            ),
        ).toBeInTheDocument();
        // There is NO dismiss/close control on the notice (it is non-dismissible).
        const notice = screen.getByRole('note');
        expect(notice).toBeInTheDocument();
        expect(notice.querySelector('button')).toBeNull();
    });

    it('offers the Codex OAuth and BYO OpenAI-compatible paths', () => {
        render(<AuthChooser onConfigured={() => {}} onBack={() => {}} />);
        expect(screen.getByText('Codex (OAuth)')).toBeInTheDocument();
        expect(screen.getByText('BYO OpenAI-compatible')).toBeInTheDocument();
    });
});
