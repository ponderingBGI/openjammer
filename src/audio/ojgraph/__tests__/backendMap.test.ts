/**
 * Backend remap tests (U17) — ensure every emitted IrNode lowers to a manifest
 * id the target engine registry actually contains, so the pushed graph compiles
 * instead of erroring with `UnknownManifest`.
 */

import { describe, expect, it } from 'vitest';
import { emitOjGraph } from '../emit';
import { remapForBackend, ENGINE_IDS } from '../backendMap';
import { getNodeDefinition } from '../../../engine/registry';
import type { Connection, GraphNode, NodeType } from '../../../engine/types';

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

const NATIVE_REGISTRY = new Set<string>([
    ENGINE_IDS.gain,
    ENGINE_IDS.osc,
    ENGINE_IDS.sampler,
    ENGINE_IDS.karplus,
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
    ENGINE_IDS.add,
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
    const amp = makeNode('amplifier', 'amp');
    const spk = makeNode('speaker', 'spk');
    const conns = [
        makeConn('kb', 'bundle-out', 'inst', 'bundle-in', 'control'),
        makeConn('inst', 'audio-out', 'fx', 'audio-in', 'audio'),
        makeConn('fx', 'audio-out', 'amp', 'audio-in', 'audio'),
        makeConn('amp', 'audio-out', 'spk', 'audio-in', 'audio'),
    ];
    return emitOjGraph(
        new Map([kb, inst, fx, amp, spk].map((n) => [n.id, n])),
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
});
