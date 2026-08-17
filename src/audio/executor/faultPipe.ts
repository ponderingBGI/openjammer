/**
 * The ONE fault pipe both executors share (Wave 4).
 *
 * The native (Tauri) and wasm (AudioWorklet) tiers reach engine faults by
 * different transports — native polls `invoke('poll_events')`, wasm receives a
 * `postMessage` from the worklet — but from there the handling is IDENTICAL and
 * must stay that way: coalesce a per-block fault storm, ingest into the DevLog
 * ring, and nudge the engine-health signal. Forking that logic per tier was the
 * exact "two owners of one invariant" smell the covenant forbids, so it lives
 * here once and both executors call {@link ingestEngineEvents}.
 *
 * Pure-ish: {@link coalesceEvents} is a pure function (unit-tested directly);
 * {@link ingestEngineEvents} performs the store + health side effects.
 */

import type { Event as EngineEvent } from '../../../packages/oj-protocol-ts/src/index';
import { useLogStore } from '../../store/logStore';
import { setEngineHealth } from '../../store/engineHealthStore';
import { setNodePluginLoadError } from './pluginLoadError';
import { reportPluginFault } from '../../store/pluginFaultStore';
import { useGraphStore } from '../../store/graphStore';
import { resolveNodeDefinition } from '../../engine/registry';

/**
 * Coalesce a batch of engine events so a per-block fault storm collapses to a
 * compact, history-preserving summary BEFORE it reaches the 5000-cap DevLog ring.
 *
 * Rules (order-stable for everything kept):
 *   • All `Xrun`s in the batch fold into ONE event whose `dropped` is their sum
 *     (the engine already coalesces between events; this folds across a batch).
 *   • Repeated `NodeFault`s for the SAME (node, fault) fold into one, keeping the
 *     first envelope (timestamp/seq) so click-to-correlate still lands.
 *   • Every other kind passes through verbatim, in arrival order.
 *
 * Pure + exported so the dedup logic is unit-testable without an executor.
 */
export function coalesceEvents(events: readonly EngineEvent[]): EngineEvent[] {
    const out: EngineEvent[] = [];
    let xrun: EngineEvent | null = null;
    let xrunDropped = 0;
    // Track which (node|fault) NodeFaults we've already emitted this batch.
    const seenFaults = new Set<string>();

    for (const ev of events) {
        const kind = ev.kind;
        if (typeof kind === 'object' && 'Xrun' in kind) {
            xrunDropped += kind.Xrun.dropped;
            // Keep the FIRST Xrun envelope as the representative; rewrite its count
            // at the end so the surfaced entry reflects the whole batch.
            if (xrun === null) xrun = ev;
            continue;
        }
        if (typeof kind === 'object' && 'NodeFault' in kind) {
            const key = `${kind.NodeFault.node}|${kind.NodeFault.fault}`;
            if (seenFaults.has(key)) continue;
            seenFaults.add(key);
            out.push(ev);
            continue;
        }
        out.push(ev);
    }

    if (xrun !== null) {
        // Rebuild the single rolled-up Xrun with the summed dropped count.
        out.push({ ...xrun, kind: { Xrun: { dropped: xrunDropped } } });
    }
    return out;
}

/**
 * Rewrite each NodeFault's engine `node` index to its VISUAL node id (via the
 * executor's reverse index), so a fault the agent reads in get_logs /
 * get_diagnostics is addressable to a canvas node instead of an opaque engine
 * number. Pure; the native executor calls it on a drained batch BEFORE
 * {@link coalesceEvents} / {@link ingestEngineEvents}.
 *
 * A fault whose index has NO mapping (a just-removed node) passes through
 * unchanged. The protocol types `node` as the numeric NodeIdx; at this LOG/agent
 * boundary we repurpose it to the visual id, so the rewrite is a localized cast —
 * and the coalesce dedup key (`node|fault`) stays stable per node (a stable
 * string), so a per-block storm still collapses to one entry.
 */
export function remapFaultNodes(
    events: readonly EngineEvent[],
    resolve: (node: number) => string | undefined,
): EngineEvent[] {
    return events.map((ev) => {
        const kind = ev.kind;
        if (typeof kind === 'object' && 'NodeFault' in kind) {
            const visual = resolve(kind.NodeFault.node);
            if (visual !== undefined) {
                return {
                    ...ev,
                    kind: { NodeFault: { ...kind.NodeFault, node: visual as unknown as number } },
                };
            }
        }
        return ev;
    });
}

/**
 * Tap a drained event batch for terminal runtime faults (`Crashed` or
 * `AutoBypassed`) and badge the affected node — the runtime twin of the
 * load-degraded "(missing plugin)" badge, sharing the one `setNodePluginLoadError`
 * SSOT. A hosted plugin that crashed mid-set (the per-node fault latch) or a
 * trapped code node thus shows the same non-modal node badge.
 *
 * SET-ONLY: clearing is owned solely by the next clean `push_graph` (its
 * degraded-id loop sets `false` for every non-degraded node), so a fresh
 * instantiate on a graph swap auto-clears both the load- and runtime-degraded
 * badge — one clear-owner, no flicker. `resolve` maps the engine `NodeIdx` to its
 * visual node id (each tier owns its reverse index). Shared by BOTH executors so
 * there is one runtime-fault owner, not a fork (the same covenant as the rest of
 * this pipe). NonFinite and OverBudget remain diagnostic warnings; AutoBypassed
 * is terminal for this instance and therefore must never fail silently.
 */
export function routeRuntimeFaults(
    events: readonly EngineEvent[],
    resolve: (engineNode: number) => string | undefined,
): void {
    for (const ev of events) {
        const kind = ev.kind;
        if (typeof kind !== 'object' || !('NodeFault' in kind)) continue;
        if (kind.NodeFault.fault !== 'Crashed' && kind.NodeFault.fault !== 'AutoBypassed' && kind.NodeFault.fault !== 'NonFinite') continue;
        const visual = resolve(kind.NodeFault.node);
        if (visual === undefined) continue;
        const node = useGraphStore.getState().nodes.get(visual);
        const pluginName = node ? resolveNodeDefinition(node).name : 'Plugin';
        reportPluginFault({ nodeId: visual, pluginName, kind: kind.NodeFault.fault, corr: ev.corr_id || undefined });
        if (kind.NodeFault.fault !== 'NonFinite') {
            setNodePluginLoadError(visual, true);
            useGraphStore.getState().updateNodeData(visual, { pluginFaultKind: kind.NodeFault.fault, pluginBypassed: true });
        }
    }
}

/**
 * Surface NEWLY-degraded passthrough stubs into the DevLog ring so the agent's
 * `get_logs` / `get_diagnostics` can SEE a missing or incompatible hosted plugin —
 * the LOAD-path twin of {@link routeRuntimeFaults} (the runtime-crash twin). The
 * engine returns the degraded IR ids from `push_graph`; each executor maps them to
 * VISUAL ids via its own reverse index and passes the resulting set here, together
 * with the PRIOR push's degraded set. A node is logged ONCE, the push it first
 * degrades — not on every steady re-push — because a still-broken plugin re-degrades
 * every push and an unfiltered append would evict real history from the 5000-cap
 * ring (the same storm-protection reasoning as {@link coalesceEvents}). One `Warn`
 * entry per newcomer; `describe` (shared via {@link import('./pluginLoadError').describeNodeForLog})
 * builds its label so both tiers read identically. The structured `fields.degraded`
 * is the SSOT the node-diagnostics facet reads (no fragile message regex).
 */
export function logNewlyDegradedStubs(
    nowDegraded: ReadonlySet<string>,
    prevDegraded: ReadonlySet<string>,
    describe: (visualId: string) => string,
): void {
    const append = useLogStore.getState().append;
    for (const visual of nowDegraded) {
        if (prevDegraded.has(visual)) continue;
        append({
            level: 'Warn',
            source: 'Engine',
            scope: 'engine',
            message: `${describe(visual)}: degraded to passthrough — missing or incompatible plugin`,
            fields: { node: visual, degraded: true },
        });
    }
}

/**
 * Coalesce + ingest a batch of engine fault events and update engine health.
 * The single shared sink for BOTH executor tiers (native poll + wasm worklet
 * post). Coalescing happens here, BEFORE ingest, because a faulting node emits a
 * NodeFault EVERY block: an unfiltered firehose would evict real history from the
 * 5000-cap ring (and jank React) during the exact dropout we need to diagnose.
 *
 * Health is nudged to DEGRADED (never DEAD — a fault is recoverable; DEAD is for
 * a transport that cannot make sound at all) and never steals focus.
 */
export function ingestEngineEvents(events: readonly EngineEvent[]): void {
    if (events.length === 0) return;
    const store = useLogStore.getState();
    let sawFault = false;
    let sawDeviceLost = false;
    const coalesced = coalesceEvents(events);
    for (const ev of coalesced) {
        store.ingestEngineEvent(ev);
        const kind = ev.kind;
        if (typeof kind === 'object' && ('NodeFault' in kind || 'Xrun' in kind)) {
            sawFault = true;
        } else if (kind === 'Lifecycle') {
            // The native engine emits Lifecycle for device-loss; treat it as a
            // degraded signal (the wasm tier has no device-loss event today).
            sawDeviceLost = true;
        }
    }

    if (sawDeviceLost) {
        setEngineHealth('DEGRADED', 'audio device lost');
    } else if (sawFault) {
        setEngineHealth('DEGRADED', 'engine reported a fault');
    }
}
