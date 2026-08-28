import { act, fireEvent, render, screen } from '@testing-library/react';
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
