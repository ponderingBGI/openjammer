/**
 * Instrument Node - Virtual instrument with row-based bundle inputs
 *
 * Design: Hand-drawn schematic with clickable instrument name to open selector dropdown
 * Shows row-based note grid with spread control - each bundle connection creates a row
 */

import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import type { GraphNode, InstrumentNodeData, InstrumentRow } from '../../engine/types';
import { isBasicInstrumentNodeData } from '../../engine/typeGuards';
import { useGraphStore } from '../../store/graphStore';
import { nodeDefinitions } from '../../engine/registry';
import { InstrumentLoader } from '../../audio/instrumentCatalog';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { ScrollContainer } from '../common/ScrollContainer';
import { Port, ValueScrubber } from '@openjammer/oj-ui';

interface InstrumentNodeProps {
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

// ============================================================================
// Constants
// ============================================================================

/** Musical note names for display (chromatic scale) */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Minimum mouse movement before treating interaction as drag */
const DRAG_THRESHOLD_PX = 5;

/** Dropdown positioning constraints */
const DROPDOWN_LAYOUT = {
    HEADER_HEIGHT: 36,
    MAX_WIDTH_RATIO: 0.5,    // 50% of viewport
    MAX_WIDTH_PX: 800,
    MAX_HEIGHT_RATIO: 0.4,   // 40% of viewport
    MAX_HEIGHT_PX: 600,
    MIN_HEIGHT_PX: 150,
    MIN_WIDTH_PX: 250,
    EDGE_PADDING_PX: 10,
} as const;

/** Row parameter value ranges */
const ROW_PARAM_RANGES = {
    NOTE: { min: 0, max: 11 },      // C to B (chromatic scale)
    OCTAVE: { min: 0, max: 8 },     // Piano range
    OFFSET: { min: -24, max: 24 },  // +/- 2 octaves
} as const;

// Build instrument labels from loader
const INSTRUMENT_LABELS: Record<string, string> = {};
InstrumentLoader.getAllDefinitions().forEach(def => {
    INSTRUMENT_LABELS[def.id] = def.name;
});
// Add legacy labels for backwards compatibility
INSTRUMENT_LABELS['piano'] = 'Grand Piano';
INSTRUMENT_LABELS['cello'] = 'Cello';
INSTRUMENT_LABELS['electricCello'] = 'Cello';
INSTRUMENT_LABELS['violin'] = 'Violin';
INSTRUMENT_LABELS['saxophone'] = 'Alto Saxophone';
INSTRUMENT_LABELS['strings'] = 'Strings';
INSTRUMENT_LABELS['keys'] = 'Keys';
INSTRUMENT_LABELS['winds'] = 'Winds';

// Map node types to allowed instrument categories
const NODE_TYPE_TO_CATEGORIES: Record<string, string[]> = {
    'strings': ['strings', 'bass'],
    'cello': ['strings'],
    'violin': ['strings'],
    'keys': ['piano'],
    'piano': ['piano'],
    'winds': ['woodwinds', 'brass', 'world'],
    'saxophone': ['woodwinds', 'brass'],
    'guitar': ['guitar', 'bass'],
    'instrument': ['piano', 'strings', 'guitar', 'bass', 'woodwinds', 'brass', 'synth', 'percussion', 'world']
};

// Get allowed categories for current node type
function getAllowedCategories(nodeType: string): string[] {
    return NODE_TYPE_TO_CATEGORIES[nodeType] || ['piano'];
}

// Main instrument node types to cycle through
const INSTRUMENT_NODE_TYPES = ['strings', 'keys', 'winds'] as const;

// Type guard imported from shared typeGuards module
const isInstrumentNodeData = isBasicInstrumentNodeData;

/**
 * ScrollableRowValue - Value display with scroll capture for row parameter adjustment
 * Uses useScrollCapture hook to properly prevent canvas scrolling
 */
interface ScrollableRowValueProps {
    value: number;
    onChange: (newValue: number) => void;
    min: number;
    max: number;
    step?: number;
    format: (v: number) => string;
    title: string;
    className: string;
}

const ScrollableRowValue = memo(function ScrollableRowValue({
    value,
    onChange,
    min,
    max,
    step = 1,
    format,
    title,
    className
}: ScrollableRowValueProps) {
    const handleScroll = useCallback((data: ScrollData) => {
        const delta = data.scrollingUp ? 1 : -1;
        const newValue = Math.max(min, Math.min(max, value + delta * step));
        if (newValue !== value) {
            onChange(newValue);
        }
    }, [value, onChange, min, max, step]);

    const { ref } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleScroll,
        capture: true,
    });

    // Commit an inline edit (click-to-type). The scroll path only ever lands on
    // the step grid, so the typed value must too: reject non-finite input, snap
    // to the same grid, then clamp. Without this, typing e.g. "3.7" into a
    // note/octave field would store a fractional index (NOTE_NAMES[3.7] → undefined).
    const handleCommit = useCallback((newValue: number) => {
        if (!Number.isFinite(newValue)) return;
        const snapped = Math.round((newValue - min) / step) * step + min;
        const clamped = Math.max(min, Math.min(max, snapped));
        if (clamped !== value) {
            onChange(clamped);
        }
    }, [value, onChange, min, max, step]);

    return (
        <span ref={ref} title={title}>
            <ValueScrubber
                value={value}
                display={format(value)}
                onCommit={handleCommit}
                className={className}
            />
        </span>
    );
});

// SVG Icons - keeping the icon definitions (abbreviated for brevity)
const InstrumentIcons: Record<string, React.ReactNode> = {
    piano: (
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 48 L8 24 Q8 16 16 16 L48 16 Q56 16 56 24 L56 48" strokeLinecap="round" />
            <line x1="8" y1="48" x2="56" y2="48" />
            <rect x="12" y="32" width="6" height="16" fill="currentColor" opacity="0.1" />
            <rect x="20" y="32" width="6" height="16" fill="currentColor" opacity="0.1" />
            <rect x="28" y="32" width="6" height="16" fill="currentColor" opacity="0.1" />
            <rect x="36" y="32" width="6" height="16" fill="currentColor" opacity="0.1" />
            <rect x="44" y="32" width="6" height="16" fill="currentColor" opacity="0.1" />
            <rect x="16" y="32" width="4" height="10" fill="currentColor" />
            <rect x="24" y="32" width="4" height="10" fill="currentColor" />
            <rect x="40" y="32" width="4" height="10" fill="currentColor" />
            <rect x="48" y="32" width="4" height="10" fill="currentColor" />
        </svg>
    ),
    keys: (
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="8" y="20" width="48" height="28" rx="3" />
            <line x1="16" y1="28" x2="16" y2="44" />
            <line x1="24" y1="28" x2="24" y2="44" />
            <line x1="32" y1="28" x2="32" y2="44" />
            <line x1="40" y1="28" x2="40" y2="44" />
            <line x1="48" y1="28" x2="48" y2="44" />
            <rect x="13" y="28" width="3" height="8" fill="currentColor" />
            <rect x="21" y="28" width="3" height="8" fill="currentColor" />
            <rect x="37" y="28" width="3" height="8" fill="currentColor" />
            <rect x="45" y="28" width="3" height="8" fill="currentColor" />
            <circle cx="20" cy="16" r="2" fill="currentColor" />
            <circle cx="32" cy="16" r="2" fill="currentColor" />
            <circle cx="44" cy="16" r="2" fill="currentColor" />
        </svg>
    ),
    strings: (
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 52 L16 16 Q16 8 24 8 L44 8" strokeLinecap="round" />
            <path d="M44 8 Q52 8 52 16 L52 52" strokeLinecap="round" />
            <line x1="16" y1="52" x2="52" y2="52" />
            <line x1="22" y1="14" x2="22" y2="52" strokeWidth="1" />
            <line x1="28" y1="12" x2="28" y2="52" strokeWidth="1" />
            <line x1="34" y1="10" x2="34" y2="52" strokeWidth="1" />
            <line x1="40" y1="12" x2="40" y2="52" strokeWidth="1" />
            <line x1="46" y1="14" x2="46" y2="52" strokeWidth="1" />
        </svg>
    ),
    winds: (
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="8" y="28" width="48" height="8" rx="4" />
            <circle cx="18" cy="32" r="2" fill="currentColor" />
            <circle cx="28" cy="32" r="2" fill="currentColor" />
            <circle cx="38" cy="32" r="2" fill="currentColor" />
            <circle cx="48" cy="32" r="2" fill="currentColor" />
            <path d="M56 32 L60 30 L60 34 Z" fill="currentColor" />
        </svg>
    ),
};

// Helper function to get the appropriate icon for an instrument
function getInstrumentIcon(instrumentId: string): React.ReactNode {
    if (InstrumentIcons[instrumentId]) {
        return InstrumentIcons[instrumentId];
    }
    const definition = InstrumentLoader.getDefinition(instrumentId);
    if (definition?.category && InstrumentIcons[definition.category]) {
        return InstrumentIcons[definition.category];
    }
    return InstrumentIcons.piano;
}

export const InstrumentNode = memo(function InstrumentNode({
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
}: InstrumentNodeProps) {
    // Use type guard for safe data access
    const data: InstrumentNodeData = isInstrumentNodeData(node.data)
        ? node.data
        : { rows: [] }; // Default empty data if validation fails
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const updateNodeType = useGraphStore((s) => s.updateNodeType);

    // Refs
    const nodeRef = useRef<HTMLDivElement>(null);

    // Popup state
    const [showPopup, setShowPopup] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

    // Drag state
    const [dragStartPos, setDragStartPos] = useState<{x: number, y: number} | null>(null);
    const [wasDragging, setWasDragging] = useState(false);

    // Get available categories for this node type
    const availableCategories = useMemo(() => {
        return getAllowedCategories(node.type);
    }, [node.type]);

    // Handle keyboard shortcuts for popup
    useEffect(() => {
        if (!showPopup) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowPopup(false);
                setSearchQuery('');
            } else if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                const currentIndex = INSTRUMENT_NODE_TYPES.indexOf(node.type as typeof INSTRUMENT_NODE_TYPES[number]);
                const validIndex = currentIndex >= 0 ? currentIndex : 0;
                let newIndex: number;
                if (e.key === 'ArrowRight') {
                    newIndex = (validIndex + 1) % INSTRUMENT_NODE_TYPES.length;
                } else {
                    newIndex = (validIndex - 1 + INSTRUMENT_NODE_TYPES.length) % INSTRUMENT_NODE_TYPES.length;
                }
                const newType = INSTRUMENT_NODE_TYPES[newIndex];
                updateNodeType(node.id, newType);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showPopup, node.type, node.id, updateNodeType]);

    // Click outside to close popup
    useEffect(() => {
        if (!showPopup) return;

        const handleClickOutside = (e: MouseEvent) => {
            const dropdown = document.querySelector('.instrument-selector-dropdown');
            if (dropdown && !dropdown.contains(e.target as Node)) {
                setShowPopup(false);
                setSearchQuery('');
            }
        };

        // Delay adding listener to avoid immediate trigger from the click that opened the popup
        const timeoutId = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showPopup]);

    // Dynamic dropdown positioning
    useEffect(() => {
        if (!showPopup || !nodeRef.current) return;

        const updateDropdownPosition = () => {
            if (!nodeRef.current) return;

            const nodeRect = nodeRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            const spaceBelow = viewportHeight - (nodeRect.top + DROPDOWN_LAYOUT.HEADER_HEIGHT);
            const desiredWidth = Math.min(
                viewportWidth * DROPDOWN_LAYOUT.MAX_WIDTH_RATIO,
                DROPDOWN_LAYOUT.MAX_WIDTH_PX
            );
            const desiredHeight = Math.min(
                viewportHeight * DROPDOWN_LAYOUT.MAX_HEIGHT_RATIO,
                DROPDOWN_LAYOUT.MAX_HEIGHT_PX
            );

            const actualHeight = Math.max(0, Math.min(
                desiredHeight,
                spaceBelow - DROPDOWN_LAYOUT.EDGE_PADDING_PX
            ));

            if (actualHeight < DROPDOWN_LAYOUT.MIN_HEIGHT_PX) {
                setDropdownStyle({ display: 'none' });
                return;
            }

            const actualWidth = Math.max(DROPDOWN_LAYOUT.MIN_WIDTH_PX, desiredWidth);
            const leftOffset = (nodeRect.width - actualWidth) / 2;

            setDropdownStyle({
                display: 'flex',
                top: DROPDOWN_LAYOUT.HEADER_HEIGHT,
                left: leftOffset,
                width: actualWidth,
                height: actualHeight,
            });
        };

        updateDropdownPosition();

        window.addEventListener('resize', updateDropdownPosition);
        const resizeObserver = new ResizeObserver(() => updateDropdownPosition());
        resizeObserver.observe(nodeRef.current);

        // ResizeObserver and resize listener are sufficient - no polling needed

        return () => {
            window.removeEventListener('resize', updateDropdownPosition);
            resizeObserver.disconnect();
        };
    }, [showPopup]);

    // Track mouse movement to detect dragging
    useEffect(() => {
        if (!dragStartPos) return;

        const handleMouseMove = (e: MouseEvent) => {
            const distance = Math.sqrt(
                Math.pow(e.clientX - dragStartPos.x, 2) +
                Math.pow(e.clientY - dragStartPos.y, 2)
            );
            if (distance > DRAG_THRESHOLD_PX) {
                setWasDragging(true);
            }
        };

        const handleMouseUp = () => {
            setDragStartPos(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragStartPos]);

    // Get rows data
    const rows: InstrumentRow[] = useMemo(() => data.rows || [], [data.rows]);

    // Get output port from the node
    const outputPort = node.ports.find(p => p.direction === 'output' && p.type === 'audio');

    // Memoized port for empty state (first available control input)
    const emptyStatePort = useMemo(() => {
        return node.ports.find(p =>
            p.direction === 'input' &&
            p.type === 'control'
        );
    }, [node.ports]);

    // Memoized port for adding new rows (first available unconnected control input)
    const availableNewRowPort = useMemo(() => {
        const connectedPorts = new Set(rows.map(r => r.targetPortId));
        return node.ports.find(p =>
            p.direction === 'input' &&
            p.type === 'control' &&
            !connectedPorts.has(p.id)
        );
    }, [node.ports, rows]);

    // Get display name - use validated 'data' variable instead of unsafe assertion
    const instrumentId = data.instrumentId || node.type;
    const displayName = INSTRUMENT_LABELS[instrumentId] || nodeDefinitions[node.type]?.name || 'Instrument';

    // Filter instruments by node type
    const filteredInstruments = useMemo(() => {
        let instruments: string[] = [];
        availableCategories.forEach(category => {
            const categoryInstruments = InstrumentLoader.getDefinitionsByCategory(category as Parameters<typeof InstrumentLoader.getDefinitionsByCategory>[0]);
            instruments.push(...categoryInstruments.map(def => def.id));
        });

        const query = searchQuery.toLowerCase().trim();
        if (query) {
            instruments = instruments.filter(id =>
                INSTRUMENT_LABELS[id]?.toLowerCase().includes(query)
            );
        }

        return instruments;
    }, [searchQuery, availableCategories]);

    // Group instruments by their base name
    const groupedInstruments = useMemo(() => {
        const groups = new Map<string, string[]>();

        filteredInstruments.forEach(id => {
            const def = InstrumentLoader.getDefinition(id);
            if (!def) return;
            const baseName = def.name;

            if (!groups.has(baseName)) {
                groups.set(baseName, []);
            }
            groups.get(baseName)!.push(id);
        });

        return Array.from(groups.entries())
            .map(([baseName, instruments]) => ({ baseName, instruments }))
            .sort((a, b) => a.baseName.localeCompare(b.baseName));
    }, [filteredInstruments]);

    // Handle header mouse down
    const handleHeaderMouseDownLocal = (e: React.MouseEvent) => {
        setDragStartPos({ x: e.clientX, y: e.clientY });
        setWasDragging(false);
        handleHeaderMouseDown?.(e);
    };

    // Handle instrument name click
    const handleInstrumentNameClick = (e: React.MouseEvent) => {
        if (isDragging || wasDragging) {
            setWasDragging(false);
            setDragStartPos(null);
            return;
        }

        if (dragStartPos) {
            const distance = Math.sqrt(
                Math.pow(e.clientX - dragStartPos.x, 2) +
                Math.pow(e.clientY - dragStartPos.y, 2)
            );
            if (distance > DRAG_THRESHOLD_PX) {
                setDragStartPos(null);
                setWasDragging(true);
                return;
            }
        }
        e.stopPropagation();
        setShowPopup(true);
        setSearchQuery('');
        setDragStartPos(null);
    };

    // Handle instrument selection
    const handleInstrumentSelect = (instId: string) => {
        updateNodeData(node.id, {
            ...data,
            instrumentId: instId
        });
        setShowPopup(false);
        setSearchQuery('');
    };

    // Update row field - memoized to prevent unnecessary re-renders
    const updateRowField = useCallback((rowId: string, field: keyof InstrumentRow, value: number) => {
        const currentRows = data.rows || [];
        const updatedRows = currentRows.map(row => {
            if (row.rowId === rowId) {
                return { ...row, [field]: value };
            }
            return row;
        });
        updateNodeData(node.id, { rows: updatedRows });
    }, [data.rows, node.id, updateNodeData]);

    return (
        <div
            ref={nodeRef}
            className={`instrument-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isHoveredWithConnections ? 'hover-connecting' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div
                className="schematic-header"
                onMouseDown={handleHeaderMouseDownLocal}
            >
                <span
                    className="schematic-title instrument-name-clickable"
                    onClick={handleInstrumentNameClick}
                >
                    {displayName}
                </span>
            </div>

            {/* Main body - clean row layout matching mockup */}
            <div className="instrument-schematic-body simple">
                {/* Rows container */}
                <div className="instrument-rows-simple">
                    {rows.length === 0 ? (
                        /* Empty state - use memoized port */
                        emptyStatePort && (
                            <div className="instrument-row-simple empty-state">
                                <Port
                                    kind="control"
                                    direction="input"
                                    className="bundle-input-port empty"
                                    style={{ width: '12px', height: '12px' }}
                                    data-node-id={node.id}
                                    data-port-id={emptyStatePort.id}
                                    onMouseDown={(e) => handlePortMouseDown?.(emptyStatePort.id, e)}
                                    onMouseUp={(e) => handlePortMouseUp?.(emptyStatePort.id, e)}
                                    onMouseEnter={() => handlePortMouseEnter?.(emptyStatePort.id)}
                                    onMouseLeave={handlePortMouseLeave}
                                    title="Connect keyboard bundle"
                                />
                            </div>
                        )
                    ) : (
                        /* Show rows with connections */
                        <>
                            {rows.map((row, index) => {
                                const rowPort = node.ports.find(p => p.id === row.targetPortId);
                                const isPedal = row.portCount === 1;  // Pedal is a size-1 bundle

                                return (
                                    <div key={row.rowId} className={`instrument-row-simple ${index > 0 ? 'with-divider' : ''} ${isPedal ? 'pedal-row' : ''}`}>
                                        {/* Input port for this row's bundle */}
                                        <Port
                                            kind="control"
                                            direction="input"
                                            connected={!!(rowPort && hasConnection?.(rowPort.id))}
                                            className={`bundle-input-port ${isPedal ? 'pedal' : ''} ${rowPort && hasConnection?.(rowPort.id) ? 'connected' : ''}`}
                                            style={{ width: '12px', height: '12px' }}
                                            data-node-id={node.id}
                                            data-port-id={rowPort?.id || 'bundle-in'}
                                            onMouseDown={(e) => handlePortMouseDown?.(rowPort?.id || 'bundle-in', e)}
                                            onMouseUp={(e) => handlePortMouseUp?.(rowPort?.id || 'bundle-in', e)}
                                            onMouseEnter={() => handlePortMouseEnter?.(rowPort?.id || 'bundle-in')}
                                            onMouseLeave={handlePortMouseLeave}
                                            title={row.label || 'Bundle input'}
                                        />

                                        {isPedal ? (
                                            /* Pedal row - just show label (Note/Octave/Offset don't apply) */
                                            <span className="pedal-label">Pedal</span>
                                        ) : (
                                            /* Key row - show Note, Octave, Offset with scroll capture */
                                            <>
                                                <ScrollableRowValue
                                                    value={row.baseNote}
                                                    onChange={(v) => updateRowField(row.rowId, 'baseNote', v)}
                                                    min={ROW_PARAM_RANGES.NOTE.min}
                                                    max={ROW_PARAM_RANGES.NOTE.max}
                                                    format={(v) => NOTE_NAMES[v] || 'C'}
                                                    title="Note (chromatic) - scroll to change"
                                                    className="row-value note-value editable-value"
                                                />
                                                <ScrollableRowValue
                                                    value={row.baseOctave}
                                                    onChange={(v) => updateRowField(row.rowId, 'baseOctave', v)}
                                                    min={ROW_PARAM_RANGES.OCTAVE.min}
                                                    max={ROW_PARAM_RANGES.OCTAVE.max}
                                                    format={(v) => String(v)}
                                                    title={`Octave (${ROW_PARAM_RANGES.OCTAVE.min}-${ROW_PARAM_RANGES.OCTAVE.max}) - scroll to change`}
                                                    className="row-value octave-value editable-value"
                                                />
                                                <ScrollableRowValue
                                                    value={row.baseOffset}
                                                    onChange={(v) => updateRowField(row.rowId, 'baseOffset', v)}
                                                    min={ROW_PARAM_RANGES.OFFSET.min}
                                                    max={ROW_PARAM_RANGES.OFFSET.max}
                                                    format={(v) => v >= 0 ? `+${v}` : String(v)}
                                                    title={`Offset (${ROW_PARAM_RANGES.OFFSET.min} to +${ROW_PARAM_RANGES.OFFSET.max}) - scroll to change`}
                                                    className="row-value offset-value editable-value"
                                                />
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                            {/* Empty row for adding new connections - use memoized port */}
                            {availableNewRowPort && (
                                <div className="instrument-row-simple empty-row with-divider">
                                    <Port
                                        kind="control"
                                        direction="input"
                                        className="bundle-input-port empty"
                                        style={{ width: '12px', height: '12px' }}
                                        data-node-id={node.id}
                                        data-port-id={availableNewRowPort.id}
                                        onMouseDown={(e) => handlePortMouseDown?.(availableNewRowPort.id, e)}
                                        onMouseUp={(e) => handlePortMouseUp?.(availableNewRowPort.id, e)}
                                        onMouseEnter={() => handlePortMouseEnter?.(availableNewRowPort.id)}
                                        onMouseLeave={handlePortMouseLeave}
                                        title="Connect keyboard bundle"
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Output port on right bottom */}
                {outputPort && (
                    <Port
                        kind="audio"
                        direction="output"
                        connected={!!hasConnection?.(outputPort.id)}
                        className={`instrument-output-port ${hasConnection?.(outputPort.id) ? 'connected' : ''}`}
                        style={{ width: '16px', height: '16px' }}
                        data-node-id={node.id}
                        data-port-id={outputPort.id}
                        onMouseDown={(e) => handlePortMouseDown?.(outputPort.id, e)}
                        onMouseUp={(e) => handlePortMouseUp?.(outputPort.id, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(outputPort.id)}
                        onMouseLeave={handlePortMouseLeave}
                        title="Audio output"
                    />
                )}
            </div>

            {/* Instrument Selector Dropdown */}
            {showPopup && (
                <div
                    className="instrument-selector-dropdown"
                    style={dropdownStyle}
                    onClick={(e) => e.stopPropagation()}
                >
                    <input
                        className="instrument-search"
                        type="text"
                        placeholder="Search instruments..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                    <ScrollContainer mode="dropdown" className="instrument-grid-container">
                        <div className="instrument-grid-grouped">
                            {groupedInstruments.map((group, groupIndex) => (
                                <div key={group.baseName} className="instrument-group">
                                    {groupIndex > 0 && <div className="instrument-group-separator" />}
                                    {groupedInstruments.length > 1 && (
                                        <div className="instrument-group-label">{group.baseName}</div>
                                    )}
                                    <div className="instrument-group-items">
                                        {group.instruments.map(instId => {
                                            const currentInstrumentId = data.instrumentId || node.type;
                                            return (
                                                <div
                                                    key={instId}
                                                    className={`instrument-card ${currentInstrumentId === instId ? 'selected' : ''}`}
                                                    onClick={() => handleInstrumentSelect(instId)}
                                                >
                                                    <div className="instrument-icon">
                                                        {getInstrumentIcon(instId)}
                                                    </div>
                                                    <div className="instrument-name">
                                                        {INSTRUMENT_LABELS[instId]}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {filteredInstruments.length === 0 && (
                            <div className="no-results">No instruments found</div>
                        )}
                    </ScrollContainer>
                    <div className="category-nav-hint">
                        {node.type.charAt(0).toUpperCase() + node.type.slice(1)} | Ctrl + ← → to switch type
                    </div>
                </div>
            )}
        </div>
    );
});
