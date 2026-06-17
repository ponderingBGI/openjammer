/**
 * Code-node authoring bridge (M6) — `author_code_node`'s real backend.
 *
 * Turns AI-authored DSP source into a FIRST-CLASS dynamic plugin (M5
 * dynamicRegistry) carrying the node's REAL params, reversibly:
 *
 * - **Native (Tauri):** invoke `author_wasm_node`, which compiles the source to a
 *   `.wasm` + a host-VALIDATED v1 manifest and returns `{ manifestId, wasmHash,
 *   nIn/nOut, manifestJson | diagnostic }`. On success we register an
 *   `ai.wasm.<hash>` dynamic plugin carrying the real `ParamDecl[]` so
 *   AutoParamPanel renders the node's true controls.
 * - **Browser / no-Tauri:** there is no toolchain, so we store the source and key
 *   the node `ai.dsp.<sourceHash>` exactly as `author_dsp_node` does today.
 *
 * The author step is ASYNC (a Tauri invoke) but `applyToolCall` is SYNC, so this
 * registers the source-fallback plugin SYNCHRONOUSLY (undo works immediately) and
 * UPGRADES it in place when the native author resolves: same registration slot,
 * re-keyed to `ai.wasm.<hash>` with the compiled params. The returned `dispose`
 * tears down whatever is currently registered, so Reject is always clean.
 *
 * FOUNDER-GATED: `author_wasm_node` authors + validates the `.wasm` ONLY; nothing
 * here runs it on the audio thread (the wasm RT host is founder-gated — see
 * `docs/code-node-abi.md`). The node stays audible via the stored-source effect
 * path in the interim.
 */

import type { ParamDecl } from '../engine/manifest';
import type { AuthorCodeNodeArgs } from './types';

/** The native `author_wasm_node` result shape (mirrors `ai::AuthoredNode`). */
export interface AuthoredNodeResult {
    manifestId: string;
    manifestJson: string;
    wasmHash: string;
    nIn: number;
    nOut: number;
    diagnostic?: string;
}

/** What the authoring bridge hands its host (the session registrar). */
export interface CodeNodeRegistration {
    /** The OPEN plugin id the node was registered under (source-fallback id). */
    pluginId: string;
    /** Tear down the registration (the reversible `undo`). Idempotent. */
    dispose: () => void;
}

/** One authored registration: the dynamic plugin + its palette/menu command. */
export interface AuthoredRegistration {
    /** Tear down BOTH the dynamic plugin and the command. Idempotent. */
    unregister: () => void;
}

/** Dependencies injected so the bridge is unit-testable without Tauri/Zustand. */
export interface CodeNodeAuthorDeps {
    /**
     * Register a dynamic plugin under `id` (with `params`) AND its palette/menu
     * command, returning a combined unregister. Called once synchronously for the
     * source fallback, and again on the native upgrade with the compiled id.
     */
    register: (
        id: string,
        name: string,
        source: string,
        params: ParamDecl[],
        description?: string,
    ) => AuthoredRegistration;
    /** The stable source-keyed fallback id (`ai.dsp.<hash>`). */
    sourcePluginId: (source: string) => string;
    /** The compiled-keyed id (`ai.wasm.<hash>`). */
    wasmPluginId: (wasmHash: string) => string;
    /**
     * Invoke the native `author_wasm_node`, or null when not under Tauri (browser
     * keeps the stored-source fallback). Returns the parsed result.
     */
    invokeAuthor:
        | ((source: string, lang: string) => Promise<AuthoredNodeResult>)
        | null;
    /** Parse a manifest JSON string into its `ParamDecl[]` (native success path). */
    parseManifestParams: (manifestJson: string) => ParamDecl[];
}

/**
 * Author a code node reversibly. Registers the source-fallback plugin + command
 * synchronously, then (native only) upgrades to the compiled `ai.wasm.<hash>`
 * plugin when `author_wasm_node` resolves successfully.
 */
export function authorCodeNode(
    args: AuthorCodeNodeArgs,
    deps: CodeNodeAuthorDeps,
): CodeNodeRegistration {
    const lang = args.lang ?? 'faust';
    const fallbackId = deps.sourcePluginId(args.source);

    // Synchronous source-fallback registration so undo is immediate + correct.
    let current = deps.register(fallbackId, args.name, args.source, [], args.description);
    let disposed = false;

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        current.unregister();
    };

    // Native: try to upgrade the fallback into a compiled, param-carrying node.
    if (deps.invokeAuthor) {
        void deps
            .invokeAuthor(args.source, lang)
            .then((result) => {
                // A diagnostic (no faust / compile error / validation reject) keeps
                // the source-fallback registration — nothing to upgrade.
                if (disposed || result.diagnostic || !result.manifestId) return;
                const params = deps.parseManifestParams(result.manifestJson);
                const wasmId = deps.wasmPluginId(result.wasmHash);
                // Re-register under the compiled id with the REAL params, then drop
                // the old fallback so identity follows the compiled artifact.
                const upgraded = deps.register(
                    wasmId,
                    args.name,
                    args.source,
                    params,
                    args.description,
                );
                if (disposed) {
                    // Disposed mid-flight: don't leak the just-registered upgrade.
                    upgraded.unregister();
                    return;
                }
                current.unregister();
                current = upgraded;
            })
            .catch(() => {
                // A transport fault leaves the source-fallback in place (audible via
                // the effect path); the agent already has its transcript line.
            });
    }

    return { pluginId: fallbackId, dispose };
}
