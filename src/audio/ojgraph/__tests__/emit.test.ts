/**
 * Emitter unit tests (U17) — the correctness gate for the engine cutover.
 *
 * These pin that {@link emitOjGraph} lowers a visual graphStore patch to the
 * exact flat `OjGraph` IR the native / wasm engines expect: the right IrNodes
 * (kinds + params + arity), the right flattened IrEdges (audio dataflow == the
 * effective Web Audio routing), exactly one master output, and that bundles /
 * hierarchy collapse correctly.
 *
 * Nodes are built from the REAL registry definitions (`getNodeDefinition`) so
 * ports and default data match what the app actually produces.
 */

import { describe, expect, it } from 'vitest';
import { emitOjGraph, SYNTHETIC_MASTER_ID } from '../emit';
import { remapForBackend } from '../backendMap';
import { getNodeDefinition } from '../../../engine/registry';
import { manifestIdFor } from '../../../engine/manifest';
import type { Connection, GraphNode, NodeType, PortDefinition } from '../../../engine/types';
import type { IrEdge, IrNode, OjGraph } from '../../../../packages/oj-protocol-ts/src/index';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

let counter = 0;
function freshId(prefix: string): string {
    counter += 1;
    return `${prefix}-${counter}`;
}

/** Build a GraphNode from the real registry definition (ports + default data). */
function makeNode(
    type: NodeType,
    overrides: { id?: string; data?: Record<string, unknown>; ports?: PortDefinition[]; parentId?: string | null } = {},
): GraphNode {
    const def = getNodeDefinition(type);
    return {
        id: overrides.id ?? freshId(type),
        type,
        category: def.category,
        position: { x: 0, y: 0 },
        data: { ...def.defaultData, ...(overrides.data ?? {}) },
        ports: overrides.ports ?? [...def.defaultPorts],
        parentId: overrides.parentId ?? null,
        childIds: [],
    };
}

function makeConn(
    sourceNodeId: string,
    sourcePortId: string,
    targetNodeId: string,
    targetPortId: string,
    type: 'audio' | 'control' | 'universal',
): Connection {
    return {
        id: freshId('conn'),
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId,
        type,
    };
}

function nodeMap(...nodes: GraphNode[]): Map<string, GraphNode> {
    return new Map(nodes.map((n) => [n.id, n]));
}

function connMap(...conns: Connection[]): Map<string, Connection> {
    return new Map(conns.map((c) => [c.id, c]));
}

function irById(graph: OjGraph, id: number): IrNode | undefined {
    return graph.nodes.find((n) => n.id === id);
}

function kindOfNodeId(graph: OjGraph, nodeId: number): string | undefined {
    return irById(graph, nodeId)?.kind;
}

function hasEdge(graph: OjGraph, fromKind: string, toKind: string): boolean {
    return graph.edges.some(
        (e: IrEdge) =>
            kindOfNodeId(graph, e.from_node) === fromKind &&
            kindOfNodeId(graph, e.to_node) === toKind &&
            e.kind === 'Audio',
    );
}

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

describe('emitOjGraph — basic shape', () => {
    it('emits a valid empty-ish graph with a synthesized master when no speaker', () => {
        const graph = emitOjGraph(new Map(), new Map());
        // No real nodes -> one synthetic SpeakerOut master so it compiles.
        const masters = graph.nodes.filter((n) => n.kind === 'SpeakerOut' || n.kind === 'GraphOut');
        expect(masters).toHaveLength(1);
        expect(masters[0].manifest_id).toBe(SYNTHETIC_MASTER_ID);
        expect(graph.ir_version).toBeGreaterThanOrEqual(1);
        expect(graph.schedule).toEqual([]);
    });

    it('honours sampleRate / blockSize options', () => {
        const graph = emitOjGraph(new Map(), new Map(), { sampleRate: 44_100, blockSize: 256 });
        expect(graph.sample_rate).toBe(44_100);
        expect(graph.block_size).toBe(256);
    });

    it('is deterministic across runs (same node ids -> same NodeIdx mapping)', () => {
        const piano = makeNode('piano', { id: 'aaa' });
        const speaker = makeNode('speaker', { id: 'bbb' });
        const conn = makeConn(piano.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        const nodes = nodeMap(piano, speaker);
        const conns = connMap(conn);
        const a = emitOjGraph(nodes, conns);
        const b = emitOjGraph(nodes, conns);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});

// ---------------------------------------------------------------------------
// The canonical keyboard -> instrument -> effect -> speaker patch
// ---------------------------------------------------------------------------

describe('emitOjGraph — keyboard -> instrument -> effect -> speaker', () => {
    function buildPatch() {
        // keyboard (control source, NOT an audio node) -> instrument bundle-in
        const keyboard = makeNode('keyboard', { id: 'kb' });
        const instrument = makeNode('instrument', { id: 'inst' });
        const effect = makeNode('effect', { id: 'fx', data: { effectType: 'distortion', params: {} } });
        const speaker = makeNode('speaker', { id: 'spk' });

        const ctrl = makeConn(keyboard.id, 'bundle-out', instrument.id, 'bundle-in', 'control');
        const a1 = makeConn(instrument.id, 'audio-out', effect.id, 'audio-in', 'audio');
        const a2 = makeConn(effect.id, 'audio-out', speaker.id, 'audio-in', 'audio');

        return {
            nodes: nodeMap(keyboard, instrument, effect, speaker),
            conns: connMap(ctrl, a1, a2),
            ids: { keyboard, instrument, effect, speaker },
        };
    }

    it('emits exactly the audio IrNodes (instrument/effect/speaker), keyboard flattened away', () => {
        const { nodes, conns } = buildPatch();
        const graph = emitOjGraph(nodes, conns);

        const kinds = graph.nodes.map((n) => n.kind).sort();
        // instrument=Sampler, effect=Waveshaper, speaker=SpeakerOut. Keyboard is
        // a control source with no DSP -> no IrNode.
        expect(kinds).toEqual(['Sampler', 'SpeakerOut', 'Waveshaper']);
    });

    it('maps each node type to its manifest PrimitiveKind + manifest_id', () => {
        const { nodes, conns } = buildPatch();
        const graph = emitOjGraph(nodes, conns);

        const sampler = graph.nodes.find((n) => n.kind === 'Sampler');
        const waveshaper = graph.nodes.find((n) => n.kind === 'Waveshaper');
        const speaker = graph.nodes.find((n) => n.kind === 'SpeakerOut');

        expect(sampler?.manifest_id).toBe(manifestIdFor('instrument'));
        expect(waveshaper?.manifest_id).toBe(manifestIdFor('effect'));
        expect(speaker?.manifest_id).toBe(manifestIdFor('speaker'));
    });

    it('emits the audio dataflow Sampler -> Waveshaper -> SpeakerOut', () => {
        const { nodes, conns } = buildPatch();
        const graph = emitOjGraph(nodes, conns);

        expect(hasEdge(graph, 'Sampler', 'Waveshaper')).toBe(true);
        expect(hasEdge(graph, 'Waveshaper', 'SpeakerOut')).toBe(true);
        // No spurious audio edge straight from Sampler to SpeakerOut.
        expect(hasEdge(graph, 'Sampler', 'SpeakerOut')).toBe(false);
    });

    it('does NOT emit the keyboard control edge (no IrNode endpoint)', () => {
        const { nodes, conns } = buildPatch();
        const graph = emitOjGraph(nodes, conns);
        // The only edges are the two audio edges; no control edge survives
        // because the keyboard has no IrNode.
        expect(graph.edges.every((e) => e.kind === 'Audio')).toBe(true);
        expect(graph.edges).toHaveLength(2);
    });

    it('has exactly one master SpeakerOut (the real speaker, not synthesized)', () => {
        const { nodes, conns } = buildPatch();
        const graph = emitOjGraph(nodes, conns);
        const masters = graph.nodes.filter((n) => n.kind === 'SpeakerOut');
        expect(masters).toHaveLength(1);
        expect(masters[0].manifest_id).toBe(manifestIdFor('speaker'));
    });
});

// ---------------------------------------------------------------------------
// Params carry through
// ---------------------------------------------------------------------------

describe('emitOjGraph — params', () => {
    it('carries amplifier gain from node.data through the manifest decl', () => {
        const amp = makeNode('amplifier', { id: 'amp', data: { gain: 2.5 } });
        const speaker = makeNode('speaker', { id: 'spk' });
        const conn = makeConn(amp.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(amp, speaker), connMap(conn));

        const gainNode = graph.nodes.find((n) => n.kind === 'Gain');
        expect(gainNode).toBeDefined();
        // amplifier defaultData has `gain` -> a single numeric ParamDecl id 0.
        const gainParam = gainNode!.params.find((p) => p.id === 0);
        expect(gainParam?.value).toBe(2.5);
    });

    it('uses the manifest default when data omits the param', () => {
        const amp = makeNode('amplifier', { id: 'amp', data: {} });
        // Force-remove the gain field so it falls back to the decl default (1).
        amp.data = {};
        const speaker = makeNode('speaker', { id: 'spk' });
        const conn = makeConn(amp.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(amp, speaker), connMap(conn));
        const gainNode = graph.nodes.find((n) => n.kind === 'Gain')!;
        expect(gainNode.params[0]?.value).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Master synthesis
// ---------------------------------------------------------------------------

describe('emitOjGraph — master output', () => {
    it('synthesizes ONE master for MULTIPLE speakers; real speakers demoted to Passthrough feeding it', () => {
        const piano = makeNode('piano', { id: 'p' });
        const spk1 = makeNode('speaker', { id: 's1' });
        const spk2 = makeNode('speaker', { id: 's2' });
        const a1 = makeConn(piano.id, 'audio-out', spk1.id, 'audio-in', 'audio');
        const a2 = makeConn(piano.id, 'audio-out', spk2.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(piano, spk1, spk2), connMap(a1, a2));

        // EXACTLY one SpeakerOut master (the synthesized one) — compile requires it.
        const speakerOuts = graph.nodes.filter((n) => n.kind === 'SpeakerOut');
        expect(speakerOuts).toHaveLength(1);
        expect(speakerOuts[0].manifest_id).toBe(SYNTHETIC_MASTER_ID);

        // The two real speakers are demoted to Passthrough (1-in/1-out).
        const passthroughs = graph.nodes.filter(
            (n) => n.kind === 'Passthrough' && n.manifest_id === manifestIdFor('speaker'),
        );
        expect(passthroughs).toHaveLength(2);
        for (const pt of passthroughs) {
            expect(pt.n_in).toBe(1);
            expect(pt.n_out).toBe(1);
        }

        // Both demoted speakers feed the synthetic master.
        const synthIdx = speakerOuts[0].id;
        const feedingSynth = graph.edges.filter(
            (e) => e.to_node === synthIdx && e.kind === 'Audio',
        );
        expect(feedingSynth.length).toBe(2);
        // And the piano feeds both passthroughs (audio flattens correctly).
        const sampler = graph.nodes.find((n) => n.kind === 'Sampler')!;
        const fromSampler = graph.edges.filter(
            (e) => e.from_node === sampler.id && e.kind === 'Audio',
        );
        expect(fromSampler.length).toBe(2);
    });

    it('synthesizes a master and routes a speaker-less audio terminal into it', () => {
        const piano = makeNode('piano', { id: 'p' });
        // No speaker at all.
        const graph = emitOjGraph(nodeMap(piano), new Map());
        const masters = graph.nodes.filter((n) => n.kind === 'SpeakerOut');
        expect(masters).toHaveLength(1);
        expect(masters[0].manifest_id).toBe(SYNTHETIC_MASTER_ID);
        // The dangling piano (Sampler, has audio out, no audio sink) is routed in.
        const sampler = graph.nodes.find((n) => n.kind === 'Sampler')!;
        expect(
            graph.edges.some(
                (e) => e.from_node === sampler.id && e.to_node === masters[0].id && e.kind === 'Audio',
            ),
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Hierarchy / container flattening
// ---------------------------------------------------------------------------

describe('emitOjGraph — hierarchy / bundle flattening', () => {
    it('flattens audio THROUGH a container (passthrough) node', () => {
        // piano -> container(audio-in passthrough) -> speaker, where the
        // container has an internal canvas-input feeding an internal canvas-output.
        const piano = makeNode('piano', { id: 'p' });
        const container = makeNode('container', { id: 'c' });
        const speaker = makeNode('speaker', { id: 's' });

        // Give the container ports so a connection can target/leave it.
        container.ports = [
            { id: 'in', name: 'In', type: 'audio', direction: 'input', position: { x: 0, y: 0.5 } },
            { id: 'out', name: 'Out', type: 'audio', direction: 'output', position: { x: 1, y: 0.5 } },
        ];

        const a1 = makeConn(piano.id, 'audio-out', container.id, 'in', 'audio');
        const a2 = makeConn(container.id, 'out', speaker.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(piano, container, speaker), connMap(a1, a2));

        // Container is structural -> no IrNode for it.
        expect(graph.nodes.some((n) => n.manifest_id === manifestIdFor('container'))).toBe(false);
        // Audio flattens straight from Sampler to SpeakerOut across the container.
        expect(hasEdge(graph, 'Sampler', 'SpeakerOut')).toBe(true);
    });

    it('flattens a multi-hop structural chain (canvas-input -> canvas-output)', () => {
        const piano = makeNode('piano', { id: 'p' });
        const cin = makeNode('canvas-input', { id: 'cin' });
        const cout = makeNode('canvas-output', { id: 'cout' });
        const speaker = makeNode('speaker', { id: 's' });

        // piano -> canvas-input.out -> canvas-output.in -> speaker
        const a1 = makeConn(piano.id, 'audio-out', cin.id, 'out', 'audio');
        const a2 = makeConn(cin.id, 'out', cout.id, 'in', 'audio');
        const a3 = makeConn(cout.id, 'in', speaker.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(piano, cin, cout, speaker), connMap(a1, a2, a3));

        expect(graph.nodes.map((n) => n.kind).sort()).toEqual(['Sampler', 'SpeakerOut']);
        expect(hasEdge(graph, 'Sampler', 'SpeakerOut')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Control edges between real IrNodes (e.g. amplifier gain modulation)
// ---------------------------------------------------------------------------

describe('emitOjGraph — control edges', () => {
    it('emits a control IrEdge when both endpoints are real IrNodes', () => {
        // microphone (MicIn, audio source) -> amplifier gain-in (control).
        const mic = makeNode('microphone', { id: 'mic' });
        const amp = makeNode('amplifier', { id: 'amp' });
        const speaker = makeNode('speaker', { id: 's' });

        const ctrl = makeConn(mic.id, 'audio-out', amp.id, 'gain-in', 'control');
        const audio = makeConn(amp.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(mic, amp, speaker), connMap(ctrl, audio));

        const controlEdges = graph.edges.filter((e) => e.kind === 'Control');
        expect(controlEdges).toHaveLength(1);
        const micIr = graph.nodes.find((n) => n.kind === 'MicIn')!;
        const ampIr = graph.nodes.find((n) => n.kind === 'Gain')!;
        expect(controlEdges[0].from_node).toBe(micIr.id);
        expect(controlEdges[0].to_node).toBe(ampIr.id);
    });
});

// ---------------------------------------------------------------------------
// Add / Subtract two-input mixing arity
// ---------------------------------------------------------------------------

describe('emitOjGraph — add node arity', () => {
    it('routes in-1 -> port 0 and in-2 -> port 1 of an Add node', () => {
        const a = makeNode('piano', { id: 'a' });
        const b = makeNode('piano', { id: 'b' });
        const add = makeNode('add', { id: 'add', data: { resolvedType: 'audio' } });
        // Mark the universal ports resolved to audio so they count as audio ports.
        add.ports = add.ports.map((p) => ({ ...p, resolvedType: 'audio' as const }));
        const speaker = makeNode('speaker', { id: 's' });

        const e1 = makeConn(a.id, 'audio-out', add.id, 'in-1', 'universal');
        const e2 = makeConn(b.id, 'audio-out', add.id, 'in-2', 'universal');
        const e3 = makeConn(add.id, 'out', speaker.id, 'audio-in', 'universal');
        const graph = emitOjGraph(nodeMap(a, b, add, speaker), connMap(e1, e2, e3));

        const addIr = graph.nodes.find((n) => n.kind === 'Add')!;
        const intoAdd = graph.edges.filter((e) => e.to_node === addIr.id && e.kind === 'Audio');
        const ports = intoAdd.map((e) => e.to_port).sort();
        expect(ports).toEqual([0, 1]);
        expect(addIr.n_in).toBeGreaterThanOrEqual(2);
    });
});

// ---------------------------------------------------------------------------
// Arity / port counts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Compile-readiness invariants (mirror crates/ojcore/src/compile.rs rules)
// ---------------------------------------------------------------------------

/**
 * Assert the structural rules `ojcore::compile` enforces, so a malformed emit is
 * caught here rather than as a runtime `CompileError` in the engine:
 *   - exactly one SpeakerOut/GraphOut master,
 *   - every edge endpoint is a real node id,
 *   - every audio edge port is within the endpoint's declared arity,
 *   - every audio edge source node has n_out > 0.
 */
function assertCompileReady(graph: OjGraph): void {
    const masters = graph.nodes.filter((n) => n.kind === 'SpeakerOut' || n.kind === 'GraphOut');
    expect(masters.length, 'exactly one master output').toBe(1);

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges) {
        const from = byId.get(e.from_node);
        const to = byId.get(e.to_node);
        expect(from, `edge from_node ${e.from_node} exists`).toBeDefined();
        expect(to, `edge to_node ${e.to_node} exists`).toBeDefined();
        if (e.kind === 'Audio') {
            expect(e.from_port, 'from_port in range').toBeLessThan(from!.n_out);
            expect(e.to_port, 'to_port in range').toBeLessThan(to!.n_in);
            expect(from!.n_out, 'audio source has an output').toBeGreaterThan(0);
        }
    }
}

describe('emitOjGraph — compile-readiness invariants', () => {
    it('a simple piano -> speaker patch is compile-ready', () => {
        const piano = makeNode('piano', { id: 'p' });
        const speaker = makeNode('speaker', { id: 's' });
        const conn = makeConn(piano.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        assertCompileReady(emitOjGraph(nodeMap(piano, speaker), connMap(conn)));
    });

    it('the full keyboard->instrument->effect->speaker patch is compile-ready', () => {
        const keyboard = makeNode('keyboard', { id: 'kb' });
        const instrument = makeNode('instrument', { id: 'inst' });
        const effect = makeNode('effect', { id: 'fx' });
        const speaker = makeNode('speaker', { id: 'spk' });
        const ctrl = makeConn(keyboard.id, 'bundle-out', instrument.id, 'bundle-in', 'control');
        const a1 = makeConn(instrument.id, 'audio-out', effect.id, 'audio-in', 'audio');
        const a2 = makeConn(effect.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        assertCompileReady(
            emitOjGraph(nodeMap(keyboard, instrument, effect, speaker), connMap(ctrl, a1, a2)),
        );
    });

    it('a multi-speaker patch (synthetic master) is compile-ready', () => {
        const piano = makeNode('piano', { id: 'p' });
        const s1 = makeNode('speaker', { id: 's1' });
        const s2 = makeNode('speaker', { id: 's2' });
        const a1 = makeConn(piano.id, 'audio-out', s1.id, 'audio-in', 'audio');
        const a2 = makeConn(piano.id, 'audio-out', s2.id, 'audio-in', 'audio');
        assertCompileReady(emitOjGraph(nodeMap(piano, s1, s2), connMap(a1, a2)));
    });

    it('an empty patch is compile-ready (lone synthetic master)', () => {
        assertCompileReady(emitOjGraph(new Map(), new Map()));
    });
});

describe('emitOjGraph — arity', () => {
    it('sources have n_out>=1 and n_in 0; processors 1/1; master 1/0', () => {
        const piano = makeNode('piano', { id: 'p' });
        const amp = makeNode('amplifier', { id: 'a' });
        const speaker = makeNode('speaker', { id: 's' });
        const a1 = makeConn(piano.id, 'audio-out', amp.id, 'audio-in', 'audio');
        const a2 = makeConn(amp.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        const graph = emitOjGraph(nodeMap(piano, amp, speaker), connMap(a1, a2));

        const sampler = graph.nodes.find((n) => n.kind === 'Sampler')!;
        const gain = graph.nodes.find((n) => n.kind === 'Gain')!;
        const spk = graph.nodes.find((n) => n.kind === 'SpeakerOut')!;

        expect(sampler.n_in).toBe(0);
        expect(sampler.n_out).toBeGreaterThanOrEqual(1);
        expect(gain.n_in).toBe(1);
        expect(gain.n_out).toBe(1);
        expect(spk.n_in).toBe(1);
        expect(spk.n_out).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// D1: the looper lowers to the real Looper primitive (not Delay), and remaps to
// the real `builtin.looper` loader on BOTH backends (it previously fell back to
// GAIN on native / DELAY on wasm, so looper nodes never actually looped).
// ---------------------------------------------------------------------------

describe('emitOjGraph — looper lowering (D1)', () => {
    function buildLooperPatch() {
        const instrument = makeNode('instrument', { id: 'inst' });
        const looper = makeNode('looper', { id: 'lp' });
        const speaker = makeNode('speaker', { id: 'spk' });
        const a1 = makeConn(instrument.id, 'audio-out', looper.id, 'audio-in', 'audio');
        const a2 = makeConn(looper.id, 'audio-out', speaker.id, 'audio-in', 'audio');
        return emitOjGraph(nodeMap(instrument, looper, speaker), connMap(a1, a2));
    }

    it('lowers a looper node to PrimitiveKind Looper with 1-in/1-out ports', () => {
        const graph = buildLooperPatch();
        const lp = graph.nodes.find((n) => n.kind === 'Looper');
        expect(lp, 'looper lowers to PrimitiveKind Looper, not Delay').toBeTruthy();
        // No node should be mislabeled as a Delay (the old `looper: 'Delay'` bug).
        expect(graph.nodes.some((n) => n.kind === 'Delay')).toBe(false);
        expect(lp!.n_in).toBeGreaterThanOrEqual(1);
        expect(lp!.n_out).toBeGreaterThanOrEqual(1);
    });

    it('emits NO IR params for the looper (its UI fields are not DSP params)', () => {
        // The looper's defaultData (duration/currentTime/…) is UI state, not DSP
        // params. Deriving params from it would misaddress the LooperNode ids
        // (LOOP_SECS=0, WET=1, DRY=2) — `currentTime`→id1 forces WET=0 and silences
        // loop playback. So the looper must carry no params and use the DSP node's
        // own defaults; it is driven by RtCommand::Looper transport actions instead.
        const graph = buildLooperPatch();
        const lp = graph.nodes.find((n) => n.kind === 'Looper');
        expect(lp).toBeTruthy();
        expect(lp!.params).toEqual([]);
    });

    it('remaps the looper to builtin.looper on BOTH backends (real loader, not a GAIN fallback)', () => {
        const graph = buildLooperPatch();
        for (const backend of ['native', 'wasm'] as const) {
            const remapped = remapForBackend(graph, backend);
            const lp = remapped.nodes.find((n) => n.kind === 'Looper');
            expect(lp, `looper present after ${backend} remap`).toBeTruthy();
            expect(lp!.manifest_id, `looper -> builtin.looper on ${backend}`).toBe('builtin.looper');
        }
    });
});
