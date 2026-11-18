/**
 * Instrument Visual Node — what is inside an instrument: one strip per connected
 * row, every key of that row exposed as its own socket.
 *
 * This is the node you land on when you press `E` on an instrument, and it is
 * the reason the instrument can be tuned at all: the row's root note, octave and
 * offset, the SPREAD between keys, and then the twelve wells that let a player
 * re-route a single key anywhere.
 *
 * Wave 5 / P8 rebuild. It carried 35 literal colours — a fixed cream/ink/blue
 * palette that stayed cream in every theme — plus its own `EditableValue`, the
 * fourth private copy of `ValueScrubber` in the app. Both are gone: the card is
 * a `NodeShell`, the numbers are `ValueScrubber`s, the spread is a real `Knob`
 * (it is the one continuous value here, and a dial is how an instrument says
 * so), and every socket is the shared well.
 */

import { useCallback, useMemo } from 'react';
import type { GraphNode, InstrumentRow, PortDefinition } from '../../engine/types';
import { isBasicInstrumentNodeData } from '../../engine/typeGuards';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { Knob, NodeFrame, NodeShell, Port, PortRow, ValueScrubber } from '@openjammer/oj-ui';
import { NOTE_NAMES, noteLabelFromDegree } from '../controls/noteNames';
import './InstrumentVisualNode.css';

/** Spread is the only continuous value here: 0 (unison) to 2 (whole tones). */
const SPREAD_RANGE = { min: 0, max: 2, step: 0.1 } as const;
const ROW_RANGES = {
    note: { min: 0, max: 11 },
    octave: { min: 0, max: 8 },
    offset: { min: -24, max: 24 },
} as const;

/** Stable empties — a new `{}` or `[]` per render would churn every memo. */
const EMPTY_DATA: Record<string, never> = {};
const EMPTY_ROWS: InstrumentRow[] = [];

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

/** Port handlers, in one place — every socket on this faceplate takes the same set. */
type SocketWiring = Pick<
    InstrumentVisualNodeProps,
    'handlePortMouseDown' | 'handlePortMouseUp' | 'handlePortMouseEnter' | 'handlePortMouseLeave'
>;

function socketProps(nodeId: string, portId: string, wiring: SocketWiring) {
    return {
        'data-node-id': nodeId,
        'data-port-id': portId,
        'data-port-type': 'control',
        onMouseDown: (e: React.MouseEvent) => wiring.handlePortMouseDown?.(portId, e),
        onMouseUp: (e: React.MouseEvent) => wiring.handlePortMouseUp?.(portId, e),
        onMouseEnter: () => wiring.handlePortMouseEnter?.(portId),
        onMouseLeave: wiring.handlePortMouseLeave,
    };
}

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
}: InstrumentVisualNodeProps) {
    const parentNode = useGraphStore((s) => (node.parentId ? s.nodes.get(node.parentId) : null));
    const updateInstrumentRow = useGraphStore((s) => s.updateInstrumentRow);
    const isAgentPending = useIsAgentPending(node.id);
    const parentNodeId = parentNode?.id;

    const updateRow = useCallback((rowId: string, field: keyof InstrumentRow, value: number) => {
        if (!parentNodeId) return;
        updateInstrumentRow(parentNodeId, rowId, { [field]: value });
    }, [parentNodeId, updateInstrumentRow]);

    const wiring: SocketWiring = {
        handlePortMouseDown,
        handlePortMouseUp,
        handlePortMouseEnter,
        handlePortMouseLeave,
    };

    const parentData = parentNode?.data ?? EMPTY_DATA;
    const valid = isBasicInstrumentNodeData(parentData);
    // One stable array when there is nothing to show, so the two memos below do
    // not recompute on every render of an unwired instrument.
    const rows: InstrumentRow[] = useMemo(
        () => (isBasicInstrumentNodeData(parentData) ? parentData.rows || EMPTY_ROWS : EMPTY_ROWS),
        [parentData],
    );

    const keyRows = useMemo(() => rows.filter((r) => r.portCount > 1), [rows]);
    const pedalRows = useMemo(() => rows.filter((r) => r.portCount === 1), [rows]);

    // The declared ports. `row-in` is the bundle arriving from the instrument's
    // own input panel; it used to be advertised and never drawn, which is a port
    // the canvas can look up but a player cannot see.
    const rowIn = node.ports.find((p) => p.id === 'row-in');
    const audioOut = node.ports.find((p) => p.direction === 'output' && p.type === 'audio');
    const otherOutputs = node.ports.filter(
        (p) => p.direction === 'output' && p.type !== 'audio',
    );

    const portRow = (port: PortDefinition, label: string, title: string) => (
        <PortRow
            key={port.id}
            side={port.direction}
            kind={port.type}
            connected={!!hasConnection?.(port.id)}
            label={label}
            title={title}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type={port.type}
            onMouseDown={(e: React.MouseEvent) => handlePortMouseDown?.(port.id, e)}
            onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(port.id, e)}
            onMouseEnter={() => handlePortMouseEnter?.(port.id)}
            onMouseLeave={handlePortMouseLeave}
        />
    );

    // Parent gone, or its data is not an instrument's: say so plainly and keep
    // the sockets, so the canvas can still find every port it advertises.
    const fault = !parentNode && node.parentId
        ? 'Parent instrument not found.'
        : !valid && parentNode
            ? 'This node’s instrument data could not be read.'
            : null;

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`iv-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className="instrument-visual-node"
                title="Rows"
                nodeType={fault ? 'UNREADABLE' : `${rows.length} IN`}
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{ onMouseDown: handleHeaderMouseDown }}
                inputs={rowIn ? [portRow(rowIn, 'ROWS', 'Bundle in from the instrument')] : []}
                outputs={[
                    ...(audioOut ? [portRow(audioOut, 'OUT', 'Audio output')] : []),
                    ...otherOutputs.map((p) => portRow(p, p.name.toUpperCase(), p.name)),
                ]}
            >
                {fault ? (
                    <p className="iv-note">{fault}</p>
                ) : rows.length === 0 ? (
                    <p className="iv-note">No rows yet — connect a keyboard row to the instrument.</p>
                ) : (
                    <div className="iv-rows">
                        {keyRows.map((row) => (
                            <RowStrip
                                key={row.rowId}
                                row={row}
                                nodeId={node.id}
                                wiring={wiring}
                                hasConnection={hasConnection}
                                onUpdate={(field, value) => updateRow(row.rowId, field, value)}
                                disabled={!parentNodeId}
                            />
                        ))}

                        {pedalRows.length > 0 && (
                            <div className="iv-pedals">
                                {pedalRows.map((pedal) => {
                                    // The pedal's port id matches the internal wiring.
                                    const portId = `${pedal.rowId}-key-0`;
                                    return (
                                        <span key={pedal.rowId} className="iv-pedal">
                                            <Port
                                                kind="control"
                                                direction="input"
                                                connected={!!hasConnection?.(portId)}
                                                {...socketProps(node.id, portId, wiring)}
                                            />
                                            <span className="iv-pedal__label">SUSTAIN</span>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </NodeShell>
        </NodeFrame>
    );
}

// ============================================================================
// One row: its tuning, then one well per key
// ============================================================================

function RowStrip({
    row,
    nodeId,
    wiring,
    hasConnection,
    onUpdate,
    disabled,
}: {
    row: InstrumentRow;
    nodeId: string;
    wiring: SocketWiring;
    hasConnection?: (portId: string) => boolean;
    onUpdate: (field: keyof InstrumentRow, value: number) => void;
    disabled: boolean;
}) {
    const keys = Array.from({ length: row.portCount }, (_, i) => i);

    /** What key `index` will actually sound — the same arithmetic the engine runs. */
    const noteAt = (index: number) => {
        const spreadOffset = row.baseOffset + index * row.spread;
        return noteLabelFromDegree(
            row.baseNote + Math.round(spreadOffset),
            row.baseOctave,
        );
    };

    const snap = (min: number, max: number, step: number) => (next: number) => {
        if (!Number.isFinite(next)) return next;
        const snapped = Math.round((next - min) / step) * step + min;
        return Math.max(min, Math.min(max, Math.round(snapped * 100) / 100));
    };

    const commitNote = snap(ROW_RANGES.note.min, ROW_RANGES.note.max, 1);
    const commitOctave = snap(ROW_RANGES.octave.min, ROW_RANGES.octave.max, 1);
    const commitOffset = snap(ROW_RANGES.offset.min, ROW_RANGES.offset.max, 1);

    return (
        <section className="iv-row" aria-label={row.label || 'Row'}>
            <header className="iv-row__head">
                <span className="iv-row__name">{row.label || 'Row'}</span>
                <span className="iv-row__span">
                    {noteAt(0)} – {noteAt(row.portCount - 1)}
                </span>
            </header>

            <div className="iv-row__tune">
                <div className="iv-row__values">
                    <ValueScrubber
                        label="NOTE"
                        value={row.baseNote}
                        display={NOTE_NAMES[row.baseNote] ?? 'C'}
                        disabled={disabled}
                        onCommit={(v) => onUpdate('baseNote', commitNote(v))}
                    />
                    <ValueScrubber
                        label="OCT"
                        value={row.baseOctave}
                        display={String(row.baseOctave)}
                        disabled={disabled}
                        onCommit={(v) => onUpdate('baseOctave', commitOctave(v))}
                    />
                    <ValueScrubber
                        label="OFF"
                        value={row.baseOffset}
                        display={row.baseOffset >= 0 ? `+${row.baseOffset}` : String(row.baseOffset)}
                        disabled={disabled}
                        onCommit={(v) => onUpdate('baseOffset', commitOffset(v))}
                    />
                </div>
                <Knob
                    label="SPREAD"
                    size={40}
                    min={SPREAD_RANGE.min}
                    max={SPREAD_RANGE.max}
                    step={SPREAD_RANGE.step}
                    value={row.spread}
                    defaultValue={0.5}
                    disabled={disabled}
                    format={(v) => v.toFixed(1)}
                    onChange={(v) => onUpdate('spread', Math.round(v * 10) / 10)}
                />
            </div>

            <div className="iv-keys">
                {keys.map((index) => {
                    const portId = `${row.rowId}-key-${index}`;
                    return (
                        <span key={portId} className="iv-key">
                            <Port
                                kind="control"
                                direction="input"
                                connected={!!hasConnection?.(portId)}
                                title={`${noteAt(index)} → ${portId}`}
                                {...socketProps(nodeId, portId, wiring)}
                            />
                            <span className="iv-key__note">{noteAt(index)}</span>
                        </span>
                    );
                })}
            </div>
        </section>
    );
}
