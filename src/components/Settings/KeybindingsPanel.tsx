/**
 * KeybindingsPanel - UI for viewing and customizing keyboard shortcuts
 */

import { useState, useEffect, useCallback } from 'react';
import {
    useKeybindingsStore,
    keybindingActions,
    keyComboToString,
    type KeyCombo,
    type KeybindingAction,
} from '../../store/keybindingsStore';
import { KeybindingsErrorBoundary } from './KeybindingsErrorBoundary';
import { Button } from '@openjammer/oj-ui';
import './KeybindingsPanel.css';

interface EditingState {
    actionId: string;
    pressedKeys: KeyCombo | null;
}

interface ConflictState {
    actionId: string;
    combo: KeyCombo;
    conflicts: KeybindingAction[];
}

export function KeybindingsPanel() {
    // Use individual selectors to prevent unnecessary re-renders
    const getBinding = useKeybindingsStore((s) => s.getBinding);
    const setBinding = useKeybindingsStore((s) => s.setBinding);
    const resetBinding = useKeybindingsStore((s) => s.resetBinding);
    const resetAllBindings = useKeybindingsStore((s) => s.resetAllBindings);
    const customBindings = useKeybindingsStore((s) => s.customBindings);
    const getConflictingActions = useKeybindingsStore((s) => s.getConflictingActions);
    const clearConflictingBindings = useKeybindingsStore((s) => s.clearConflictingBindings);

    const [editing, setEditing] = useState<EditingState | null>(null);
    const [conflict, setConflict] = useState<ConflictState | null>(null);

    // Group actions by category
    const categorizedActions = keybindingActions.reduce((acc, action) => {
        if (!acc[action.category]) {
            acc[action.category] = [];
        }
        acc[action.category].push(action);
        return acc;
    }, {} as Record<string, typeof keybindingActions>);

    // Handle key capture when editing
    useEffect(() => {
        if (!editing) return;

        function handleKeyDown(e: KeyboardEvent) {
            e.preventDefault();
            e.stopPropagation();

            // Escape cancels editing
            if (e.key === 'Escape') {
                setEditing(null);
                return;
            }

            // Ignore modifier-only keys
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                return;
            }

            const combo: KeyCombo = {
                key: e.key,
                ctrl: e.ctrlKey,
                meta: e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
            };

            // Clean up the combo - remove false values
            if (!combo.ctrl) delete combo.ctrl;
            if (!combo.meta) delete combo.meta;
            if (!combo.shift) delete combo.shift;
            if (!combo.alt) delete combo.alt;

            setEditing((prev) => prev ? { ...prev, pressedKeys: combo } : null);
        }

        function handleKeyUp() {
            // When user releases keys with a valid combo, check for conflicts
            if (editing?.pressedKeys) {
                const conflicts = getConflictingActions(editing.actionId, editing.pressedKeys);

                if (conflicts.length > 0) {
                    // Show conflict dialog
                    setConflict({
                        actionId: editing.actionId,
                        combo: editing.pressedKeys,
                        conflicts,
                    });
                    setEditing(null);
                } else {
                    // No conflicts, save directly
                    setBinding(editing.actionId, editing.pressedKeys);
                    setEditing(null);
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keyup', handleKeyUp, true);

        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('keyup', handleKeyUp, true);
        };
    }, [editing, setBinding, getConflictingActions]);

    // Handle conflict resolution
    const handleConfirmConflict = useCallback(() => {
        if (!conflict) return;

        // Clear conflicting bindings and set the new one
        clearConflictingBindings(conflict.actionId, conflict.combo);
        setBinding(conflict.actionId, conflict.combo);
        setConflict(null);
    }, [conflict, clearConflictingBindings, setBinding]);

    const handleCancelConflict = useCallback(() => {
        setConflict(null);
    }, []);

    const startEditing = useCallback((actionId: string) => {
        setEditing({ actionId, pressedKeys: null });
    }, []);

    const handleReset = useCallback((actionId: string) => {
        resetBinding(actionId);
    }, [resetBinding]);

    const handleResetAll = useCallback(() => {
        if (confirm('Reset all keybindings to defaults?')) {
            resetAllBindings();
        }
    }, [resetAllBindings]);

    return (
        <div className="keybindings-panel">
            <div className="keybindings-header">
                <p className="keybindings-description">
                    Click on a shortcut to change it. Press Escape to cancel.
                </p>
                <Button
                    variant="danger"
                    className="keybindings-reset-all"
                    onClick={handleResetAll}
                    disabled={Object.keys(customBindings).length === 0}
                >
                    Reset All to Defaults
                </Button>
            </div>

            {Object.entries(categorizedActions).map(([category, actions]) => (
                <div key={category} className="keybindings-category">
                    <h4 className="keybindings-category-title">{category}</h4>

                    <div className="keybindings-list">
                        {actions.map((action) => {
                            const currentBinding = getBinding(action.id);
                            const isEditing = editing?.actionId === action.id;
                            const isCustomized = customBindings[action.id] !== undefined;

                            return (
                                <div
                                    key={action.id}
                                    className={`keybindings-row ${isEditing ? 'keybindings-row-editing' : ''}`}
                                >
                                    <span className="keybindings-label">{action.label}</span>

                                    <div className="keybindings-controls">
                                        {isEditing ? (
                                            <span className="keybindings-shortcut keybindings-shortcut-editing">
                                                {editing.pressedKeys
                                                    ? keyComboToString(editing.pressedKeys)
                                                    : 'Press keys...'}
                                            </span>
                                        ) : (
                                            <Button
                                                variant="ghost"
                                                className={`keybindings-shortcut ${isCustomized ? 'keybindings-shortcut-custom' : ''}`}
                                                onClick={() => startEditing(action.id)}
                                            >
                                                {currentBinding ? keyComboToString(currentBinding) : 'None'}
                                            </Button>
                                        )}

                                        {isCustomized && !isEditing && (
                                            <Button
                                                variant="ghost"
                                                iconOnly
                                                className="keybindings-reset"
                                                onClick={() => handleReset(action.id)}
                                                title="Reset to default"
                                            >
                                                ↺
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Conflict Resolution Dialog */}
            {conflict && (
                <div className="keybindings-conflict-overlay">
                    <div className="keybindings-conflict-dialog">
                        <h4 className="keybindings-conflict-title">Shortcut Conflict</h4>
                        <p className="keybindings-conflict-message">
                            <strong>{keyComboToString(conflict.combo)}</strong> is already assigned to:
                        </p>
                        <ul className="keybindings-conflict-list">
                            {conflict.conflicts.map((action) => (
                                <li key={action.id}>{action.label}</li>
                            ))}
                        </ul>
                        <p className="keybindings-conflict-question">
                            Remove the existing binding{conflict.conflicts.length > 1 ? 's' : ''} and assign to this action?
                        </p>
                        <div className="keybindings-conflict-buttons">
                            <Button
                                variant="secondary"
                                onClick={handleCancelConflict}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleConfirmConflict}
                            >
                                Replace
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * KeybindingsPanel wrapped with error boundary for safe rendering.
 * Use this version when rendering in production to catch any errors
 * during keybinding capture.
 */
export function KeybindingsPanelSafe() {
    return (
        <KeybindingsErrorBoundary>
            <KeybindingsPanel />
        </KeybindingsErrorBoundary>
    );
}
