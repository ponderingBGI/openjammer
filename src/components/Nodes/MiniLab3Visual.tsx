/**
 * MiniLab 3 Visual — a map of a real object.
 *
 * The Arturia MiniLab 3 is 355 x 220 mm of physical layout a player already
 * knows with their hands: two rows of four knobs under a small display, four
 * faders on the right, eight pads in a line, twenty-five keys along the bottom.
 * The LAYOUT is therefore hardware-faithful and stays that way — you find the
 * knob on screen where your thumb expects it.
 *
 * The COLOUR is not. Wave 5 / P8: this file's 102 literal hex values — the
 * highest count in the repository (00-design-gap-audit §4) — are gone. The mint
 * body, the `#1A1A1A` pads, the `#3B82F6` pad LEDs, the four white-key gradients
 * and the black `!important` port markers are all tokens now, so the device sits
 * on the canvas in the same light and the same dark as everything around it.
 *
 * And every control is now a REAL socket: keys and pads are `KeyTile`s (which
 * embed the shared well), knobs are `Knob`s the hardware drives, and each of the
 * rest carries a `Port`. Before this, `.minilab3-key-port` was a bare `<div>`
 * with no `data-port-type` — the last faceplate on the shrink-only list in
 * `__tests__/portDomContract.test.tsx`.
 */

import React, { memo, useEffect, useState, useRef, useCallback } from 'react';
import { Knob, KeyTile, Port } from '@openjammer/oj-ui';
import { subscribeMIDIMessages } from '../../store/midiStore';
import type { MIDIEvent } from '../../midi/types';
import { isBlackKey, noteLabel } from '../controls/noteNames';
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

/**
 * The device's MIDI map (raw, 0-indexed channels). This is the RUNTIME mapping
 * the subscription reads; `MIDIDeviceConfig.MINILAB3_CONFIG` is the PORT mapping
 * the registry generates from. They agree by construction (same notes, same CCs)
 * but are two shapes of the same fact — folding them into one is a `src/midi`
 * change and is noted for that lane.
 */
const MINILAB3_MIDI_MAP = {
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

/** The panel legends printed on the device. Text, not controls — nothing here
 *  is clickable, so none of it pretends to be a button. */
const PANEL_LEGENDS = ['Shift', 'Hold', 'Oct −', 'Oct +'];

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
    // Live MIDI state lives in a ref and renders are RAF-batched: a controller
    // sweeping a knob emits ~100 messages a second and none of them may cost a
    // React render of its own.
    const stateRef = useRef<ControlState>({
        keys: new Map(),
        pads: new Map(),
        knobs: new Map(), // Empty - don't show position until first MIDI value received
        faders: new Map(MINILAB3_MIDI_MAP.faders.map(f => [f.cc, 0])),
        pitchBend: 0,
        modWheel: 0,
    });

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

    useEffect(() => {
        return () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, []);

    const state = stateRef.current;

    // Subscribe to MIDI messages
    useEffect(() => {
        if (!deviceId) return;

        const unsubscribe = subscribeMIDIMessages((event: MIDIEvent) => {
            if (event.deviceId !== deviceId) return;

            const current = stateRef.current;

            switch (event.type) {
                case 'noteOn': {
                    const pad = MINILAB3_MIDI_MAP.pads.find(p => p.note === event.note);
                    if (pad && event.channel === MINILAB3_MIDI_MAP.padChannel) {
                        current.pads = new Map(current.pads);
                        current.pads.set(pad.note, { velocity: event.velocity, pressure: 0, active: true });
                        onPadOutput?.(pad.id, event.velocity / 127, 0);
                    } else {
                        current.keys = new Map(current.keys);
                        current.keys.set(event.note, { velocity: event.velocity, active: true });
                        onNoteOutput?.(event.note, event.velocity / 127, event.channel);
                    }
                    break;
                }

                case 'noteOff': {
                    const pad = MINILAB3_MIDI_MAP.pads.find(p => p.note === event.note);
                    if (pad && event.channel === MINILAB3_MIDI_MAP.padChannel) {
                        current.pads = new Map(current.pads);
                        current.pads.set(pad.note, { velocity: 0, pressure: 0, active: false });
                        onPadOutput?.(pad.id, 0, 0);
                    } else {
                        current.keys = new Map(current.keys);
                        current.keys.set(event.note, { velocity: 0, active: false });
                        onNoteOutput?.(event.note, 0, event.channel);
                    }
                    break;
                }

                case 'cc': {
                    const knob = MINILAB3_MIDI_MAP.knobs.find(k => k.cc === event.controller);
                    if (knob) {
                        current.knobs = new Map(current.knobs);
                        current.knobs.set(event.controller, event.value);
                        onKnobOutput?.(knob.id, event.value / 127);
                        break;
                    }

                    const fader = MINILAB3_MIDI_MAP.faders.find(f => f.cc === event.controller);
                    if (fader) {
                        current.faders = new Map(current.faders);
                        current.faders.set(event.controller, event.value);
                        onFaderOutput?.(fader.id, event.value / 127);
                        break;
                    }

                    if (event.controller === MINILAB3_MIDI_MAP.modWheelCC) {
                        current.modWheel = event.value;
                        onModWheel?.(event.value / 127);
                    }
                    break;
                }

                case 'pitchBend': {
                    current.pitchBend = event.value;
                    onPitchBend?.(event.value / 8192);
                    break;
                }

                case 'aftertouch': {
                    if (event.channel === MINILAB3_MIDI_MAP.padChannel) {
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

            scheduleUpdate();
        });

        return unsubscribe;
    }, [deviceId, onNoteOutput, onPadOutput, onKnobOutput, onFaderOutput, onPitchBend, onModWheel, scheduleUpdate]);

    /** Every control on this device is a control-rate output socket. */
    const wiring = (portId: string) => ({
        'data-node-id': nodeId,
        'data-port-id': portId,
        'data-port-type': 'control',
        onMouseDown: (e: React.MouseEvent) => handlePortMouseDown?.(portId, e),
        onMouseUp: (e: React.MouseEvent) => handlePortMouseUp?.(portId, e),
        onMouseEnter: () => handlePortMouseEnter?.(portId),
        onMouseLeave: handlePortMouseLeave,
    });

    // Generate piano keys (25 keys: 15 white, 10 black)
    const renderKeyboard = () => {
        const keys: React.ReactElement[] = [];
        const { start, end } = MINILAB3_MIDI_MAP.keyRange;

        let totalWhiteKeys = 0;
        for (let n = start; n <= end; n++) {
            if (!isBlackKey(n)) totalWhiteKeys++;
        }
        const whiteKeyWidthPercent = 100 / totalWhiteKeys;

        let whiteKeyIndex = 0;
        for (let note = start; note <= end; note++) {
            const keyState = state.keys.get(note);
            const isActive = keyState?.active ?? false;
            const portId = `key-${note}`;
            const black = isBlackKey(note);
            const left = black
                ? (whiteKeyIndex * whiteKeyWidthPercent) - (whiteKeyWidthPercent * 0.28)
                : whiteKeyIndex * whiteKeyWidthPercent;

            keys.push(
                <KeyTile
                    key={note}
                    variant={black ? 'black' : 'white'}
                    size={black ? 22 : 30}
                    className={`minilab3-key minilab3-${black ? 'black' : 'white'}-key`}
                    style={{ left: `${left}%`, width: `${whiteKeyWidthPercent * (black ? 0.55 : 1)}%` }}
                    active={isActive}
                    connected={hasConnection?.(portId) ?? false}
                    aria-label={noteLabel(note)}
                    title={`${noteLabel(note)} → ${portId}`}
                    {...wiring(portId)}
                />,
            );
            if (!black) whiteKeyIndex++;
        }

        return keys;
    };

    // Render pads (single horizontal row of 8)
    const renderPads = () => {
        return MINILAB3_MIDI_MAP.pads.map((pad, index) => {
            const padState = state.pads.get(pad.note);
            return (
                <KeyTile
                    key={pad.id}
                    variant="pad"
                    size={44}
                    className="minilab3-pad"
                    label={index + 1}
                    active={padState?.active ?? false}
                    connected={hasConnection?.(pad.id) ?? false}
                    aria-label={`Pad ${index + 1}`}
                    title={`Pad ${index + 1} → ${pad.id}`}
                    {...wiring(pad.id)}
                />
            );
        });
    };

    // Render knobs (2 rows of 4) — read-only mirrors: the hardware owns them.
    const renderKnobs = () => {
        return MINILAB3_MIDI_MAP.knobs.map((knob, index) => {
            const raw = state.knobs.get(knob.cc);
            const hasValue = raw !== undefined;
            const isConnected = hasConnection?.(knob.id) ?? false;

            return (
                <div
                    key={knob.id}
                    className="minilab3-knob"
                    style={{ gridRow: index < 4 ? 1 : 2, gridColumn: (index % 4) + 1 }}
                    data-knob-id={knob.id}
                >
                    <Knob
                        className="minilab3-knob__dial"
                        size={30}
                        label={String(index + 1)}
                        min={0}
                        max={127}
                        value={raw ?? 0}
                        disabled={!hasValue}
                        format={(v) => (hasValue ? `${Math.round((v / 127) * 100)}%` : '—')}
                        onChange={NOOP}
                        title={`Knob ${index + 1} (CC${knob.cc}) → ${knob.id}`}
                    />
                    <Port
                        className="minilab3-control-port"
                        kind="control"
                        direction="output"
                        connected={isConnected}
                        {...wiring(knob.id)}
                    />
                </div>
            );
        });
    };

    // Render faders (4 vertical sliders) — mirrors, like the knobs.
    const renderFaders = () => {
        return MINILAB3_MIDI_MAP.faders.map((fader, index) => {
            const value = state.faders.get(fader.cc) ?? 0;
            const position = (value / 127) * 100;
            const isConnected = hasConnection?.(fader.id) ?? false;

            return (
                <div
                    key={fader.id}
                    className="minilab3-fader"
                    data-fader-id={fader.id}
                    title={`Fader ${index + 1} (CC${fader.cc}) → ${fader.id}`}
                >
                    <div
                        className="minilab3-fader-track"
                        role="meter"
                        aria-label={`Fader ${index + 1}`}
                        aria-valuenow={value}
                        aria-valuemin={0}
                        aria-valuemax={127}
                    >
                        <div className="minilab3-fader-thumb" style={{ bottom: `${position}%` }} />
                    </div>
                    <span className="minilab3-fader-label">{index + 1}</span>
                    <Port
                        className="minilab3-control-port"
                        kind="control"
                        direction="output"
                        connected={isConnected}
                        {...wiring(fader.id)}
                    />
                </div>
            );
        });
    };

    // Render touch strips
    const renderTouchStrips = () => {
        // Clamp to the track and leave room for the indicator's own height.
        const rawPitchPos = ((state.pitchBend + 8192) / 16383) * 100;
        const pitchPos = Math.max(0, Math.min(92, rawPitchPos * 0.92));
        const rawModPos = (state.modWheel / 127) * 100;
        const modPos = Math.max(0, Math.min(92, rawModPos * 0.92));

        const strips: Array<{ id: string; label: string; pos: number }> = [
            { id: 'pitch-bend', label: 'Pitch', pos: pitchPos },
            { id: 'mod-wheel', label: 'Mod', pos: modPos },
        ];

        return (
            <div className="minilab3-touch-strips">
                {strips.map((strip) => (
                    <div
                        key={strip.id}
                        className="minilab3-touch-strip"
                        title={`${strip.label} → ${strip.id}`}
                    >
                        <div className="minilab3-strip-indicator" style={{ bottom: `${strip.pos}%` }} />
                        <Port
                            className="minilab3-control-port minilab3-strip-port"
                            kind="control"
                            direction="output"
                            connected={hasConnection?.(strip.id) ?? false}
                            {...wiring(strip.id)}
                        />
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="minilab3-visual">
            <div className="minilab3-body">
                {/* Top section - controls row */}
                <div className="minilab3-controls">
                    {/* Left: printed legends + the two touch strips below them */}
                    <div className="minilab3-left-section">
                        <div className="minilab3-legends">
                            {PANEL_LEGENDS.map((legend) => (
                                <span key={legend} className="minilab3-legend">{legend}</span>
                            ))}
                        </div>
                        {/* eslint-disable-next-line react-hooks/refs -- renderTouchStrips reads stateRef.current by design: live MIDI state is held in a ref and renders are RAF-batched to avoid a re-render per MIDI event */}
                        {renderTouchStrips()}
                    </div>

                    {/* Display + Encoder */}
                    <div className="minilab3-display-section">
                        <div className="minilab3-oled">
                            <span className="minilab3-oled-text">Arturia</span>
                        </div>
                        <div className="minilab3-main-encoder" aria-hidden="true">
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

/** The hardware owns these values; the dial is a readout, not an input. */
const NOOP = () => { /* read-only mirror */ };

export default MiniLab3Visual;
