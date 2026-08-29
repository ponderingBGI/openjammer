/**
 * Sampler Visual Node — the Sampler seen from the inside.
 *
 * Diving into a Sampler (`E`) asks one question: *which key does what?* So the
 * inside view is the key map. Every row a connected bundle created becomes a
 * strip of `KeyTile` pads — one pad per key port — with the row's two tuning
 * values beside its name.
 *
 * **What a pad is, exactly.** It is a PATCH POINT, not a trigger. The Sampler's
 * engine seam (`SamplerHandle`) is get/setBuffer + rootNote/gain/attack/release
 * — there is no note-on a pad could send — so a pad here does what it has always
 * done: it is the connection anchor for one key, and pressing it (mouse, Enter
 * or Space) starts or lands a cable. It carries the canvas's
 * `data-node-id`/`data-port-id`/`data-port-type` through KeyTile's embedded
 * Port, so nothing about wiring changed; what changed is that a key is now a
 * key-shaped thing you can hit rather than a 12-pixel dot.
 *
 * **What a pad SAYS.** The note it plays — `C4 D4 E4 …`, from the Sampler's
 * ROOT walked by the row's SPREAD. W5-P7 printed the pad's index instead, which
 * is the one fact the pad's own position already carried; the map now answers
 * the question it exists for. A fractional spread lands between semitones, so
 * the pad shows the nearest note and the exact offset stays in its accessible
 * name.
 *
 * Rebuilt in W5-P7. The four scroll-to-edit spans this file used to hand-roll
 * are the shared `ValueScrubber` now (audit §"four app value controls duplicate
 * oj-ui ValueScrubber").
 */

import { useCallback, memo } from 'react';
import type { GraphNode, SamplerNodeData, SamplerRow } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { isSamplerNodeData } from '../../engine/typeGuards';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { Chip, KeyTile, NodeShell, PortRow, ValueScrubber } from '@openjammer/oj-ui';
import { noteLabel } from '../controls/noteNames';
import { useGestureBracket } from './nodeControls';
import './SamplerVisual.css';

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
    isHoveredWithConnections?: boolean;
    style?: React.CSSProperties;
}

/** Row parameter value ranges */
const ROW_PARAM_RANGES = {
    GAIN: { min: 0, max: 2, step: 0.1 },
    SPREAD: { min: 0, max: 12, step: 0.5 },
} as const;

/** One scroll-to-adjust value in a row header. Wraps the shared `ValueScrubber`
 *  with the app's non-passive wheel capture, so the canvas never pans under it. */
const RowValue = memo(function RowValue({
    label,
    value,
    display,
    min,
    max,
    step,
    onChange,
    title,
}: {
    label: string;
    value: number;
    display: string;
    min: number;
    max: number;
    step: number;
    onChange: (next: number) => void;
    title: string;
}) {
    const clamp = useCallback((next: number) => {
        const bounded = Math.max(min, Math.min(max, next));
        const decimals = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
        return parseFloat(bounded.toFixed(decimals));
    }, [min, max, step]);

    const handleScroll = useCallback((data: ScrollData) => {
        const next = clamp(value + (data.scrollingUp ? 1 : -1) * step);
        if (next !== value) onChange(next);
    }, [value, step, clamp, onChange]);

    const { ref } = useScrollCapture<HTMLSpanElement>({ onScroll: handleScroll, capture: true });

    return (
        <span ref={ref} className="sampler-row-value">
            <ValueScrubber
                label={label}
                value={value}
                display={display}
                onCommit={(next) => onChange(clamp(next))}
                title={title}
            />
        </span>
    );
});

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
    isHoveredWithConnections,
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
        <NodeShell
            className={`schematic-node sampler-visual-node${isHoveredWithConnections ? ' hover-connecting' : ''}`}
            style={style}
            title="Sampler"
            /* What the card IS, not how many keys are on it: with one row the
               count is already on that row's own chip, and a header that
               repeats the row below it says nothing twice. */
            nodeType="KEY MAP"
            selected={!!isSelected}
            dragging={!!isDragging}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <div className="sampler-visual-body" onMouseDown={(e) => e.stopPropagation()}>
                {rows.map((row, index) => (
                    <RowWithPads
                        key={row.rowId}
                        row={row}
                        nodeId={node.id}
                        parentNodeId={parentNodeId}
                        rootNote={parentData.rootNote}
                        updateSamplerRow={updateSamplerRow}
                        handlePortMouseDown={handlePortMouseDown}
                        handlePortMouseUp={handlePortMouseUp}
                        handlePortMouseEnter={handlePortMouseEnter}
                        handlePortMouseLeave={handlePortMouseLeave}
                        hasConnection={hasConnection}
                        showDivider={index > 0}
                    />
                ))}

                {/* The always-open slot: one more thing can always be wired in. */}
                <div className={`sampler-add-row${rows.length > 0 ? ' has-rows' : ''}`}>
                    <PortRow
                        side="input"
                        kind="control"
                        placeholder
                        label={rows.length === 0 ? 'Connect input' : '+ Add input'}
                        data-node-id={node.id}
                        data-port-id={placeholderPortId}
                        data-port-type="control"
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
                        title="Connect a keyboard or a single control"
                    />
                </div>

                {rows.length === 0 && (
                    <p className="sampler-visual-hint">
                        Wire a keyboard row in and its keys appear here as pads you can
                        patch one at a time.
                    </p>
                )}
            </div>
        </NodeShell>
    );
});

// One row of key pads — memoized to prevent unnecessary re-renders
const RowWithPads = memo(function RowWithPads({
    row,
    nodeId,
    parentNodeId,
    rootNote,
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
    /** The Sampler's ROOT — the note the leftmost pad plays. */
    rootNote: number;
    updateSamplerRow: (nodeId: string, rowId: string, updates: Partial<SamplerRow>) => void;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection?: (portId: string) => boolean;
    showDivider: boolean;
}) {
    const keys = Array.from({ length: row.portCount }, (_, i) => i);
    const gesture = useGestureBracket();

    const handleGainChange = useCallback((newValue: number) => {
        if (!parentNodeId) return;
        gesture.begin();
        updateSamplerRow(parentNodeId, row.rowId, { gain: newValue });
        gesture.end();
    }, [parentNodeId, row.rowId, updateSamplerRow, gesture]);

    const handleSpreadChange = useCallback((newValue: number) => {
        if (!parentNodeId) return;
        gesture.begin();
        updateSamplerRow(parentNodeId, row.rowId, { spread: newValue });
        gesture.end();
    }, [parentNodeId, row.rowId, updateSamplerRow, gesture]);

    return (
        <div className={`sampler-row${showDivider ? ' with-divider' : ''}`}>
            <div className="sampler-row__head">
                <span className="sampler-row__label">{row.label || 'Row'}</span>
                <Chip className="sampler-row__count">{row.portCount} keys</Chip>
            </div>

            <div className="sampler-row__values">
                <RowValue
                    label="GAIN"
                    value={row.gain}
                    display={`${row.gain.toFixed(1)}×`}
                    min={ROW_PARAM_RANGES.GAIN.min}
                    max={ROW_PARAM_RANGES.GAIN.max}
                    step={ROW_PARAM_RANGES.GAIN.step}
                    onChange={handleGainChange}
                    title="Row gain (0–2) — scroll to change, click to type"
                />
                <RowValue
                    label="SPREAD"
                    value={row.spread}
                    display={`${row.spread.toFixed(1)} st`}
                    min={ROW_PARAM_RANGES.SPREAD.min}
                    max={ROW_PARAM_RANGES.SPREAD.max}
                    step={ROW_PARAM_RANGES.SPREAD.step}
                    onChange={handleSpreadChange}
                    title="Semitones between neighbouring keys — scroll to change, click to type"
                />
            </div>

            <div className="sampler-row__pads" role="group" aria-label={`${row.label || 'Row'} key ports`}>
                {keys.map((index) => {
                    const portId = `${row.rowId}-key-${index}`;
                    const isConnected = hasConnection?.(portId) ?? false;
                    /* The one question this card exists to answer is "which key
                       does what", and W5-P7 printed `1 … 10` — an index, which is
                       the one thing the pad's POSITION already says. The card
                       knows ROOT and SPREAD (its own aria-label was already
                       computing the offset), so it prints the NOTE. Fractional
                       spreads land between semitones, so the pad shows the
                       nearest note and the exact offset stays in the name. */
                    const semitonesFromRoot = index * row.spread;
                    const pitch = rootNote + semitonesFromRoot;
                    const padNote = noteLabel(Math.round(pitch));
                    const keyLabel = `Key ${index + 1}, ${padNote}, +${semitonesFromRoot.toFixed(1)} semitones from root`;

                    return (
                        <KeyTile
                            key={index}
                            variant="pad"
                            size={32}
                            label={padNote}
                            connected={isConnected}
                            data-node-id={nodeId}
                            data-port-id={portId}
                            data-port-type="control"
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
