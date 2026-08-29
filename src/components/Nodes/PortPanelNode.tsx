/**
 * Port Panel Node — ONE directional panel behind both `input-panel` and
 * `output-panel`.
 *
 * The two used to be near-identical files (`InputPanelNode.tsx:35-299` vs
 * `OutputPanelNode.tsx:33-257`) that had already started to drift: only one of
 * them knew about bundles, and each had its own copy of the rename editor, the
 * empty-slot rule and the port-splitting memo. They are the same object seen
 * from two sides, so they are one component with a `direction`, and the side
 * decides three things and nothing else: which port direction it lists, which
 * way each row reads, and the word in the title.
 *
 * Renaming a port is the atomic `renamePort` verb — port name and the
 * `portLabels` metadata move in one store write, inside one history gesture, so
 * a single Ctrl+Z puts both back (UI-032).
 */

import { useCallback, useMemo, useState, memo } from 'react';
import { Button, EditableLabel, NodeShell, PortRow } from '@openjammer/oj-ui';
import type { GraphNode, BundlePortDefinition } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { BundlePortGroup } from '../BundlePortGroup';
import { isBundlePort, isEmptyPort } from '../../utils/bundleManager';
import { NodeFeedback } from './NodeFeedback';
import { useNodeRefusal } from './nodeControls';
import './PortPanelNode.css';

export interface PortPanelNodeProps {
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
    style?: React.CSSProperties;
}

/**
 * `input` = the INPUTS panel: it hands the parent's signals to the inside, so
 * its ports are graph OUTPUTS and each row reads [name][socket].
 * `output` = the OUTPUTS panel: it collects signals to send up, so its ports
 * are graph INPUTS and each row reads [socket][name].
 */
type PanelDirection = 'input' | 'output';

interface Config {
    /** Which port direction this panel lists. */
    portDirection: 'input' | 'output';
    /** Which way a row reads. */
    rowSide: 'input' | 'output';
    title: string;
    rootClass: string;
    emptyText: string;
    addText: string;
}

const CONFIG: Record<PanelDirection, Config> = {
    input: {
        portDirection: 'output',
        rowSide: 'output',
        title: 'Inputs',
        rootClass: 'input-panel-node',
        emptyText: 'No inputs yet',
        addText: '+ Add input',
    },
    output: {
        portDirection: 'input',
        rowSide: 'input',
        title: 'Outputs',
        rootClass: 'output-panel-node',
        emptyText: 'No outputs yet',
        addText: '+ Add output',
    },
};

export const PortPanelNode = memo(function PortPanelNode({
    direction,
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
    style,
}: PortPanelNodeProps & { direction: PanelDirection }) {
    const config = CONFIG[direction];
    const [editingPort, setEditingPort] = useState<string | null>(null);

    const renamePort = useGraphStore((s) => s.renamePort);
    const updateNodePorts = useGraphStore((s) => s.updateNodePorts);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const isRefusing = useNodeRefusal(node.id);

    const portLabels = useMemo(
        () => (node.data.portLabels as Record<string, string>) || {},
        [node.data.portLabels],
    );

    // Three kinds of row: a bundle (one cable carrying many channels), a named
    // port, and the one empty slot every panel keeps open.
    const { bundlePorts, regularPorts, emptySlotPort } = useMemo(() => {
        const bundles: BundlePortDefinition[] = [];
        const regular: typeof node.ports = [];
        let emptySlot: (typeof node.ports)[0] | null = null;

        for (const port of node.ports) {
            if (port.direction !== config.portDirection) continue;
            if (isBundlePort(port)) bundles.push(port as BundlePortDefinition);
            else if (isEmptyPort(port)) { if (!emptySlot) emptySlot = port; }
            else regular.push(port);
        }
        return { bundlePorts: bundles, regularPorts: regular, emptySlotPort: emptySlot };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only node.ports is read; depending on the whole node would recompute on unrelated node changes (position, selection)
    }, [node.ports, config.portDirection]);

    const handleBundleToggle = useCallback((portId: string, expanded: boolean) => {
        const newPorts = node.ports.map((p) => {
            if (p.id !== portId) return p;
            const bundlePort = p as BundlePortDefinition;
            if (!bundlePort.bundleInfo) return p;
            return { ...bundlePort, bundleInfo: { ...bundlePort.bundleInfo, expanded } };
        });
        updateNodePorts(node.id, newPorts);
    }, [node.id, node.ports, updateNodePorts]);

    /** One verb, one gesture: name and metadata revert together on Ctrl+Z. */
    const commitRename = useCallback((portId: string, next: string) => {
        setEditingPort(null);
        const port = node.ports.find((p) => p.id === portId);
        if (!port) return;
        const name = next || port.name;
        if (name === (portLabels[portId] ?? port.name)) return;
        beginGesture();
        renamePort(node.id, portId, name);
        endGesture();
    }, [beginGesture, endGesture, node.id, node.ports, portLabels, renamePort]);

    /** Pointer-agnostic port activation — Enter/Space starts a connection. */
    const activatePort = useCallback((portId: string, e: React.KeyboardEvent) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        handlePortMouseDown?.(portId, e as unknown as React.MouseEvent);
    }, [handlePortMouseDown]);

    const portHandlers = (portId: string) => ({
        onMouseDown: (e: React.MouseEvent) => handlePortMouseDown?.(portId, e),
        onMouseUp: (e: React.MouseEvent) => handlePortMouseUp?.(portId, e),
        onMouseEnter: () => handlePortMouseEnter?.(portId),
        onMouseLeave: handlePortMouseLeave,
        onKeyDown: (e: React.KeyboardEvent) => activatePort(portId, e),
    });

    const isEmpty = bundlePorts.length === 0 && regularPorts.length === 0 && !emptySlotPort;

    return (
        <NodeShell
            className={[
                'schematic-node',
                'port-panel',
                config.rootClass,
                isRefusing && 'flashing',
                isHoveredWithConnections && 'hover-connecting',
            ].filter(Boolean).join(' ')}
            style={style}
            title={config.title}
            nodeType="PANEL"
            selected={!!isSelected}
            dragging={!!isDragging}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {isEmpty ? (
                <p className="port-panel__empty">{config.emptyText}</p>
            ) : (
                <div className="port-panel__rows">
                    {bundlePorts.map((port) => (
                        <BundlePortGroup
                            key={port.id}
                            port={port}
                            nodeId={node.id}
                            labelPosition={direction === 'input' ? 'left' : 'right'}
                            handlePortMouseDown={handlePortMouseDown}
                            handlePortMouseUp={handlePortMouseUp}
                            handlePortMouseEnter={handlePortMouseEnter}
                            handlePortMouseLeave={handlePortMouseLeave}
                            hasConnection={hasConnection}
                            onToggleExpand={handleBundleToggle}
                        />
                    ))}

                    {regularPorts.map((port) => {
                        const label = portLabels[port.id] || port.name;
                        const editing = editingPort === port.id;
                        return (
                            <PortRow
                                key={port.id}
                                className={`port-panel__row${editing ? ' is-editing' : ''}`}
                                side={config.rowSide}
                                kind={port.type === 'audio' ? 'audio' : port.type === 'universal' ? 'universal' : 'control'}
                                label={label}
                                connected={!!hasConnection?.(port.id)}
                                editableLabel={
                                    <span
                                        className="port-panel__name"
                                        onMouseDown={(e) => { if (editing) e.stopPropagation(); }}
                                        onDoubleClick={(e) => { e.stopPropagation(); setEditingPort(port.id); }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !editing) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setEditingPort(port.id);
                                            }
                                        }}
                                    >
                                        <EditableLabel
                                            value={label}
                                            editing={editing}
                                            mono
                                            align={direction === 'input' ? 'left' : 'left'}
                                            onCommit={(next) => commitRename(port.id, next)}
                                            onCancel={() => setEditingPort(null)}
                                        />
                                    </span>
                                }
                                data-node-id={node.id}
                                data-port-id={port.id}
                                data-port-type={port.type}
                                role="button"
                                tabIndex={0}
                                aria-label={`${label} port`}
                                {...portHandlers(port.id)}
                            />
                        );
                    })}

                    {/* "Always one empty port": the socket IS the affordance — you
                        make a port by landing a cable in it. The ghost button is
                        the row's name, so the invitation reads as an action and
                        keyboard users can reach the same socket with Enter. */}
                    {emptySlotPort && (
                        <PortRow
                            className="port-panel__row port-panel__row--add"
                            side={config.rowSide}
                            kind={emptySlotPort.type === 'audio' ? 'audio' : emptySlotPort.type === 'universal' ? 'universal' : 'control'}
                            placeholder
                            label={config.addText}
                            editableLabel={
                                <Button
                                    variant="ghost"
                                    className="port-panel__add"
                                    tabIndex={-1}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    {config.addText}
                                </Button>
                            }
                            data-node-id={node.id}
                            data-port-id={emptySlotPort.id}
                            data-port-type={emptySlotPort.type}
                            role="button"
                            tabIndex={0}
                            aria-label={`${config.addText} — drop a cable here`}
                            {...portHandlers(emptySlotPort.id)}
                        />
                    )}
                </div>
            )}
            <NodeFeedback active={isRefusing} message={`This ${config.title.toLowerCase()} panel cannot be removed.`} />
        </NodeShell>
    );
});
