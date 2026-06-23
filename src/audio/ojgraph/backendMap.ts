/**
 * Backend manifest-id remapping (U17).
 *
 * The {@link emitOjGraph} emitter is BACKEND-AGNOSTIC: it stamps each IrNode with
 * the canonical U11 manifest id (`builtin.<nodeType>`) — the single source of
 * truth. But the two real engine backends ship DIFFERENT plugin registries, and
 * `ojcore::compile` hard-errors (`UnknownManifest`) on any `manifest_id` its
 * registry doesn't contain:
 *
 *   • NATIVE (`src-tauri`):  the FULL set via `register_all(RegisterOpts::full())`
 *                            (`EngineBackend::build_registry`) — every effect
 *                            (gain/biquad/waveshaper/delay/convolution), the
 *                            mix/routing nodes (add/subtract), every instrument,
 *                            and SF2. IO/master kinds load via the GAIN placeholder
 *                            (the `kind` flag marks them and the executor kind-gates
 *                            them, so the placeholder is never processed).
 *   • WASM  (`ojcore-wasm`): the same full set MINUS SF2 (`register_all(wasm())`).
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
    pan: 'builtin.pan',
    width: 'builtin.width',
    looper: 'builtin.looper',
    add: 'builtin.add',
    subtract: 'builtin.subtract',
    multiply: 'builtin.multiply',
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
            // Effects + mix/routing: native registers the FULL set via
            // register_all(RegisterOpts::full()), so these load their REAL kernels
            // — NOT a gain passthrough (the prior collapse silently no-op'd every
            // effect on the native/Tauri target and made Subtract == passthrough).
            case 'Biquad':
                return ENGINE_IDS.biquad;
            case 'Waveshaper':
                return ENGINE_IDS.waveshaper;
            case 'Delay':
                return ENGINE_IDS.delay;
            case 'Convolution':
                return ENGINE_IDS.convolution;
            // The stereo panner (the first 2-channel-output built-in), registered on
            // BOTH backends via register_builtins — it MUST load its real kernel so
            // it produces L/R; the GAIN placeholder writes a single lane and would
            // silently collapse the stereo to mono.
            case 'Pan':
                return ENGINE_IDS.pan;
            // The stereo width node (the first 2-channel-INPUT built-in), registered on
            // both backends — load its real kernel; the GAIN placeholder writes one lane
            // and would collapse the mid/side processing.
            case 'Width':
                return ENGINE_IDS.width;
            // The looper is a stateful built-in (register_builtins registers it on
            // BOTH backends): it MUST load its real kernel, not the gain placeholder
            // — a Gain instance no-ops looper_action/looper_snapshot, so record does
            // nothing and the engine never emits a transport frame.
            case 'Looper':
                return ENGINE_IDS.looper;
            case 'Add':
                return ENGINE_IDS.add;
            case 'Subtract':
                return ENGINE_IDS.subtract;
            case 'Multiply':
                return ENGINE_IDS.multiply;
            // SpeakerOut/GraphOut/GraphIn/MicIn/Passthrough/Gain: the master/IO
            // instance loads via GAIN (the `kind` flag marks it; the executor
            // kind-gates it so the placeholder is never processed) — matches
            // starter_graph.
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
        // The stereo panner — registered on both backends; load its real kernel so
        // it produces L/R rather than the single-lane gain placeholder.
        case 'Pan':
            return ENGINE_IDS.pan;
        // The stereo width node — registered on both backends; load its real kernel.
        case 'Width':
            return ENGINE_IDS.width;
        // Stateful built-in, registered on the wasm registry too — load the real
        // looper kernel, never the gain placeholder (see the native branch).
        case 'Looper':
            return ENGINE_IDS.looper;
        case 'Add':
            return ENGINE_IDS.add;
        case 'Subtract':
            return ENGINE_IDS.subtract;
        case 'Multiply':
            return ENGINE_IDS.multiply;
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
 * The dynamic-hosting kinds — a Faust node, an AI-authored WASM code-node, or a
 * hosted VST3/AU/CLAP. These are NOT closed builtins: each carries its OWN
 * `manifest_id` (`ai.dsp.*` / `ai.wasm.*` / `host.plugin.*`), the exact key its
 * per-node loader is registered under (registered dynamically, not in the static
 * tables above). The native executor lowers nodes to these kinds + ids; the
 * browser/wasm path keeps the closed effect fallback and never produces them (see
 * emit's `codeNodesAsWasmHost` / `hostedPluginsAsPluginHost`). A node of one of
 * these kinds therefore keeps its id VERBATIM through the remap — rewriting it by
 * kind dropped it to the gain placeholder, so the real plugin/wasm DSP never
 * loaded and first-class hosting silently did nothing.
 */
const DYNAMIC_HOST_KINDS: ReadonlySet<PrimitiveKind> = new Set<PrimitiveKind>([
    'PluginHost',
    'WasmHost',
    'FaustHost',
]);

/**
 * Return a COPY of `graph` with every IrNode's `manifest_id` remapped to the
 * given backend's registry. Pure: does not mutate the input. `kind`, ports,
 * params, edges and schedule are preserved exactly.
 *
 * Dynamic-hosting kinds ({@link DYNAMIC_HOST_KINDS}) keep their `manifest_id`
 * verbatim — it IS their (dynamically-registered) loader key. Every other kind is
 * mapped to the backend's builtin loader by {@link manifestIdForKind}.
 */
export function remapForBackend(graph: OjGraph, backend: EngineBackend): OjGraph {
    const nodes: IrNode[] = graph.nodes.map((n) => ({
        ...n,
        manifest_id: DYNAMIC_HOST_KINDS.has(n.kind)
            ? n.manifest_id
            : manifestIdForKind(n.kind, backend),
    }));
    return { ...graph, nodes };
}
