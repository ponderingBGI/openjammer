/**
 * useIsAgentPending — a node is "agent-pending" (and so highlighted on the real
 * canvas) exactly when a live agent turn added it: the turn is RUNNING AND the
 * node post-dates the turn's baseline. The highlight clears when the turn ends.
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

    it('clears when the turn finishes (phase leaves running)', () => {
        useAgentSessionStore.setState({ phase: 'running', runBaseline: new Set() });
        expect(renderHook(() => useIsAgentPending('x')).result.current).toBe(true);

        // The turn settles → no more highlight.
        useAgentSessionStore.setState({ phase: 'idle', runBaseline: null });
        expect(renderHook(() => useIsAgentPending('x')).result.current).toBe(false);
    });
});
