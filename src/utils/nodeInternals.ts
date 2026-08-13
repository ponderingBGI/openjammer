/**
 * Node Internals - Initialize default internal structure for hierarchical nodes
 */

import type { GraphNode, Connection, MIDIInputNodeData, PortDefinition } from '../engine/types';
import { generateUniqueId } from './idGenerator';
import { getPresetRegistry } from '../midi';

/** Empty port ID prefix (matches bundleManager.ts) */
const EMPTY_PORT_PREFIX = 'empty-';

interface InternalStructure {
    internalNodes: Map<string, GraphNode>;
    internalConnections: Map<string, Connection>;  // Changed from Connection[] to Map
    specialNodes: string[]; // IDs of undeletable nodes
    // Port visibility configuration
    showEmptyInputPorts?: boolean;   // Show input-panel ports even if not connected
    showEmptyOutputPorts?: boolean;  // Show output-panel ports even if not connected
}

/**
 * Standard panel configuration for createStandardPanels()
 */
interface StandardPanelConfig {
    /** Labels for output panel ports (shows on parent's outputs) */
    outputLabels?: string[];
    /** Labels for input panel ports (shows on parent's inputs) */
    inputLabels?: string[];
    /** Position of output panel */
    outputPosition?: { x: number; y: number };
    /** Position of input panel */
    inputPosition?: { x: number; y: number };
    /** Always include one empty slot on output panel (default: true) */
    includeEmptyOutputSlot?: boolean;
    /** Always include one empty slot on input panel (default: true) */
    includeEmptyInputSlot?: boolean;
}

/**
 * Create standardized input and output panels with consistent behavior
 *
 * This is the centralized factory for panels ensuring:
 * - "Always one empty slot" pattern on both panels
 * - Consistent port labeling
 * - Uniform structure across all node types
 *
 * @returns Input panel, output panel nodes and their IDs
 */
export function createStandardPanels(config: StandardPanelConfig = {}): {
    inputPanel: GraphNode;
    outputPanel: GraphNode;
    inputPanelId: string;
    outputPanelId: string;
} {
    const {
        outputLabels = [],
        inputLabels = [],
        outputPosition = { x: 700, y: 100 },
        inputPosition = { x: 50, y: 100 },
        includeEmptyOutputSlot = true,
        includeEmptyInputSlot = true
    } = config;

    // Create OUTPUT PANEL
    // Output panel has INPUT ports (receives from inside, outputs to parent)
    const outputPanelId = generateUniqueId('output-panel-');
    const outputPorts: PortDefinition[] = [];
    const outputPortLabels: Record<string, string> = {};
    const outputPortHideExternal: Record<string, boolean> = {};

    // Add labeled output ports
    outputLabels.forEach((label, index) => {
        const portId = `port-${index + 1}`;
        const yPos = 0.1 + (index / Math.max(outputLabels.length, 1)) * 0.7;
        outputPorts.push({
            id: portId,
            name: label,
            type: 'control',
            direction: 'input',
            position: { x: 0, y: yPos }
        });
        outputPortLabels[portId] = label;
    });

    // Add empty slot port for output panel
    if (includeEmptyOutputSlot) {
        const emptyPortId = generateUniqueId(EMPTY_PORT_PREFIX);
        outputPorts.push({
            id: emptyPortId,
            name: '',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.9 }
        });
        outputPortLabels[emptyPortId] = '';
        outputPortHideExternal[emptyPortId] = true;  // Hide empty slot on parent
    }

    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: outputPosition,
        data: {
            portLabels: outputPortLabels,
            portHideExternalLabel: outputPortHideExternal
        },
        ports: outputPorts,
        parentId: null,
        childIds: []
    };

    // Create INPUT PANEL
    // Input panel has OUTPUT ports (receives from parent, outputs to inside)
    const inputPanelId = generateUniqueId('input-panel-');
    const inputPorts: PortDefinition[] = [];
    const inputPortLabels: Record<string, string> = {};
    const inputPortHideExternal: Record<string, boolean> = {};

    // Add labeled input ports
    inputLabels.forEach((label, index) => {
        const portId = `port-${index + 1}`;
        const yPos = 0.1 + (index / Math.max(inputLabels.length, 1)) * 0.7;
        inputPorts.push({
            id: portId,
            name: label,
            type: 'control',
            direction: 'output',
            position: { x: 1, y: yPos }
        });
        inputPortLabels[portId] = label;
    });

    // Add empty slot port for input panel
    if (includeEmptyInputSlot) {
        const emptyPortId = generateUniqueId(EMPTY_PORT_PREFIX);
        inputPorts.push({
            id: emptyPortId,
            name: '',
            type: 'control',
            direction: 'output',
            position: { x: 1, y: 0.9 }
        });
        inputPortLabels[emptyPortId] = '';
        inputPortHideExternal[emptyPortId] = true;  // Hide empty slot on parent
    }

    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: inputPosition,
        data: {
            portLabels: inputPortLabels,
            portHideExternalLabel: inputPortHideExternal
        },
        ports: inputPorts,
        parentId: null,
        childIds: []
    };

    return {
        inputPanel,
        outputPanel,
        inputPanelId,
        outputPanelId
    };
}

/**
 * Create default internal structure for a node based on its type
 */
export function createDefaultInternalStructure(parentNode: GraphNode): InternalStructure {
    switch (parentNode.type) {
        case 'keyboard':
            return createKeyboardInternals();

        case 'piano':
        case 'cello':
        case 'electricCello':
        case 'violin':
        case 'saxophone':
        case 'strings':
        case 'keys':
        case 'winds':
        case 'instrument':
            return createInstrumentInternals();

        case 'container':
            return createContainerInternals();

        case 'midi':
            return createMIDIInternals(parentNode);

        case 'minilab-3':
            return createMiniLab3Internals(parentNode);

        case 'sampler':
            return createSamplerInternals();

        case 'song':
            // The song node's interior is the TIMELINE (SongInterior), not a graph —
            // it has NO child nodes. Empty internals keep it childless so it is never
            // mistaken for a sub-graph container (the canvas enters it on its
            // `interior:'timeline'` flag, not on childIds).
            return createEmptyInternals();

        default:
            return createGenericInternals();
    }
}

/** No internal structure at all — for nodes whose interior is a bespoke view
 * (the song timeline), not a sub-canvas of child nodes. */
function createEmptyInternals(): InternalStructure {
    return {
        internalNodes: new Map<string, GraphNode>(),
        internalConnections: new Map<string, Connection>(),
        specialNodes: [],
        showEmptyInputPorts: false,
        showEmptyOutputPorts: false,
    };
}

/**
 * Keyboard internal structure:
 * - Single keyboard-visual node with 30 per-key output ports
 * - Single output-panel node with 4 labeled ports (Row 1, Row 2, Row 3, Pedal)
 * - Pre-wired connections from each key port to its corresponding port on the output panel
 */
function createKeyboardInternals(): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();
    const specialNodes: string[] = [];

    // Keyboard-visual node ports (30 per-key outputs)
    const keyboardVisualPorts = [
        // Row 1 (Q-P): 10 keys
        { id: 'key-q', name: 'Q', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.05 } },
        { id: 'key-w', name: 'W', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.07 } },
        { id: 'key-e', name: 'E', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.09 } },
        { id: 'key-r', name: 'R', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.11 } },
        { id: 'key-t', name: 'T', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.13 } },
        { id: 'key-y', name: 'Y', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.15 } },
        { id: 'key-u', name: 'U', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.17 } },
        { id: 'key-i', name: 'I', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.19 } },
        { id: 'key-o', name: 'O', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.21 } },
        { id: 'key-p', name: 'P', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.23 } },
        // Row 2 (A-L): 9 keys
        { id: 'key-a', name: 'A', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.30 } },
        { id: 'key-s', name: 'S', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.32 } },
        { id: 'key-d', name: 'D', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.34 } },
        { id: 'key-f', name: 'F', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.36 } },
        { id: 'key-g', name: 'G', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.38 } },
        { id: 'key-h', name: 'H', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.40 } },
        { id: 'key-j', name: 'J', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.42 } },
        { id: 'key-k', name: 'K', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.44 } },
        { id: 'key-l', name: 'L', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.46 } },
        // Row 3 (Z-/): 10 keys
        { id: 'key-z', name: 'Z', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.53 } },
        { id: 'key-x', name: 'X', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.55 } },
        { id: 'key-c', name: 'C', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.57 } },
        { id: 'key-v', name: 'V', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.59 } },
        { id: 'key-b', name: 'B', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.61 } },
        { id: 'key-n', name: 'N', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.63 } },
        { id: 'key-m', name: 'M', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.65 } },
        { id: 'key-comma', name: ',', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.67 } },
        { id: 'key-period', name: '.', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.69 } },
        { id: 'key-slash', name: '/', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.71 } },
        // Spacebar
        { id: 'key-space', name: 'Space', type: 'control' as const, direction: 'output' as const, position: { x: 1, y: 0.85 } }
    ];

    // Position constants
    const keyboardX = 100;
    const keyboardY = 100;
    const outputPanelX = 900;
    const outputPanelY = 100;

    // Create single keyboard-visual node
    const keyboardVisualId = generateUniqueId('keyboard-visual-');
    const keyboardVisual: GraphNode = {
        id: keyboardVisualId,
        type: 'keyboard-visual',
        category: 'input',
        position: { x: keyboardX, y: keyboardY },
        data: {},
        ports: keyboardVisualPorts,
        parentId: null,  // Will be set by addNode
        childIds: []
    };
    internalNodes.set(keyboardVisualId, keyboardVisual);
    // NOT added to specialNodes - doesn't appear on parent

    // Create single output-panel node with 4 ports
    const outputPanelId = generateUniqueId('output-panel-');
    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: { x: outputPanelX, y: outputPanelY },
        data: {
            portLabels: {
                'port-1': 'Row 1',
                'port-2': 'Row 2',
                'port-3': 'Row 3',
                'port-4': 'Pedal'
            }
        },
        ports: [
            { id: 'port-1', name: 'Row 1', type: 'control', direction: 'input', position: { x: 0, y: 0.15 } },
            { id: 'port-2', name: 'Row 2', type: 'control', direction: 'input', position: { x: 0, y: 0.38 } },
            { id: 'port-3', name: 'Row 3', type: 'control', direction: 'input', position: { x: 0, y: 0.61 } },
            { id: 'port-4', name: 'Pedal', type: 'control', direction: 'input', position: { x: 0, y: 0.84 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(outputPanelId, outputPanel);
    specialNodes.push(outputPanelId);  // Added to specialNodes so its ports sync to parent

    // Create input-panel node with one empty placeholder port (for receiving external signals)
    const inputPanelId = generateUniqueId('input-panel-');
    const emptyInputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: { x: keyboardX - 200, y: keyboardY },  // Left of keyboard
        data: {
            portLabels: {
                [emptyInputPortId]: ''  // Empty name for placeholder port
            },
            portHideExternalLabel: {
                [emptyInputPortId]: true  // Hide empty slot on parent
            }
        },
        ports: [
            { id: emptyInputPortId, name: '', type: 'control', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(inputPanelId, inputPanel);
    specialNodes.push(inputPanelId);  // Added to specialNodes so its ports sync to parent

    // Key port to output panel port mapping
    const row1Keys = ['key-q', 'key-w', 'key-e', 'key-r', 'key-t', 'key-y', 'key-u', 'key-i', 'key-o', 'key-p'];
    const row2Keys = ['key-a', 'key-s', 'key-d', 'key-f', 'key-g', 'key-h', 'key-j', 'key-k', 'key-l'];
    const row3Keys = ['key-z', 'key-x', 'key-c', 'key-v', 'key-b', 'key-n', 'key-m', 'key-comma', 'key-period', 'key-slash'];

    // Create connections from keyboard-visual key ports to output panel ports
    row1Keys.forEach(keyPortId => {
        const connId = generateUniqueId('conn-');
        internalConnections.set(connId, {
            id: connId,
            sourceNodeId: keyboardVisualId,
            sourcePortId: keyPortId,
            targetNodeId: outputPanelId,
            targetPortId: 'port-1',  // Row 1 port
            type: 'control'
        });
    });

    row2Keys.forEach(keyPortId => {
        const connId = generateUniqueId('conn-');
        internalConnections.set(connId, {
            id: connId,
            sourceNodeId: keyboardVisualId,
            sourcePortId: keyPortId,
            targetNodeId: outputPanelId,
            targetPortId: 'port-2',  // Row 2 port
            type: 'control'
        });
    });

    row3Keys.forEach(keyPortId => {
        const connId = generateUniqueId('conn-');
        internalConnections.set(connId, {
            id: connId,
            sourceNodeId: keyboardVisualId,
            sourcePortId: keyPortId,
            targetNodeId: outputPanelId,
            targetPortId: 'port-3',  // Row 3 port
            type: 'control'
        });
    });

    // Connect spacebar to pedal port
    const spaceConnId = generateUniqueId('conn-');
    internalConnections.set(spaceConnId, {
        id: spaceConnId,
        sourceNodeId: keyboardVisualId,
        sourcePortId: 'key-space',
        targetNodeId: outputPanelId,
        targetPortId: 'port-4',  // Pedal port
        type: 'control'
    });

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: false,   // Only show ports with connections
        showEmptyOutputPorts: false   // Only show ports with connections
    };
}

/**
 * Instrument internal structure:
 * - Input panel for bundle inputs (from keyboard rows)
 * - Instrument visual node showing row configuration
 * - Output panel with audio output
 * - Connections: input-panel -> instrument-visual -> output-panel
 */
function createInstrumentInternals(): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();
    const specialNodes: string[] = [];

    // Create input-panel with one empty placeholder port
    // When bundles connect, this will expand dynamically
    const inputPanelId = generateUniqueId('input-panel-');
    const emptyInputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: { x: 50, y: 150 },
        data: {
            portLabels: {
                [emptyInputPortId]: ''  // Empty label for placeholder
            },
            portHideExternalLabel: {
                [emptyInputPortId]: true  // Hide the empty label on parent
            }
        },
        ports: [
            { id: emptyInputPortId, name: '', type: 'control', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(inputPanelId, inputPanel);
    specialNodes.push(inputPanelId);

    // Create instrument-visual node in the center
    // This is purely for internal visualization - NOT a special node
    // Its ports should not sync to the parent
    // Key input ports are added dynamically when bundles connect
    const instrumentVisualId = generateUniqueId('instrument-visual-');
    const instrumentVisual: GraphNode = {
        id: instrumentVisualId,
        type: 'instrument-visual',
        category: 'instruments',
        position: { x: 250, y: 100 },
        data: {},
        ports: [
            // Only audio output - key input ports are added dynamically per bundle
            { id: 'audio-out', name: 'Audio', type: 'audio', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(instrumentVisualId, instrumentVisual);
    // NOT added to specialNodes - this is internal visualization only

    // Create output-panel with audio output
    const outputPanelId = generateUniqueId('output-panel-');
    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: { x: 800, y: 150 },
        data: {
            portLabels: {
                'audio-out': 'Audio'
            }
        },
        ports: [
            { id: 'audio-out', name: 'Audio', type: 'audio', direction: 'input', position: { x: 0, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(outputPanelId, outputPanel);
    specialNodes.push(outputPanelId);

    // NOTE: No default input-panel → instrument-visual connection
    // Bundle connections are wired dynamically in graphStore.ts when bundles connect

    // Create connection: instrument-visual -> output-panel
    const conn2Id = generateUniqueId('conn-');
    internalConnections.set(conn2Id, {
        id: conn2Id,
        sourceNodeId: instrumentVisualId,
        sourcePortId: 'audio-out',
        targetNodeId: outputPanelId,
        targetPortId: 'audio-out',
        type: 'audio'
    });

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: true,    // Show empty input placeholder
        showEmptyOutputPorts: true    // Always show audio output
    };
}

/**
 * Generic node internal structure:
 * - 1 Input node
 * - 1 Output node
 * - No pre-wired connections
 */
function createGenericInternals(): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();  // Changed from Array to Map
    const specialNodes: string[] = [];

    // Create Input node
    const inputNodeId = generateUniqueId('canvas-input-');
    const inputNode: GraphNode = {
        id: inputNodeId,
        type: 'canvas-input',
        category: 'routing',
        position: { x: 200, y: 300 },
        data: { portName: 'In' },
        ports: [
            { id: 'out', name: 'Out', type: 'control', direction: 'output' }
        ],
        parentId: null,  // Will be set by addNode
        childIds: []
    };
    internalNodes.set(inputNodeId, inputNode);
    specialNodes.push(inputNodeId);

    // Create Output node
    const outputNodeId = generateUniqueId('canvas-output-');
    const outputNode: GraphNode = {
        id: outputNodeId,
        type: 'canvas-output',
        category: 'routing',
        position: { x: 600, y: 300 },
        data: { portName: 'Out' },
        ports: [
            { id: 'in', name: 'In', type: 'control', direction: 'input' }
        ],
        parentId: null,  // Will be set by addNode
        childIds: []
    };
    internalNodes.set(outputNodeId, outputNode);
    specialNodes.push(outputNodeId);

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: false,   // Hide until connected
        showEmptyOutputPorts: false   // Hide until connected
    };
}

/**
 * Container node internal structure:
 * - Input panel with 2 ports (becomes 2 inputs on parent's left side)
 * - Output panel with 1 port (becomes 1 output on parent's right side)
 * - No pre-wired connections (user builds inside)
 */
function createContainerInternals(): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();
    const specialNodes: string[] = [];

    // Create Input panel with 2 ports + empty slot
    const inputPanelId = generateUniqueId('input-panel-');
    const emptyInputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: { x: 150, y: 200 },
        data: {
            portLabels: {
                'port-1': 'In 1',
                'port-2': 'In 2',
                [emptyInputPortId]: ''
            },
            portHideExternalLabel: {
                [emptyInputPortId]: true  // Hide empty slot on parent
            }
        },
        ports: [
            { id: 'port-1', name: 'In 1', type: 'universal', direction: 'output', position: { x: 1, y: 0.25 } },
            { id: 'port-2', name: 'In 2', type: 'universal', direction: 'output', position: { x: 1, y: 0.5 } },
            { id: emptyInputPortId, name: '', type: 'control', direction: 'output', position: { x: 1, y: 0.85 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(inputPanelId, inputPanel);
    specialNodes.push(inputPanelId);

    // Create Output panel with 1 port + empty slot
    const outputPanelId = generateUniqueId('output-panel-');
    const emptyOutputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: { x: 650, y: 200 },
        data: {
            portLabels: {
                'port-1': 'Out',
                [emptyOutputPortId]: ''
            },
            portHideExternalLabel: {
                [emptyOutputPortId]: true  // Hide empty slot on parent
            }
        },
        ports: [
            { id: 'port-1', name: 'Out', type: 'universal', direction: 'input', position: { x: 0, y: 0.35 } },
            { id: emptyOutputPortId, name: '', type: 'control', direction: 'input', position: { x: 0, y: 0.85 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(outputPanelId, outputPanel);
    specialNodes.push(outputPanelId);

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: true,    // Show inputs (users need to see them to connect)
        showEmptyOutputPorts: true    // Show outputs (users need to see them to connect)
    };
}

/**
 * MIDI device internal structure:
 * - midi-visual node showing device controls (keys, pads, knobs, faders)
 * - output-panel with bundled outputs:
 *   - Keys bundle (all keyboard notes)
 *   - Pads bundle (drum pads)
 *   - Knobs bundle (all CC knobs)
 *   - Faders bundle (all CC faders)
 *   - Pitch Bend (single)
 *   - Mod Wheel (single)
 * - input-panel for external control (future use)
 */
function createMIDIInternals(parentNode: GraphNode): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();
    const specialNodes: string[] = [];

    // Get preset from node data
    const data = parentNode.data as MIDIInputNodeData;
    const registry = getPresetRegistry();
    const preset = data.presetId ? registry.getPreset(data.presetId) : registry.getPreset('generic');

    // Build ports dynamically from preset
    const midiVisualPorts: Array<{
        id: string;
        name: string;
        type: 'control' | 'audio' | 'universal';
        direction: 'input' | 'output';
        position?: { x: number; y: number };
    }> = [];

    // Track sections for output panel
    let hasKeys = false;
    let hasPads = false;
    let hasKnobs = false;
    let hasFaders = false;
    let hasPitchBend = false;
    let hasModWheel = false;

    if (preset?.controls) {
        // Keys - create per-key output ports
        if (preset.controls.keys) {
            hasKeys = true;
            const keyRange = preset.controls.keys.range || preset.controls.keys.noteRange || [0, 127];
            const noteCount = keyRange[1] - keyRange[0] + 1;
            for (let i = 0; i < noteCount; i++) {
                const note = keyRange[0] + i;
                const y = 0.05 + (i / noteCount) * 0.3;  // Spread across 30% of height
                midiVisualPorts.push({
                    id: `key-${note}`,
                    name: `Note ${note}`,
                    type: 'control',
                    direction: 'output',
                    position: { x: 1, y }
                });
            }
        }

        // Pads - create per-pad output ports
        if (preset.controls.pads && preset.controls.pads.length > 0) {
            hasPads = true;
            preset.controls.pads.forEach((pad, idx) => {
                const y = 0.4 + (idx / preset.controls.pads!.length) * 0.15;
                midiVisualPorts.push({
                    id: `pad-${pad.id || idx}`,
                    name: pad.name || `Pad ${idx + 1}`,
                    type: 'control',
                    direction: 'output',
                    position: { x: 1, y }
                });
            });
        }

        // Knobs - create per-knob output ports
        if (preset.controls.knobs && preset.controls.knobs.length > 0) {
            hasKnobs = true;
            preset.controls.knobs.forEach((knob, idx) => {
                const y = 0.6 + (idx / preset.controls.knobs!.length) * 0.1;
                midiVisualPorts.push({
                    id: `knob-${knob.id || idx}`,
                    name: knob.name || `Knob ${idx + 1}`,
                    type: 'control',
                    direction: 'output',
                    position: { x: 1, y }
                });
            });
        }

        // Faders - create per-fader output ports
        if (preset.controls.faders && preset.controls.faders.length > 0) {
            hasFaders = true;
            preset.controls.faders.forEach((fader, idx) => {
                const y = 0.75 + (idx / preset.controls.faders!.length) * 0.1;
                midiVisualPorts.push({
                    id: `fader-${fader.id || idx}`,
                    name: fader.name || `Fader ${idx + 1}`,
                    type: 'control',
                    direction: 'output',
                    position: { x: 1, y }
                });
            });
        }

        // Pitch Bend
        if (preset.controls.pitchBend) {
            hasPitchBend = true;
            midiVisualPorts.push({
                id: 'pitch-bend',
                name: 'Pitch Bend',
                type: 'control',
                direction: 'output',
                position: { x: 1, y: 0.88 }
            });
        }

        // Mod Wheel
        if (preset.controls.modWheel) {
            hasModWheel = true;
            midiVisualPorts.push({
                id: 'mod-wheel',
                name: 'Mod Wheel',
                type: 'control',
                direction: 'output',
                position: { x: 1, y: 0.92 }
            });
        }
    }

    // Position constants
    const midiVisualX = 100;
    const midiVisualY = 100;
    const outputPanelX = 700;
    const outputPanelY = 100;

    // Create midi-visual node
    const midiVisualId = generateUniqueId('midi-visual-');
    const midiVisual: GraphNode = {
        id: midiVisualId,
        type: 'midi-visual',
        category: 'input',
        position: { x: midiVisualX, y: midiVisualY },
        data: { presetId: data.presetId },
        ports: midiVisualPorts,
        parentId: null,  // Will be set by addNode
        childIds: []
    };
    internalNodes.set(midiVisualId, midiVisual);
    // NOT added to specialNodes - doesn't appear on parent

    // Build output panel ports based on what's available
    const outputPanelPorts: Array<{
        id: string;
        name: string;
        type: 'control' | 'audio' | 'universal';
        direction: 'input' | 'output';
        position?: { x: number; y: number };
    }> = [];
    const portLabels: Record<string, string> = {};
    let portIndex = 0;

    if (hasKeys) {
        outputPanelPorts.push({
            id: 'bundle-keys',
            name: 'Keys',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.15 + portIndex * 0.12 }
        });
        portLabels['bundle-keys'] = 'Keys';
        portIndex++;
    }

    if (hasPads) {
        outputPanelPorts.push({
            id: 'bundle-pads',
            name: 'Pads',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.15 + portIndex * 0.12 }
        });
        portLabels['bundle-pads'] = 'Pads';
        portIndex++;
    }

    if (hasKnobs) {
        outputPanelPorts.push({
            id: 'bundle-knobs',
            name: 'Knobs',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.15 + portIndex * 0.12 }
        });
        portLabels['bundle-knobs'] = 'Knobs';
        portIndex++;
    }

    if (hasFaders) {
        outputPanelPorts.push({
            id: 'bundle-faders',
            name: 'Faders',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.15 + portIndex * 0.12 }
        });
        portLabels['bundle-faders'] = 'Faders';
        portIndex++;
    }

    if (hasPitchBend) {
        outputPanelPorts.push({
            id: 'pitch-bend-out',
            name: 'Pitch Bend',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.15 + portIndex * 0.12 }
        });
        portLabels['pitch-bend-out'] = 'Pitch Bend';
        portIndex++;
    }

    if (hasModWheel) {
        outputPanelPorts.push({
            id: 'mod-wheel-out',
            name: 'Mod Wheel',
            type: 'control',
            direction: 'input',
            position: { x: 0, y: 0.15 + portIndex * 0.12 }
        });
        portLabels['mod-wheel-out'] = 'Mod Wheel';
        portIndex++;
    }

    // Create output-panel node with bundled ports
    const outputPanelId = generateUniqueId('output-panel-');
    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: { x: outputPanelX, y: outputPanelY },
        data: { portLabels },
        ports: outputPanelPorts,
        parentId: null,
        childIds: []
    };
    internalNodes.set(outputPanelId, outputPanel);
    specialNodes.push(outputPanelId);  // Added to specialNodes so its ports sync to parent

    // Create input-panel node for external control (future use)
    const inputPanelId = generateUniqueId('input-panel-');
    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: { x: midiVisualX - 200, y: midiVisualY },
        data: {
            portLabels: {
                'port-1': ''  // Empty name for placeholder port
            }
        },
        ports: [
            { id: 'port-1', name: '', type: 'control', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(inputPanelId, inputPanel);
    specialNodes.push(inputPanelId);

    // Create connections from midi-visual ports to output panel bundles
    // Keys bundle
    if (hasKeys && preset?.controls.keys) {
        const keyRange = preset.controls.keys.range || preset.controls.keys.noteRange || [0, 127];
        for (let i = keyRange[0]; i <= keyRange[1]; i++) {
            const connId = generateUniqueId('conn-');
            internalConnections.set(connId, {
                id: connId,
                sourceNodeId: midiVisualId,
                sourcePortId: `key-${i}`,
                targetNodeId: outputPanelId,
                targetPortId: 'bundle-keys',
                type: 'control'
            });
        }
    }

    // Pads bundle
    if (hasPads && preset?.controls.pads) {
        preset.controls.pads.forEach((pad, idx) => {
            const connId = generateUniqueId('conn-');
            internalConnections.set(connId, {
                id: connId,
                sourceNodeId: midiVisualId,
                sourcePortId: `pad-${pad.id || idx}`,
                targetNodeId: outputPanelId,
                targetPortId: 'bundle-pads',
                type: 'control'
            });
        });
    }

    // Knobs bundle
    if (hasKnobs && preset?.controls.knobs) {
        preset.controls.knobs.forEach((knob, idx) => {
            const connId = generateUniqueId('conn-');
            internalConnections.set(connId, {
                id: connId,
                sourceNodeId: midiVisualId,
                sourcePortId: `knob-${knob.id || idx}`,
                targetNodeId: outputPanelId,
                targetPortId: 'bundle-knobs',
                type: 'control'
            });
        });
    }

    // Faders bundle
    if (hasFaders && preset?.controls.faders) {
        preset.controls.faders.forEach((fader, idx) => {
            const connId = generateUniqueId('conn-');
            internalConnections.set(connId, {
                id: connId,
                sourceNodeId: midiVisualId,
                sourcePortId: `fader-${fader.id || idx}`,
                targetNodeId: outputPanelId,
                targetPortId: 'bundle-faders',
                type: 'control'
            });
        });
    }

    // Pitch Bend
    if (hasPitchBend) {
        const connId = generateUniqueId('conn-');
        internalConnections.set(connId, {
            id: connId,
            sourceNodeId: midiVisualId,
            sourcePortId: 'pitch-bend',
            targetNodeId: outputPanelId,
            targetPortId: 'pitch-bend-out',
            type: 'control'
        });
    }

    // Mod Wheel
    if (hasModWheel) {
        const connId = generateUniqueId('conn-');
        internalConnections.set(connId, {
            id: connId,
            sourceNodeId: midiVisualId,
            sourcePortId: 'mod-wheel',
            targetNodeId: outputPanelId,
            targetPortId: 'mod-wheel-out',
            type: 'control'
        });
    }

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: false,   // Only show ports with connections
        showEmptyOutputPorts: false   // Only show ports with connections
    };
}

/**
 * MiniLab 3 internal structure:
 * - minilab3-visual node with 48 per-control output ports
 * - output-panel with "Keys" bundle port (only keys connected by default)
 * - input-panel for external control (future use)
 *
 * Default connections: Only the 25 piano keys are connected to the Keys bundle.
 * Pads, knobs, faders, and touch strips have visible ports but NO default connections.
 * Users can manually wire them as needed.
 */
function createMiniLab3Internals(parentNode: GraphNode): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();
    const specialNodes: string[] = [];

    // Get device ID from parent node data
    const data = parentNode.data as MIDIInputNodeData;

    // Position constants
    const visualX = 100;
    const visualY = 100;
    const outputPanelX = 850;
    const outputPanelY = 100;

    // All 48 control ports with positions matching the visual layout
    const minilab3VisualPorts = [
        // Touch strips (left side) - ports UNDER the strips
        { id: 'pitch-bend', name: 'Pitch', type: 'control' as const, direction: 'output' as const, position: { x: 0.055, y: 0.52 } },
        { id: 'mod-wheel', name: 'Mod', type: 'control' as const, direction: 'output' as const, position: { x: 0.095, y: 0.52 } },

        // Knobs - 2 rows of 4 (ports below each knob)
        { id: 'knob-1', name: 'K1', type: 'control' as const, direction: 'output' as const, position: { x: 0.38, y: 0.22 } },
        { id: 'knob-2', name: 'K2', type: 'control' as const, direction: 'output' as const, position: { x: 0.44, y: 0.22 } },
        { id: 'knob-3', name: 'K3', type: 'control' as const, direction: 'output' as const, position: { x: 0.50, y: 0.22 } },
        { id: 'knob-4', name: 'K4', type: 'control' as const, direction: 'output' as const, position: { x: 0.56, y: 0.22 } },
        { id: 'knob-5', name: 'K5', type: 'control' as const, direction: 'output' as const, position: { x: 0.38, y: 0.34 } },
        { id: 'knob-6', name: 'K6', type: 'control' as const, direction: 'output' as const, position: { x: 0.44, y: 0.34 } },
        { id: 'knob-7', name: 'K7', type: 'control' as const, direction: 'output' as const, position: { x: 0.50, y: 0.34 } },
        { id: 'knob-8', name: 'K8', type: 'control' as const, direction: 'output' as const, position: { x: 0.56, y: 0.34 } },

        // Faders - 4 vertical sliders (ports below each fader)
        { id: 'fader-1', name: 'F1', type: 'control' as const, direction: 'output' as const, position: { x: 0.72, y: 0.34 } },
        { id: 'fader-2', name: 'F2', type: 'control' as const, direction: 'output' as const, position: { x: 0.80, y: 0.34 } },
        { id: 'fader-3', name: 'F3', type: 'control' as const, direction: 'output' as const, position: { x: 0.88, y: 0.34 } },
        { id: 'fader-4', name: 'F4', type: 'control' as const, direction: 'output' as const, position: { x: 0.96, y: 0.34 } },

        // Pads - 8 horizontal (ports at bottom right of each pad)
        { id: 'pad-1', name: 'P1', type: 'control' as const, direction: 'output' as const, position: { x: 0.20, y: 0.55 } },
        { id: 'pad-2', name: 'P2', type: 'control' as const, direction: 'output' as const, position: { x: 0.30, y: 0.55 } },
        { id: 'pad-3', name: 'P3', type: 'control' as const, direction: 'output' as const, position: { x: 0.40, y: 0.55 } },
        { id: 'pad-4', name: 'P4', type: 'control' as const, direction: 'output' as const, position: { x: 0.50, y: 0.55 } },
        { id: 'pad-5', name: 'P5', type: 'control' as const, direction: 'output' as const, position: { x: 0.60, y: 0.55 } },
        { id: 'pad-6', name: 'P6', type: 'control' as const, direction: 'output' as const, position: { x: 0.70, y: 0.55 } },
        { id: 'pad-7', name: 'P7', type: 'control' as const, direction: 'output' as const, position: { x: 0.80, y: 0.55 } },
        { id: 'pad-8', name: 'P8', type: 'control' as const, direction: 'output' as const, position: { x: 0.90, y: 0.55 } },

        // Keys - 25 keys (C3-C5, notes 48-72) - ports at bottom of each key
        // White keys at y: 0.95, black keys at y: 0.80
        { id: 'key-48', name: 'C3', type: 'control' as const, direction: 'output' as const, position: { x: 0.14, y: 0.95 } },
        { id: 'key-49', name: 'C#3', type: 'control' as const, direction: 'output' as const, position: { x: 0.165, y: 0.80 } },
        { id: 'key-50', name: 'D3', type: 'control' as const, direction: 'output' as const, position: { x: 0.18, y: 0.95 } },
        { id: 'key-51', name: 'D#3', type: 'control' as const, direction: 'output' as const, position: { x: 0.205, y: 0.80 } },
        { id: 'key-52', name: 'E3', type: 'control' as const, direction: 'output' as const, position: { x: 0.22, y: 0.95 } },
        { id: 'key-53', name: 'F3', type: 'control' as const, direction: 'output' as const, position: { x: 0.26, y: 0.95 } },
        { id: 'key-54', name: 'F#3', type: 'control' as const, direction: 'output' as const, position: { x: 0.285, y: 0.80 } },
        { id: 'key-55', name: 'G3', type: 'control' as const, direction: 'output' as const, position: { x: 0.30, y: 0.95 } },
        { id: 'key-56', name: 'G#3', type: 'control' as const, direction: 'output' as const, position: { x: 0.325, y: 0.80 } },
        { id: 'key-57', name: 'A3', type: 'control' as const, direction: 'output' as const, position: { x: 0.34, y: 0.95 } },
        { id: 'key-58', name: 'A#3', type: 'control' as const, direction: 'output' as const, position: { x: 0.365, y: 0.80 } },
        { id: 'key-59', name: 'B3', type: 'control' as const, direction: 'output' as const, position: { x: 0.38, y: 0.95 } },
        { id: 'key-60', name: 'C4', type: 'control' as const, direction: 'output' as const, position: { x: 0.42, y: 0.95 } },
        { id: 'key-61', name: 'C#4', type: 'control' as const, direction: 'output' as const, position: { x: 0.445, y: 0.80 } },
        { id: 'key-62', name: 'D4', type: 'control' as const, direction: 'output' as const, position: { x: 0.46, y: 0.95 } },
        { id: 'key-63', name: 'D#4', type: 'control' as const, direction: 'output' as const, position: { x: 0.485, y: 0.80 } },
        { id: 'key-64', name: 'E4', type: 'control' as const, direction: 'output' as const, position: { x: 0.50, y: 0.95 } },
        { id: 'key-65', name: 'F4', type: 'control' as const, direction: 'output' as const, position: { x: 0.54, y: 0.95 } },
        { id: 'key-66', name: 'F#4', type: 'control' as const, direction: 'output' as const, position: { x: 0.565, y: 0.80 } },
        { id: 'key-67', name: 'G4', type: 'control' as const, direction: 'output' as const, position: { x: 0.58, y: 0.95 } },
        { id: 'key-68', name: 'G#4', type: 'control' as const, direction: 'output' as const, position: { x: 0.605, y: 0.80 } },
        { id: 'key-69', name: 'A4', type: 'control' as const, direction: 'output' as const, position: { x: 0.62, y: 0.95 } },
        { id: 'key-70', name: 'A#4', type: 'control' as const, direction: 'output' as const, position: { x: 0.645, y: 0.80 } },
        { id: 'key-71', name: 'B4', type: 'control' as const, direction: 'output' as const, position: { x: 0.66, y: 0.95 } },
        { id: 'key-72', name: 'C5', type: 'control' as const, direction: 'output' as const, position: { x: 0.70, y: 0.95 } },
    ];

    // Create minilab3-visual node
    const minilab3VisualId = generateUniqueId('minilab3-visual-');
    const minilab3Visual: GraphNode = {
        id: minilab3VisualId,
        type: 'minilab3-visual',
        category: 'input',
        position: { x: visualX, y: visualY },
        data: { deviceId: data.deviceId },
        ports: minilab3VisualPorts,
        parentId: null,  // Will be set by addNode
        childIds: []
    };
    internalNodes.set(minilab3VisualId, minilab3Visual);
    // NOT added to specialNodes - doesn't appear on parent

    // Create output-panel with "Keys" bundle port + empty slot for adding new outputs
    const outputPanelId = generateUniqueId('output-panel-');
    const emptyOutputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: { x: outputPanelX, y: outputPanelY },
        data: {
            portLabels: {
                'bundle-keys': 'Keys',
                [emptyOutputPortId]: ''  // Empty slot for adding new outputs
            },
            portHideExternalLabel: {
                [emptyOutputPortId]: true  // Hide empty slot on parent
            }
        },
        ports: [
            { id: 'bundle-keys', name: 'Keys', type: 'control', direction: 'input', position: { x: 0, y: 0.3 } },
            { id: emptyOutputPortId, name: '', type: 'control', direction: 'input', position: { x: 0, y: 0.9 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(outputPanelId, outputPanel);
    specialNodes.push(outputPanelId);  // Added to specialNodes so its ports sync to parent

    // Create input-panel node for external control (future use)
    const inputPanelId = generateUniqueId('input-panel-');
    const emptyInputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: { x: visualX - 200, y: visualY },
        data: {
            portLabels: {
                [emptyInputPortId]: ''  // Empty name for placeholder port
            },
            portHideExternalLabel: {
                [emptyInputPortId]: true  // Hide empty slot on parent
            }
        },
        ports: [
            { id: emptyInputPortId, name: '', type: 'control', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(inputPanelId, inputPanel);
    specialNodes.push(inputPanelId);

    // Create default connections: ONLY keys connect to output panel
    // Pads, knobs, faders, and touch strips have ports but NO default connections
    for (let note = 48; note <= 72; note++) {
        const connId = generateUniqueId('conn-');
        internalConnections.set(connId, {
            id: connId,
            sourceNodeId: minilab3VisualId,
            sourcePortId: `key-${note}`,
            targetNodeId: outputPanelId,
            targetPortId: 'bundle-keys',
            type: 'control'
        });
    }

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: false,   // Only show ports with connections
        showEmptyOutputPorts: false   // Only show ports with connections
    };
}

/**
 * Sampler internal structure:
 * - Input panel for bundle inputs (from keyboard rows) and sample input
 * - Sampler configuration node (internal visualization)
 * - Output panel with audio output
 *
 * Similar to instrument nodes but with sample input capability
 */
function createSamplerInternals(): InternalStructure {
    const internalNodes = new Map<string, GraphNode>();
    const internalConnections = new Map<string, Connection>();
    const specialNodes: string[] = [];

    // Create input-panel with one empty placeholder port
    // When bundles connect, this will expand dynamically (same pattern as instrument)
    const inputPanelId = generateUniqueId('input-panel-');
    const emptyInputPortId = generateUniqueId(EMPTY_PORT_PREFIX);
    const inputPanel: GraphNode = {
        id: inputPanelId,
        type: 'input-panel',
        category: 'routing',
        position: { x: 50, y: 150 },
        data: {
            portLabels: {
                [emptyInputPortId]: ''  // Empty label for placeholder
            },
            portHideExternalLabel: {
                [emptyInputPortId]: true  // Hide the empty label on parent
            }
        },
        ports: [
            { id: emptyInputPortId, name: '', type: 'control', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(inputPanelId, inputPanel);
    specialNodes.push(inputPanelId);

    // Create sampler-visual node in the center
    // This is purely for internal visualization - NOT a special node
    // Its ports should not sync to the parent
    // Key input ports are added dynamically when bundles connect
    const samplerVisualId = generateUniqueId('sampler-visual-');
    const samplerVisual: GraphNode = {
        id: samplerVisualId,
        type: 'sampler-visual',
        category: 'instruments',
        position: { x: 250, y: 100 },
        data: {},  // Inherits from parent sampler node via parentId
        ports: [
            // Only audio output - key input ports are added dynamically per bundle
            { id: 'audio-out', name: 'Audio', type: 'audio', direction: 'output', position: { x: 1, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(samplerVisualId, samplerVisual);
    // NOT added to specialNodes - this is internal visualization only

    // Create output-panel with audio output
    const outputPanelId = generateUniqueId('output-panel-');
    const outputPanel: GraphNode = {
        id: outputPanelId,
        type: 'output-panel',
        category: 'routing',
        position: { x: 800, y: 150 },
        data: {
            portLabels: {
                'audio-out': 'Audio'
            }
        },
        ports: [
            { id: 'audio-out', name: 'Audio', type: 'audio', direction: 'input', position: { x: 0, y: 0.5 } }
        ],
        parentId: null,
        childIds: []
    };
    internalNodes.set(outputPanelId, outputPanel);
    specialNodes.push(outputPanelId);

    // NOTE: No default input-panel → sampler-visual connection
    // Bundle connections are wired dynamically in graphStore.ts when bundles connect

    // Create connection: sampler-visual -> output-panel
    const conn2Id = generateUniqueId('conn-');
    internalConnections.set(conn2Id, {
        id: conn2Id,
        sourceNodeId: samplerVisualId,
        sourcePortId: 'audio-out',
        targetNodeId: outputPanelId,
        targetPortId: 'audio-out',
        type: 'audio'
    });

    return {
        internalNodes,
        internalConnections,
        specialNodes,
        showEmptyInputPorts: true,    // Show empty input placeholder
        showEmptyOutputPorts: true    // Always show audio output
    };
}
