/**
 * OjGraph emitter (U17) — graphStore state -> ojproto `OjGraph`.
 *
 * This is the correctness-critical seam of the engine cutover: it lowers the
 * VISUAL node graph (the flat `graphStore` model of `GraphNode`s + `Connection`s,
 * with bundles and hierarchy) into the FLAT compiled IR (`OjGraph`) the native
 * (`src-tauri`) and wasm (`ojcore-wasm`) engines compile and run.
 *
 * It is a PURE function: same inputs -> same `OjGraph`, no side effects, no
 * store/DOM/audio access. That is what makes it unit-testable (and what the
 * tests in `__tests__/emit.test.ts` pin).
 *
 * ── Correctness contract ─────────────────────────────────────────────────────
 * The emitted dataflow must equal the EFFECTIVE Web Audio routing
 * `AudioGraphManager` builds, so the two backends sound the same (this is an
 * A/B cutover). Concretely:
 *
 *   • Only AUDIO signal flow becomes engine routing. `AudioGraphManager`
 *     `syncConnections` connects only `type === 'audio'` connections between
 *     audio nodes; keyboard / MIDI -> instrument connections are CONTROL edges
 *     that drive note triggering (RtCommands), not audio wires. We mirror that:
 *     audio edges become audio `IrEdge`s between audio IrNodes; control edges
 *     are emitted as control `IrEdge`s only when BOTH endpoints survive as
 *     IrNodes (e.g. an amplifier's `gain-in`), and are otherwise dropped (the
 *     control endpoint is a keyboard/MIDI/visual node with no IrNode).
 *
 *   • HIERARCHY + BUNDLES are FLATTENED. Purely-structural nodes
 *     (`canvas-input`/`canvas-output`/`input-panel`/`output-panel`/`container`/
 *     visual mirrors / keyboard / midi) carry no DSP — `AudioGraphManager`
 *     passes audio THROUGH them (parent input -> internal canvas-input output,
 *     internal canvas-output input -> parent output, container is a unity gain).
 *     We collapse those passthroughs: an audio edge that enters a structural
 *     node is rewired to the real audio IrNode(s) reachable downstream, so the
 *     flat IR contains only DSP/IO nodes and direct edges between them.
 *
 *   • Exactly ONE master `SpeakerOut`. `ojcore::compile` requires exactly one
 *     master-output node. Speaker / recorder nodes lower to `SpeakerOut`; if a
 *     patch has several (or none but does have audio output), we SYNTHESIZE a
 *     single master `SpeakerOut` and feed every speaker/terminal audio source
 *     into it, so the program always compiles.
 *
 *   • Params carry through from `node.data` via the manifest `ParamDecl[]`
 *     (the same derivation U11's manifest exposes), addressed by the decl `id`.
 */

import type { Connection, GraphNode, NodeType, PortDefinition } from '../../engine/types';
import {
    manifestFor,
    manifestForDynamic,
    type ParamDecl,
    type PluginManifest,
    type PrimitiveKind,
} from '../../engine/manifest';
import { AI_WASM_ID_PREFIX, getDynamicPlugin } from '../../engine/dynamicRegistry';
import { instrumentUsesKarplus } from '../defaultInstrument';
import type {
    ConnectionType,
    IrEdge,
    IrNode,
    NodeIdx,
    OjGraph,
    Param,
} from '../../../packages/oj-protocol-ts/src/index';
import { SCHEMA_VERSION } from '../../../packages/oj-protocol-ts/src/index';

/** Manifest id of the synthesized master sink (used when none/many speakers). */
export const SYNTHETIC_MASTER_ID = 'builtin.speaker' as const;

/** Default render config; the engine host overrides these to its own rate/quantum. */
const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_BLOCK_SIZE = 128;

/** Options for {@link emitOjGraph}. */
export interface EmitOptions {
    /** Target sample rate (Hz). Defaults to 48000; the engine may override. */
    sampleRate?: number;
    /** Render block size (frames). Defaults to 128; the engine may override. */
    blockSize?: number;
    /**
     * When set, an AI-authored COMPILED code node (its `pluginId` is
     * `ai.wasm.<hash>` with a registered dynamic def) lowers to its real `WasmHost`
     * manifest so the engine runs the actual DSP, instead of the closed `effect`
     * fallback. Only the NATIVE executor sets this (it registers a WasmHost loader
     * per authored node); the browser/default path keeps the audible effect
     * fallback, so an unrunnable `WasmHost` node never reaches a loader-less engine.
     */
    codeNodesAsWasmHost?: boolean;
}

/**
 * PrimitiveKinds that are master-output sinks. A graph must lower to exactly one
 * of these (we synthesize one if the patch has zero or more than one).
 */
const MASTER_KINDS: ReadonlySet<PrimitiveKind> = new Set<PrimitiveKind>(['SpeakerOut', 'GraphOut']);

/**
 * PrimitiveKinds with NO DSP and no IO identity in the flat IR — purely
 * structural / routing nodes that audio passes THROUGH. These never become an
 * IrNode; their audio edges are flattened across them. (`Passthrough`/`GraphIn`/
 * `GraphOut` from the manifest's "non-audio" set, plus visual/control nodes that
 * the manifest maps to `Passthrough` by omission.)
 */
const STRUCTURAL_KINDS: ReadonlySet<PrimitiveKind> = new Set<PrimitiveKind>([
    'Passthrough',
    'GraphIn',
    'GraphOut',
]);

/**
 * Node TYPES that are purely structural in the AUDIO dataflow regardless of the
 * kind the manifest assigns — keyboards/MIDI emit control, visual mirrors and
 * panels/canvas-io/containers pass audio through. These are flattened.
 */
const STRUCTURAL_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
    'keyboard',
    'keyboard-key',
    'keyboard-visual',
    'instrument-visual',
    'sampler-visual',
    'midi',
    'midi-visual',
    'minilab-3',
    'minilab3-visual',
    'canvas-input',
    'canvas-output',
    'input-panel',
    'output-panel',
    'container',
]);

/** Resolved view of one emitted IrNode plus the source GraphNode/manifest. */
interface EmittedNode {
    idx: NodeIdx;
    node: GraphNode;
    manifest: PluginManifest;
    kind: PrimitiveKind;
}

/**
 * The interning produced by an emit: every SURVIVING (audio DSP/IO) GraphNode id
 * -> its `NodeIdx` in the emitted graph. The same deterministic mapping the
 * emitter uses, exposed so the executors can resolve a target GraphNode id (e.g.
 * an instrument resolved from a keyboard press) to the `NodeIdx` an `RtCommand`
 * must address. Structural / flattened nodes are absent (they have no IrNode).
 */
export type NodeIdxMap = Map<string, NodeIdx>;

/**
 * Lower a visual node graph (graphStore state) to a flat, compile-ready
 * {@link OjGraph}. Pure — depends only on the inputs.
 *
 * @param nodes        All graph nodes (flat, all hierarchy levels).
 * @param connections  All connections (flat, all hierarchy levels).
 * @param opts         Render config overrides.
 */
export function emitOjGraph(
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>,
    opts: EmitOptions = {},
): OjGraph {
    return emitWithIndex(nodes, connections, opts).graph;
}

/** Result of {@link emitWithIndex}: the emitted graph + the id->NodeIdx map. */
export interface EmitResult {
    graph: OjGraph;
    /** Surviving GraphNode id -> its `NodeIdx` in `graph` (see {@link NodeIdxMap}). */
    index: NodeIdxMap;
}

/**
 * Like {@link emitOjGraph}, but also returns the deterministic GraphNode id ->
 * `NodeIdx` interning the executors need to address `RtCommand`s at the right
 * node. Pure.
 */
export function emitWithIndex(
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>,
    opts: EmitOptions = {},
): EmitResult {
    const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const blockSize = opts.blockSize ?? DEFAULT_BLOCK_SIZE;

    // 1) Deterministic id interning. Sort node ids so the same patch always
    //    interns to the same NodeIdx mapping (test- and diff-stable).
    const sortedIds = Array.from(nodes.keys()).sort();

    // 2) Classify every node: which become IrNodes (audio DSP/IO) vs which are
    //    structural passthroughs that get flattened.
    const codeNodesAsWasmHost = opts.codeNodesAsWasmHost ?? false;
    const manifestByType = new Map<NodeType, PluginManifest>();
    const manifestOf = (type: NodeType): PluginManifest => {
        let m = manifestByType.get(type);
        if (!m) {
            m = manifestFor(type);
            manifestByType.set(type, m);
        }
        return m;
    };
    /**
     * The manifest used to BUILD a node's IrNode. An AI-authored compiled code node
     * (`pluginId === ai.wasm.<hash>` + a registered dynamic def) resolves to its
     * real `WasmHost` manifest WHEN `codeNodesAsWasmHost` is set, so the engine runs
     * the actual DSP; otherwise it keeps its closed `type` (the effect fallback).
     */
    const manifestForNode = (node: GraphNode): PluginManifest => {
        const pid = node.pluginId;
        if (codeNodesAsWasmHost && pid && pid.startsWith(AI_WASM_ID_PREFIX)) {
            const def = getDynamicPlugin(pid);
            if (def) return manifestForDynamic(pid, def);
        }
        return manifestOf(node.type);
    };
    const kindOf = (type: NodeType): PrimitiveKind | undefined => manifestOf(type).kind;

    const isStructural = (node: GraphNode): boolean => {
        if (STRUCTURAL_TYPES.has(node.type)) return true;
        const kind = kindOf(node.type);
        // Unmapped (kind === undefined) lowers to Passthrough -> structural.
        if (kind === undefined) return true;
        return STRUCTURAL_KINDS.has(kind);
    };

    // 3) Assign NodeIdx to every surviving (non-structural) node.
    const emitted = new Map<string, EmittedNode>();
    let nextIdx = 0;
    for (const id of sortedIds) {
        const node = nodes.get(id);
        if (!node) continue;
        if (isStructural(node)) continue;
        const manifest = manifestForNode(node);
        // kind is defined here (structural check above filters undefined kinds).
        let kind = manifest.kind as PrimitiveKind;
        // Plucked-string / bass instruments lower to the engine's real Karplus
        // physical-model primitive instead of the additive sampler (a guitar is
        // plucked live, per note). The executors skip sample-binding these.
        if (kind === 'Sampler' && instrumentUsesKarplus(node.type, node.data as Record<string, unknown> | undefined)) {
            kind = 'KarplusString';
        }
        emitted.set(id, { idx: nextIdx as NodeIdx, node, manifest, kind });
        nextIdx++;
    }

    // 4) Decide the master output.
    //    Collect surviving master nodes; if exactly one, use it. Otherwise we
    //    synthesize a single SpeakerOut master and feed terminals into it.
    const masters: EmittedNode[] = [];
    for (const e of emitted.values()) {
        if (MASTER_KINDS.has(e.kind)) masters.push(e);
    }
    masters.sort((a, b) => a.idx - b.idx);

    let syntheticMaster: NodeIdx | null = null;
    if (masters.length !== 1) {
        // Zero or multiple speakers -> synthesize one canonical master.
        syntheticMaster = nextIdx as NodeIdx;
        nextIdx++;
    }

    // 5) Build IrNodes (params from data via manifest decls, ports from manifest).
    //    When we SYNTHESIZE a master (zero or multiple speakers), the real
    //    speaker/recorder nodes must NOT remain `SpeakerOut` — `ojcore::compile`
    //    allows exactly ONE master. Demote them to `Passthrough` (1-in/1-out)
    //    that forwards into the synthetic master, so the program has a single
    //    master and the speakers still pass audio.
    const demoteMasters = syntheticMaster !== null;
    const irNodes: IrNode[] = [];
    for (const id of sortedIds) {
        const e = emitted.get(id);
        if (!e) continue;
        const demote = demoteMasters && MASTER_KINDS.has(e.kind);
        irNodes.push(buildIrNode(e, demote));
    }
    if (syntheticMaster !== null) {
        irNodes.push({
            id: syntheticMaster,
            manifest_id: SYNTHETIC_MASTER_ID,
            kind: 'SpeakerOut',
            params: [],
            assets: [],
            n_in: 1,
            n_out: 0,
        });
    }

    // 6) Flatten + resolve edges.
    const edges = buildEdges({
        nodes,
        connections,
        emitted,
        masters,
        syntheticMaster,
    });

    // The id -> NodeIdx interning (surviving nodes only).
    const index: NodeIdxMap = new Map();
    for (const [id, e] of emitted) index.set(id, e.idx);

    // `schedule` is recomputed by the compiler; emit empty (the compiler's
    // canonical topo order is authoritative). Mirrors the host bootstrap graphs.
    const graph: OjGraph = {
        ir_version: SCHEMA_VERSION,
        sample_rate: sampleRate,
        block_size: blockSize,
        nodes: irNodes,
        edges,
        schedule: [],
    };
    return { graph, index };
}

/**
 * Build one IrNode from an emitted (surviving) node. When `demoteMaster` is set
 * (a synthetic master is in use), a master-kind node is emitted as a 1-in/1-out
 * `Passthrough` instead of `SpeakerOut`, so only the synthetic master remains.
 */
function buildIrNode(e: EmittedNode, demoteMaster: boolean): IrNode {
    const { idx, node, manifest } = e;
    const params = paramsFromData(node, manifest.params);
    if (demoteMaster) {
        return {
            id: idx,
            manifest_id: manifest.id,
            kind: 'Passthrough',
            params,
            assets: [],
            n_in: 1,
            n_out: 1,
        };
    }
    const { n_in, n_out } = portCounts(manifest);
    return {
        id: idx,
        manifest_id: manifest.id,
        kind: e.kind,
        params,
        assets: [],
        n_in,
        n_out,
    };
}

/**
 * Resolve numeric params from `node.data` against the manifest `ParamDecl[]`.
 * A decl whose name is present (and finite-numeric) in `data` carries its live
 * value; otherwise the decl default is used. Addressed by the decl `id` (u16).
 */
function paramsFromData(node: GraphNode, decls: ParamDecl[]): Param[] {
    const out: Param[] = [];
    for (const decl of decls) {
        const raw = node.data[decl.name];
        const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : decl.default;
        out.push({ id: decl.id, value });
    }
    return out;
}

/**
 * Port counts for the flat IR. The IR distinguishes only audio in/out (the
 * routed signal); control ports are addressed by param/command, not by routed
 * buffers. We size `n_in`/`n_out` to the manifest's audio port counts, with a
 * floor that matches each kind's DSP arity so a node always has a routable
 * input/output where the kernel expects one.
 */
function portCounts(manifest: PluginManifest): { n_in: number; n_out: number } {
    const kind = manifest.kind;
    const audioIn = manifest.ports.audio_in;
    const audioOut = manifest.ports.audio_out;

    // Floors per primitive kind (mirrors the host loaders' declared arity).
    let minIn = 0;
    let minOut = 0;
    switch (kind) {
        // Generators / instruments: source only.
        case 'Osc':
        case 'Sampler':
        case 'Sf2':
        case 'KarplusString':
        case 'MicIn':
            minIn = 0;
            minOut = 1;
            break;
        // Processors: one in, one out.
        case 'Gain':
        case 'Biquad':
        case 'Waveshaper':
        case 'Delay':
        case 'Convolution':
        case 'FaustHost':
        case 'WasmHost':
        case 'PluginHost':
            minIn = 1;
            minOut = 1;
            break;
        // Mixer: two in, one out.
        case 'Add':
            minIn = 2;
            minOut = 1;
            break;
        // Master sinks: one in, no out.
        case 'SpeakerOut':
        case 'GraphOut':
            minIn = 1;
            minOut = 0;
            break;
        default:
            minIn = 0;
            minOut = 0;
            break;
    }
    return {
        n_in: Math.max(minIn, audioIn),
        n_out: Math.max(minOut, audioOut),
    };
}

interface BuildEdgesArgs {
    nodes: Map<string, GraphNode>;
    connections: Map<string, Connection>;
    emitted: Map<string, EmittedNode>;
    masters: EmittedNode[];
    syntheticMaster: NodeIdx | null;
}

/**
 * Resolve all connections into flat IrEdges, flattening structural passthroughs
 * and routing terminals into the (possibly synthesized) master.
 */
function buildEdges(args: BuildEdgesArgs): IrEdge[] {
    const { nodes, connections, emitted, masters, syntheticMaster } = args;

    // Index outgoing connections by source node for downstream traversal.
    const outBySource = new Map<string, Connection[]>();
    for (const conn of connections.values()) {
        const list = outBySource.get(conn.sourceNodeId);
        if (list) list.push(conn);
        else outBySource.set(conn.sourceNodeId, [conn]);
    }

    // Dedupe identical resolved edges (flattening can produce duplicates).
    const seen = new Set<string>();
    const edges: IrEdge[] = [];
    const pushEdge = (e: IrEdge): void => {
        const key = `${e.from_node}:${e.from_port}->${e.to_node}:${e.to_port}:${e.kind}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push(e);
    };

    /**
     * Given a connection arriving at `targetNodeId:targetPortId`, resolve it to
     * the real downstream IrNode input(s), flattening across structural nodes.
     * Returns the list of `(toNodeIdx, toPort)` sinks.
     */
    const resolveSinks = (
        targetNodeId: string,
        targetPortId: string,
        visited: Set<string>,
    ): Array<{ to: NodeIdx; toPort: number }> => {
        const target = nodes.get(targetNodeId);
        if (!target) return [];

        const e = emitted.get(targetNodeId);
        if (e) {
            // Real Ir sink: map the target port to an audio input index.
            return [{ to: e.idx, toPort: audioPortIndex(target, targetPortId, 'input') }];
        }

        // Structural node: flatten THROUGH it. Audio entering a passthrough/
        // canvas-input/panel/container continues to whatever its outputs feed.
        if (visited.has(targetNodeId)) return []; // cycle guard
        visited.add(targetNodeId);

        const sinks: Array<{ to: NodeIdx; toPort: number }> = [];
        const downstream = outBySource.get(targetNodeId) ?? [];
        for (const conn of downstream) {
            // Only audio flows through (control is triggered, not routed).
            if (resolveConnKind(conn, nodes) !== 'Audio') continue;
            sinks.push(...resolveSinks(conn.targetNodeId, conn.targetPortId, visited));
        }
        return sinks;
    };

    // Emit edges for every connection whose SOURCE is a real IrNode.
    for (const conn of connections.values()) {
        const sourceEmitted = emitted.get(conn.sourceNodeId);
        if (!sourceEmitted) continue; // structural source: handled via sink-side flatten

        const source = nodes.get(conn.sourceNodeId);
        if (!source) continue;

        const kind = resolveConnKind(conn, nodes);

        if (kind === 'Audio') {
            const fromPort = audioPortIndex(source, conn.sourcePortId, 'output');
            const sinks = resolveSinks(
                conn.targetNodeId,
                conn.targetPortId,
                new Set([conn.sourceNodeId]),
            );
            for (const sink of sinks) {
                pushEdge({
                    from_node: sourceEmitted.idx,
                    from_port: fromPort,
                    to_node: sink.to,
                    to_port: sink.toPort,
                    kind: 'Audio',
                });
            }
        } else {
            // Control edge: only meaningful if the TARGET is also a real IrNode
            // with a control surface (e.g. amplifier gain-in). Otherwise the
            // target is a keyboard/visual/instrument-bundle endpoint driven by
            // RtCommands, not a routed buffer — drop it.
            const targetEmitted = emitted.get(conn.targetNodeId);
            if (!targetEmitted) continue;
            pushEdge({
                from_node: sourceEmitted.idx,
                from_port: 0,
                to_node: targetEmitted.idx,
                to_port: 0,
                kind: 'Control',
            });
        }
    }

    // Master synthesis: if we synthesized a master, feed every speaker/terminal
    // audio source into it so the program has exactly one master with input.
    if (syntheticMaster !== null) {
        // (a) Real masters (speaker/recorder) -> route their resolved audio into
        //     the synthetic master, treating each real master as a passthrough.
        for (const m of masters) {
            pushEdge({
                from_node: m.idx,
                from_port: 0,
                to_node: syntheticMaster,
                to_port: 0,
                kind: 'Audio',
            });
        }

        // (b) With NO real master, dangling audio terminals (audio output, no
        //     outgoing audio edge) -> synthetic master, so a speaker-less patch
        //     still produces output.
        if (masters.length === 0) {
            const hasOutgoingAudio = new Set<NodeIdx>();
            for (const e of edges) {
                if (e.kind === 'Audio') hasOutgoingAudio.add(e.from_node);
            }
            for (const e of emitted.values()) {
                if (MASTER_KINDS.has(e.kind)) continue;
                const { n_out } = portCounts(e.manifest);
                if (n_out > 0 && !hasOutgoingAudio.has(e.idx)) {
                    pushEdge({
                        from_node: e.idx,
                        from_port: 0,
                        to_node: syntheticMaster,
                        to_port: 0,
                        kind: 'Audio',
                    });
                }
            }
        }
    }

    return edges;
}

/**
 * Resolve a connection's effective {@link ConnectionType} for the IR. The visual
 * model has a third `universal` type that math nodes adapt; resolve it to the
 * concrete type the same way `graphStore` does (prefer the resolved type stored
 * on the math node, else infer from the non-universal endpoint, else control).
 */
function resolveConnKind(conn: Connection, nodes: Map<string, GraphNode>): ConnectionType {
    if (conn.type === 'audio') return 'Audio';
    if (conn.type === 'control') return 'Control';

    // universal: look for a resolvedType on either math endpoint's data.
    const source = nodes.get(conn.sourceNodeId);
    const target = nodes.get(conn.targetNodeId);
    const srcResolved = (source?.data as { resolvedType?: 'audio' | 'control' | null } | undefined)
        ?.resolvedType;
    const tgtResolved = (target?.data as { resolvedType?: 'audio' | 'control' | null } | undefined)
        ?.resolvedType;
    const resolved = srcResolved ?? tgtResolved;
    if (resolved === 'audio') return 'Audio';
    if (resolved === 'control') return 'Control';

    // Fall back: infer from the concrete type of either endpoint port.
    const srcPort = findPort(source, conn.sourcePortId);
    const tgtPort = findPort(target, conn.targetPortId);
    const concrete = portConcreteType(srcPort) ?? portConcreteType(tgtPort);
    return concrete === 'audio' ? 'Audio' : 'Control';
}

function portConcreteType(port: PortDefinition | undefined): 'audio' | 'control' | undefined {
    if (!port) return undefined;
    if (port.type === 'audio') return 'audio';
    if (port.type === 'control') return 'control';
    if (port.resolvedType === 'audio') return 'audio';
    if (port.resolvedType === 'control') return 'control';
    return undefined;
}

/**
 * Find a port on a node by id. Handles the composite `panelId:portId` form the
 * bundle-expansion path stores on connections by matching either the whole id
 * or its trailing component.
 */
function findPort(node: GraphNode | undefined, portId: string): PortDefinition | undefined {
    if (!node) return undefined;
    const direct = node.ports.find((p) => p.id === portId);
    if (direct) return direct;
    const tail = portId.includes(':') ? portId.slice(portId.indexOf(':') + 1) : portId;
    return node.ports.find((p) => p.id === tail);
}

/**
 * Map a node port id to its AUDIO port INDEX (the index the flat IR routes by).
 * The index is the position of this port among the node's same-direction AUDIO
 * ports (universal ports resolved to audio count too). Non-audio or unknown
 * ports fall back to index 0 (the canonical single audio port), which matches
 * the single-in/single-out arity of every processor and the multi-in `Add`
 * convention (`in-1` -> 0, `in-2` -> 1).
 */
function audioPortIndex(
    node: GraphNode,
    portId: string,
    direction: 'input' | 'output',
): number {
    const tail = portId.includes(':') ? portId.slice(portId.indexOf(':') + 1) : portId;

    // Special-case the math `Add`/`Subtract` two-input convention used by
    // AudioGraphManager (`in-2` is the second input).
    if (direction === 'input') {
        if (tail === 'in-2') return 1;
        if (tail === 'in-1') return 0;
    }

    const audioPorts = node.ports.filter(
        (p) =>
            p.direction === direction &&
            (p.type === 'audio' || (p.type === 'universal' && p.resolvedType === 'audio')),
    );
    const i = audioPorts.findIndex((p) => p.id === portId || p.id === tail);
    return i >= 0 ? i : 0;
}
