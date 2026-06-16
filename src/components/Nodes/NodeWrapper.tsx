/**
 * Node Wrapper - Handles node positioning, selection, and dragging
 */

import { useCallback, useRef, useState, useMemo, useEffect, memo } from 'react';
import type { GraphNode, Position } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { generateUniqueId } from '../../utils/idGenerator';
import { InstrumentNode } from './InstrumentNode';
import { MicrophoneNode } from './MicrophoneNode';
import { KeyboardNode } from './KeyboardNode';
import { KeyboardVisualNode } from './KeyboardVisualNode';
import { InstrumentVisualNode } from './InstrumentVisualNode';
import { LooperNode } from './LooperNode';
import { EffectNode } from './EffectNode';
import { AmplifierNode } from './AmplifierNode';
import { SpeakerNode } from './SpeakerNode';
import { RecorderNode } from './RecorderNode';
import { CanvasIONode } from './CanvasIONode';
import { OutputPanelNode } from './OutputPanelNode';
import { InputPanelNode } from './InputPanelNode';
import { ContainerNode } from './ContainerNode';
import { MathNode } from './MathNode';
import { LibraryNode } from './LibraryNode';
import { MIDINode } from './MIDINode';
import { MIDIVisualNode } from './MIDIVisualNode';
import { MiniLab3Node } from './MiniLab3Node';
import { MiniLab3VisualNode } from './MiniLab3VisualNode';
import { SamplerNode } from './SamplerNode';
import { SamplerVisualNode } from './SamplerVisualNode';
import { AutoParamPanel } from '../params/AutoParamPanel';
import { manifestFor, manifestForDynamic } from '../../engine/manifest';
import { resolveNodeDefinition } from '../../engine/registry';
import { getDynamicPlugin } from '../../engine/dynamicRegistry';
import './BaseNode.css';

interface NodeWrapperProps {
    node: GraphNode;
}

// Schematic nodes render their own container - no wrapper needed
const SCHEMATIC_TYPES = [
    'keyboard',
    'keyboard-visual',
    'instrument-visual',
    'midi',
    'midi-visual',
    'minilab-3',
    'minilab3-visual',
    'piano', 'cello', 'electricCello', 'violin', 'saxophone', 'strings', 'keys', 'winds',
    'speaker',
    'looper',
    'microphone',
    'canvas-input',
    'canvas-output',
    'output-panel',
    'input-panel',
    'container',
    'add',
    'subtract',
    'library',
    'sampler',
    'sampler-visual'
];

export const NodeWrapper = memo(function NodeWrapper({ node }: NodeWrapperProps) {
    const nodeRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef<Position>({ x: 0, y: 0 });
    const nodeStart = useRef<Position>({ x: 0, y: 0 });

    // Store cleanup function for drag handlers to prevent memory leaks on unmount
    const dragCleanupRef = useRef<(() => void) | null>(null);

    // Cleanup drag handlers on unmount
    useEffect(() => {
        return () => {
            if (dragCleanupRef.current) {
                dragCleanupRef.current();
                dragCleanupRef.current = null;
            }
        };
    }, []);

    const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
    const selectNode = useGraphStore((s) => s.selectNode);
    const updateNodePosition = useGraphStore((s) => s.updateNodePosition);
    const connections = useGraphStore((s) => s.connections);
    const addConnection = useGraphStore((s) => s.addConnection);

    const zoom = useCanvasStore((s) => s.zoom);
    const startConnecting = useCanvasStore((s) => s.startConnecting);
    const stopConnecting = useCanvasStore((s) => s.stopConnecting);
    const isConnecting = useCanvasStore((s) => s.isConnecting);
    const connectingFrom = useCanvasStore((s) => s.connectingFrom);
    const hoverTarget = useCanvasStore((s) => s.hoverTarget);
    const setHoverTarget = useCanvasStore((s) => s.setHoverTarget);

    const isSelected = selectedNodeIds.has(node.id);
    const isSchematic = SCHEMATIC_TYPES.includes(node.type);

    // Check if this node is being hovered while connections are active
    const isHoveredWithConnections = isConnecting && hoverTarget?.nodeId === node.id;

    // Count incoming connections (for dynamic port display)
    const incomingConnectionCount = useMemo(() => {
        if (!isConnecting || !connectingFrom) return 0;
        return connectingFrom.length;
    }, [isConnecting, connectingFrom]);

    // Hover handlers for connection drop targeting
    const handleNodeMouseEnter = useCallback(() => {
        if (isConnecting) {
            setHoverTarget(node.id);
        }
    }, [isConnecting, setHoverTarget, node.id]);

    const handleNodeMouseLeave = useCallback(() => {
        if (isConnecting) {
            setHoverTarget(null);
        }
    }, [isConnecting, setHoverTarget]);

    // Precompute connected ports Set for O(1) lookup instead of O(n) per port check
    const connectedPorts = useMemo(() => {
        const set = new Set<string>();
        connections.forEach(conn => {
            if (conn.sourceNodeId === node.id) set.add(conn.sourcePortId);
            if (conn.targetNodeId === node.id) set.add(conn.targetPortId);
        });
        return set;
    }, [connections, node.id]);

    // Check if a port has connections - O(1) lookup
    const hasConnection = useCallback((portId: string) => {
        return connectedPorts.has(portId);
    }, [connectedPorts]);

    // Handle node header drag
    const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();

        selectNode(node.id, e.shiftKey);
        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY };
        nodeStart.current = { ...node.position };

        const handleMouseMove = (e: MouseEvent) => {
            const dx = (e.clientX - dragStart.current.x) / zoom;
            const dy = (e.clientY - dragStart.current.y) / zoom;

            updateNodePosition(node.id, {
                x: nodeStart.current.x + dx,
                y: nodeStart.current.y + dy
            });
        };

        const cleanup = () => {
            setIsDragging(false);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            dragCleanupRef.current = null;
        };

        const handleMouseUp = () => {
            cleanup();
        };

        // Store cleanup function so it can be called on unmount
        dragCleanupRef.current = cleanup;

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [node.id, node.position, zoom, selectNode, updateNodePosition]);

    // Handle port mouse down - start connection dragging (with pending disconnect)
    const handlePortMouseDown = useCallback((portId: string, e: React.MouseEvent) => {
        if (e.button !== 0) return; // Only left click
        e.stopPropagation();

        // If not already connecting, start a new connection
        const currentIsConnecting = useCanvasStore.getState().isConnecting;
        if (!currentIsConnecting) {
            // Check if this port has an existing connection - if so, store it for pending disconnect
            const currentConnections = useGraphStore.getState().connections;
            const port = node.ports.find(p => p.id === portId);
            let pendingDisconnectId: string | undefined;

            if (port) {
                // Find existing connection on this port
                const existingConnection = Array.from(currentConnections.values()).find(conn => {
                    if (port.direction === 'output') {
                        return conn.sourceNodeId === node.id && conn.sourcePortId === portId;
                    } else {
                        return conn.targetNodeId === node.id && conn.targetPortId === portId;
                    }
                });

                if (existingConnection) {
                    // Store for pending disconnect (will be removed when new connection confirmed)
                    pendingDisconnectId = existingConnection.id;
                }
            }

            // Start new connection from this port (with optional pending disconnect)
            startConnecting(node.id, portId, pendingDisconnectId);
        }
    }, [node.id, node.ports, startConnecting]);

    // Handle port mouse up - complete connection if dragging to a different port
    const handlePortMouseUp = useCallback((portId: string, e: React.MouseEvent) => {
        e.stopPropagation();

        // Read current connecting state directly from store to avoid stale closure
        const currentIsConnecting = useCanvasStore.getState().isConnecting;
        const currentConnectingFrom = useCanvasStore.getState().connectingFrom;

        if (currentIsConnecting && currentConnectingFrom) {
            const sources = Array.isArray(currentConnectingFrom) ? currentConnectingFrom : [currentConnectingFrom];

            // If releasing on the same port we started from, do nothing (allow click-to-connect)
            if (sources.length === 1 && sources[0].nodeId === node.id && sources[0].portId === portId) {
                // Don't stop connecting - user clicked a port to start, they'll click another to finish
                return;
            }

            const updateNodePorts = useGraphStore.getState().updateNodePorts;
            const isInstrument = ['piano', 'cello', 'electricCello', 'violin', 'saxophone', 'strings', 'keys', 'winds', 'sampler'].includes(node.type);

            // Check if clicking on a ghost port (not yet persisted)
            const isGhostPort = portId.startsWith('ghost-input-');
            let actualFirstPortId = portId;

            if (isGhostPort && isInstrument) {
                // Extract the ghost port index
                const ghostIndex = parseInt(portId.replace('ghost-input-', ''), 10);
                const currentInputs = node.ports.filter(p => p.direction === 'input' && p.type === 'control');

                // Create all needed ports up to and including the ghost port index
                const newPorts = [...node.ports];
                const portsToAdd = (ghostIndex + 1) - currentInputs.length;

                const newPortIds: string[] = [];
                for (let i = 0; i < portsToAdd; i++) {
                    const nextIndex = currentInputs.length + i + 1;
                    const newPortId = generateUniqueId('input-');
                    newPortIds.push(newPortId);
                    newPorts.push({
                        id: newPortId,
                        name: `In ${nextIndex}`,
                        type: 'control',
                        direction: 'input'
                    });
                }

                // Persist the new ports
                updateNodePorts(node.id, newPorts);

                // The clicked ghost port is now the last one we added
                actualFirstPortId = newPortIds[newPortIds.length - 1];
            }

            // Get target port (now that ghost ports are persisted if needed)
            const updatedNode = useGraphStore.getState().nodes.get(node.id) || node;
            const targetPort = isGhostPort
                ? updatedNode.ports.find(p => p.id === actualFirstPortId)
                : updatedNode.ports.find(p => p.id === portId);

            if (!targetPort) return;

            // Check if we need to auto-expand for multiple connections
            if (isInstrument && targetPort.direction === 'input' && sources.length > 1) {
                const currentInputs = updatedNode.ports.filter(p => p.direction === 'input' && p.type === 'control');
                const clickedIndex = currentInputs.findIndex(p => p.id === actualFirstPortId);

                if (clickedIndex === -1) return;

                const neededCount = clickedIndex + sources.length;
                const availableCount = currentInputs.length;

                if (neededCount > availableCount) {
                    const newPorts = [...updatedNode.ports];
                    const portsToAdd = neededCount - availableCount;

                    for (let i = 0; i < portsToAdd; i++) {
                        const nextIndex = availableCount + i + 1;
                        newPorts.push({
                            id: generateUniqueId('input-'),
                            name: `In ${nextIndex}`,
                            type: 'control',
                            direction: 'input'
                        });
                    }

                    updateNodePorts(node.id, newPorts);
                }
            }

            // Get final updated node and inputs after all port additions
            const finalNode = useGraphStore.getState().nodes.get(node.id) || updatedNode;
            const finalInputs = finalNode.ports.filter(p => p.direction === 'input' && p.type === 'control');

            sources.forEach((source, index) => {
                let actualTargetPortId = actualFirstPortId;

                if (index > 0 && targetPort.direction === 'input' && isInstrument) {
                    const clickedIndex = finalInputs.findIndex(p => p.id === actualFirstPortId);
                    if (clickedIndex !== -1 && (clickedIndex + index) < finalInputs.length) {
                        actualTargetPortId = finalInputs[clickedIndex + index].id;
                    } else {
                        return;
                    }
                }

                if (targetPort.direction === 'input') {
                    addConnection(source.nodeId, source.portId, node.id, actualTargetPortId);
                } else {
                    addConnection(node.id, actualTargetPortId, source.nodeId, source.portId);
                }
            });

            // Remove pending disconnect connection now that new connection is confirmed
            const pendingDisconnect = useCanvasStore.getState().pendingDisconnect;
            if (pendingDisconnect) {
                useGraphStore.getState().removeConnection(pendingDisconnect);
            }

            stopConnecting();
        }
    }, [node, addConnection, stopConnecting]);

    // Handle port hover for connection targeting and 'A' key selection
    const handlePortMouseEnter = useCallback((portId: string) => {
        const port = node.ports.find(p => p.id === portId);
        if (port) {
            // Always set hover target with port type info (for 'A' key detection)
            setHoverTarget(node.id, portId, port.type, port.direction);
        }
    }, [node.id, node.ports, setHoverTarget]);

    const handlePortMouseLeave = useCallback(() => {
        // Clear port hover (only clear when leaving port, not just when connecting)
        setHoverTarget(null);
    }, [setHoverTarget]);

    // Common props for schematic nodes - memoized to prevent unnecessary re-renders
    const schematicProps = useMemo(() => ({
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
        isHoveredWithConnections,
        incomingConnectionCount,
        style: {
            left: node.position.x,
            top: node.position.y
        }
    }), [
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
        isHoveredWithConnections,
        incomingConnectionCount
    ]);

    // For schematic nodes, render the component directly without wrapper
    if (isSchematic) {
        switch (node.type) {
            case 'keyboard':
                return <KeyboardNode {...schematicProps} />;
            case 'keyboard-visual':
                return <KeyboardVisualNode {...schematicProps} />;
            case 'instrument-visual':
                return <InstrumentVisualNode {...schematicProps} />;
            case 'midi':
                return <MIDINode {...schematicProps} />;
            case 'midi-visual':
                return <MIDIVisualNode {...schematicProps} />;
            case 'minilab-3':
                return <MiniLab3Node {...schematicProps} />;
            case 'minilab3-visual':
                return <MiniLab3VisualNode {...schematicProps} />;
            case 'piano':
            case 'cello':
            case 'electricCello':
            case 'violin':
            case 'saxophone':
            case 'strings':
            case 'keys':
            case 'winds':
                return <InstrumentNode {...schematicProps} />;
            case 'speaker':
                return <SpeakerNode {...schematicProps} />;
            case 'looper':
                return <LooperNode {...schematicProps} />;
            case 'microphone':
                return <MicrophoneNode {...schematicProps} />;
            case 'canvas-input':
            case 'canvas-output':
                return <CanvasIONode {...schematicProps} />;
            case 'output-panel':
                return <OutputPanelNode {...schematicProps} />;
            case 'input-panel':
                return <InputPanelNode {...schematicProps} />;
            case 'container':
                return <ContainerNode {...schematicProps} />;
            case 'add':
            case 'subtract':
                return <MathNode {...schematicProps} />;
            case 'library':
                return <LibraryNode {...schematicProps} />;
            case 'sampler':
                return <SamplerNode {...schematicProps} />;
            case 'sampler-visual':
                return <SamplerVisualNode {...schematicProps} />;
        }
    }

    // Standard nodes with wrapper
    const inputPorts = node.ports.filter(p => p.direction === 'input');
    const outputPorts = node.ports.filter(p => p.direction === 'output');

    // M5: resolve the DISPLAY definition — prefers the OPEN dynamic plugin (set via
    // node.pluginId) so an AI-authored node shows its own name; falls back to the
    // closed `type` for ordinary built-ins. Title-cased type is the last resort.
    const displayDefinition = resolveNodeDefinition(node);
    const headerTitle =
        node.pluginId !== undefined
            ? displayDefinition.name
            : node.type.charAt(0).toUpperCase() + node.type.slice(1);

    const renderNodeContent = () => {
        // M6: an AI-authored code node carries an OPEN `pluginId` resolving to a
        // dynamic plugin with `ui:'auto'` + the node's REAL compiled params. Render
        // those via the FREE AutoParamPanel (the wasm code-node identity), instead
        // of the bespoke EffectNode the closed `effect` type would otherwise pick.
        if (node.pluginId !== undefined) {
            const dynamic = getDynamicPlugin(node.pluginId);
            if (dynamic) {
                const dynManifest = manifestForDynamic(node.pluginId, dynamic);
                if (dynManifest.params.length > 0) {
                    return <AutoParamPanel node={node} manifest={dynManifest} />;
                }
            }
        }
        switch (node.type) {
            case 'effect':
                return <EffectNode node={node} />;
            case 'amplifier':
                return <AmplifierNode node={node} />;
            case 'recorder':
                return <RecorderNode node={node} />;
            default: {
                // Additive manifest fallback: any node type WITHOUT a bespoke
                // React component (ui:'auto') gets the FREE AutoParamPanel UI
                // derived from its manifest — this is how AI/Faust-authored
                // nodes render with zero hand-written components.
                const manifest = manifestFor(node.type);
                if (manifest.ui === 'auto') {
                    return <AutoParamPanel node={node} manifest={manifest} />;
                }
                return <div>Unknown node type</div>;
            }
        }
    };

    return (
        <div
            ref={nodeRef}
            className={`node ${node.type} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={{
                left: node.position.x,
                top: node.position.y
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div className="node-header" onMouseDown={handleHeaderMouseDown}>
                <span className="node-title">{headerTitle}</span>
                <span className="node-type">{node.category}</span>
            </div>

            {/* Ports */}
            <div className="node-ports">
                <div className="node-ports-left">
                    {inputPorts.map((port) => (
                        <div
                            key={port.id}
                            className={`port port-input`}
                            onMouseDown={(e) => handlePortMouseDown(port.id, e)}
                            onMouseUp={(e) => handlePortMouseUp(port.id, e)}
                            onMouseEnter={() => handlePortMouseEnter(port.id)}
                            onMouseLeave={handlePortMouseLeave}
                        >
                            <div
                                className={`port-dot ${port.type === 'audio' ? 'audio-input' : 'control'} ${hasConnection(port.id) ? 'connected' : ''}`}
                                data-node-id={node.id}
                                data-port-id={port.id}
                            />
                            {!port.hideExternalLabel && <span className="port-label">{port.name}</span>}
                        </div>
                    ))}
                </div>

                <div className="node-ports-right">
                    {outputPorts.map((port) => (
                        <div
                            key={port.id}
                            className={`port port-output`}
                            onMouseDown={(e) => handlePortMouseDown(port.id, e)}
                            onMouseUp={(e) => handlePortMouseUp(port.id, e)}
                            onMouseEnter={() => handlePortMouseEnter(port.id)}
                            onMouseLeave={handlePortMouseLeave}
                        >
                            {!port.hideExternalLabel && <span className="port-label">{port.name}</span>}
                            <div
                                className={`port-dot ${port.type === 'audio' ? 'audio-output' : 'control'} ${hasConnection(port.id) ? 'connected' : ''}`}
                                data-node-id={node.id}
                                data-port-id={port.id}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="node-content">
                {renderNodeContent()}
            </div>
        </div>
    );
});
