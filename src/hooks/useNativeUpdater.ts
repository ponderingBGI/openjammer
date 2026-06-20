/**
 * Native auto-update orchestration (desktop only).
 *
 * Drives the Rust updater commands from React: mirrors the persisted preference
 * into the shell (so install-after-close knows what to do), runs quiet background
 * checks on the selected channel, and exposes explicit actions for the Settings →
 * Updates panel. In a plain browser every call is a no-op (`isTauri()` is false);
 * the browser PWA keeps its own service-worker update path.
 *
 * Quiet by design (the Live Performance Rule): a found update downloads in the
 * background and installs silently after OpenJammer closes. The app never
 * reopens itself from that automatic path — the only explicit "get it now" lives
 * in Settings (notably right after a channel switch).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getInvoke, isTauri } from '../ai/tauri';
import { useUpdatePreferences, type UpdateChannel } from '../store/updatePreferencesStore';

/** Mirror of the Rust `UpdateStatus`. */
export interface UpdateStatus {
    current_version: string;
    pending: boolean;
    pending_version: string | null;
    /** Version held in the last-good backup (the rollback target), if any. */
    last_good_version: string | null;
    supported: boolean;
    /** Native OS reported by the shell; browser builds synthesize their own copy. */
    platform: 'windows' | 'macos' | 'linux' | 'unknown';
    /** Native CPU arch (`x86_64`, `aarch64`, ...). */
    arch: string;
    /** How this copy was installed/runs: `nsis`, `appimage`, `linux-package`, `dmg`, `dev`, ... */
    install_kind: string;
    /** Whether the native updater may safely install on this exact platform/install kind. */
    can_auto_update: boolean;
    /** Human reason shown when auto-update is unavailable. */
    manual_reason: string | null;
}

/**
 * Snapshot the webview's `localStorage` (settings, keybindings, theme, the
 * agent-session store, the emergency project backup) as a JSON string. IndexedDB
 * is intentionally excluded: it holds re-derivable caches and non-serializable
 * file-system handles.
 */
function exportWebviewState(): string {
    const data: Record<string, string> = {};
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key === null) continue;
            const value = localStorage.getItem(key);
            if (value !== null) data[key] = value;
        }
    } catch {
        // storage unavailable — return whatever we have
    }
    return JSON.stringify(data);
}

/** Replace `localStorage` with a snapshot produced by {@link exportWebviewState}. */
function importWebviewState(json: string): void {
    if (!json) return;
    try {
        const data = JSON.parse(json) as Record<string, string>;
        localStorage.clear();
        for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value);
    } catch {
        // malformed snapshot — leave current storage untouched
    }
}

/** Time between automatic background checks (~6h). */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Defer the first check so we never compete with first paint / audio init. */
const INITIAL_CHECK_DELAY_MS = 4000;

export interface NativeUpdater {
    /** Desktop build on a platform with the updater compiled in (Win/Linux). */
    supported: boolean;
    status: UpdateStatus | null;
    checking: boolean;
    error: string | null;
    /** Check `channel` now (or the current preference); resolves to the available version or null. */
    checkNow: (channel?: UpdateChannel) => Promise<string | null>;
    /** Explicit "Update & restart now" — installs only when audio is idle. */
    installNow: () => Promise<boolean>;
    /** Restore the last-good data snapshot, then pin + turn auto-update off. */
    rollback: () => Promise<boolean>;
    refreshStatus: () => Promise<void>;
}

export interface UseNativeUpdaterOptions {
    /**
     * Own the app-wide background behaviour: mirror the preference into the shell
     * and run periodic checks. Pass `true` from exactly ONE mount near the app
     * root; the Settings panel mounts with the default (`false`) so it only reads
     * status + drives explicit actions, with no duplicate intervals.
     */
    background?: boolean;
}

export function useNativeUpdater(options: UseNativeUpdaterOptions = {}): NativeUpdater {
    const { background = false } = options;
    const autoUpdateEnabled = useUpdatePreferences((s) => s.autoUpdateEnabled);
    const updateChannel = useUpdatePreferences((s) => s.updateChannel);
    const pinnedVersion = useUpdatePreferences((s) => s.pinnedVersion);
    const pinTo = useUpdatePreferences((s) => s.pinTo);

    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Latest status without re-triggering the background-check effect.
    const statusRef = useRef<UpdateStatus | null>(null);

    const native = isTauri();

    const refreshStatus = useCallback(async () => {
        const invoke = getInvoke();
        if (!invoke) return;
        try {
            const s = (await invoke('update_status')) as UpdateStatus;
            statusRef.current = s;
            setStatus(s);
        } catch {
            // status is best-effort; never surface
        }
    }, []);

    const checkNow = useCallback(async (channelOverride?: UpdateChannel): Promise<string | null> => {
        const invoke = getInvoke();
        if (!invoke) return null;
        const channel = channelOverride ?? updateChannel;
        setChecking(true);
        setError(null);
        try {
            // Keep native install-after-close state in lockstep with explicit checks,
            // including the first check immediately after the React preference changes.
            await invoke('update_set_config', {
                enabled: autoUpdateEnabled,
                channel,
            }).catch(() => {});
            const version = (await invoke('update_check_and_stage', {
                channel,
            })) as string | null;
            if (version) {
                // Back up the OUTGOING version's data before it installs after close.
                await invoke('update_backup', { webviewState: exportWebviewState() }).catch(() => {});
            }
            await refreshStatus();
            return version ?? null;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        } finally {
            setChecking(false);
        }
    }, [autoUpdateEnabled, updateChannel, refreshStatus]);

    const installNow = useCallback(async (): Promise<boolean> => {
        const invoke = getInvoke();
        if (!invoke) return false;
        try {
            return (await invoke('update_install_if_idle')) as boolean;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    }, []);

    const rollback = useCallback(async (): Promise<boolean> => {
        const invoke = getInvoke();
        if (!invoke) return false;
        try {
            const result = (await invoke('update_rollback')) as {
                version: string;
                webview_state: string;
            } | null;
            if (!result) return false;
            // Restore settings/session, then pin to the previous version with
            // auto-update off so the bad build can't come straight back.
            importWebviewState(result.webview_state);
            pinTo(result.version);
            await refreshStatus();
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    }, [pinTo, refreshStatus]);

    // Mirror the preference into the native shell (drives install-after-close).
    // Owned by the background mount so it tracks every toggle/channel change.
    useEffect(() => {
        if (!background) return;
        const invoke = getInvoke();
        if (!invoke) return;
        invoke('update_set_config', {
            enabled: autoUpdateEnabled,
            channel: updateChannel,
        }).catch(() => {});
    }, [background, autoUpdateEnabled, updateChannel]);

    // Initial status read.
    useEffect(() => {
        if (native) void refreshStatus();
    }, [native, refreshStatus]);

    // Quiet background checks: on channel change + on an interval, when
    // auto-update is on and we aren't pinned. Skips if an update is already staged.
    // Only the background mount runs these (no duplicate intervals from the panel).
    useEffect(() => {
        if (!background || !native || !autoUpdateEnabled || pinnedVersion) return;
        let cancelled = false;
        const tick = () => {
            void (async () => {
                if (cancelled) return;
                if (!statusRef.current) await refreshStatus();
                const latest = statusRef.current;
                if (cancelled || latest?.pending || !latest?.can_auto_update) return;
                await checkNow();
            })();
        };
        const initial = setTimeout(tick, INITIAL_CHECK_DELAY_MS);
        const interval = setInterval(tick, CHECK_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearTimeout(initial);
            clearInterval(interval);
        };
    }, [background, native, autoUpdateEnabled, pinnedVersion, updateChannel, checkNow, refreshStatus]);

    return {
        supported: native && (status?.supported ?? true),
        status,
        checking,
        error,
        checkNow,
        installNow,
        rollback,
        refreshStatus,
    };
}
