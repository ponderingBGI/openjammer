/**
 * Workflow Serialization - Import/Export workflows as JSON
 */

import type {
    GraphNode,
    Connection,
    SerializedWorkflow,
    SerializedNode,
    SerializedConnection,
    PortDefinition
} from './types';
import { get as getNodeDefinition } from './registry';
import {
    HOSTED_PLUGIN_DESCRIPTOR_KEY,
    HOSTED_PLUGIN_ID_PREFIX,
    dspPluginIdFor,
    getDynamicPlugin,
    hostedPluginIdFor,
    makeDspNodeDefinition,
    makeHostedPluginDefinition,
    registerDynamicPlugin,
    type HostedPluginDescriptor,
} from './dynamicRegistry';

/**
 * Workflow schema version. MINOR-bumped to 1.1.0 for M5 (open node identity):
 * nodes may now carry a `pluginId` and old `effect`+`faustSource` AI nodes are
 * MIGRATED to first-class `pluginId` nodes on import.
 *
 * BACKWARD COMPAT: the import compat check only rejects on a MAJOR mismatch, so
 * every prior 1.x workflow still loads. The bump is a marker + a hook for the
 * load-time migrate step, NOT a hard gate.
 */
const WORKFLOW_VERSION = '1.1.0';

/**
 * Export the current graph state to a JSON-serializable workflow
 */
export function exportWorkflow(
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>,
    name: string = 'Untitled Workflow',
    /** The song-layer timeline to persist alongside the graph (FROZEN-3). OPAQUE here
     *  — the engine never interprets it; the song layer produces it via
     *  `arrangementForExport` and reads it back via `readArrangement`. Omit when there
     *  is no timeline. */
    arrangement?: unknown
): SerializedWorkflow {
    const serializedNodes: SerializedNode[] = [];
    const serializedConnections: SerializedConnection[] = [];

    // Serialize nodes
    nodes.forEach((node) => {
        const serialized: SerializedNode = {
            id: node.id,
            type: node.type,
            category: node.category,
            position: { ...node.position },
            data: JSON.parse(JSON.stringify(node.data)), // Deep clone to handle nested objects
            // Persist per-instance ports (U10) so dynamically-grown ports
            // (e.g. bundle expansions, panel ports) survive a round-trip rather
            // than being reset to the static defaultPorts on import.
            ports: JSON.parse(JSON.stringify(node.ports)) as PortDefinition[]
        };
        // Persist the OPEN identity (M5) when present so a dynamic node keeps its
        // pluginId across a round-trip and re-resolves on a fresh load.
        if (node.pluginId !== undefined) {
            serialized.pluginId = node.pluginId;
        }
        serializedNodes.push(serialized);
    });

    // Serialize connections
    connections.forEach((connection) => {
        serializedConnections.push({
            id: connection.id,
            sourceNodeId: connection.sourceNodeId,
            sourcePortId: connection.sourcePortId,
            targetNodeId: connection.targetNodeId,
            targetPortId: connection.targetPortId,
            type: connection.type
        });
    });

    const out: SerializedWorkflow = {
        version: WORKFLOW_VERSION,
        name,
        createdAt: new Date().toISOString(),
        nodes: serializedNodes,
        connections: serializedConnections
    };
    // Carry the timeline through UNTOUCHED so a saved project keeps its whole
    // arrangement (FROZEN-3); omitted entirely when there is no song.
    if (arrangement !== undefined && arrangement !== null) {
        out.arrangement = arrangement;
    }
    return out;
}

/**
 * Import a workflow from JSON
 * Returns the nodes and connections to be added to the graph
 */
export function importWorkflow(
    json: string | SerializedWorkflow
): { nodes: GraphNode[]; connections: Connection[]; arrangement?: unknown } {
    const workflow: SerializedWorkflow =
        typeof json === 'string' ? JSON.parse(json) : json;

    // Validate version compatibility
    if (!workflow.version) {
        throw new Error('Invalid workflow: missing version');
    }

    const [major] = workflow.version.split('.');
    const [currentMajor] = WORKFLOW_VERSION.split('.');

    if (major !== currentMajor) {
        throw new Error(
            `Incompatible workflow version: ${workflow.version}. Expected ${WORKFLOW_VERSION}`
        );
    }

    // MIGRATE (M5): convert OLD-shape AI nodes to first-class pluginId nodes.
    // A pre-M5 AI node is an `effect` carrying its Faust source (`data.faustSource`
    // present OR `data.aiDsp` truthy) but NO pluginId. Assign the stable
    // kernel-derived id and register a dynamic def so identity resolves — no
    // orphaning. This mutates each serialized node in place before reconstruction.
    workflow.nodes.forEach((serialized) => migrateLegacyDspNode(serialized));

    // Reconstruct nodes with ports.
    // - FROZEN-1 (STABILITY.md §2 — "a saved project always opens"): EVERY node is
    //   KEPT. A node whose identity resolves (a closed `type` or a registered open
    //   `pluginId`) loads normally; one that does NOT is kept as a labeled
    //   passthrough STUB rather than dropped — dropping silently loses the user's
    //   work, the exact violation this contract forbids. The stub preserves
    //   id/type/pluginId/data and its persisted ports, so the project round-trips
    //   losslessly and its connections survive; `get()` returns the inert
    //   MISSING_DEFINITION so the app stays operable, the engine's
    //   `compile_resilient` degrades the node to a real passthrough, and a later
    //   load re-binds it if the missing node/plugin reappears. (An unresolved node
    //   is recomputable on demand via `isRegisteredPluginId`, so no persisted flag
    //   is needed; the engine already labels its own degraded stubs.)
    // - SELF-HEALING (M5): when a node carries a pluginId that is not yet in the
    //   dynamic registry, RE-REGISTER a dynamic def from the serialized data so
    //   identity resolves after a fresh load (clears MISSING_DEFINITION).
    // - Prefer persisted per-instance ports over the static defaultPorts, so
    //   dynamically-grown ports (and an unknown node's topology) survive a round-trip.
    const nodes: GraphNode[] = workflow.nodes.map((serialized) => {
        selfHealDynamicPlugin(serialized);
        const definition = getNodeDefinition(serialized.type);
        const ports: PortDefinition[] =
            serialized.ports && serialized.ports.length > 0
                ? serialized.ports.map((port) => ({ ...port }))
                : [...definition.defaultPorts];

        const node: GraphNode = {
            id: serialized.id,
            type: serialized.type,
            category: serialized.category,
            position: serialized.position,
            data: serialized.data,
            ports,
            // Flat structure fields - deserialized nodes are root-level by default
            parentId: null,
            childIds: [],
            specialNodes: []
        };
        // Carry the OPEN identity back onto the live node (M5).
        if (serialized.pluginId !== undefined) {
            node.pluginId = serialized.pluginId;
        }
        return node;
    });
    const nodesById = new Map(nodes.map(node => [node.id, node]));

    // Reconstruct connections
    const connections: Connection[] = workflow.connections
        .filter((serialized) => {
            const sourceNode = nodesById.get(serialized.sourceNodeId);
            const targetNode = nodesById.get(serialized.targetNodeId);

            return Boolean(
                sourceNode?.ports.some(port => port.id === serialized.sourcePortId) &&
                targetNode?.ports.some(port => port.id === serialized.targetPortId)
            );
        })
        .map((serialized) => ({
            id: serialized.id,
            sourceNodeId: serialized.sourceNodeId,
            sourcePortId: serialized.sourcePortId,
            targetNodeId: serialized.targetNodeId,
            targetPortId: serialized.targetPortId,
            type: serialized.type
        }));

    // Pass the song-layer timeline through UNTOUCHED (the song layer interprets it
    // via readArrangement) so a saved project keeps its whole timeline — FROZEN-3.
    return { nodes, connections, arrangement: workflow.arrangement };
}

// ============================================================================
// M5 — open-identity migration + self-healing helpers
// ============================================================================

/** Read a string field off a serialized node's `data`, or undefined. */
function dataString(serialized: SerializedNode, key: string): string | undefined {
    const value = (serialized.data as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
}

/**
 * MIGRATE one OLD-shape AI node to a first-class pluginId node (M5).
 *
 * A pre-M5 AI DSP node is an `effect` carrying its Faust source in `data`
 * (`faustSource` present OR `aiDsp` truthy) but with NO `pluginId`. We assign the
 * stable kernel-derived id (`"ai.dsp." + shortHash(faustSource)`) and register a
 * dynamic def from the node's own data, so the node resolves to its dynamic
 * identity after load instead of being orphaned. Idempotent + no-op for every
 * other node (built-ins, already-migrated nodes, nodes without a source).
 */
function migrateLegacyDspNode(serialized: SerializedNode): void {
    if (serialized.pluginId !== undefined) return; // already first-class
    if (serialized.type !== 'effect') return;

    const faustSource = dataString(serialized, 'faustSource');
    const isAiDsp = Boolean((serialized.data as Record<string, unknown>).aiDsp);
    if (faustSource === undefined && !isAiDsp) return;

    // Identity follows the kernel. Fall back to the node id only if a node was
    // flagged aiDsp without a stored source (degenerate, but keeps it resolvable).
    const kernel = faustSource ?? serialized.id;
    const pluginId = dspPluginIdFor(kernel);
    serialized.pluginId = pluginId;

    if (!getDynamicPlugin(pluginId)) {
        const name = dataString(serialized, 'aiDspName') ?? 'AI DSP';
        const description = dataString(serialized, 'description');
        registerDynamicPlugin(
            pluginId,
            makeDspNodeDefinition({ name, faustSource: kernel, description })
        );
    }
}

/**
 * SELF-HEAL one node's OPEN identity (M5).
 *
 * When a node carries a `pluginId` that is NOT yet in the dynamic registry (a
 * fresh load: the registry is empty until something re-registers), re-register a
 * dynamic def from the node's serialized data so `resolveNodeDefinition` returns
 * the dynamic def rather than MISSING. Keyed by the stored faust source so the
 * SAME kernel re-resolves to the SAME identity. No-op when already registered or
 * when the node has no pluginId.
 */
function selfHealDynamicPlugin(serialized: SerializedNode): void {
    const pluginId = serialized.pluginId;
    if (pluginId === undefined) return;
    if (getDynamicPlugin(pluginId)) return; // already resolves

    if (pluginId.startsWith(HOSTED_PLUGIN_ID_PREFIX)) {
        const desc = (serialized.data as Record<string, unknown>)[HOSTED_PLUGIN_DESCRIPTOR_KEY] as
            | HostedPluginDescriptor
            | undefined;
        if (desc !== undefined) {
            const resolvedId = hostedPluginIdFor(desc);
            registerDynamicPlugin(pluginId, makeHostedPluginDefinition(desc));
            // If a hand-edited workflow changed path/uid/format, keep the stored
            // pluginId authoritative for this project but leave a breadcrumb for
            // diagnostics/re-resolution UX.
            if (resolvedId !== pluginId) {
                (serialized.data as Record<string, unknown>).hostedPluginResolvedId = resolvedId;
            }
        }
        return;
    }

    // On a normal M5 export `faustSource` is always present, so the re-derived def
    // is keyed on the same kernel that produced `pluginId` and stays consistent.
    // The `serialized.id` fallback is best-effort for a degenerate hand-edited file
    // (pluginId set but faustSource stripped): the def is keyed on the node id and
    // no longer matches `pluginId`, but identity still RESOLVES (no orphaning).
    const faustSource = dataString(serialized, 'faustSource') ?? serialized.id;
    const name = dataString(serialized, 'aiDspName') ?? 'AI DSP';
    const description = dataString(serialized, 'description');
    registerDynamicPlugin(
        pluginId,
        makeDspNodeDefinition({ name, faustSource, description })
    );
}

/**
 * Download workflow as a JSON file
 */
export function downloadWorkflow(workflow: SerializedWorkflow): void {
    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflow.name.replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Load workflow from file input
 */
export function loadWorkflowFromFile(file: File): Promise<SerializedWorkflow> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const json = e.target?.result as string;
                const workflow = JSON.parse(json) as SerializedWorkflow;
                resolve(workflow);
            } catch {
                reject(new Error('Failed to parse workflow file'));
            }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}
