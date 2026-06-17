/**
 * AudioHealthPanel — toggling + the live status readout + the fix-it hand-offs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { AudioHealthPanel } from '../AudioHealthPanel';
import { useAudioStore } from '../../../store/audioStore';

beforeEach(() => {
    useAudioStore.getState().setAudioContextReady(false);
});
afterEach(() => cleanup());

function open(): void {
    act(() => window.dispatchEvent(new CustomEvent('openjammer:toggle-audio-health')));
}

describe('AudioHealthPanel', () => {
    it('is hidden until toggled', () => {
        render(<AudioHealthPanel />);
        expect(screen.queryByRole('dialog', { name: /audio health/i })).toBeNull();
        open();
        expect(screen.getByRole('dialog', { name: /audio health/i })).toBeTruthy();
    });

    it('closes on Escape', () => {
        render(<AudioHealthPanel />);
        open();
        expect(screen.getByRole('dialog', { name: /audio health/i })).toBeTruthy();
        act(() => fireEvent.keyDown(window, { key: 'Escape' }));
        expect(screen.queryByRole('dialog', { name: /audio health/i })).toBeNull();
    });

    it('shows "not started" when the AudioContext is idle', () => {
        render(<AudioHealthPanel />);
        open();
        expect(screen.getByText('not started')).toBeTruthy();
    });

    it('reflects a running engine + its latency', () => {
        act(() => {
            useAudioStore.getState().setAudioContextReady(true);
            useAudioStore.getState().updateAudioMetrics({
                estimatedRoundTrip: 9,
                classification: 'excellent',
                sampleRate: 48000,
            });
        });
        render(<AudioHealthPanel />);
        open();
        expect(screen.getByText('running')).toBeTruthy();
        expect(screen.getByText(/9 ms \(excellent\)/)).toBeTruthy();
    });

    it('"Ask AI to fix" dispatches a seeded openjammer:ask-ai event', () => {
        render(<AudioHealthPanel />);
        open();
        const seen: string[] = [];
        const onAsk = (e: Event) =>
            seen.push((e as CustomEvent<{ prompt?: string }>).detail?.prompt ?? '');
        window.addEventListener('openjammer:ask-ai', onAsk);
        try {
            fireEvent.click(screen.getByRole('button', { name: /ask ai to fix/i }));
        } finally {
            window.removeEventListener('openjammer:ask-ai', onAsk);
        }
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain('get_diagnostics');
    });

    it('"Open Settings" dispatches the settings toggle', () => {
        render(<AudioHealthPanel />);
        open();
        let toggled = false;
        const onToggle = () => {
            toggled = true;
        };
        window.addEventListener('openjammer:toggle-settings', onToggle);
        try {
            fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
        } finally {
            window.removeEventListener('openjammer:toggle-settings', onToggle);
        }
        expect(toggled).toBe(true);
    });
});
