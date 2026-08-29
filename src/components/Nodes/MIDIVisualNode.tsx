/**
 * MIDI Visual Node — the inside of a MIDI node: the controller, control by
 * control, every one of them a socket you can patch.
 *
 * Wave 5 / P8 rebuild. Two structural changes, not a repaint:
 *
 *  1. **It is driven by the node's PORTS, not by the preset.** The old version
 *     walked `preset.controls.keys.noteRange`, which for the generic preset is
 *     `[0, 127]` — it rendered 128 keys, none of which the node actually
 *     advertises, while the real sockets sat in a separate list underneath. Now
 *     every drawn control IS a declared port, so what you see is exactly what
 *     you can plug into, and nothing is drawn that leads nowhere.
 *  2. **The control is the socket.** Keys and pads are `KeyTile`s, which embed
 *     the shared well and carry `data-node-id` / `data-port-id` /
 *     `data-port-type` themselves. Knobs, faders and strips have no live value
 *     on this generic faceplate — a dial frozen at zero would be a lie — so they
 *     read as named socket rows instead.
 *
 * The Arturia MiniLab 3 keeps its own hardware faceplate (`MiniLab3Visual`); it
 * is a map of a real object, not a generic device.
 */

import { useMemo } from 'react';
import { KeyTile, NodeFrame, NodeShell, PortRow } from '@openjammer/oj-ui';
import type { GraphNode, PortDefinition } from '../../engine/types';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { getPresetRegistry } from '../../midi';
import { isBlackKey, noteLabel } from '../controls/noteNames';
import { MiniLab3Visual } from './MiniLab3Visual';
import './MIDIVisualNode.css';

interface MIDIVisualNodeProps {
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

const KEY_PORT = /^key-(\d+)$/;

/** Semitone → left offset in white-key units, so black keys land between them. */
const WHITE_BEFORE = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];

export function MIDIVisualNode({
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
    style,
}: MIDIVisualNodeProps) {
    const nodeData = node.data as { presetId?: string; deviceId?: string | null };
    const presetId = nodeData.presetId || 'generic';
    const deviceId = nodeData.deviceId || null;
    const registry = getPresetRegistry();
    const preset = useMemo(() => registry.getPreset(presetId), [presetId, registry]);
    const isAgentPending = useIsAgentPending(node.id);

    // Group the DECLARED ports into what the hardware calls them.
    const groups = useMemo(() => {
        const keys: Array<{ port: PortDefinition; note: number }> = [];
        const pads: PortDefinition[] = [];
        const knobs: PortDefinition[] = [];
        const faders: PortDefinition[] = [];
        const strips: PortDefinition[] = [];
        const other: PortDefinition[] = [];
        for (const port of node.ports) {
            if (port.direction !== 'output') {
                other.push(port);
                continue;
            }
            const keyMatch = KEY_PORT.exec(port.id);
            if (keyMatch) keys.push({ port, note: Number(keyMatch[1]) });
            else if (port.id.startsWith('pad-')) pads.push(port);
            else if (port.id.startsWith('knob-')) knobs.push(port);
            else if (port.id.startsWith('fader-')) faders.push(port);
            else if (port.id === 'pitch-bend' || port.id === 'mod-wheel') strips.push(port);
            else other.push(port);
        }
        keys.sort((a, b) => a.note - b.note);
        return { keys, pads, knobs, faders, strips, other };
    }, [node.ports]);

    const tileProps = (portId: string) => ({
        'data-node-id': node.id,
        'data-port-id': portId,
        'data-port-type': 'control',
        onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => handlePortMouseDown?.(portId, e),
        onMouseUp: (e: React.MouseEvent<HTMLButtonElement>) => handlePortMouseUp?.(portId, e),
        onMouseEnter: () => handlePortMouseEnter?.(portId),
        onMouseLeave: handlePortMouseLeave,
    });

    const socketRow = (port: PortDefinition) => (
        <PortRow
            key={port.id}
            side={port.direction}
            kind={port.type}
            connected={!!hasConnection?.(port.id)}
            label={port.name}
            title={port.name}
            data-node-id={node.id}
            data-port-id={port.id}
            data-port-type={port.type}
            onMouseDown={(e: React.MouseEvent) => handlePortMouseDown?.(port.id, e)}
            onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(port.id, e)}
            onMouseEnter={() => handlePortMouseEnter?.(port.id)}
            onMouseLeave={handlePortMouseLeave}
        />
    );

    // The MiniLab 3 is a real object with a real layout — it gets its own map.
    if (presetId === 'arturia-minilab-3') {
        return (
            <div
                className={`midi-visual-node minilab3-wrapper${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
                style={style}
                onMouseEnter={handleNodeMouseEnter}
                onMouseLeave={handleNodeMouseLeave}
            >
                <MiniLab3Visual
                    nodeId={node.id}
                    deviceId={deviceId}
                    handlePortMouseDown={handlePortMouseDown}
                    handlePortMouseUp={handlePortMouseUp}
                    handlePortMouseEnter={handlePortMouseEnter}
                    handlePortMouseLeave={handlePortMouseLeave}
                    hasConnection={hasConnection}
                />
            </div>
        );
    }

    // Piano geometry: white keys tile the row, black keys ride on top of the gaps.
    const firstNote = groups.keys[0]?.note ?? 0;
    const whiteCount = groups.keys.filter((k) => !isBlackKey(k.note)).length || 1;
    const whiteUnits = (note: number) => {
        const octaves = Math.floor((note - firstNote) / 12);
        const base = WHITE_BEFORE[((note % 12) + 12) % 12] - WHITE_BEFORE[((firstNote % 12) + 12) % 12];
        return octaves * 7 + base;
    };
    const whiteWidth = 100 / whiteCount;

    return (
        <NodeFrame
            position={node.position}
            dragging={!!isDragging}
            className={`mv-frame${isSelected ? ' is-selected' : ''}`}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            <NodeShell
                className="midi-visual-node"
                title={preset?.name || 'MIDI Device'}
                nodeType="DEVICE"
                selected={!!isSelected}
                dragging={!!isDragging}
                agentPending={isAgentPending}
                headerProps={{ onMouseDown: handleHeaderMouseDown }}
                outputs={groups.other.filter((p) => p.direction === 'output').map(socketRow)}
                inputs={groups.other.filter((p) => p.direction === 'input').map(socketRow)}
            >
                {groups.keys.length > 0 && (
                    <section className="mv-section" aria-label="Keys">
                        <h4 className="mv-section__label">Keys</h4>
                        {/* A generic device declares its whole note range — the
                            'generic' preset is 0-127, so this bed can be 75 white
                            keys wide. It keeps a playable key width and scrolls
                            rather than shrinking every key to three pixels. */}
                        <div className="mv-keybed-scroll">
                        <div
                            className="mv-keybed"
                            style={{ '--mv-white-count': whiteCount } as React.CSSProperties}
                        >
                            {groups.keys.map(({ port, note }) => {
                                const black = isBlackKey(note);
                                const left = black
                                    ? (whiteUnits(note) + 0.72) * whiteWidth
                                    : whiteUnits(note) * whiteWidth;
                                return (
                                    <KeyTile
                                        key={port.id}
                                        variant={black ? 'black' : 'white'}
                                        size={black ? 20 : 26}
                                        className={`mv-key mv-key--${black ? 'black' : 'white'}`}
                                        style={{
                                            left: `${left}%`,
                                            width: `${whiteWidth * (black ? 0.6 : 1)}%`,
                                        }}
                                        connected={!!hasConnection?.(port.id)}
                                        aria-label={noteLabel(note)}
                                        title={`${noteLabel(note)} → ${port.id}`}
                                        {...tileProps(port.id)}
                                    />
                                );
                            })}
                        </div>
                        </div>
                    </section>
                )}

                {groups.pads.length > 0 && (
                    <section className="mv-section" aria-label="Pads">
                        <h4 className="mv-section__label">Pads</h4>
                        <div className="mv-pads">
                            {groups.pads.map((port) => (
                                <KeyTile
                                    key={port.id}
                                    variant="pad"
                                    size={38}
                                    label={port.name}
                                    connected={!!hasConnection?.(port.id)}
                                    aria-label={port.name}
                                    title={`${port.name} → ${port.id}`}
                                    {...tileProps(port.id)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {(groups.knobs.length > 0 || groups.faders.length > 0 || groups.strips.length > 0) && (
                    <section className="mv-section" aria-label="Continuous controls">
                        <h4 className="mv-section__label">Knobs, faders &amp; strips</h4>
                        <div className="mv-controls">
                            {[...groups.knobs, ...groups.faders, ...groups.strips].map(socketRow)}
                        </div>
                    </section>
                )}
            </NodeShell>
        </NodeFrame>
    );
}
