/**
 * MiniLab 3 Node - Container for Arturia MiniLab 3 MIDI Controller
 *
 * Press E to enter and see the full visual representation with per-control ports.
 * Shows synced output ports from internal output-panel (Keys bundle by default).
 *
 * MIDI connection is managed here. Device selection persists with the node.
 */

import { useEffect, useCallback, useRef } from 'react';
import type { GraphNode, MIDIInputNodeData } from '../../engine/types';
import { useMIDIStore } from '../../store/midiStore';
import { useGraphStore } from '../../store/graphStore';
import { Port } from '@openjammer/oj-ui';
import './MIDIVisualNode.css';

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
    style
}: MiniLab3NodeProps) {
    const data = node.data as MIDIInputNodeData;

    // MIDI store state (initialization is handled by MIDIIntegration component)
    const isSupported = useMIDIStore((s) => s.isSupported);
    const inputs = useMIDIStore((s) => s.inputs);
    const openBrowser = useMIDIStore((s) => s.openBrowser);

    // Get connected device info
    // Safety check: require both deviceId AND isConnected to be true, plus actual device state
    const connectedDevice = data.deviceId ? inputs.get(data.deviceId) : null;
    const isConnected = data.isConnected && data.deviceId && connectedDevice?.state === 'connected';

    // Track last propagated deviceId to re-propagate when it changes
    // This fixes the bug where deviceId set after mount never gets propagated
    const lastPropagatedDeviceId = useRef<string | null>(null);

    // Re-propagate deviceId to children when it changes (handles page reload and device connect cases)
    // This ensures internal minilab3-visual nodes get the deviceId even if it wasn't saved
    useEffect(() => {
        // Skip if no children to propagate to
        if (!node.childIds.length) return;

        // Skip if no deviceId (half-connected state - nothing to propagate yet)
        if (!data.deviceId) return;

        // Skip if we already propagated this deviceId
        if (lastPropagatedDeviceId.current === data.deviceId) return;

        // Trigger updateNodeData to propagate deviceId to children
        const updateNodeData = useGraphStore.getState().updateNodeData;
        updateNodeData(node.id, {
            deviceId: data.deviceId,
            presetId: data.presetId
        });
        lastPropagatedDeviceId.current = data.deviceId;
    }, [node.id, node.childIds.length, data.deviceId, data.presetId]);

    // Handle clicking on the header to open MIDI device browser
    const handleDeviceClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        openBrowser();
    }, [openBrowser]);

    // Don't render if Web MIDI not supported
    if (!isSupported) {
        return (
            <div
                className={`minilab3-node keyboard-node schematic-node midi-unsupported ${isSelected ? 'selected' : ''}`}
                style={style}
                onMouseEnter={handleNodeMouseEnter}
                onMouseLeave={handleNodeMouseLeave}
            >
                <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                    <span className="schematic-title">MiniLab 3</span>
                </div>
                <div className="keyboard-schematic-body">
                    <div className="midi-unsupported-message">
                        <span>Web MIDI not supported</span>
                        <span className="midi-browser-hint">Use Chrome, Edge, or Firefox</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`minilab3-node keyboard-node schematic-node ${isConnected ? 'connected' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header - draggable */}
            <div
                className="schematic-header"
                onMouseDown={handleHeaderMouseDown}
            >
                <span className="schematic-title">MiniLab 3</span>
                {isConnected && (
                    <div
                        className="midi-status-dot connected"
                        title={`Connected: ${connectedDevice?.name || 'Unknown device'}`}
                    />
                )}
            </div>

            {/* Body - Show synced ports from internal canvas (same layout as keyboard node) */}
            <div className="keyboard-schematic-body">
                {/* Connect button - only shows when not connected */}
                {!isConnected && (
                    <button
                        className="minilab3-connect-btn schematic-connect-btn"
                        onClick={handleDeviceClick}
                        title="Connect MIDI device"
                    >
                        Connect
                    </button>
                )}

                {/* Render ports dynamically (auto-synced from internal output-panel) */}
                {node.ports.filter(p => p.direction === 'output' && p.name).map((port) => (
                    <div key={port.id} className={`port-row ${port.direction}`}>
                        <span className="port-label">{port.name}</span>
                        <Port
                            kind={port.type}
                            direction="output"
                            connected={!!hasConnection?.(port.id)}
                            style={{ width: '20px', height: '20px' }}
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
                ))}
            </div>
        </div>
    );
}

export default MiniLab3Node;
