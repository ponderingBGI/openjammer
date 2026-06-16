/**
 * Plan registry bindings (D3, M7) — the ONE concrete reach into the registry for
 * the plan path, mirroring `graphAdapter`'s role for the verb path.
 *
 * `plan.ts` + `planValidator.ts` are deliberately pure: they take a
 * {@link PlanPortResolver} / {@link PlanLookups} so they unit-test with fakes.
 * This module is the single binding to the real built-in + dynamic registries,
 * keeping that knowledge out of the pure modules (and out of the agent session).
 */

import type { NodeType, PortDefinition } from '../engine/types';
import { isRegisteredPluginId, canConnect, resolveNodeDefinition } from '../engine/registry';
import type { PlanLookups } from './planValidator';
import type { PlanPortResolver } from './plan';
import type { PlanEnv } from './tools';

/**
 * The declared ports for a node `type`. A built-in resolves via the closed
 * registry ({@link get}); an open dynamic id resolves via its registered def
 * ({@link resolveNodeDefinition}). Returns an empty list for an unknown type
 * (the validator's UNKNOWN_TYPE check reports that separately).
 */
function portsFor(type: NodeType | string): readonly PortDefinition[] {
    // resolveNodeDefinition prefers an open dynamic id, else falls back to get().
    const def = resolveNodeDefinition({ type: type as NodeType, pluginId: type as string });
    return def.defaultPorts;
}

/**
 * Resolve a port NAME to its port id for a node of `type`. Used by
 * {@link planToToolCalls} to lower a wire's human port name to the id
 * `add_connection` needs. Returns `undefined` when no port carries that name
 * (the validator catches it; lowering passes the raw name through).
 */
export const resolvePlanPort: PlanPortResolver = (type, portName) => {
    return portsFor(type).find((p) => p.name === portName)?.id;
};

/**
 * The set of node types that are audio SINKS for the "produces sound" check —
 * a terminal output a signal chain can flow INTO. Kept in sync with the
 * `SpeakerOut` lowering in `engine/manifest.ts` (`speaker` / `recorder`).
 */
const SINK_TYPES: ReadonlySet<string> = new Set<string>(['speaker', 'recorder']);

/**
 * Bind {@link PlanLookups} to the live registries. The ONLY place the plan
 * validator reaches into registry state.
 */
export function createPlanLookups(): PlanLookups {
    return {
        isKnownType: (type) => isRegisteredPluginId(type),
        portsFor: (type) => portsFor(type),
        canConnect: (sourcePort, targetPort) => canConnect(sourcePort, targetPort),
        isSink: (type) => SINK_TYPES.has(type),
    };
}

/**
 * The full {@link PlanEnv} (lookups + port resolver) bound to the live registries.
 * The agent session passes this into {@link applyToolCall} so `validate_plan` /
 * `emit_plan` resolve real types/ports while staying pure at their core.
 */
export function createPlanEnv(): PlanEnv {
    return { lookups: createPlanLookups(), resolvePort: resolvePlanPort };
}
