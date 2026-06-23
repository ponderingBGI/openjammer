/**
 * OpenJammer - Core Type Definitions
 * 
 * This file defines all the core types for the node graph system.
 * Connection types are color-coded and directional/bidirectional.
 */

// ============================================================================
// Connection Types
// ============================================================================

export type ConnectionType = 'audio' | 'control' | 'universal';

export interface PortDefinition {
    id: string;
    name: string;
    type: ConnectionType;
    direction: 'input' | 'output';
    isBundled?: boolean; // True if this port represents multiple bundled signals

    // Fixed position (0-1 normalized, relative to node bounds)
    // If not specified, position is calculated from portLayout
    position?: { x: number; y: number };

    // For universal ports: what type they resolved to after connection
    resolvedType?: 'audio' | 'control' | null;

    // Hide label on parent node's external port (label still shows inside panel)
    // Default: false (labels are shown on parent)
    hideExternalLabel?: boolean;

    // GATED port: the surface is declared (so it can light up the moment its
    // routing lands) but is NOT wired to the engine yet, so connections to it are
    // REJECTED (canConnect) and the UI renders it visibly inert instead of
    // shipping a silently-dead port. `disabledReason` is the affordance copy shown
    // to the player. No built-in currently ships one — the affordance is kept for
    // future nodes whose routing is staged behind the kernel.
    // Default: false (the port is live).
    disabled?: boolean;
    disabledReason?: string;
}

// Port layout configuration for dynamic port positioning
export interface PortLayoutConfig {
    direction?: 'vertical' | 'horizontal';  // Default: 'vertical'

    // Spawn areas for dynamic ports (0-1 normalized coordinates)
    inputArea?: {
        x: number;       // X position (0 = left, 1 = right)
        startY: number;  // Start of vertical range
        endY: number;    // End of vertical range
    };
    outputArea?: {
        x: number;       // X position (0 = left, 1 = right)
        startY: number;  // Start of vertical range
        endY: number;    // End of vertical range
    };
}

export interface KeyMapping {
    keyId: string;             // 'key-q', 'key-w', etc.
    sourcePort: string;        // which key port it comes from
    note?: string;             // 'C4', 'D4', etc. (for custom mapping)
    targetChannel?: number;    // which channel in the bundle (0-29)
    enabled: boolean;          // can disable individual keys
}

// ============================================================================
// Bundle Types - For expandable/collapsible bundle connections
// ============================================================================

/**
 * Represents a single channel within a bundle
 * E.g., one key in a keyboard bundle or one knob in a controller bundle
 */
export interface BundleChannel {
    id: string;                // Unique channel ID within bundle
    label: string;             // Display label: "{ParentName} {InputType} {Number}"
    sourcePortId: string;      // Original port ID in source node (e.g., "key-48")
    sourceNodeId: string;      // ID of the source node
}

/**
 * Bundle information attached to a port
 * Used for collapsible/expandable bundle visualization
 */
export interface BundleInfo {
    /** Bundle identifier (matches the parent port ID) */
    bundleId: string;

    /** Display label for the bundle (e.g., "MiniLab3 Keys") */
    bundleLabel: string;

    /** Alias for bundleLabel - used by graphStore */
    label: string;

    /** Number of channels in the bundle */
    size: number;

    /** Source node information for label generation */
    sourceNodeName: string;    // e.g., "MiniLab3"
    sourceNodeType: string;    // e.g., "minilab-3"

    /** Individual channels in the bundle */
    channels: BundleChannel[];

    /** UI state: whether bundle is expanded to show individual channels */
    expanded: boolean;
}

/**
 * Extended port definition for bundle-aware ports
 */
export interface BundlePortDefinition extends PortDefinition {
    /** Bundle metadata - present only on bundle ports */
    bundleInfo?: BundleInfo;
}

export interface Connection {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    type: ConnectionType;

    // Bundled connection support
    isBundled?: boolean;        // true if this represents multiple signals
    bundleMapping?: KeyMapping[]; // only if isBundled=true
    signalValue?: number;       // 0-1 normalized value
}

// ============================================================================
// Node Types
// ============================================================================

export type NodeCategory =
    | 'instruments'
    | 'input'
    | 'effects'
    | 'routing'
    | 'output'
    | 'utility';

/**
 * How a node's control surface is presented (frozen v1, mirrors the manifest
 * `ui` facet). It is declared HERE — on the {@link NodeDefinition} — as the
 * SINGLE source of truth for whether a node owns a bespoke React component
 * (`'react'`, rendered by NodeWrapper's switch) or falls back to the FREE
 * AutoParamPanel (`'auto'`). The manifest's `ui` is DERIVED from this field, so
 * there is no second hand-maintained list to drift (was the old `REACT_UI` set).
 */
export type UiKind = 'auto' | 'react';

export type NodeType =
    | 'keyboard'
    | 'keyboard-key'    // Individual keyboard key (signal generator)
    | 'keyboard-visual' // Visual keyboard with per-key outputs (internal node)
    | 'instrument-visual' // Visual instrument with row configuration (internal node)
    | 'microphone'
    | 'midi'            // MIDI input device (generic)
    | 'midi-visual'     // Visual MIDI device representation (internal node)
    | 'minilab-3'       // Arturia MiniLab 3 with per-control outputs
    | 'minilab3-visual' // Visual MiniLab 3 with per-control outputs (internal node)
    | 'piano'
    | 'cello'
    | 'electricCello'
    | 'violin'
    | 'saxophone'
    | 'strings'
    | 'keys'
    | 'winds'
    | 'instrument' // Generic instrument node (uses instrumentId in data)
    | 'looper'
    | 'effect'
    | 'pan'             // Stereo panner (mono -> L/R; the first stereo built-in)
    | 'width'           // Stereo width / mid-side (the first stereo-IN built-in)
    | 'multiplier'
    | 'speaker'
    | 'recorder'
    | 'canvas-input'   // Input node (receives from parent level)
    | 'canvas-output'  // Output node (sends to parent level)
    | 'output-panel'   // Multi-port output panel with editable labels
    | 'input-panel'    // Multi-port input panel with editable labels
    | 'container'      // Empty container node for grouping
    | 'add'            // Addition node (mixes signals)
    | 'subtract'       // Subtraction node (phase cancellation)
    | 'library'        // Sample library node for local audio files
    | 'sampler'        // Pitch-shifting sampler instrument (outside view)
    | 'sampler-visual'; // Visual sampler with detailed controls (inside view)

// ============================================================================
// Plugin Identifiers (additive — see U10)
// ============================================================================

/**
 * Branded identifier for a registered node/plugin definition.
 *
 * This is introduced ADDITIVELY alongside {@link NodeType}: every PluginId is a
 * NodeType, but the brand lets call sites that have *validated* an id (via the
 * registry) carry that proof in the type system. Plain `NodeType` usages keep
 * compiling unchanged — `PluginId` is a structural subtype of `NodeType`.
 */
export type PluginId = NodeType & { readonly __brand: 'PluginId' };

/**
 * Canonical const-set of every known node/plugin id.
 *
 * Kept as a runtime array (not just a type) so the registry can validate
 * arbitrary strings at import/deserialization boundaries. The element type is
 * `NodeType`, so adding a value the union does not know about is a compile error.
 */
export const KNOWN_PLUGIN_IDS = [
    'keyboard',
    'keyboard-key',
    'keyboard-visual',
    'instrument-visual',
    'microphone',
    'midi',
    'midi-visual',
    'minilab-3',
    'minilab3-visual',
    'piano',
    'cello',
    'electricCello',
    'violin',
    'saxophone',
    'strings',
    'keys',
    'winds',
    'instrument',
    'looper',
    'effect',
    'pan',
    'width',
    'multiplier',
    'speaker',
    'recorder',
    'canvas-input',
    'canvas-output',
    'output-panel',
    'input-panel',
    'container',
    'add',
    'subtract',
    'library',
    'sampler',
    'sampler-visual'
] as const satisfies readonly NodeType[];

/**
 * Narrow an arbitrary value to a {@link PluginId} (i.e. a known node type).
 * Returns true only for strings present in {@link KNOWN_PLUGIN_IDS}.
 */
export function isPluginId(value: unknown): value is PluginId {
    return typeof value === 'string' &&
        (KNOWN_PLUGIN_IDS as readonly string[]).includes(value);
}

export interface Position {
    x: number;
    y: number;
}

export interface NodeData {
    // Common fields
    [key: string]: unknown;
}

/**
 * Instrument row configuration - represents a connected bundle from keyboard
 */
export interface InstrumentRow {
    rowId: string;           // Unique row identifier
    sourceNodeId: string;    // Which keyboard node this came from
    sourcePortId: string;    // Which keyboard port this came from (composite ID)
    targetPortId: string;    // Which instrument input port receives this bundle
    label: string;           // Auto-pulled from source ("Row 1", "Pedal", etc.)
    spread: number;          // Offset increment between ports (default 0.5)
    baseNote: number;        // 0-6 (C-B)
    baseOctave: number;      // 0-8
    baseOffset: number;      // -24 to +24 semitones
    portCount: number;       // Number of ports in this row
    keyGains: number[];      // Per-key gain values (length = portCount)
}

/**
 * Sampler row configuration - represents a connected bundle from keyboard
 * Simplified structure: each row has gain and spread controls
 */
export interface SamplerRow {
    rowId: string;           // Unique row identifier
    sourceNodeId: string;    // Which keyboard node this came from
    sourcePortId: string;    // Which keyboard port this came from (composite ID)
    targetPortId: string;    // Which sampler input port receives this bundle
    label: string;           // Auto-pulled from source ("Row 1", "Keys", etc.)
    portCount: number;       // Number of ports in this row
    gain: number;            // Per-row gain (0-2, default 1.0)
    spread: number;          // Per-row spread in semitones (default 1.0 = chromatic)
}

export interface InstrumentNodeData extends NodeData {
    instrumentId?: string; // ID from InstrumentDefinitions (optional, falls back to legacy type mapping)

    // NEW: Row-based structure for bundle connections
    rows?: InstrumentRow[];

    // Legacy fields (kept for backwards compatibility)
    offsets?: { [portId: string]: number }; // Per-input pitch offset (semitones)
    octaveOffsets?: { [portId: string]: number }; // Per-input octave adjustment
    noteOffsets?: { [portId: string]: number }; // Per-input note adjustment (0-6 for C-B)
    activeInputs?: string[]; // List of active input port IDs
    isLoading?: boolean; // For UI loading indicator
    // PERSIST-1 / ERR-1: set true by the executor when this node's built-in default
    // voice failed to load (a bad PCM build). Non-focus-stealing: drives a small "!"
    // badge on the node, never a modal/toast. Written outside any undo gesture.
    voiceLoadError?: boolean;
}

export interface KeyConfig {
    keyCode: string;           // 'q', 'w', 'KeyA', etc.
    note?: string;             // 'C4', 'D4', etc. (for custom mapping)
    octaveOffset?: number;     // octave adjustment
    velocity?: number;         // fixed velocity (0-1) for this key
    enabled: boolean;          // can disable individual keys
}

export interface KeyboardNodeData extends NodeData {
    assignedKey: number; // 2-9
    activeRow: number | null;
    rowOctaves: [number, number, number];
}

export interface MicrophoneNodeData extends NodeData {
    isMuted: boolean;
    isActive: boolean;
    deviceId?: string;
    lowLatencyMode?: boolean; // Override global setting per node
}

export interface LooperNodeData extends NodeData {
    duration: number; // in seconds, default 10
    isRecording: boolean;
    loops: LoopData[];
    currentTime: number;
    /** Loop-level wet gain (0..1): balances the summed loop layers against the
     *  live/dry signal — drives SetParam(WET) on the looper. Default 1. */
    loopVolume?: number;
}

export interface LoopData {
    id: string;
    buffer: ArrayBuffer | null;
    startTime: number;
    duration: number;
    isMuted: boolean;
    effects: string[]; // Effect node IDs applied to this loop
}

/**
 * Audio effect kinds an EffectNode can apply. Each lowers to a REAL ojcore DSP
 * primitive (see {@link EFFECT_KIND_BY_TYPE} in the emitter): distortion ->
 * Waveshaper, filter -> Biquad, reverb -> Convolution, delay -> Delay. The old
 * `pitch` option was removed — no pitch-shift primitive exists, so it was a dead
 * menu entry that silently no-op'd (honesty over a fictional control).
 */
export type EffectType = 'distortion' | 'filter' | 'reverb' | 'delay';

export interface EffectNodeData extends NodeData {
    effectType: EffectType;
    params: Record<string, number>;
}

export interface MultiplierNodeData extends NodeData {
    /** The on-node multiplier, used when the second input ('in-2') is unconnected.
     *  Floors at 0 (×0 mutes); no ceiling. When 'in-2' is wired, that signal is the
     *  multiplier instead and this value is overridden. */
    factor: number;
    /** Resolved wire type for the universal ports once connected (audio/control). */
    resolvedType?: 'audio' | 'control' | null;
}

export interface SpeakerNodeData extends NodeData {
    volume: number; // 0-1
    isMuted: boolean;
    deviceId: string; // ID of selected output device
    sinkIdApplied?: boolean; // Track if setSinkId succeeded
}

export interface RecorderNodeData extends NodeData {
    isRecording: boolean;
    recordings: RecordingData[];
}

export interface RecordingData {
    id: string;
    buffer: ArrayBuffer | null;
    duration: number;
    timestamp: number;
}

export interface LibraryItemRef {
    id: string;
    relativePath: string;
    displayName: string;
    libraryId: string;
}

// Keep old name as alias for backwards compatibility
export type LibrarySampleRef = LibraryItemRef;

export interface LibraryNodeData extends NodeData {
    // Library reference
    libraryId?: string;

    // Current item selection
    currentItemId?: string;

    // Items used in this node (for workflow persistence)
    itemRefs: LibraryItemRef[];

    // Playback mode
    playbackMode: 'oneshot' | 'loop' | 'hold';

    // Volume (0-1)
    volume: number;

    // Missing items detected on load
    missingItemIds?: string[];

    // Tag panel state
    separatorPosition?: number;  // Position of pinned/other tags separator (0-1)

    // Node resizing
    width?: number;
    height?: number;
}

export interface SamplerNodeData extends NodeData {
    // Sample reference
    sampleId: string | null;
    sampleName: string | null;

    // Visual data for waveform display
    waveformData?: number[];       // 50-point waveform peaks
    duration?: number;             // Sample duration in seconds

    // True when the persisted sampleId could not be re-resolved to PCM on the
    // last mount (file moved/deleted, permission revoked). Drives the ERR-1
    // non-modal "failed to load" slot so a broken sample is visually distinct
    // from an empty one. Cleared on any successful (re)load or clear.
    sampleLoadError?: boolean;

    // Core audio parameters
    rootNote: number;              // MIDI note (default: 60 = C4)
    gain: number;                  // Overall gain (0-2, default 1.0)
    spread: number;                // Semitones between keys (0-12, default 1.0)
    attack: number;                // Attack time in seconds (0.001-1, default 0.01)
    release: number;               // Release time in seconds (0.01-2, default 0.1)

    // Row-based structure for bundle connections
    rows?: SamplerRow[];
}

export interface MIDILearnedMapping {
    type: 'note' | 'cc' | 'pitchBend';
    channel: number;
    noteOrCC: number;  // Note number or CC number
}

/**
 * Stable device signature for MIDI device identification across sessions/machines.
 * Unlike deviceId which is volatile, this persists and enables auto-reconnection.
 */
export interface MIDIDeviceSignature {
    presetId: string;      // e.g., "arturia-minilab-3", "generic"
    deviceName: string;    // Auto-generated or user-customized: "MiniLab 3", "MiniLab 3 2"
}

export interface MIDIInputNodeData extends NodeData {
    // Volatile - set at runtime, cleared on save
    deviceId: string | null;           // Selected MIDI input device ID (runtime only)
    isConnected: boolean;              // Whether device is currently connected

    // Stable - persisted across sessions for auto-reconnection
    deviceSignature: MIDIDeviceSignature | null;  // Stable identifier for device matching
    presetId: string;                  // Preset ID (e.g., "arturia-minilab-3" or "generic")

    // MIDI channel configuration
    activeChannel: number;             // 0 = omni (all channels), 1-16 for specific

    // MIDI Learn state
    midiLearnMode: boolean;
    learnTarget: string | null;        // Port ID being learned
    learnedMappings: Record<string, MIDILearnedMapping>;
}

// ============================================================================
// Node Definition
// ============================================================================

export interface GraphNode {
    id: string;
    type: NodeType;
    category: NodeCategory;

    /**
     * OPEN node identity (M5), carried ALONGSIDE the closed {@link NodeType}.
     *
     * When present, this is the id of a DYNAMIC plugin (e.g. an AI-authored DSP
     * node, `"ai.dsp.<hash>"`) registered in the dynamic registry. The node's
     * DISPLAY / params / canEnter then resolve from that dynamic definition
     * (see `registry.resolveNodeDefinition`), while {@link type} stays a valid
     * NodeType (typically `'effect'`) so EXECUTION and SERIALIZATION are
     * unchanged. Absent for ordinary built-in nodes — their identity IS `type`.
     */
    pluginId?: string;

    position: Position;  // Position relative to parent's coordinate space
    data: NodeData;
    ports: PortDefinition[];

    // Normalized hierarchical structure (flat with references)
    parentId: string | null;  // null = root-level node, otherwise ID of parent node
    childIds: string[];       // IDs of child nodes (empty array if leaf node)
    specialNodes?: string[];  // IDs of special child nodes (canvas-input/output, undeletable)

    // Port visibility configuration (for hierarchical nodes)
    showEmptyInputPorts?: boolean;   // Show input-panel ports even if not connected
    showEmptyOutputPorts?: boolean;  // Show output-panel ports even if not connected

    // Per-node viewport state (preserved when navigating)
    internalViewport?: {
        pan: Position;
        zoom: number;
    };
}

// ============================================================================
// Graph State
// ============================================================================

export interface GraphState {
    nodes: Map<string, GraphNode>;           // ALL nodes at all levels (flat)
    connections: Map<string, Connection>;    // ALL connections at all levels (flat)
    rootNodeIds: string[];                   // IDs of top-level nodes (parentId === null)
    selectedNodeIds: Set<string>;
    selectedConnectionIds: Set<string>;
}

// ============================================================================
// Canvas State
// ============================================================================

export interface CanvasState {
    pan: Position;
    zoom: number;
    isDragging: boolean;
    isPanning: boolean;
    dragStart: Position | null;
}

// ============================================================================
// Workflow Serialization
// ============================================================================

export interface SerializedWorkflow {
    version: string;
    name: string;
    createdAt: string;
    nodes: SerializedNode[];
    connections: SerializedConnection[];
}

export interface SerializedNode {
    id: string;
    type: NodeType;
    category: NodeCategory;
    position: Position;
    data: NodeData;

    /**
     * OPEN node identity (M5) — the persisted twin of {@link GraphNode.pluginId}.
     * Optional for backwards compatibility with workflows saved before this field
     * existed. When present and NOT yet in the dynamic registry, import RE-REGISTERS
     * a dynamic definition from this node's serialized data so identity resolves
     * after a fresh load (see `serialization.importWorkflow`).
     */
    pluginId?: string;

    // Per-instance ports (U10). Optional for backwards compatibility with
    // workflows saved before this field existed — importers fall back to the
    // registry's static defaultPorts when absent.
    ports?: PortDefinition[];
}

export interface SerializedConnection {
    id: string;
    sourceNodeId: string;
    sourcePortId: string;
    targetNodeId: string;
    targetPortId: string;
    type: ConnectionType;

    // Bundled connection support (for serialization)
    isBundled?: boolean;
    bundleMapping?: KeyMapping[];
    signalValue?: number;
}

// ============================================================================
// Node Registry
// ============================================================================

export interface NodeDefinition {
    type: NodeType;
    category: NodeCategory;
    name: string;
    description: string;

    /**
     * SINGLE SOURCE OF TRUTH for the node's control surface (see {@link UiKind}).
     * `'react'` IFF NodeWrapper renders this type with a bespoke component (its
     * schematic switch OR the renderNodeContent switch); `'auto'` otherwise (the
     * FREE AutoParamPanel). The manifest's `ui` is derived from this — keep it in
     * lockstep with NodeWrapper (the node-registry gate enforces the equivalence).
     */
    ui: UiKind;

    defaultPorts: PortDefinition[];
    defaultData: NodeData;

    // Port layout configuration for this node type
    portLayout?: PortLayoutConfig;

    // Fixed dimensions (optional - for math-based port positioning)
    dimensions?: { width: number; height: number };

    // Whether this node can be entered with E key (default: true)
    // If false, pressing E will flash red instead of entering
    canEnter?: boolean;
}

// ============================================================================
// Audio Clip Types - Lightweight draggable audio references
// ============================================================================

/**
 * AudioClip - Lightweight audio reference with non-destructive crop region
 *
 * Unlike nodes, clips are simple visual elements that reference audio
 * stored in the sample library. Crop points are metadata only - the
 * original audio is never modified.
 *
 * Usage:
 * - Drag from LooperNode loops onto canvas
 * - Drag from LibraryNode samples onto canvas
 * - Drag clips into compatible drop target nodes
 * - Double-click to open waveform editor for cropping
 */
export interface AudioClip {
    id: string;

    // Reference to source audio in library
    sampleId: string;           // ID in libraryStore
    sampleName: string;         // Display name (filename)

    // Non-destructive crop region (in sample frames, not seconds)
    // This allows precise, sample-accurate cropping
    startFrame: number;         // Start point (0 = beginning)
    endFrame: number;           // End point (-1 = end of file)

    // Cached metadata for UI (derived from sample library)
    durationSeconds: number;    // Duration of cropped region
    sampleRate: number;         // For frame-to-time conversion

    // Waveform preview data (downsampled for mini display)
    waveformPeaks: number[];    // 64-128 values for mini waveform

    // Canvas position (null if not placed on canvas)
    position: Position | null;

    // Visual dimensions
    width: number;              // Default: 120px
    height: number;             // Default: 40px

    // Origin tracking
    sourceType: 'looper' | 'library' | 'imported';
    sourceNodeId?: string;      // If from looper/library node

    // Timestamps
    createdAt: number;
    lastModifiedAt: number;
}

/**
 * ClipDropTarget - Interface for nodes that can accept clip drops
 *
 * Any node can implement this interface to become a drop target for audio clips.
 * Register with audioClipStore.registerDropTarget() on mount, unregister on unmount.
 *
 * Example usage in a node component:
 * ```tsx
 * useEffect(() => {
 *     registerDropTarget({
 *         nodeId: node.id,
 *         targetName: 'Looper',
 *         onClipDrop: async (clip) => {
 *             const buffer = await loadClipAudio(clip);
 *             // Add as new loop layer
 *         },
 *         canAcceptClip: () => true,
 *         getDropZoneBounds: () => ref.current?.getBoundingClientRect() ?? null,
 *     });
 *     return () => unregisterDropTarget(node.id);
 * }, []);
 * ```
 */
export interface ClipDropTarget {
    /** Unique identifier for this drop target (node ID) */
    nodeId: string;

    /** Human-readable target name for UI feedback */
    targetName: string;

    /** Callback when clip is dropped onto this target */
    onClipDrop: (clip: AudioClip) => Promise<void>;

    /** Check if this target can accept the given clip */
    canAcceptClip: (clip: AudioClip) => boolean;

    /** Get drop zone bounds for hit testing during drag */
    getDropZoneBounds: () => DOMRect | null;
}

// ============================================================================
// Audio Engine Types
// ============================================================================

export interface AudioNodeWrapper {
    nodeId: string;
    inputNode: AudioNode | null;
    outputNode: AudioNode | null;
    internalNodes: AudioNode[];
}
