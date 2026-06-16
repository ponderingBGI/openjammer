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
import { isPluginId } from './types';
import { get as getNodeDefinition } from './registry';

const WORKFLOW_VERSION = '1.0.0';

/**
 * Export the current graph state to a JSON-serializable workflow
 */
export function exportWorkflow(
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>,
    name: string = 'Untitled Workflow'
): SerializedWorkflow {
    const serializedNodes: SerializedNode[] = [];
    const serializedConnections: SerializedConnection[] = [];

    // Serialize nodes
    nodes.forEach((node) => {
        serializedNodes.push({
            id: node.id,
            type: node.type,
            category: node.category,
            position: { ...node.position },
            data: JSON.parse(JSON.stringify(node.data)), // Deep clone to handle nested objects
            // Persist per-instance ports (U10) so dynamically-grown ports
            // (e.g. bundle expansions, panel ports) survive a round-trip rather
            // than being reset to the static defaultPorts on import.
            ports: JSON.parse(JSON.stringify(node.ports)) as PortDefinition[]
        });
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

    return {
        version: WORKFLOW_VERSION,
        name,
        createdAt: new Date().toISOString(),
        nodes: serializedNodes,
        connections: serializedConnections
    };
}

/**
 * Import a workflow from JSON
 * Returns the nodes and connections to be added to the graph
 */
export function importWorkflow(
    json: string | SerializedWorkflow
): { nodes: GraphNode[]; connections: Connection[] } {
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

    // Reconstruct nodes with ports.
    // - Null-check (U10): drop nodes whose type is not a known plugin id rather
    //   than constructing a node against an undefined definition.
    // - Prefer persisted per-instance ports over the static defaultPorts, so
    //   dynamically-grown ports survive a round-trip.
    const nodes: GraphNode[] = workflow.nodes
        .filter((serialized) => isPluginId(serialized.type))
        .map((serialized) => {
            const definition = getNodeDefinition(serialized.type);
            const ports: PortDefinition[] =
                serialized.ports && serialized.ports.length > 0
                    ? serialized.ports.map((port) => ({ ...port }))
                    : [...definition.defaultPorts];

            return {
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

    return { nodes, connections };
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
