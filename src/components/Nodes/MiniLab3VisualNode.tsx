/**
 * MiniLab 3 Visual Node — the full hardware faceplate as a canvas node.
 *
 * Shown when you press `E` on a MiniLab 3. Every key, pad, knob, fader and touch
 * strip on the panel is its own output socket, so a single pad can drive one
 * thing while the keys drive another.
 *
 * Wave 5 / P8: it is a `NodeShell` like every other node, so it gains the shared
 * header (grip, title, type chip), the selected / dragging / agent-pending
 * states, and the one focus ring — instead of a bare `.schematic-node` div with
 * a 650x400 device dropped inside it and no header at all.
 */

import type { GraphNode, MIDIInputNodeData } from '../../engine/types';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { NodeFrame, NodeShell } from '@openjammer/oj-ui';
import { MiniLab3Visual } from './MiniLab3Visual';
import './MiniLab3Visual.css';

interface MiniLab3VisualNodeProps {
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
    style?: React.CSSProperties;
}

export function MiniLab3VisualNode({
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
}: MiniLab3VisualNodeProps) {
    const data = node.data as MIDIInputNodeData;
    const isAgentPending = useIsAgentPending(node.id);

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`ml3v-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className="minilab3-visual-node"
                title="MiniLab 3"
                nodeType={data.deviceId ? 'LIVE' : 'PANEL'}
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{ onMouseDown: handleHeaderMouseDown }}
            >
                <MiniLab3Visual
                    nodeId={node.id}
                    deviceId={data.deviceId}
                    handlePortMouseDown={handlePortMouseDown}
                    handlePortMouseUp={handlePortMouseUp}
                    handlePortMouseEnter={handlePortMouseEnter}
                    handlePortMouseLeave={handlePortMouseLeave}
                    hasConnection={hasConnection}
                />
            </NodeShell>
        </NodeFrame>
    );
}

export default MiniLab3VisualNode;
