import { describe, it, expect, beforeEach } from 'vitest';
import {
    useKeybindingsStore,
    keyComboToString,
    matchesKeyCombo,
    keyComboEquals,
    keybindingActions,
    UNBOUND_KEY,
    type KeyCombo,
    type KeybindingAction,
} from '../keybindingsStore';

describe('keybindingsStore', () => {
    beforeEach(() => {
        // Reset store to initial state
        useKeybindingsStore.setState({ customBindings: {} });
    });

    describe('keyComboToString', () => {
        it('should format simple key', () => {
            expect(keyComboToString({ key: 'a' })).toBe('A');
        });

        it('should format key with Ctrl modifier', () => {
            expect(keyComboToString({ key: 'z', ctrl: true })).toBe('Ctrl+Z');
        });

        it('should format key with multiple modifiers', () => {
            expect(keyComboToString({ key: 'z', ctrl: true, shift: true })).toBe('Ctrl+Shift+Z');
        });

        it('should format special keys correctly', () => {
            expect(keyComboToString({ key: 'Delete' })).toBe('Del');
            expect(keyComboToString({ key: ' ' })).toBe('Space');
            expect(keyComboToString({ key: 'Backspace' })).toBe('Backspace');
        });

        it('should include all modifiers in correct order', () => {
            expect(keyComboToString({
                key: 'a',
                ctrl: true,
                meta: true,
                alt: true,
                shift: true
            })).toBe('Ctrl+Cmd+Alt+Shift+A');
        });
    });

    describe('matchesKeyCombo', () => {
        it('should match simple key press', () => {
            const event = new KeyboardEvent('keydown', { key: 'a' });
            expect(matchesKeyCombo(event, { key: 'a' })).toBe(true);
        });

        it('should match key with Ctrl modifier', () => {
            const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
            expect(matchesKeyCombo(event, { key: 'z', ctrl: true })).toBe(true);
        });

        it('should not match when modifier is missing', () => {
            const event = new KeyboardEvent('keydown', { key: 'z' });
            expect(matchesKeyCombo(event, { key: 'z', ctrl: true })).toBe(false);
        });

        it('should not match when extra modifier is pressed', () => {
            const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true });
            expect(matchesKeyCombo(event, { key: 'z', ctrl: true })).toBe(false);
        });

        it('should be case insensitive for letters', () => {
            const event = new KeyboardEvent('keydown', { key: 'A' });
            expect(matchesKeyCombo(event, { key: 'a' })).toBe(true);
        });

        it('should treat ctrl and meta as interchangeable', () => {
            const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true });
            expect(matchesKeyCombo(event, { key: 'z', ctrl: true })).toBe(true);
        });
    });

    describe('keyComboEquals', () => {
        it('should return true for identical combos', () => {
            const a: KeyCombo = { key: 'z', ctrl: true };
            const b: KeyCombo = { key: 'z', ctrl: true };
            expect(keyComboEquals(a, b)).toBe(true);
        });

        it('should be case insensitive', () => {
            const a: KeyCombo = { key: 'A' };
            const b: KeyCombo = { key: 'a' };
            expect(keyComboEquals(a, b)).toBe(true);
        });

        it('should return false for different keys', () => {
            const a: KeyCombo = { key: 'a' };
            const b: KeyCombo = { key: 'b' };
            expect(keyComboEquals(a, b)).toBe(false);
        });

        it('should return false when modifiers differ', () => {
            const a: KeyCombo = { key: 'z', ctrl: true };
            const b: KeyCombo = { key: 'z' };
            expect(keyComboEquals(a, b)).toBe(false);
        });

        it('should treat ctrl and meta as equivalent', () => {
            const a: KeyCombo = { key: 'z', ctrl: true };
            const b: KeyCombo = { key: 'z', meta: true };
            expect(keyComboEquals(a, b)).toBe(true);
        });

        it('should handle undefined modifiers', () => {
            const a: KeyCombo = { key: 'z', ctrl: true, shift: undefined };
            const b: KeyCombo = { key: 'z', ctrl: true };
            expect(keyComboEquals(a, b)).toBe(true);
        });
    });

    describe('store actions', () => {
        describe('getBinding', () => {
            it('should return default binding when no custom binding exists', () => {
                const binding = useKeybindingsStore.getState().getBinding('edit.undo');
                expect(binding).toEqual({ key: 'z', ctrl: true });
            });

            it('should return custom binding when set', () => {
                useKeybindingsStore.getState().setBinding('edit.undo', { key: 'u', ctrl: true });
                const binding = useKeybindingsStore.getState().getBinding('edit.undo');
                expect(binding).toEqual({ key: 'u', ctrl: true });
            });

            it('should return undefined for unknown action', () => {
                const binding = useKeybindingsStore.getState().getBinding('unknown.action');
                expect(binding).toBeUndefined();
            });
        });

        describe('setBinding', () => {
            it('should set custom binding', () => {
                const newCombo: KeyCombo = { key: 'x', ctrl: true };
                useKeybindingsStore.getState().setBinding('edit.delete', newCombo);
                expect(useKeybindingsStore.getState().customBindings['edit.delete']).toEqual(newCombo);
            });

            it('should override existing custom binding', () => {
                useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x' });
                useKeybindingsStore.getState().setBinding('edit.delete', { key: 'y' });
                expect(useKeybindingsStore.getState().customBindings['edit.delete']).toEqual({ key: 'y' });
            });
        });

        describe('resetBinding', () => {
            it('should remove custom binding', () => {
                useKeybindingsStore.getState().setBinding('edit.undo', { key: 'u' });
                useKeybindingsStore.getState().resetBinding('edit.undo');
                expect(useKeybindingsStore.getState().customBindings['edit.undo']).toBeUndefined();
            });

            it('should revert to default binding after reset', () => {
                useKeybindingsStore.getState().setBinding('edit.undo', { key: 'u' });
                useKeybindingsStore.getState().resetBinding('edit.undo');
                const binding = useKeybindingsStore.getState().getBinding('edit.undo');
                expect(binding).toEqual({ key: 'z', ctrl: true });
            });
        });

        describe('resetAllBindings', () => {
            it('should clear all custom bindings', () => {
                useKeybindingsStore.getState().setBinding('edit.undo', { key: 'u' });
                useKeybindingsStore.getState().setBinding('edit.redo', { key: 'r' });
                useKeybindingsStore.getState().resetAllBindings();
                expect(useKeybindingsStore.getState().customBindings).toEqual({});
            });
        });

        describe('matchesAction', () => {
            it('should return true when event matches action binding', () => {
                const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
                expect(useKeybindingsStore.getState().matchesAction(event, 'edit.undo')).toBe(true);
            });

            it('should return false when event does not match', () => {
                const event = new KeyboardEvent('keydown', { key: 'x' });
                expect(useKeybindingsStore.getState().matchesAction(event, 'edit.undo')).toBe(false);
            });

            it('should use custom binding when set', () => {
                useKeybindingsStore.getState().setBinding('edit.undo', { key: 'u', ctrl: true });
                const event = new KeyboardEvent('keydown', { key: 'u', ctrlKey: true });
                expect(useKeybindingsStore.getState().matchesAction(event, 'edit.undo')).toBe(true);
            });
        });

        describe('getMatchingActions', () => {
            it('should return matching actions for key event', () => {
                const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true });
                const matches = useKeybindingsStore.getState().getMatchingActions(event);
                expect(matches).toContain('edit.undo');
            });

            it('should return empty array when no actions match', () => {
                const event = new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, altKey: true });
                const matches = useKeybindingsStore.getState().getMatchingActions(event);
                expect(matches).toHaveLength(0);
            });
        });

        describe('getConflictingActions', () => {
            it('only conflicts across equal scopes or a global scope', () => {
                const scoped: KeybindingAction[] = [
                    {
                        id: 'test.canvas',
                        label: 'Canvas action',
                        category: 'Test',
                        scope: 'surface',
                        surface: 'canvas',
                        defaultBinding: { key: 'F9' },
                    },
                    {
                        id: 'test.arrangement',
                        label: 'Arrangement action',
                        category: 'Test',
                        scope: 'surface',
                        surface: 'arrangement',
                        defaultBinding: { key: 'F9' },
                    },
                    {
                        id: 'test.canvas-peer',
                        label: 'Canvas peer',
                        category: 'Test',
                        scope: 'surface',
                        surface: 'canvas',
                        defaultBinding: { key: 'F9' },
                    },
                    {
                        id: 'test.global',
                        label: 'Global action',
                        category: 'Test',
                        scope: 'global',
                        defaultBinding: { key: 'F9' },
                    },
                ];
                keybindingActions.push(...scoped);
                try {
                    const conflicts = useKeybindingsStore.getState().getConflictingActions(
                        'test.canvas',
                        { key: 'F9' },
                    );
                    expect(conflicts.map((action) => action.id)).toContain('test.canvas-peer');
                    expect(conflicts.map((action) => action.id)).toContain('test.global');
                    expect(conflicts.map((action) => action.id)).not.toContain('test.arrangement');
                } finally {
                    keybindingActions.splice(-scoped.length);
                }
            });

            it('should return empty array when no conflicts', () => {
                const conflicts = useKeybindingsStore.getState().getConflictingActions(
                    'edit.delete',
                    { key: 'x', ctrl: true }
                );
                expect(conflicts).toHaveLength(0);
            });

            it('should detect conflicts with default bindings', () => {
                // Ctrl+Z is bound to edit.undo by default
                const conflicts = useKeybindingsStore.getState().getConflictingActions(
                    'edit.delete', // Not edit.undo
                    { key: 'z', ctrl: true }
                );
                expect(conflicts.length).toBeGreaterThan(0);
                expect(conflicts.some(a => a.id === 'edit.undo')).toBe(true);
            });

            it('should not include the action being set', () => {
                const conflicts = useKeybindingsStore.getState().getConflictingActions(
                    'edit.undo',
                    { key: 'z', ctrl: true }
                );
                expect(conflicts.some(a => a.id === 'edit.undo')).toBe(false);
            });

            it('should detect conflicts with custom bindings', () => {
                // Set a custom binding for edit.delete
                useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x', ctrl: true });

                // Now try to set another action to the same combo
                const conflicts = useKeybindingsStore.getState().getConflictingActions(
                    'edit.undo',
                    { key: 'x', ctrl: true }
                );
                expect(conflicts.some(a => a.id === 'edit.delete')).toBe(true);
            });
        });

        describe('clearConflictingBindings', () => {
            it('should clear conflicting bindings using UNBOUND_KEY sentinel', () => {
                // Set up a conflict
                useKeybindingsStore.getState().setBinding('edit.delete', { key: 'x', ctrl: true });

                // Clear conflicts when setting another action to same combo
                useKeybindingsStore.getState().clearConflictingBindings('edit.undo', { key: 'x', ctrl: true });

                // The conflicting binding should now use UNBOUND_KEY sentinel
                const rawBinding = useKeybindingsStore.getState().customBindings['edit.delete'];
                expect(rawBinding?.key).toBe(UNBOUND_KEY);

                // getBinding should return undefined for unbound keys
                const binding = useKeybindingsStore.getState().getBinding('edit.delete');
                expect(binding).toBeUndefined();
            });

            it('should do nothing when no conflicts', () => {
                const initialBindings = { ...useKeybindingsStore.getState().customBindings };
                useKeybindingsStore.getState().clearConflictingBindings('edit.delete', { key: 'q', alt: true });
                expect(useKeybindingsStore.getState().customBindings).toEqual(initialBindings);
            });

            it('should clear default bindings that conflict', () => {
                // Try to set edit.delete to Ctrl+Z (which conflicts with edit.undo default)
                useKeybindingsStore.getState().clearConflictingBindings('edit.delete', { key: 'z', ctrl: true });

                // edit.undo should now return undefined
                const binding = useKeybindingsStore.getState().getBinding('edit.undo');
                expect(binding).toBeUndefined();
            });
        });
    });

    describe('keybindingActions', () => {
        it('should have all required actions defined', () => {
            const requiredActions = [
                'file.new',
                'file.import',
                'file.export',
                'edit.delete',
                'edit.undo',
                'edit.redo',
                'view.zoomIn',
                'view.zoomOut',
                'view.resetView',
                'view.ghostMode',
                'canvas.multiConnect',
            ];

            for (const actionId of requiredActions) {
                const action = keybindingActions.find(a => a.id === actionId);
                expect(action, `Missing action: ${actionId}`).toBeDefined();
                expect(action?.label).toBeTruthy();
                expect(action?.category).toBeTruthy();
                expect(action?.defaultBinding).toBeDefined();
            }
        });
    });

    describe('UNBOUND_KEY sentinel', () => {
        it('should be a unique identifier string', () => {
            expect(UNBOUND_KEY).toBe('__UNBOUND__');
        });

        it('should cause getBinding to return undefined', () => {
            // Manually set an unbound binding
            useKeybindingsStore.setState({
                customBindings: { 'edit.delete': { key: UNBOUND_KEY } }
            });

            const binding = useKeybindingsStore.getState().getBinding('edit.delete');
            expect(binding).toBeUndefined();
        });

        it('should not match any key events', () => {
            useKeybindingsStore.setState({
                customBindings: { 'edit.delete': { key: UNBOUND_KEY } }
            });

            // Try various key events - none should match
            const events = [
                new KeyboardEvent('keydown', { key: UNBOUND_KEY }),
                new KeyboardEvent('keydown', { key: 'Delete' }),
                new KeyboardEvent('keydown', { key: '' }),
            ];

            for (const event of events) {
                expect(useKeybindingsStore.getState().matchesAction(event, 'edit.delete')).toBe(false);
            }
        });
    });

    describe('localStorage validation', () => {
        it('should handle corrupted JSON gracefully', () => {
            localStorage.setItem('openjammer-keybindings', 'not valid json');

            // Access the store's internal storage
            const storage = (useKeybindingsStore as unknown as {
                persist: { getOptions: () => { storage: { getItem: (name: string) => string | null } } }
            }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem('openjammer-keybindings');
                // Should return null on parse error
                expect(result).toBeNull();
            }
        });

        it('should handle invalid customBindings type gracefully', () => {
            localStorage.setItem('openjammer-keybindings', JSON.stringify({
                state: {
                    customBindings: 'not an object'
                }
            }));

            const storage = (useKeybindingsStore as unknown as {
                persist: { getOptions: () => { storage: { getItem: (name: string) => { state: { customBindings: Record<string, unknown> } } | null } } }
            }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem('openjammer-keybindings');
                if (result) {
                    expect(result.state.customBindings).toEqual({});
                }
            }
        });

        it('should filter out bindings without valid key property', () => {
            localStorage.setItem('openjammer-keybindings', JSON.stringify({
                state: {
                    customBindings: {
                        'valid': { key: 'a', ctrl: true },
                        'invalid-null': null,
                        'invalid-no-key': { ctrl: true },
                        'invalid-wrong-type': { key: 123 },
                    }
                }
            }));

            const storage = (useKeybindingsStore as unknown as {
                persist: { getOptions: () => { storage: { getItem: (name: string) => { state: { customBindings: Record<string, unknown> } } | null } } }
            }).persist?.getOptions?.()?.storage;

            if (storage) {
                const result = storage.getItem('openjammer-keybindings');
                if (result) {
                    expect(result.state.customBindings['valid']).toBeDefined();
                    expect(result.state.customBindings['invalid-null']).toBeUndefined();
                    expect(result.state.customBindings['invalid-no-key']).toBeUndefined();
                    expect(result.state.customBindings['invalid-wrong-type']).toBeUndefined();
                }
            }
        });
    });
});
