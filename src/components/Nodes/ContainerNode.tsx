/**
 * Container Node - Empty node for grouping and organizing other nodes
 *
 * Features:
 * - Editable display name (click header to edit)
 * - When entered (E key): shows only canvas-input and canvas-output nodes
 * - Can be renamed to anything
 */

import { useState } from 'react';
import type { GraphNode } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { Port } from '@openjammer/oj-ui';

interface ContainerNodeProps {
    node: GraphNode;
    style?: React.CSSProperties;
    handleHeaderMouseDown?: (e: React.MouseEvent) => void;
    handleNodeMouseEnter?: () => void;
    handleNodeMouseLeave?: () => void;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    isSelected?: boolean;
    isDragging?: boolean;
    hasConnection?: (portId: string) => boolean;
}

export function ContainerNode({
    node,
    style,
    handleHeaderMouseDown,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    isSelected,
    isDragging,
    hasConnection
}: ContainerNodeProps) {
    const updateNodeData = useGraphStore(s => s.updateNodeData);
    const flashingNodes = useUIFeedbackStore(s => s.flashingNodes);
    const [isEditing, setIsEditing] = useState(false);
    const [tempName, setTempName] = useState('');

    const displayName = (node.data.displayName as string) || 'Untitled';
    const isFlashing = flashingNodes.has(node.id);

    const handleNameClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setTempName(displayName);
        setIsEditing(true);
    };

    const handleNameSave = () => {
        if (tempName.trim()) {
            updateNodeData(node.id, { displayName: tempName.trim() });
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleNameSave();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
        }
    };

    // Get ports from node (synced from internal canvas-input/output nodes)
    const inputPorts = node.ports.filter(p => p.direction === 'input');
    const outputPorts = node.ports.filter(p => p.direction === 'output');

    return (
        <div
            className={`schematic-node container-node ${isFlashing ? 'deletion-attempted' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header with editable name */}
            <div
                className="container-header"
                onMouseDown={handleHeaderMouseDown}
            >
                {isEditing ? (
                    <input
                        type="text"
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onBlur={handleNameSave}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        className="container-name-input"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className="container-name"
                        onClick={handleNameClick}
                    >
                        {displayName}
                    </span>
                )}
            </div>

            {/* Body with ports */}
            <div className="container-body">
                {/* Input ports on left */}
                {inputPorts.map(port => (
                    <div key={port.id} className="port-row input">
                        <Port
                            kind={port.type}
                            direction="input"
                            connected={!!hasConnection?.(port.id)}
                            {...(port.type === 'universal' && port.resolvedType ? { resolvedKind: port.resolvedType } : {})}
                            data-node-id={node.id}
                            data-port-id={port.id}
                            data-port-type={port.type}
                            onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(port.id, e); }}
                            onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(port.id, e); }}
                            onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                            onMouseLeave={handlePortMouseLeave}
                        />
                        <span className="port-label">{port.name}</span>
                    </div>
                ))}

                {/* Output ports on right */}
                {outputPorts.map(port => (
                    <div key={port.id} className="port-row output">
                        <span className="port-label">{port.name}</span>
                        <Port
                            kind={port.type}
                            direction="output"
                            connected={!!hasConnection?.(port.id)}
                            {...(port.type === 'universal' && port.resolvedType ? { resolvedKind: port.resolvedType } : {})}
                            data-node-id={node.id}
                            data-port-id={port.id}
                            data-port-type={port.type}
                            onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(port.id, e); }}
                            onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(port.id, e); }}
                            onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                            onMouseLeave={handlePortMouseLeave}
                        />
                    </div>
                ))}

                {/* Hint when no ports */}
                {inputPorts.length === 0 && outputPorts.length === 0 && (
                    <div className="container-ports-hint">
                        Press E to enter
                    </div>
                )}
            </div>
        </div>
    );
}
