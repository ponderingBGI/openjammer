/**
 * KeybindingsPanel Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { KeybindingsPanel } from '../KeybindingsPanel';
import { useKeybindingsStore, keybindingActions } from '../../../store/keybindingsStore';

function deleteRow(): HTMLElement {
    const row = screen.getByText('Delete Selected').closest('.keybindings-row');
    if (!row) throw new Error('Delete Selected row not found');
    return row as HTMLElement;
}

/**
 * The keycap control. Its accessible name describes the ACTION rather than the
 * current key ("Change the shortcut for Delete Selected"), because a button
 * announced only as "Del" tells a screen-reader user nothing about what it does.
 */
function deleteShortcutButton(): HTMLElement {
    return within(deleteRow()).getByRole('button', {
        name: 'Change the shortcut for Delete Selected',
    });
}

describe('KeybindingsPanel', () => {
    beforeEach(() => {
        cleanup();
        // Reset keybindings store
        useKeybindingsStore.setState({ customBindings: {} });
    });

    describe('rendering', () => {
        it('should render all keybinding categories', () => {
            render(<KeybindingsPanel />);

            // Every category gets its own section heading. Queried by ROLE
            // because a category word ("Canvas") can legitimately also appear on
            // the surface filter and on a group's surface chip.
            const categories = [...new Set(keybindingActions.map(a => a.category))];
            categories.forEach(category => {
                expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
            });
        });

        /*
         * 15s, not the 5s default, and the number is not a shrug.
         *
         * This test renders all 169 keybinding rows and then does 169 `getByText`
         * queries over the whole document. In ISOLATION it measures ~3.2s — a real
         * 1.6x margin under the 5s budget — but under a full parallel `test:run`
         * it loses enough CPU to the other workers to cross it, and it has failed
         * that way repeatedly across this branch's gates while passing every time
         * it was re-run alone. It is a scheduling flake, not a regression, and the
         * honest fix is to give the one slow test the budget its real work needs
         * rather than to keep re-running the suite until it is lucky.
         *
         * If this ever fails at 15s, that IS a regression: something has made
         * rendering the panel five times slower, and the number should not move.
         */
        it('should render all keybinding actions', () => {
            render(<KeybindingsPanel />);

            keybindingActions.forEach(action => {
                expect(screen.getByText(action.label)).toBeInTheDocument();
            });
        }, 15000);

        it('should show default shortcuts as a keycap', () => {
            render(<KeybindingsPanel />);

            // "Delete Selected" shows its default key on a Kbd cap.
            const row = deleteRow();
            expect(row).toContainElement(deleteShortcutButton());
            expect(within(row).getByText('Del').tagName).toBe('KBD');
        });

        it('should disable Reset All button when no custom bindings', () => {
            render(<KeybindingsPanel />);

            const resetAllButton = screen.getByText('Reset All to Defaults');
            expect(resetAllButton).toBeDisabled();
        });

        it('should enable Reset All button when custom bindings exist', () => {
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
            render(<KeybindingsPanel />);

            const resetAllButton = screen.getByText('Reset All to Defaults');
            expect(resetAllButton).not.toBeDisabled();
        });
    });

    describe('editing mode', () => {
        it('should enter editing mode when clicking a shortcut', () => {
            render(<KeybindingsPanel />);

            // Find and click the Delete shortcut button
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);

            // Should show "Press keys..." text
            expect(screen.getByText('Press keys...')).toBeInTheDocument();
        });

        it('should exit editing mode when pressing Escape', () => {
            render(<KeybindingsPanel />);

            // Enter editing mode
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);
            expect(screen.getByText('Press keys...')).toBeInTheDocument();

            // Press Escape
            fireEvent.keyDown(document, { key: 'Escape' });

            // Should exit editing mode
            expect(screen.queryByText('Press keys...')).not.toBeInTheDocument();
        });

        it('should capture key combo when pressing keys', () => {
            render(<KeybindingsPanel />);

            // Enter editing mode
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);

            // Press Ctrl+X
            fireEvent.keyDown(document, { key: 'x', ctrlKey: true });

            // Should show the captured combo
            expect(screen.getAllByText('Ctrl+X')).not.toHaveLength(0);
        });

        it('should ignore modifier-only key presses', () => {
            render(<KeybindingsPanel />);

            // Enter editing mode
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);

            // Press only Control
            fireEvent.keyDown(document, { key: 'Control' });

            // Should still show "Press keys..."
            expect(screen.getByText('Press keys...')).toBeInTheDocument();
        });
    });

    describe('saving bindings', () => {
        it('should save binding on key up after capturing combo', () => {
            render(<KeybindingsPanel />);

            // Enter editing mode
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);

            // Press and release a key
            fireEvent.keyDown(document, { key: 'F10' });
            fireEvent.keyUp(document, { key: 'F10' });

            // Binding should be saved
            const binding = useKeybindingsStore.getState().getBinding('edit.delete');
            expect(binding?.key).toBe('F10');
        });

        it('should show reset button after customizing a binding', () => {
            render(<KeybindingsPanel />);

            // Customize a binding
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);
            fireEvent.keyDown(document, { key: 'F10' });
            fireEvent.keyUp(document, { key: 'F10' });

            // Should show reset button (↺)
            const resetButton = screen.getByTitle('Reset to default');
            expect(resetButton).toBeInTheDocument();
        });
    });

    describe('conflict handling', () => {
        it('should show conflict dialog when assigning duplicate shortcut', () => {
            render(<KeybindingsPanel />);

            // Try to assign Ctrl+Z (already used by undo) to Delete
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);
            fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
            fireEvent.keyUp(document, { key: 'z' });

            // Should show conflict dialog
            expect(screen.getByText('Shortcut Conflict')).toBeInTheDocument();
            // Check for Undo in the conflict list specifically
            const conflictList = screen.getByRole('list');
            expect(conflictList).toHaveTextContent('Undo');
        });

        it('should close conflict dialog on cancel', () => {
            render(<KeybindingsPanel />);

            // Create a conflict
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);
            fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
            fireEvent.keyUp(document, { key: 'z' });

            // Click cancel
            fireEvent.click(screen.getByText('Cancel'));

            // Dialog should close, original binding unchanged
            expect(screen.queryByText('Shortcut Conflict')).not.toBeInTheDocument();
            const binding = useKeybindingsStore.getState().getBinding('edit.delete');
            expect(binding?.key).toBe('Delete'); // Still default
        });

        it('should resolve conflict and save on confirm', () => {
            render(<KeybindingsPanel />);

            // Create a conflict
            const deleteButton = deleteShortcutButton();
            fireEvent.click(deleteButton);
            fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
            fireEvent.keyUp(document, { key: 'z' });

            // Click replace
            fireEvent.click(screen.getByText('Replace'));

            // Dialog should close
            expect(screen.queryByText('Shortcut Conflict')).not.toBeInTheDocument();

            // Delete should now have Ctrl+Z
            const deleteBinding = useKeybindingsStore.getState().getBinding('edit.delete');
            expect(deleteBinding?.key).toBe('z');
            expect(deleteBinding?.ctrl).toBe(true);

            // Undo should be unbound
            const undoBinding = useKeybindingsStore.getState().getBinding('edit.undo');
            expect(undoBinding).toBeUndefined();
        });
    });

    describe('reset functionality', () => {
        it('should reset individual binding to default', () => {
            // Set a custom binding first
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
            render(<KeybindingsPanel />);

            // Click reset button
            const resetButton = screen.getByTitle('Reset to default');
            fireEvent.click(resetButton);

            // Should be back to default
            const binding = useKeybindingsStore.getState().getBinding('edit.delete');
            expect(binding?.key).toBe('Delete');
        });

        it('asks in the panel, never with a native confirm()', () => {
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
            const nativeConfirm = vi.spyOn(window, 'confirm');

            render(<KeybindingsPanel />);
            fireEvent.click(screen.getByText('Reset All to Defaults'));

            // A native dialog steals focus from a live instrument and cannot be
            // themed or dismissed like the rest of the app. It must not be used.
            expect(nativeConfirm).not.toHaveBeenCalled();
            expect(
                screen.getByRole('alertdialog', { name: 'Reset every shortcut' }),
            ).toBeInTheDocument();

            vi.restoreAllMocks();
        });

        it('should reset all bindings when confirmed in the panel', () => {
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
            useKeybindingsStore.getState().setBinding('edit.undo', { key: 'y' });

            render(<KeybindingsPanel />);

            fireEvent.click(screen.getByText('Reset All to Defaults'));
            fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));

            expect(useKeybindingsStore.getState().customBindings).toEqual({});
            expect(screen.queryByRole('alertdialog')).toBeNull();
        });

        it('should not reset when the in-panel confirm is declined', () => {
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });

            render(<KeybindingsPanel />);

            fireEvent.click(screen.getByText('Reset All to Defaults'));
            fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

            expect(useKeybindingsStore.getState().customBindings['edit.delete']).toBeDefined();
            expect(screen.queryByRole('alertdialog')).toBeNull();
        });
    });

    describe('finding a shortcut', () => {
        it('filters by search text across labels and keys', () => {
            render(<KeybindingsPanel />);

            fireEvent.change(screen.getByRole('searchbox', { name: 'Search shortcuts' }), {
                target: { value: 'quantize' },
            });

            expect(screen.getByText('Quantize Notes')).toBeInTheDocument();
            expect(screen.queryByText('Delete Selected')).toBeNull();
        });

        it('filters by surface', () => {
            render(<KeybindingsPanel />);

            fireEvent.click(screen.getByRole('tab', { name: 'Piano roll' }));

            expect(screen.getByText('Quantize Notes')).toBeInTheDocument();
            // A canvas action is not a piano-roll action.
            expect(screen.queryByText('Delete Selected')).toBeNull();
        });

        it('says so honestly when nothing matches', () => {
            render(<KeybindingsPanel />);

            fireEvent.change(screen.getByRole('searchbox', { name: 'Search shortcuts' }), {
                target: { value: 'zzzzzz' },
            });

            expect(screen.getByText('No shortcut matches that')).toBeInTheDocument();
        });
    });
});
