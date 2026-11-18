import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as tokens from '@openjammer/oj-tokens';
import { SettingsPanel } from '../SettingsPanel';

vi.mock('../../../keymap/useKeymap', () => ({ useModalKeymap: vi.fn() }));
vi.mock('../KeybindingsPanel', () => ({ KeybindingsPanelSafe: () => null }));
vi.mock('../AudioSettingsPanel', () => ({ AudioSettingsPanel: () => null }));
vi.mock('../UpdatesPanel', () => ({ UpdatesPanel: () => null }));
vi.mock('../AboutPanel', () => ({ AboutPanel: () => null }));

describe('SettingsPanel theme picker', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('uses radio semantics, keyboard selection, and follows external theme changes', () => {
        let frame: FrameRequestCallback | undefined;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frame = callback;
            return 1;
        });
        const saveTheme = vi.spyOn(tokens, 'saveThemeId');
        render(<SettingsPanel onClose={vi.fn()} />);

        const group = screen.getByRole('radiogroup', { name: 'Interface theme' });
        const light = screen.getByRole('radio', { name: 'Light' });
        const dark = screen.getByRole('radio', { name: 'Dark' });
        expect(group).toContainElement(light);
        expect(group).toContainElement(dark);
        expect(light).toHaveAttribute('aria-checked', 'true');
        expect(dark).toHaveAttribute('aria-checked', 'false');

        light.focus();
        fireEvent.keyDown(light, { key: 'ArrowRight' });
        expect(saveTheme).toHaveBeenLastCalledWith('dark');
        expect(dark).toHaveAttribute('aria-checked', 'true');
        frame?.(0);
        expect(dark).toHaveFocus();

        localStorage.setItem('openjammer-theme', 'light');
        act(() => {
            window.dispatchEvent(new CustomEvent('openjammer:theme-change', { detail: 'light' }));
        });
        expect(light).toHaveAttribute('aria-checked', 'true');

        fireEvent.keyDown(dark, { key: ' ' });
        expect(saveTheme).toHaveBeenLastCalledWith('dark');
        expect(dark).toHaveAttribute('aria-checked', 'true');
    });
});

/**
 * The S4 gate flagged the Settings Escape contract as UNVERIFIED. It is pinned
 * here: the panel is an oj-ui Modal, which owns Escape, the Tab focus trap,
 * initial focus and focus restoration — none of it hand-rolled.
 */
describe('SettingsPanel dialog contract', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('closes on Escape from inside the dialog', () => {
        const onClose = vi.fn();
        render(<SettingsPanel onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        fireEvent.keyDown(dialog, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('moves focus into the dialog on open and restores it on close', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        expect(document.activeElement).toBe(opener);

        const { unmount } = render(<SettingsPanel onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog.contains(document.activeElement)).toBe(true);

        unmount();
        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('traps Tab inside the dialog', () => {
        render(<SettingsPanel onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
        );
        expect(focusable.length).toBeGreaterThan(1);

        const last = focusable[focusable.length - 1]!;
        last.focus();
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(document.activeElement).toBe(focusable[0]);

        focusable[0]!.focus();
        fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(last);
    });

    it('keeps every tab reachable from the sidebar', () => {
        render(<SettingsPanel onClose={vi.fn()} />);

        const sections = screen.getByRole('tablist', { name: 'Settings sections' });
        ['Appearance', 'Audio', 'Keybindings', 'Updates', 'About'].forEach((label) => {
            expect(within(sections).getByRole('tab', { name: label })).toBeInTheDocument();
        });

        // Arrow keys move AND select (the standard tablist pattern), so the
        // sidebar is fully operable without a pointer.
        const appearance = within(sections).getByRole('tab', { name: 'Appearance' });
        appearance.focus();
        fireEvent.keyDown(sections, { key: 'ArrowDown' });
        expect(within(sections).getByRole('tab', { name: 'Audio' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });
});
