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
