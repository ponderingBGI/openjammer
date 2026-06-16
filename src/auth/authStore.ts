/**
 * authStore (D6, M7) — WHO PAYS for the AI agent, and only that.
 *
 * The Ctrl+K AI path needs a configured provider before the first Tab can drive
 * Pi. This store is the small, persisted state behind the {@link AuthChooser}
 * onboarding: which provider is active and which model, plus a derived
 * {@link AuthState.configured} flag the CommandBar gate reads.
 *
 * HARD INVARIANTS (project plan):
 *   - NEVER persist the provider KEY. We persist ONLY `activeProvider` + `modelId`
 *     (see the `partialize` below). The key lives in the OS keychain (founder-gated
 *     native side) and is forwarded transiently to Pi; it never touches this store
 *     or localStorage.
 *   - Auth resolves only WHO PAYS. It does NOT grant the agent any new power —
 *     tool calls still apply-with-undo behind Approve / Reject.
 *   - Browser / `caps.auth === 'none'`: every action is a safe no-op and
 *     `configured` stays false (the honest "AI requires the desktop app" path).
 *
 * The native commands (`auth_status` / `auth_begin_oauth` / `auth_store_key` /
 * `auth_validate_key` / `auth_clear`) are invoked when available. Their LIVE
 * bodies (OS keychain, loopback PKCE OAuth, HTTP key validation) are founder-gated
 * in `src-tauri/src/auth.rs`; the signatures are real so this store compiles +
 * tests against mocks today.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getInvoke } from '../ai/tauri';
import { getExecutor } from '../audio/executor';

// ============================================================================
// Types
// ============================================================================

/**
 * The native `auth_status` reply (mirrors `src-tauri/src/auth.rs::AuthState`).
 * `conflict` is the conflict-by-OUTCOME signal (D6-A1): true only when Pi's own
 * `~/.pi/agent/auth.json` would resolve a WORKING key for the active provider, so
 * the UI can warn that two key sources disagree.
 */
export interface NativeAuthStatus {
    configured: boolean;
    activeProvider?: string;
    modelId?: string;
    conflict: boolean;
}

/**
 * The result of a key-store / validate / oauth action. The founder-gated native
 * bodies return `{ ok:false, notConfigured:true }` until enabled; the frontend
 * surfaces `message` to the user.
 */
export interface AuthActionResult {
    ok: boolean;
    /** True when the native body is the founder-gated stub ("not configured in this build"). */
    notConfigured?: boolean;
    /** Human-readable detail for the chooser (error / success note). */
    message?: string;
}

interface AuthStoreState {
    /** The provider the user chose (e.g. 'opencode' | 'codex' | 'anthropic' | 'openai'). */
    activeProvider?: string;
    /** The model id pinned for runs, when the provider/chooser set one. */
    modelId?: string;
    /** Derived from `auth_status`: a working key is available for `activeProvider`. */
    configured: boolean;
    /** True when Pi's auth.json would resolve a conflicting working key (D6-A1). */
    conflict: boolean;

    /** Re-read native `auth_status` and derive `configured` + `conflict`. */
    refreshStatus: () => Promise<void>;
    /** Begin a provider OAuth flow (Codex loopback PKCE; founder-gated body). */
    beginOAuth: (provider: string) => Promise<AuthActionResult>;
    /**
     * Store a pasted key in the OS keychain for `provider` (founder-gated body).
     * `baseUrl` carries a BYO OpenAI-compatible endpoint so the native side can
     * resolve the right host; it is forwarded transiently, NEVER persisted.
     */
    storeKey: (provider: string, key: string, baseUrl?: string) => Promise<AuthActionResult>;
    /**
     * Validate a key with the provider (HTTP; founder-gated body). `baseUrl` is the
     * optional BYO endpoint to validate against (forwarded, never persisted).
     */
    validateKey: (provider: string, key: string, baseUrl?: string) => Promise<AuthActionResult>;
    /** Clear the stored key + reset to unconfigured. */
    clear: () => Promise<void>;
    /** Set the active provider + optional model locally (persisted; no key). */
    setProvider: (provider: string, modelId?: string) => void;
}

// ============================================================================
// Capability gate
// ============================================================================

/**
 * Whether this platform has an in-app auth surface at all. Reads the ONE
 * capability seam (M0): `'none'` (browser) means every auth action is a no-op and
 * `configured` stays false. We read it lazily inside actions (not at module load)
 * so the executor is resolved at call time + mockable in tests.
 */
function authAvailable(): boolean {
    try {
        return getExecutor().getCapabilities().auth !== 'none';
    } catch {
        // No executor (e.g. a unit test without one) → treat as unavailable.
        return false;
    }
}

const STORAGE_NAME = 'openjammer-auth';

// ============================================================================
// Store
// ============================================================================

export const useAuthStore = create<AuthStoreState>()(
    persist(
        (set, get) => ({
            activeProvider: undefined,
            modelId: undefined,
            configured: false,
            conflict: false,

            refreshStatus: async () => {
                if (!authAvailable()) {
                    set({ configured: false, conflict: false });
                    return;
                }
                const invoke = getInvoke();
                if (!invoke) {
                    set({ configured: false, conflict: false });
                    return;
                }
                try {
                    const status = (await invoke('auth_status')) as NativeAuthStatus;
                    set({
                        configured: !!status.configured,
                        conflict: !!status.conflict,
                        // Adopt the native view of provider/model when it reports one
                        // (e.g. a key already in the keychain from a prior session),
                        // but keep our persisted choice when native is silent.
                        activeProvider: status.activeProvider ?? get().activeProvider,
                        modelId: status.modelId ?? get().modelId,
                    });
                } catch {
                    set({ configured: false, conflict: false });
                }
            },

            beginOAuth: async (provider) => {
                if (!authAvailable()) {
                    return { ok: false, message: 'AI auth requires the desktop app.' };
                }
                const invoke = getInvoke();
                if (!invoke) return { ok: false, message: 'AI auth requires the desktop app.' };
                const res = (await invoke('auth_begin_oauth', { provider })) as AuthActionResult;
                if (res.ok) {
                    set({ activeProvider: provider });
                    await get().refreshStatus();
                }
                return res;
            },

            storeKey: async (provider, key, baseUrl) => {
                if (!authAvailable()) {
                    return { ok: false, message: 'AI auth requires the desktop app.' };
                }
                const invoke = getInvoke();
                if (!invoke) return { ok: false, message: 'AI auth requires the desktop app.' };
                // Forward the BYO base URL only when present (transient, never persisted).
                const res = (await invoke('auth_store_key', {
                    provider,
                    key,
                    ...(baseUrl ? { baseUrl } : {}),
                })) as AuthActionResult;
                if (res.ok) {
                    set({ activeProvider: provider });
                    await get().refreshStatus();
                }
                return res;
            },

            validateKey: async (provider, key, baseUrl) => {
                if (!authAvailable()) {
                    return { ok: false, message: 'AI auth requires the desktop app.' };
                }
                const invoke = getInvoke();
                if (!invoke) return { ok: false, message: 'AI auth requires the desktop app.' };
                return (await invoke('auth_validate_key', {
                    provider,
                    key,
                    ...(baseUrl ? { baseUrl } : {}),
                })) as AuthActionResult;
            },

            clear: async () => {
                const invoke = getInvoke();
                if (authAvailable() && invoke) {
                    try {
                        await invoke('auth_clear', { provider: get().activeProvider });
                    } catch {
                        // Best-effort: still reset local state below.
                    }
                }
                set({ configured: false, conflict: false });
            },

            setProvider: (provider, modelId) => {
                set({ activeProvider: provider, modelId: modelId ?? get().modelId });
            },
        }),
        {
            name: STORAGE_NAME,
            // CRITICAL: persist provider + model ONLY — NEVER the key (it is never
            // in this store anyway) and NOT the derived `configured`/`conflict`
            // (re-derived from native `auth_status` on each session).
            partialize: (state) => ({
                activeProvider: state.activeProvider,
                modelId: state.modelId,
            }),
            storage: createJSONStorage(() => localStorage),
        },
    ),
);
