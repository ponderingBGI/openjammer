/**
 * Container Node — a named box you go inside.
 *
 * It makes no sound and owns no parameters, so the whole card is one question:
 * what is in there, and how do I get in? A renameable title, a mono count chip
 * of what it holds, the ports it publishes to this level, and one ghost button
 * that is the same door the `E` key opens.
 */

import { useCallback, useMemo, useState } from 'react';
import type { GraphNode } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { Button, Chip, EditableLabel, Kbd, NodeShell, PortRow } from '@openjammer/oj-ui';
import { NodeFeedback } from './NodeFeedback';
import { useNodeRefusal } from './nodeControls';
import './ContainerNode.css';

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
    isHoveredWithConnections?: boolean;
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
    isHoveredWithConnections,
    hasConnection,
}: ContainerNodeProps) {
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const enterNode = useCanvasNavigationStore((s) => s.enterNode);
    const flashNode = useUIFeedbackStore((s) => s.flashNode);
    const isRefusing = useNodeRefusal(node.id);
    const isAgentPending = useIsAgentPending(node.id);
    const [editing, setEditing] = useState(false);

    const displayName = (node.data.displayName as string) || 'Untitled';

    /**
     * What the player put in here. The container's own input/output panels are
     * plumbing it did not create, so they do not count — a fresh, empty
     * container must read as empty.
     */
    const childCount = useMemo(() => {
        const special = new Set(node.specialNodes ?? []);
        return (node.childIds ?? []).filter((id) => !special.has(id)).length;
    }, [node.childIds, node.specialNodes]);

    const rename = useCallback((next: string) => {
        setEditing(false);
        if (!next || next === displayName) return;
        beginGesture();
        updateNodeData(node.id, { displayName: next });
        endGesture();
    }, [beginGesture, displayName, endGesture, node.id, updateNodeData]);

    /**
     * The same door `E` opens, and the same refusal when there is nothing behind
     * it (NodeCanvas flashes the node for exactly this case).
     */
    const open = useCallback((event: React.MouseEvent) => {
        event.stopPropagation();
        if (childCount === 0 && (node.childIds?.length ?? 0) === 0) {
            flashNode(node.id);
            return;
        }
        enterNode(node.id);
    }, [childCount, enterNode, flashNode, node.childIds, node.id]);

    const inputPorts = node.ports.filter((p) => p.direction === 'input');
    const outputPorts = node.ports.filter((p) => p.direction === 'output');

    const portRow = (port: GraphNode['ports'][number], side: 'input' | 'output') => (
        <PortRow
            key={port.id}
            side={side}
            kind={port.type === 'audio' ? 'audio' : port.type === 'universal' ? 'universal' : 'control'}
            label={port.name}
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
    );

    return (
        <NodeShell
            className={`schematic-node container-node${isRefusing ? ' deletion-attempted' : ''}${isHoveredWithConnections ? ' hover-connecting' : ''}`}
            style={style}
            title={
                <span
                    className="container-title"
                    /* While the field is open, the header must stop being a drag
                       handle — otherwise clicking to place the caret drags the
                       node. Resting, the title still selects like any header. */
                    onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
                    onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !editing) {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditing(true);
                        }
                    }}
                >
                    <EditableLabel
                        value={displayName}
                        editing={editing}
                        placeholder="Untitled"
                        onCommit={rename}
                        onCancel={() => setEditing(false)}
                    />
                </span>
            }
            nodeType={childCount === 0 ? 'EMPTY' : `${childCount} INSIDE`}
            selected={!!isSelected}
            dragging={!!isDragging}
            agentPending={isAgentPending}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            inputs={inputPorts.map((port) => portRow(port, 'input'))}
            outputs={outputPorts.map((port) => portRow(port, 'output'))}
        >
            {inputPorts.length === 0 && outputPorts.length === 0 && (
                <div className="oj-node__meta container-empty">
                    <Chip>no ports published</Chip>
                </div>
            )}
            <Button
                variant="ghost"
                className="container-open"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={open}
            >
                Open<Kbd>E</Kbd>
            </Button>
            <NodeFeedback active={isRefusing} message={`${displayName} is empty — there is nothing to open yet.`} />
        </NodeShell>
    );
}
