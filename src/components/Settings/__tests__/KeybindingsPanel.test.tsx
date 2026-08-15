/**
 * KeybindingsPanel Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { KeybindingsPanel } from '../KeybindingsPanel';
import { useKeybindingsStore, keybindingActions } from '../../../store/keybindingsStore';

function deleteShortcutButton(): HTMLElement {
    const row = screen.getByText('Delete Selected').closest('.keybindings-row');
    if (!row) throw new Error('Delete Selected row not found');
    return within(row as HTMLElement).getByRole('button', { name: 'Del' });
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

            // Check that all categories are rendered
            const categories = [...new Set(keybindingActions.map(a => a.category))];
            categories.forEach(category => {
                expect(screen.getByText(category)).toBeInTheDocument();
            });
        });

        it('should render all keybinding actions', () => {
            render(<KeybindingsPanel />);

            keybindingActions.forEach(action => {
                expect(screen.getByText(action.label)).toBeInTheDocument();
            });
        });

        it('should show default shortcuts', () => {
            render(<KeybindingsPanel />);

            // Check for "Delete Selected" which should show "Del"
            const deleteRow = screen.getByText('Delete Selected').closest('.keybindings-row');
            expect(deleteRow).toContainElement(deleteShortcutButton());
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
            expect(screen.getByText('Ctrl+X')).toBeInTheDocument();
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

        it('should reset all bindings when confirmed', () => {
            // Set custom bindings
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
            useKeybindingsStore.getState().setBinding('edit.undo', { key: 'y' });

            // Mock confirm
            vi.spyOn(window, 'confirm').mockReturnValue(true);

            render(<KeybindingsPanel />);

            // Click reset all
            fireEvent.click(screen.getByText('Reset All to Defaults'));

            // All bindings should be reset
            expect(useKeybindingsStore.getState().customBindings).toEqual({});

            vi.restoreAllMocks();
        });

        it('should not reset when confirm is cancelled', () => {
            // Set custom binding
            useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });

            // Mock confirm to return false
            vi.spyOn(window, 'confirm').mockReturnValue(false);

            render(<KeybindingsPanel />);

            // Click reset all
            fireEvent.click(screen.getByText('Reset All to Defaults'));

            // Binding should remain
            expect(useKeybindingsStore.getState().customBindings['edit.delete']).toBeDefined();

            vi.restoreAllMocks();
        });
    });
});
