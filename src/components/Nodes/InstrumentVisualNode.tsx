/**
 * Instrument Visual Node - Compact configuration with per-key ports
 *
 * Mockup-based redesign:
 * - Each key has its own port (like keyboard node)
 * - Inline header: Note, Octave, Offset, Spread (scroll/click to edit)
 * - Offset values displayed below each port
 * - Pedal section at bottom
 */

import { useState, useCallback, useRef, memo } from 'react';
import type { GraphNode, InstrumentRow } from '../../engine/types';
import { isBasicInstrumentNodeData } from '../../engine/typeGuards';
import { useGraphStore } from '../../store/graphStore';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import './InstrumentVisualNode.css';

/** Debounce interval for wheel events (ms) */
const WHEEL_DEBOUNCE_MS = 16; // ~60fps

/** Precision factor for rounding (100 = 2 decimal places) */
const PRECISION_FACTOR = 100;

const NOTE_DISPLAY = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Alias for the shared type guard
const isValidInstrumentData = isBasicInstrumentNodeData;

interface InstrumentVisualNodeProps {
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

// Editable value component with scroll and click-to-edit
// Memoized to prevent expensive re-renders
const EditableValue = memo(function EditableValue({
    value,
    label,
    onChange,
    min,
    max,
    step = 1,
    displayFn,
    parseFn,
    disabled = false
}: {
    value: number;
    label: string;
    onChange: (v: number) => void;
    min: number;
    max: number;
    step?: number;
    displayFn?: (v: number) => string;
    parseFn?: (s: string) => number | null;
    disabled?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const lastWheelTime = useRef(0);
    const spanRef = useRef<HTMLSpanElement>(null);

    const display = displayFn ? displayFn(value) : String(value);

    // Handle scroll for value adjustment
    const handleScroll = useCallback((data: ScrollData) => {
        if (disabled) return;

        // Debounce rapid wheel events
        const now = Date.now();
        if (now - lastWheelTime.current < WHEEL_DEBOUNCE_MS) return;
        lastWheelTime.current = now;

        // Scroll up increases value, scroll down decreases
        const delta = data.scrollingUp ? step : -step;
        const newVal = Math.max(min, Math.min(max, value + delta));
        // Round to avoid floating point issues (2 decimal places)
        const rounded = Math.round(newVal * PRECISION_FACTOR) / PRECISION_FACTOR;
        if (rounded !== value) onChange(rounded);
    }, [value, onChange, min, max, step, disabled]);

    // Attach scroll capture to the span
    const { ref: scrollRef } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleScroll,
        capture: true, // Block default scroll, handle custom value adjustment
        enabled: !disabled,
    });

    const startEdit = useCallback(() => {
        if (disabled) return;
        setEditing(true);
        setEditValue(display);
    }, [display, disabled]);

    const submitEdit = useCallback(() => {
        if (parseFn) {
            const parsed = parseFn(editValue);
            if (parsed !== null && parsed >= min && parsed <= max) {
                onChange(parsed);
            }
        } else {
            const parsed = parseFloat(editValue);
            if (!isNaN(parsed) && parsed >= min && parsed <= max) {
                onChange(Math.round(parsed * PRECISION_FACTOR) / PRECISION_FACTOR);
            }
        }
        setEditing(false);
    }, [editValue, parseFn, onChange, min, max]);

    const cancelEdit = useCallback(() => {
        setEditing(false);
    }, []);

    // Merge refs for both scroll capture and local operations
    const mergedRef = useCallback((node: HTMLSpanElement | null) => {
        (spanRef as React.MutableRefObject<HTMLSpanElement | null>).current = node;
        scrollRef(node);
    }, [scrollRef]);

    return (
        <span
            ref={mergedRef}
            className="editable-value"
            onClick={() => !editing && startEdit()}
            title={`Scroll or click to edit ${label}`}
        >
            {editing ? (
                <input
                    type="text"
                    className="editable-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={submitEdit}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') submitEdit();
                        if (e.key === 'Escape') cancelEdit();
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <span className="editable-display">{display}</span>
            )}
            <span className="editable-label">{label}</span>
        </span>
    );
});

export function InstrumentVisualNode({
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
}: InstrumentVisualNodeProps) {
    // Use selector pattern to subscribe only to specific node - avoids re-render on any node change
    const parentNode = useGraphStore((s) => node.parentId ? s.nodes.get(node.parentId) : null);
    const updateInstrumentRow = useGraphStore((s) => s.updateInstrumentRow);
    const parentNodeId = parentNode?.id;

    // Handle row field update. Declared before any early return so this hook is
    // always called in the same order (Rules of Hooks).
    const handleRowUpdate = useCallback((rowId: string, field: keyof InstrumentRow, value: number) => {
        if (!parentNodeId) return;
        updateInstrumentRow(parentNodeId, rowId, { [field]: value });
    }, [parentNodeId, updateInstrumentRow]);

    // Validate parent node exists and has valid instrument data
    if (node.parentId && !parentNode) {
        // Parent was deleted or doesn't exist - show error state
        return (
            <div
                className={`instrument-visual-node compact error ${isSelected ? 'selected' : ''}`}
                style={style}
            >
                <div className="instrument-visual-header compact">
                    <span className="instrument-visual-title">Error</span>
                </div>
                <div className="no-rows-message compact">Parent node not found</div>
            </div>
        );
    }

    const parentData = parentNode?.data ?? {};

    // Validate parent data structure
    if (!isValidInstrumentData(parentData)) {
        return (
            <div
                className={`instrument-visual-node compact error ${isSelected ? 'selected' : ''}`}
                style={style}
            >
                <div className="instrument-visual-header compact">
                    <span className="instrument-visual-title">Error</span>
                </div>
                <div className="no-rows-message compact">Invalid instrument data</div>
            </div>
        );
    }

    const rows: InstrumentRow[] = parentData.rows || [];

    // Get output port for audio out
    const outputPorts = node.ports.filter(p => p.direction === 'output');

    // Separate pedal rows from key rows
    const keyRows = rows.filter(r => r.portCount > 1);
    const pedalRows = rows.filter(r => r.portCount === 1);

    return (
        <div
            className={`instrument-visual-node compact ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div
                className="instrument-visual-header compact"
                onMouseDown={handleHeaderMouseDown}
            >
                <span className="instrument-visual-title">Config</span>
            </div>

            {/* Rows with individual key ports */}
            <div className="instrument-rows-compact">
                {keyRows.length === 0 && pedalRows.length === 0 ? (
                    <div className="no-rows-message compact">
                        Connect bundles
                    </div>
                ) : (
                    <>
                        {keyRows.map((row) => (
                            <RowWithPorts
                                key={row.rowId}
                                row={row}
                                nodeId={node.id}
                                onUpdate={(field, value) => handleRowUpdate(row.rowId, field, value)}
                                handlePortMouseDown={handlePortMouseDown}
                                handlePortMouseUp={handlePortMouseUp}
                                handlePortMouseEnter={handlePortMouseEnter}
                                handlePortMouseLeave={handlePortMouseLeave}
                                hasConnection={hasConnection}
                                disabled={!parentNodeId}
                            />
                        ))}

                        {/* Pedal section */}
                        {pedalRows.length > 0 && (
                            <div className="pedal-row-compact">
                                {pedalRows.map((pedal) => {
                                    // Pedal port ID matches internal wiring: {rowId}-key-0
                                    const pedalPortId = `${pedal.rowId}-key-0`;
                                    return (
                                        <div key={pedal.rowId} className="pedal-item">
                                            <div
                                                className="key-port pedal"
                                                data-node-id={node.id}
                                                data-port-id={pedalPortId}
                                                onMouseDown={(e) => handlePortMouseDown?.(pedalPortId, e)}
                                                onMouseUp={(e) => handlePortMouseUp?.(pedalPortId, e)}
                                                onMouseEnter={() => handlePortMouseEnter?.(pedalPortId)}
                                                onMouseLeave={handlePortMouseLeave}
                                            />
                                            <span className="pedal-label">Pedal</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Output port on right */}
            <div className="output-port-area">
                {outputPorts.map((port) => (
                    <div
                        key={port.id}
                        className={`visual-port output audio ${hasConnection?.(port.id) ? 'connected' : ''}`}
                        data-node-id={node.id}
                        data-port-id={port.id}
                        onMouseDown={(e) => handlePortMouseDown?.(port.id, e)}
                        onMouseUp={(e) => handlePortMouseUp?.(port.id, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                        onMouseLeave={handlePortMouseLeave}
                    />
                ))}
            </div>
        </div>
    );
}

// Row with individual key ports
function RowWithPorts({
    row,
    nodeId,
    onUpdate,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    disabled
}: {
    row: InstrumentRow;
    nodeId: string;
    onUpdate: (field: keyof InstrumentRow, value: number) => void;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection?: (portId: string) => boolean;
    disabled: boolean;
}) {
    // Generate key ports
    const keyCount = row.portCount;
    const keys = Array.from({ length: keyCount }, (_, i) => i);

    // Calculate offset for each key
    const getKeyOffset = (index: number) => {
        return row.baseOffset + index * row.spread;
    };

    // Format offset for display
    const formatOffset = (offset: number) => {
        const rounded = Math.round(offset * 10) / 10;
        return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
    };

    return (
        <div className="row-compact">
            {/* Row header with editable values */}
            <div className="row-header-compact">
                <EditableValue
                    value={row.baseNote}
                    label="Note"
                    onChange={(v) => onUpdate('baseNote', v)}
                    min={0}
                    max={11}
                    step={1}
                    displayFn={(v) => NOTE_DISPLAY[v] || 'C'}
                    parseFn={(s) => {
                        const idx = NOTE_DISPLAY.findIndex(
                            n => n.toLowerCase() === s.toLowerCase()
                        );
                        return idx !== -1 ? idx : null;
                    }}
                    disabled={disabled}
                />
                <EditableValue
                    value={row.baseOctave}
                    label="Octave"
                    onChange={(v) => onUpdate('baseOctave', v)}
                    min={0}
                    max={8}
                    step={1}
                    disabled={disabled}
                />
                <EditableValue
                    value={row.baseOffset}
                    label="offset"
                    onChange={(v) => onUpdate('baseOffset', v)}
                    min={-24}
                    max={24}
                    step={1}
                    displayFn={(v) => v >= 0 ? String(v) : String(v)}
                    disabled={disabled}
                />
                <EditableValue
                    value={row.spread}
                    label="Spread"
                    onChange={(v) => onUpdate('spread', v)}
                    min={0}
                    max={2}
                    step={0.1}
                    displayFn={(v) => v.toFixed(1)}
                    disabled={disabled}
                />
            </div>

            {/* Key ports with offset labels */}
            <div className="row-keys-compact">
                {keys.map((index) => {
                    const portId = `${row.rowId}-key-${index}`;
                    const offset = getKeyOffset(index);
                    const isConnected = hasConnection?.(portId) ?? false;

                    return (
                        <div key={index} className="key-column">
                            <div
                                className={`key-port ${isConnected ? 'connected' : ''}`}
                                data-node-id={nodeId}
                                data-port-id={portId}
                                onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                                onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                                onMouseEnter={() => handlePortMouseEnter?.(portId)}
                                onMouseLeave={handlePortMouseLeave}
                            />
                            <span className="key-offset">{formatOffset(offset)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
