/**
 * Command-bar UI store — the small, PERSISTED slice that lets Ctrl/Cmd+K reopen
 * exactly where you left it.
 *
 * The bar's `open` state is deliberately NOT persisted (no auto-open on launch),
 * but the MODE is: close the bar in AI mode, press Ctrl+K again, and you're back
 * in the chat (with the conversation restored by `agentSessionStore`). Likewise
 * search → search. One tiny store so the persistence rule lives in one place.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Which half of the bar is showing: the command palette or the AI chat. */
export type CommandBarMode = 'search' | 'ai';

interface CommandBarStore {
    /** The mode the bar should reopen into. */
    mode: CommandBarMode;
    /** Remember the mode so the next Ctrl+K returns here. */
    setMode: (mode: CommandBarMode) => void;
}

export const useCommandBarStore = create<CommandBarStore>()(
    persist(
        (set) => ({
            mode: 'search',
            setMode: (mode) => set({ mode }),
        }),
        { name: 'openjammer-command-bar', version: 1 },
    ),
);
