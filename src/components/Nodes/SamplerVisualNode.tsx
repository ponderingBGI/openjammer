/**
 * Sampler Visual Node - Internal view with row-based layout
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────────┐
 * │ SAMPLER CONFIG                                          │
 * ├─────────────────────────────────────────────────────────┤
 * │ Row 1: "Keys" (12 ports)                                │
 * │ ● ● ● ● ● ● ● ● ● ● ● ●   Gain: 1.0   Spread: 1.0      │
 * ├─────────────────────────────────────────────────────────┤
 * │ Row 2: "Pads" (8 ports)                                 │
 * │ ● ● ● ● ● ● ● ●           Gain: 0.8   Spread: 2.0      │
 * ├─────────────────────────────────────────────────────────┤
 * │ ● + Connect bundle                                      │
 * └─────────────────────────────────────────────────────────┘
 */

import { useCallback, memo } from 'react';
import type { GraphNode, SamplerNodeData, SamplerRow } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { isSamplerNodeData } from '../../engine/typeGuards';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { Port } from '@openjammer/oj-ui';
import './SamplerVisual.css';

/**
 * ScrollableValue - Value display with scroll capture for parameter adjustment
 * Uses useScrollCapture hook to properly prevent canvas scrolling
 */
interface ScrollableValueProps {
    value: number;
    onChange: (newValue: number) => void;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    title: string;
    className?: string;
}

const ScrollableValue = memo(function ScrollableValue({
    value,
    onChange,
    min,
    max,
    step,
    format,
    title,
    className = ''
}: ScrollableValueProps) {
    const handleScroll = useCallback((data: ScrollData) => {
        const delta = data.scrollingUp ? 1 : -1;
        const newValue = Math.max(min, Math.min(max, value + delta * step));
        // Calculate decimal places from step (e.g., 0.1 → 1, 0.5 → 1, 0.01 → 2)
        const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
        const rounded = parseFloat(newValue.toFixed(decimals));
        if (rounded !== value) {
            onChange(rounded);
        }
    }, [value, onChange, min, max, step]);

    const { ref } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleScroll,
        capture: true,
    });

    return (
        <span
            ref={ref}
            className={`sampler-row-value ${className}`}
            title={title}
        >
            {format(value)}
        </span>
    );
});

interface SamplerVisualNodeProps {
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

/** Row parameter value ranges */
const ROW_PARAM_RANGES = {
    GAIN: { min: 0, max: 2, step: 0.1 },
    SPREAD: { min: 0, max: 12, step: 0.5 },
} as const;

export const SamplerVisualNode = memo(function SamplerVisualNode({
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
}: SamplerVisualNodeProps) {
    // Get parent node for data access
    const parentNodeId = node.parentId;
    const parentNode = useGraphStore((s) => parentNodeId ? s.nodes.get(parentNodeId) : null);
    const updateSamplerRow = useGraphStore((s) => s.updateSamplerRow);

    const defaultData: SamplerNodeData = {
        sampleId: null,
        sampleName: null,
        rootNote: 60,
        gain: 1.0,
        spread: 1.0,
        attack: 0.01,
        release: 0.1,
        rows: [],
    };

    // Get data from parent node (where the actual sampler data is stored)
    const parentData: SamplerNodeData = parentNode && isSamplerNodeData(parentNode.data)
        ? { ...defaultData, ...(parentNode.data as Partial<SamplerNodeData>) }
        : defaultData;

    // Get rows from parent data
    const rows: SamplerRow[] = parentData.rows || [];

    // Placeholder port ID for new connections
    const placeholderPortId = 'placeholder-in';

    return (
        <div
            className={`sampler-visual-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div className="sampler-visual-header" onMouseDown={handleHeaderMouseDown}>
                <span className="sampler-visual-title">Sampler</span>
            </div>

            {/* Rows container */}
            <div className="sampler-visual-rows">
                {/* Existing rows */}
                {rows.map((row, index) => (
                    <RowWithPorts
                        key={row.rowId}
                        row={row}
                        nodeId={node.id}
                        parentNodeId={parentNodeId}
                        updateSamplerRow={updateSamplerRow}
                        handlePortMouseDown={handlePortMouseDown}
                        handlePortMouseUp={handlePortMouseUp}
                        handlePortMouseEnter={handlePortMouseEnter}
                        handlePortMouseLeave={handlePortMouseLeave}
                        hasConnection={hasConnection}
                        showDivider={index > 0}
                    />
                ))}

                {/* Placeholder row for new connections */}
                <div className={`sampler-placeholder-row ${rows.length > 0 ? '' : 'first-row'}`}>
                    <Port
                        kind="control"
                        direction="input"
                        placeholder
                        style={{ width: 12, height: 12 }}
                        data-node-id={node.id}
                        data-port-id={placeholderPortId}
                        onMouseDown={(e: React.MouseEvent) => handlePortMouseDown?.(placeholderPortId, e)}
                        onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(placeholderPortId, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(placeholderPortId)}
                        onMouseLeave={handlePortMouseLeave}
                        onKeyDown={(e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                handlePortMouseDown?.(placeholderPortId, e as unknown as React.MouseEvent);
                            }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={rows.length === 0 ? 'Connect input' : 'Add input'}
                        title="Connect keyboard or single control"
                    />
                    <span className="sampler-placeholder-text">
                        {rows.length === 0 ? 'Connect input' : '+ Add input'}
                    </span>
                </div>
            </div>
        </div>
    );
});

// Row with individual key ports - memoized to prevent unnecessary re-renders
const RowWithPorts = memo(function RowWithPorts({
    row,
    nodeId,
    parentNodeId,
    updateSamplerRow,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    showDivider
}: {
    row: SamplerRow;
    nodeId: string;
    parentNodeId: string | null;
    updateSamplerRow: (nodeId: string, rowId: string, updates: Partial<SamplerRow>) => void;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection?: (portId: string) => boolean;
    showDivider: boolean;
}) {
    // Generate key ports
    const keyCount = row.portCount;
    const keys = Array.from({ length: keyCount }, (_, i) => i);

    // Memoized update handlers for gain and spread
    const handleGainChange = useCallback((newValue: number) => {
        if (!parentNodeId) return;
        updateSamplerRow(parentNodeId, row.rowId, { gain: newValue });
    }, [parentNodeId, row.rowId, updateSamplerRow]);

    const handleSpreadChange = useCallback((newValue: number) => {
        if (!parentNodeId) return;
        updateSamplerRow(parentNodeId, row.rowId, { spread: newValue });
    }, [parentNodeId, row.rowId, updateSamplerRow]);

    return (
        <div className={`sampler-row-visual ${showDivider ? 'with-divider' : ''}`}>
            {/* Row header with label and controls */}
            <div className="sampler-row-header">
                <span className="sampler-row-label">
                    {row.label || 'Row'} ({row.portCount} keys)
                </span>
                <div className="sampler-row-controls">
                    <ScrollableValue
                        value={row.gain}
                        onChange={handleGainChange}
                        min={ROW_PARAM_RANGES.GAIN.min}
                        max={ROW_PARAM_RANGES.GAIN.max}
                        step={ROW_PARAM_RANGES.GAIN.step}
                        format={(v) => `Gain: ${v.toFixed(1)}`}
                        title="Gain (0-2) - scroll to change"
                    />
                    <ScrollableValue
                        value={row.spread}
                        onChange={handleSpreadChange}
                        min={ROW_PARAM_RANGES.SPREAD.min}
                        max={ROW_PARAM_RANGES.SPREAD.max}
                        step={ROW_PARAM_RANGES.SPREAD.step}
                        format={(v) => `Spread: ${v.toFixed(1)}`}
                        title="Spread (semitones) - scroll to change"
                    />
                </div>
            </div>

            {/* Key ports display */}
            <div className="sampler-row-keys" role="group" aria-label={`${row.label || 'Row'} key ports`}>
                {keys.map((index) => {
                    const portId = `${row.rowId}-key-${index}`;
                    const isConnected = hasConnection?.(portId) ?? false;
                    // Calculate the semitone offset for this key
                    const semitonesFromRoot = index * row.spread;
                    const keyLabel = `Key ${index + 1}: +${semitonesFromRoot.toFixed(1)} semitones`;

                    return (
                        <Port
                            key={index}
                            kind="control"
                            direction="input"
                            connected={isConnected}
                            style={{ width: 12, height: 12 }}
                            data-node-id={nodeId}
                            data-port-id={portId}
                            onMouseDown={(e: React.MouseEvent) => handlePortMouseDown?.(portId, e)}
                            onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(portId, e)}
                            onMouseEnter={() => handlePortMouseEnter?.(portId)}
                            onMouseLeave={handlePortMouseLeave}
                            onKeyDown={(e: React.KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handlePortMouseDown?.(portId, e as unknown as React.MouseEvent);
                                }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={keyLabel}
                            title={keyLabel}
                        />
                    );
                })}
            </div>
        </div>
    );
});

export default SamplerVisualNode;
