/**
 * MIDI Node - MIDI controller input
 *
 * Connects to MIDI devices via Web MIDI API
 * Supports device presets for known controllers (MiniLab 3, etc.)
 * Falls back to generic mode for unknown devices
 *
 * Design: Hierarchical node with internal canvas structure
 * Press E to dive into internal canvas and see per-control routing
 *
 * Outer view: Shows device name, connect button, and bundle outputs
 * Inner view: Shows full visual with per-control ports
 *
 * Device names are auto-generated (e.g., "MiniLab 3", "MiniLab 3 2")
 * and can be renamed by double-clicking the title
 */

import { useEffect, useCallback, useRef, useState, memo } from 'react';
import type { GraphNode, MIDIInputNodeData } from '../../engine/types';
import { useMIDIStore } from '../../store/midiStore';
import { useGraphStore } from '../../store/graphStore';
import { getPresetRegistry } from '../../midi';
import { Port } from '@openjammer/oj-ui';
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
    style
}: MIDINodeProps) {
    const data = node.data as MIDIInputNodeData;

    // MIDI store state (initialization is handled by MIDIIntegration component)
    const isSupported = useMIDIStore((s) => s.isSupported);
    const inputs = useMIDIStore((s) => s.inputs);
    const openBrowser = useMIDIStore((s) => s.openBrowser);
    const renameDevice = useMIDIStore((s) => s.renameDevice);

    // Graph store for updating node data
    const updateNodeData = useGraphStore((s) => s.updateNodeData);

    // Rename mode state
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);

    // Get preset info
    const registry = getPresetRegistry();
    const preset = data.presetId ? registry.getPreset(data.presetId) : null;
    const presetName = preset?.name ?? 'MIDI';

    // Display name: use signature deviceName if available, else preset name
    const displayName = data.deviceSignature?.deviceName ?? presetName;

    // Get connected device info
    // Safety check: require both deviceId AND isConnected to be true, plus actual device state
    const connectedDevice = data.deviceId ? inputs.get(data.deviceId) : null;
    const isConnected = data.isConnected && data.deviceId && connectedDevice?.state === 'connected';

    // Track last propagated deviceId to re-propagate when it changes
    // This fixes the bug where deviceId set after mount never gets propagated
    const lastPropagatedDeviceId = useRef<string | null>(null);

    // Re-propagate deviceId to children when it changes (handles page reload and device connect cases)
    // This ensures internal midi-visual nodes get the deviceId even if it wasn't saved
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

    // Handle clicking connect button to open browser
    const handleConnectClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        openBrowser(node.id);  // Pass node ID so browser knows which node to update
    }, [openBrowser, node.id]);

    // Handle double-click on title to start renaming
    const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!data.deviceId || !data.deviceSignature) return; // Can't rename if no device
        setRenameValue(data.deviceSignature.deviceName);
        setIsRenaming(true);
    }, [data.deviceId, data.deviceSignature]);

    // Focus input when rename mode starts
    useEffect(() => {
        if (isRenaming && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [isRenaming]);

    // Handle rename submission
    const handleRenameSubmit = useCallback(() => {
        if (!data.deviceId || !data.deviceSignature || !renameValue.trim()) {
            setIsRenaming(false);
            return;
        }

        const newName = renameValue.trim();
        if (newName === data.deviceSignature.deviceName) {
            setIsRenaming(false);
            return;
        }

        // Try to rename in store
        const success = renameDevice(data.deviceId, newName);
        if (success) {
            // Update node's signature
            updateNodeData(node.id, {
                deviceSignature: {
                    ...data.deviceSignature,
                    deviceName: newName
                }
            });
        }
        setIsRenaming(false);
    }, [data.deviceId, data.deviceSignature, renameValue, renameDevice, updateNodeData, node.id]);

    // Handle rename input keydown
    const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            handleRenameSubmit();
        } else if (e.key === 'Escape') {
            setIsRenaming(false);
        }
    }, [handleRenameSubmit]);

    // Don't render if Web MIDI not supported
    if (!isSupported) {
        return (
            <div
                className={`midi-node schematic-node midi-unsupported ${isSelected ? 'selected' : ''}`}
                style={style}
                onMouseEnter={handleNodeMouseEnter}
                onMouseLeave={handleNodeMouseLeave}
            >
                <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                    <span className="schematic-title">{presetName}</span>
                </div>
                <div className="midi-unsupported-message">
                    <span>Web MIDI not supported</span>
                    <span className="midi-browser-hint">Use Chrome, Edge, or Firefox</span>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`midi-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header with device name (double-click to rename) */}
            <div
                className="schematic-header"
                onMouseDown={handleHeaderMouseDown}
            >
                {isRenaming ? (
                    <input
                        ref={renameInputRef}
                        className="midi-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={handleRenameSubmit}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span
                        className="schematic-title"
                        onDoubleClick={handleTitleDoubleClick}
                        title={data.deviceSignature ? 'Double-click to rename' : presetName}
                    >
                        {displayName}
                    </span>
                )}
            </div>

            {/* Body - matches keyboard node style */}
            <div className="keyboard-schematic-body">
                {/* Connect button - only shows when not connected */}
                {!isConnected && (
                    <button
                        className="midi-connect-btn"
                        onClick={handleConnectClick}
                        title="Connect MIDI device"
                    >
                        Connect
                    </button>
                )}

                {/* Render ports dynamically (auto-synced from internal canvas-input/output nodes) */}
                {node.ports.map((port) => (
                    <div key={port.id} className={`port-row ${port.direction}`}>
                        <span className="port-label">{port.name}</span>
                        <Port
                            kind={port.type}
                            direction={port.direction}
                            connected={!!hasConnection?.(port.id)}
                            {...(port.resolvedType ? { resolvedKind: port.resolvedType } : {})}
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
});
