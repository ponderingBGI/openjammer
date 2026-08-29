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
    entries: BindingEntry[];
}
