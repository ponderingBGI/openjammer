/**
 * Sandbox mode store — the LIVE jailed↔YOLO state for the Pi agent (Phase 6).
 *
 * The platform *ceiling* (can this host OS-confine the agent at all?) lives on the
 * static {@link EngineCapabilities} `sandbox` axis. This store holds the *runtime
 * mode*, which the capability descriptor deliberately cannot: it changes within a
 * session when the user flips YOLO.
 *
 * DEFAULT is `'jailed'`: the host OS-jails the Pi subprocess to the project folder
 * (+ its own memory) and the in-Pi bash allowlist is loaded. `'yolo'` drops every
 * filesystem/shell/env guard — the full Pi experience — and is only reachable on a
 * platform that can host-jail in the first place ({@link canHostJail}).
 *
 * SAFETY CONTRACT (the reasons this is a plain in-memory store, NOT persisted):
 * - **Session-only.** YOLO never survives a restart. A fresh launch is always
 *   `'jailed'`. There is intentionally no `persist` middleware here.
 * - **Explicit entry.** {@link requestYolo} does NOT flip the mode; it returns
 *   whether a confirm is warranted. Only {@link confirmYolo} actually enters YOLO,
 *   so the UI must route through an explicit confirmation.
 * - **The graph gate is untouched.** YOLO removes FS/shell/env guards only; the
 *   AI graph-edit Approve/Reject transaction stays on in both modes.
 */

import { create } from 'zustand';
import { getExecutor } from '../audio/executor';
import { canHostJail } from '../engine/capabilities';

export type SandboxMode = 'jailed' | 'yolo';

interface SandboxStore {
    /** The live mode. Always starts `'jailed'`; never persisted. */
    mode: SandboxMode;
    /**
     * The write-jail boundary shown in the permission footer (the open project
     * folder's display name, e.g. `"MyProject"`). Set when a project opens.
     */
    projectLabel: string;

    /**
     * Whether this platform can host-jail — and therefore whether YOLO is offered
     * at all. A browser (no subprocess) returns `false`: there is nothing to drop.
     */
    canYolo: () => boolean;

    /**
     * Ask to enter YOLO. Returns `true` when a confirm should be shown (we can
     * host-jail and we are currently jailed), `false` when YOLO is unavailable or
     * already active. It NEVER changes the mode — entry must be explicit.
     */
    requestYolo: () => boolean;

    /** Actually enter YOLO (call only after the user confirms). */
    confirmYolo: () => void;

    /** Return to the safe default. Always available. */
    exitYolo: () => void;

    /** Set the project-folder label for the footer. */
    setProjectLabel: (label: string) => void;
}

export const useSandboxStore = create<SandboxStore>((set, get) => ({
    mode: 'jailed',
    projectLabel: '',

    canYolo: () => canHostJail(getExecutor().getCapabilities().sandbox),

    requestYolo: () => {
        if (!get().canYolo()) return false;
        if (get().mode === 'yolo') return false;
        return true;
    },

    confirmYolo: () => {
        // Defence in depth: even a direct call can't enter YOLO where the platform
        // can't host-jail (a browser must never claim an unrestricted agent).
        if (!get().canYolo()) return;
        set({ mode: 'yolo' });
    },

    exitYolo: () => set({ mode: 'jailed' }),

    setProjectLabel: (label) => set({ projectLabel: label }),
}));
