/**
 * Owns the app-wide native auto-update lifecycle: mirrors the update preference
 * into the Tauri shell (so install-on-quit knows what to do) and runs the quiet
 * background checks that stage updates. Renders nothing and steals no focus.
 *
 * Mount exactly ONCE near the app root. Desktop-only by nature — every call
 * no-ops in the browser (the PWA keeps its own service-worker update path). The
 * Settings → Updates panel uses its own (non-background) `useNativeUpdater`
 * instance for status + explicit actions, so there are never duplicate intervals.
 */

import { useNativeUpdater } from '../hooks/useNativeUpdater';

export function NativeUpdaterRunner() {
    useNativeUpdater({ background: true });
    return null;
}
