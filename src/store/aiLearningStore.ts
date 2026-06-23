/**
 * AI learning (memory) state — the truthful source for the "memory: on" footer.
 *
 * Whether Philia remembers a player across sessions is the presence of the
 * `pi-persistent-intelligence` package in the agent's `settings.json` (toggled by
 * the `ai_set_learning` / `ai_forget` Ctrl+K commands). The host owns that file, so
 * the indicator must READ it (`ai_get_learning`) rather than guess — but a toggle
 * should also reflect AT ONCE, so the commands set the value optimistically and the
 * footer reads from here. Desktop-only: in the browser `getInvoke()` is null and the
 * value stays `null` (the footer simply shows nothing).
 */

import { create } from 'zustand';
import { getInvoke } from '../ai/tauri';

interface AiLearningState {
    /** Whether persistent learning is on; `null` until the first read (or in browser). */
    enabled: boolean | null;
    /** Optimistically reflect a toggle so the footer updates without a round-trip. */
    setEnabled: (on: boolean) => void;
    /** Read the truth from the host (`ai_get_learning`); no-op without Tauri. */
    refresh: () => Promise<void>;
}

export const useAiLearningStore = create<AiLearningState>((set) => ({
    enabled: null,
    setEnabled: (on) => set({ enabled: on }),
    refresh: async () => {
        const invoke = getInvoke();
        if (!invoke) return;
        try {
            const on = (await invoke('ai_get_learning', {})) as boolean;
            set({ enabled: Boolean(on) });
        } catch {
            // Best-effort: a transient failure leaves the prior value untouched.
        }
    },
}));
