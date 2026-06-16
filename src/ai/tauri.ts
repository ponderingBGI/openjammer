/**
 * Minimal Tauri global-bridge access for the AI lane (U20).
 *
 * The desktop shell sets `app.withGlobalTauri = true` (see
 * `src-tauri/tauri.conf.json`), exposing `invoke` and the event API on
 * `window.__TAURI__` WITHOUT needing the `@tauri-apps/api` npm package. The
 * audio lane already relies on this (`OjcoreNativeExecutor`); we re-derive the
 * same accessors here so the AI lane stays self-contained (it must not import
 * from `src/audio/**`).
 *
 * In a plain browser `window.__TAURI__` is absent: every accessor returns
 * null/false, which is exactly what gates the Tab->AI path to "desktop only".
 */

/** Shape of the slice of `window.__TAURI__` we consume. */
interface TauriGlobal {
    core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    event?: {
        listen?: (
            event: string,
            handler: (e: { payload: unknown }) => void,
        ) => Promise<() => void>;
    };
}

function tauri(): TauriGlobal | null {
    if (typeof window === 'undefined') return null;
    return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

/** True when running inside the Tauri desktop webview. */
export function isTauri(): boolean {
    return tauri() !== null;
}

/** Resolve the Tauri `invoke`, or null when not under Tauri. */
export function getInvoke():
    | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
    | null {
    const t = tauri();
    if (!t) return null;
    if (t.core?.invoke) return t.core.invoke.bind(t.core);
    if (t.invoke) return t.invoke.bind(t);
    return null;
}

/**
 * Subscribe to a Tauri event channel. Resolves to an unlisten function, or null
 * when the event API is unavailable (not under Tauri). The streaming AI command
 * pushes each parsed Pi RPC line as a payload on its channel.
 */
export async function listen<T>(
    event: string,
    handler: (payload: T) => void,
): Promise<(() => void) | null> {
    const t = tauri();
    if (!t?.event?.listen) return null;
    return t.event.listen(event, (e) => handler(e.payload as T));
}
