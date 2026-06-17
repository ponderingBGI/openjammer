/**
 * Dynamic Plugin Registry (M5) — the OPEN half of node identity.
 *
 * WHY this exists: {@link NodeType} is a CLOSED, validated union owned by the
 * read-only engine lane — every built-in node's id is known at compile time. But
 * an AI-authored / dynamically generated node is born at RUNTIME from a kernel
 * (today: stored Faust source; M6: compiled wasm) and cannot be a member of that
 * union. M5 introduces a SECOND, OPEN identity space: a runtime Map of
 * `openId -> NodeDefinition` keyed by an arbitrary string id (e.g.
 * `"ai.dsp.<hash>"`). A node carries this id ALONGSIDE its closed `type` (which
 * stays a valid NodeType — typically `'effect'` — for execution/serialization),
 * so display/params/canEnter can resolve from the dynamic def while audio keeps
 * flowing through the unchanged effect path.
 *
 * This module is deliberately DEPENDENCY-LIGHT — no React, no Zustand — mirroring
 * {@link commandRegistry}'s subscribe/getSnapshot style so any UI can refresh and
 * any non-React module (serialization, the agent session) can register/unregister
 * at any time.
 */

import type { NodeDefinition, PortDefinition } from './types';
import type { ParamDecl } from './manifest';

// ============================================================================
// Stable content hash (FNV-1a) — identity follows the kernel
// ============================================================================

/**
 * FNV-1a 32-bit hash of a string, returned as short lowercase hex (≤ 8 chars).
 *
 * Used to derive a STABLE dynamic id from a node's kernel (`"ai.dsp." +
 * shortHash(faustSource)`) so the SAME source yields the SAME id across sessions
 * and machines. That stability is what lets learning + identity follow the kernel
 * (re-authoring the same effect re-uses its id; a fresh load re-resolves to it).
 *
 * Pure + deterministic: no Date, no randomness, no platform dependence.
 */
export function shortHash(input: string): string {
    // FNV-1a 32-bit. Offset basis 2166136261; prime 16777619.
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        // Multiply by the FNV prime using 32-bit overflow arithmetic.
        hash = Math.imul(hash, 0x01000193);
    }
    // Coerce to an unsigned 32-bit int, then to padded hex.
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Namespace prefix for AI-authored DSP node ids: `"ai.dsp." + shortHash(src)`. */
export const AI_DSP_ID_PREFIX = 'ai.dsp.';

/**
 * Namespace prefix for AI-authored, COMPILED wasm code-node ids (M6):
 * `"ai.wasm." + wasmHash`. Used when the native author step produced a `.wasm` +
 * validated manifest (the host returns this exact id). Falls back to
 * {@link AI_DSP_ID_PREFIX} keying when faust is unavailable (browser / no Tauri).
 */
export const AI_WASM_ID_PREFIX = 'ai.wasm.';

/**
 * Derive the STABLE open id for an AI-authored DSP node from its kernel (the
 * stored Faust source). The same source always yields the same id, so identity
 * + learning follow the kernel across sessions, re-authoring, and reloads.
 */
export function dspPluginIdFor(faustSource: string): string {
    return AI_DSP_ID_PREFIX + shortHash(faustSource);
}

/**
 * The open id for a COMPILED wasm code node (M6): `"ai.wasm." + wasmHash`. The
 * `wasmHash` is the FNV-1a hex of the wasm bytes the native `author_wasm_node`
 * returned (same algorithm as {@link shortHash}), so the id is content-addressed
 * to the compiled artifact, not just the source.
 */
export function wasmPluginIdFor(wasmHash: string): string {
    return AI_WASM_ID_PREFIX + wasmHash;
}

// ============================================================================
// Effect-shaped dynamic definition (M5)
// ============================================================================

/**
 * The audio in/out port pair an AI-authored effect carries — mirrors the static
 * `effect` definition's `defaultPorts` so a dynamic node round-trips/renders the
 * same as a hand-placed effect. (Kept inline here to keep this module free of a
 * `registry` import — dynamicRegistry is a LEAF the registry depends on, not the
 * other way around.)
 */
const EFFECT_DYNAMIC_PORTS: readonly PortDefinition[] = [
    { id: 'audio-in', name: 'Audio In', type: 'audio', direction: 'input', position: { x: 0, y: 0.5 } },
    { id: 'audio-out', name: 'Audio Out', type: 'audio', direction: 'output', position: { x: 1, y: 0.5 } },
];

/** The data fields an AI-authored DSP node carries (a subset of NodeData). */
export interface DspNodeDescriptor {
    /** Display name (becomes the dynamic def's `name`). */
    name: string;
    /** The Faust DSP source — the node's KERNEL and identity content key. */
    faustSource: string;
    /** Optional human description for the node tooltip / palette. */
    description?: string;
    /**
     * The REAL manifest params the native compile reported (M6). When present,
     * they are stashed on the def's `defaultData.aiManifestParams` so
     * `AutoParamPanel` renders the node's true controls (see
     * `manifestForDynamic` in `engine/manifest.ts`). Absent → no auto params
     * (the legacy stored-source path).
     */
    params?: ParamDecl[];
}

/**
 * The `defaultData` key the dynamic def stashes its REAL manifest params under
 * (M6). `manifestForDynamic` reads it to build the node's `AutoParamPanel`
 * surface. Kept as a string constant so producer + consumer never drift.
 */
export const AI_MANIFEST_PARAMS_KEY = 'aiManifestParams';

/**
 * Build the effect-shaped {@link NodeDefinition} for an AI-authored DSP node.
 *
 * M5 INVARIANT: the def's `type` stays `'effect'` (a valid closed NodeType) so
 * EXECUTION and SERIALIZATION are unchanged — the OPEN identity lives in the
 * registry KEY, not in `type`. A code node is an opaque leaf, so `canEnter` is
 * false. (M6 will swap the kernel from Faust source to compiled wasm; the
 * identity/def shape stays.)
 */
export function makeDspNodeDefinition(desc: DspNodeDescriptor): NodeDefinition {
    return {
        type: 'effect',
        category: 'effects',
        name: desc.name,
        description: desc.description ?? 'AI-authored DSP effect',
        defaultPorts: EFFECT_DYNAMIC_PORTS.map((port) => ({ ...port })),
        defaultData: {
            effectType: 'distortion',
            params: {},
            // M6: the REAL compiled params (if any) so AutoParamPanel can render
            // the node's true controls. Empty array when only source was stored.
            [AI_MANIFEST_PARAMS_KEY]: desc.params ?? [],
        },
        dimensions: { width: 160, height: 100 },
        canEnter: false, // a code node is an opaque leaf
    };
}

// ============================================================================
// Store (framework-free singleton, mirroring commandRegistry's shape)
// ============================================================================

/** Insertion-ordered map of open id -> dynamic NodeDefinition. */
const plugins = new Map<string, NodeDefinition>();

/** Subscribers notified whenever the dynamic plugin set changes. */
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Register a dynamic plugin definition under `id`, replacing any existing entry
 * with the same id (idempotent for re-author / re-load). Returns an unregister
 * function so the caller — the agent session's reversible authoring, or a React
 * effect — can clean up.
 */
export function registerDynamicPlugin(id: string, def: NodeDefinition): () => void {
    plugins.set(id, def);
    emit();
    return () => unregisterDynamicPlugin(id);
}

/** Remove a dynamic plugin by id. No-op if it isn't registered. */
export function unregisterDynamicPlugin(id: string): void {
    if (plugins.delete(id)) emit();
}

/** Look up a dynamic plugin definition by open id. */
export function getDynamicPlugin(id: string): NodeDefinition | undefined {
    return plugins.get(id);
}

/** Whether an open id resolves to a registered dynamic plugin. */
export function hasDynamicPlugin(id: string): boolean {
    return plugins.has(id);
}

/** Snapshot of every registered dynamic plugin, in registration order. */
export function listDynamicPlugins(): { id: string; def: NodeDefinition }[] {
    return Array.from(plugins, ([id, def]) => ({ id, def }));
}

/** Subscribe to dynamic-registry changes. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Test-only: drop every registered dynamic plugin. Not used by app code. */
export function _resetDynamicRegistryForTests(): void {
    plugins.clear();
    emit();
}
