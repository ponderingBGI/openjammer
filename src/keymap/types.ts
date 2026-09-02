import type { SurfaceId } from '../store/uiViewStore';
import type { KeyCombo } from '../store/keybindingsStore';

export type KeymapScope = 'text' | 'modal' | 'surface' | 'global';

export interface BindingEntry {
    actionId: string;
    /** Binding-set-local default for timeline actions not owned by the global catalogue. */
    defaultBinding?: KeyCombo;
    /**
     * Opt in to inside-out fall-through. A focused child surface (an inline piano
     * roll inside the arrangement) reaches its enclosing surface set, but only the
     * entries flagged here are eligible there. Everything else is surface-local, so
     * an editor can never cut, mute or re-tool the document it is editing. Flag
     * only what is genuinely ambient: document history, transport, marker drop, and
     * the Escape/exit cascade.
     */
    inherit?: boolean;
    guard?: (event: KeyboardEvent) => boolean;
    run: (event: KeyboardEvent) => boolean;
}

export interface BindingSet {
    id: string;
    scope: Exclude<KeymapScope, 'text'>;
    surface?: SurfaceId;
    /**
     * ORDER IS THE TIEBREAKER, and it is the only one. `runSets` returns on the
     * FIRST entry whose combo matches, so when two entries in a set can match the
     * same keystroke, the earlier one wins outright and the later one is dead.
     *
     * The canvas set depends on this critically: `NodeCanvas` orders `levelActions`
     * (`e`, `q`) BEFORE `noteActions` — which own 29 letter keys including `e` and
     * `q` — BEFORE `regularActions`. `e` reaches the level action and then falls
     * through to `note.e` only because the level handler declines by not calling
     * `preventDefault`.
     *
     * So: a new canvas action bound to any of those 29 letters and APPENDED at the
     * end, as every existing one was, is silently dead whenever `currentMode > 1`.
     * Put an entry where its precedence belongs, not where the diff is smallest.
     */
    entries: BindingEntry[];
}
