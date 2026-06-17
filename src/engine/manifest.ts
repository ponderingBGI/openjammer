/**
 * PluginManifest (TS) — the ONE manifest model, mirrored from the Rust
 * `ojcore::PluginManifest` and the frozen v1 JSON Schema
 * (`schemas/oj-plugin-v1.json`).
 *
 * "Everything is a plugin": every node type — built-in DSP, a Faust node, an
 * AI-WASM node, a hosted plugin — is described by this same shape. `id` is the
 * OPEN registry key; `kind` is the CLOSED {@link PrimitiveKind} the real-time
 * loop lowers it to.
 *
 * ZERO DUPLICATION: manifests are DERIVED from {@link nodeDefinitions} (the
 * single source of truth) by {@link manifestFor} / {@link allManifests} — node
 * lists are never hand-duplicated here.
 */

import type { NodeDefinition, NodeType } from './types';
import { nodeDefinitions } from './registry';
import { AI_MANIFEST_PARAMS_KEY } from './dynamicRegistry';

// ============================================================================
// Manifest types (mirror crates/ojcore/src/manifest.rs + oj-plugin-v1.json)
// ============================================================================

/**
 * CLOSED PrimitiveKind the RT loop lowers a manifest `id` to (serde unit-variant
 * names — must match `ojproto::PrimitiveKind` and the schema's `kind` enum).
 */
export type PrimitiveKind =
    | 'Osc'
    | 'Sampler'
    | 'Sf2'
    | 'KarplusString'
    | 'Gain'
    | 'Biquad'
    | 'Waveshaper'
    | 'Delay'
    | 'Convolution'
    | 'FaustHost'
    | 'WasmHost'
    | 'PluginHost'
    | 'Add'
    | 'MicIn'
    | 'SpeakerOut'
    | 'GraphIn'
    | 'GraphOut'
    | 'Passthrough';

/** How a node's audio is computed (selects the executor backend). Frozen v1. */
export type DspKind = 'builtin' | 'faust' | 'wasm' | 'none';

/** How a node's control surface is presented. Frozen v1. */
export type UiKind = 'auto' | 'react';

/** Declares one numeric parameter, addressed at runtime by `id` (u16). */
export interface ParamDecl {
    id: number;
    name: string;
    min: number;
    max: number;
    default: number;
}

/** Declares a node's port topology (audio + control, in + out). */
export interface PortDecl {
    audio_in: number;
    audio_out: number;
    control_in: number;
    control_out: number;
}

/** The complete static description of a registrable node type. */
export interface PluginManifest {
    id: string;
    name: string;
    kind?: PrimitiveKind;
    dsp: DspKind;
    ui: UiKind;
    params: ParamDecl[];
    ports: PortDecl;
}

// ============================================================================
// Derivation tables (pure mappings keyed by NodeType — single source remains
// `nodeDefinitions`; these only annotate the closed RT/dispatch facets the
// visual registry doesn't carry).
// ============================================================================

/**
 * Node types that own a bespoke React component (rendered by NodeWrapper's
 * switch). Everything else falls back to the FREE {@link AutoParamPanel} UI.
 * This is the ONLY hand-maintained list, and it mirrors NodeWrapper exactly.
 */
const REACT_UI: ReadonlySet<NodeType> = new Set<NodeType>([
    'looper',
    'effect',
    'amplifier',
    'recorder',
    'sampler',
    'library',
    'midi',
    'minilab-3',
    'keyboard',
    'speaker',
    'microphone',
    'instrument', // generic sampled instrument (rich sample picker)
]);

/**
 * Maps a NodeType to the CLOSED {@link PrimitiveKind} the RT loop lowers it to.
 * Unmapped (purely-visual / routing) types lower to `Passthrough`.
 */
const KIND_BY_TYPE: Partial<Record<NodeType, PrimitiveKind>> = {
    // generators / instruments → Sampler (the sampled-instrument primitive)
    piano: 'Sampler',
    cello: 'Sampler',
    electricCello: 'Sampler',
    violin: 'Sampler',
    saxophone: 'Sampler',
    strings: 'Sampler',
    keys: 'Sampler',
    winds: 'Sampler',
    instrument: 'Sampler',
    sampler: 'Sampler',
    library: 'Sampler',
    // processors
    amplifier: 'Gain',
    effect: 'Waveshaper',
    looper: 'Delay',
    // routing / io
    add: 'Add',
    subtract: 'Add',
    microphone: 'MicIn',
    speaker: 'SpeakerOut',
    recorder: 'SpeakerOut',
    'canvas-input': 'GraphIn',
    'canvas-output': 'GraphOut',
};

/**
 * Node types whose audio is computed by a built-in DSP kernel. Everything else
 * is a visual / control / routing node (`dsp: 'none'`). Derived from
 * {@link KIND_BY_TYPE}: a node has audio iff its primitive is an audio one.
 */
const NON_AUDIO_KINDS: ReadonlySet<PrimitiveKind> = new Set<PrimitiveKind>([
    'GraphIn',
    'GraphOut',
    'Passthrough',
]);

// ============================================================================
// Derivation
// ============================================================================

function dspFor(kind: PrimitiveKind | undefined): DspKind {
    if (kind === undefined || NON_AUDIO_KINDS.has(kind)) return 'none';
    return 'builtin';
}

function uiFor(type: NodeType): UiKind {
    return REACT_UI.has(type) ? 'react' : 'auto';
}

/** Count a definition's declared ports into a {@link PortDecl}. */
function portsFor(def: NodeDefinition): PortDecl {
    const ports: PortDecl = { audio_in: 0, audio_out: 0, control_in: 0, control_out: 0 };
    for (const p of def.defaultPorts) {
        // `universal` ports adapt to the connected signal; count them as control
        // for topology purposes (the conservative, schema-valid default).
        const audio = p.type === 'audio';
        if (p.direction === 'input') {
            if (audio) ports.audio_in++;
            else ports.control_in++;
        } else {
            if (audio) ports.audio_out++;
            else ports.control_out++;
        }
    }
    return ports;
}

/**
 * Derive the numeric {@link ParamDecl}s a node exposes from its `defaultData`.
 * This is the FREE param surface {@link AutoParamPanel} renders for AI/Faust
 * authored nodes; bespoke (ui:'react') nodes ignore it.
 *
 * Each top-level numeric `defaultData` field becomes a param; its `default` is
 * the registry value and the [min,max] range is inferred conservatively.
 */
function paramsFor(def: NodeDefinition): ParamDecl[] {
    const out: ParamDecl[] = [];
    let id = 0;
    for (const [name, value] of Object.entries(def.defaultData)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const { min, max } = rangeFor(value);
        out.push({ id, name, min, max, default: value });
        id++;
    }
    return out;
}

/** Infer a conservative [min,max] envelope around a default value. */
function rangeFor(value: number): { min: number; max: number } {
    if (value === 0) return { min: 0, max: 1 };
    // Normalized-ish defaults (0..1) widen to [0,1]; larger values get a 0..2x
    // headroom envelope (and allow sign for negatives, e.g. pitch offsets).
    if (value > 0 && value <= 1) return { min: 0, max: 1 };
    if (value > 0) return { min: 0, max: value * 2 };
    return { min: value * 2, max: -value * 2 };
}

/** OPEN registry id for a node type (namespaced under `builtin.`). */
export function manifestIdFor(type: NodeType): string {
    return `builtin.${type}`;
}

/**
 * Derive the {@link PluginManifest} for a single node definition. Pure: depends
 * only on the definition + the derivation tables above.
 */
export function manifestFromDefinition(def: NodeDefinition): PluginManifest {
    const kind = KIND_BY_TYPE[def.type];
    const manifest: PluginManifest = {
        id: manifestIdFor(def.type),
        name: def.name,
        dsp: dspFor(kind),
        ui: uiFor(def.type),
        params: paramsFor(def),
        ports: portsFor(def),
    };
    if (kind !== undefined) manifest.kind = kind;
    return manifest;
}

/** Derive the manifest for a node type (single source: {@link nodeDefinitions}). */
export function manifestFor(type: NodeType): PluginManifest {
    return manifestFromDefinition(nodeDefinitions[type]);
}

/** Every node's manifest, derived from {@link nodeDefinitions}. */
export function allManifests(): PluginManifest[] {
    return (Object.keys(nodeDefinitions) as NodeType[]).map(manifestFor);
}

/**
 * Build the {@link PluginManifest} for an AI-authored DYNAMIC plugin (M6).
 *
 * A code node's def is registered with `ui:'auto'` and carries its REAL compiled
 * params stashed under `defaultData.aiManifestParams`
 * ({@link AI_MANIFEST_PARAMS_KEY}); this lifts them into a manifest so
 * {@link AutoParamPanel} renders the node's true controls. `id` is the open
 * `ai.wasm.<hash>` / `ai.dsp.<hash>` registry key.
 *
 * The def's `type` stays `'effect'` (a valid closed NodeType) for execution, so
 * we report the manifest's `kind`/`dsp` honestly as the wasm code-node lowering.
 */
export function manifestForDynamic(id: string, def: NodeDefinition): PluginManifest {
    const stashed = (def.defaultData as Record<string, unknown>)[AI_MANIFEST_PARAMS_KEY];
    const params: ParamDecl[] = Array.isArray(stashed) ? (stashed as ParamDecl[]) : [];
    return {
        id,
        name: def.name,
        kind: 'WasmHost',
        dsp: 'wasm',
        ui: 'auto',
        params,
        ports: portsFor(def),
    };
}
