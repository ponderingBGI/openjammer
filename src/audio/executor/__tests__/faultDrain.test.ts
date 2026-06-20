/**
 * Phase 1 fault-pipe keystone: the drain-time coalescing that protects the
 * 5000-cap DevLog ring from a per-block fault storm, and the tri-state engine
 * health store. These are the reliability-critical pure pieces — a faulting node
 * emits a NodeFault EVERY block, so without coalescing the ring would evict real
 * history (and jank React) during the exact dropout we need to diagnose.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Event as EngineEvent } from '../../../../packages/oj-protocol-ts/src/index';
import { coalesceEvents } from '../OjcoreNativeExecutor';
import { useEngineHealthStore, setEngineHealth } from '../../../store/engineHealthStore';

function ev(seq: number, kind: EngineEvent['kind'], severity: EngineEvent['severity'] = 'Warn'): EngineEvent {
    return { v: 1, seq, severity, kind, source: 'Engine', ts_us: seq * 1000, corr_id: 0 };
}

describe('coalesceEvents', () => {
    it('folds repeated Xruns into one summed entry', () => {
        const out = coalesceEvents([
            ev(1, { Xrun: { dropped: 2 } }),
            ev(2, { Xrun: { dropped: 3 } }),
            ev(3, { Xrun: { dropped: 1 } }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].kind).toEqual({ Xrun: { dropped: 6 } });
        // The first envelope is the representative (its seq/ts survive for corr).
        expect(out[0].seq).toBe(1);
    });

    it('dedups identical (node, fault) NodeFaults but keeps distinct ones', () => {
        const out = coalesceEvents([
            ev(1, { NodeFault: { node: 3, fault: 'NonFinite' } }, 'Error'),
            ev(2, { NodeFault: { node: 3, fault: 'NonFinite' } }, 'Error'),
            ev(3, { NodeFault: { node: 4, fault: 'NonFinite' } }, 'Error'),
            ev(4, { NodeFault: { node: 3, fault: 'OverBudget' } }, 'Error'),
        ]);
        // node3/NonFinite collapses to one; node4 and node3/OverBudget survive.
        expect(out).toHaveLength(3);
        expect(out[0].seq).toBe(1);
        expect(out[1].seq).toBe(3);
        expect(out[2].seq).toBe(4);
    });

    it('passes non-noisy kinds through verbatim, in order', () => {
        const out = coalesceEvents([
            ev(1, 'Lifecycle'),
            ev(2, { Xrun: { dropped: 5 } }),
            ev(3, 'GraphSwap'),
        ]);
        // Lifecycle + GraphSwap pass through; the single Xrun is appended last.
        expect(out.map((e) => e.kind)).toEqual([
            'Lifecycle',
            'GraphSwap',
            { Xrun: { dropped: 5 } },
        ]);
    });

    it('returns an empty array unchanged', () => {
        expect(coalesceEvents([])).toEqual([]);
    });
});

describe('engineHealthStore', () => {
    beforeEach(() => {
        useEngineHealthStore.setState({ health: 'IDLE', reason: '' });
    });

    it('starts IDLE with no reason (never an alarm before the first graph)', () => {
        expect(useEngineHealthStore.getState().health).toBe('IDLE');
        expect(useEngineHealthStore.getState().reason).toBe('');
    });

    it('transitions on setHealth and carries a reason', () => {
        setEngineHealth('DEGRADED', 'graph rejected; last good sound held');
        expect(useEngineHealthStore.getState().health).toBe('DEGRADED');
        expect(useEngineHealthStore.getState().reason).toBe('graph rejected; last good sound held');
        setEngineHealth('DEAD', 'native IPC bridge unavailable');
        expect(useEngineHealthStore.getState().health).toBe('DEAD');
    });

    it('is idempotent for an identical state + reason', () => {
        setEngineHealth('DEGRADED', 'x');
        const first = useEngineHealthStore.getState();
        setEngineHealth('DEGRADED', 'x');
        // No new object identity churn when nothing changed.
        expect(useEngineHealthStore.getState()).toBe(first);
    });
});
