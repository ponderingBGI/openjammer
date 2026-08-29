/**
 * Keyboard Visual Node — the playable on-screen keyboard.
 *
 * This node used to be a MIRROR: it drew 30 keycaps, lit them from
 * `audioStore.activeKeys` (ANY keyboard's, not its own), and emitted nothing. A
 * beginner was told "press the keys" while looking at a card that could not make
 * a sound. Wave 5 / P8 closes that (master-plan follow-up #1):
 *
 *  • It REGISTERS as a keyboard source — the same `registerKeyboard(n, id)` seam
 *    `KeyboardNode` uses — so pressing its number focuses it and the QWERTY rows
 *    play through it. The number is ALLOCATED ONCE when the node enters the graph
 *    and persisted on it, under the one law both keyboard kinds now obey
 *    (`store/keyboardModes.ts`): nothing another node does ever moves it.
 *  • It BUNDLES its rows: `Row 1 / Row 2 / Row 3 / Pedal` output sockets (registry) —
 *    the ONLY sockets it has, because those are the only ports the note path
 *    resolves. The key faces play; the row sockets patch. A rig is
 *    keyboard-visual → instrument → speaker.
 *  • Clicking a key is a note — the SAME `emitKeyboardSignal` path as typing, so
 *    per-note sustain, cable pulses and the e2e note bridge all see one kind of
 *    event.
 *  • Inside a `keyboard` container it stays the mirror, but an honest one: it
 *    plays and lights THROUGH ITS PARENT instead of registering a second source.
 *
 * The key face is the instrument; the well in its corner is the wiring. Press the
 * face to play, drag from the well to patch — and while a cable is already in the
 * air the whole tile is a socket, because that is what the hand is aiming at.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAudioStore } from '../../store/audioStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useGraphStore } from '../../store/graphStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import type { GraphNode } from '../../engine/types';
import { KeyTile, NodeFrame, NodeShell, PortRow } from '@openjammer/oj-ui';
import { noteLabelFromDegree } from '../controls/noteNames';
import { isKeyboardMirror, keyboardModeOf, MIN_KEYBOARD_MODE } from '../../store/keyboardModes';
import './KeyboardVisualNode.css';

interface KeyboardVisualNodeProps {
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

/**
 * The QWERTY layout, row by row. The index within a row IS `keyIndex` in the
 * `(keyboardId, row, keyIndex)` note seam — these arrays and `NodeCanvas`'s
 * `ROW_KEYS` describe the same physical keys.
 */
const ROW_KEYS: readonly string[][] = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'],
];

/** Display character → port id. Punctuation cannot go into an id verbatim. */
const PORT_ID_BY_KEY: Record<string, string> = {
    ',': 'key-comma',
    '.': 'key-period',
    '/': 'key-slash',
};
const portIdFor = (key: string): string => PORT_ID_BY_KEY[key] ?? `key-${key.toLowerCase()}`;

/** Which of THIS keyboard's keys are down, read off the shared `activeKeys` set. */
function pressedKeys(activeKeys: Set<string>, keyboardId: string): Set<string> {
    const prefix = `${keyboardId}-`;
    const down = new Set<string>();
    for (const entry of activeKeys) {
        if (!entry.startsWith(prefix)) continue;
        const parts = entry.split('-');
        const keyIndex = Number(parts[parts.length - 1]);
        const row = Number(parts[parts.length - 2]);
        if (!Number.isInteger(row) || !Number.isInteger(keyIndex)) continue;
        down.add(`${row}:${keyIndex}`);
    }
    return down;
}

type PlayTarget = { row: number; keyIndex: number } | 'pedal';

export function KeyboardVisualNode({
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
}: KeyboardVisualNodeProps) {
    const activeKeys = useAudioStore((s) => s.activeKeys);
    const controlDown = useAudioStore((s) => s.controlDown);
    const activeKeyboardId = useAudioStore((s) => s.activeKeyboardId);
    const registerKeyboard = useAudioStore((s) => s.registerKeyboard);
    const unregisterKeyboard = useAudioStore((s) => s.unregisterKeyboard);
    const isConnecting = useCanvasStore((s) => s.isConnecting);
    const isFlashing = useUIFeedbackStore((s) => s.flashingNodes.has(node.id));
    const isAgentPending = useIsAgentPending(node.id);

    // Narrow selectors: both collapse to a primitive, so a graph edit elsewhere
    // never re-renders 30 keycaps.
    const isMirror = useGraphStore(useCallback((s) => isKeyboardMirror(s.nodes, node), [node]));
    // Persisted, allocated once by `addNode`. Read from the LIVE node so undo /
    // redo of the add is reflected; the fallback only covers a node that somehow
    // reached the canvas without going through the allocator.
    const assignedKey = useGraphStore(
        useCallback((s) => keyboardModeOf(s.nodes.get(node.id)) ?? MIN_KEYBOARD_MODE, [node.id]),
    );

    // The id notes are emitted under. A mirror plays THROUGH its parent keyboard:
    // that is where the row bundles and the instrument connections live.
    const sourceId = isMirror && node.parentId ? node.parentId : node.id;
    const isActive = activeKeyboardId === sourceId;

    // Register as a real keyboard source — the seam `activeKeyboardId` and the
    // whole typing path resolve against. A mirror does not: its parent already did.
    useEffect(() => {
        if (isMirror) return;
        registerKeyboard(assignedKey, node.id);
        return () => unregisterKeyboard(assignedKey);
    }, [isMirror, assignedKey, node.id, registerKeyboard, unregisterKeyboard]);

    const down = useMemo(() => pressedKeys(activeKeys, sourceId), [activeKeys, sourceId]);
    const rowOctaves = (node.data as { rowOctaves?: number[] }).rowOctaves ?? [4, 4, 4];

    // One held note per pointer, so a drag off the tile (or a lost capture) still
    // ends the note exactly once. A stuck note is the one bug a player cannot work
    // around mid-set.
    const held = useRef(new Map<number, PlayTarget>());

    const release = useCallback((target: PlayTarget) => {
        const audio = useAudioStore.getState();
        if (target === 'pedal') audio.emitControlUp(sourceId);
        else audio.releaseKeyboardSignal(sourceId, target.row, target.keyIndex);
    }, [sourceId]);

    const press = useCallback((target: PlayTarget) => {
        const audio = useAudioStore.getState();
        if (target === 'pedal') audio.emitControlDown(sourceId);
        else audio.emitKeyboardSignal(sourceId, target.row, target.keyIndex);
    }, [sourceId]);

    const releasePointer = useCallback((pointerId: number) => {
        const target = held.current.get(pointerId);
        if (target === undefined) return;
        held.current.delete(pointerId);
        release(target);
    }, [release]);

    // Anything still sounding when the faceplate goes away is a stuck note.
    useEffect(() => {
        const pending = held.current;
        return () => {
            for (const [pointerId, target] of [...pending.entries()]) {
                pending.delete(pointerId);
                const audio = useAudioStore.getState();
                if (target === 'pedal') audio.emitControlUp(sourceId);
                else audio.releaseKeyboardSignal(sourceId, target.row, target.keyIndex);
            }
        };
    }, [sourceId]);

    /**
     * One tile, one or two jobs.
     *
     * A PLAYABLE keyboard has no per-key port (see the registry): the tile is
     * purely the instrument, and the row socket beside it is the wiring. The
     * MIRROR inside a `keyboard` container does have one per key — those are
     * really wired to the container's output panel — so there the embedded well
     * patches, and while a cable is already in the air the WHOLE tile is the
     * socket, because that is the target the hand is aiming at.
     */
    const tileHandlers = (portId: string | undefined, target: PlayTarget) => ({
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
            if (e.button !== 0) return;
            if (!portId) {
                // No socket here. Don't steal a cable in flight — let it land (or
                // miss) on a real port rather than firing a note under the drag.
                if (isConnecting) return;
            } else {
                const onWell = (e.target as HTMLElement).closest('.oj-port') !== null;
                if (onWell || isConnecting) {
                    handlePortMouseDown?.(portId, e);
                    return;
                }
            }
            e.preventDefault();
            e.stopPropagation();
            try {
                e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
                /* Capture is an optimisation; onPointerLeave is the backstop. */
            }
            held.current.set(e.pointerId, target);
            press(target);
        },
        onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
            if (held.current.has(e.pointerId)) {
                releasePointer(e.pointerId);
                return;
            }
            if (portId) handlePortMouseUp?.(portId, e);
        },
        onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => releasePointer(e.pointerId),
        onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => releasePointer(e.pointerId),
        onPointerEnter: () => { if (portId) handlePortMouseEnter?.(portId); },
        onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => {
            // Without capture (touch fallback) a slide off the key must still end it.
            if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) releasePointer(e.pointerId);
            if (portId) handlePortMouseLeave?.();
        },
        // Keyboard-operable: a focused key plays on Enter and stops on release.
        onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
            if (e.key !== 'Enter' || e.repeat) return;
            e.preventDefault();
            press(target);
        },
        onKeyUp: (e: React.KeyboardEvent<HTMLButtonElement>) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            release(target);
        },
    });

    const socketProps = (portId: string) => ({
        'data-node-id': node.id,
        'data-port-id': portId,
        'data-port-type': 'control',
        onMouseDown: (e: React.MouseEvent) => handlePortMouseDown?.(portId, e),
        onMouseUp: (e: React.MouseEvent) => handlePortMouseUp?.(portId, e),
        onMouseEnter: () => handlePortMouseEnter?.(portId),
        onMouseLeave: handlePortMouseLeave,
    });

    const portIds = useMemo(() => new Set(node.ports.map((p) => p.id)), [node.ports]);
    const spacePortId = portIds.has('key-space') ? 'key-space' : undefined;

    /** The bundle socket that closes a key row — or a spacer when this instance
     *  is an old mirror whose ports predate row bundling. */
    const bundle = (portId: string, label: string, title: string) =>
        portIds.has(portId) ? (
            <PortRow
                key={portId}
                className="kv-bundle"
                side="output"
                kind="control"
                label={label}
                connected={!!hasConnection?.(portId)}
                title={title}
                {...socketProps(portId)}
            />
        ) : (
            <span key={portId} className="kv-bundle kv-bundle--empty" aria-hidden="true" />
        );

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`kv-frame${isSelected ? ' is-selected' : ''}${isFlashing ? ' flashing' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className={`keyboard-visual-node${isActive ? ' is-mode-active' : ''}`}
                title="Keys"
                nodeType={isMirror ? 'MIRROR' : `MODE ${assignedKey}`}
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{ onMouseDown: handleHeaderMouseDown }}
            >
                <div className="kv-grid">
                    {ROW_KEYS.map((keys, rowIndex) => {
                        const row = rowIndex + 1;
                        const octave = rowOctaves[rowIndex] ?? 4;
                        return [
                            <div className={`kv-keys kv-keys--${row}`} key={`keys-${row}`}>
                                {keys.map((key, keyIndex) => {
                                    const keyPortId = portIdFor(key);
                                    // Only the mirror carries a per-key port; a playable
                                    // keyboard patches through its ROW socket.
                                    const portId = portIds.has(keyPortId) ? keyPortId : undefined;
                                    return (
                                        <KeyTile
                                            key={keyPortId}
                                            variant="key"
                                            size={34}
                                            className="keyboard-visual-key"
                                            label={key}
                                            hint={isMirror ? undefined : noteLabelFromDegree(keyIndex, octave)}
                                            active={down.has(`${row}:${keyIndex}`)}
                                            connected={!!(portId && hasConnection?.(portId))}
                                            aria-label={`Row ${row}, key ${key}`}
                                            title={portId ? `${key} → ${portId}` : `${key} — plays on row ${row}`}
                                            data-node-id={node.id}
                                            data-port-id={portId}
                                            data-port-type={portId ? 'control' : undefined}
                                            {...tileHandlers(portId, { row, keyIndex })}
                                        />
                                    );
                                })}
                            </div>,
                            bundle(`row-${row}`, `ROW ${row}`, `Row ${row} — all ${keys.length} keys on one cable`),
                        ];
                    })}

                    <div className="kv-keys kv-keys--space" key="keys-space">
                        <KeyTile
                            variant="key"
                            size={34}
                            className="keyboard-visual-key keyboard-visual-key--space"
                            label="SPACE"
                            hint={isMirror ? undefined : 'HOLD'}
                            active={controlDown && isActive}
                            connected={!!(spacePortId && hasConnection?.(spacePortId))}
                            aria-label="Sustain (space)"
                            title={spacePortId ? 'Space → key-space (sustain)' : 'Space — sustain, patched from PEDAL'}
                            data-node-id={node.id}
                            data-port-id={spacePortId}
                            data-port-type={spacePortId ? 'control' : undefined}
                            {...tileHandlers(spacePortId, 'pedal')}
                        />
                    </div>
                    {bundle('pedal', 'PEDAL', 'Pedal — the sustain signal on one cable')}
                </div>
            </NodeShell>
        </NodeFrame>
    );
}
