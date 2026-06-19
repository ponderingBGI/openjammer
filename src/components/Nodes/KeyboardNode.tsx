/**
 * Keyboard Node - Routes keyboard input to connected instruments
 *
 * Auto-assigns a number key (2-9) when created
 * Pressing that number key activates this keyboard's input mode
 * Q-M rows then send input to connected instruments
 *
 * Design: Hierarchical node with internal canvas structure
 * Press E to dive into internal canvas and see key routing
 */

import { useEffect, memo } from 'react';
import { useAudioStore } from '../../store/audioStore';
import type { GraphNode, KeyboardNodeData } from '../../engine/types';
import { Port } from '@openjammer/oj-ui';

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
    style
}: KeyboardNodeProps) {
    const data = node.data as KeyboardNodeData;
    const activeKeyboardId = useAudioStore((s) => s.activeKeyboardId);
    const controlDown = useAudioStore((s) => s.controlDown);

    const registerKeyboard = useAudioStore((s) => s.registerKeyboard);
    const unregisterKeyboard = useAudioStore((s) => s.unregisterKeyboard);

    const isActive = activeKeyboardId === node.id;
    const assignedKey = data.assignedKey ?? 2;

    // Register this keyboard with its assigned number
    useEffect(() => {
        registerKeyboard(assignedKey, node.id);
        return () => unregisterKeyboard(assignedKey);
    }, [assignedKey, node.id, registerKeyboard, unregisterKeyboard]);

    return (
        <div
            className={`keyboard-node schematic-node ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div
                className="schematic-header"
                onMouseDown={handleHeaderMouseDown}
            >
                <span className="schematic-title">Keyboard</span>
                <span className="keyboard-octave">{assignedKey}</span>
            </div>

            {/* Body - Show auto-generated ports from internal canvas */}
            <div className="keyboard-schematic-body">
                {/* Render ports dynamically (auto-synced from internal canvas-input/output nodes) */}
                {node.ports.map((port) => {
                    const isControlActive = port.id === 'control' && isActive && controlDown;
                    return (
                        <div key={port.id} className={`port-row ${port.direction}`}>
                            <span className="port-label">{port.name}</span>
                            <Port
                                kind={port.type}
                                direction={port.direction}
                                connected={!!hasConnection?.(port.id)}
                                {...(port.type === 'universal' && port.resolvedType
                                    ? { resolvedKind: port.resolvedType }
                                    : {})}
                                active={isControlActive}
                                style={{ width: 20, height: 20 }}
                                data-node-id={node.id}
                                data-port-id={port.id}
                                data-port-type={port.type}
                                onMouseDown={(e: React.MouseEvent) => handlePortMouseDown?.(port.id, e)}
                                onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(port.id, e)}
                                onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                                onMouseLeave={handlePortMouseLeave}
                                title={port.name}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Active indicator */}
            {isActive && (
                <div
                    className="keyboard-active-badge"
                    style={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: 'var(--accent-success)',
                        border: '2px solid var(--sketch-black)',
                        boxShadow: '0 0 8px var(--accent-success)'
                    }}
                />
            )}
        </div>
    );
});
