/**
 * The one door to "give this work a home on disk", and the reason it is a store
 * slice rather than an event.
 *
 * `openjammer:new-project` was dispatched from three places — Ctrl+S with no
 * project, the Ctrl+K palette's "New Project", Safe Mode — and **subscribed
 * from none** (UX-INV Q4): the app advertised Ctrl+S in Settings and answered
 * with nothing at all. An event with no listener fails silently forever; a
 * direct call into a slice the menu bar renders cannot.
 *
 * Two intents, because the two callers mean different things and conflating them
 * is how Ctrl+S would wipe the canvas:
 *   • `'new'` — File ▸ New Project…, the palette, Safe Mode. Make a folder and
 *     start clean in it.
 *   • `'save-current'` — Ctrl+S with nowhere to save. Make a folder and write
 *     THIS song into it. Nothing is cleared.
 */

import { create } from 'zustand';

export type NewProjectIntent = 'new' | 'save-current';

interface NewProjectDialogState {
    /** Non-null while the dialog is up; the intent it was opened with. */
    intent: NewProjectIntent | null;
    open: (intent: NewProjectIntent) => void;
    close: () => void;
}

export const useNewProjectDialog = create<NewProjectDialogState>((set) => ({
    intent: null,
    open: (intent) => set({ intent }),
    close: () => set({ intent: null }),
}));

/**
 * Where the keyboard was when the dialog was asked for.
 *
 * `useConfirmFocus` restores to the element that had focus when it MOUNTED, and
 * the menu bar's fallback is the File trigger — the right answer only when the
 * File menu opened it. Ctrl+S, the Ctrl+K palette and Safe Mode all reach this
 * dialog without ever touching the menu bar, and a keyboard-only player was
 * dropped on `<body>` mid-set. So the opener is captured at the CALL, which is
 * the only moment that knows.
 */
let invoker: HTMLElement | null = null;

/** The control that asked for the dialog, if it is still on the page. */
export function newProjectInvoker(): HTMLElement | null {
    return invoker && invoker.isConnected ? invoker : null;
}

/** Ask the menu bar to raise the New Project dialog. A CALL, never an event. */
export function requestNewProject(intent: NewProjectIntent = 'new'): void {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    invoker = active instanceof HTMLElement && active !== document.body ? active : null;
    useNewProjectDialog.getState().open(intent);
}
