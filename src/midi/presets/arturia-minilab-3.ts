/**
 * Arturia MiniLab 3 Preset
 * 25-key MIDI controller with pads, knobs, faders, and touch strips
 */

import type { MIDIDevicePreset } from '../types';

export const arturiaMinilab3Preset: MIDIDevicePreset = {
  id: 'arturia-minilab-3',
  name: 'Arturia MiniLab 3',
  manufacturer: 'Arturia',
  matchPatterns: ['MiniLab 3', 'MiniLab3', 'Minilab 3', 'Minilab3'],

  // Only use the main MIDI port, ignore MCU/DIN/ALV ports
  preferredPort: 'MiniLab 3 MIDI',
  ignorePorts: ['MCU', 'DIN', 'ALV'],

  controls: {
    // 25 velocity-sensitive keys (no aftertouch on keys)
    keys: {
      noteRange: [48, 72], // C3 to C5 (2 octaves + 1)
      channel: 1,
      hasVelocity: true,
      hasAftertouch: false,
    },

    // 8 RGB velocity & pressure-sensitive pads (Bank A)
    // The 8 pads map the controller's Bank A (notes 36-43, channel 10). Bank B
    // sends a different note set (44-51) and is not mapped here.
    pads: [
      { id: 'pad-1', name: 'Pad 1', note: 36, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#FF5722' },
      { id: 'pad-2', name: 'Pad 2', note: 37, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#FF9800' },
      { id: 'pad-3', name: 'Pad 3', note: 38, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#FFC107' },
      { id: 'pad-4', name: 'Pad 4', note: 39, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#FFEB3B' },
      { id: 'pad-5', name: 'Pad 5', note: 40, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#8BC34A' },
      { id: 'pad-6', name: 'Pad 6', note: 41, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#4CAF50' },
      { id: 'pad-7', name: 'Pad 7', note: 42, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#00BCD4' },
      { id: 'pad-8', name: 'Pad 8', note: 43, channel: 10, hasVelocity: true, hasAftertouch: true, color: '#2196F3' },
    ],

    // 8 endless encoder knobs
    // Note: Exact CC numbers may vary based on user template
    // These are common defaults for filter/envelope parameters
    knobs: [
      { id: 'knob-1', name: 'Knob 1', cc: 74, channel: 1, mode: 'absolute', defaultValue: 64 }, // Cutoff
      { id: 'knob-2', name: 'Knob 2', cc: 71, channel: 1, mode: 'absolute', defaultValue: 64 }, // Resonance
      { id: 'knob-3', name: 'Knob 3', cc: 76, channel: 1, mode: 'absolute', defaultValue: 64 },
      { id: 'knob-4', name: 'Knob 4', cc: 77, channel: 1, mode: 'absolute', defaultValue: 64 },
      { id: 'knob-5', name: 'Knob 5', cc: 78, channel: 1, mode: 'absolute', defaultValue: 64 },
      { id: 'knob-6', name: 'Knob 6', cc: 79, channel: 1, mode: 'absolute', defaultValue: 64 },
      { id: 'knob-7', name: 'Knob 7', cc: 80, channel: 1, mode: 'absolute', defaultValue: 64 },
      { id: 'knob-8', name: 'Knob 8', cc: 81, channel: 1, mode: 'absolute', defaultValue: 64 },
    ],

    // 4 faders (confirmed CC numbers from research)
    faders: [
      { id: 'fader-1', name: 'Attack', cc: 82, channel: 1, defaultValue: 0 },
      { id: 'fader-2', name: 'Decay', cc: 83, channel: 1, defaultValue: 64 },
      { id: 'fader-3', name: 'Sustain', cc: 85, channel: 1, defaultValue: 127 },
      { id: 'fader-4', name: 'Release', cc: 17, channel: 1, defaultValue: 64 },
    ],

    // Pitch bend touch strip (left)
    pitchBend: {
      channel: 1,
    },

    // Modulation touch strip (right)
    modWheel: {
      cc: 1,
      channel: 1,
    },
  },

  visualization: {
    // Uses custom MiniLab3Visual React component instead of SVG path
    svgPath: undefined,
    width: 400,
    height: 250,
    controlPositions: {
      // Keyboard at bottom
      'keys': { x: 20, y: 150, width: 360, height: 80 },

      // Pads in middle-left (2 rows of 4)
      'pad-1': { x: 20, y: 80, width: 40, height: 40 },
      'pad-2': { x: 65, y: 80, width: 40, height: 40 },
      'pad-3': { x: 110, y: 80, width: 40, height: 40 },
      'pad-4': { x: 155, y: 80, width: 40, height: 40 },
      'pad-5': { x: 20, y: 35, width: 40, height: 40 },
      'pad-6': { x: 65, y: 35, width: 40, height: 40 },
      'pad-7': { x: 110, y: 35, width: 40, height: 40 },
      'pad-8': { x: 155, y: 35, width: 40, height: 40 },

      // Knobs in top row
      'knob-1': { x: 210, y: 20, width: 30, height: 30 },
      'knob-2': { x: 245, y: 20, width: 30, height: 30 },
      'knob-3': { x: 280, y: 20, width: 30, height: 30 },
      'knob-4': { x: 315, y: 20, width: 30, height: 30 },
      'knob-5': { x: 210, y: 55, width: 30, height: 30 },
      'knob-6': { x: 245, y: 55, width: 30, height: 30 },
      'knob-7': { x: 280, y: 55, width: 30, height: 30 },
      'knob-8': { x: 315, y: 55, width: 30, height: 30 },

      // Faders to the right of knobs
      'fader-1': { x: 355, y: 20, width: 20, height: 50 },
      'fader-2': { x: 355, y: 75, width: 20, height: 50 },
      'fader-3': { x: 355, y: 130, width: 20, height: 50 },
      'fader-4': { x: 355, y: 185, width: 20, height: 50 },

      // Touch strips at the very left
      'pitchBend': { x: 5, y: 150, width: 12, height: 80 },
      'modWheel': { x: 5, y: 60, width: 12, height: 80 },
    },
  },
};
