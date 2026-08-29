/**
 * Settings -> Keybindings — every shortcut OpenJammer registers, in one list.
 *
 * The catalogue in `keybindingsStore` is the source of truth: the timeline
 * rebuild registers ~100 arrangement and piano-roll actions, and all of them
 * appear here, grouped, searchable, filterable by surface, rebindable and
 * conflict-checked. Nothing about a shortcut is invisible.
 *
 * Two rules this surface holds to:
 *   • No native dialog. `confirm()` steals focus from a live instrument and
 *     cannot be styled or dismissed with Escape the way the rest of the app is,
 *     so "reset everything" is an in-panel danger Callout with real Buttons, and
 *     a conflict is a danger Callout INSIDE the row it belongs to.
 *   • The keycap is the control. Clicking it starts capture; the same box then
 *     shows what you are holding, and Escape cancels.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    useKeybindingsStore,
    keybindingActions,
    keyComboToString,
    type KeyCombo,
    type KeybindingAction,
} from '../../store/keybindingsStore';
import { KeybindingsErrorBoundary } from './KeybindingsErrorBoundary';
import { Button, Callout, Chip, IconButton, Input, Kbd, List, ListRow, SegmentedControl } from '@openjammer/oj-ui';
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

type SurfaceFilter = 'all' | 'global' | 'canvas' | 'arrangement' | 'pianoroll';

const SURFACE_FILTERS: { value: SurfaceFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'global', label: 'Global' },
    { value: 'canvas', label: 'Canvas' },
    { value: 'arrangement', label: 'Arrangement' },
    { value: 'pianoroll', label: 'Piano roll' },
];

/** Where an action lives, as the one word shown on its group chip. */
function surfaceOf(action: KeybindingAction): SurfaceFilter {
    if (action.scope === 'global') return 'global';
    return (action.surface ?? 'canvas') as SurfaceFilter;
}

const SURFACE_LABEL: Record<SurfaceFilter, string> = {
    all: 'All',
    global: 'Everywhere',
    canvas: 'Canvas',
    arrangement: 'Arrangement',
    pianoroll: 'Piano roll',
};

/** A revert glyph — a counter-clockwise arrow, drawn rather than typed. */
function RevertGlyph() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 6.5h4v-4" />
            <path d="M3.2 6.4A5.2 5.2 0 1 1 3 9.6" />
        </svg>
    );
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
    const [query, setQuery] = useState('');
    const [surface, setSurface] = useState<SurfaceFilter>('all');
    const [confirmingResetAll, setConfirmingResetAll] = useState(false);

    const customCount = Object.keys(customBindings).length;

    // Category groups, in catalogue order, after the search + surface filters.
    const groups = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const ordered: { category: string; surfaces: SurfaceFilter[]; actions: KeybindingAction[] }[] = [];
        const index = new Map<string, number>();

        for (const action of keybindingActions) {
            if (surface !== 'all' && surfaceOf(action) !== surface) continue;
            if (needle) {
                const binding = getBinding(action.id);
                const haystack = `${action.label} ${action.category} ${binding ? keyComboToString(binding) : ''}`.toLowerCase();
                if (!haystack.includes(needle)) continue;
            }
            let at = index.get(action.category);
            if (at === undefined) {
                at = ordered.length;
                index.set(action.category, at);
                ordered.push({ category: action.category, surfaces: [], actions: [] });
            }
            const group = ordered[at]!;
            group.actions.push(action);
            const where = surfaceOf(action);
            if (!group.surfaces.includes(where)) group.surfaces.push(where);
        }
        return ordered;
    }, [getBinding, query, surface]);

    const visibleCount = groups.reduce((total, group) => total + group.actions.length, 0);

    // Handle key capture when editing
    useEffect(() => {
        if (!editing) return;
        // Keep the just-captured combo synchronous with the native key events.
        // React may batch the state render until after keyup on a quick tap.
        let pendingCombo = editing.pressedKeys;
        const actionId = editing.actionId;

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

            pendingCombo = combo;
            setEditing((prev) => prev ? { ...prev, pressedKeys: combo } : null);
        }

        function handleKeyUp() {
            // When user releases keys with a valid combo, check for conflicts
            if (pendingCombo) {
                const conflicts = getConflictingActions(actionId, pendingCombo);

                if (conflicts.length > 0) {
                    // Ask in place — the row keeps its position, so the answer
                    // never arrives detached from the question.
                    setConflict({
                        actionId,
                        combo: pendingCombo,
                        conflicts,
                    });
                    setEditing(null);
                } else {
                    // No conflicts, save directly
                    setBinding(actionId, pendingCombo);
                    setEditing(null);
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('keyup', handleKeyUp, true);
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
        setConflict(null);
        setEditing({ actionId, pressedKeys: null });
    }, []);

    const handleReset = useCallback((actionId: string) => {
        resetBinding(actionId);
    }, [resetBinding]);

    return (
        <div className="keybindings-panel">
            <div className="keybindings-toolbar">
                <Input
                    type="search"
                    className="keybindings-search"
                    aria-label="Search shortcuts"
                    placeholder="Search actions or keys…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <SegmentedControl
                    aria-label="Shortcut surface"
                    className="keybindings-surface"
                    value={surface}
                    options={SURFACE_FILTERS}
                    onChange={setSurface}
                />
            </div>

            <div className="keybindings-meta">
                <p className="keybindings-description">
                    Click a shortcut to change it, then press the keys. Escape cancels.
                </p>
                <div className="keybindings-meta__right">
                    <Chip title="Shortcuts shown by the current filter">{visibleCount} shown</Chip>
                    {customCount > 0 && (
                        <Chip tone="warning" title="Shortcuts you have changed from their defaults">
                            {customCount} customised
                        </Chip>
                    )}
                    <Button
                        variant="danger"
                        className="keybindings-reset-all"
                        onClick={() => setConfirmingResetAll(true)}
                        disabled={customCount === 0}
                    >
                        Reset All to Defaults
                    </Button>
                </div>
            </div>

            {/* In-UI confirm. A native confirm() would steal focus from a live
                instrument and cannot be dismissed the way the rest of the app is. */}
            {confirmingResetAll && (
                <Callout
                    variant="danger"
                    title="Reset every shortcut?"
                    className="keybindings-confirm"
                    role="alertdialog"
                    aria-label="Reset every shortcut"
                >
                    <p className="keybindings-confirm__body">
                        {customCount} customised shortcut{customCount === 1 ? '' : 's'} will go back to
                        the factory keys. Nothing else changes.
                    </p>
                    <div className="keybindings-confirm__actions">
                        <Button variant="secondary" onClick={() => setConfirmingResetAll(false)}>
                            Keep mine
                        </Button>
                        <Button
                            variant="danger"
                            data-autofocus="true"
                            onClick={() => {
                                resetAllBindings();
                                setConfirmingResetAll(false);
                            }}
                        >
                            Reset all
                        </Button>
                    </div>
                </Callout>
            )}

            {groups.length === 0 && (
                <Callout variant="info" title="No shortcut matches that">
                    Try fewer letters, or switch the surface filter back to All.
                </Callout>
            )}

            {groups.map((group) => (
                <section key={group.category} className="keybindings-category">
                    <header className="keybindings-category-head">
                        <h4 className="keybindings-category-title">{group.category}</h4>
                        {group.surfaces.map((where) => (
                            <Chip key={where} className="keybindings-surface-chip">
                                {SURFACE_LABEL[where]}
                            </Chip>
                        ))}
                    </header>

                    <List role="group" aria-label={group.category} className="keybindings-list">
                        {group.actions.map((action) => {
                            const currentBinding = getBinding(action.id);
                            const isEditing = editing?.actionId === action.id;
                            const isCustomized = customBindings[action.id] !== undefined;
                            const showConflict = conflict?.actionId === action.id;

                            return (
                                <div key={action.id} className="keybindings-entry">
                                    <ListRow
                                        className={`keybindings-row${isEditing ? ' is-capturing' : ''}`}
                                        actions={
                                            <>
                                                {isEditing ? (
                                                    <span
                                                        className="keybindings-capture"
                                                        role="status"
                                                        aria-live="polite"
                                                    >
                                                        {editing.pressedKeys
                                                            ? keyComboToString(editing.pressedKeys)
                                                            : 'Press keys...'}
                                                    </span>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        className="keybindings-shortcut"
                                                        onClick={() => startEditing(action.id)}
                                                        aria-label={`Change the shortcut for ${action.label}`}
                                                    >
                                                        {currentBinding ? (
                                                            <Kbd custom={isCustomized}>
                                                                {keyComboToString(currentBinding)}
                                                            </Kbd>
                                                        ) : (
                                                            <span className="keybindings-unbound">None</span>
                                                        )}
                                                    </Button>
                                                )}

                                                <span className="keybindings-revert-slot">
                                                    {isCustomized && !isEditing && (
                                                        <IconButton
                                                            label={`Reset ${action.label} to its default`}
                                                            title="Reset to default"
                                                            className="keybindings-reset"
                                                            icon={<RevertGlyph />}
                                                            onClick={() => handleReset(action.id)}
                                                        />
                                                    )}
                                                </span>
                                            </>
                                        }
                                    >
                                        <span className="keybindings-label">{action.label}</span>
                                    </ListRow>

                                    {showConflict && (
                                        <Callout
                                            variant="danger"
                                            title="Shortcut Conflict"
                                            className="keybindings-conflict"
                                            role="alertdialog"
                                            aria-label="Shortcut conflict"
                                        >
                                            <p className="keybindings-conflict-message">
                                                <Kbd>{keyComboToString(conflict.combo)}</Kbd> is already
                                                assigned to:
                                            </p>
                                            <ul className="keybindings-conflict-list">
                                                {conflict.conflicts.map((other) => (
                                                    <li key={other.id}>{other.label}</li>
                                                ))}
                                            </ul>
                                            <p className="keybindings-conflict-question">
                                                Unbind {conflict.conflicts.length > 1 ? 'them' : 'it'} and give
                                                the keys to <strong>{action.label}</strong>?
                                            </p>
                                            <div className="keybindings-conflict-buttons">
                                                <Button variant="secondary" onClick={handleCancelConflict}>
                                                    Cancel
                                                </Button>
                                                <Button variant="primary" onClick={handleConfirmConflict}>
                                                    Replace
                                                </Button>
                                            </div>
                                        </Callout>
                                    )}
                                </div>
                            );
                        })}
                    </List>
                </section>
            ))}
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
