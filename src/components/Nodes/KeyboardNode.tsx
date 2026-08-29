/**
 * Keyboard Node — the compact keyboard: four sockets, no keys.
 *
 * This is the BUNDLE view of a keyboard. Its body is the four things that leave
 * it — `ROW 1 / ROW 2 / ROW 3 / PEDAL` — each a socket row carrying however many
 * keys are wired to it inside (`10 KEYS`, `9 KEYS`, `1`). Press `E` to dive in
 * and see the keys themselves; add a `Keys` node when you want a surface to
 * play with the mouse (`KeyboardVisualNode`).
 *
 * Wave 5 / P8 retires two pieces of old styling flagged by the W4-S4 review: the
 * 4px GREEN ring and the floating green dot that marked "this keyboard has the
 * number keys". In the New DNA green means healthy, never selected — so the
 * focused mode is a mono `MODE 2` chip in the header instead, tinted with the
 * accent ink when it is the live one.
 */

import { useEffect, useMemo, memo } from 'react';
import { useAudioStore } from '../../store/audioStore';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { detectBundleInfo } from '../../utils/portSync';
import type { GraphNode, KeyboardNodeData } from '../../engine/types';
import { NodeFrame, NodeShell, PortRow } from '@openjammer/oj-ui';
import './KeyboardNode.css';

interface KeyboardNodeProps {
    node: GraphNode;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection?: (portId: string) => boolean;
    handleHeaderMouseDown?: (e: React.MouseEvent) => void;
    handleNodeMouseEnter?: () => void;
    handleNodeMouseLeave?: () => void;
    isSelected?: boolean;
    isDragging?: boolean;
    isHoveredWithConnections?: boolean;
    incomingConnectionCount?: number;
    style?: React.CSSProperties;
}

export const KeyboardNode = memo(function KeyboardNode({
    node,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    handleHeaderMouseDown,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    isSelected,
    isDragging,
}: KeyboardNodeProps) {
    const data = node.data as KeyboardNodeData;
    const activeKeyboardId = useAudioStore((s) => s.activeKeyboardId);
    const controlDown = useAudioStore((s) => s.controlDown);
    const registerKeyboard = useAudioStore((s) => s.registerKeyboard);
    const unregisterKeyboard = useAudioStore((s) => s.unregisterKeyboard);
    const isAgentPending = useIsAgentPending(node.id);

    const nodes = useGraphStore((s) => s.nodes);
    const connections = useGraphStore((s) => s.connections);

    const isActive = activeKeyboardId === node.id;
    const assignedKey = data.assignedKey ?? 2;

    // Register this keyboard with its assigned number.
    useEffect(() => {
        registerKeyboard(assignedKey, node.id);
        return () => unregisterKeyboard(assignedKey);
    }, [assignedKey, node.id, registerKeyboard, unregisterKeyboard]);

    /**
     * How many keys ride each row cable. It is the one thing this faceplate can
     * say that the socket alone cannot, and it is an exact number, so it is mono.
     */
    const bundleSizes = useMemo(() => {
        const sizes = new Map<string, number>();
        for (const port of node.ports) {
            if (port.direction !== 'output') continue;
            const info = detectBundleInfo(node.id, port.id, nodes, connections);
            if (info) sizes.set(port.id, info.channels.length);
        }
        return sizes;
    }, [node.id, node.ports, nodes, connections]);

    const inputs = node.ports.filter((p) => p.direction === 'input');
    const outputs = node.ports.filter((p) => p.direction !== 'input');

    const renderRow = (port: (typeof node.ports)[number]) => {
        const size = bundleSizes.get(port.id);
        // The pedal is a size-1 bundle; a "1 KEYS" chip on it would be noise.
        const count = size !== undefined && size > 1 ? `${size} KEYS` : null;
        return (
            <PortRow
                key={port.id}
                side={port.direction}
                kind={port.type}
                connected={!!hasConnection?.(port.id)}
                {...(port.type === 'universal' && port.resolvedType ? { resolvedKind: port.resolvedType } : {})}
                label={
                    <>
                        <span className="kb-row-name">{port.name}</span>
                        {count && <span className="kb-row-count">{count}</span>}
                    </>
                }
                title={port.name}
                data-node-id={node.id}
                data-port-id={port.id}
                data-port-type={port.type}
                onMouseDown={(e: React.MouseEvent) => handlePortMouseDown?.(port.id, e)}
                onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(port.id, e)}
                onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                onMouseLeave={handlePortMouseLeave}
            />
        );
    };

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`kb-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className={`keyboard-node${isActive ? ' is-mode-active' : ''}`}
                title="Keyboard"
                nodeType={`MODE ${assignedKey}`}
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{ onMouseDown: handleHeaderMouseDown }}
                inputs={inputs.map(renderRow)}
                outputs={outputs.map(renderRow)}
            >
                <p className={`kb-hint${isActive && controlDown ? ' is-sustaining' : ''}`}>
                    {!isActive
                        ? `Press ${assignedKey} to play this keyboard.`
                        : controlDown
                            ? 'Sustaining — release Space to let go.'
                            : 'Type Q-P / A-L / Z-/ to play. Space sustains.'}
                </p>
            </NodeShell>
        </NodeFrame>
    );
});
