/**
 * Keybindings Store - Manages customizable keyboard shortcuts
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeymapScope } from '../keymap/types';
import type { SurfaceId } from './uiViewStore';

// ============================================================================
// Constants
// ============================================================================

// Sentinel value for explicitly unbound keybindings (cleared conflicts)
export const UNBOUND_KEY = '__UNBOUND__';

// ============================================================================
// Types
// ============================================================================

export interface KeyCombo {
    key: string;           // The main key (e.g., 'z', 'Delete', '=')
    ctrl?: boolean;        // Ctrl key (Windows/Linux)
    meta?: boolean;        // Cmd key (Mac)
    shift?: boolean;       // Shift key
    alt?: boolean;         // Alt key
}

export interface KeybindingAction {
    id: string;
    label: string;         // Display name
    category: string;      // For grouping in UI
    defaultBinding: KeyCombo;
    /** Surface where the shortcut is active. Global shortcuts overlap every scope. */
    scope: Exclude<KeymapScope, 'text' | 'modal'>;
    surface?: SurfaceId;
}

// ============================================================================
// Default Keybindings
// ============================================================================

export const keybindingActions: KeybindingAction[] = [
    // File actions
    {
        id: 'file.new',
        label: 'New Workflow',
        category: 'File',
        defaultBinding: { key: 'n', ctrl: true },
        scope: 'global',
    },
    {
        id: 'file.import',
        label: 'Import Workflow',
        category: 'File',
        defaultBinding: { key: 'o', ctrl: true },
        scope: 'global',
    },
    {
        id: 'file.save',
        label: 'Save Project',
        category: 'File',
        defaultBinding: { key: 's', ctrl: true },
        scope: 'global',
    },
    {
        id: 'file.export',
        label: 'Export Song',
        category: 'File',
        defaultBinding: { key: 'e', ctrl: true, shift: true },
        scope: 'global',
    },

    // Edit actions
    {
        id: 'edit.delete',
        label: 'Delete Selected',
        category: 'Edit',
        defaultBinding: { key: 'Delete' },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'edit.undo',
        label: 'Undo',
        category: 'Edit',
        defaultBinding: { key: 'z', ctrl: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'edit.redo',
        label: 'Redo',
        category: 'Edit',
        defaultBinding: { key: 'z', ctrl: true, shift: true },
        scope: 'surface', surface: 'canvas',
    },

    // View actions
    {
        id: 'view.zoomIn',
        label: 'Zoom In',
        category: 'View',
        defaultBinding: { key: '=', ctrl: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'view.zoomOut',
        label: 'Zoom Out',
        category: 'View',
        defaultBinding: { key: '-', ctrl: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'view.resetView',
        label: 'Reset View',
        category: 'View',
        defaultBinding: { key: '0', ctrl: true },
        scope: 'surface', surface: 'canvas',
    },
    {
        id: 'view.ghostMode',
        label: 'Toggle Ghost Mode',
        category: 'View',
        defaultBinding: { key: 'w' },
        scope: 'surface', surface: 'canvas',
    },

    // Canvas actions
    {
        id: 'canvas.multiConnect',
        label: 'Multi-Connect Mode',
        category: 'Canvas',
        defaultBinding: { key: 'a' },
        scope: 'surface', surface: 'canvas',
    },
    { id: 'view.toggleArrangement', label: 'Toggle Arrangement', category: 'View', defaultBinding: { key: 'Tab' }, scope: 'global' },
    { id: 'window.focusHost', label: 'Return to OpenJammer', category: 'View', defaultBinding: { key: 'F6' }, scope: 'global' },
    { id: 'commandBar.toggle', label: 'Open Command Bar', category: 'View', defaultBinding: { key: 'k', ctrl: true }, scope: 'global' },
    { id: 'panel.devLog', label: 'Toggle Developer Log', category: 'View', defaultBinding: { key: 'l', ctrl: true, shift: true }, scope: 'global' },
    { id: 'panel.audioHealth', label: 'Toggle Audio Health', category: 'View', defaultBinding: { key: 'h', ctrl: true, shift: true }, scope: 'global' },
    { id: 'panel.plugins', label: 'Toggle Plugins', category: 'View', defaultBinding: { key: 'p', ctrl: true, shift: true }, scope: 'global' },
    { id: 'canvas.escape', label: 'Escape Canvas Action', category: 'Canvas', defaultBinding: { key: 'Escape' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.exitLevel', label: 'Exit Node Level', category: 'Canvas', defaultBinding: { key: 'q' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.enterNode', label: 'Open Selected Node', category: 'Canvas', defaultBinding: { key: 'e' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.transport', label: 'Toggle Canvas Transport', category: 'Canvas', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.copy', label: 'Copy Nodes', category: 'Canvas', defaultBinding: { key: 'c', ctrl: true }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.paste', label: 'Paste Nodes', category: 'Canvas', defaultBinding: { key: 'v', ctrl: true }, scope: 'surface', surface: 'canvas' },
    { id: 'canvas.deleteBackspace', label: 'Delete Selected (Backspace)', category: 'Canvas', defaultBinding: { key: 'Backspace' }, scope: 'surface', surface: 'canvas' },
    { id: 'arrangement.transport', label: 'Toggle Arrangement Transport', category: 'Arrangement', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.undo', label: 'Undo Arrangement Edit', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.redo', label: 'Redo Arrangement Edit', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true, shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectionUndo', label: 'Undo Selection', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true, alt: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.selectionRedo', label: 'Redo Selection', category: 'Arrangement', defaultBinding: { key: 'z', ctrl: true, alt: true, shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.cut', label: 'Cut Selection', category: 'Arrangement', defaultBinding: { key: 'x', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.copy', label: 'Copy Selection', category: 'Arrangement', defaultBinding: { key: 'c', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.paste', label: 'Paste', category: 'Arrangement', defaultBinding: { key: 'v', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.delete', label: 'Delete Arrangement Selection', category: 'Arrangement', defaultBinding: { key: 'Delete' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.deleteBackspace', label: 'Delete Arrangement Selection (Backspace)', category: 'Arrangement', defaultBinding: { key: 'Backspace' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.zoomToSelection', label: 'Zoom to Arrangement Selection', category: 'Arrangement', defaultBinding: { key: 'z', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.duplicate', label: 'Duplicate Clips', category: 'Arrangement', defaultBinding: { key: 'd', ctrl: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeLeft', label: 'Nudge Clips Left', category: 'Arrangement', defaultBinding: { key: 'ArrowLeft' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeRight', label: 'Nudge Clips Right', category: 'Arrangement', defaultBinding: { key: 'ArrowRight' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeLeftFine', label: 'Fine Nudge Clips Left', category: 'Arrangement', defaultBinding: { key: 'ArrowLeft', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.nudgeRightFine', label: 'Fine Nudge Clips Right', category: 'Arrangement', defaultBinding: { key: 'ArrowRight', shift: true }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.split', label: 'Split Clips at Edit Point', category: 'Arrangement', defaultBinding: { key: 's' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.toggleRipple', label: 'Toggle Ripple Mode', category: 'Arrangement', defaultBinding: { key: 'r' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.escape', label: 'Clear Arrangement Selection', category: 'Arrangement', defaultBinding: { key: 'Escape' }, scope: 'surface', surface: 'arrangement' },
    { id: 'arrangement.openPianoRoll', label: 'Open Selected MIDI Clip in Piano Roll', category: 'Arrangement', defaultBinding: { key: 'Enter' }, scope: 'surface', surface: 'arrangement' },
    ...Array.from({ length: 9 }, (_, index): KeybindingAction => ({
        id: `mode.${index + 1}`,
        label: `Switch to Mode ${index + 1}`,
        category: 'Modes',
        defaultBinding: { key: String(index + 1) },
        scope: 'global',
    })),
    ...['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','z','x','c','v','b','n','m',',','.','/'].map((key): KeybindingAction => ({
        id: `note.${key}`,
        label: `Play Note (${key.toUpperCase()})`,
        category: 'Note Input',
        defaultBinding: { key },
        scope: 'surface',
        surface: 'canvas',
    })),
    { id: 'note.controlSpace', label: 'Keyboard Control Signal', category: 'Note Input', defaultBinding: { key: ' ' }, scope: 'surface', surface: 'canvas' },
];

// ============================================================================
// Helpers
// ============================================================================

export function keyComboToString(combo: KeyCombo): string {
    const parts: string[] = [];

    if (combo.ctrl) parts.push('Ctrl');
    if (combo.meta) parts.push('Cmd');
    if (combo.alt) parts.push('Alt');
    if (combo.shift) parts.push('Shift');

    // Format the key nicely
    let keyDisplay = combo.key;
    if (combo.key === ' ') keyDisplay = 'Space';
    else if (combo.key === 'Delete') keyDisplay = 'Del';
    else if (combo.key === 'Backspace') keyDisplay = 'Backspace';
    else if (combo.key.length === 1) keyDisplay = combo.key.toUpperCase();

    parts.push(keyDisplay);

    return parts.join('+');
}

export function matchesKeyCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
    // Check modifiers (convert to boolean to handle undefined)
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    const wantsCtrlOrMeta = Boolean(combo.ctrl || combo.meta);

    if (wantsCtrlOrMeta !== ctrlOrMeta) return false;
    if (Boolean(combo.shift) !== e.shiftKey) return false;
    if (Boolean(combo.alt) !== e.altKey) return false;

    // Check main key (case-insensitive for letters)
    const eventKey = e.key.toLowerCase();
    const comboKey = combo.key.toLowerCase();

    return eventKey === comboKey;
}

/**
 * Compare two key combos for equality
 */
export function keyComboEquals(a: KeyCombo, b: KeyCombo): boolean {
    return (
        a.key.toLowerCase() === b.key.toLowerCase() &&
        Boolean(a.ctrl || a.meta) === Boolean(b.ctrl || b.meta) &&
        Boolean(a.shift) === Boolean(b.shift) &&
        Boolean(a.alt) === Boolean(b.alt)
    );
}

// ============================================================================
// Store Interface
// ============================================================================

interface KeybindingsStore {
    // Custom bindings override defaults (action id -> KeyCombo)
    customBindings: Record<string, KeyCombo>;

    // Get the current binding for an action (custom or default)
    getBinding: (actionId: string) => KeyCombo | undefined;

    // Set a custom binding
    setBinding: (actionId: string, combo: KeyCombo) => void;

    // Remove custom binding (revert to default)
    resetBinding: (actionId: string) => void;

    // Reset all to defaults
    resetAllBindings: () => void;

    // Check if a key event matches an action
    matchesAction: (e: KeyboardEvent, actionId: string) => boolean;

    // Get all actions that match a key event
    getMatchingActions: (e: KeyboardEvent) => string[];

    // Get actions that would conflict with a proposed binding
    getConflictingActions: (actionId: string, combo: KeyCombo) => KeybindingAction[];

    // Clear bindings that conflict with the given combo (except for the specified action)
    clearConflictingBindings: (actionId: string, combo: KeyCombo) => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

// Custom storage with validation
const validatedStorage = {
    getItem: (name: string) => {
        try {
            const item = localStorage.getItem(name);
            if (!item) return null;

            const parsed = JSON.parse(item);
            if (!parsed || typeof parsed !== 'object') return null;

            // Validate customBindings structure
            if (parsed.state?.customBindings) {
                const bindings = parsed.state.customBindings;
                if (typeof bindings !== 'object' || Array.isArray(bindings)) {
                    parsed.state.customBindings = {};
                } else {
                    // Validate each binding has required 'key' property
                    // Collect invalid keys first, then delete in separate pass to avoid mutation during iteration
                    const invalidKeys: string[] = [];
                    for (const [actionId, combo] of Object.entries(bindings)) {
                        if (!combo || typeof combo !== 'object' || typeof (combo as KeyCombo).key !== 'string') {
                            invalidKeys.push(actionId);
                        }
                        // Note: UNBOUND_KEY sentinel is valid and passes validation
                    }
                    for (const key of invalidKeys) {
                        delete bindings[key];
                    }
                }
            }

            return parsed;
        } catch {
            // On any error, return null to use default state
            return null;
        }
    },
    setItem: (name: string, value: { state: KeybindingsStore }): void => {
        try {
            localStorage.setItem(name, JSON.stringify(value));
        } catch {
            // Ignore storage errors (quota exceeded, etc.)
        }
    },
    removeItem: (name: string): void => {
        try {
            localStorage.removeItem(name);
        } catch {
            // Ignore errors
        }
    },
};

export const useKeybindingsStore = create<KeybindingsStore>()(
    persist(
        (set, get) => ({
            customBindings: {},

            getBinding: (actionId: string) => {
                const { customBindings } = get();

                // Check for custom binding first
                if (customBindings[actionId]) {
                    const binding = customBindings[actionId];

                    // Return undefined for explicitly unbound keys
                    if (binding.key === UNBOUND_KEY) {
                        return undefined;
                    }

                    // Runtime validation: ensure binding has valid key
                    if (typeof binding.key !== 'string' || binding.key === '') {
                        console.error(`Invalid keybinding for action "${actionId}": missing or empty key`);
                        return undefined;
                    }

                    return binding;
                }

                // Fall back to default
                const action = keybindingActions.find(a => a.id === actionId);
                return action?.defaultBinding;
            },

            setBinding: (actionId: string, combo: KeyCombo) => {
                set((state) => ({
                    customBindings: {
                        ...state.customBindings,
                        [actionId]: combo,
                    },
                }));
            },

            resetBinding: (actionId: string) => {
                set((state) => {
                    const { [actionId]: _, ...rest } = state.customBindings;
                    return { customBindings: rest };
                });
            },

            resetAllBindings: () => {
                set({ customBindings: {} });
            },

            matchesAction: (e: KeyboardEvent, actionId: string) => {
                const binding = get().getBinding(actionId);
                if (!binding) return false;
                return matchesKeyCombo(e, binding);
            },

            getMatchingActions: (e: KeyboardEvent) => {
                const matching: string[] = [];

                for (const action of keybindingActions) {
                    const binding = get().getBinding(action.id);
                    if (binding && matchesKeyCombo(e, binding)) {
                        matching.push(action.id);
                    }
                }

                return matching;
            },

            getConflictingActions: (actionId: string, combo: KeyCombo) => {
                const conflicting: KeybindingAction[] = [];
                const target = keybindingActions.find((action) => action.id === actionId);
                const targetScope = target?.scope ?? 'global';

                for (const action of keybindingActions) {
                    // Skip the action we're setting
                    if (action.id === actionId) continue;

                    const actionScope = action.scope ?? 'global';
                    const sameSurface = target?.surface === action.surface;
                    const scopesOverlap = targetScope === 'global' || actionScope === 'global' ||
                        (targetScope === actionScope && (targetScope !== 'surface' || sameSurface));
                    if (!scopesOverlap) continue;

                    const binding = get().getBinding(action.id);
                    if (binding && keyComboEquals(binding, combo)) {
                        conflicting.push(action);
                    }
                }

                return conflicting;
            },

            clearConflictingBindings: (actionId: string, combo: KeyCombo) => {
                const conflicts = get().getConflictingActions(actionId, combo);
                if (conflicts.length === 0) return;

                set((state) => {
                    const newBindings = { ...state.customBindings };

                    for (const conflict of conflicts) {
                        // Mark conflicting bindings as explicitly unbound
                        // using a sentinel value that getBinding() recognizes
                        newBindings[conflict.id] = { key: UNBOUND_KEY };
                    }

                    return { customBindings: newBindings };
                });
            },
        }),
        {
            name: 'openjammer-keybindings',
            storage: validatedStorage,
        }
    )
);
