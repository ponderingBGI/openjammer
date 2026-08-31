/**
 * Canvas I/O Node — the two connector nodes that make a container's inside talk
 * to its outside.
 *
 * `canvas-input` receives from the parent level; `canvas-output` sends back up.
 * They are the smallest cards on the canvas and they carry exactly two facts:
 * the name this port will publish on the parent, and which way it points. The
 * name is the whole reason they exist, so it IS the title — renameable in place.
 *
 * Undeletable, so `Delete` is refused, and the refusal is spoken as well as
 * drawn (UI-029).
 */

import { useCallback, useState } from 'react';
import type { GraphNode } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { EditableLabel, NodeShell, PortRow } from '@openjammer/oj-ui';
import { NodeFeedback } from './NodeFeedback';
import { useNodeRefusal } from './nodeControls';
import './CanvasIONode.css';

interface CanvasIONodeProps {
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

export function CanvasIONode({
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
}: CanvasIONodeProps) {
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const isRefusing = useNodeRefusal(node.id);
    const isAgentPending = useIsAgentPending(node.id);
    const [editing, setEditing] = useState(false);

    const portName = (node.data.portName as string) || '';
    const isInput = node.type === 'canvas-input';

    const rename = useCallback((next: string) => {
        setEditing(false);
        if (!next || next === portName) return;
        beginGesture();
        updateNodeData(node.id, { portName: next });
        endGesture();
    }, [beginGesture, endGesture, node.id, portName, updateNodeData]);

    // The one socket. `canvas-input` publishes an OUTPUT on the inside (it hands
    // the parent's signal onward); `canvas-output` takes an INPUT.
    const renderedPort =
        node.ports.find((port) => port.direction === (isInput ? 'output' : 'input')) ?? node.ports[0];
    const portId = renderedPort?.id || (isInput ? 'out' : 'in');
    const portType = renderedPort?.type ?? 'control';

    const socket = (
        <PortRow
            side={isInput ? 'output' : 'input'}
            kind={portType === 'audio' ? 'audio' : portType === 'universal' ? 'universal' : 'control'}
            label={isInput ? 'Out' : 'In'}
            connected={!!hasConnection?.(portId)}
            data-node-id={node.id}
            data-port-id={portId}
            data-port-type={portType}
            onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(portId, e); }}
            onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(portId, e); }}
            onMouseEnter={() => handlePortMouseEnter?.(portId)}
            onMouseLeave={handlePortMouseLeave}
        />
    );

    return (
        <NodeShell
            className={[
                'schematic-node',
                'canvas-io-node',
                node.type,
                isRefusing && 'deletion-attempted',
                isHoveredWithConnections && 'hover-connecting',
            ].filter(Boolean).join(' ')}
            style={style}
            title={
                <span
                    className="io-title"
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
                        value={portName}
                        editing={editing}
                        placeholder={isInput ? 'Name this input' : 'Name this output'}
                        onCommit={rename}
                        onCancel={() => setEditing(false)}
                    />
                </span>
            }
            nodeType={isInput ? 'FROM PARENT' : 'TO PARENT'}
            selected={!!isSelected}
            dragging={!!isDragging}
            agentPending={isAgentPending}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            inputs={isInput ? undefined : socket}
            outputs={isInput ? socket : undefined}
        >
            <p className="io-hint">
                {portName
                    ? `Published on the parent as “${portName}”.`
                    : 'Double-click the title to name the port this publishes.'}
            </p>
            <NodeFeedback
                active={isRefusing}
                message="This port belongs to the container — it cannot be deleted here."
            />
        </NodeShell>
    );
}
