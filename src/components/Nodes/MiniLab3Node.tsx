/**
 * MiniLab 3 Node — the Arturia controller, collapsed to what leaves it.
 *
 * Press `E` to open the full hardware faceplate with a socket on every key, pad,
 * knob, fader and strip (`MiniLab3VisualNode`). This card is the compact view:
 * the device's name, whether it is actually plugged in, and the bundles synced
 * up from its internal output panel.
 *
 * Wave 5 / P8: `NodeShell` + `PortRow` like every other node; the connected
 * state is a line of `--success-ink` TEXT naming the device rather than a
 * glowing green dot with no label; and — as on `MIDINode` — the sockets survive
 * "Web MIDI unavailable", because the node, its ports and its cables are all
 * still real when the browser has no MIDI bridge.
 */

import { useEffect, useCallback, useRef } from 'react';
import type { GraphNode, MIDIInputNodeData, PortDefinition } from '../../engine/types';
import { useMIDIStore } from '../../store/midiStore';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { Button, NodeFrame, NodeShell, PortRow } from '@openjammer/oj-ui';
import './MIDINode.css';
import './MiniLab3Visual.css';

interface MiniLab3NodeProps {
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

export function MiniLab3Node({
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
}: MiniLab3NodeProps) {
    const data = node.data as MIDIInputNodeData;

    const isSupported = useMIDIStore((s) => s.isSupported);
    const inputs = useMIDIStore((s) => s.inputs);
    const openBrowser = useMIDIStore((s) => s.openBrowser);
    const isAgentPending = useIsAgentPending(node.id);

    const connectedDevice = data.deviceId ? inputs.get(data.deviceId) : null;
    const isConnected = Boolean(data.isConnected && data.deviceId && connectedDevice?.state === 'connected');

    // Re-propagate deviceId to children when it changes (page reload, late connect).
    // `{ record: false }` — the same environment-driven repair as `MIDINode`'s: the
    // fan-out to the child midi-visual is a real graph mutation, so without the
    // opt-out a reload minted an undo entry the player never authored.
    const lastPropagatedDeviceId = useRef<string | null>(null);
    useEffect(() => {
        if (!node.childIds.length) return;
        if (!data.deviceId) return;
        if (lastPropagatedDeviceId.current === data.deviceId) return;
        useGraphStore.getState().updateNodeData(node.id, {
            deviceId: data.deviceId,
            presetId: data.presetId,
        }, { record: false });
        lastPropagatedDeviceId.current = data.deviceId;
    }, [node.id, node.childIds.length, data.deviceId, data.presetId]);

    const handleDeviceClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        openBrowser();
    }, [openBrowser]);

    const socket = (port: PortDefinition) => (
        <PortRow
            key={port.id}
            side={port.direction}
            kind={port.type}
            connected={!!hasConnection?.(port.id)}
            label={port.name}
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

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`ml3-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className="minilab3-node"
                title="MiniLab 3"
                nodeType="ARTURIA"
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{ onMouseDown: handleHeaderMouseDown }}
                inputs={node.ports.filter((p) => p.direction === 'input' && p.name).map(socket)}
                outputs={node.ports.filter((p) => p.direction === 'output' && p.name).map(socket)}
            >
                {!isSupported ? (
                    <p className="midi-state is-blocked">
                        Web MIDI is unavailable in this browser. The cables stay wired —
                        open OpenJammer in Chrome, Edge or Firefox to play the hardware.
                    </p>
                ) : isConnected ? (
                    <p className="midi-state is-live" title={connectedDevice?.name ?? undefined}>
                        {connectedDevice?.name ?? 'MiniLab 3'} connected
                    </p>
                ) : (
                    <Button variant="node" className="midi-connect" onClick={handleDeviceClick}>
                        Connect a device
                    </Button>
                )}
            </NodeShell>
        </NodeFrame>
    );
}

export default MiniLab3Node;
