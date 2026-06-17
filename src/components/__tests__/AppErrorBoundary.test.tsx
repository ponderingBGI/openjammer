/**
 * AppErrorBoundary — a render crash shows the calm recovery card (never a blank
 * screen), logs the error into the DevLog ring, and can recover.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AppErrorBoundary } from '../AppErrorBoundary';
import { useLogStore, _resetLogStoreForTests } from '../../store/logStore';

beforeEach(() => _resetLogStoreForTests());
afterEach(() => cleanup());

/** A child that throws on first render, then renders fine after `fixed` flips. */
function Bomb({ boom }: { boom: { current: boolean } }) {
    if (boom.current) throw new Error('kaboom');
    return <div>recovered content</div>;
}

describe('AppErrorBoundary', () => {
    it('shows the recovery card instead of crashing, and logs the error', () => {
        // Silence React's expected error console noise for this throw.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = { current: true };
        render(
            <AppErrorBoundary>
                <Bomb boom={boom} />
            </AppErrorBoundary>,
        );
        expect(screen.getByRole('alertdialog', { name: /something went wrong/i })).toBeTruthy();
        expect(screen.getByText('kaboom')).toBeTruthy();
        // The crash was routed into the DevLog ring.
        const entries = useLogStore.getState().entries;
        expect(entries.some((e) => e.level === 'Error' && e.message.includes('Render crash'))).toBe(true);
        spy.mockRestore();
    });

    it('renders children normally when there is no error', () => {
        const boom = { current: false };
        render(
            <AppErrorBoundary>
                <Bomb boom={boom} />
            </AppErrorBoundary>,
        );
        expect(screen.getByText('recovered content')).toBeTruthy();
    });

    it('"Try to recover" re-mounts the tree', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = { current: true };
        render(
            <AppErrorBoundary>
                <Bomb boom={boom} />
            </AppErrorBoundary>,
        );
        // Fix the underlying cause, then recover.
        boom.current = false;
        fireEvent.click(screen.getByRole('button', { name: /try to recover/i }));
        expect(screen.getByText('recovered content')).toBeTruthy();
        spy.mockRestore();
    });
});
