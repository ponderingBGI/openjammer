/**
 * MIDI Node — a hardware controller as a graph citizen.
 *
 * The card says three things, in this order: what device it is, whether that
 * device is actually there, and what leaves it (`KEYS / PADS / KNOBS / FADERS /
 * PITCH / MOD`). Press `E` to dive in and see the controls themselves.
 *
 * Wave 5 / P8 rebuild:
 *  · `NodeShell` + `PortRow` — the same card and the same socket as every other
 *    node, instead of a hand-rolled header and a `.port-row` copy.
 *  · Connection is a CHIP, not a dot: `--success-ink` text saying the device
 *    name. The New DNA drops dots inside chips (a colour with no label is not a
 *    signal, it is decoration).
 *  · Rename is the shared `EditableLabel`.
 *  · **The sockets survive "Web MIDI unavailable."** The node used to replace
 *    its entire body with an apology, so a graph you had already wired lost every
 *    visible port the moment you opened it in a browser without Web MIDI. The
 *    node exists, the ports exist, the cables exist — only the hardware is
 *    missing, and that is what it now says.
 */

import { useEffect, useCallback, useRef, useState, memo } from 'react';
import type { GraphNode, MIDIInputNodeData, PortDefinition } from '../../engine/types';
import { useMIDIStore } from '../../store/midiStore';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { getPresetRegistry } from '../../midi';
import { Button, EditableLabel, NodeFrame, NodeShell, PortRow, ValueScrubber } from '@openjammer/oj-ui';
import './MIDINode.css';

interface MIDINodeProps {
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

export const MIDINode = memo(function MIDINode({
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
}: MIDINodeProps) {
    const data = node.data as MIDIInputNodeData;

    const isSupported = useMIDIStore((s) => s.isSupported);
    const inputs = useMIDIStore((s) => s.inputs);
    const openBrowser = useMIDIStore((s) => s.openBrowser);
    const renameDevice = useMIDIStore((s) => s.renameDevice);
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const isAgentPending = useIsAgentPending(node.id);

    const [isRenaming, setIsRenaming] = useState(false);

    const registry = getPresetRegistry();
    const preset = data.presetId ? registry.getPreset(data.presetId) : null;
    const presetName = preset?.name ?? 'MIDI';
    const displayName = data.deviceSignature?.deviceName ?? presetName;

    // A device counts as connected only when the node points at one AND the
    // browser still reports it. Two half-truths do not make a connection.
    const connectedDevice = data.deviceId ? inputs.get(data.deviceId) : null;
    const isConnected = Boolean(data.isConnected && data.deviceId && connectedDevice?.state === 'connected');

    // Re-propagate deviceId to children when it changes (page reload, late connect),
    // so the internal midi-visual sees the device even if it was never saved.
    const lastPropagatedDeviceId = useRef<string | null>(null);
    useEffect(() => {
        if (!node.childIds.length) return;
        if (!data.deviceId) return;
        if (lastPropagatedDeviceId.current === data.deviceId) return;
        useGraphStore.getState().updateNodeData(node.id, {
            deviceId: data.deviceId,
            presetId: data.presetId,
        });
        lastPropagatedDeviceId.current = data.deviceId;
    }, [node.id, node.childIds.length, data.deviceId, data.presetId]);

    const handleConnectClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        openBrowser(node.id);
    }, [openBrowser, node.id]);

    const canRename = Boolean(data.deviceId && data.deviceSignature);

    const handleRename = useCallback((next: string) => {
        setIsRenaming(false);
        const signature = data.deviceSignature;
        if (!data.deviceId || !signature || !next || next === signature.deviceName) return;
        if (!renameDevice(data.deviceId, next)) return;
        updateNodeData(node.id, { deviceSignature: { ...signature, deviceName: next } });
    }, [data.deviceId, data.deviceSignature, renameDevice, updateNodeData, node.id]);

    const activeChannel = data.activeChannel ?? 0;
    const setChannel = useCallback((next: number) => {
        if (!Number.isFinite(next)) return;
        const clamped = Math.max(0, Math.min(16, Math.round(next)));
        if (clamped === activeChannel) return;
        updateNodeData(node.id, { activeChannel: clamped });
    }, [activeChannel, updateNodeData, node.id]);

    const socket = (port: PortDefinition) => (
        <PortRow
            key={port.id}
            side={port.direction}
            kind={port.type}
            connected={!!hasConnection?.(port.id)}
            {...(port.resolvedType ? { resolvedKind: port.resolvedType } : {})}
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
            className={`midi-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className={`midi-node${isSupported ? '' : ' is-unsupported'}`}
                title={
                    canRename ? (
                        <EditableLabel
                            className="midi-name"
                            value={displayName}
                            editing={isRenaming}
                            onCommit={handleRename}
                            onCancel={() => setIsRenaming(false)}
                        />
                    ) : (
                        displayName
                    )
                }
                nodeType="MIDI"
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{
                    onMouseDown: handleHeaderMouseDown,
                    onDoubleClick: canRename ? () => setIsRenaming(true) : undefined,
                    title: canRename ? 'Double-click to rename this device' : presetName,
                }}
                inputs={node.ports.filter((p) => p.direction === 'input').map(socket)}
                outputs={node.ports.filter((p) => p.direction === 'output').map(socket)}
            >
                {!isSupported ? (
                    <p className="midi-state is-blocked">
                        Web MIDI is unavailable in this browser. The cables stay wired —
                        open OpenJammer in Chrome, Edge or Firefox to play the hardware.
                    </p>
                ) : isConnected ? (
                    <p className="midi-state is-live" title={connectedDevice?.name ?? undefined}>
                        {connectedDevice?.name ?? displayName} connected
                    </p>
                ) : (
                    <Button variant="node" className="midi-connect" onClick={handleConnectClick}>
                        Connect a device
                    </Button>
                )}

                {/* The channel filter the voice router actually reads
                    (`MIDIVoiceRouter.channelMatches`): 0 is omni, 1-16 pick one.
                    It has been a live engine parameter with no way to set it —
                    a production line nothing used. */}
                <div className="midi-params">
                    <ValueScrubber
                        label="CHANNEL"
                        value={activeChannel}
                        display={activeChannel === 0 ? 'OMNI' : String(activeChannel)}
                        onCommit={setChannel}
                    />
                </div>
            </NodeShell>
        </NodeFrame>
    );
});
