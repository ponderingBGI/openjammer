/**
 * useIsAgentPending (Phase 5) — a node is "agent-pending" (and so highlighted on
 * the real canvas) exactly when a live, not-yet-approved agent run added it: the
 * run is running/awaiting-approval AND the node post-dates the run's baseline.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
    useAgentSessionStore,
    useIsAgentPending,
    _resetAgentSessionForTests,
} from '../agentSessionStore';

describe('useIsAgentPending', () => {
    beforeEach(() => _resetAgentSessionForTests());

    it('is false when idle (no run)', () => {
        const { result } = renderHook(() => useIsAgentPending('new-node'));
        expect(result.current).toBe(false);
    });

    it('is true for a node added after the run baseline, while running', () => {
        useAgentSessionStore.setState({ phase: 'running', runBaseline: new Set(['pre-existing']) });
        expect(renderHook(() => useIsAgentPending('agent-added')).result.current).toBe(true);
        // A node that existed before the run is NOT highlighted.
        expect(renderHook(() => useIsAgentPending('pre-existing')).result.current).toBe(false);
    });

    it('stays true through awaiting-approval, clears on approve/reject', () => {
        useAgentSessionStore.setState({ phase: 'awaiting-approval', runBaseline: new Set() });
        expect(renderHook(() => useIsAgentPending('x')).result.current).toBe(true);

        // Reject clears the baseline → no more highlight.
        useAgentSessionStore.getState().reject();
        expect(renderHook(() => useIsAgentPending('x')).result.current).toBe(false);
    });
});
