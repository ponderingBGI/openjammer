/**
 * Backend remap tests (U17) — ensure every emitted IrNode lowers to a manifest
 * id the target engine registry actually contains, so the pushed graph compiles
 * instead of erroring with `UnknownManifest`.
 */

import { describe, expect, it } from 'vitest';
import { emitOjGraph } from '../emit';
import { remapForBackend, ENGINE_IDS, type EngineBackend } from '../backendMap';
import { getNodeDefinition } from '../../../engine/registry';
import type { Connection, GraphNode, NodeType } from '../../../engine/types';
import { PRIMITIVE_KINDS } from '../../../../packages/oj-protocol-ts/src/index';
import type { OjGraph, PrimitiveKind } from '../../../../packages/oj-protocol-ts/src/index';

let counter = 0;
function makeNode(type: NodeType, id: string, data: Record<string, unknown> = {}): GraphNode {
    const def = getNodeDefinition(type);
    return {
        id,
        type,
        category: def.category,
        position: { x: 0, y: 0 },
        data: { ...def.defaultData, ...data },
        ports: [...def.defaultPorts],
        parentId: null,
        childIds: [],
    };
}
function makeConn(s: string, sp: string, t: string, tp: string, type: 'audio' | 'control'): Connection {
    counter += 1;
    return { id: `c${counter}`, sourceNodeId: s, sourcePortId: sp, targetNodeId: t, targetPortId: tp, type };
}

// Native registers the FULL set via register_all(RegisterOpts::full()) — every
// effect + mix/routing (add/subtract) + instruments. IO/master kinds remap to the
// GAIN placeholder (kind-gated), so the ids a native-remapped graph can carry are:
const NATIVE_REGISTRY = new Set<string>([
    ENGINE_IDS.gain,
    ENGINE_IDS.osc,
    ENGINE_IDS.sampler,
    ENGINE_IDS.karplus,
    ENGINE_IDS.biquad,
    ENGINE_IDS.waveshaper,
    ENGINE_IDS.delay,
    ENGINE_IDS.convolution,
    ENGINE_IDS.looper,
    ENGINE_IDS.add,
    ENGINE_IDS.subtract,
    ENGINE_IDS.multiply,
]);
// U-WASM-PARITY: the wasm registry now holds the FULL common set (instruments +
// effects + structural I/O), minus SF2 — the same as native plus structural — so
// the wasm remap preserves real loader ids (a Sampler stays builtin.sampler).
const WASM_REGISTRY = new Set<string>([
    ENGINE_IDS.gain,
    ENGINE_IDS.osc,
    ENGINE_IDS.sampler,
    ENGINE_IDS.karplus,
    ENGINE_IDS.biquad,
    ENGINE_IDS.waveshaper,
    ENGINE_IDS.delay,
    ENGINE_IDS.convolution,
    ENGINE_IDS.looper,
    ENGINE_IDS.add,
    ENGINE_IDS.subtract,
    ENGINE_IDS.multiply,
    ENGINE_IDS.passthrough,
    ENGINE_IDS.hostGraphIn,
    ENGINE_IDS.hostMicIn,
    ENGINE_IDS.hostGraphOut,
    ENGINE_IDS.hostSpeakerOut,
]);

function buildRichPatch() {
    const kb = makeNode('keyboard', 'kb');
    const inst = makeNode('instrument', 'inst');
    const fx = makeNode('effect', 'fx');
    const mul = makeNode('multiplier', 'mul');
    const spk = makeNode('speaker', 'spk');
    const conns = [
        makeConn('kb', 'bundle-out', 'inst', 'bundle-in', 'control'),
        makeConn('inst', 'audio-out', 'fx', 'audio-in', 'audio'),
        makeConn('fx', 'audio-out', 'mul', 'in-1', 'audio'),
        makeConn('mul', 'out', 'spk', 'audio-in', 'audio'),
    ];
    return emitOjGraph(
        new Map([kb, inst, fx, mul, spk].map((n) => [n.id, n])),
        new Map(conns.map((c) => [c.id, c])),
    );
}

describe('remapForBackend', () => {
    it('native: every manifest_id is in the native registry', () => {
        const g = remapForBackend(buildRichPatch(), 'native');
        for (const n of g.nodes) {
            expect(NATIVE_REGISTRY.has(n.manifest_id), `${n.kind} -> ${n.manifest_id}`).toBe(true);
        }
    });

    it('wasm: every manifest_id is in the wasm registry', () => {
        const g = remapForBackend(buildRichPatch(), 'wasm');
        for (const n of g.nodes) {
            expect(WASM_REGISTRY.has(n.manifest_id), `${n.kind} -> ${n.manifest_id}`).toBe(true);
        }
    });

    it('preserves kind, edges, ports and is non-mutating', () => {
        const original = buildRichPatch();
        const snapshot = JSON.stringify(original);
        const g = remapForBackend(original, 'native');
        // kinds preserved 1:1
        expect(g.nodes.map((n) => n.kind)).toEqual(original.nodes.map((n) => n.kind));
        expect(g.edges).toEqual(original.edges);
        // input not mutated
        expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('wasm maps the master SpeakerOut to host.speaker_out', () => {
        const g = remapForBackend(buildRichPatch(), 'wasm');
        const master = g.nodes.find((n) => n.kind === 'SpeakerOut');
        expect(master?.manifest_id).toBe(ENGINE_IDS.hostSpeakerOut);
    });

    it('wasm preserves the Sampler loader so a bound AssetRef plays (U-WASM-PARITY)', () => {
        const g = remapForBackend(buildRichPatch(), 'wasm');
        const sampler = g.nodes.find((n) => n.kind === 'Sampler');
        expect(sampler?.manifest_id).toBe(ENGINE_IDS.sampler);
    });

    it('wasm preserves the MicIn loader so the captured block sources from it', () => {
        const mic = makeNode('microphone', 'mic');
        const spk = makeNode('speaker', 'spk');
        const conns = [makeConn('mic', 'audio-out', 'spk', 'audio-in', 'audio')];
        const emitted = emitOjGraph(
            new Map([mic, spk].map((n) => [n.id, n])),
            new Map(conns.map((c) => [c.id, c])),
        );
        const g = remapForBackend(emitted, 'wasm');
        const micNode = g.nodes.find((n) => n.kind === 'MicIn');
        expect(micNode?.manifest_id).toBe(ENGINE_IDS.hostMicIn);
    });

    it('native maps Sampler/Osc/Karplus to their loaders and master via gain', () => {
        const g = remapForBackend(buildRichPatch(), 'native');
        const sampler = g.nodes.find((n) => n.kind === 'Sampler');
        const master = g.nodes.find((n) => n.kind === 'SpeakerOut');
        expect(sampler?.manifest_id).toBe(ENGINE_IDS.sampler);
        // native loads the master instance via GAIN (kind flag marks it master).
        expect(master?.manifest_id).toBe(ENGINE_IDS.gain);
    });

    it('maps Subtract + effect kinds to their REAL loaders (not gain) on BOTH backends', () => {
        // Direct IR: the seam where the loader is chosen. A Subtract or an effect
        // kind must NOT collapse to builtin.gain (that made subtract == passthrough
        // and silenced every native effect).
        const graph: OjGraph = {
            ir_version: 1,
            sample_rate: 48_000,
            block_size: 128,
            nodes: [
                { id: 1, manifest_id: 'builtin.subtract', kind: 'Subtract', params: [], assets: [], n_in: 2, n_out: 1 },
                { id: 2, manifest_id: 'builtin.effect', kind: 'Biquad', params: [], assets: [], n_in: 1, n_out: 1 },
                { id: 3, manifest_id: 'builtin.effect', kind: 'Waveshaper', params: [], assets: [], n_in: 1, n_out: 1 },
                { id: 4, manifest_id: 'builtin.effect', kind: 'Convolution', params: [], assets: [], n_in: 1, n_out: 1 },
                { id: 5, manifest_id: 'builtin.effect', kind: 'Delay', params: [], assets: [], n_in: 1, n_out: 1 },
                { id: 6, manifest_id: 'builtin.speaker', kind: 'SpeakerOut', params: [], assets: [], n_in: 1, n_out: 0 },
            ],
            edges: [],
            schedule: [],
        };
        for (const backend of ['native', 'wasm'] as const) {
            const g = remapForBackend(graph, backend);
            const idOf = (k: string) => g.nodes.find((n) => n.kind === k)!.manifest_id;
            expect(idOf('Subtract'), `${backend} Subtract`).toBe(ENGINE_IDS.subtract);
            expect(idOf('Biquad'), `${backend} Biquad`).toBe(ENGINE_IDS.biquad);
            expect(idOf('Waveshaper'), `${backend} Waveshaper`).toBe(ENGINE_IDS.waveshaper);
            expect(idOf('Convolution'), `${backend} Convolution`).toBe(ENGINE_IDS.convolution);
            expect(idOf('Delay'), `${backend} Delay`).toBe(ENGINE_IDS.delay);
            // None collapsed to the gain placeholder.
            expect(idOf('Subtract')).not.toBe(ENGINE_IDS.gain);
        }
    });

    it('maps the Looper kind to its REAL kernel (not gain) on BOTH backends', () => {
        // REGRESSION: the looper kind had no remap case, so it fell through to the
        // gain placeholder. A Gain instance no-ops looper_action/looper_snapshot, so
        // pressing record did absolutely nothing and the engine emitted no transport
        // frame — on native AND wasm. The looper is registered on both registries
        // (register_builtins, effects-on), so it must load builtin.looper.
        const graph: OjGraph = {
            ir_version: 1,
            sample_rate: 48_000,
            block_size: 128,
            nodes: [
                { id: 1, manifest_id: 'builtin.looper', kind: 'Looper', params: [], assets: [], n_in: 1, n_out: 1 },
                { id: 2, manifest_id: 'builtin.speaker', kind: 'SpeakerOut', params: [], assets: [], n_in: 1, n_out: 0 },
            ],
            edges: [],
            schedule: [],
        };
        for (const backend of ['native', 'wasm'] as const) {
            const g = remapForBackend(graph, backend);
            const looper = g.nodes.find((n) => n.kind === 'Looper')!;
            expect(looper.manifest_id, `${backend} Looper`).toBe(ENGINE_IDS.looper);
            expect(looper.manifest_id, `${backend} Looper not gain`).not.toBe(ENGINE_IDS.gain);
        }
    });
});

// ---------------------------------------------------------------------------
// The gain-fallback trap guard. `manifestIdForKind` returns builtin.gain for any
// kind it has no case for — a UNITY PASSTHROUGH that silently NO-OPs the node.
// This bit Looper, Subtract, every effect, and would have bitten Multiply: a real
// kernel exists and is registered, but the remap drops the node to gain before the
// engine sees it, so the feature does nothing with every test still green. This
// guard fails the moment a NEW processing kind is added without a remap case.
// ---------------------------------------------------------------------------

// Kinds that LEGITIMATELY load via the gain placeholder, per backend:
//  • Gain itself (it IS the gain kernel);
//  • the host-bridged extension kinds (FaustHost/WasmHost/PluginHost are registered
//    dynamically per-node, not by this static remap, and fall back to gain so an
//    unrunnable host node stays audible rather than failing the whole push);
//  • Recorder (a host-side master tap; the recorder NODE lowers to SpeakerOut, so
//    this kind is never actually emitted);
//  • on NATIVE only, the IO/master/routing kinds — the executor KIND-GATES them, so
//    the gain placeholder instance is never processed (wasm loads real host.* loaders
//    for these, so they must NOT be gain there).
const GAIN_FALLBACK_OK: Record<EngineBackend, ReadonlySet<PrimitiveKind>> = {
    native: new Set<PrimitiveKind>([
        'Gain', 'FaustHost', 'WasmHost', 'PluginHost', 'Recorder',
        'MicIn', 'SpeakerOut', 'GraphIn', 'GraphOut', 'Passthrough',
    ]),
    wasm: new Set<PrimitiveKind>(['Gain', 'FaustHost', 'WasmHost', 'PluginHost', 'Recorder']),
};

describe('backendMap — no audio kind silently no-ops via the gain fallback', () => {
    for (const backend of ['native', 'wasm'] as const) {
        it(`${backend}: every processing kind maps to a real loader, never builtin.gain`, () => {
            const trapped: string[] = [];
            for (const kind of PRIMITIVE_KINDS) {
                const graph: OjGraph = {
                    ir_version: 1,
                    sample_rate: 48_000,
                    block_size: 128,
                    nodes: [{ id: 1, manifest_id: 'x', kind, params: [], assets: [], n_in: 1, n_out: 1 }],
                    edges: [],
                    schedule: [],
                };
                const id = remapForBackend(graph, backend).nodes[0].manifest_id;
                if (id === ENGINE_IDS.gain && !GAIN_FALLBACK_OK[backend].has(kind)) trapped.push(kind);
            }
            expect(
                trapped,
                `these kinds silently no-op via the builtin.gain fallback on ${backend} — add a manifestIdForKind case + ENGINE_IDS entry (the looper/subtract/effects/multiply trap). If a kind is intentionally gain-backed, allowlist it in GAIN_FALLBACK_OK.`,
            ).toEqual([]);
        });
    }
});
