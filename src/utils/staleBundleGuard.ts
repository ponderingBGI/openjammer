/**
 * Stale-bundle recovery (desktop only).
 *
 * After an in-place update, the desktop webview's persistent HTTP cache
 * (WebView2 on Windows, WKWebView/NSURLCache on macOS, WebKitGTK on Linux) can
 * keep serving the OLD `index.html` + content-hashed `/assets/*` from before the
 * update: the installer swaps the on-disk files but never touches that cache, so
 * the app opens on the previous version until a manual hard reload. There is no
 * service worker in the native build (`usePWA` gates SW registration to the
 * browser), so nothing else recovers it.
 *
 * The fix: at boot, compare the bundle's build-time version (`__APP_VERSION__`,
 * inlined from package.json) against the native binary's version (the existing
 * `update_status` command's `current_version`, from tauri.conf.json). Release
 * stamping keeps those two in lockstep (`scripts/oj release stamp` + the
 * `version-sync` doctor gate), so they differ ONLY when the running bundle is a
 * stale cached copy. On a mismatch we force a fresh fetch by navigating to a
 * cache-busted URL: a never-seen query string is a guaranteed HTTP-cache miss, so
 * the webview re-fetches `index.html`, which now references the new hashed assets
 * (also misses) — the whole app loads fresh. No browsing data is cleared, so
 * settings / keybindings / projects / agent sessions all survive.
 *
 * Browser builds keep their own service-worker update path; this is a no-op there.
 */

import { getInvoke, isTauri } from '../ai/tauri';

/** Query param that marks (and de-dupes) a cache-bust navigation. */
const CACHE_BUST_PARAM = 'oj_cb';

/** The slice of the native `update_status` command result we read. */
interface NativeUpdateStatus {
    current_version: string;
}

/**
 * Detect a stale cached bundle in the desktop webview and, if found, reload once
 * from a cache-busted URL. Fire-and-forget: never throws, never blocks boot.
 */
export async function recoverFromStaleBundle(): Promise<void> {
    try {
        if (!isTauri()) return;
        const invoke = getInvoke();
        if (!invoke) return;

        // `__APP_VERSION__` may be undefined under a non-Vite runner — read it
        // defensively, matching the rest of the app (see src/vite-env.d.ts).
        const bundleVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined;
        if (!bundleVersion) return;

        const status = (await invoke('update_status')) as NativeUpdateStatus | undefined;
        const nativeVersion = status?.current_version;
        if (!nativeVersion) return;

        // In sync (the normal case) → nothing to do.
        if (nativeVersion === bundleVersion) return;

        // Loop-safety: bust at most once per native version. If we already
        // navigated for this version and STILL see a mismatch, the cache miss
        // didn't help — stop, rather than reload forever.
        const params = new URLSearchParams(window.location.search);
        if (params.get(CACHE_BUST_PARAM) === nativeVersion) return;

        params.set(CACHE_BUST_PARAM, nativeVersion);
        const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
        window.location.replace(url);
    } catch {
        // Best-effort recovery: a failure here must never break boot. Worst case
        // the user falls back to the manual hard reload, exactly as before.
    }
}
