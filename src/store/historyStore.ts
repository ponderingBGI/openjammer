import { create } from 'zustand';
import type { Verb } from '../song/verbs';
import type { Arrangement } from '../song/types';
import type { GraphVerb } from './graphVerbs';
import { useEditingContextStore } from './editingContextStore';
import { useClipboardStore } from './clipboardStore';
import type { SurfaceId } from './uiViewStore';

export type HistoryScope = 'graph' | 'arrangement' | 'pianoroll' | 'mixed';

/**
 * The transport state a document swap resets, and therefore the state a swap
 * has to carry if it is to be reversible.
 *
 * `setArrangement` hard-resets the loop arm (`arrangementStore`'s `loopOn` /
 * `loopEnabled`) because a new song's loop location has nothing to do with the
 * old one's. That is right for opening a document and wrong for replaying one:
 * without this, a redone beat rig played its bar once instead of looping, and
 * an undo left the player's own loop switch off. `loopEnabled` is the player's
 * arm; `loopOn` is the engine's echo of a loop actually running.
 */
export type TransportSnapshot = { loopEnabled: boolean; loopOn: boolean };

/**
 * Replace the WHOLE authoring document in one step.
 *
 * `Verb` edits an Arrangement that already exists; this one crosses the
 * null→song and song→null boundary a `Verb` cannot express, so it carries a
 * SNAPSHOT rather than a delta. It exists for exactly one thing: an atomic
 * graph+arrangement operation — installing a preset rig — where the Song and
 * the patch have to be one entry, one `Ctrl+Z` (see
 * `arrangementStore.setArrangement`'s `preserveHistory` option). Ordinary
 * timeline editing must keep using `Verb`s: they are what the agent emits, what
 * collaboration ships, and what stays small.
 *
 * The snapshot is the document AND the loop arm that goes with it, so redo
 * reproduces the do (an armed rig comes back armed) and undo puts the switch
 * back where the player had it.
 */
export type DocumentVerb = { kind: 'setArrangement'; arrangement: Arrangement | null; transport: TransportSnapshot };

export type EditVerb =
    | { domain: 'graph'; verb: GraphVerb }
    | { domain: 'arrangement'; verb: Verb }
    | { domain: 'document'; verb: DocumentVerb };

export interface HistoryEntry {
    verbs: EditVerb[];
    inverse: EditVerb[];
    label: string;
    scope: HistoryScope;
}

type Driver = (verbs: readonly EditVerb[]) => void;
const drivers = new Set<Driver>();
let applyingHistory = false;

export function registerHistoryDriver(driver: Driver): () => void {
    drivers.add(driver);
    return () => drivers.delete(driver);
}

function dispatch(verbs: readonly EditVerb[]): void {
    applyingHistory = true;
    try {
        for (const driver of drivers) driver(verbs);
    } finally {
        applyingHistory = false;
    }
}

export function isApplyingHistory(): boolean {
    return applyingHistory;
}

interface OpenTransaction extends HistoryEntry { depth: number }

interface HistoryState {
    entries: HistoryEntry[];
    cursor: number;
    cleanCursor: number;
    open: OpenTransaction | null;
    begin: (label: string, scope?: HistoryScope) => void;
    record: (verbs: EditVerb[], inverse: EditVerb[], label?: string, scope?: HistoryScope) => void;
    commit: () => void;
    abort: () => void;
    undo: () => void;
    redo: () => void;
    clear: () => void;
    markClean: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    isDirty: () => boolean;
}

const mergeScope = (a: HistoryScope, b: HistoryScope): HistoryScope => a === b ? a : 'mixed';
const selectionSurface = (scope: HistoryScope): SurfaceId => scope === 'graph' ? 'canvas' : scope === 'pianoroll' ? 'pianoroll' : 'arrangement';

export const useHistoryStore = create<HistoryState>((set, get) => ({
    entries: [],
    cursor: 0,
    cleanCursor: 0,
    open: null,
    begin: (label, scope = 'mixed') => set((state) => state.open
        ? { open: { ...state.open, depth: state.open.depth + 1, scope: mergeScope(state.open.scope, scope) } }
        : { open: { verbs: [], inverse: [], label, scope, depth: 1 } }),
    record: (verbs, inverse, label = 'Edit', scope = 'mixed') => {
        if (!verbs.length) return;
        const open = get().open;
        if (open) {
            set({ open: { ...open, verbs: [...open.verbs, ...verbs], inverse: [...inverse, ...open.inverse], scope: mergeScope(open.scope, scope) } });
            return;
        }
        const state = get();
        const entry: HistoryEntry = { verbs, inverse, label, scope };
        set({ entries: [...state.entries.slice(0, state.cursor), entry], cursor: state.cursor + 1 });
        useEditingContextStore.getState().beginSelectionOpHistory(selectionSurface(scope));
    },
    commit: () => {
        const open = get().open;
        if (!open) return;
        if (open.depth > 1) {
            set({ open: { ...open, depth: open.depth - 1 } });
            return;
        }
        set({ open: null });
        if (!open.verbs.length) return;
        const state = get();
        const entry: HistoryEntry = { verbs: open.verbs, inverse: open.inverse, label: open.label, scope: open.scope };
        set({ entries: [...state.entries.slice(0, state.cursor), entry], cursor: state.cursor + 1 });
        useEditingContextStore.getState().beginSelectionOpHistory(selectionSurface(open.scope));
    },
    abort: () => {
        const open = get().open;
        if (!open) return;
        set({ open: null });
        if (open.inverse.length) dispatch(open.inverse);
    },
    undo: () => {
        const state = get();
        if (state.open || state.cursor === 0) return;
        const entry = state.entries[state.cursor - 1]!;
        dispatch(entry.inverse);
        set({ cursor: state.cursor - 1 });
        useEditingContextStore.getState().beginSelectionOpHistory(selectionSurface(entry.scope));
        useClipboardStore.getState().resetPasteContext();
    },
    redo: () => {
        const state = get();
        if (state.open || state.cursor >= state.entries.length) return;
        dispatch(state.entries[state.cursor]!.verbs);
        set({ cursor: state.cursor + 1 });
        useEditingContextStore.getState().beginSelectionOpHistory(selectionSurface(state.entries[state.cursor]!.scope));
        useClipboardStore.getState().resetPasteContext();
    },
    clear: () => set({ entries: [], cursor: 0, cleanCursor: 0, open: null }),
    markClean: () => set({ cleanCursor: get().cursor }),
    canUndo: () => get().cursor > 0,
    canRedo: () => get().cursor < get().entries.length,
    isDirty: () => get().cursor !== get().cleanCursor,
}));
