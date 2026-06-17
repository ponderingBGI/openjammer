/**
 * Input Panel Node - Multi-port input panel with editable labels
 *
 * Used inside hierarchical nodes to receive external signals
 * Mirror of OutputPanelNode: labels on left, ports on right
 * Empty by default - ports added dynamically
 *
 * Supports bundle ports with expandable/collapsible visualization.
 */

import { useState, useCallback, useMemo, memo } from 'react';
import type { GraphNode, BundlePortDefinition } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { BundlePortGroup } from '../BundlePortGroup';
import { isBundlePort, isEmptyPort } from '../../utils/bundleManager';
import './SchematicNodes.css';

interface InputPanelNodeProps {
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

export const InputPanelNode = memo(function InputPanelNode({
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
}: InputPanelNodeProps) {
    const [editingPort, setEditingPort] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const updateNodePorts = useGraphStore((s) => s.updateNodePorts);
    const flashingNodes = useUIFeedbackStore((s) => s.flashingNodes);
    const isFlashing = flashingNodes.has(node.id);

    // Get port labels from node data - memoized to prevent re-renders
    const portLabels = useMemo(
        () => (node.data.portLabels as Record<string, string>) || {},
        [node.data.portLabels]
    );

    // Separate ports into categories:
    // - Bundle ports (have bundleInfo)
    // - Regular ports (have label)
    // - Empty slot port (always show one at the end)
    const { bundlePorts, regularPorts, emptySlotPort } = useMemo(() => {
        const bundles: BundlePortDefinition[] = [];
        const regular: typeof node.ports = [];
        let emptySlot: (typeof node.ports)[0] | null = null;

        for (const port of node.ports) {
            if (port.direction !== 'output') continue;

            // Check if it's a bundle port
            if (isBundlePort(port)) {
                bundles.push(port as BundlePortDefinition);
            } else if (isEmptyPort(port)) {
                // Keep one empty slot
                if (!emptySlot) emptySlot = port;
            } else {
                // Regular port with label
                regular.push(port);
            }
        }

        return {
            bundlePorts: bundles,
            regularPorts: regular,
            emptySlotPort: emptySlot
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only node.ports is read; depending on the whole node would recompute on unrelated node changes (position, selection)
    }, [node.ports]);

    // Callback for when bundle expansion is toggled
    const handleBundleToggle = useCallback((portId: string, expanded: boolean) => {
        // Update the port's bundleInfo.expanded state
        const newPorts = node.ports.map(p => {
            if (p.id !== portId) return p;
            const bundlePort = p as BundlePortDefinition;
            if (!bundlePort.bundleInfo) return p;
            return {
                ...bundlePort,
                bundleInfo: {
                    ...bundlePort.bundleInfo,
                    expanded
                }
            };
        });
        updateNodePorts(node.id, newPorts);
    }, [node.id, node.ports, updateNodePorts]);

    // Start editing a port label
    const handleLabelClick = useCallback((portId: string, currentLabel: string, e: React.MouseEvent | React.KeyboardEvent) => {
        e.stopPropagation();
        setEditingPort(portId);
        setEditValue(currentLabel);
    }, []);

    // Save the edited label
    const handleLabelSave = useCallback((portId: string) => {
        // Find the port to get its current name for consistent fallback
        const port = node.ports.find(p => p.id === portId);
        if (!port) {
            setEditingPort(null);
            setEditValue('');
            return;
        }

        const newName = editValue || port.name;
        const newLabels = { ...portLabels, [portId]: newName };

        // Update node data with new labels
        updateNodeData(node.id, { portLabels: newLabels });

        // Also update the port name in the ports array
        const newPorts = node.ports.map(p =>
            p.id === portId ? { ...p, name: newName } : p
        );
        updateNodePorts(node.id, newPorts);

        setEditingPort(null);
        setEditValue('');
    }, [node.id, node.ports, portLabels, editValue, updateNodeData, updateNodePorts]);

    // Handle keyboard events in edit mode
    const handleKeyDown = useCallback((portId: string, e: React.KeyboardEvent) => {
        // Stop propagation to prevent parent canvas shortcuts from triggering
        e.stopPropagation();

        if (e.key === 'Enter') {
            handleLabelSave(portId);
        } else if (e.key === 'Escape') {
            setEditingPort(null);
            setEditValue('');
        }
    }, [handleLabelSave]);

    return (
        <div
            className={`input-panel-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isFlashing ? 'flashing' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div
                className="schematic-header input-panel-header"
                onMouseDown={handleHeaderMouseDown}
            >
                <span className="schematic-title">Inputs</span>
            </div>

            {/* Port List */}
            <div className="input-panel-body">
                {bundlePorts.length === 0 && regularPorts.length === 0 && !emptySlotPort ? (
                    <div className="input-panel-empty">No inputs</div>
                ) : (
                    <>
                        {/* Bundle ports with expandable UI */}
                        {bundlePorts.map((port) => (
                            <BundlePortGroup
                                key={port.id}
                                port={port}
                                nodeId={node.id}
                                labelPosition="left"
                                handlePortMouseDown={handlePortMouseDown}
                                handlePortMouseUp={handlePortMouseUp}
                                handlePortMouseEnter={handlePortMouseEnter}
                                handlePortMouseLeave={handlePortMouseLeave}
                                hasConnection={hasConnection}
                                onToggleExpand={handleBundleToggle}
                            />
                        ))}

                        {/* Regular ports */}
                        {regularPorts.map((port) => {
                            const label = portLabels[port.id] || port.name;
                            const isEditing = editingPort === port.id;
                            const isConnected = hasConnection?.(port.id);

                            return (
                                <div key={port.id} className="input-panel-port-row">
                                    {/* Label (editable) - on LEFT for input panel */}
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            className="input-panel-label-input"
                                            value={editValue}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                setEditValue(e.target.value);
                                            }}
                                            onBlur={() => handleLabelSave(port.id)}
                                            onKeyDown={(e) => handleKeyDown(port.id, e)}
                                            aria-label={`Edit label for ${label}`}
                                            autoFocus
                                        />
                                    ) : (
                                        <span
                                            className="input-panel-label"
                                            onClick={(e) => handleLabelClick(port.id, label, e)}
                                            role="button"
                                            tabIndex={0}
                                            title="Click to rename"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    handleLabelClick(port.id, label, e);
                                                }
                                            }}
                                        >
                                            {label}
                                        </span>
                                    )}

                                    {/* Port marker on RIGHT */}
                                    <div
                                        className={`input-panel-port-marker ${port.type}-port output-port ${isConnected ? 'connected' : ''}`}
                                        data-node-id={node.id}
                                        data-port-id={port.id}
                                        data-port-type={port.type}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`${label} port`}
                                        onMouseDown={(e) => handlePortMouseDown?.(port.id, e)}
                                        onMouseUp={(e) => handlePortMouseUp?.(port.id, e)}
                                        onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                                        onMouseLeave={handlePortMouseLeave}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handlePortMouseDown?.(port.id, e as unknown as React.MouseEvent);
                                            }
                                        }}
                                    />
                                </div>
                            );
                        })}

                        {/* Empty slot for new connections */}
                        {emptySlotPort && (
                            <div className="input-panel-port-row empty-slot">
                                <span className="input-panel-label empty-slot-label">
                                    + Add input
                                </span>
                                <div
                                    className={`input-panel-port-marker ${emptySlotPort.type}-port output-port empty-slot-marker`}
                                    data-node-id={node.id}
                                    data-port-id={emptySlotPort.id}
                                    data-port-type={emptySlotPort.type}
                                    role="button"
                                    tabIndex={0}
                                    aria-label="Empty slot for new connection"
                                    onMouseDown={(e) => handlePortMouseDown?.(emptySlotPort.id, e)}
                                    onMouseUp={(e) => handlePortMouseUp?.(emptySlotPort.id, e)}
                                    onMouseEnter={() => handlePortMouseEnter?.(emptySlotPort.id)}
                                    onMouseLeave={handlePortMouseLeave}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handlePortMouseDown?.(emptySlotPort.id, e as unknown as React.MouseEvent);
                                        }
                                    }}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
});
