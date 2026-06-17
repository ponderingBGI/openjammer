/**
 * Workflow PLAN — the agent's declarative, whole-workflow control-plane (D3, M7).
 *
 * WHY a plan on top of the raw verbs: the v1 tool surface (`add_node` /
 * `add_connection` / …) is the trusted, reversible primitive set. But asking a
 * model to emit a CONNECTED workflow with those alone forces it to invent node
 * ids and look up numeric port ids — brittle, and a single wrong id silently
 * mis-wires the graph. A {@link WorkflowPlan} lets the agent describe the whole
 * thing at a HIGHER altitude:
 *   - nodes are addressed by a model-chosen symbolic `ref` ("osc1", "out"), and
 *   - wires reference ports by their human NAME ("Audio Out", "Audio In"),
 * exactly as a person reads them off the canvas. This module is the PURE lowering
 * from that plan to the SAME {@link AgentToolCall}s the verbs already apply — so a
 * plan is never a new trust path: it desugars to `add_node` / `add_connection` /
 * `update_node_data` and rides the existing reversible `batch_apply` frame.
 *
 * SEPARATION OF CONCERNS:
 *   - {@link planToToolCalls} (here) is the pure LOWERING. It assumes the plan is
 *     already valid (refs resolve, ports exist, no cycles) — `emit_plan` runs
 *     {@link validatePlan} (see `./planValidator`) FIRST for diagnostics.
 *   - Port-NAME → port-ID resolution is injected via {@link PlanPortResolver} so
 *     this module stays free of the registry/dynamic-registry imports and is
 *     unit-testable with a fake resolver.
 *
 * INVARIANT: lowering is deterministic and side-effect-free. It returns tool
 * calls; nothing here touches the store.
 */

import type { NodeType, Position } from '../engine/types';
import type {
    AddConnectionArgs,
    AddNodeArgs,
    AgentToolCall,
    UpdateNodeDataArgs,
} from './types';

// ============================================================================
// Plan shape
// ============================================================================

/**
 * One node in a {@link WorkflowPlan}. Addressed by the model-chosen symbolic
 * {@link PlanNode.ref} (wires point at refs, not real ids); `type` is a built-in
 * {@link NodeType} OR a registered dynamic pluginId. `params` become the node's
 * `initialData` overrides; `position` is optional (defaults to viewport centre at
 * apply time).
 */
export interface PlanNode {
    /** Symbolic id chosen by the agent (unique within the plan). */
    ref: string;
    /** A built-in NodeType or a registered dynamic pluginId. */
    type: NodeType | string;
    /** Numeric param overrides, merged into the node's initial `data`. */
    params?: Record<string, number>;
    /** Optional canvas position; omitted → placed at the viewport centre. */
    position?: Position;
}

/** One endpoint of a {@link PlanWire}: a node `ref` + a port NAME (not id). */
export interface PlanEndpoint {
    /** The {@link PlanNode.ref} this endpoint belongs to. */
    ref: string;
    /** The port's human NAME (e.g. "Audio Out") — resolved to an id on lowering. */
    port: string;
}

/** One wire in a {@link WorkflowPlan}: `from` an output endpoint `to` an input. */
export interface PlanWire {
    from: PlanEndpoint;
    to: PlanEndpoint;
}

/**
 * A whole workflow the agent proposes in one shot: a set of nodes (by `ref`) and
 * the wires between them (by port NAME). Lowered to reversible tool calls by
 * {@link planToToolCalls} and applied as ONE `batch_apply` frame by `emit_plan`.
 */
export interface WorkflowPlan {
    nodes: PlanNode[];
    wires: PlanWire[];
}

// ============================================================================
// Lowering
// ============================================================================

/**
 * Maps a plan `ref` to the REAL node id assigned when its `add_node` applied. The
 * caller (the apply path) threads ids back in as nodes are created so wire
 * lowering can resolve `from`/`to` refs to concrete ids.
 */
export type RefToId = Record<string, string>;

/**
 * Resolve a port NAME to its port id for a node of `type`. Injected (not
 * imported) so {@link planToToolCalls} stays pure: the concrete binding walks
 * `registry.get(type).defaultPorts` (built-in) / the dynamic plugin def
 * (open id). Returns `undefined` when the name does not resolve — the caller
 * passes the raw name through so an upstream validation error surfaces honestly
 * rather than being silently dropped.
 */
export type PlanPortResolver = (type: NodeType | string, portName: string) => string | undefined;

/**
 * Lower a {@link WorkflowPlan} to the ordered {@link AgentToolCall}s that build it:
 *   1. an `add_node` per plan node (params → `initialData`), THEN
 *   2. an `update_node_data` per node carrying params, so a param edit is recorded
 *      as its own reversible step (the catalogue's documented behaviour), THEN
 *   3. an `add_connection` per wire, resolving each port NAME to its id via
 *      {@link resolvePort} and each `ref` to its real id via `refToId`.
 *
 * `refToId` is consulted for wires; node-creation order is plan order. Lowering
 * does NOT validate — `emit_plan` runs {@link validatePlan} first. An unresolved
 * port name is passed through verbatim (so the resulting `add_connection` fails
 * loudly at apply time rather than mis-wiring).
 *
 * Pure: same plan + resolver + refToId → same calls; no store access.
 */
export function planToToolCalls(
    plan: WorkflowPlan,
    refToId: RefToId,
    resolvePort: PlanPortResolver,
): AgentToolCall[] {
    const calls: AgentToolCall[] = [];

    // 1) Nodes, in plan order. params seed initialData so the node is born with
    //    its values; we ALSO emit an explicit update (step 2) for symmetry with
    //    the catalogue's "set a param" verb and a precise per-field undo.
    for (const node of plan.nodes) {
        const args: AddNodeArgs = { type: node.type as NodeType };
        if (node.position) args.position = node.position;
        if (node.params && Object.keys(node.params).length > 0) {
            args.initialData = { ...node.params };
        }
        calls.push({ name: 'add_node', args });
    }

    // 2) An explicit update_node_data per node that carries params, addressed by
    //    the REAL id (resolved from refToId). Skipped when a ref has no id yet
    //    (the apply path fills refToId as it creates nodes).
    for (const node of plan.nodes) {
        if (!node.params || Object.keys(node.params).length === 0) continue;
        const nodeId = refToId[node.ref];
        if (nodeId === undefined) continue;
        const args: UpdateNodeDataArgs = { nodeId, data: { ...node.params } };
        calls.push({ name: 'update_node_data', args });
    }

    // 3) Wires → add_connection, resolving refs to ids + port names to ids.
    for (const wire of plan.wires) {
        const sourceNodeId = refToId[wire.from.ref] ?? wire.from.ref;
        const targetNodeId = refToId[wire.to.ref] ?? wire.to.ref;
        const sourceType = typeForRef(plan, wire.from.ref);
        const targetType = typeForRef(plan, wire.to.ref);
        const args: AddConnectionArgs = {
            sourceNodeId,
            sourcePortId:
                (sourceType !== undefined ? resolvePort(sourceType, wire.from.port) : undefined) ??
                wire.from.port,
            targetNodeId,
            targetPortId:
                (targetType !== undefined ? resolvePort(targetType, wire.to.port) : undefined) ??
                wire.to.port,
        };
        calls.push({ name: 'add_connection', args });
    }

    return calls;
}

/** The declared `type` of the plan node with `ref`, or undefined if absent. */
function typeForRef(plan: WorkflowPlan, ref: string): NodeType | string | undefined {
    return plan.nodes.find((n) => n.ref === ref)?.type;
}
