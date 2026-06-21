/**
 * MIDI Message Parser
 * Converts raw MIDI bytes to typed event objects
 */

import type {
  MIDIEvent,
  MIDINoteEvent,
  MIDICCEvent,
  MIDIPitchBendEvent,
  MIDIAftertouchEvent,
  MIDIProgramChangeEvent,
} from './types';
import { MIDI_COMMANDS } from './types';

/**
 * Parse raw MIDI message bytes into a typed event
 */
export function parseMIDIMessage(
  data: Uint8Array,
  timestamp: number,
  deviceId: string
): MIDIEvent | null {
  if (data.length === 0) return null;

  const statusByte = data[0];
  const command = statusByte & 0xf0; // Upper nibble
  const channel = statusByte & 0x0f; // Lower nibble

  switch (command) {
    case MIDI_COMMANDS.NOTE_OFF:
      return parseNoteOff(data, channel, timestamp, deviceId);

    case MIDI_COMMANDS.NOTE_ON:
      return parseNoteOn(data, channel, timestamp, deviceId);

    case MIDI_COMMANDS.POLY_AFTERTOUCH:
      return parsePolyAftertouch(data, channel, timestamp, deviceId);

    case MIDI_COMMANDS.CONTROL_CHANGE:
      return parseControlChange(data, channel, timestamp, deviceId);

    case MIDI_COMMANDS.PROGRAM_CHANGE:
      return parseProgramChange(data, channel, timestamp, deviceId);

    case MIDI_COMMANDS.CHANNEL_AFTERTOUCH:
      return parseChannelAftertouch(data, channel, timestamp, deviceId);

    case MIDI_COMMANDS.PITCH_BEND:
      return parsePitchBend(data, channel, timestamp, deviceId);

    default:
      // System / unsupported messages are not note or controller data: ignore.
      return null;
  }
}

/**
 * Parse Note Off message
 */
function parseNoteOff(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDINoteEvent | null {
  if (data.length < 3) return null;

  return {
    type: 'noteOff',
    note: data[1],
    velocity: data[2],
    normalizedVelocity: data[2] / 127,
    channel,
    timestamp,
    deviceId,
  };
}

/**
 * Parse Note On message
 * Note: velocity 0 is treated as Note Off
 */
function parseNoteOn(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDINoteEvent | null {
  if (data.length < 3) return null;

  const velocity = data[2];
  const isNoteOff = velocity === 0;

  return {
    type: isNoteOff ? 'noteOff' : 'noteOn',
    note: data[1],
    velocity,
    normalizedVelocity: velocity / 127,
    channel,
    timestamp,
    deviceId,
  };
}

/**
 * Parse Polyphonic Aftertouch message
 */
function parsePolyAftertouch(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDIAftertouchEvent | null {
  if (data.length < 3) return null;

  return {
    type: 'aftertouch',
    note: data[1],
    pressure: data[2],
    normalizedPressure: data[2] / 127,
    channel,
    timestamp,
    deviceId,
  };
}

/**
 * Parse Control Change message
 */
function parseControlChange(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDICCEvent | null {
  if (data.length < 3) return null;

  return {
    type: 'cc',
    controller: data[1],
    value: data[2],
    normalizedValue: data[2] / 127,
    channel,
    timestamp,
    deviceId,
  };
}

/**
 * Parse Program Change message
 */
function parseProgramChange(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDIProgramChangeEvent | null {
  if (data.length < 2) return null;

  return {
    type: 'programChange',
    program: data[1],
    channel,
    timestamp,
    deviceId,
  };
}

/**
 * Parse Channel Aftertouch message
 */
function parseChannelAftertouch(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDIAftertouchEvent | null {
  if (data.length < 2) return null;

  return {
    type: 'aftertouch',
    pressure: data[1],
    normalizedPressure: data[1] / 127,
    channel,
    timestamp,
    deviceId,
  };
}

/**
 * Parse Pitch Bend message
 * Pitch bend uses 14-bit resolution: LSB (data1) + MSB (data2)
 * Range: 0-16383, with 8192 being center (no bend)
 */
function parsePitchBend(
  data: Uint8Array,
  channel: number,
  timestamp: number,
  deviceId: string
): MIDIPitchBendEvent | null {
  if (data.length < 3) return null;

  const lsb = data[1];
  const msb = data[2];
  const value = (msb << 7) | lsb; // 0-16383
  const centered = value - 8192; // -8192 to +8191

  return {
    type: 'pitchBend',
    value: centered,
    normalizedValue: centered / 8192, // -1 to +1
    channel,
    timestamp,
    deviceId,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert MIDI note number to note name (e.g., 60 -> "C4")
 */
export function midiNoteToName(note: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  const noteName = noteNames[note % 12];
  return `${noteName}${octave}`;
}

/**
 * Convert note name to MIDI note number (e.g., "C4" -> 60)
 */
export function noteNameToMidi(name: string): number | null {
  const match = name.match(/^([A-G]#?)(-?\d+)$/i);
  if (!match) return null;

  const noteNames: Record<string, number> = {
    'C': 0, 'C#': 1, 'DB': 1,
    'D': 2, 'D#': 3, 'EB': 3,
    'E': 4, 'FB': 4,
    'F': 5, 'E#': 5, 'F#': 6, 'GB': 6,
    'G': 7, 'G#': 8, 'AB': 8,
    'A': 9, 'A#': 10, 'BB': 10,
    'B': 11, 'CB': 11,
  };

  const noteName = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);

  if (!(noteName in noteNames)) return null;

  return (octave + 1) * 12 + noteNames[noteName];
}

/**
 * Get MIDI CC name if it's a standard controller
 */
export function getCCName(cc: number): string {
  const ccNames: Record<number, string> = {
    0: 'Bank Select MSB',
    1: 'Modulation',
    2: 'Breath',
    4: 'Foot',
    5: 'Portamento Time',
    6: 'Data Entry MSB',
    7: 'Volume',
    8: 'Balance',
    10: 'Pan',
    11: 'Expression',
    32: 'Bank Select LSB',
    64: 'Sustain',
    65: 'Portamento',
    66: 'Sostenuto',
    67: 'Soft Pedal',
    68: 'Legato',
    69: 'Hold 2',
    71: 'Resonance',
    72: 'Release',
    73: 'Attack',
    74: 'Cutoff',
    75: 'Decay',
    91: 'Reverb',
    93: 'Chorus',
    120: 'All Sound Off',
    121: 'Reset All',
    123: 'All Notes Off',
    124: 'Omni Off',
    125: 'Omni On',
    126: 'Mono',
    127: 'Poly',
  };

  return ccNames[cc] ?? `CC ${cc}`;
}

/**
 * Normalize a MIDI value (0-127) to a float (0-1)
 */
export function normalizeMIDIValue(value: number): number {
  return Math.max(0, Math.min(1, value / 127));
}

/**
 * Denormalize a float (0-1) to a MIDI value (0-127)
 */
export function denormalizeMIDIValue(value: number): number {
  return Math.round(Math.max(0, Math.min(127, value * 127)));
}
