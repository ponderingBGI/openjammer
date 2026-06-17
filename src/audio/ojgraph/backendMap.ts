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
    biquad: 'builtin.biquad',
    waveshaper: 'builtin.waveshaper',
    delay: 'builtin.delay',
    convolution: 'builtin.convolution',
    add: 'builtin.add',
    passthrough: 'builtin.passthrough',
    hostGraphIn: 'host.graph_in',
    hostMicIn: 'host.mic_in',
    hostGraphOut: 'host.graph_out',
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
    // wasm registry (U-WASM-PARITY): `ojcore-wasm::init` registers the FULL
    // common set via `ojinstrument::register_all(RegisterOpts::wasm())` — every
    // instrument (Osc / Sampler / Karplus), every effect (Gain / Biquad /
    // Waveshaper / Delay / Convolution), and the structural I/O nodes — MINUS SF2
    // (rustysynth needs std). So the wasm remap preserves each kind's real loader
    // id (a Sampler stays `builtin.sampler` so its bound `AssetRef` plays; a MicIn
    // stays `host.mic_in` so the worklet's captured block sources from it), and
    // only falls back to GAIN for kinds the wasm registry genuinely lacks.
    switch (kind) {
        case 'Osc':
            return ENGINE_IDS.osc;
        // SF2 has no wasm backend; lower it to the Sampler loader so a soundfont
        // node still plays any bound PCM sample rather than silently erroring.
        case 'Sampler':
        case 'Sf2':
            return ENGINE_IDS.sampler;
        case 'KarplusString':
            return ENGINE_IDS.karplus;
        case 'Biquad':
            return ENGINE_IDS.biquad;
        case 'Waveshaper':
            return ENGINE_IDS.waveshaper;
        case 'Delay':
            return ENGINE_IDS.delay;
        case 'Convolution':
            return ENGINE_IDS.convolution;
        case 'Add':
            return ENGINE_IDS.add;
        case 'Passthrough':
            return ENGINE_IDS.passthrough;
        case 'GraphIn':
            return ENGINE_IDS.hostGraphIn;
        case 'MicIn':
            return ENGINE_IDS.hostMicIn;
        case 'GraphOut':
            return ENGINE_IDS.hostGraphOut;
        case 'SpeakerOut':
            return ENGINE_IDS.hostSpeakerOut;
        // Gain + any kind without a dedicated wasm loader: unity passthrough.
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
