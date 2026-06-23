/**
 * Workflow PLAN validator — the PURE pre-flight check for `validate_plan` /
 * `emit_plan` (D3, M7).
 *
 * WHY validate before applying: a {@link WorkflowPlan} is the agent's
 * higher-altitude proposal (nodes by `ref`, wires by port NAME). Lowering it
 * ({@link planToToolCalls}) is deterministic but assumes the plan is sound. This
 * module is the side-effect-free diagnostician that catches the avoidable
 * mistakes BEFORE any mutation, returning structured {@link PlanError}s the agent
 * can read and repair — instead of letting a bad plan half-apply and revert.
 *
 * The seven checks (each a distinct {@link PlanErrorCode}):
 *   1. WIRE_REF       — every wire endpoint `ref` resolves to a plan node.
 *   2. UNKNOWN_TYPE   — each node `type` is a known NodeType OR a registered
 *                       dynamic pluginId.
 *   3. UNKNOWN_PORT   — each wire port NAME resolves on the node's ports.
 *   4. BAD_DIRECTION  — `from` must be an OUTPUT port; `to` must be an INPUT port.
 *   5. CANT_CONNECT   — `registry.canConnect(sourcePort, targetPort)` holds.
 *   6. CYCLE          — no directed cycle, EXCLUDING looper feedback (a `looper`
 *                       input→output edge is treated as a non-cycle edge).
 *   7. NO_SOUND       — at least one node reaches a `speaker`/output sink (the
 *                       "produces sound" reachability guarantee).
 *
 * PURITY: all graph/registry knowledge is injected via {@link PlanLookups} so the
 * validator unit-tests with fakes — no Zustand, no registry import, no DOM.
 */

import type { PortDefinition } from '../engine/types';
import type { PlanNode, WorkflowPlan } from './plan';

// ============================================================================
// Error model
// ============================================================================

/** The closed set of plan-validation failure codes. */
export type PlanErrorCode =
    | 'WIRE_REF'
    | 'UNKNOWN_TYPE'
    | 'UNKNOWN_PORT'
    | 'BAD_DIRECTION'
    | 'CANT_CONNECT'
    | 'CYCLE'
    | 'NO_SOUND';

/** One structured validation failure: a code, a human message, and a `ref` when
 * the failure is local to a specific node/endpoint. */
export interface PlanError {
    code: PlanErrorCode;
    message: string;
    /** The offending node `ref`, when the error is local to one node. */
    ref?: string;
}

// ============================================================================
// Injected lookups (keep the validator pure)
// ============================================================================

/**
 * The registry/graph knowledge the validator needs, injected so it stays pure.
 * The concrete binding ({@link createPlanLookups} in `./planAdapter`) walks the
 * built-in registry + dynamic registry; tests pass fakes.
 */
export interface PlanLookups {
    /** Whether `type` is a known built-in NodeType OR a registered dynamic id. */
    isKnownType(type: string): boolean;
    /** The declared ports for a node `type` (built-in defaultPorts / dynamic def). */
    portsFor(type: string): readonly PortDefinition[];
    /** Whether `sourcePort` may connect to `targetPort` (registry.canConnect). */
    canConnect(sourcePort: PortDefinition, targetPort: PortDefinition): boolean;
    /** Whether a node `type` is an audio SINK ("produces sound": speaker/output). */
    isSink(type: string): boolean;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a {@link WorkflowPlan}, returning every {@link PlanError} found (empty
 * = sound). Side-effect-free. Checks run in a deliberate order so a downstream
 * check is skipped for an endpoint a prior check already flagged (e.g. a wire to
 * a missing ref does not also report UNKNOWN_PORT for it).
 */
export function validatePlan(plan: WorkflowPlan, lookups: PlanLookups): PlanError[] {
    const errors: PlanError[] = [];
    const byRef = new Map<string, PlanNode>();
    for (const node of plan.nodes) byRef.set(node.ref, node);

    // (2) Unknown node type — each node's type must resolve.
    for (const node of plan.nodes) {
        if (!lookups.isKnownType(node.type)) {
            errors.push({
                code: 'UNKNOWN_TYPE',
                ref: node.ref,
                message: `node "${node.ref}" has unknown type "${node.type}"`,
            });
        }
    }

    // (1/3/4/5) Per-wire ref + port + direction + connectability checks.
    for (const wire of plan.wires) {
        const fromNode = byRef.get(wire.from.ref);
        const toNode = byRef.get(wire.to.ref);

        // (1) ref resolution — both endpoints must name a plan node.
        if (!fromNode) {
            errors.push({
                code: 'WIRE_REF',
                ref: wire.from.ref,
                message: `wire source ref "${wire.from.ref}" is not a node in the plan`,
            });
        }
        if (!toNode) {
            errors.push({
                code: 'WIRE_REF',
                ref: wire.to.ref,
                message: `wire target ref "${wire.to.ref}" is not a node in the plan`,
            });
        }
        if (!fromNode || !toNode) continue;

        // A node with an unknown type has no resolvable ports; skip its wires
        // (UNKNOWN_TYPE already reported it).
        if (!lookups.isKnownType(fromNode.type) || !lookups.isKnownType(toNode.type)) continue;

        // (3) port-NAME resolution against each node's declared ports. An
        // UNKNOWN_PORT error TEACHES — it lists the node's real port names for the
        // direction the wire needs, so the agent corrects the wire instead of
        // guessing again.
        const fromPorts = lookups.portsFor(fromNode.type);
        const toPorts = lookups.portsFor(toNode.type);
        const sourcePort = findPortByName(fromPorts, wire.from.port);
        const targetPort = findPortByName(toPorts, wire.to.port);
        if (!sourcePort) {
            errors.push({
                code: 'UNKNOWN_PORT',
                ref: wire.from.ref,
                message:
                    `node "${wire.from.ref}" (${fromNode.type}) has no port named ` +
                    `"${wire.from.port}"${portHint(fromPorts, 'output')}`,
            });
        }
        if (!targetPort) {
            errors.push({
                code: 'UNKNOWN_PORT',
                ref: wire.to.ref,
                message:
                    `node "${wire.to.ref}" (${toNode.type}) has no port named ` +
                    `"${wire.to.port}"${portHint(toPorts, 'input')}`,
            });
        }
        if (!sourcePort || !targetPort) continue;

        // (4) direction — `from` must be an output, `to` must be an input.
        if (sourcePort.direction !== 'output') {
            errors.push({
                code: 'BAD_DIRECTION',
                ref: wire.from.ref,
                message: `wire source "${wire.from.ref}:${wire.from.port}" is not an output port`,
            });
        }
        if (targetPort.direction !== 'input') {
            errors.push({
                code: 'BAD_DIRECTION',
                ref: wire.to.ref,
                message: `wire target "${wire.to.ref}:${wire.to.port}" is not an input port`,
            });
        }
        if (sourcePort.direction !== 'output' || targetPort.direction !== 'input') continue;

        // (5) connectability — the registry's signal rules must allow it.
        if (!lookups.canConnect(sourcePort, targetPort)) {
            errors.push({
                code: 'CANT_CONNECT',
                ref: wire.from.ref,
                message:
                    `cannot connect "${wire.from.ref}:${wire.from.port}" -> ` +
                    `"${wire.to.ref}:${wire.to.port}" (incompatible ports)`,
            });
        }
    }

    // (6) cycle detection over the resolvable wires (looper feedback excluded).
    if (hasCycle(plan, byRef)) {
        errors.push({
            code: 'CYCLE',
            message:
                'plan has a feedback cycle (excluding looper feedback); a non-looper ' +
                'cycle would mis-order the audio graph',
        });
    }

    // (7) speaker-reachability — the plan must reach an audio sink.
    if (plan.nodes.length > 0 && !reachesSink(plan, byRef, lookups)) {
        errors.push({
            code: 'NO_SOUND',
            message:
                'plan produces no sound: no node reaches a speaker/output sink — add a ' +
                'speaker and wire the signal chain into it',
        });
    }

    return errors;
}

// ============================================================================
// Helpers (pure)
// ============================================================================

/** Find a port by its human NAME (case-sensitive, the canvas label). */
function findPortByName(
    ports: readonly PortDefinition[],
    name: string,
): PortDefinition | undefined {
    return ports.find((p) => p.name === name);
}

/**
 * A teaching hint for an UNKNOWN_PORT error: list the node's real port NAMES for
 * the direction the wire needs (bounded), so the message says what to USE, not
 * just what failed. A type with no ports of that direction reports it plainly.
 */
function portHint(ports: readonly PortDefinition[], want: 'input' | 'output'): string {
    const names = ports.filter((p) => p.direction === want).map((p) => p.name);
    if (names.length === 0) return ` — this node has no ${want} ports`;
    const MAX = 6;
    const shown = names.slice(0, MAX).map((n) => `"${n}"`).join(', ');
    const more = names.length > MAX ? `, …(+${names.length - MAX} more)` : '';
    return ` — available ${want} ports: ${shown}${more}`;
}

/**
 * Detect a directed cycle over the plan's wires via DFS three-colour marking.
 *
 * LOOPER FEEDBACK EXCEPTION: an edge whose SOURCE node is a `looper` is treated
 * as a non-cycle (feedback) edge and skipped from the traversal — a looper
 * intentionally feeds its output back, so its in→out edge must not count as an
 * illegal cycle. Wires referencing missing refs are skipped (WIRE_REF covers
 * them) so this never throws on a malformed plan.
 */
function hasCycle(plan: WorkflowPlan, byRef: Map<string, PlanNode>): boolean {
    // Build an adjacency list ref -> [targetRefs], skipping looper-feedback edges.
    const adj = new Map<string, string[]>();
    for (const node of plan.nodes) adj.set(node.ref, []);
    for (const wire of plan.wires) {
        const from = byRef.get(wire.from.ref);
        const to = byRef.get(wire.to.ref);
        if (!from || !to) continue; // unresolved ref → not an edge here
        // Looper output feeds back by design: don't treat its edge as a cycle.
        if (from.type === 'looper') continue;
        adj.get(wire.from.ref)?.push(wire.to.ref);
    }

    // 0 = unvisited, 1 = on the current DFS stack, 2 = fully explored.
    const colour = new Map<string, number>();
    for (const node of plan.nodes) colour.set(node.ref, 0);

    const visit = (ref: string): boolean => {
        colour.set(ref, 1);
        for (const next of adj.get(ref) ?? []) {
            const c = colour.get(next) ?? 0;
            if (c === 1) return true; // back-edge to a node on the stack → cycle
            if (c === 0 && visit(next)) return true;
        }
        colour.set(ref, 2);
        return false;
    };

    for (const node of plan.nodes) {
        if ((colour.get(node.ref) ?? 0) === 0 && visit(node.ref)) return true;
    }
    return false;
}

/**
 * Whether ANY node reaches an audio SINK by following wires forward.
 *
 * A sink is a node whose type {@link PlanLookups.isSink} reports as an output
 * (speaker/recorder). The plan "produces sound" iff at least one node can reach
 * one — i.e. the signal has somewhere to go. A plan that IS just a sink already
 * satisfies it. Looper feedback is irrelevant to reachability so all resolvable
 * forward wires are followed.
 */
function reachesSink(
    plan: WorkflowPlan,
    byRef: Map<string, PlanNode>,
    lookups: PlanLookups,
): boolean {
    // Any sink present at all is the simplest win.
    const sinks = new Set<string>();
    for (const node of plan.nodes) {
        if (lookups.isKnownType(node.type) && lookups.isSink(node.type)) sinks.add(node.ref);
    }
    if (sinks.size === 0) return false;

    // Forward adjacency over resolvable wires.
    const adj = new Map<string, string[]>();
    for (const node of plan.nodes) adj.set(node.ref, []);
    for (const wire of plan.wires) {
        if (!byRef.has(wire.from.ref) || !byRef.has(wire.to.ref)) continue;
        adj.get(wire.from.ref)?.push(wire.to.ref);
    }

    // A sink reaches itself → if a sink exists AND any node (incl. the sink)
    // reaches it, the plan produces sound. Walk from every node; succeed as soon
    // as a sink is reached.
    for (const node of plan.nodes) {
        if (canReachAny(node.ref, sinks, adj)) return true;
    }
    return false;
}

/** BFS/DFS: can `start` reach any ref in `targets` along `adj` (incl. itself)? */
function canReachAny(
    start: string,
    targets: Set<string>,
    adj: Map<string, string[]>,
): boolean {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
        const ref = stack.pop()!;
        if (targets.has(ref)) return true;
        if (seen.has(ref)) continue;
        seen.add(ref);
        for (const next of adj.get(ref) ?? []) stack.push(next);
    }
    return false;
}
