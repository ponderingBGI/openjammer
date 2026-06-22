/**
 * Node Registry - Defines all available node types and their default configurations
 */

import type { NodeDefinition, NodeType, PortDefinition } from './types';
import { isPluginId } from './types';
import { getDynamicPlugin, hasDynamicPlugin } from './dynamicRegistry';
import { MINILAB3_CONFIG, generatePortsFromConfig } from '../components/controls/MIDIDeviceConfig';

// ============================================================================
// Port Templates
// ============================================================================

const audioOutput: PortDefinition = {
    id: 'audio-out',
    name: 'Audio Out',
    type: 'audio',
    direction: 'output',
    position: { x: 1, y: 0.5 }  // Right side, centered
};

const audioInput: PortDefinition = {
    id: 'audio-in',
    name: 'Audio In',
    type: 'audio',
    direction: 'input',
    position: { x: 0, y: 0.5 }  // Left side, centered
};

// ============================================================================
// Node Definitions
// ============================================================================

export const nodeDefinitions: Record<NodeType, NodeDefinition> = {
    // Input Nodes
    keyboard: {
        type: 'keyboard',
        category: 'input',
        name: 'Keyboard',
        description: 'Virtual keyboard controller (auto-assigned key)',
        ui: 'react', // KeyboardNode (schematic switch)
        defaultPorts: [], // Ports generated from internal canvas-input/output nodes
        defaultData: {
            assignedKey: 2,
            activeRow: null,
            rowOctaves: [4, 4, 4]
        },
        dimensions: { width: 160, height: 120 },
        portLayout: {
            direction: 'vertical',
            outputArea: { x: 1, startY: 0.15, endY: 0.85 }
        }
    },

    'keyboard-key': {
        type: 'keyboard-key',
        category: 'input',
        name: 'Key',
        description: 'Individual keyboard key signal generator',
        ui: 'auto', // no bespoke NodeWrapper branch -> AutoParamPanel
        defaultPorts: [
            {
                id: 'out',
                name: 'Out',
                type: 'control',
                direction: 'output',
                position: { x: 1, y: 0.5 }
            }
        ],
        defaultData: {
            keyLabel: 'Q',
            row: 1,
            keyIndex: 0
        },
        dimensions: { width: 50, height: 50 }
    },

    'keyboard-visual': {
        type: 'keyboard-visual',
        category: 'input',
        name: 'Keyboard',
        description: 'Visual keyboard with per-key outputs',
        ui: 'react', // KeyboardVisualNode (schematic switch)
        defaultPorts: [
            // Row 1 (Q-P): 10 keys - ports on right edge, y: 0.05-0.22
            { id: 'key-q', name: 'Q', type: 'control', direction: 'output', position: { x: 1, y: 0.05 } },
            { id: 'key-w', name: 'W', type: 'control', direction: 'output', position: { x: 1, y: 0.07 } },
            { id: 'key-e', name: 'E', type: 'control', direction: 'output', position: { x: 1, y: 0.09 } },
            { id: 'key-r', name: 'R', type: 'control', direction: 'output', position: { x: 1, y: 0.11 } },
            { id: 'key-t', name: 'T', type: 'control', direction: 'output', position: { x: 1, y: 0.13 } },
            { id: 'key-y', name: 'Y', type: 'control', direction: 'output', position: { x: 1, y: 0.15 } },
            { id: 'key-u', name: 'U', type: 'control', direction: 'output', position: { x: 1, y: 0.17 } },
            { id: 'key-i', name: 'I', type: 'control', direction: 'output', position: { x: 1, y: 0.19 } },
            { id: 'key-o', name: 'O', type: 'control', direction: 'output', position: { x: 1, y: 0.21 } },
            { id: 'key-p', name: 'P', type: 'control', direction: 'output', position: { x: 1, y: 0.23 } },
            // Row 2 (A-L): 9 keys - y: 0.30-0.46
            { id: 'key-a', name: 'A', type: 'control', direction: 'output', position: { x: 1, y: 0.30 } },
            { id: 'key-s', name: 'S', type: 'control', direction: 'output', position: { x: 1, y: 0.32 } },
            { id: 'key-d', name: 'D', type: 'control', direction: 'output', position: { x: 1, y: 0.34 } },
            { id: 'key-f', name: 'F', type: 'control', direction: 'output', position: { x: 1, y: 0.36 } },
            { id: 'key-g', name: 'G', type: 'control', direction: 'output', position: { x: 1, y: 0.38 } },
            { id: 'key-h', name: 'H', type: 'control', direction: 'output', position: { x: 1, y: 0.40 } },
            { id: 'key-j', name: 'J', type: 'control', direction: 'output', position: { x: 1, y: 0.42 } },
            { id: 'key-k', name: 'K', type: 'control', direction: 'output', position: { x: 1, y: 0.44 } },
            { id: 'key-l', name: 'L', type: 'control', direction: 'output', position: { x: 1, y: 0.46 } },
            // Row 3 (Z-/): 10 keys - y: 0.53-0.71
            { id: 'key-z', name: 'Z', type: 'control', direction: 'output', position: { x: 1, y: 0.53 } },
            { id: 'key-x', name: 'X', type: 'control', direction: 'output', position: { x: 1, y: 0.55 } },
            { id: 'key-c', name: 'C', type: 'control', direction: 'output', position: { x: 1, y: 0.57 } },
            { id: 'key-v', name: 'V', type: 'control', direction: 'output', position: { x: 1, y: 0.59 } },
            { id: 'key-b', name: 'B', type: 'control', direction: 'output', position: { x: 1, y: 0.61 } },
            { id: 'key-n', name: 'N', type: 'control', direction: 'output', position: { x: 1, y: 0.63 } },
            { id: 'key-m', name: 'M', type: 'control', direction: 'output', position: { x: 1, y: 0.65 } },
            { id: 'key-comma', name: ',', type: 'control', direction: 'output', position: { x: 1, y: 0.67 } },
            { id: 'key-period', name: '.', type: 'control', direction: 'output', position: { x: 1, y: 0.69 } },
            { id: 'key-slash', name: '/', type: 'control', direction: 'output', position: { x: 1, y: 0.71 } },
            // Spacebar - y: 0.85
            { id: 'key-space', name: 'Space', type: 'control', direction: 'output', position: { x: 1, y: 0.85 } }
        ],
        defaultData: {},
        dimensions: { width: 660, height: 280 }
    },

    'instrument-visual': {
        type: 'instrument-visual',
        category: 'instruments',
        name: 'Instrument',
        description: 'Visual instrument with row configuration (internal node)',
        ui: 'react', // InstrumentVisualNode (schematic switch)
        defaultPorts: [
            // Input ports on left (connected from input-panel rows)
            { id: 'row-in', name: 'Rows', type: 'control', direction: 'input', position: { x: 0, y: 0.5 } },
            // Audio output on right (connects to output-panel)
            { id: 'audio-out', name: 'Audio', type: 'audio', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        defaultData: {},
        dimensions: { width: 500, height: 300 },
        canEnter: false  // Cannot enter this internal visual node
    },

    microphone: {
        type: 'microphone',
        category: 'input',
        name: 'Microphone',
        description: 'Live audio input from microphone',
        ui: 'react', // MicrophoneNode (schematic switch)
        defaultPorts: [{ ...audioOutput, position: { x: 1, y: 0.5 } }],
        defaultData: {
            isMuted: false,
            isActive: true
        },
        dimensions: { width: 140, height: 100 },
        canEnter: false  // Atomic node - no internal structure
    },

    midi: {
        type: 'midi',
        category: 'input',
        name: 'Midi',
        description: 'Connect MIDI controllers (keyboards, pads, knobs)',
        ui: 'react', // MIDINode (schematic switch)
        defaultPorts: [
            // Bundle outputs (expanded to per-control inside)
            { id: 'keys', name: 'Keys', type: 'control', direction: 'output' },
            { id: 'pads', name: 'Pads', type: 'control', direction: 'output' },
            { id: 'knobs', name: 'Knobs', type: 'control', direction: 'output' },
            { id: 'faders', name: 'Faders', type: 'control', direction: 'output' },
            { id: 'pitch-bend', name: 'Pitch', type: 'control', direction: 'output' },
            { id: 'mod-wheel', name: 'Mod', type: 'control', direction: 'output' },
        ],
        defaultData: {
            deviceId: null,
            deviceSignature: null,
            presetId: 'generic',
            isConnected: false,
            activeChannel: 0, // 0 = omni (all channels)
            midiLearnMode: false,
            learnTarget: null,
            learnedMappings: {}
        },
        dimensions: { width: 160, height: 200 },
        canEnter: true,  // Press E to see per-control visual
        portLayout: {
            direction: 'vertical',
            outputArea: { x: 1, startY: 0.2, endY: 0.75 }
        }
    },

    'midi-visual': {
        type: 'midi-visual',
        category: 'input',
        name: 'MIDI Device',
        description: 'Visual MIDI device representation (internal node)',
        ui: 'react', // MIDIVisualNode (schematic switch)
        defaultPorts: [
            // Touch strips (left side) - ports at bottom of strips
            { id: 'pitch-bend', name: 'Pitch', type: 'control', direction: 'output', position: { x: 0.055, y: 0.45 } },
            { id: 'mod-wheel', name: 'Mod', type: 'control', direction: 'output', position: { x: 0.095, y: 0.45 } },

            // Knobs - 2 rows of 4 (ports below each knob)
            { id: 'knob-1', name: 'K1', type: 'control', direction: 'output', position: { x: 0.38, y: 0.18 } },
            { id: 'knob-2', name: 'K2', type: 'control', direction: 'output', position: { x: 0.44, y: 0.18 } },
            { id: 'knob-3', name: 'K3', type: 'control', direction: 'output', position: { x: 0.50, y: 0.18 } },
            { id: 'knob-4', name: 'K4', type: 'control', direction: 'output', position: { x: 0.56, y: 0.18 } },
            { id: 'knob-5', name: 'K5', type: 'control', direction: 'output', position: { x: 0.38, y: 0.30 } },
            { id: 'knob-6', name: 'K6', type: 'control', direction: 'output', position: { x: 0.44, y: 0.30 } },
            { id: 'knob-7', name: 'K7', type: 'control', direction: 'output', position: { x: 0.50, y: 0.30 } },
            { id: 'knob-8', name: 'K8', type: 'control', direction: 'output', position: { x: 0.56, y: 0.30 } },

            // Faders - 4 vertical sliders (ports below each fader)
            { id: 'fader-1', name: 'F1', type: 'control', direction: 'output', position: { x: 0.72, y: 0.30 } },
            { id: 'fader-2', name: 'F2', type: 'control', direction: 'output', position: { x: 0.80, y: 0.30 } },
            { id: 'fader-3', name: 'F3', type: 'control', direction: 'output', position: { x: 0.88, y: 0.30 } },
            { id: 'fader-4', name: 'F4', type: 'control', direction: 'output', position: { x: 0.96, y: 0.30 } },

            // Pads - 8 horizontal (ports at bottom right of each pad)
            { id: 'pad-1', name: 'P1', type: 'control', direction: 'output', position: { x: 0.20, y: 0.55 } },
            { id: 'pad-2', name: 'P2', type: 'control', direction: 'output', position: { x: 0.30, y: 0.55 } },
            { id: 'pad-3', name: 'P3', type: 'control', direction: 'output', position: { x: 0.40, y: 0.55 } },
            { id: 'pad-4', name: 'P4', type: 'control', direction: 'output', position: { x: 0.50, y: 0.55 } },
            { id: 'pad-5', name: 'P5', type: 'control', direction: 'output', position: { x: 0.60, y: 0.55 } },
            { id: 'pad-6', name: 'P6', type: 'control', direction: 'output', position: { x: 0.70, y: 0.55 } },
            { id: 'pad-7', name: 'P7', type: 'control', direction: 'output', position: { x: 0.80, y: 0.55 } },
            { id: 'pad-8', name: 'P8', type: 'control', direction: 'output', position: { x: 0.90, y: 0.55 } },

            // Keys - 25 keys (C3-C5, notes 48-72) - ports at bottom of each key
            { id: 'key-48', name: 'C3', type: 'control', direction: 'output', position: { x: 0.04, y: 0.95 } },
            { id: 'key-49', name: 'C#3', type: 'control', direction: 'output', position: { x: 0.07, y: 0.80 } },
            { id: 'key-50', name: 'D3', type: 'control', direction: 'output', position: { x: 0.10, y: 0.95 } },
            { id: 'key-51', name: 'D#3', type: 'control', direction: 'output', position: { x: 0.13, y: 0.80 } },
            { id: 'key-52', name: 'E3', type: 'control', direction: 'output', position: { x: 0.16, y: 0.95 } },
            { id: 'key-53', name: 'F3', type: 'control', direction: 'output', position: { x: 0.22, y: 0.95 } },
            { id: 'key-54', name: 'F#3', type: 'control', direction: 'output', position: { x: 0.25, y: 0.80 } },
            { id: 'key-55', name: 'G3', type: 'control', direction: 'output', position: { x: 0.28, y: 0.95 } },
            { id: 'key-56', name: 'G#3', type: 'control', direction: 'output', position: { x: 0.31, y: 0.80 } },
            { id: 'key-57', name: 'A3', type: 'control', direction: 'output', position: { x: 0.34, y: 0.95 } },
            { id: 'key-58', name: 'A#3', type: 'control', direction: 'output', position: { x: 0.37, y: 0.80 } },
            { id: 'key-59', name: 'B3', type: 'control', direction: 'output', position: { x: 0.40, y: 0.95 } },
            { id: 'key-60', name: 'C4', type: 'control', direction: 'output', position: { x: 0.46, y: 0.95 } },
            { id: 'key-61', name: 'C#4', type: 'control', direction: 'output', position: { x: 0.49, y: 0.80 } },
            { id: 'key-62', name: 'D4', type: 'control', direction: 'output', position: { x: 0.52, y: 0.95 } },
            { id: 'key-63', name: 'D#4', type: 'control', direction: 'output', position: { x: 0.55, y: 0.80 } },
            { id: 'key-64', name: 'E4', type: 'control', direction: 'output', position: { x: 0.58, y: 0.95 } },
            { id: 'key-65', name: 'F4', type: 'control', direction: 'output', position: { x: 0.64, y: 0.95 } },
            { id: 'key-66', name: 'F#4', type: 'control', direction: 'output', position: { x: 0.67, y: 0.80 } },
            { id: 'key-67', name: 'G4', type: 'control', direction: 'output', position: { x: 0.70, y: 0.95 } },
            { id: 'key-68', name: 'G#4', type: 'control', direction: 'output', position: { x: 0.73, y: 0.80 } },
            { id: 'key-69', name: 'A4', type: 'control', direction: 'output', position: { x: 0.76, y: 0.95 } },
            { id: 'key-70', name: 'A#4', type: 'control', direction: 'output', position: { x: 0.79, y: 0.80 } },
            { id: 'key-71', name: 'B4', type: 'control', direction: 'output', position: { x: 0.82, y: 0.95 } },
            { id: 'key-72', name: 'C5', type: 'control', direction: 'output', position: { x: 0.88, y: 0.95 } },
        ],
        defaultData: {},
        dimensions: { width: 650, height: 400 },
        canEnter: false  // Cannot enter this internal visual node
    },

    'minilab-3': {
        type: 'minilab-3',
        category: 'input',
        name: MINILAB3_CONFIG.name,
        description: MINILAB3_CONFIG.description || 'Arturia MiniLab 3 MIDI Controller',
        ui: 'react', // MiniLab3Node (schematic switch)
        defaultPorts: [], // Ports synced from internal output-panel
        defaultData: {
            deviceId: null,
            deviceSignature: null,
            presetId: 'arturia-minilab-3',
            isConnected: false,
            activeChannel: 0,
            midiLearnMode: false,
            learnTarget: null,
            learnedMappings: {}
        },
        dimensions: MINILAB3_CONFIG.collapsedDimensions,
        canEnter: true,  // Press E to see full visual with per-control ports
        portLayout: {
            direction: 'vertical',
            outputArea: { x: 1, startY: 0.15, endY: 0.85 }
        }
    },

    'minilab3-visual': {
        type: 'minilab3-visual',
        category: 'input',
        name: 'MiniLab 3',
        description: 'Visual MiniLab 3 with per-control outputs (internal node)',
        ui: 'react', // MiniLab3VisualNode (schematic switch)
        // Ports generated from device config - positions determined by DOM lookup
        // The visual component's port markers have data-node-id and data-port-id
        // attributes that NodeCanvas uses for accurate position lookup
        defaultPorts: generatePortsFromConfig(MINILAB3_CONFIG),
        defaultData: {},
        dimensions: MINILAB3_CONFIG.visualDimensions,
        canEnter: false  // Cannot enter this internal visual node
    },

    // Instruments - all share similar layout: inputs on left, audio out on right
    piano: {
        type: 'piano',
        category: 'instruments',
        name: 'Classic Piano',
        description: 'Grand piano instrument',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [], // Ports generated from internal canvas-input/output nodes
        defaultData: {
            offsets: { 'input-1': 0 },
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }  // Audio out centered
        }
    },

    cello: {
        type: 'cello',
        category: 'instruments',
        name: 'Cello',
        description: 'Orchestral cello',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [], // Ports generated from internal canvas-input/output nodes
        defaultData: {
            offsets: { 'input-1': -12 }, // Default octaves lower
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },

    electricCello: {
        type: 'electricCello',
        category: 'instruments',
        name: 'Electric Cello',
        description: 'Modern electric cello with saturation and chorus',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [], // Ports generated from internal canvas-input/output nodes
        defaultData: {
            offsets: { 'input-1': -12 }, // Same range as acoustic cello
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },

    violin: {
        type: 'violin',
        category: 'instruments',
        name: 'Violin',
        description: 'Orchestral violin',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [], // Ports generated from internal canvas-input/output nodes
        defaultData: {
            offsets: { 'input-1': 12 }, // Higher pitch
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },

    saxophone: {
        type: 'saxophone',
        category: 'instruments',
        name: 'Saxophone',
        description: 'Jazz saxophone',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [], // Ports generated from internal canvas-input/output nodes
        defaultData: {
            offsets: { 'input-1': 0 },
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },

    // Category Aliases / Defaults - inherit layout from their base type
    strings: {
        type: 'strings', // Category alias for string instruments (defaults to cello sampler)
        category: 'instruments',
        name: 'Strings',
        description: 'String Ensemble',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [
            { id: 'bundle-in', name: 'Bundle', type: 'control', direction: 'input', isBundled: true },
            { id: 'pedal', name: 'Pedal', type: 'control', direction: 'input' },
            { id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' }
        ],
        defaultData: {
            offsets: { 'input-1': -12 },
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },
    keys: {
        type: 'keys', // Category alias for keyboard instruments (defaults to piano sampler)
        category: 'instruments',
        name: 'Keys',
        description: 'Keyboards',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [
            { id: 'bundle-in', name: 'Bundle', type: 'control', direction: 'input', isBundled: true },
            { id: 'pedal', name: 'Pedal', type: 'control', direction: 'input' },
            { id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' }
        ],
        defaultData: {
            offsets: { 'input-1': 0 },
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },
    winds: {
        type: 'winds', // Category alias for wind instruments (defaults to saxophone sampler)
        category: 'instruments',
        name: 'Winds',
        description: 'Wind Instruments',
        ui: 'react', // InstrumentNode (schematic switch)
        defaultPorts: [
            { id: 'bundle-in', name: 'Bundle', type: 'control', direction: 'input', isBundled: true },
            { id: 'pedal', name: 'Pedal', type: 'control', direction: 'input' },
            { id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' }
        ],
        defaultData: {
            offsets: { 'input-1': 0 },
            activeInputs: ['input-1']
        },
        dimensions: { width: 180, height: 100 },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        }
    },

    // Generic instrument node (uses instrumentId in data)
    instrument: {
        type: 'instrument',
        category: 'instruments',
        name: 'Instrument',
        description: 'Generic sampled instrument',
        // NodeWrapper has NO bespoke branch for 'instrument' (it is NOT in
        // SCHEMATIC_TYPES nor a renderNodeContent case) — it falls through to the
        // FREE AutoParamPanel. The old REACT_UI listed it as react, which was the
        // single mis-declaration; reality is 'auto'.
        ui: 'auto',
        defaultPorts: [
            { id: 'bundle-in', name: 'Bundle', type: 'control', direction: 'input', isBundled: true },
            { id: 'pedal', name: 'Pedal', type: 'control', direction: 'input' },
            { id: 'audio-out', name: 'Output', type: 'audio', direction: 'output' }
        ],
        defaultData: {
            offsets: { 'input-1': 0 },
            activeInputs: ['input-1'],
            instrumentId: 'salamander-piano'
        },
        dimensions: { width: 180, height: 120 }
    },

    // Effects & Processing
    looper: {
        type: 'looper',
        category: 'routing',
        name: 'Looper',
        description: 'Record and loop audio with auto-detection',
        ui: 'react', // LooperNode (schematic switch)
        defaultPorts: [
            { ...audioInput, position: { x: 0, y: 0.5 } },
            { ...audioOutput, position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            duration: 10,
            isRecording: false,
            loops: [],
            currentTime: 0
        },
        dimensions: { width: 240, height: 120 }
    },

    effect: {
        type: 'effect',
        category: 'effects',
        name: 'Effect',
        description: 'Audio effect processor',
        ui: 'react', // EffectNode (renderNodeContent switch)
        defaultPorts: [
            { ...audioInput, position: { x: 0, y: 0.5 } },
            { ...audioOutput, position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            effectType: 'distortion',
            params: { amount: 0.5 }
        },
        dimensions: { width: 160, height: 100 }
    },

    multiplier: {
        type: 'multiplier',
        category: 'utility',
        // Multiply a signal by a number — or, when 'in-2' is wired, by a second
        // signal (a VCA / ring-mod). The math sibling of Add / Subtract: two
        // universal inputs kept distinct, one universal output. The on-node number
        // is the second operand only while 'in-2' is unconnected.
        name: 'Multiplier',
        description: 'Multiply a signal by a number, or by a second signal (×)',
        ui: 'react', // MultiplierNode (renderNodeContent switch)
        defaultPorts: [
            { id: 'in-1', name: 'In 1', type: 'universal', direction: 'input', position: { x: 0, y: 0.33 } },
            { id: 'in-2', name: 'In 2', type: 'universal', direction: 'input', position: { x: 0, y: 0.67 } },
            { id: 'out', name: 'Out', type: 'universal', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            factor: 1,
            resolvedType: null
        },
        dimensions: { width: 150, height: 100 }
    },

    // Outputs
    speaker: {
        type: 'speaker',
        category: 'output',
        name: 'Speaker',
        description: 'Audio output to device speakers',
        ui: 'react', // SpeakerNode (schematic switch)
        defaultPorts: [
            { ...audioInput, position: { x: 0, y: 0.5 } }
        ],
        defaultData: {
            volume: 1,
            isMuted: false,
            deviceId: 'default'
        },
        dimensions: { width: 140, height: 160 },
        canEnter: false  // Atomic node - no internal structure
    },

    recorder: {
        type: 'recorder',
        category: 'output',
        name: 'Recorder',
        description: 'Record audio to WAV file',
        ui: 'react', // RecorderNode (renderNodeContent switch)
        defaultPorts: [
            { ...audioInput, position: { x: 0, y: 0.5 } }
        ],
        defaultData: {
            isRecording: false,
            recordings: []
        },
        dimensions: { width: 160, height: 120 }
    },

    // Hierarchical Canvas I/O Nodes - small connector nodes
    'canvas-input': {
        type: 'canvas-input',
        category: 'routing',
        name: 'Input',
        description: 'Receives signal from parent canvas',
        ui: 'react', // CanvasIONode (schematic switch)
        defaultPorts: [
            { id: 'out', name: 'Out', type: 'control', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            portName: ''
        },
        dimensions: { width: 80, height: 40 }
    },

    'canvas-output': {
        type: 'canvas-output',
        category: 'routing',
        name: 'Output',
        description: 'Sends signal to parent canvas',
        ui: 'react', // CanvasIONode (schematic switch)
        defaultPorts: [
            { id: 'in', name: 'In', type: 'control', direction: 'input', position: { x: 0, y: 0.5 } }
        ],
        defaultData: {
            portName: ''
        },
        dimensions: { width: 80, height: 40 }
    },

    'output-panel': {
        type: 'output-panel',
        category: 'routing',
        name: 'Outputs',
        description: 'Multi-port output panel with editable labels',
        ui: 'react', // OutputPanelNode (schematic switch)
        defaultPorts: [
            // Default 4 ports for keyboard (Row 1, Row 2, Row 3, Pedal)
            { id: 'port-1', name: 'Row 1 (Q-P)', type: 'control', direction: 'input', position: { x: 0, y: 0.15 } },
            { id: 'port-2', name: 'Row 2 (A-L)', type: 'control', direction: 'input', position: { x: 0, y: 0.38 } },
            { id: 'port-3', name: 'Row 3 (Z-/)', type: 'control', direction: 'input', position: { x: 0, y: 0.61 } },
            { id: 'port-4', name: 'Pedal', type: 'control', direction: 'input', position: { x: 0, y: 0.84 } }
        ],
        defaultData: {
            // Store port labels for editing
            portLabels: {
                'port-1': 'Row 1 (Q-P)',
                'port-2': 'Row 2 (A-L)',
                'port-3': 'Row 3 (Z-/)',
                'port-4': 'Pedal'
            }
        },
        dimensions: { width: 160, height: 200 }
    },

    'input-panel': {
        type: 'input-panel',
        category: 'routing',
        name: 'Inputs',
        description: 'Multi-port input panel with editable labels',
        ui: 'react', // InputPanelNode (schematic switch)
        defaultPorts: [],  // Empty by default
        defaultData: {
            portLabels: {}
        },
        dimensions: { width: 160, height: 80 }
    },

    // Utility Nodes
    container: {
        type: 'container',
        category: 'utility',
        name: 'Empty Node',
        description: 'Empty node for grouping and organizing other nodes',
        ui: 'react', // ContainerNode (schematic switch)
        defaultPorts: [],  // Ports synced from internal canvas-input/output nodes
        defaultData: {
            displayName: 'Untitled'
        },
        dimensions: { width: 160, height: 100 },
        canEnter: true  // Can be entered to place nodes inside
    },

    add: {
        type: 'add',
        category: 'utility',
        name: 'Add',
        description: 'Add two signals together (audio mixing or number addition)',
        ui: 'react', // MathNode (schematic switch)
        defaultPorts: [
            { id: 'in-1', name: 'In 1', type: 'universal', direction: 'input', position: { x: 0, y: 0.33 } },
            { id: 'in-2', name: 'In 2', type: 'universal', direction: 'input', position: { x: 0, y: 0.67 } },
            { id: 'out', name: 'Out', type: 'universal', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            resolvedType: null
        },
        dimensions: { width: 120, height: 80 },
        canEnter: false  // Cannot be entered - flashes red on E key
    },

    subtract: {
        type: 'subtract',
        category: 'utility',
        name: 'Subtract',
        description: 'Subtract second signal from first (audio phase cancellation or number subtraction)',
        ui: 'react', // MathNode (schematic switch)
        defaultPorts: [
            { id: 'in-1', name: 'In 1', type: 'universal', direction: 'input', position: { x: 0, y: 0.33 } },
            { id: 'in-2', name: 'In 2', type: 'universal', direction: 'input', position: { x: 0, y: 0.67 } },
            { id: 'out', name: 'Out', type: 'universal', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            resolvedType: null
        },
        dimensions: { width: 120, height: 80 },
        canEnter: false  // Cannot be entered - flashes red on E key
    },

    // Library Node - Audio file browser with tags
    library: {
        type: 'library',
        category: 'input',
        name: 'Library',
        description: 'Local audio file library with tag management',
        ui: 'react', // LibraryNode (schematic switch)
        // SEAM-1: only the REAL seam is declared. The library's one engine effect is
        // feeding a selected/connected sample's PCM into connected Sampler nodes (via
        // the executor `sendSampleBuffer`), so `sample-out` is the single live port.
        // The former `audio-out` (no engine audio bus from the library) and `trigger`
        // (no engine consumer) were dead ports — wiring them did nothing — so they are
        // removed here and stripped from saved projects by `migrateNodePorts`.
        defaultPorts: [
            { id: 'sample-out', name: 'Sample', type: 'audio', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        defaultData: {
            libraryId: undefined,
            currentItemId: undefined,
            itemRefs: [],
            playbackMode: 'oneshot',
            volume: 1,
            missingItemIds: [],
            // Tag panel state
            separatorPosition: 0.5,  // Position of pinned/other tags separator (0-1)
            // Node resizing
            width: 500,
            height: 400
        },
        dimensions: { width: 500, height: 400 },
        canEnter: false  // Library browser is inline, not a sub-canvas
    },

    // Sampler Instrument Node - Row-based design like instrument nodes
    sampler: {
        type: 'sampler',
        category: 'instruments',
        name: 'Sampler',
        description: 'Play audio samples chromatically via keyboard',
        ui: 'react', // SamplerNode (schematic switch)
        defaultPorts: [
            // Bundled control input on left (accepts keyboard bundles)
            { id: 'bundle-in', name: 'Keys', type: 'control', direction: 'input', isBundled: true },
            // Audio output on right
            { id: 'audio-out', name: 'Out', type: 'audio', direction: 'output' }
        ],
        defaultData: {
            // Sample reference
            sampleId: null,
            sampleName: null,
            waveformData: null,
            duration: null,
            // Row-based structure (populated when bundles connect)
            rows: [],
            // Core audio parameters
            rootNote: 60,       // MIDI note (C4)
            gain: 1.0,          // Overall gain
            spread: 1.0,        // Semitones per key
            attack: 0.01,       // Attack time
            release: 0.1        // Release time
        },
        portLayout: {
            direction: 'vertical',
            inputArea: { x: 0, startY: 0.2, endY: 0.8 },
            outputArea: { x: 1, startY: 0.4, endY: 0.6 }
        },
        dimensions: { width: 200, height: 140 },
        canEnter: true  // Allows E key to view internal structure
    },

    // Sampler Visual - compact inside view with row-based layout
    'sampler-visual': {
        type: 'sampler-visual',
        category: 'instruments',
        name: 'Sampler Visual',
        description: 'Internal view with row-based key mapping',
        ui: 'react', // SamplerVisualNode (schematic switch)
        defaultPorts: [
            // Placeholder port for new connections (bundles or single)
            { id: 'placeholder-in', name: '', type: 'control', direction: 'input', position: { x: 0, y: 0.5 } }
        ],
        defaultData: {},
        portLayout: {
            direction: 'horizontal',
            inputArea: { x: 0, startY: 0.3, endY: 0.7 },
            outputArea: { x: 1, startY: 0.3, endY: 0.7 }
        },
        dimensions: { width: 180, height: 80 },
        canEnter: false  // This IS the internal view
    }
};

// ============================================================================
// Menu Structure (ComfyUI-style hierarchical)
// ============================================================================

export interface MenuCategory {
    name: string;
    icon: string;
    items: NodeType[];
}

export const menuCategories: MenuCategory[] = [
    {
        name: 'Input',
        icon: '⌨️',
        items: ['keyboard', 'midi', 'microphone', 'library']
    },
    {
        name: 'Instruments',
        icon: '🎻',
        items: ['strings', 'keys', 'winds', 'sampler']
    },
    {
        name: 'Routing',
        icon: '🔄',
        items: ['looper']
    },
    {
        name: 'Effects',
        icon: '✨',
        items: ['effect']
    },
    {
        name: 'Utility',
        icon: '🔧',
        items: ['container', 'add', 'subtract', 'multiplier']
    },
    {
        name: 'Output',
        icon: '🔊',
        items: ['speaker', 'recorder']
    }
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Fallback definition returned by {@link get} when an unknown node type is
 * requested (e.g. a workflow saved by a newer build, or a corrupt id). It is an
 * inert "container"-shaped placeholder with no ports so the rest of the app can
 * keep operating instead of dereferencing `undefined`.
 */
const MISSING_DEFINITION: NodeDefinition = {
    type: 'container',
    category: 'utility',
    name: 'Unknown',
    description: 'Unknown node type (definition missing)',
    // Inert placeholder: render via the FREE AutoParamPanel (no bespoke surface
    // for an unknown type), never assume a bespoke component exists.
    ui: 'auto',
    defaultPorts: [],
    defaultData: {},
    dimensions: { width: 160, height: 100 },
    canEnter: false
};

/**
 * Whether `value` resolves to a registered node definition — either a CLOSED
 * built-in plugin id ({@link isPluginId}) OR a registered OPEN dynamic plugin id
 * (M5). This is the validity check serialization uses so a node whose identity
 * resolves dynamically is NOT discarded on import.
 */
export function isRegisteredPluginId(value: unknown): boolean {
    return isPluginId(value) || (typeof value === 'string' && hasDynamicPlugin(value));
}

/**
 * Resolve a node definition by id, with a guaranteed non-undefined result.
 *
 * Looks up the CLOSED built-in registry first; if `type` is not a known plugin
 * id, falls back to the OPEN dynamic registry (M5); failing both, returns
 * {@link MISSING_DEFINITION}. (U10 + M5)
 */
export function get(type: NodeType): NodeDefinition {
    if (isPluginId(type)) {
        // `type` is a PluginId (a branded NodeType); widen to NodeType to index.
        return nodeDefinitions[type as NodeType] ?? MISSING_DEFINITION;
    }
    // Not a built-in id: an OPEN dynamic id may still resolve (M5).
    return getDynamicPlugin(type) ?? MISSING_DEFINITION;
}

export function getNodeDefinition(type: NodeType): NodeDefinition {
    return get(type);
}

/**
 * Resolve the definition a node should DISPLAY with (M5).
 *
 * PREFERS the node's OPEN identity: when `node.pluginId` is set AND registered in
 * the dynamic registry, returns that dynamic def (so an AI-authored node shows
 * its own name/description/params/canEnter). Otherwise falls back to {@link get}
 * on the closed `node.type` — the unchanged path for ordinary built-in nodes.
 */
export function resolveNodeDefinition(node: { type: NodeType; pluginId?: string }): NodeDefinition {
    if (node.pluginId !== undefined) {
        const dynamic = getDynamicPlugin(node.pluginId);
        if (dynamic) return dynamic;
    }
    return get(node.type);
}

export function canConnect(
    sourcePort: PortDefinition,
    targetPort: PortDefinition
): boolean {
    // ANY-TO-ANY PHILOSOPHY: Allow all connections by default
    // Signal coercion/interpretation happens at the receiving node
    // This follows modular synth conventions where "it's all just voltage"

    // FIRST: Enforce direction for ALL connection types
    // Can't connect output→output or input→input regardless of signal type
    if (sourcePort.direction === targetPort.direction) {
        return false;
    }

    // GATED ports (declared but not engine-wired yet) reject all connections —
    // never let a player wire an edge that would silently do nothing. The port
    // stays visible (rendered inert) so it can light up the moment its routing
    // lands. (No built-in currently ships one; the affordance is kept for future
    // nodes whose routing is staged behind the kernel.)
    if (sourcePort.disabled || targetPort.disabled) {
        return false;
    }

    // Universal ports can connect to anything (they adapt to the connected type)
    if (sourcePort.type === 'universal' || targetPort.type === 'universal') {
        return true;
    }

    // All other connections are allowed:
    // - audio → control (audio modulates a parameter)
    // - control → audio (control signal as audio, interesting effects)
    // - control → control (normal parameter routing)
    // - audio → audio (normal audio routing)
    return true;
}
