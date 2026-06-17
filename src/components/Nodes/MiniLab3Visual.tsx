/**
 * MiniLab 3 Visual Component
 * Accurate visual representation of the Arturia MiniLab 3 controller
 * Based on actual device layout: 355mm x 220mm (1.61:1 aspect ratio)
 *
 * Each control element has a port marker that can be connected to other nodes.
 * Control outputs are normalized 0-1 values:
 * - Keys: velocity (0 = released, 0.01-1 = pressed with velocity)
 * - Pads: velocity (0 = released, 0.01-1 = pressed with velocity)
 * - Knobs: position (0-1)
 * - Faders: position (0-1)
 * - Mod Wheel: position (0-1)
 * - Pitch Bend: position (-1 to 1, center = 0)
 */

import React, { memo, useEffect, useState, useRef, useCallback } from 'react';
import { subscribeMIDIMessages } from '../../store/midiStore';
import type { MIDIEvent } from '../../midi/types';
import './MiniLab3Visual.css';

interface MiniLab3VisualProps {
    /** Node ID for DOM-based port position lookup */
    nodeId: string;
    deviceId: string | null;
    // Port interaction handlers (passed from parent node)
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection?: (portId: string) => boolean;
    // Value output callbacks for audio graph
    onNoteOutput?: (note: number, velocity: number, channel: number) => void;
    onPadOutput?: (padId: string, velocity: number, pressure: number) => void;
    onKnobOutput?: (knobId: string, value: number) => void;
    onFaderOutput?: (faderId: string, value: number) => void;
    onPitchBend?: (value: number) => void;
    onModWheel?: (value: number) => void;
}

// Control state types
interface ControlState {
    keys: Map<number, { velocity: number; active: boolean }>;
    pads: Map<number, { velocity: number; pressure: number; active: boolean }>;
    knobs: Map<number, number>; // CC -> value
    faders: Map<number, number>; // CC -> value
    pitchBend: number; // -8192 to 8191
    modWheel: number; // 0-127
}

// MiniLab 3 specific mappings (channels are 0-indexed in raw MIDI)
const MINILAB3_CONFIG = {
    // Keys: C3-C5 by default (MIDI notes 48-72)
    keyRange: { start: 48, end: 72 },
    keyChannel: 0,  // Channel 1 in human terms = 0 in raw MIDI

    // Pads: Bank A, channel 10 (human) = 9 (raw)
    pads: [
        { id: 'pad-1', note: 36 }, { id: 'pad-2', note: 37 }, { id: 'pad-3', note: 38 }, { id: 'pad-4', note: 39 },
        { id: 'pad-5', note: 40 }, { id: 'pad-6', note: 41 }, { id: 'pad-7', note: 42 }, { id: 'pad-8', note: 43 },
    ],
    padChannel: 9,  // Channel 10 in human terms = 9 in raw MIDI

    // Knobs: 8 endless encoders (CC numbers from device testing)
    knobs: [
        { id: 'knob-1', cc: 74 }, { id: 'knob-2', cc: 71 }, { id: 'knob-3', cc: 76 }, { id: 'knob-4', cc: 77 },
        { id: 'knob-5', cc: 93 }, { id: 'knob-6', cc: 18 }, { id: 'knob-7', cc: 19 }, { id: 'knob-8', cc: 16 },
    ],

    // Faders: 4 sliders
    faders: [
        { id: 'fader-1', cc: 82 }, { id: 'fader-2', cc: 83 }, { id: 'fader-3', cc: 85 }, { id: 'fader-4', cc: 17 },
    ],

    // Mod wheel CC
    modWheelCC: 1,
};

// Pad colors (RGB capable, these are defaults)
const PAD_COLORS = [
    '#3B82F6', '#3B82F6', '#3B82F6', '#3B82F6', // Row 1 (blue)
    '#3B82F6', '#3B82F6', '#3B82F6', '#3B82F6', // Row 2 (blue)
];

// Note name mapping
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const getNoteLabel = (note: number): string => {
    const octave = Math.floor(note / 12) - 1;
    const noteName = NOTE_NAMES[note % 12];
    return `${noteName}${octave}`;
};

export const MiniLab3Visual = memo(function MiniLab3Visual({
    nodeId,
    deviceId,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    onNoteOutput,
    onPadOutput,
    onKnobOutput,
    onFaderOutput,
    onPitchBend,
    onModWheel,
}: MiniLab3VisualProps) {
    // Use ref for state to avoid re-renders on every MIDI event
    // Only trigger re-render via RAF batching
    const stateRef = useRef<ControlState>({
        keys: new Map(),
        pads: new Map(),
        knobs: new Map(), // Empty - don't show position until first MIDI value received
        faders: new Map(MINILAB3_CONFIG.faders.map(f => [f.cc, 0])),
        pitchBend: 0,
        modWheel: 0,
    });

    // RAF batching: only re-render once per frame even with many MIDI events
    const rafIdRef = useRef<number | null>(null);
    const [, forceUpdate] = useState({});

    const scheduleUpdate = useCallback(() => {
        if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                forceUpdate({});
            });
        }
    }, []);

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, []);

    // Expose state for render (read from ref)
    const state = stateRef.current;

    // Subscribe to MIDI messages
    useEffect(() => {
        if (!deviceId) return;

        const unsubscribe = subscribeMIDIMessages((event: MIDIEvent) => {
            // Only process messages from our device
            if (event.deviceId !== deviceId) return;

            const current = stateRef.current;

            switch (event.type) {
                case 'noteOn': {
                    // Check if it's a pad (channel 10, notes 36-43)
                    const pad = MINILAB3_CONFIG.pads.find(p => p.note === event.note);
                    if (pad && event.channel === MINILAB3_CONFIG.padChannel) {
                        current.pads = new Map(current.pads);
                        current.pads.set(pad.note, { velocity: event.velocity, pressure: 0, active: true });
                        onPadOutput?.(pad.id, event.velocity / 127, 0);
                    } else {
                        // Any other note is treated as a key (regardless of channel)
                        current.keys = new Map(current.keys);
                        current.keys.set(event.note, { velocity: event.velocity, active: true });
                        onNoteOutput?.(event.note, event.velocity / 127, event.channel);
                    }
                    break;
                }

                case 'noteOff': {
                    const pad = MINILAB3_CONFIG.pads.find(p => p.note === event.note);
                    if (pad && event.channel === MINILAB3_CONFIG.padChannel) {
                        current.pads = new Map(current.pads);
                        current.pads.set(pad.note, { velocity: 0, pressure: 0, active: false });
                        onPadOutput?.(pad.id, 0, 0);
                    } else {
                        // Any other note is treated as a key
                        current.keys = new Map(current.keys);
                        current.keys.set(event.note, { velocity: 0, active: false });
                        onNoteOutput?.(event.note, 0, event.channel);
                    }
                    break;
                }

                case 'cc': {
                    // Check if it's a knob
                    const knob = MINILAB3_CONFIG.knobs.find(k => k.cc === event.controller);
                    if (knob) {
                        current.knobs = new Map(current.knobs);
                        current.knobs.set(event.controller, event.value);
                        onKnobOutput?.(knob.id, event.value / 127);
                        break;
                    }

                    // Check if it's a fader
                    const fader = MINILAB3_CONFIG.faders.find(f => f.cc === event.controller);
                    if (fader) {
                        current.faders = new Map(current.faders);
                        current.faders.set(event.controller, event.value);
                        onFaderOutput?.(fader.id, event.value / 127);
                        break;
                    }

                    // Check if it's mod wheel
                    if (event.controller === MINILAB3_CONFIG.modWheelCC) {
                        current.modWheel = event.value;
                        onModWheel?.(event.value / 127);
                    }
                    break;
                }

                case 'pitchBend': {
                    current.pitchBend = event.value;
                    // Normalize to -1 to 1
                    onPitchBend?.(event.value / 8192);
                    break;
                }

                case 'aftertouch': {
                    // Channel aftertouch from pads
                    if (event.channel === MINILAB3_CONFIG.padChannel) {
                        // Update all active pads with pressure
                        current.pads = new Map(current.pads);
                        current.pads.forEach((padState, note) => {
                            if (padState.active) {
                                current.pads.set(note, { ...padState, pressure: event.pressure });
                            }
                        });
                    }
                    break;
                }
            }

            // Schedule a batched re-render (only one per frame)
            scheduleUpdate();
        });

        return unsubscribe;
    }, [deviceId, onNoteOutput, onPadOutput, onKnobOutput, onFaderOutput, onPitchBend, onModWheel, scheduleUpdate]);

    // Generate piano keys (25 keys: 15 white, 10 black)
    const renderKeyboard = () => {
        const keys: React.ReactElement[] = [];
        const { start, end } = MINILAB3_CONFIG.keyRange;

        const isBlackKey = (note: number) => {
            const n = note % 12;
            return [1, 3, 6, 8, 10].includes(n);
        };

        // Count white keys for width calculation (15 white keys in 25-key range C3-C5)
        let totalWhiteKeys = 0;
        for (let n = start; n <= end; n++) {
            if (!isBlackKey(n)) totalWhiteKeys++;
        }

        const whiteKeyWidthPercent = 100 / totalWhiteKeys;

        let whiteKeyIndex = 0;
        for (let note = start; note <= end; note++) {
            const keyState = state.keys.get(note);
            const isActive = keyState?.active ?? false;
            const velocity = keyState?.velocity ?? 0;
            const portId = `key-${note}`;
            const isConnected = hasConnection?.(portId) ?? false;

            if (isBlackKey(note)) {
                const blackKeyLeft = (whiteKeyIndex * whiteKeyWidthPercent) - (whiteKeyWidthPercent * 0.28);
                keys.push(
                    <div
                        key={note}
                        className={`minilab3-key minilab3-black-key ${isActive ? 'active' : ''}`}
                        style={{
                            left: `${blackKeyLeft}%`,
                            width: `${whiteKeyWidthPercent * 0.55}%`,
                            '--key-velocity': velocity / 127,
                        } as React.CSSProperties}
                        data-note={note}
                        title={`${getNoteLabel(note)} → ${portId}`}
                        onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                        onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(portId)}
                        onMouseLeave={handlePortMouseLeave}
                    >
                        <div
                            className={`minilab3-key-port ${isConnected ? 'connected' : ''}`}
                            data-node-id={nodeId}
                            data-port-id={portId}
                        />
                    </div>
                );
            } else {
                keys.push(
                    <div
                        key={note}
                        className={`minilab3-key minilab3-white-key ${isActive ? 'active' : ''}`}
                        style={{
                            left: `${whiteKeyIndex * whiteKeyWidthPercent}%`,
                            width: `${whiteKeyWidthPercent}%`,
                            '--key-velocity': velocity / 127,
                        } as React.CSSProperties}
                        data-note={note}
                        title={`${getNoteLabel(note)} → ${portId}`}
                        onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                        onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(portId)}
                        onMouseLeave={handlePortMouseLeave}
                    >
                        <div
                            className={`minilab3-key-port ${isConnected ? 'connected' : ''}`}
                            data-node-id={nodeId}
                            data-port-id={portId}
                        />
                    </div>
                );
                whiteKeyIndex++;
            }
        }

        return keys;
    };

    // Render pads (single horizontal row of 8)
    const renderPads = () => {
        return MINILAB3_CONFIG.pads.map((pad, index) => {
            const padState = state.pads.get(pad.note);
            const isActive = padState?.active ?? false;
            const velocity = padState?.velocity ?? 0;
            const pressure = padState?.pressure ?? 0;
            const isConnected = hasConnection?.(pad.id) ?? false;

            // Use the higher of velocity or pressure for brightness
            const intensity = Math.max(velocity, pressure) / 127;

            return (
                <div
                    key={pad.id}
                    className={`minilab3-pad ${isActive ? 'active' : ''}`}
                    style={{
                        '--pad-color': PAD_COLORS[index],
                        '--pad-brightness': isActive ? 0.3 + intensity * 0.7 : 0.2,
                        '--pad-pressure': pressure / 127,
                    } as React.CSSProperties}
                    data-pad-id={pad.id}
                    title={`Pad ${index + 1} → ${pad.id}`}
                    onMouseDown={(e) => handlePortMouseDown?.(pad.id, e)}
                    onMouseUp={(e) => handlePortMouseUp?.(pad.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(pad.id)}
                    onMouseLeave={handlePortMouseLeave}
                >
                    <div
                        className={`minilab3-control-port ${isConnected ? 'connected' : ''}`}
                        data-node-id={nodeId}
                        data-port-id={pad.id}
                    />
                </div>
            );
        });
    };

    // Render knobs (2 rows of 4)
    const renderKnobs = () => {
        return MINILAB3_CONFIG.knobs.map((knob, index) => {
            const value = state.knobs.get(knob.cc);
            const hasValue = value !== undefined;
            // Full 360 degree rotation: 0 = top, 127 = top again (full circle)
            const rotation = hasValue ? (value / 127) * 360 : 0;
            const isConnected = hasConnection?.(knob.id) ?? false;

            const row = index < 4 ? 0 : 1;
            const col = index % 4;

            return (
                <div
                    key={knob.id}
                    className="minilab3-knob"
                    style={{
                        gridRow: row + 1,
                        gridColumn: col + 1,
                    }}
                    data-knob-id={knob.id}
                    title={`Knob ${index + 1} (CC${knob.cc}) → ${knob.id}`}
                    onMouseDown={(e) => handlePortMouseDown?.(knob.id, e)}
                    onMouseUp={(e) => handlePortMouseUp?.(knob.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(knob.id)}
                    onMouseLeave={handlePortMouseLeave}
                >
                    <div
                        className="minilab3-knob-cap"
                        style={{ transform: `rotate(${rotation}deg)` }}
                    >
                        <div
                            className="minilab3-knob-indicator"
                            style={{ opacity: hasValue ? 1 : 0.3 }}
                        />
                    </div>
                    <span className="minilab3-knob-label">{index + 1}</span>
                    <div
                        className={`minilab3-control-port ${isConnected ? 'connected' : ''}`}
                        data-node-id={nodeId}
                        data-port-id={knob.id}
                    />
                </div>
            );
        });
    };

    // Render faders (4 vertical sliders)
    const renderFaders = () => {
        return MINILAB3_CONFIG.faders.map((fader, index) => {
            const value = state.faders.get(fader.cc) ?? 0;
            const position = (value / 127) * 100;
            const isConnected = hasConnection?.(fader.id) ?? false;

            return (
                <div
                    key={fader.id}
                    className="minilab3-fader"
                    data-fader-id={fader.id}
                    title={`Fader ${index + 1} (CC${fader.cc}) → ${fader.id}`}
                    onMouseDown={(e) => handlePortMouseDown?.(fader.id, e)}
                    onMouseUp={(e) => handlePortMouseUp?.(fader.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(fader.id)}
                    onMouseLeave={handlePortMouseLeave}
                >
                    <div className="minilab3-fader-track">
                        <div
                            className="minilab3-fader-thumb"
                            style={{ bottom: `${position}%` }}
                        />
                    </div>
                    <span className="minilab3-fader-label">{index + 1}</span>
                    <div
                        className={`minilab3-control-port ${isConnected ? 'connected' : ''}`}
                        data-node-id={nodeId}
                        data-port-id={fader.id}
                    />
                </div>
            );
        });
    };

    // Render touch strips
    const renderTouchStrips = () => {
        // Clamp pitch bend to 0-100% and account for indicator height (8px in ~100px track = ~92%)
        const rawPitchPos = ((state.pitchBend + 8192) / 16383) * 100;
        const pitchPos = Math.max(0, Math.min(92, rawPitchPos * 0.92));

        // Clamp mod wheel similarly
        const rawModPos = (state.modWheel / 127) * 100;
        const modPos = Math.max(0, Math.min(92, rawModPos * 0.92));

        const isPitchConnected = hasConnection?.('pitch-bend') ?? false;
        const isModConnected = hasConnection?.('mod-wheel') ?? false;

        return (
            <div className="minilab3-touch-strips">
                <div
                    className="minilab3-touch-strip minilab3-pitch-strip"
                    title="Pitch Bend → pitch-bend"
                    onMouseDown={(e) => handlePortMouseDown?.('pitch-bend', e)}
                    onMouseUp={(e) => handlePortMouseUp?.('pitch-bend', e)}
                    onMouseEnter={() => handlePortMouseEnter?.('pitch-bend')}
                    onMouseLeave={handlePortMouseLeave}
                >
                    <div
                        className="minilab3-strip-indicator"
                        style={{ bottom: `${pitchPos}%` }}
                    />
                    <div
                        className={`minilab3-control-port strip-port ${isPitchConnected ? 'connected' : ''}`}
                        data-node-id={nodeId}
                        data-port-id="pitch-bend"
                    />
                </div>
                <div
                    className="minilab3-touch-strip minilab3-mod-strip"
                    title="Mod Wheel → mod-wheel"
                    onMouseDown={(e) => handlePortMouseDown?.('mod-wheel', e)}
                    onMouseUp={(e) => handlePortMouseUp?.('mod-wheel', e)}
                    onMouseEnter={() => handlePortMouseEnter?.('mod-wheel')}
                    onMouseLeave={handlePortMouseLeave}
                >
                    <div
                        className="minilab3-strip-indicator"
                        style={{ bottom: `${modPos}%` }}
                    />
                    <div
                        className={`minilab3-control-port strip-port ${isModConnected ? 'connected' : ''}`}
                        data-node-id={nodeId}
                        data-port-id="mod-wheel"
                    />
                </div>
            </div>
        );
    };

    return (
        <div className="minilab3-visual">
            {/* Main body - no wood panels on MiniLab 3 */}
            <div className="minilab3-body">
                {/* Top section - controls row */}
                <div className="minilab3-controls">
                    {/* Left: Buttons (2x2 grid) + Touch strips below */}
                    <div className="minilab3-left-section">
                        <div className="minilab3-buttons">
                            <button className="minilab3-button minilab3-shift">Shift</button>
                            <button className="minilab3-button">Hold</button>
                            <button className="minilab3-button">Oct -</button>
                            <button className="minilab3-button">Oct +</button>
                        </div>
                        {/* eslint-disable-next-line react-hooks/refs -- renderTouchStrips reads stateRef.current by design: live MIDI state is held in a ref and renders are RAF-batched to avoid a re-render per MIDI event */}
                        {renderTouchStrips()}
                    </div>

                    {/* Display + Encoder */}
                    <div className="minilab3-display-section">
                        <div className="minilab3-oled">
                            <span className="minilab3-oled-text">Arturia</span>
                        </div>
                        <div className="minilab3-main-encoder">
                            <div className="minilab3-encoder-cap">
                                <div className="minilab3-encoder-indicator" />
                            </div>
                        </div>
                    </div>

                    {/* 8 Knobs */}
                    <div className="minilab3-knobs-section">
                        {/* eslint-disable-next-line react-hooks/refs -- renderKnobs reads stateRef.current by design: live MIDI state is held in a ref and renders are RAF-batched to avoid a re-render per MIDI event */}
                        {renderKnobs()}
                    </div>

                    {/* 4 Faders */}
                    <div className="minilab3-faders-section">
                        {/* eslint-disable-next-line react-hooks/refs -- renderFaders reads stateRef.current by design: live MIDI state is held in a ref and renders are RAF-batched to avoid a re-render per MIDI event */}
                        {renderFaders()}
                    </div>
                </div>

                {/* Middle row - 8 Pads positioned below knobs */}
                <div className="minilab3-middle-row">
                    <div className="minilab3-pads-section">
                        {/* eslint-disable-next-line react-hooks/refs -- renderPads reads stateRef.current by design: live MIDI state is held in a ref and renders are RAF-batched to avoid a re-render per MIDI event */}
                        {renderPads()}
                    </div>
                </div>

                {/* Branding row - above keyboard */}
                <div className="minilab3-branding-row">
                    <span className="minilab3-logo">MINI<span className="minilab3-logo-lab">LAB</span> 3</span>
                    <div className="minilab3-midi-indicators">
                        <span className="minilab3-midi-label">MIDI CH</span>
                        {Array.from({ length: 16 }, (_, i) => (
                            <div key={i} className={`minilab3-midi-ch ${i === 0 ? 'active' : ''}`} />
                        ))}
                    </div>
                    <span className="minilab3-arturia">ARTURIA</span>
                </div>

                {/* Keyboard section */}
                <div className="minilab3-keyboard-section">
                    <div className="minilab3-keyboard">
                        {/* eslint-disable-next-line react-hooks/refs -- renderKeyboard reads stateRef.current by design: live MIDI state is held in a ref and renders are RAF-batched to avoid a re-render per MIDI event */}
                        {renderKeyboard()}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default MiniLab3Visual;
