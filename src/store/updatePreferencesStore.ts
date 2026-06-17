/**
 * Native auto-update preferences (desktop only).
 *
 * Persisted across launches and mirrored into the native shell (via the
 * `update_set_config` command in `useNativeUpdater`) so the install-on-quit
 * handler knows whether to apply a staged update and on which channel.
 *
 * The experience is deliberately quiet (the Live Performance Rule): with
 * `autoUpdateEnabled` on, updates download in the background and install when you
 * quit — no mid-session prompts. The only explicit surface is Settings → Updates.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Release channel the updater follows. Branch `canari` → the `canary` channel. */
export type UpdateChannel = 'stable' | 'canary';

interface UpdatePreferencesState {
    /** Download + install-on-quit in the background. Default ON. */
    autoUpdateEnabled: boolean;
    /** Which channel to follow. Switching is upstream-only (never downgrades). */
    updateChannel: UpdateChannel;
    /**
     * Set by a rollback: the app is pinned to this version and auto-update is
     * forced off until the user re-enables it (or updates manually). `null` in
     * normal operation.
     */
    pinnedVersion: string | null;

    setAutoUpdateEnabled: (enabled: boolean) => void;
    setUpdateChannel: (channel: UpdateChannel) => void;
    /** Pin to a version after rollback (also turns auto-update off). */
    pinTo: (version: string) => void;
    /** Clear the pin and resume updates. */
    resumeUpdates: () => void;
}

export const useUpdatePreferences = create<UpdatePreferencesState>()(
    persist(
        (set) => ({
            autoUpdateEnabled: true,
            updateChannel: 'stable',
            pinnedVersion: null,

            setAutoUpdateEnabled: (autoUpdateEnabled) => set({ autoUpdateEnabled }),
            setUpdateChannel: (updateChannel) => set({ updateChannel }),
            pinTo: (version) => set({ pinnedVersion: version, autoUpdateEnabled: false }),
            resumeUpdates: () => set({ pinnedVersion: null, autoUpdateEnabled: true }),
        }),
        { name: 'openjammer-update-preferences' },
    ),
);
