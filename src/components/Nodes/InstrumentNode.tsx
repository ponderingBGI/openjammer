/**
 * Instrument Node — the voice, its sockets, and the tuning of each row.
 *
 * Wave 5 / P8 rebuild. Three things changed shape:
 *
 *  1. The card is a `NodeShell`. Sockets are the first body row (D7) — every
 *     connected keyboard row on the left, the audio out on the right — so the
 *     wiring reads before the tuning, the way it does on every other node.
 *  2. The instrument picker is the shared `Menu`: real `role="menu"` rows with
 *     roving Arrow/Home/End focus, categories, Escape, and outside-click on
 *     `pointerdown`. It replaces a bespoke grid of clickable `div`s that no
 *     keyboard could reach. It anchors to the card instead of measuring the
 *     viewport, which also fixes the picker mispositioning at any zoom ≠ 1.
 *  3. Row values are the shared `ValueScrubber` — one scrub/type control in the
 *     app, not a private copy per faceplate.
 *
 * The name in the header is a real `<button>`: the whole reason this node has a
 * header is that you can change what it sounds like from it.
 */

import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import type { GraphNode, InstrumentNodeData, InstrumentRow, PortDefinition } from '../../engine/types';
import { isBasicInstrumentNodeData } from '../../engine/typeGuards';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { nodeDefinitions } from '../../engine/registry';
import { InstrumentLoader } from '../../audio/instrumentCatalog';
import { useModalKeymap } from '../../keymap/useKeymap';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import {
    Input,
    Menu,
    MenuCategory,
    MenuItem,
    NodeFrame,
    NodeShell,
    PortRow,
    ValueScrubber,
} from '@openjammer/oj-ui';
import { NOTE_NAMES } from '../controls/noteNames';
import './InstrumentNode.css';

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

/** Row parameter ranges — the musical limits, not UI guesses. */
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

/** Allowed instrument categories for a node type. */
function getAllowedCategories(nodeType: string): string[] {
    return NODE_TYPE_TO_CATEGORIES[nodeType] || ['piano'];
}

/** Main instrument node types Ctrl+←/→ cycles through. */
const INSTRUMENT_NODE_TYPES = ['strings', 'keys', 'winds'] as const;

const isInstrumentNodeData = isBasicInstrumentNodeData;

/** One shared empty shape, so an unreadable node does not churn every memo. */
const EMPTY_INSTRUMENT_DATA: InstrumentNodeData = { rows: [] };

// ============================================================================
// Row value — the shared ValueScrubber, with the wheel wired to it
// ============================================================================

interface RowValueProps {
    label: string;
    value: number;
    onChange: (newValue: number) => void;
    min: number;
    max: number;
    step?: number;
    format: (v: number) => string;
    title: string;
}

/**
 * One tunable number on a row. The wheel steps it (through `useScrollCapture`,
 * so the canvas never scrolls underneath); a click types it. `ValueScrubber`
 * owns the chip and the inline editor — this only owns the grid the value snaps
 * to, which both paths must share or a typed `3.7` becomes `NOTE_NAMES[3.7]`.
 */
const RowValue = memo(function RowValue({
    label, value, onChange, min, max, step = 1, format, title,
}: RowValueProps) {
    const snap = useCallback((next: number) => {
        if (!Number.isFinite(next)) return;
        const snapped = Math.round((next - min) / step) * step + min;
        const clamped = Math.max(min, Math.min(max, snapped));
        if (clamped !== value) onChange(clamped);
    }, [value, onChange, min, max, step]);

    const handleScroll = useCallback((data: ScrollData) => {
        snap(value + (data.scrollingUp ? step : -step));
    }, [snap, value, step]);

    const { ref } = useScrollCapture<HTMLSpanElement>({ onScroll: handleScroll, capture: true });

    return (
        <span ref={ref} className="inst-value" title={title}>
            <ValueScrubber label={label} value={value} display={format(value)} onCommit={snap} />
        </span>
    );
});

// ============================================================================
// Icons
// ============================================================================

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

function getInstrumentIcon(instrumentId: string): React.ReactNode {
    if (InstrumentIcons[instrumentId]) return InstrumentIcons[instrumentId];
    const definition = InstrumentLoader.getDefinition(instrumentId);
    if (definition?.category && InstrumentIcons[definition.category]) {
        return InstrumentIcons[definition.category];
    }
    return InstrumentIcons.piano;
}

// ============================================================================
// Node
// ============================================================================

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
}: InstrumentNodeProps) {
    // Memoized so the `{ rows: [] }` fallback is one stable object, not a new
    // one per render — every callback below closes over it.
    const data: InstrumentNodeData = useMemo(
        () => (isInstrumentNodeData(node.data) ? node.data : EMPTY_INSTRUMENT_DATA),
        [node.data],
    );
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const updateNodeType = useGraphStore((s) => s.updateNodeType);
    const isAgentPending = useIsAgentPending(node.id);

    const cardRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const [showPicker, setShowPicker] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // While the picker is open it owns the keyboard. An EMPTY modal binding set
    // is the app's own seam for that: the arbiter runs only the top-most modal
    // set, so no canvas letter (which is a NOTE in keyboard mode) can fire while
    // a menu row has focus.
    useModalKeymap(`instrument-picker-${node.id}`, showPicker);

    const closePicker = useCallback(() => {
        setShowPicker(false);
        setSearchQuery('');
    }, []);

    // Outside-click on pointerdown — not a deferred click, which can be missed.
    useEffect(() => {
        if (!showPicker) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!cardRef.current?.contains(e.target as Node)) closePicker();
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [showPicker, closePicker]);

    useEffect(() => {
        if (showPicker) searchRef.current?.focus();
    }, [showPicker]);

    const availableCategories = useMemo(() => getAllowedCategories(node.type), [node.type]);

    /** Ctrl+←/→ swaps the instrument FAMILY while the picker is open. */
    const handlePickerKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!e.ctrlKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const current = INSTRUMENT_NODE_TYPES.indexOf(node.type as typeof INSTRUMENT_NODE_TYPES[number]);
        const index = current >= 0 ? current : 0;
        const next = e.key === 'ArrowRight'
            ? (index + 1) % INSTRUMENT_NODE_TYPES.length
            : (index - 1 + INSTRUMENT_NODE_TYPES.length) % INSTRUMENT_NODE_TYPES.length;
        updateNodeType(node.id, INSTRUMENT_NODE_TYPES[next]);
    }, [node.type, node.id, updateNodeType]);

    /** ArrowDown out of the search field lands on the first menu row. */
    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closePicker();
            return;
        }
        if (e.key !== 'ArrowDown') return;
        e.preventDefault();
        cardRef.current
            ?.querySelector<HTMLElement>('.oj-menu-item:not([aria-disabled="true"])')
            ?.focus();
    }, [closePicker]);

    const rows: InstrumentRow[] = useMemo(() => data.rows || [], [data.rows]);

    const outputPort = node.ports.find((p) => p.direction === 'output' && p.type === 'audio');

    /** The next unconnected control input — the "always one free slot" socket. */
    const availableNewRowPort = useMemo(() => {
        const taken = new Set(rows.map((r) => r.targetPortId));
        return node.ports.find(
            (p) => p.direction === 'input' && p.type === 'control' && !taken.has(p.id),
        );
    }, [node.ports, rows]);

    const instrumentId = data.instrumentId || node.type;
    const displayName = INSTRUMENT_LABELS[instrumentId] || nodeDefinitions[node.type]?.name || 'Instrument';

    const filteredInstruments = useMemo(() => {
        let instruments: string[] = [];
        availableCategories.forEach((category) => {
            const categoryInstruments = InstrumentLoader.getDefinitionsByCategory(
                category as Parameters<typeof InstrumentLoader.getDefinitionsByCategory>[0],
            );
            instruments.push(...categoryInstruments.map((def) => def.id));
        });
        const query = searchQuery.toLowerCase().trim();
        if (query) {
            instruments = instruments.filter((id) => INSTRUMENT_LABELS[id]?.toLowerCase().includes(query));
        }
        return instruments;
    }, [searchQuery, availableCategories]);

    /**
     * Grouped by FAMILY, not by name.
     *
     * The old picker grouped by `def.name` — and since a definition's name is
     * also its label, every group held exactly one instrument and the list read
     * "ACOUSTIC GRAND PIANO / Acoustic Grand Piano, CHURCH ORGAN / Church Organ":
     * a header above every row, saying the row again. Grouping by the catalogue's
     * own category is the taxonomy the player is actually choosing within, and it
     * only appears when this node type spans more than one family.
     */
    const groupedInstruments = useMemo(() => {
        const groups = new Map<string, string[]>();
        filteredInstruments.forEach((id) => {
            const def = InstrumentLoader.getDefinition(id);
            if (!def) return;
            const family = def.category ?? 'other';
            if (!groups.has(family)) groups.set(family, []);
            groups.get(family)!.push(id);
        });
        return availableCategories
            .filter((family) => groups.has(family))
            .map((family) => ({
                family,
                label: family.charAt(0).toUpperCase() + family.slice(1),
                instruments: groups
                    .get(family)!
                    .sort((a, b) => (INSTRUMENT_LABELS[a] ?? a).localeCompare(INSTRUMENT_LABELS[b] ?? b)),
            }));
    }, [filteredInstruments, availableCategories]);

    const selectInstrument = useCallback((instId: string) => {
        updateNodeData(node.id, { ...data, instrumentId: instId });
        closePicker();
    }, [updateNodeData, node.id, data, closePicker]);

    const updateRowField = useCallback((rowId: string, field: keyof InstrumentRow, value: number) => {
        const updated = (data.rows || []).map((row) => (row.rowId === rowId ? { ...row, [field]: value } : row));
        updateNodeData(node.id, { rows: updated });
    }, [data.rows, node.id, updateNodeData]);

    const socket = (port: PortDefinition, label: React.ReactNode, title: string, placeholder = false) => (
        <PortRow
            key={port.id}
            side={port.direction}
            kind={port.type}
            connected={!!hasConnection?.(port.id)}
            placeholder={placeholder}
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

    // Input sockets: EVERY control input, not just the configured rows.
    //
    // A keyboard's `Row 1` bundle arrives with a row (label, note, octave,
    // offset). A leaf source — a visual keyboard's own `Row 1` port, a Math
    // node, a plugin — arrives with none, and the old faceplate drew nothing for
    // it: the cable landed on a node that looked unplugged. Every live cable now
    // has a socket row of its own, named by its row when there is one and by the
    // port when there is not.
    const rowByPort = new Map(rows.map((row) => [row.targetPortId, row]));
    const inputSockets: React.ReactNode[] = [];
    for (const port of node.ports) {
        if (port.direction !== 'input' || port.type !== 'control') continue;
        const row = rowByPort.get(port.id);
        if (row) {
            inputSockets.push(socket(port, row.label || 'BUNDLE', row.label || 'Bundle input'));
        } else if (hasConnection?.(port.id)) {
            inputSockets.push(socket(port, 'IN', 'Note input'));
        }
    }
    if (availableNewRowPort && !hasConnection?.(availableNewRowPort.id)) {
        inputSockets.push(
            socket(availableNewRowPort, 'ADD ROW', 'Connect a keyboard row', true),
        );
    }

    /** Something is plugged into a note input — the instrument is sounding. */
    const anyNoteInput = node.ports.some(
        (p) => p.direction === 'input' && p.type === 'control' && hasConnection?.(p.id),
    );

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`inst-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <div className="inst-anchor" ref={cardRef}>
                <NodeShell
                    className={`instrument-node${isHoveredWithConnections ? ' is-drop-target' : ''}`}
                    title={
                        <button
                            type="button"
                            className="inst-name"
                            aria-haspopup="menu"
                            aria-expanded={showPicker}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowPicker((open) => !open);
                                setSearchQuery('');
                            }}
                        >
                            {displayName}
                        </button>
                    }
                    nodeType={node.type}
                    headerAction={
                        data.voiceLoadError ? (
                            <span
                                className="inst-voice-error"
                                title="This instrument's built-in voice could not be loaded. Reselect it or reload to retry."
                                aria-label="Voice failed to load"
                            >
                                !
                            </span>
                        ) : undefined
                    }
                    selected={!!isSelected}
                    dragging={!!isDragging}
                    agentPending={isAgentPending}
                    headerProps={{ onMouseDown: handleHeaderMouseDown }}
                    inputs={inputSockets}
                    outputs={outputPort ? [socket(outputPort, 'AUDIO', 'Audio output')] : []}
                >
                    {rows.length === 0 ? (
                        <p className="inst-empty">
                            {anyNoteInput
                                ? 'Playing. Note, octave and offset appear when the notes arrive as a keyboard bundle.'
                                : 'Connect a keyboard row to play this instrument.'}
                        </p>
                    ) : (
                        <div className="inst-tune">
                            {rows.map((row) => {
                                const isPedal = row.portCount === 1;
                                return (
                                    <div key={row.rowId} className={`inst-row${isPedal ? ' is-pedal' : ''}`}>
                                        <span className="inst-row__name">{row.label || 'Row'}</span>
                                        {isPedal ? (
                                            <span className="inst-row__pedal">SUSTAIN</span>
                                        ) : (
                                            <>
                                                <RowValue
                                                    label="NOTE"
                                                    value={row.baseNote}
                                                    onChange={(v) => updateRowField(row.rowId, 'baseNote', v)}
                                                    min={ROW_PARAM_RANGES.NOTE.min}
                                                    max={ROW_PARAM_RANGES.NOTE.max}
                                                    format={(v) => NOTE_NAMES[v] || 'C'}
                                                    title="Root note (chromatic) — scroll or click"
                                                />
                                                <RowValue
                                                    label="OCT"
                                                    value={row.baseOctave}
                                                    onChange={(v) => updateRowField(row.rowId, 'baseOctave', v)}
                                                    min={ROW_PARAM_RANGES.OCTAVE.min}
                                                    max={ROW_PARAM_RANGES.OCTAVE.max}
                                                    format={(v) => String(v)}
                                                    title={`Octave (${ROW_PARAM_RANGES.OCTAVE.min}-${ROW_PARAM_RANGES.OCTAVE.max}) — scroll or click`}
                                                />
                                                <RowValue
                                                    label="OFF"
                                                    value={row.baseOffset}
                                                    onChange={(v) => updateRowField(row.rowId, 'baseOffset', v)}
                                                    min={ROW_PARAM_RANGES.OFFSET.min}
                                                    max={ROW_PARAM_RANGES.OFFSET.max}
                                                    format={(v) => (v >= 0 ? `+${v}` : String(v))}
                                                    title={`Semitone offset (${ROW_PARAM_RANGES.OFFSET.min} to +${ROW_PARAM_RANGES.OFFSET.max}) — scroll or click`}
                                                />
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </NodeShell>

                {showPicker && (
                    <div
                        className="inst-picker"
                        onKeyDown={handlePickerKeyDown}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <Input
                            ref={searchRef}
                            className="inst-picker__search"
                            type="text"
                            placeholder="Search instruments…"
                            aria-label="Search instruments"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                        <div className="inst-picker__list">
                            {groupedInstruments.length === 0 ? (
                                <p className="inst-picker__empty">No instruments match “{searchQuery}”.</p>
                            ) : (
                                <Menu ariaLabel={`${displayName} — choose a voice`} onEscape={closePicker}>
                                    {groupedInstruments.flatMap((group) => [
                                        ...(groupedInstruments.length > 1
                                            ? [<MenuCategory key={`cat-${group.family}`} label={group.label} />]
                                            : []),
                                        ...group.instruments.map((instId) => (
                                            <MenuItem
                                                key={instId}
                                                className={`inst-item${instrumentId === instId ? ' is-current' : ''}`}
                                                aria-current={instrumentId === instId || undefined}
                                                leadingIcon={<span className="inst-item__icon">{getInstrumentIcon(instId)}</span>}
                                                label={INSTRUMENT_LABELS[instId] ?? instId}
                                                onSelect={() => selectInstrument(instId)}
                                            />
                                        )),
                                    ])}
                                </Menu>
                            )}
                        </div>
                        <p className="inst-picker__hint">
                            {node.type.charAt(0).toUpperCase() + node.type.slice(1)} · Ctrl + ← → switches family
                        </p>
                    </div>
                )}
            </div>
        </NodeFrame>
    );
});
