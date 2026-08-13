// faultPipeDrain.integration.test.ts — the END-TO-END proof that the native
// fault pipe is CONNECTED, not merely present.
//
// The `fault-pipe-connectivity` doctor check proves both ends of the pipe have a
// caller (a STATIC guarantee). This test proves the pipe actually CARRIES events
// at runtime: it drives the REAL `OjcoreNativeExecutor` against a fake Tauri
// `invoke` whose `poll_events` returns engine fault events, advances the drain's
// own timer, and asserts those events land in the REAL `useLogStore` ring —
// `invoke('poll_events')` -> coalesceEvents -> ingestEngineEvent -> ring.
//
// This is the regression that shipped green for a long time: the engine emitted
// Xrun/NodeFault, but nothing drained `poll_events` and `ingestEngineEvent` was
// only ever called from its own unit test, so a real dropout died silently. If a
// future refactor re-cuts the wire, this test goes red (in addition to the static
// doctor gate). It runs under vitest/jsdom because Playwright's `e2e/` browser
// harness has no Tauri IPC runtime to exercise the native drain.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Event as EngineEvent } from '@openjammer/oj-protocol';
import type { Connection, GraphNode } from '../../../engine/types';
import { useLogStore, _resetLogStoreForTests } from '../../../store/logStore';

/** Shape of the global Tauri IPC bridge the executor resolves via `window.__TAURI__`. */
interface TauriBridge {
    core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
}

/** Install a fake `window.__TAURI__` whose `poll_events` returns `events` ONCE,
 *  then an empty batch (so the drain doesn't re-ingest forever). Every other
 *  command (push_graph, subscribe_meters, poll_meters, …) resolves benignly. */
function installFakeTauri(events: EngineEvent[]): { invokeCalls: string[] } {
    const invokeCalls: string[] = [];
    let drained = false;
    const invoke = (cmd: string): Promise<unknown> => {
        invokeCalls.push(cmd);
        if (cmd === 'poll_events') {
            if (drained) return Promise.resolve([]);
            drained = true;
            return Promise.resolve(events);
        }
        if (cmd === 'poll_meters') return Promise.resolve([]);
        // push_graph / subscribe_meters / anything else: benign ack.
        return Promise.resolve(null);
    };
    (window as unknown as { __TAURI__?: TauriBridge }).__TAURI__ = { core: { invoke } };
    return { invokeCalls };
}

/** A no-op subscribe that satisfies the executor's initialize() contract. */
function noopSubscribe(): () => void {
    return () => {};
}

const emptyNodes = (): Map<string, GraphNode> => new Map();
const emptyConns = (): Map<string, Connection> => new Map();

describe('native fault pipe — poll_events drains into the logStore ring', () => {
    beforeEach(() => {
        _resetLogStoreForTests();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
        vi.resetModules();
    });

    it('ingests an engine fault batch into the ring end-to-end (real executor, real store)', async () => {
        const faults: EngineEvent[] = [
            {
                v: 1,
                seq: 1,
                severity: 'Error',
                kind: { Xrun: { dropped: 4 } },
                source: 'Engine',
                ts_us: 1_000,
                corr_id: 0,
            },
            {
                v: 1,
                seq: 2,
                severity: 'Warn',
                kind: { NodeFault: { node: 7, fault: 'OverBudget' } },
                source: 'Engine',
                ts_us: 2_000,
                corr_id: 99,
            },
        ];
        const { invokeCalls } = installFakeTauri(faults);

        // Import the executor AFTER the fake bridge is installed: the class reads
        // `getInvoke()` at construction time from `window.__TAURI__`.
        const { OjcoreNativeExecutor } = await import('../OjcoreNativeExecutor');
        const exec = new OjcoreNativeExecutor();

        exec.initialize(noopSubscribe, noopSubscribe, emptyNodes, emptyConns);

        // The ring starts empty (initialize only pushes an empty graph + starts loops).
        expect(useLogStore.getState().entries).toHaveLength(0);

        // Advance past the dedicated event-drain cadence and let the awaited
        // invoke('poll_events') microtasks settle, so the drain runs for real.
        await vi.advanceTimersByTimeAsync(150);

        const entries = useLogStore.getState().entries;
        const messages = entries.map((e) => e.message);

        // The Xrun and the NodeFault both reached the ring (the pipe carried them).
        expect(invokeCalls).toContain('poll_events');
        expect(entries.length).toBeGreaterThanOrEqual(2);
        expect(messages.some((m) => m.includes('Xrun'))).toBe(true);
        expect(messages.some((m) => m.includes('NodeFault'))).toBe(true);

        // The NodeFault's correlation id survived ingest (click-to-correlate works).
        const nodeFault = entries.find((e) => e.message.includes('NodeFault'));
        expect(nodeFault?.corr).toBe(99);

        exec.dispose();
    });

    it('does not ingest anything when poll_events returns an empty batch (no spam)', async () => {
        installFakeTauri([]);

        const { OjcoreNativeExecutor } = await import('../OjcoreNativeExecutor');
        const exec = new OjcoreNativeExecutor();
        exec.initialize(noopSubscribe, noopSubscribe, emptyNodes, emptyConns);

        await vi.advanceTimersByTimeAsync(150);

        // An empty drain must not evict history or jank the ring with phantom rows.
        expect(useLogStore.getState().entries).toHaveLength(0);
        exec.dispose();
    });
});
