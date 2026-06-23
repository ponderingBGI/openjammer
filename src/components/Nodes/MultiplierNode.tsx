/**
 * Multiplier Node — multiply a signal by a number, or by a second signal.
 *
 * One job: `out = in × multiplier`. The multiplier is the on-node number (scroll
 * or click to set, exactly like the Instrument node's offset) UNLESS the second
 * input ('in-2') is connected, in which case that signal is the multiplier (a
 * VCA) and the number is overridden — shown greyed so it never reads as a live
 * control that does nothing. The number floors at 0 (×0 mutes; a negative
 * multiplier is meaningless) and has no ceiling.
 *
 * The kernel/lowering live in crates/ojcore/src/structural.rs (PrimitiveKind::
 * Multiply) and src/audio/ojgraph/emit.ts (the FACTOR_ACTIVE edge flag).
 */

import { useCallback, useMemo } from 'react';
import type { GraphNode, MultiplierNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { ValueScrubber } from '@openjammer/oj-ui';

interface MultiplierNodeProps {
    node: GraphNode;
}

/** Per wheel-tick step; Shift = fine. */
const STEP = 0.1;
const FINE_STEP = 0.01;

export function MultiplierNode({ node }: MultiplierNodeProps) {
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const connections = useGraphStore((s) => s.connections);

    const data = node.data as MultiplierNodeData;
    const factor = data.factor ?? 1;

    // When 'in-2' carries a signal it IS the multiplier — the number is overridden
    // (the emitter sets FACTOR_ACTIVE), so the on-node value goes read-only.
    const secondConnected = useMemo(() => {
        for (const c of connections.values()) {
            if (c.targetNodeId === node.id && c.targetPortId === 'in-2') return true;
        }
        return false;
    }, [connections, node.id]);

    const setFactor = useCallback(
        (v: number) => {
            // Floor at 0 — the engine clamps too, but keep the UI honest.
            updateNodeData<MultiplierNodeData>(node.id, { factor: Math.max(0, v) });
        },
        [node.id, updateNodeData],
    );

    const handleScroll = useCallback(
        (sd: ScrollData) => {
            const step = sd.shiftKey ? FINE_STEP : STEP;
            const delta = sd.scrollingUp ? step : -step;
            // toFixed(4) kills float drift (0.30000000000000004) from repeated steps.
            setFactor(Number((factor + delta).toFixed(4)));
        },
        [factor, setFactor],
    );

    const { ref } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleScroll,
        enabled: !secondConnected,
    });

    return (
        <div
            className="multiplier-node"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                padding: '6px 0',
            }}
        >
            <span
                ref={ref}
                title={
                    secondConnected
                        ? 'Multiplier comes from the In 2 signal'
                        : 'Scroll or click to set the multiplier'
                }
            >
                <ValueScrubber
                    value={factor}
                    display={`× ${factor.toFixed(2)}`}
                    editable={!secondConnected}
                    disabled={secondConnected}
                    onCommit={setFactor}
                />
            </span>
            {secondConnected && (
                <span
                    style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-sketch)',
                    }}
                >
                    from In 2
                </span>
            )}
        </div>
    );
}
