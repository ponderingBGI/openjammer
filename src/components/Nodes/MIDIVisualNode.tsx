/**
 * MIDI Visual Node - Internal device visualization
 *
 * Shows a visual representation of the MIDI device with individual controls:
 * - Keys (piano-style)
 * - Pads (drum pad grid)
 * - Knobs (rotary controls)
 * - Faders (vertical sliders)
 * - Touch strips (pitch bend, mod wheel)
 *
 * This is the internal node shown when entering a MIDI node with E key.
 * Each control has its own output port for per-control connections.
 *
 * For known devices like the Arturia MiniLab 3, shows an accurate visual
 * representation matching the physical device layout.
 */

import { useMemo } from 'react';
import { Port } from '@openjammer/oj-ui';
import type { GraphNode } from '../../engine/types';
import { getPresetRegistry } from '../../midi';
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
    style
}: MIDIVisualNodeProps) {
    // Get preset and device info from node data
    const nodeData = node.data as { presetId?: string; deviceId?: string | null };
    const presetId = nodeData.presetId || 'generic';
    const deviceId = nodeData.deviceId || null;
    const registry = getPresetRegistry();
    const preset = useMemo(() => registry.getPreset(presetId), [presetId, registry]);

    // Build control sections
    const hasKeys = preset?.controls.keys !== undefined;
    const hasPads = preset?.controls.pads && preset.controls.pads.length > 0;
    const hasKnobs = preset?.controls.knobs && preset.controls.knobs.length > 0;
    const hasFaders = preset?.controls.faders && preset.controls.faders.length > 0;
    const hasPitchBend = preset?.controls.pitchBend !== undefined;
    const hasModWheel = preset?.controls.modWheel !== undefined;

    // For Arturia MiniLab 3, show the accurate visual representation
    // Each control element on the visual IS the port (direct connection from visual)
    if (presetId === 'arturia-minilab-3') {
        return (
            <div
                className={`midi-visual-node schematic-node minilab3-wrapper ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
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

    // Generic MIDI device visualization
    return (
        <div
            className={`midi-visual-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                <span className="schematic-title">
                    {preset?.name || 'MIDI Device'}
                </span>
            </div>

            {/* Device visualization body */}
            <div className="midi-visual-body">
                {/* Keys section */}
                {hasKeys && preset?.controls.keys && (
                    <div className="midi-visual-section midi-visual-keys">
                        <div className="midi-visual-section-label">Keys</div>
                        <div className="midi-visual-keyboard">
                            {(() => {
                                const range = preset.controls.keys.range || preset.controls.keys.noteRange || [48, 72];
                                const keys = [];
                                for (let note = range[0]; note <= range[1]; note++) {
                                    const isBlack = [1, 3, 6, 8, 10].includes(note % 12);
                                    const portId = `key-${note}`;
                                    keys.push(
                                        <div
                                            key={note}
                                            className={`midi-key ${isBlack ? 'black' : 'white'} ${hasConnection?.(portId) ? 'connected' : ''}`}
                                            data-note={note}
                                            onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                                            onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                                            onMouseEnter={() => handlePortMouseEnter?.(portId)}
                                            onMouseLeave={handlePortMouseLeave}
                                        />
                                    );
                                }
                                return keys;
                            })()}
                        </div>
                    </div>
                )}

                {/* Pads section */}
                {hasPads && preset?.controls.pads && (
                    <div className="midi-visual-section midi-visual-pads">
                        <div className="midi-visual-section-label">Pads</div>
                        <div className="midi-visual-pad-grid">
                            {preset.controls.pads.map((pad, idx) => {
                                const portId = `pad-${pad.id || idx}`;
                                return (
                                    <div
                                        key={portId}
                                        className={`midi-pad ${hasConnection?.(portId) ? 'connected' : ''}`}
                                        onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                                        onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                                        onMouseEnter={() => handlePortMouseEnter?.(portId)}
                                        onMouseLeave={handlePortMouseLeave}
                                    >
                                        {pad.name || `Pad ${idx + 1}`}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Knobs section */}
                {hasKnobs && preset?.controls.knobs && (
                    <div className="midi-visual-section midi-visual-knobs">
                        <div className="midi-visual-section-label">Knobs</div>
                        <div className="midi-visual-knob-row">
                            {preset.controls.knobs.map((knob, idx) => {
                                const portId = `knob-${knob.id || idx}`;
                                return (
                                    <div
                                        key={portId}
                                        className={`midi-knob ${hasConnection?.(portId) ? 'connected' : ''}`}
                                        onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                                        onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                                        onMouseEnter={() => handlePortMouseEnter?.(portId)}
                                        onMouseLeave={handlePortMouseLeave}
                                    >
                                        <div className="midi-knob-dial" />
                                        <span className="midi-knob-label">{knob.name || `K${idx + 1}`}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Faders section */}
                {hasFaders && preset?.controls.faders && (
                    <div className="midi-visual-section midi-visual-faders">
                        <div className="midi-visual-section-label">Faders</div>
                        <div className="midi-visual-fader-row">
                            {preset.controls.faders.map((fader, idx) => {
                                const portId = `fader-${fader.id || idx}`;
                                return (
                                    <div
                                        key={portId}
                                        className={`midi-fader ${hasConnection?.(portId) ? 'connected' : ''}`}
                                        onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                                        onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                                        onMouseEnter={() => handlePortMouseEnter?.(portId)}
                                        onMouseLeave={handlePortMouseLeave}
                                    >
                                        <div className="midi-fader-track">
                                            <div className="midi-fader-thumb" />
                                        </div>
                                        <span className="midi-fader-label">{fader.name || `F${idx + 1}`}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Touch strips section (pitch bend & mod wheel) */}
                {(hasPitchBend || hasModWheel) && (
                    <div className="midi-visual-section midi-visual-strips">
                        <div className="midi-visual-section-label">Controls</div>
                        <div className="midi-visual-strip-row">
                            {hasPitchBend && (
                                <div
                                    className={`midi-strip ${hasConnection?.('pitch-bend') ? 'connected' : ''}`}
                                    onMouseDown={(e) => handlePortMouseDown?.('pitch-bend', e)}
                                    onMouseUp={(e) => handlePortMouseUp?.('pitch-bend', e)}
                                    onMouseEnter={() => handlePortMouseEnter?.('pitch-bend')}
                                    onMouseLeave={handlePortMouseLeave}
                                >
                                    <div className="midi-strip-track">
                                        <div className="midi-strip-center" />
                                    </div>
                                    <span className="midi-strip-label">Pitch</span>
                                </div>
                            )}
                            {hasModWheel && (
                                <div
                                    className={`midi-strip ${hasConnection?.('mod-wheel') ? 'connected' : ''}`}
                                    onMouseDown={(e) => handlePortMouseDown?.('mod-wheel', e)}
                                    onMouseUp={(e) => handlePortMouseUp?.('mod-wheel', e)}
                                    onMouseEnter={() => handlePortMouseEnter?.('mod-wheel')}
                                    onMouseLeave={handlePortMouseLeave}
                                >
                                    <div className="midi-strip-track" />
                                    <span className="midi-strip-label">Mod</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Output ports on right side */}
                <div className="midi-visual-ports">
                    {node.ports.filter(p => p.direction === 'output').map((port) => (
                        <div key={port.id} className="port-row output">
                            <span className="port-label">{port.name}</span>
                            <Port
                                kind={port.type}
                                direction="output"
                                connected={!!hasConnection?.(port.id)}
                                style={{ width: 20, height: 20 }}
                                data-node-id={node.id}
                                data-port-id={port.id}
                                data-port-type={port.type}
                                onMouseDown={(e) => handlePortMouseDown?.(port.id, e)}
                                onMouseUp={(e) => handlePortMouseUp?.(port.id, e)}
                                onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                                onMouseLeave={handlePortMouseLeave}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
