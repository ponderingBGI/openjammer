/**
 * U14 / HA-14 — the error boundary is no longer an un-Escapable overlay.
 *
 * It was the one unprompted, full-screen, modal thing in the app that can fire
 * mid-set: `role="alertdialog"`, no keydown handler at all, no ✕, no backdrop
 * dismiss — while its own copy admitted "Your audio may still be playing." So a
 * render crash during a show took the stage away and gave the performer two
 * choices, both of which leave the patch invisible.
 *
 * Three things are pinned here:
 *   1. Escape means *Try to recover* — the primary action, on the key every
 *      other overlay in the app already answers.
 *   2. The card collapses to a corner CHIP — no backdrop, no dialog, nothing
 *      holding the pointer — so the show goes on while the player decides.
 *   3. Once the player has dealt with the card, a repeat crash comes back as the
 *      chip, never as the wall. Blocking the stage twice is the failure mode.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../AppErrorBoundary';

vi.mock('../../utils/log', () => ({ logError: vi.fn() }));

/** Throws on demand, so one tree can crash, recover and crash again. */
function Boom({ crash, label }: { crash: boolean; label: string }) {
    if (crash) throw new Error('the keyboard exploded');
    return <p>{label}</p>;
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    // React logs every caught boundary error; the noise is not the assertion.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleError.mockRestore();
    cleanup();
});

describe('AppErrorBoundary', () => {
    it('Escape is *Try to recover*', () => {
        const { rerender } = render(
            <AppErrorBoundary><Boom crash label="the patch" /></AppErrorBoundary>,
        );
        expect(screen.getByRole('alertdialog', { name: 'Something went wrong' })).toBeInTheDocument();

        // The cause is gone by the time the player answers — the usual case for a
        // transient render crash, and the reason "try to recover" is offered.
        rerender(<AppErrorBoundary><Boom crash={false} label="the patch" /></AppErrorBoundary>);
        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(screen.getByText('the patch')).toBeInTheDocument();
    });

    it('focuses its primary action so the card is reachable from the keyboard', () => {
        render(<AppErrorBoundary><Boom crash label="the patch" /></AppErrorBoundary>);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try to recover' }));
    });

    it('collapses the full-screen card to a corner chip', () => {
        render(<AppErrorBoundary><Boom crash label="the patch" /></AppErrorBoundary>);

        fireEvent.click(screen.getByRole('button', { name: 'Hide' }));

        // No dialog, no backdrop: whatever is outside the failed subtree keeps
        // painting, and nothing is holding the pointer or the keyboard.
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(document.querySelector('.app-error-overlay')).toBeNull();
        const chip = screen.getByRole('status', { name: 'Something broke' });
        expect(chip).toHaveTextContent('your audio may still be playing');
        // Both ways out are still one keyboard-reachable button each.
        expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recover' }));
    });

    it('never takes the whole stage twice', () => {
        const { rerender } = render(
            <AppErrorBoundary><Boom crash label="the patch" /></AppErrorBoundary>,
        );
        rerender(<AppErrorBoundary><Boom crash={false} label="the patch" /></AppErrorBoundary>);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getByText('the patch')).toBeInTheDocument();

        // Second crash, same session.
        rerender(<AppErrorBoundary><Boom crash label="the patch" /></AppErrorBoundary>);

        expect(screen.queryByRole('alertdialog')).toBeNull();
        const chip = screen.getByRole('status', { name: 'Something broke' });
        expect(chip).toBeInTheDocument();
        /*
         * F5 — AND IT TAKES NO FOCUS. The card is modal and has to be where the
         * keyboard is; the chip exists so the show can go on, and yanking focus
         * out of whatever a performer's hands were on, mid-set, onto a button
         * they did not ask for is precisely what HA-14 is about.
         */
        expect(chip.contains(document.activeElement)).toBe(false);
        expect(document.activeElement).toBe(document.body);
    });

    it('the card puts its primary action first, in the DOM and in the tab order', () => {
        render(<AppErrorBoundary><Boom crash label="the patch" /></AppErrorBoundary>);
        const labels = [...screen.getByRole('alertdialog').querySelectorAll('button')].map((button) => button.textContent?.trim());
        expect(labels).toEqual(['Try to recover', 'Reload app', 'Hide']);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try to recover' }));
    });
});
