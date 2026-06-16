/**
 * Backend manifest-id remapping (U17).
 *
 * The {@link emitOjGraph} emitter is BACKEND-AGNOSTIC: it stamps each IrNode with
 * the canonical U11 manifest id (`builtin.<nodeType>`) — the single source of
 * truth. But the two real engine backends ship DIFFERENT plugin registries, and
 * `ojcore::compile` hard-errors (`UnknownManifest`) on any `manifest_id` its
 * registry doesn't contain:
 *
 *   • NATIVE (`src-tauri`):  builtin.gain, builtin.osc, builtin.sampler,
 *                            builtin.karplus  (no host structural loader; the
 *                            master `SpeakerOut` instance is loaded via the
 *                            GAIN loader — see `EngineBackend::starter_graph`).
 *   • WASM  (`ojcore-wasm`): builtin.gain, host.speaker_out.
 *
 * So before pushing, each executor remaps every IrNode's `manifest_id` to an id
 * its registry actually has, chosen by the node's closed {@link PrimitiveKind}.
 * The `kind` is preserved verbatim — it is what the RT kernel matches on (and
 * what master-output detection uses); only the loader-selecting `manifest_id`
 * changes. Kinds the backend cannot synthesize yet fall back to GAIN (a unity
 * passthrough instance), so the graph always compiles and stays audible rather
 * than failing the whole push.
 *
 * This is the documented seam where backend capability divergence lives; as the
 * engines gain real Waveshaper/Delay/Biquad loaders, extend the tables here only.
 */

import type { OjGraph, IrNode, PrimitiveKind } from '../../../packages/oj-protocol-ts/src/index';

/** Manifest ids the engine registries expose (mirrors the Rust `*_ID` consts). */
export const ENGINE_IDS = {
    gain: 'builtin.gain',
    osc: 'builtin.osc',
    sampler: 'builtin.sampler',
    karplus: 'builtin.karplus',
    hostSpeakerOut: 'host.speaker_out',
} as const;

/** Which backend's registry to remap for. */
export type EngineBackend = 'native' | 'wasm';

/**
 * Map a {@link PrimitiveKind} to the backend registry id that should LOAD the
 * node's instance. Returns the GAIN id for any kind the backend has no dedicated
 * loader for (a unity passthrough — keeps the graph compiling + audible).
 */
function manifestIdForKind(kind: PrimitiveKind, backend: EngineBackend): string {
    if (backend === 'native') {
        switch (kind) {
            case 'Osc':
                return ENGINE_IDS.osc;
            case 'Sampler':
            case 'Sf2':
                return ENGINE_IDS.sampler;
            case 'KarplusString':
                return ENGINE_IDS.karplus;
            // SpeakerOut/GraphOut: native loads the master instance via GAIN
            // (the `kind` flag is what marks it master) — matches starter_graph.
            // Gain / Add / Passthrough / processors / IO: GAIN passthrough.
            default:
                return ENGINE_IDS.gain;
        }
    }
    // wasm registry: only gain + host.speaker_out exist.
    switch (kind) {
        case 'SpeakerOut':
        case 'GraphOut':
            return ENGINE_IDS.hostSpeakerOut;
        default:
            return ENGINE_IDS.gain;
    }
}

/**
 * Return a COPY of `graph` with every IrNode's `manifest_id` remapped to the
 * given backend's registry. Pure: does not mutate the input. `kind`, ports,
 * params, edges and schedule are preserved exactly.
 */
export function remapForBackend(graph: OjGraph, backend: EngineBackend): OjGraph {
    const nodes: IrNode[] = graph.nodes.map((n) => ({
        ...n,
        manifest_id: manifestIdForKind(n.kind, backend),
    }));
    return { ...graph, nodes };
}
