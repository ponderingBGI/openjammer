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

import type { EffectType, NodeDefinition, NodeType, UiKind } from './types';
import { get as getNodeDefinition, nodeDefinitions } from './registry';
import {
    AI_MANIFEST_PARAMS_KEY,
    HOSTED_PLUGIN_DESCRIPTOR_KEY,
    type HostedParamDescriptor,
    type HostedPluginDescriptor,
} from './dynamicRegistry';
// The ONE closed PrimitiveKind set, imported from the wire-contract SSOT so this
// file never holds a fourth hand-written copy that can drift (see below).
import type { PrimitiveKind } from '../../packages/oj-protocol-ts/src/index';

// ============================================================================
// Manifest types (mirror crates/ojcore/src/manifest.rs + oj-plugin-v1.json)
// ============================================================================

/**
 * CLOSED PrimitiveKind the RT loop lowers a manifest `id` to. DERIVED from the
 * single wire-contract SSOT (`@openjammer/oj-protocol` `PRIMITIVE_KINDS`, itself
 * pinned to `ojproto::PrimitiveKind` and `schemas/primitive-kinds.json`) and
 * re-exported here — NEVER a fourth hand-written copy. The previous hand copy
 * silently omitted `Looper`/`Recorder`, which is exactly what lowered the looper
 * node to a `Delay`; deriving the type makes that class of drift impossible.
 */
export type { PrimitiveKind };

/** How a node's audio is computed (selects the executor backend). Frozen v1. */
export type DspKind = 'builtin' | 'faust' | 'wasm' | 'none';

/**
 * How a node's control surface is presented (frozen v1). Re-exported from the
 * registry type module, where it is declared as the SINGLE-SOURCE field on
 * {@link NodeDefinition} — the manifest's `ui` is DERIVED from that field, never a
 * second hand-maintained list.
 */
export type { UiKind };

/** Declares one numeric parameter, addressed at runtime by `id` (u16). */
export interface ParamDecl {
    id: number;
    name: string;
    min: number;
    max: number;
    default: number;
}

/** Declares a node's port topology (audio + control, in + out) + per-audio-port
 * channel counts (1=mono, 2=stereo; default 1). See docs/CHANNELS.md. */
export interface PortDecl {
    audio_in: number;
    audio_out: number;
    control_in: number;
    control_out: number;
    /** Channels per audio INPUT port (default 1 = mono). */
    audio_in_channels?: number;
    /** Channels per audio OUTPUT port (default 1 = mono). */
    audio_out_channels?: number;
}

/** A contract/ABI version, `major.minor` (see {@link Abi}, docs/STABILITY.md §4). */
export interface ContractVersion {
    major: number;
    minor: number;
}

/**
 * One capability a plugin declares against the kernel contract. `id` is an OPEN
 * namespaced string — `oj.*` is kernel-reserved, `vendor.*` is community.
 * `required` = the plugin cannot run without it (an unknown REQUIRED capability
 * degrades the node to a labeled passthrough stub); otherwise optional.
 */
export interface Capability {
    id: string;
    required?: boolean;
}

/** A coarse permission a plugin declares; DECLARED here, ENFORCED out-of-process. */
export type Permission = 'fs' | 'net' | 'native';

/**
 * The additive ABI / capability-negotiation block (docs/STABILITY.md §4). OPTIONAL
 * and strictly additive — absent = a pre-`abi` plugin targeting the base contract.
 * Mirrors `ojcore::Abi` + the v1 JSON Schema.
 */
export interface Abi {
    contract: ContractVersion;
    min_contract: ContractVersion;
    capabilities?: Capability[];
    permissions?: Permission[];
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
    /**
     * The additive ABI / capability-negotiation block (docs/STABILITY.md §4).
     * Omitted for pre-`abi` plugins (the common built-in case) — matches Rust `None`.
     */
    abi?: Abi;
}

// ============================================================================
// Derivation tables (pure mappings keyed by NodeType — single source remains
// `nodeDefinitions`; these only annotate the closed RT/dispatch facets the
// visual registry doesn't carry).
// ============================================================================

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
    effect: 'Waveshaper',
    pan: 'Pan',
    width: 'Width',
    looper: 'Looper',
    // routing / io
    add: 'Add',
    subtract: 'Subtract',
    multiplier: 'Multiply',
    microphone: 'MicIn',
    speaker: 'SpeakerOut',
    recorder: 'SpeakerOut',
    'canvas-input': 'GraphIn',
    'canvas-output': 'GraphOut',
};

/**
 * Explicit param-id tables for engine-backed nodes whose UI is bespoke
 * (`ui:'react'`), so their manifest params MATCH the kernel's param ids EXACTLY
 * instead of being auto-derived from `defaultData` field ORDER. Auto-derivation
 * ({@link paramsFor}) is only safe for AutoParamPanel (`ui:'auto'`) nodes; for a
 * bespoke engine node it silently collides — the looper's `duration`/`currentTime`
 * fields landed on the kernel's `(LOOP_SECS=0, WET=1)` ids, forcing WET=0 so a
 * captured loop played back SILENT (the real cause of "it doesn't loop after 10s").
 * This table is the single source of param-id agreement for such nodes (SEAM-4).
 *
 * `name` is the `node.data` key the live value is read from (see
 * {@link paramsFromData}); `id` MUST equal the kernel's param id.
 */
const PARAMS_BY_TYPE: Partial<Record<NodeType, ParamDecl[]>> = {
    // builtin.looper — ojcore `looper_param` ids: LOOP_SECS=0, WET=1, DRY=2.
    // LOOP_SECS reads `node.data.duration` (<= 0 => free-run; clamped to 60 s in
    // the kernel). WET/DRY have no node.data key yet, so they hold their defaults
    // (audible loop + live monitor) instead of being clobbered to 0.
    looper: [
        { id: 0, name: 'duration', min: 0, max: 60, default: 10 },
        { id: 1, name: 'wet', min: 0, max: 1, default: 1 },
        { id: 2, name: 'dry', min: 0, max: 1, default: 1 },
    ],
    // builtin.speaker (master sink) — ojcore master_param ids: VOLUME=0, MUTE=1.
    // Declared explicitly so MUTE (a boolean in node.data) is BAKED into the IR and
    // re-applied to the engine on project load (PERSIST-1) — otherwise a project
    // saved muted reloads at FULL VOLUME (stage-critical). VOLUME reads
    // node.data.volume; MUTE reads node.data.isMuted (bool coerced to 0/1 by
    // paramsFromData). Mirrors crates/ojcore/src/structural.rs master_param.
    speaker: [
        { id: 0, name: 'volume', min: 0, max: 1, default: 1 },
        { id: 1, name: 'isMuted', min: 0, max: 1, default: 0 },
    ],
    // builtin.multiply — ojcore multiply_param FACTOR id 0 (the on-node number).
    // Declared explicitly so the seam carries the kernel's param id rather than a
    // field-order auto-derivation. `paramsFromData` CLAMPS the live value to
    // [min,max] at emit: floored at 0 (a negative multiplier is meaningless once
    // ×0 already mutes) with no musical ceiling (1e6 ≈ unbounded, per the user's
    // "0 to ∞"). The FACTOR_ACTIVE flag (id 1) is NOT here — it's edge-derived and
    // injected by the emitter (a disconnected input can't be detected in the
    // kernel), see `emit.ts`.
    multiplier: [{ id: 0, name: 'factor', min: 0, max: 1_000_000, default: 1 }],
    // builtin.pan — ojcore pan_param PAN id 0, range [-1, 1] (−1 L, 0 centre, +1 R).
    // Declared explicitly because pan is a SIGNED range the conservative auto-
    // derivation (`rangeFor(0)` => [0,1]) cannot express; AutoParamPanel renders it.
    // `paramsFromData` reads node.data.pan and clamps to [-1, 1].
    pan: [{ id: 0, name: 'pan', min: -1, max: 1, default: 0 }],
    // builtin.width — ojcore width_param WIDTH id 0, range [0, 2] (0 = mono, 1 = unity,
    // 2 = wide). Explicit because the conservative auto-derivation (rangeFor(1) => [0,1])
    // cannot express the >1 widen range. `paramsFromData` reads node.data.width.
    width: [{ id: 0, name: 'width', min: 0, max: 2, default: 1 }],
};

/**
 * EffectNode lowering (SEAM-4 for the effect node). The `effect` node carries an
 * `effectType` discriminator + a `data.params.*` bag in the visual model; here we
 * map each chosen effect to the REAL ojcore primitive it lowers to AND the exact
 * kernel param ids each UI control drives, so the engine actually applies the
 * effect (previously `effect` ALWAYS lowered to `Waveshaper` and the params lived
 * under `data.params.*` which the top-level `paramsFromData` never read — every
 * non-distortion option + every slider was DEAD).
 *
 * `param.name` is the key inside `node.data.params` the live value is read from
 * (see {@link effectParamsFromData}); `param.id` MUST equal the kernel's param id
 * (crates/ojcore/src/effects.rs `{biquad,waveshaper,delay,convolution}_param`).
 * A decl with no matching UI control (e.g. Waveshaper LEVEL) holds its `default`,
 * which is the kernel-correct unity value.
 */
export interface EffectLowering {
    kind: PrimitiveKind;
    params: ParamDecl[];
}
const EFFECT_LOWERING: Record<EffectType, EffectLowering> = {
    // distortion -> Waveshaper. UI `amount` drives AMOUNT(0); LEVEL(1) held at
    // unity (1.0) so the curve doesn't also re-gain the signal.
    distortion: {
        kind: 'Waveshaper',
        params: [
            { id: 0, name: 'amount', min: 0, max: 1, default: 0.5 },
            { id: 1, name: 'level', min: 0, max: 2, default: 1 },
        ],
    },
    // filter -> Biquad. UI `frequency`/`q` drive FREQ(1)/Q(2); TYPE(0) defaults
    // to lowpass and GAIN_DB(3) to 0 (flat) — both holdable from data if present.
    filter: {
        kind: 'Biquad',
        params: [
            { id: 0, name: 'type', min: 0, max: 7, default: 0 },
            { id: 1, name: 'frequency', min: 20, max: 20_000, default: 1_000 },
            { id: 2, name: 'q', min: 0.1, max: 20, default: 0.707 },
            { id: 3, name: 'gain_db', min: -24, max: 24, default: 0 },
        ],
    },
    // reverb -> Convolution. The kernel exposes only MIX(0) (the wet IR tail is
    // the reverb); UI `mix` drives it. (No `decay` kernel param exists — the IR
    // length is the decay, so a decay slider would be fictional and is omitted.)
    reverb: {
        kind: 'Convolution',
        params: [{ id: 0, name: 'mix', min: 0, max: 1, default: 0.3 }],
    },
    // delay -> Delay. UI `time`/`feedback`/`mix` drive TIME(0)/FEEDBACK(1)/MIX(2).
    delay: {
        kind: 'Delay',
        params: [
            { id: 0, name: 'time', min: 0, max: 2, default: 0.25 },
            { id: 1, name: 'feedback', min: 0, max: 0.9, default: 0.4 },
            { id: 2, name: 'mix', min: 0, max: 1, default: 0.3 },
        ],
    },
};

/** Default effect type when a node carries none (mirrors the registry default). */
const DEFAULT_EFFECT_TYPE: EffectType = 'distortion';

/** Resolve an effect node's chosen {@link EffectLowering} from its data. */
export function effectLoweringFor(data: Record<string, unknown> | undefined): EffectLowering {
    const t = (data?.effectType as EffectType | undefined) ?? DEFAULT_EFFECT_TYPE;
    return EFFECT_LOWERING[t] ?? EFFECT_LOWERING[DEFAULT_EFFECT_TYPE];
}

/**
 * Resolve an effect node's kernel {@link Param}s from `node.data.params.*`. A
 * decl whose name is present (finite-numeric) in `data.params` carries its live
 * value; otherwise the decl default (the kernel-correct value). Addressed by the
 * decl `id` (the kernel param id).
 */
export function effectParamsFromData(
    data: Record<string, unknown> | undefined,
): { id: number; value: number }[] {
    const lowering = effectLoweringFor(data);
    const bag = (data?.params as Record<string, unknown> | undefined) ?? {};
    return lowering.params.map((decl) => {
        const raw = bag[decl.name];
        const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : decl.default;
        return { id: decl.id, value };
    });
}

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

/**
 * The node's UI facet is DERIVED from the single-source {@link NodeDefinition.ui}
 * field — never a second hand-maintained list (the old `REACT_UI` set, deleted).
 * `def.ui` is `'react'` IFF NodeWrapper renders the type with a bespoke component
 * (enforced by the node-registry coupling gate). A def predating the field falls
 * back to `'auto'` (the safe FREE AutoParamPanel).
 */
function uiFor(def: NodeDefinition): UiKind {
    return def.ui ?? 'auto';
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
        ui: uiFor(def),
        params: PARAMS_BY_TYPE[def.type] ?? paramsFor(def),
        ports: portsFor(def),
    };
    if (kind !== undefined) manifest.kind = kind;
    return manifest;
}

/**
 * Derive the manifest for a node type (single source: {@link nodeDefinitions}).
 *
 * Use the registry resolver instead of indexing `nodeDefinitions` directly so a
 * stale/corrupt persisted node type lands on the inert Unknown definition rather
 * than crashing the render path while reading `def.type`.
 */
export function manifestFor(type: NodeType): PluginManifest {
    return manifestFromDefinition(getNodeDefinition(type));
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
    const data = def.defaultData as Record<string, unknown>;
    const hosted = data[HOSTED_PLUGIN_DESCRIPTOR_KEY] as HostedPluginDescriptor | undefined;
    if (hosted !== undefined) {
        const detailed = Array.isArray(hosted.params) ? hosted.params : [];
        const params: ParamDecl[] = (detailed.length > 0
            ? detailed
            : Array.from({ length: Math.min(hosted.param_count ?? 0, 256) }, (_, paramId) => ({
                  id: paramId,
                  name: `param${paramId}`,
                  min: 0,
                  max: 1,
                  default: 0,
              } as HostedParamDescriptor))
        ).map((p, index) => ({
            // The native host currently addresses hosted plugin params by index.
            id: index,
            name: p.name,
            min: p.min,
            max: p.max,
            default: p.default,
        }));
        return {
            id,
            name: def.name,
            kind: 'PluginHost',
            dsp: 'none',
            ui: 'auto',
            params,
            ports: {
                // ONE audio port per side that CARRIES the plugin's channels
                // (docs/CHANNELS.md model B), mirroring the Rust `PluginHostLoader`
                // manifest. emit's `portCounts` reads only `audio_in`/`audio_out`
                // (the PORT count, => n_in/n_out = 1), and the native compiler
                // derives the stereo lanes from the registered loader's
                // `audio_*_channels`. Modeling N channels as N mono ports here would
                // emit n_out = 2 and desync from the 1-port Rust manifest.
                audio_in: (hosted.ports?.audio_in ?? 0) > 0 ? 1 : 0,
                audio_out: (hosted.ports?.audio_out ?? 0) > 0 ? 1 : 0,
                control_in: 0,
                control_out: 0,
                audio_in_channels: hosted.ports?.audio_in ?? 0,
                audio_out_channels: hosted.ports?.audio_out ?? 0,
            },
        };
    }

    const stashed = data[AI_MANIFEST_PARAMS_KEY];
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
