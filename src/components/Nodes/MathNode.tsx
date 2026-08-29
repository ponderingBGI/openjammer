/**
 * Math Node — the Add / Subtract pair.
 *
 * Two universal inputs, one universal output. The ports show the rainbow until
 * something types them, then take the wire colour they resolved to.
 *
 * The OPERATION is a control, not an identity you have to delete and re-add:
 * `add` and `subtract` declare identical ports, so flipping between them is one
 * reversible `updateNodeType` and every cable survives it. The node cannot be
 * entered, and refusing `E` is the one place this card raises its voice.
 */

import { useCallback } from 'react';
import type { GraphNode, NodeType } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { NodeShell, PortRow, SegmentedControl } from '@openjammer/oj-ui';
import { NodeFeedback } from './NodeFeedback';
import { useNodeRefusal } from './nodeControls';
import './MathNode.css';

interface MathNodeProps {
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

/** The operator itself is the header's mono chip; the segments only need the
 *  word, and at 176px there is no room for both. */
const OPERATIONS = [
    { value: 'add' as const, label: 'Add' },
    { value: 'subtract' as const, label: 'Subtract' },
];

export function MathNode({
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
}: MathNodeProps) {
    const updateNodeType = useGraphStore((s) => s.updateNodeType);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const isRefusing = useNodeRefusal(node.id);
    const isAdd = node.type === 'add';

    // The resolved type for port colouring (stored in node data). A universal
    // port shows the rainbow until typed; once resolved it takes that wire colour.
    const resolvedType = node.data.resolvedType as 'audio' | 'control' | null;

    const setOperation = useCallback((next: 'add' | 'subtract') => {
        if (next === node.type) return;
        beginGesture();
        updateNodeType(node.id, next as NodeType);
        endGesture();
    }, [beginGesture, endGesture, node.id, node.type, updateNodeType]);

    const portRow = (port: GraphNode['ports'][number], side: 'input' | 'output') => (
        <PortRow
            key={port.id}
            side={side}
            kind="universal"
            label={port.name}
            connected={!!hasConnection?.(port.id)}
            {...(resolvedType ? { resolvedKind: resolvedType } : {})}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type={port.type}
            onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(port.id, e); }}
            onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(port.id, e); }}
            onMouseEnter={() => handlePortMouseEnter?.(port.id)}
            onMouseLeave={handlePortMouseLeave}
        />
    );

    const inputPorts = node.ports.filter((p) => p.direction === 'input');
    const outputPorts = node.ports.filter((p) => p.direction === 'output');

    return (
        <NodeShell
            className={`schematic-node math-node ${node.type}${isRefusing ? ' deletion-attempted' : ''}${isHoveredWithConnections ? ' hover-connecting' : ''}`}
            style={style}
            title={isAdd ? 'Add' : 'Subtract'}
            nodeType={isAdd ? '+' : '−'}
            selected={!!isSelected}
            dragging={!!isDragging}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            inputs={inputPorts.map((port) => portRow(port, 'input'))}
            outputs={outputPorts.map((port) => portRow(port, 'output'))}
        >
            <div className="math-operation" onMouseDown={(e) => e.stopPropagation()}>
                <SegmentedControl
                    options={OPERATIONS}
                    value={isAdd ? 'add' : 'subtract'}
                    onChange={setOperation}
                    aria-label="Operation"
                />
            </div>
            <p className="math-explainer">
                {isAdd ? 'In 1 + In 2' : 'In 1 − In 2'}
            </p>
            <NodeFeedback
                active={isRefusing}
                message="This node has nothing inside — it cannot be entered."
            />
        </NodeShell>
    );
}
