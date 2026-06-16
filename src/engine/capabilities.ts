/**
 * EngineCapabilities — the ONE platform-capability seam (architecture spine, M0).
 *
 * The Ctrl+K + AI vision ships a NATIVE flagship (Tauri desktop) and an HONEST,
 * progressively-degrading BROWSER (PWA) subset. To keep that branching coherent
 * — and to make a forgotten case a *compile error* rather than a silent
 * mis-feature — every consumer reads ONE descriptor instead of probing
 * `isTauri()` / `getInvoke()` / `backend.available()` ad hoc.
 *
 * The descriptor is returned by the active {@link Executor.getCapabilities}
 * (native = {@link DESKTOP_CAPABILITIES}, browser = {@link BROWSER_CAPABILITIES}).
 * It is the platform CEILING: e.g. `agent: 'pi-subprocess'` says "this platform
 * CAN drive a local Pi subprocess", while *runtime* availability (Pi actually
 * installed + its RPC vocabulary recognised) is refined later by the M1 spawn
 * handshake. Likewise `learning: 'pi-memory'` is the ceiling layered OVER the
 * always-present local frecency floor (M2).
 *
 * Consume each field via an exhaustive `switch` closed with {@link assertNever};
 * adding a variant to a field then fails to type-check until every switch handles
 * it. {@link agentTransportLabel} is the canonical example (and lives in app
 * source so the CI `tsc` gate enforces the exhaustiveness, not just the tests).
 */

/**
 * The platform capability descriptor. NOT a discriminated union: it is a record
 * of four independent capability axes, each a closed string union. There is
 * exactly ONE of these per running session.
 */
export interface EngineCapabilities {
    /**
     * How (and whether) the Tab→AI agent runs.
     * - `'pi-subprocess'` — local Pi RPC subprocess, host-sandboxed (desktop).
     * - `'remote-proxy'`  — a hosted agent endpoint (reserved; only if OpenJammer
     *   ever operates one for the browser).
     * - `'none'`          — no agent here (the honest "AI requires the desktop app").
     */
    agent: 'pi-subprocess' | 'remote-proxy' | 'none';

    /**
     * What this platform can do with AI-authored code nodes.
     * - `'author-and-run'` — compile/author (Faust→wasm, optional libfaust JIT)
     *   AND run them (desktop).
     * - `'run-only'`       — run the SAME content-addressed `.wasm` in the
     *   AudioWorklet, but authoring needs a build endpoint (browser).
     * - `'none'`           — neither.
     */
    codeNodes: 'author-and-run' | 'run-only' | 'none';

    /**
     * How provider credentials are obtained and stored.
     * - `'keychain-loopback'` — OS keychain at rest + loopback-PKCE OAuth (desktop).
     * - `'paste-proxy'`       — reserved browser path (paste a key / proxy); not
     *   shipped yet, but present so adding it later is not a breaking union change.
     * - `'none'`              — no in-app auth surface here.
     */
    auth: 'keychain-loopback' | 'paste-proxy' | 'none';

    /**
     * Where preference learning can live.
     * - `'pi-memory'`  — the pi-persistent-intelligence package may seed/boost the
     *   local frecency floor (desktop ceiling).
     * - `'local-only'` — on-device frecency only (browser, and the universal floor).
     */
    learning: 'pi-memory' | 'local-only';
}

/**
 * The desktop (Tauri) row — the flagship. Pi runs as a host-sandboxed subprocess,
 * code nodes are authored + run natively, auth uses the OS keychain, and learning
 * may layer Pi memory over the local frecency floor.
 */
export const DESKTOP_CAPABILITIES: EngineCapabilities = {
    agent: 'pi-subprocess',
    codeNodes: 'author-and-run',
    auth: 'keychain-loopback',
    learning: 'pi-memory',
};

/**
 * The browser (PWA) row — the honest degrading subset. No local subprocess (so no
 * agent / no in-app auth today), but the SAME `.wasm` code nodes run in the
 * worklet, and learning is on-device frecency.
 */
export const BROWSER_CAPABILITIES: EngineCapabilities = {
    agent: 'none',
    codeNodes: 'run-only',
    auth: 'none',
    learning: 'local-only',
};

/**
 * Exhaustiveness guard for capability `switch`es. Reaching it is a TYPE error at
 * compile time (the argument is `never` only when every variant is handled) and a
 * thrown error at runtime if an unmodelled value ever slips through.
 */
export function assertNever(value: never): never {
    throw new Error(`Unhandled capability variant: ${String(value)}`);
}

/**
 * Human label for the agent transport — the canonical exhaustive consumer of an
 * {@link EngineCapabilities} axis. Lives in app source (not a test) so the CI
 * `tsc` gate fails if a new `agent` variant is added without handling it here.
 */
export function agentTransportLabel(agent: EngineCapabilities['agent']): string {
    switch (agent) {
        case 'pi-subprocess':
            return 'Pi (local)';
        case 'remote-proxy':
            return 'Pi (remote)';
        case 'none':
            return 'unavailable';
        default:
            return assertNever(agent);
    }
}
