/**
 * Multiplier Node — multiply a signal by a number, or by a second signal.
 *
 * One job: `out = in × multiplier`. The multiplier is the on-node number
 * (scroll, or click to type) UNLESS the second input (`in-2`) is connected, in
 * which case that signal IS the multiplier (a VCA) and the number is overridden
 * — shown read-only, with a chip naming what took it over, so it never reads as
 * a live control that does nothing. The number floors at 0 (×0 mutes; a
 * negative multiplier is meaningless) and has no ceiling.
 *
 * WHY A SCRUBBER AND NOT A KNOB: a knob needs two ends. This value has a floor
 * and no ceiling, so a dial would have to invent a maximum and then lie about
 * the range under the player's hand. Bounded parameters get knobs (see
 * `AutoParamPanel`'s KNOB_LIMIT); unbounded ones get the mono scrubber.
 *
 * The kernel/lowering live in crates/ojcore/src/structural.rs (PrimitiveKind::
 * Multiply) and src/audio/ojgraph/emit.ts (the FACTOR_ACTIVE edge flag).
 */

import { useCallback, useMemo } from 'react';
import type { GraphNode, MultiplierNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { Chip, ValueScrubber } from '@openjammer/oj-ui';
import { useGestureBracket } from './nodeControls';
import './MultiplierNode.css';

interface MultiplierNodeProps {
    node: GraphNode;
}

/** Per wheel-tick step; Shift = fine. */
const STEP = 0.1;
const FINE_STEP = 0.01;

export function MultiplierNode({ node }: MultiplierNodeProps) {
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const connections = useGraphStore((s) => s.connections);
    const gesture = useGestureBracket();

    const data = node.data as MultiplierNodeData;
    const factor = data.factor ?? 1;

    // When 'in-2' carries a signal it IS the multiplier — the emitter sets
    // FACTOR_ACTIVE — so the on-node value goes read-only.
    const secondConnected = useMemo(() => {
        for (const c of connections.values()) {
            if (c.targetNodeId === node.id && c.targetPortId === 'in-2') return true;
        }
        return false;
    }, [connections, node.id]);

    const setFactor = useCallback(
        (v: number) => {
            // Floor at 0 — the engine clamps too, but keep the UI honest.
            gesture.begin();
            updateNodeData<MultiplierNodeData>(node.id, { factor: Math.max(0, v) });
        },
        [gesture, node.id, updateNodeData],
    );

    /** A wheel sweep is one undo step; it closes once the wheel goes quiet. */
    const handleScroll = useCallback(
        (sd: ScrollData) => {
            const step = sd.shiftKey ? FINE_STEP : STEP;
            const delta = sd.scrollingUp ? step : -step;
            // toFixed(4) kills float drift (0.30000000000000004) from repeated steps.
            setFactor(Number((factor + delta).toFixed(4)));
        },
        [factor, setFactor],
    );

    const { ref } = useScrollCapture<HTMLDivElement>({
        onScroll: handleScroll,
        enabled: !secondConnected,
    });

    return (
        <div className="multiplier-node">
            <div
                ref={ref}
                className="multiplier-value"
                onPointerLeave={gesture.end}
                title={
                    secondConnected
                        ? 'The multiplier comes from the In 2 signal'
                        : 'Scroll or click to set the multiplier'
                }
            >
                <ValueScrubber
                    value={factor}
                    display={`× ${factor.toFixed(2)}`}
                    editable={!secondConnected}
                    disabled={secondConnected}
                    onCommit={(next) => { setFactor(next); gesture.end(); }}
                />
            </div>
            {secondConnected && (
                <div className="oj-node__meta multiplier-driven">
                    <Chip>driven by In 2</Chip>
                </div>
            )}
        </div>
    );
}
