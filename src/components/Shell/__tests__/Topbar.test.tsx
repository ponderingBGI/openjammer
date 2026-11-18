import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../audio/executor', () => ({
    getExecutor: () => ({ capturePluginStates: vi.fn(), subscribeSignalLevels: () => () => {} }),
    isTauri: () => false,
}));

const { Topbar } = await import('../Topbar');

/*
 * The topbar is the one piece of fixed chrome, and it sits between the player and
 * the two meanings of `Tab`: switch surface from the stage, walk the controls from
 * a control. That only holds if a CLICK does not silently park focus on chrome —
 * which is exactly what left `bootApp`'s "click Play, then press Tab" broken in
 * the lane's first attempt at this.
 */
describe('Topbar chrome focus', () => {
    it('hands focus back to the stage after a pointer activation', () => {
        render(<Topbar onOpenSettings={vi.fn()} />);
        const settings = screen.getByRole('button', { name: 'Settings' });
        settings.focus();
        expect(document.activeElement).toBe(settings);

        fireEvent.click(settings, { detail: 1 });

        expect(document.activeElement).toBe(document.body);
    });

    it('keeps focus when a control is activated from the keyboard', () => {
        render(<Topbar onOpenSettings={vi.fn()} />);
        const settings = screen.getByRole('button', { name: 'Settings' });
        settings.focus();

        fireEvent.click(settings, { detail: 0 });

        expect(document.activeElement).toBe(settings);
    });

    it('does not steal focus from a menu the same click just opened', () => {
        render(<Topbar onOpenSettings={vi.fn()} />);
        const view = screen.getByRole('button', { name: /^View/ });
        view.focus();

        fireEvent.click(view, { detail: 1 });

        // The menu panel takes the keyboard on open; the release policy must not
        // dump the player back on the stage with a menu hanging in front of them.
        expect(screen.getByText('Pause loopers')).toBeInTheDocument();
        expect(document.activeElement).not.toBe(document.body);
    });
});
