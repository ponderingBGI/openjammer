/**
 * DevLogPanel — toggling, tailing, and the "Ask AI to fix this" hand-off.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { DevLogPanel } from '../DevLogPanel';
import { useLogStore, _resetLogStoreForTests } from '../../../store/logStore';

beforeEach(() => _resetLogStoreForTests());
afterEach(() => cleanup());

/** Open the panel via its global toggle event. */
function openPanel(): void {
    act(() => {
        window.dispatchEvent(new CustomEvent('openjammer:toggle-devlog'));
    });
}

describe('DevLogPanel', () => {
    it('is hidden until toggled, then shows the log surface', () => {
        render(<DevLogPanel />);
        expect(screen.queryByRole('dialog', { name: /developer log/i })).toBeNull();
        openPanel();
        expect(screen.getByRole('dialog', { name: /developer log/i })).toBeTruthy();
    });

    it('tails entries appended to the log store', () => {
        render(<DevLogPanel />);
        act(() => {
            useLogStore.getState().append({
                level: 'Error',
                source: 'Ui',
                scope: 'audio',
                message: 'no audio device',
            });
        });
        openPanel();
        expect(screen.getByText('no audio device')).toBeTruthy();
    });

    it('"Ask AI to fix this" dispatches a seeded openjammer:ask-ai event', () => {
        render(<DevLogPanel />);
        openPanel();
        const seen: string[] = [];
        const onAsk = (e: Event) => {
            const prompt = (e as CustomEvent<{ prompt?: string }>).detail?.prompt ?? '';
            seen.push(prompt);
        };
        window.addEventListener('openjammer:ask-ai', onAsk);
        try {
            fireEvent.click(screen.getByRole('button', { name: /ask ai to fix this/i }));
        } finally {
            window.removeEventListener('openjammer:ask-ai', onAsk);
        }
        expect(seen).toHaveLength(1);
        // The seed nudges the agent to actually use its diagnostics tools.
        expect(seen[0]).toContain('get_diagnostics');
        expect(seen[0]).toContain('get_logs');
        // Clicking it also closes the panel (so the AI chat is unobstructed).
        expect(screen.queryByRole('dialog', { name: /developer log/i })).toBeNull();
    });
});
