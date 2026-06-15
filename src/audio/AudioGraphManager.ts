/**
 * AudioGraphManager - Bridge between visual node graph and Web Audio API
 *
 * Watches graphStore for connection changes and creates corresponding Web Audio connections.
 * Handles hot-swapping during playback with gain ramping to prevent clicks.
 */

import { getAudioContext } from './AudioEngine';
import { getNoteName, getLegacyInstrumentId } from './Instruments';
import type { SampledInstrument } from './Instruments';
import { InstrumentLoader } from './Instruments';
import { createEffect, Effect } from './Effects';
import { Looper } from './Looper';
import { Recorder } from './Recorder';
import { LocalSampleAdapter } from './samplers/LocalSampleAdapter';
import { SamplerAdapter } from './samplers/SamplerAdapter';
import type { GraphNode, Connection, NodeType, EffectNodeData, AmplifierNodeData, SpeakerNodeData, InstrumentNodeData, InstrumentRow, LibraryNodeData, MIDIInputNodeData, SamplerNodeData, SamplerRow } from '../engine/types';
import { isInstrumentNodeData, isSamplerNodeData } from '../engine/typeGuards';
import { getMIDIManager, midiNoteToName, normalizeMIDIValue } from '../midi';
import type { MIDIEvent } from '../midi/types';
import { toast } from 'sonner';
import { useGraphStore } from '../store/graphStore';
import { getKeyboardControlPortId } from '../utils/connectionActivity';

// ============================================================================
// Constants
// ============================================================================

/** Valid instrument node types for keyboard triggering */
const INSTRUMENT_NODE_TYPES = ['piano', 'cello', 'electricCello', 'violin', 'saxophone', 'strings', 'keys', 'winds', 'instrument', 'sampler'] as const;

// ============================================================================
// Audio Node Instance Types
// ============================================================================

/** Speaker node instance with audio element for device routing */
interface SpeakerNodeInstance {
    audioElement: HTMLAudioElement | null;
    gainNode: GainNode;
    destination: MediaStreamAudioDestinationNode | null;
    isDirectConnection: boolean; // True when using direct ctx.destination (low latency)
}

/** Addition node instance - mixes two inputs */
interface AddNodeInstance {
    input1: GainNode;
    input2: GainNode;
    outputMixer: GainNode;
}

/** Subtraction node instance - phase cancellation */
interface SubtractNodeInstance extends AddNodeInstance {
    inverter: GainNode;
}

/** Union type for all possible audio node instance types */
type AudioNodeInstanceType =
    | SampledInstrument
    | Effect
    | Looper
    | Recorder
    | LocalSampleAdapter
    | SamplerAdapter
    | GainNode
    | MediaStreamAudioSourceNode
    | SpeakerNodeInstance
    | AddNodeInstance
    | SubtractNodeInstance
    | null;

/** Keyboard row bounds (1-indexed rows) */
const MIN_KEYBOARD_ROW = 1;
const MAX_KEYBOARD_ROW = 3;

/** Key index bounds (0-indexed within each row) */
const MIN_KEY_INDEX = 0;
const MAX_KEY_INDEX = 11; // 12 keys per row (chromatic octave)

// ============================================================================
// Types
// ============================================================================

export interface AudioNodeInstance {
    nodeId: string;
    type: NodeType;
    inputNode: AudioNode | null;
    outputNode: AudioNode | null;
    instance: AudioNodeInstanceType;
    gainEnvelope: GainNode | null; // For smooth connect/disconnect
}

type ConnectionChangeCallback = (connections: Map<string, Connection>) => void;
type NodeChangeCallback = (nodes: Map<string, GraphNode>) => void;

// ============================================================================
// AudioGraphManager
// ============================================================================

/** Metadata stored separately from AudioNodeInstance to avoid unsafe type assertions */
interface AudioNodeMetadata {
    instrumentId?: string;
    midiDeviceId?: string;
}

class AudioGraphManager {
    private audioNodes: Map<string, AudioNodeInstance> = new Map();
    private activeAudioConnections: Set<string> = new Set(); // Track "sourceId->targetId" pairs
    private pendingDisconnects: Map<string, number> = new Map(); // Track pending disconnect timeouts
    private connectionGenerations: Map<string, number> = new Map(); // Track connection versions for race condition prevention
    private isInitialized: boolean = false;
    private unsubscribeGraph: (() => void) | null = null;

    // Store getters for accessing graph state when syncing
    private getNodesRef: (() => Map<string, GraphNode>) | null = null;
    private getConnectionsRef: (() => Map<string, Connection>) | null = null;

    // Metadata storage for audio nodes (avoids unsafe type assertions)
    private audioNodeMetadata: Map<string, AudioNodeMetadata> = new Map();

    /**
     * Connection index for O(1) lookup by source node+port
     * Key format: "nodeId:portId" -> array of connections from that source
     * Updated whenever connections change
     */
    private connectionsBySource: Map<string, Connection[]> = new Map();

    /**
     * MIDI connection cache for O(1) lookup by MIDI node ID
     * Key: midiNodeId -> array of control connections from that MIDI node
     * Updated whenever connections change (in rebuildConnectionIndex)
     */
    private midiConnectionCache: Map<string, Connection[]> = new Map();

    // Signal level visualization (audio connections)
    private connectionAnalysers: Map<string, AnalyserNode> = new Map(); // connectionKey -> AnalyserNode
    private signalLevels: Map<string, number> = new Map(); // connectionKey -> 0-1 RMS level
    private signalUpdateCallbacks: Set<(levels: Map<string, number>) => void> = new Set();
    private signalAnimationId: number | null = null;
    private lastSignalUpdateTime: number = 0;
    private readonly SIGNAL_UPDATE_INTERVAL_MS = 100; // Update every 100ms for performance

    // Reusable buffer for signal level calculation (avoids allocation in hot path)
    // Initialized with standard FFT size of 256 (matches analyser.fftSize)
    private signalDataBuffer = new Float32Array(256);

    // Control signal visualization (keyboard, pedal, etc.)
    private controlActivities: Map<string, { level: number; releasing: boolean; releaseStart: number }> = new Map();
    private controlSignalLevels: Map<string, number> = new Map(); // connectionId -> 0-1 activity level
    private readonly CONTROL_RELEASE_MS = 120; // Subtle pulse release time

    // Ramp time for smooth transitions (10ms)
    private readonly RAMP_TIME = 0.01;

    // MIDI device subscriptions (nodeId -> unsubscribe function)
    private midiSubscriptions: Map<string, () => void> = new Map();

    // Pending promises for nodes being created (for waitForAudioNode)
    private pendingNodePromises: Map<string, {
        resolve: (instance: AudioNodeInstance) => void;
        timeoutId: ReturnType<typeof setTimeout>;
    }[]> = new Map();

    /**
     * Safety buffer (ms) added to ramp time delays.
     * Ensures the gain ramp completes before disconnecting nodes.
     * Without this buffer, race conditions can cause audio clicks
     * if setTimeout fires slightly before the ramp finishes.
     *
     * Set to 50ms (5x ramp time) to prevent clicks on slower systems
     * or under heavy CPU load where setTimeout may fire late.
     */
    private readonly RAMP_SAFETY_BUFFER_MS = 20;

    /**
     * Initialize the manager and subscribe to graph changes
     */
    initialize(
        subscribeToConnections: (callback: ConnectionChangeCallback) => () => void,
        subscribeToNodes: (callback: NodeChangeCallback) => () => void,
        getNodes: () => Map<string, GraphNode>,
        getConnections: () => Map<string, Connection>
    ): void {
        if (this.isInitialized) return;

        // Store references for later use
        this.getNodesRef = getNodes;
        this.getConnectionsRef = getConnections;

        // Subscribe to node changes
        const unsubNodes = subscribeToNodes((nodes) => {
            this.syncNodes(nodes);
        });

        // Subscribe to connection changes
        const unsubConns = subscribeToConnections((connections) => {
            this.syncConnections(connections, getNodes());
        });

        // Initial sync
        this.syncNodes(getNodes());
        this.syncConnections(getConnections(), getNodes());

        this.unsubscribeGraph = () => {
            unsubNodes();
            unsubConns();
        };

        this.isInitialized = true;
    }

    /**
     * Cleanup and disconnect all audio nodes
     */
    dispose(): void {
        // Stop signal visualization
        this.stopSignalUpdateLoop();
        this.signalUpdateCallbacks.clear();

        // Clear pending disconnect timeouts
        this.pendingDisconnects.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this.pendingDisconnects.clear();

        // Unsubscribe from all MIDI devices
        this.midiSubscriptions.forEach((unsubscribe) => {
            unsubscribe();
        });
        this.midiSubscriptions.clear();

        // Clean up connection analysers
        this.connectionAnalysers.forEach((analyser) => {
            try {
                analyser.disconnect();
            } catch {
                // May already be disconnected
            }
        });
        this.connectionAnalysers.clear();
        this.signalLevels.clear();

        this.audioNodes.forEach((nodeInstance) => {
            this.destroyAudioNode(nodeInstance);
        });
        this.audioNodes.clear();
        this.activeAudioConnections.clear();

        if (this.unsubscribeGraph) {
            this.unsubscribeGraph();
            this.unsubscribeGraph = null;
        }

        this.isInitialized = false;
    }

    // ============================================================================
    // Signal Level Visualization
    // ============================================================================

    /**
     * Subscribe to signal level updates
     * @returns Unsubscribe function
     */
    subscribeToSignalLevels(callback: (levels: Map<string, number>) => void): () => void {
        this.signalUpdateCallbacks.add(callback);

        // Start the animation loop if this is the first subscriber
        if (this.signalUpdateCallbacks.size === 1) {
            this.startSignalUpdateLoop();
        }

        // Immediately call with current levels
        callback(this.signalLevels);

        return () => {
            this.signalUpdateCallbacks.delete(callback);

            // Stop the animation loop if no more subscribers
            if (this.signalUpdateCallbacks.size === 0) {
                this.stopSignalUpdateLoop();
            }
        };
    }

    /**
     * Get current signal level for a connection
     * @param connectionKey - Format: "sourceNodeId->targetNodeId"
     * @returns Signal level 0-1, or 0 if not found
     */
    getSignalLevel(connectionKey: string): number {
        return this.signalLevels.get(connectionKey) ?? 0;
    }

    /**
     * Get all current signal levels (audio + control combined)
     */
    getAllSignalLevels(): Map<string, number> {
        const combined = new Map(this.signalLevels);
        // Merge control signal levels
        for (const [id, level] of this.controlSignalLevels) {
            combined.set(id, level);
        }
        return combined;
    }

    /**
     * Activate visual feedback for a control signal connection
     * Called when a key is pressed or pedal is engaged
     * @param connectionId - The connection ID to activate
     */
    activateControlSignal(connectionId: string): void {
        this.controlActivities.set(connectionId, {
            level: 1,
            releasing: false,
            releaseStart: 0
        });
        this.controlSignalLevels.set(connectionId, 1);

        // Ensure update loop is running
        this.startSignalUpdateLoop();

        // Notify subscribers immediately for instant visual feedback
        this.signalUpdateCallbacks.forEach(callback => {
            callback(this.getAllSignalLevels());
        });
    }

    /**
     * Release visual feedback for a control signal connection
     * Called when a key is released or pedal is disengaged
     * Fades out over CONTROL_RELEASE_MS
     * @param connectionId - The connection ID to release
     */
    releaseControlSignal(connectionId: string): void {
        const activity = this.controlActivities.get(connectionId);
        if (activity) {
            activity.releasing = true;
            activity.releaseStart = performance.now();
        }
    }

    /**
     * Start the signal level update animation loop
     * Only runs when there are active connections or control signals to visualize
     */
    private startSignalUpdateLoop(): void {
        if (this.signalAnimationId !== null) return;

        const updateLoop = (timestamp: number) => {
            // Stop loop if no work to do (performance optimization)
            const hasAudioConnections = this.connectionAnalysers.size > 0;
            const hasControlSignals = this.controlActivities.size > 0;

            if (!hasAudioConnections && !hasControlSignals && this.signalUpdateCallbacks.size === 0) {
                this.stopSignalUpdateLoop();
                return;
            }

            // Throttle updates to SIGNAL_UPDATE_INTERVAL_MS
            if (timestamp - this.lastSignalUpdateTime >= this.SIGNAL_UPDATE_INTERVAL_MS) {
                this.updateSignalLevels();
                this.lastSignalUpdateTime = timestamp;
            }

            this.signalAnimationId = requestAnimationFrame(updateLoop);
        };

        this.signalAnimationId = requestAnimationFrame(updateLoop);
    }

    /**
     * Stop the signal level update animation loop
     */
    private stopSignalUpdateLoop(): void {
        if (this.signalAnimationId !== null) {
            cancelAnimationFrame(this.signalAnimationId);
            this.signalAnimationId = null;
        }
    }

    /**
     * Update all signal levels from analysers and control signals
     */
    private updateSignalLevels(): void {
        let hasChanges = false;

        // Update audio signal levels from analysers
        this.connectionAnalysers.forEach((analyser, connectionKey) => {
            // Reuse pre-allocated buffer (perf optimization)
            // Buffer size matches analyser.fftSize (256) set in createConnectionAnalyser
            analyser.getFloatTimeDomainData(this.signalDataBuffer);
            const dataArray = this.signalDataBuffer;

            // Calculate RMS (root mean square) for signal level
            let sumSquares = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sumSquares += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sumSquares / dataArray.length);

            // Normalize to 0-1 range (typical audio RMS is 0-0.5 for loud signals)
            // Multiply by 3 and clamp to make visualization more visible
            const normalizedLevel = Math.min(1, rms * 3);

            // Apply smoothing (exponential moving average)
            const previousLevel = this.signalLevels.get(connectionKey) ?? 0;
            const smoothedLevel = previousLevel * 0.7 + normalizedLevel * 0.3;

            if (Math.abs(smoothedLevel - previousLevel) > 0.01) {
                this.signalLevels.set(connectionKey, smoothedLevel);
                hasChanges = true;
            }
        });

        // Update control signal levels (keyboard, pedal release animation)
        const now = performance.now();
        for (const [connId, activity] of this.controlActivities) {
            if (activity.releasing) {
                const elapsed = now - activity.releaseStart;
                const progress = Math.min(1, elapsed / this.CONTROL_RELEASE_MS);
                activity.level = 1 - progress;

                // Update the control signal level
                this.controlSignalLevels.set(connId, activity.level);
                hasChanges = true;

                // Remove completed releases
                if (progress >= 1) {
                    this.controlActivities.delete(connId);
                    this.controlSignalLevels.delete(connId);
                }
            } else if (activity.level > 0) {
                // Key is held, ensure level is set
                this.controlSignalLevels.set(connId, activity.level);
            }
        }

        // Notify subscribers if there are changes
        if (hasChanges) {
            this.signalUpdateCallbacks.forEach(callback => {
                callback(this.getAllSignalLevels());
            });
        }
    }

    /**
     * Create an analyser for a connection
     */
    private createConnectionAnalyser(connectionKey: string, sourceNode: AudioNode): AnalyserNode | null {
        const ctx = getAudioContext();
        if (!ctx) return null;

        // Create analyser with small FFT for performance
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; // Small for fast processing
        analyser.smoothingTimeConstant = 0.5;

        // Connect source to analyser (analyser is a pass-through)
        try {
            sourceNode.connect(analyser);
        } catch {
            // May fail if source is already connected elsewhere
            return null;
        }

        this.connectionAnalysers.set(connectionKey, analyser);
        this.signalLevels.set(connectionKey, 0);

        return analyser;
    }

    /**
     * Remove an analyser for a connection
     */
    private removeConnectionAnalyser(connectionKey: string): void {
        const analyser = this.connectionAnalysers.get(connectionKey);
        if (analyser) {
            try {
                analyser.disconnect();
            } catch {
                // May already be disconnected
            }
            this.connectionAnalysers.delete(connectionKey);
            this.signalLevels.delete(connectionKey);
        }
    }

    /**
     * Get audio node instance by node ID
     */
    getAudioNode(nodeId: string): AudioNodeInstance | undefined {
        return this.audioNodes.get(nodeId);
    }

    /**
     * Get all audio node instances
     */
    getAllAudioNodes(): Map<string, AudioNodeInstance> {
        return new Map(this.audioNodes);
    }

    // ============================================================================
    // Node Sync
    // ============================================================================

    /**
     * Sync audio nodes with graph nodes
     */
    private syncNodes(graphNodes: Map<string, GraphNode>): void {
        // Remove audio nodes that no longer exist in graph
        this.audioNodes.forEach((audioNode, nodeId) => {
            // Check if this is an internal node (has :: separator)
            if (nodeId.includes('::')) {
                // Internal node reference (legacy format parentId::internalId)
                const [, internalId] = nodeId.split('::');
                // With flat structure, internal nodes are in the main map
                if (!graphNodes.has(internalId)) {
                    this.destroyAudioNode(audioNode);
                    this.audioNodes.delete(nodeId);
                }
            } else {
                // Any node - check if it exists in the flat graph
                if (!graphNodes.has(nodeId)) {
                    this.destroyAudioNode(audioNode);
                    this.audioNodes.delete(nodeId);
                }
            }
        });

        // Create audio nodes for new graph nodes (root nodes only)
        // Also check if instrument nodes need to be recreated due to instrument change
        graphNodes.forEach((graphNode, nodeId) => {
            const existingAudioNode = this.audioNodes.get(nodeId);

            if (!existingAudioNode) {
                // Create new audio node
                const audioNode = this.createAudioNode(graphNode);
                if (audioNode) {
                    this.audioNodes.set(nodeId, audioNode);
                    // Resolve any pending promises waiting for this node
                    this.resolvePendingNodePromises(nodeId, audioNode);
                }
            } else if (INSTRUMENT_NODE_TYPES.includes(graphNode.type as typeof INSTRUMENT_NODE_TYPES[number])) {
                // Check if instrument has changed using metadata map (type-safe)
                const currentInstrumentId = this.getInstrumentIdForNode(graphNode);
                const metadata = this.audioNodeMetadata.get(nodeId);
                const storedInstrumentId = metadata?.instrumentId;

                // Recreate if: no stored ID (legacy node) OR stored ID differs from current
                if (!storedInstrumentId || storedInstrumentId !== currentInstrumentId) {
                    // Instrument changed or legacy node - destroy old and create new
                    this.destroyAudioNode(existingAudioNode);
                    const newAudioNode = this.createAudioNode(graphNode);
                    if (newAudioNode) {
                        this.audioNodes.set(nodeId, newAudioNode);
                        // Resolve any pending promises waiting for this node
                        this.resolvePendingNodePromises(nodeId, newAudioNode);

                        // CRITICAL: Re-sync connections after instrument recreation
                        // Without this, the new instrument won't be connected to the audio graph
                        if (this.getConnectionsRef && this.getNodesRef) {
                            this.syncConnections(this.getConnectionsRef(), this.getNodesRef());
                        }
                    }
                }
            }

            // Check for MIDI device changes (MIDI nodes return null, so check separately)
            if (graphNode.type === 'midi' || graphNode.type === 'minilab-3') {
                const midiData = graphNode.data as MIDIInputNodeData;
                const currentDeviceId = midiData.deviceId;
                const metadata = this.audioNodeMetadata.get(nodeId);
                const storedDeviceId = metadata?.midiDeviceId;

                // Check if device changed (null -> value, value -> different value, value -> null)
                const deviceChanged = storedDeviceId !== currentDeviceId;

                if (deviceChanged) {
                    if (currentDeviceId && midiData.isConnected) {
                        // Device changed to a new connected device - re-subscribe
                        this.subscribeMIDINode(nodeId, currentDeviceId);
                        this.audioNodeMetadata.set(nodeId, { midiDeviceId: currentDeviceId });
                    } else {
                        // Device removed or disconnected - unsubscribe
                        this.unsubscribeMIDINode(nodeId);
                        this.audioNodeMetadata.delete(nodeId);
                    }
                }
            }
        });
    }

    /**
     * Create an audio node instance for a graph node
     */
    private createAudioNode(graphNode: GraphNode): AudioNodeInstance | null {
        const ctx = getAudioContext();
        if (!ctx) return null;

        const baseInstance: AudioNodeInstance = {
            nodeId: graphNode.id,
            type: graphNode.type,
            inputNode: null,
            outputNode: null,
            instance: null,
            gainEnvelope: null
        };

        // Create gain envelope for smooth transitions
        const gainEnvelope = ctx.createGain();
        gainEnvelope.gain.value = 1;
        baseInstance.gainEnvelope = gainEnvelope;

        switch (graphNode.type) {
            // Instruments - output only
            case 'piano':
            case 'cello':
            case 'electricCello':
            case 'violin':
            case 'saxophone':
            case 'strings':
            case 'keys':
            case 'winds':
            case 'instrument': {
                const instrumentId = this.getInstrumentIdForNode(graphNode);
                const instrument = InstrumentLoader.create(instrumentId);

                // Fire-and-forget preload - starts loading immediately to reduce first-note latency
                instrument.load().catch(() => {
                    // Silently ignore preload failures - instrument will retry when triggered
                });

                // Connect instrument output to our routing chain
                const connectInstrumentOutput = () => {
                    const output = instrument.getOutput();
                    if (output) {
                        try {
                            output.disconnect(); // Disconnect from any existing connections
                        } catch {
                            // May not be connected
                        }
                        output.connect(gainEnvelope);
                    }
                };

                // Connect now if output exists
                connectInstrumentOutput();

                // Also connect when instrument finishes loading (handles lazy output creation)
                instrument.setOnLoadingStateChange((state) => {
                    if (state === 'loaded') {
                        connectInstrumentOutput();
                    }
                });

                baseInstance.instance = instrument;
                baseInstance.outputNode = gainEnvelope;
                // Store instrumentId in metadata map to detect changes later (type-safe)
                this.audioNodeMetadata.set(graphNode.id, { instrumentId });
                break;
            }

            // Microphone - output only
            case 'microphone': {
                // Microphone creates its own source node when activated
                // We just set up the output routing
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Keyboard - no audio, just control signals
            case 'keyboard': {
                // Keyboards don't process audio, they send control signals
                return null;
            }

            // MIDI Input - subscribes to MIDI device and routes messages to instruments
            case 'midi':
            case 'minilab-3': {
                // MIDI nodes don't process audio, they send control signals
                // Subscribe to MIDI device if configured
                const midiData = graphNode.data as MIDIInputNodeData;
                if (midiData.deviceId && midiData.isConnected) {
                    this.subscribeMIDINode(graphNode.id, midiData.deviceId);
                    // Store device ID in metadata for change detection
                    this.audioNodeMetadata.set(graphNode.id, { midiDeviceId: midiData.deviceId });
                }
                return null;
            }

            // Looper - input and output
            case 'looper': {
                const looper = new Looper(graphNode.data.duration as number || 10);
                const looperOutput = looper.getOutput();
                if (looperOutput) {
                    looperOutput.disconnect(); // Disconnect from master
                    looperOutput.connect(gainEnvelope);
                }

                // Get input node from looper (creates analyser + MediaStreamDestination)
                const looperInput = looper.getInputNode();

                baseInstance.instance = looper;
                baseInstance.inputNode = looperInput;
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Effects - input and output
            case 'effect': {
                const effectData = graphNode.data as EffectNodeData;
                const effect = createEffect(effectData.effectType, effectData.params);
                const effectInput = effect.getInput();
                const effectOutput = effect.getOutput();

                if (effectOutput) {
                    effectOutput.connect(gainEnvelope);
                }

                baseInstance.instance = effect;
                baseInstance.inputNode = effectInput;
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Amplifier - input and output
            case 'amplifier': {
                const ampData = graphNode.data as AmplifierNodeData;
                const ampGain = ctx.createGain();
                ampGain.gain.value = ampData.gain ?? 1;
                ampGain.connect(gainEnvelope);

                baseInstance.instance = ampGain;
                baseInstance.inputNode = ampGain;
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Speaker - input only, connects to destination
            case 'speaker': {
                const speakerData = graphNode.data as SpeakerNodeData;
                const speakerGain = ctx.createGain();
                speakerGain.gain.value = speakerData.isMuted ? 0 : (speakerData.volume ?? 1);

                // LOW LATENCY OPTIMIZATION:
                // For default device, connect directly to ctx.destination (saves 10-20ms)
                // Only use MediaStreamDestination when a specific device is selected
                const useDirectConnection = !speakerData.deviceId || speakerData.deviceId === 'default';

                if (useDirectConnection) {
                    // Direct connection - lowest latency path
                    speakerGain.connect(ctx.destination);

                    baseInstance.instance = {
                        gainNode: speakerGain,
                        audioElement: null,
                        destination: null,
                        isDirectConnection: true
                    };
                } else {
                    // Create MediaStreamDestination for device routing (higher latency)
                    const destination = ctx.createMediaStreamDestination();
                    speakerGain.connect(destination);

                    // Create hidden audio element for setSinkId
                    const audioElement = new Audio();
                    audioElement.srcObject = destination.stream;
                    audioElement.play().catch(e => {
                        console.warn('Failed to start audio element:', e);
                        toast.error('Audio playback failed. Please check your audio permissions.');
                    });

                    // Apply device selection
                    if (this.supportsSetSinkId()) {
                        (audioElement as any).setSinkId(speakerData.deviceId)
                            .catch((err: Error) => {
                                console.error('Failed to set output device:', err);
                                toast.error('Could not switch audio output device. Using default.');
                            });
                    }

                    baseInstance.instance = {
                        gainNode: speakerGain,
                        audioElement: audioElement,
                        destination: destination,
                        isDirectConnection: false
                    };
                }

                baseInstance.inputNode = speakerGain;
                baseInstance.outputNode = speakerGain; // Also output for chaining to recorder
                break;
            }

            // Recorder - input only
            case 'recorder': {
                const recorder = new Recorder();
                const recorderInput = recorder.getInput();

                baseInstance.instance = recorder;
                baseInstance.inputNode = recorderInput;
                break;
            }

            // Addition Node - mixes two inputs together
            case 'add': {
                const input1 = ctx.createGain();
                const input2 = ctx.createGain();
                const outputMixer = ctx.createGain();

                input1.gain.value = 1;
                input2.gain.value = 1;
                outputMixer.gain.value = 1;

                // Connect both inputs to output mixer
                input1.connect(outputMixer);
                input2.connect(outputMixer);
                outputMixer.connect(gainEnvelope);

                baseInstance.instance = { input1, input2, outputMixer } as AddNodeInstance;
                baseInstance.inputNode = input1;  // Primary input
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Subtraction Node - inverts second input and mixes (phase cancellation)
            case 'subtract': {
                const input1 = ctx.createGain();
                const input2 = ctx.createGain();
                const inverter = ctx.createGain();
                const outputMixer = ctx.createGain();

                input1.gain.value = 1;
                input2.gain.value = 1;
                inverter.gain.value = -1;  // Phase inversion
                outputMixer.gain.value = 1;

                // Input 1 goes directly to output
                input1.connect(outputMixer);
                // Input 2 goes through inverter then to output
                input2.connect(inverter);
                inverter.connect(outputMixer);
                outputMixer.connect(gainEnvelope);

                baseInstance.instance = { input1, input2, inverter, outputMixer } as SubtractNodeInstance;
                baseInstance.inputNode = input1;  // Primary input
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Sampler Node - pitch-shifting sampler instrument
            case 'sampler': {
                const samplerData = graphNode.data as SamplerNodeData;
                const sampler = new SamplerAdapter({
                    rootNote: samplerData.rootNote ?? 60,
                    gain: samplerData.gain ?? 1.0,
                    attack: samplerData.attack ?? 0.01,
                    release: samplerData.release ?? 0.1,
                    maxVoices: 16,
                });

                // Connect sampler output to routing chain
                const connectSamplerOutput = () => {
                    const output = sampler.getOutput();
                    if (output) {
                        try {
                            output.disconnect();
                        } catch {
                            // May not be connected
                        }
                        output.connect(gainEnvelope);
                    }
                };

                // Connect now if output exists
                connectSamplerOutput();

                // Also connect when sampler finishes loading
                sampler.setOnLoadingStateChange((state) => {
                    if (state === 'loaded') {
                        connectSamplerOutput();
                    }
                });

                baseInstance.instance = sampler;
                baseInstance.outputNode = gainEnvelope;
                // Store a stable instrumentId for samplers to prevent unnecessary recreation
                // Samplers don't have an instrumentId like regular instruments, so use the node type
                this.audioNodeMetadata.set(graphNode.id, { instrumentId: 'sampler' });
                break;
            }

            // Sample Library Node - plays local audio samples
            case 'library': {
                const libraryData = graphNode.data as LibraryNodeData;
                const adapter = new LocalSampleAdapter({
                    playbackMode: libraryData.playbackMode || 'oneshot',
                    volume: libraryData.volume ?? 0.8,
                });

                // Load current item if set
                if (libraryData.currentItemId) {
                    adapter.loadSample(libraryData.currentItemId).catch(err => {
                        console.warn('Failed to load item:', err);
                    });
                }

                // Connect adapter output to routing chain
                const output = adapter.getOutput();
                if (output) {
                    output.connect(gainEnvelope);
                }

                baseInstance.instance = adapter;
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            // Container Node - passthrough, audio flows through internal nodes
            case 'container': {
                const passthrough = ctx.createGain();
                passthrough.gain.value = 1;
                passthrough.connect(gainEnvelope);

                baseInstance.instance = passthrough;
                baseInstance.inputNode = passthrough;
                baseInstance.outputNode = gainEnvelope;
                break;
            }

            default:
                return null;
        }

        return baseInstance;
    }

    /**
     * Destroy an audio node instance
     */
    private destroyAudioNode(audioNode: AudioNodeInstance): void {
        const ctx = getAudioContext();
        if (!ctx) return;

        // CRITICAL: Remove this node's connections from activeAudioConnections
        // Without this, syncConnections will think connections still exist and skip reconnecting
        const nodeId = audioNode.nodeId;
        const keysToRemove: string[] = [];
        this.activeAudioConnections.forEach(key => {
            if (key.startsWith(`${nodeId}->`) || key.endsWith(`->${nodeId}`)) {
                keysToRemove.push(key);
            }
        });
        keysToRemove.forEach(key => this.activeAudioConnections.delete(key));

        // Clean up connectionGenerations for connections involving this node (memory leak fix)
        this.connectionGenerations.forEach((_, key) => {
            if (key.startsWith(`${nodeId}->`) || key.endsWith(`->${nodeId}`)) {
                this.connectionGenerations.delete(key);
            }
        });

        // Cancel pending disconnects for connections involving this node
        this.pendingDisconnects.forEach((timeoutId, key) => {
            if (key.startsWith(`${nodeId}->`) || key.endsWith(`->${nodeId}`)) {
                clearTimeout(timeoutId);
                this.pendingDisconnects.delete(key);
            }
        });

        // Clean up metadata (memory leak fix)
        this.audioNodeMetadata.delete(nodeId);

        // Fade out before disconnecting
        if (audioNode.gainEnvelope) {
            const now = ctx.currentTime;
            audioNode.gainEnvelope.gain.setValueAtTime(
                audioNode.gainEnvelope.gain.value,
                now
            );
            audioNode.gainEnvelope.gain.linearRampToValueAtTime(0, now + this.RAMP_TIME);

            // Disconnect after fade (with safety buffer to ensure ramp completes)
            setTimeout(() => {
                audioNode.gainEnvelope?.disconnect();
            }, this.RAMP_TIME * 1000 + this.RAMP_SAFETY_BUFFER_MS);
        }

        // Cleanup specific instance types
        if (audioNode.instance && 'disconnect' in audioNode.instance && typeof audioNode.instance.disconnect === 'function') {
            audioNode.instance.disconnect();
        }

        // Cleanup speaker audio element
        if (audioNode.instance && typeof audioNode.instance === 'object' && 'audioElement' in audioNode.instance) {
            const speakerInstance = audioNode.instance as SpeakerNodeInstance;
            // Only cleanup audio element if using non-direct connection
            if (speakerInstance.audioElement) {
                speakerInstance.audioElement.pause();
                speakerInstance.audioElement.srcObject = null;
            }
            speakerInstance.gainNode.disconnect();
            if (speakerInstance.destination) {
                speakerInstance.destination.disconnect();
            }
        }

        // Disconnect nodes (may throw if already disconnected)
        try {
            audioNode.inputNode?.disconnect();
        } catch {
            // Already disconnected - safe to ignore
        }
        try {
            audioNode.outputNode?.disconnect();
        } catch {
            // Already disconnected - safe to ignore
        }
    }

    /**
     * Get instrument ID for a node, supporting both new instrumentId field and legacy type mapping
     */
    private getInstrumentIdForNode(node: GraphNode): string {
        // Samplers use their own identity - they don't switch instruments like regular nodes
        // This must match the instrumentId stored in metadata during creation ('sampler')
        if (node.type === 'sampler') {
            return 'sampler';
        }
        // Check if node has explicit instrumentId in data
        const nodeData = node.data as InstrumentNodeData;
        if (nodeData.instrumentId) {
            return nodeData.instrumentId;
        }
        // Fall back to legacy type mapping
        return getLegacyInstrumentId(node.type);
    }

    // ============================================================================
    // Connection Sync
    // ============================================================================

    /**
     * Sync audio connections with graph connections
     */
    private syncConnections(
        graphConnections: Map<string, Connection>,
        _graphNodes: Map<string, GraphNode>
    ): void {
        // Only handle audio connections, not control/control connections
        const audioConnections = Array.from(graphConnections.values())
            .filter(conn => conn.type === 'audio');

        // Build set of current connection keys (include port IDs for multi-input nodes like Add)
        const currentConnectionKeys = new Set<string>();
        audioConnections.forEach(connection => {
            const key = `${connection.sourceNodeId}:${connection.sourcePortId}->${connection.targetNodeId}:${connection.targetPortId}`;
            currentConnectionKeys.add(key);
        });

        // Find and disconnect removed connections
        this.activeAudioConnections.forEach(key => {
            if (!currentConnectionKeys.has(key)) {
                // Parse the key format: sourceNodeId:sourcePortId->targetNodeId:targetPortId
                // Validate key format to prevent silent failures from corrupted data
                const parts = key.split('->');
                if (parts.length !== 2) {
                    console.warn(`[AudioGraphManager] Invalid connection key format (missing ->): ${key}`);
                    return;
                }
                const [sourcePart, targetPart] = parts;

                const sourceParts = sourcePart.split(':');
                const targetParts = targetPart.split(':');

                if (sourceParts.length !== 2 || targetParts.length !== 2) {
                    console.warn(`[AudioGraphManager] Invalid port format in connection key: ${key}`);
                    return;
                }

                const [sourceNodeId, sourcePortId] = sourceParts;
                const [targetNodeId, targetPortId] = targetParts;
                this.disconnectAudioNodes(sourceNodeId, sourcePortId, targetNodeId, targetPortId);
            }
        });

        // Connect new audio connections
        audioConnections.forEach(connection => {
            const key = `${connection.sourceNodeId}:${connection.sourcePortId}->${connection.targetNodeId}:${connection.targetPortId}`;
            if (!this.activeAudioConnections.has(key)) {
                this.connectAudioNodes(
                    connection.sourceNodeId,
                    connection.sourcePortId,
                    connection.targetNodeId,
                    connection.targetPortId
                );
            }
        });

        // Update tracked connections
        this.activeAudioConnections = currentConnectionKeys;

        // Rebuild connection index for O(1) lookups in keyboard triggering
        this.rebuildConnectionIndex(graphConnections);

        // Process hierarchical routing through internal structures
        this.processHierarchicalRouting(_graphNodes);
    }

    /**
     * Rebuild the connectionsBySource index for O(1) lookup
     * Called whenever connections change
     */
    private rebuildConnectionIndex(graphConnections: Map<string, Connection>): void {
        this.connectionsBySource.clear();
        this.midiConnectionCache.clear();

        // Get the set of MIDI node IDs for cache population
        const midiNodeIds = new Set(this.midiSubscriptions.keys());

        for (const connection of graphConnections.values()) {
            const key = `${connection.sourceNodeId}:${connection.sourcePortId}`;
            const existing = this.connectionsBySource.get(key);
            if (existing) {
                existing.push(connection);
            } else {
                this.connectionsBySource.set(key, [connection]);
            }

            // Also populate MIDI connection cache for control connections from MIDI nodes
            if (connection.type === 'control' && midiNodeIds.has(connection.sourceNodeId)) {
                const midiConns = this.midiConnectionCache.get(connection.sourceNodeId);
                if (midiConns) {
                    midiConns.push(connection);
                } else {
                    this.midiConnectionCache.set(connection.sourceNodeId, [connection]);
                }
            }
        }
    }

    /**
     * Get connections from a specific source node+port
     * O(1) lookup using pre-built index
     */
    private getConnectionsFromSource(sourceNodeId: string, sourcePortId: string): Connection[] {
        return this.connectionsBySource.get(`${sourceNodeId}:${sourcePortId}`) ?? [];
    }

    /**
     * Process hierarchical audio routing through internal structures
     * This enables audio to flow: Root → Internal Level 1 → Internal Level 2 → etc.
     * With flat structure, we find parent nodes by checking childIds
     *
     * Includes cycle detection to prevent infinite loops from corrupted graph data
     */
    private processHierarchicalRouting(graphNodes: Map<string, GraphNode>, visited: Set<string> = new Set()): void {
        const graphConnections = useGraphStore.getState().connections;

        // For each node that has children (is a container)
        graphNodes.forEach((node) => {
            if (!node.childIds || node.childIds.length === 0) return;

            // Cycle detection: prevent infinite loops from circular parent-child references
            if (visited.has(node.id)) {
                console.warn(`[AudioGraphManager] Cycle detected in hierarchy at node ${node.id}, skipping`);
                return;
            }
            visited.add(node.id);

            // Get connections between this node's children
            const childIdsSet = new Set(node.childIds);
            const internalAudioConnections = Array.from(graphConnections.values()).filter(
                conn => conn.type === 'audio' &&
                    childIdsSet.has(conn.sourceNodeId) &&
                    childIdsSet.has(conn.targetNodeId)
            );

            internalAudioConnections.forEach(conn => {
                // Get internal audio nodes (now directly from flat structure)
                const sourceInternal = this.getInternalAudioNode(node.id, conn.sourceNodeId);
                const targetInternal = this.getInternalAudioNode(node.id, conn.targetNodeId);

                if (sourceInternal?.outputNode && targetInternal?.inputNode) {
                    try {
                        sourceInternal.outputNode.connect(targetInternal.inputNode);
                    } catch {
                        // Connection may already exist
                    }
                }
            });

            // Route audio FROM parent input ports INTO internal canvas-input nodes
            this.routeParentInputsToInternal(node, graphNodes);

            // Route audio FROM internal canvas-output nodes TO parent output ports
            this.routeInternalToParentOutputs(node, graphNodes);
        });
    }

    /**
     * Get or create audio node for an internal node
     * With flat structure, internal nodes are in the main nodes Map
     */
    private getInternalAudioNode(parentId: string, internalNodeId: string): AudioNodeInstance | null {
        const ctx = getAudioContext();
        if (!ctx) return null;

        // Check if we've already created an audio instance for this internal node
        const fullNodeId = `${parentId}::${internalNodeId}`;
        let audioNode = this.audioNodes.get(fullNodeId);

        if (!audioNode) {
            // Get internal node from flat structure
            const graphNodes = useGraphStore.getState().nodes;
            const internalNode = graphNodes.get(internalNodeId);

            // Verify it's actually a child of the parent
            if (!internalNode || internalNode.parentId !== parentId) return null;

            // Create audio node for internal node
            const createdNode = this.createAudioNode(internalNode);
            if (createdNode) {
                // Override ID to include parent context
                createdNode.nodeId = fullNodeId;
                this.audioNodes.set(fullNodeId, createdNode);
                audioNode = createdNode;
            }
        }

        return audioNode ?? null;
    }

    /**
     * Route audio from parent node's input connections into internal canvas-input nodes
     * With flat structure, we look up child nodes from the main map
     */
    private routeParentInputsToInternal(parentNode: GraphNode, graphNodes: Map<string, GraphNode>): void {
        if (!parentNode.childIds || parentNode.childIds.length === 0) return;

        const parentAudioNode = this.audioNodes.get(parentNode.id);
        if (!parentAudioNode?.inputNode) return;

        // Find all canvas-input nodes inside parent
        parentNode.childIds.forEach((childId: string) => {
            const internalNode = graphNodes.get(childId);
            if (!internalNode || internalNode.type !== 'canvas-input') return;

            // Check if this canvas-input corresponds to a parent input port
            const parentInputPort = parentNode.ports.find(
                p => p.id === childId && p.direction === 'input'
            );

            if (!parentInputPort) return;

            // Get or create audio node for internal canvas-input
            const internalAudioNode = this.getInternalAudioNode(parentNode.id, childId);
            if (!internalAudioNode?.outputNode) return;

            // Route: External connections → Parent input → Internal canvas-input output
            // The parent's inputNode already receives from external connections
            // We need to route that to the internal canvas-input's outputNode
            if (parentAudioNode.inputNode && internalAudioNode.outputNode) {
                try {
                    parentAudioNode.inputNode.connect(internalAudioNode.outputNode);
                } catch {
                    // May already be connected
                }
            }
        });
    }

    /**
     * Route audio from internal canvas-output nodes to parent node's output
     * With flat structure, we look up child nodes from the main map
     */
    private routeInternalToParentOutputs(parentNode: GraphNode, graphNodes: Map<string, GraphNode>): void {
        if (!parentNode.childIds || parentNode.childIds.length === 0) return;

        const parentAudioNode = this.audioNodes.get(parentNode.id);
        if (!parentAudioNode?.outputNode) return;

        // Find all canvas-output nodes inside parent
        parentNode.childIds.forEach((childId: string) => {
            const internalNode = graphNodes.get(childId);
            if (!internalNode || internalNode.type !== 'canvas-output') return;

            // Check if this canvas-output corresponds to a parent output port
            const parentOutputPort = parentNode.ports.find(
                p => p.id === childId && p.direction === 'output'
            );

            if (!parentOutputPort) return;

            // Get or create audio node for internal canvas-output
            const internalAudioNode = this.getInternalAudioNode(parentNode.id, childId);
            if (!internalAudioNode?.inputNode) return;

            // Route: Internal canvas-output input → Parent output
            // The internal canvas-output's inputNode receives from internal connections
            // We need to route that to the parent's outputNode
            if (internalAudioNode.inputNode && parentAudioNode.outputNode) {
                try {
                    internalAudioNode.inputNode.connect(parentAudioNode.outputNode);
                } catch {
                    // May already be connected
                }
            }
        });
    }

    /**
     * Get the appropriate input node for a target node based on port ID
     * This handles multi-input nodes like Add and Subtract
     */
    private getInputNodeForPort(targetAudioNode: AudioNodeInstance, targetPortId?: string): AudioNode | null {
        const instance = targetAudioNode.instance;

        // Check if this is an Add or Subtract node with multiple inputs
        if (instance && typeof instance === 'object' && 'input1' in instance && 'input2' in instance) {
            const multiInputNode = instance as AddNodeInstance | SubtractNodeInstance;
            if (targetPortId === 'in-2') {
                return multiInputNode.input2;
            }
            // Default to input1 for 'in-1' or any other port
            return multiInputNode.input1;
        }

        // For all other nodes, use the standard inputNode
        return targetAudioNode.inputNode;
    }

    /**
     * Connect two audio nodes
     */
    private connectAudioNodes(sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): void {
        const ctx = getAudioContext();
        if (!ctx) return;

        // Include port IDs in connection key for proper tracking
        const connectionKey = `${sourceNodeId}:${sourcePortId}->${targetNodeId}:${targetPortId}`;

        // Prevent duplicate connections
        if (this.activeAudioConnections.has(connectionKey)) {
            return;
        }

        // Increment connection generation to invalidate any pending disconnects
        // This prevents race conditions where a disconnect timeout fires after reconnection
        const newGeneration = (this.connectionGenerations.get(connectionKey) || 0) + 1;
        this.connectionGenerations.set(connectionKey, newGeneration);

        // Cancel any pending disconnect for this connection
        const pendingTimeout = this.pendingDisconnects.get(connectionKey);
        if (pendingTimeout !== undefined) {
            clearTimeout(pendingTimeout);
            this.pendingDisconnects.delete(connectionKey);
        }

        const sourceAudioNode = this.audioNodes.get(sourceNodeId);
        const targetAudioNode = this.audioNodes.get(targetNodeId);

        if (!sourceAudioNode?.outputNode || !targetAudioNode) {
            return;
        }

        // Get the correct input node based on target port ID
        const targetInputNode = this.getInputNodeForPort(targetAudioNode, targetPortId);
        if (!targetInputNode) {
            return;
        }

        // Web Audio allows multiple connections, track to prevent duplicates
        try {
            // Fade in the connection smoothly
            if (sourceAudioNode.gainEnvelope) {
                const now = ctx.currentTime;
                sourceAudioNode.gainEnvelope.gain.setValueAtTime(0, now);
                sourceAudioNode.gainEnvelope.gain.linearRampToValueAtTime(1, now + this.RAMP_TIME);
            }

            // Connect output to input
            sourceAudioNode.outputNode.connect(targetInputNode);

            // Create analyser for signal visualization (connects in parallel)
            this.createConnectionAnalyser(connectionKey, sourceAudioNode.outputNode);
        } catch {
            // Connection may already exist, that's fine
        }
    }

    /**
     * Disconnect two audio nodes
     */
    disconnectAudioNodes(sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): void {
        const ctx = getAudioContext();
        if (!ctx) return;

        // Include port IDs in connection key to match the connect format
        const connectionKey = `${sourceNodeId}:${sourcePortId}->${targetNodeId}:${targetPortId}`;
        const sourceAudioNode = this.audioNodes.get(sourceNodeId);
        const targetAudioNode = this.audioNodes.get(targetNodeId);

        if (!sourceAudioNode?.outputNode || !targetAudioNode) {
            return;
        }

        // Get the correct input node based on target port ID
        const targetInputNode = this.getInputNodeForPort(targetAudioNode, targetPortId);
        if (!targetInputNode) {
            return;
        }

        // Capture current generation - if it changes before timeout, connection was recreated
        const capturedGeneration = this.connectionGenerations.get(connectionKey) || 0;

        // Fade out before disconnecting
        if (sourceAudioNode.gainEnvelope) {
            const now = ctx.currentTime;
            sourceAudioNode.gainEnvelope.gain.setValueAtTime(
                sourceAudioNode.gainEnvelope.gain.value,
                now
            );
            sourceAudioNode.gainEnvelope.gain.linearRampToValueAtTime(0, now + this.RAMP_TIME);

            // Track and disconnect after fade (can be canceled if reconnected)
            const timeoutId = window.setTimeout(() => {
                // Double-check: verify generation hasn't changed (connection wasn't recreated)
                // This prevents race conditions even if timeout cancellation fails
                const currentGeneration = this.connectionGenerations.get(connectionKey) || 0;
                if (currentGeneration !== capturedGeneration) {
                    // Connection was recreated - don't disconnect
                    this.pendingDisconnects.delete(connectionKey);
                    return;
                }

                // Verify key still exists - callback may fire after reconnection canceled it
                if (this.pendingDisconnects.has(connectionKey)) {
                    this.pendingDisconnects.delete(connectionKey);
                    if (sourceAudioNode.outputNode && targetInputNode) {
                        try {
                            sourceAudioNode.outputNode.disconnect(targetInputNode);
                        } catch {
                            // May not be connected
                        }
                    }
                    // Remove analyser for signal visualization
                    this.removeConnectionAnalyser(connectionKey);
                    // Clean up connection generation tracking (memory leak fix)
                    this.connectionGenerations.delete(connectionKey);
                }
            }, this.RAMP_TIME * 1000 + this.RAMP_SAFETY_BUFFER_MS);

            this.pendingDisconnects.set(connectionKey, timeoutId);
        } else {
            if (sourceAudioNode.outputNode && targetInputNode) {
                try {
                    sourceAudioNode.outputNode.disconnect(targetInputNode);
                } catch {
                    // May not be connected
                }
            }
            // Remove analyser for signal visualization
            this.removeConnectionAnalyser(connectionKey);
            // Clean up connection generation tracking (memory leak fix)
            this.connectionGenerations.delete(connectionKey);
        }
    }

    // ============================================================================
    // Public API for Node Components
    // ============================================================================

    /**
     * Get instrument instance for a node
     */
    getInstrument(nodeId: string): SampledInstrument | null {
        const audioNode = this.audioNodes.get(nodeId);
        // Check if instance has required instrument methods
        if (audioNode?.instance &&
            'playNote' in audioNode.instance &&
            'stopNote' in audioNode.instance &&
            'stopAllNotes' in audioNode.instance) {
            return audioNode.instance as SampledInstrument;
        }
        return null;
    }

    /**
     * Get effect instance for a node
     */
    getEffect(nodeId: string): Effect | null {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof Effect) {
            return audioNode.instance;
        }
        return null;
    }

    /**
     * Get looper instance for a node
     */
    getLooper(nodeId: string): Looper | null {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof Looper) {
            return audioNode.instance;
        }
        return null;
    }

    /**
     * Get recorder instance for a node
     */
    getRecorder(nodeId: string): Recorder | null {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof Recorder) {
            return audioNode.instance;
        }
        return null;
    }

    /**
     * Get local sample adapter for a library node
     */
    getSampleAdapter(nodeId: string): LocalSampleAdapter | null {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof LocalSampleAdapter) {
            return audioNode.instance;
        }
        return null;
    }

    /**
     * Get sampler adapter for a sampler node
     */
    getSamplerAdapter(nodeId: string): SamplerAdapter | null {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof SamplerAdapter) {
            return audioNode.instance;
        }
        return null;
    }

    /**
     * Wait for a sampler adapter to be created.
     * Resolves immediately if it already exists, otherwise waits for syncNodes to create it.
     * @param nodeId - The node ID to wait for
     * @param timeoutMs - Maximum wait time (default 5000ms)
     * @returns The SamplerAdapter or null if timeout/not found
     */
    waitForSamplerAdapter(nodeId: string, timeoutMs: number = 5000): Promise<SamplerAdapter | null> {
        // Check if already exists
        const existing = this.getSamplerAdapter(nodeId);
        if (existing) {
            return Promise.resolve(existing);
        }

        // Create promise that will be resolved when node is created
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                // Cleanup pending promise on timeout
                const pending = this.pendingNodePromises.get(nodeId);
                if (pending) {
                    const filtered = pending.filter(p => p.timeoutId !== timeoutId);
                    if (filtered.length === 0) {
                        this.pendingNodePromises.delete(nodeId);
                    } else {
                        this.pendingNodePromises.set(nodeId, filtered);
                    }
                }
                resolve(null);
            }, timeoutMs);

            const pending = this.pendingNodePromises.get(nodeId) || [];
            pending.push({
                resolve: (instance: AudioNodeInstance) => {
                    clearTimeout(timeoutId);
                    if (instance.instance instanceof SamplerAdapter) {
                        resolve(instance.instance);
                    } else {
                        resolve(null);
                    }
                },
                timeoutId
            });
            this.pendingNodePromises.set(nodeId, pending);
        });
    }

    /**
     * Resolve any pending promises waiting for a node to be created
     * Called internally when a new audio node is created
     */
    private resolvePendingNodePromises(nodeId: string, audioNode: AudioNodeInstance): void {
        const pending = this.pendingNodePromises.get(nodeId);
        if (pending && pending.length > 0) {
            pending.forEach(p => {
                clearTimeout(p.timeoutId);
                p.resolve(audioNode);
            });
            this.pendingNodePromises.delete(nodeId);
        }
    }

    /**
     * Pause all continuous audio sources (Loopers).
     * Does NOT affect live instruments - they can still be played.
     */
    pauseAllContinuousSources(): void {
        this.audioNodes.forEach((audioNode) => {
            if (audioNode.instance instanceof Looper) {
                audioNode.instance.pauseAll();
            }
            // Future: Add other continuous source types here
            // e.g., if (audioNode.instance instanceof Sequencer) { ... }
        });
    }

    /**
     * Resume all paused continuous audio sources.
     */
    resumeAllContinuousSources(): void {
        this.audioNodes.forEach((audioNode) => {
            if (audioNode.instance instanceof Looper) {
                audioNode.instance.resumeAll();
            }
            // Future: Resume other continuous source types here
        });
    }

    /**
     * Trigger a sample in a library node
     */
    triggerSample(nodeId: string, velocity: number = 1.0): void {
        const adapter = this.getSampleAdapter(nodeId);
        if (adapter) {
            adapter.trigger(velocity);
        }
    }

    /**
     * Release a sample in a library node (for hold mode)
     */
    releaseSample(nodeId: string): void {
        const adapter = this.getSampleAdapter(nodeId);
        if (adapter) {
            adapter.release();
        }
    }

    /**
     * Send an AudioBuffer from a source node (Library, Looper) to connected Samplers
     * via the sample-out port
     */
    sendSampleBuffer(sourceNodeId: string, buffer: AudioBuffer): void {
        const connections = this.getConnectionsRef?.();
        const nodes = this.getNodesRef?.();
        if (!connections || !nodes) return;

        // Find all connections from this node's sample-out port to sampler sample-in ports
        for (const connection of connections.values()) {
            if (connection.sourceNodeId === sourceNodeId && connection.sourcePortId === 'sample-out') {
                // Check if target is a sampler
                const targetNode = nodes.get(connection.targetNodeId);
                if (targetNode?.type === 'sampler' && connection.targetPortId === 'sample-in') {
                    const sampler = this.getSamplerAdapter(connection.targetNodeId);
                    if (sampler) {
                        sampler.setBuffer(buffer);
                    }
                }
            }
        }
    }

    /**
     * Update amplifier gain
     */
    updateAmplifierGain(nodeId: string, gain: number): void {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof GainNode) {
            const ctx = getAudioContext();
            if (ctx) {
                const now = ctx.currentTime;
                audioNode.instance.gain.setValueAtTime(audioNode.instance.gain.value, now);
                audioNode.instance.gain.linearRampToValueAtTime(gain, now + this.RAMP_TIME);
            }
        }
    }

    /**
     * Update speaker volume/mute
     */
    updateSpeakerVolume(nodeId: string, volume: number, isMuted: boolean): void {
        const audioNode = this.audioNodes.get(nodeId);
        if (!audioNode) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        const targetGain = isMuted ? 0 : volume;
        const now = ctx.currentTime;

        // Handle both old GainNode instances and new speaker instance structure
        if (audioNode.instance instanceof GainNode) {
            audioNode.instance.gain.setValueAtTime(audioNode.instance.gain.value, now);
            audioNode.instance.gain.linearRampToValueAtTime(targetGain, now + this.RAMP_TIME);
        } else if (audioNode.instance && typeof audioNode.instance === 'object' && 'gainNode' in audioNode.instance) {
            const speakerInstance = audioNode.instance as { gainNode: GainNode };
            speakerInstance.gainNode.gain.setValueAtTime(speakerInstance.gainNode.gain.value, now);
            speakerInstance.gainNode.gain.linearRampToValueAtTime(targetGain, now + this.RAMP_TIME);
        }
    }

    /**
     * Check if browser supports setSinkId for output device selection
     */
    private supportsSetSinkId(): boolean {
        const audio = document.createElement('audio');
        return typeof (audio as any).setSinkId === 'function';
    }

    /**
     * Update speaker output device
     *
     * Note: When switching from default device (direct connection) to a specific device,
     * or vice versa, the speaker node needs to be recreated to change routing mode.
     * This is handled by destroying and recreating the node in syncNodes.
     */
    updateSpeakerDevice(nodeId: string, deviceId: string): void {
        const audioNode = this.audioNodes.get(nodeId);
        if (!audioNode?.instance || !('audioElement' in audioNode.instance)) {
            return;
        }

        const instance = audioNode.instance as SpeakerNodeInstance;

        // If using direct connection (no audioElement), switching to a specific device
        // requires recreating the node. This happens automatically via syncNodes when
        // the node data changes. Just return here to avoid null reference.
        if (!instance.audioElement) {
            // Force node recreation by triggering a sync
            if (this.getConnectionsRef && this.getNodesRef) {
                // Destroy current node so it gets recreated with new device
                this.destroyAudioNode(audioNode);
                this.audioNodes.delete(nodeId);
                // Trigger resync
                this.syncNodes(this.getNodesRef());
                this.syncConnections(this.getConnectionsRef(), this.getNodesRef());
            }
            return;
        }

        if (this.supportsSetSinkId()) {
            (instance.audioElement as any).setSinkId(deviceId)
                .catch((err: Error) => {
                    console.error('Failed to switch output device:', err);
                });
        }
    }

    /**
     * Connect microphone stream to a node
     */
    async connectMicrophone(nodeId: string): Promise<MediaStreamAudioSourceNode | null> {
        const ctx = getAudioContext();
        if (!ctx) return null;

        const audioNode = this.audioNodes.get(nodeId);
        if (!audioNode) return null;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            const micSource = ctx.createMediaStreamSource(stream);

            if (audioNode.gainEnvelope) {
                micSource.connect(audioNode.gainEnvelope);
            }

            audioNode.instance = micSource;
            return micSource;
        } catch (e) {
            console.error('Failed to get microphone:', e);
            return null;
        }
    }

    /**
     * Disconnect microphone from a node
     */
    disconnectMicrophone(nodeId: string): void {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode?.instance instanceof MediaStreamAudioSourceNode) {
            audioNode.instance.disconnect();
            // Stop the media stream tracks
            const mediaStream = audioNode.instance.mediaStream;
            mediaStream.getTracks().forEach(track => track.stop());
            audioNode.instance = null;
        }
    }

    /**
     * Set the output node for a microphone (called from MicrophoneNode component)
     * This allows the component to manage its own audio stream while routing through connections
     * Accepts any AudioNode that passes audio through (GainNode, AnalyserNode, etc.)
     */
    setMicrophoneOutput(nodeId: string, outputNode: AudioNode): void {
        const audioNode = this.audioNodes.get(nodeId);
        if (audioNode) {
            // Disconnect old output if exists (may throw if already disconnected)
            if (audioNode.outputNode) {
                try {
                    audioNode.outputNode.disconnect();
                } catch {
                    // Node may already be disconnected - safe to ignore
                }
            }
            audioNode.outputNode = outputNode;

            // Re-establish any existing connections from this node
            this.reconnectNodeOutputs(nodeId);

            // Also trigger full connection sync to ensure all paths are properly connected
            // This handles edge cases where connections were made before mic was initialized
            if (this.getConnectionsRef && this.getNodesRef) {
                this.syncConnections(this.getConnectionsRef(), this.getNodesRef());
            }
        }
    }

    /**
     * Reconnect all outputs from a node (used when output node changes)
     */
    private reconnectNodeOutputs(nodeId: string): void {
        const audioNode = this.audioNodes.get(nodeId);
        if (!audioNode?.outputNode) return;

        // Get connections from graphStore
        const graphConnections = useGraphStore.getState().connections;

        // Find all audio connections from this node and reconnect
        for (const [, connection] of graphConnections) {
            if (connection.sourceNodeId === nodeId && connection.type === 'audio') {
                const targetAudioNode = this.audioNodes.get(connection.targetNodeId);
                if (targetAudioNode?.inputNode) {
                    try {
                        audioNode.outputNode.connect(targetAudioNode.inputNode);
                    } catch (e) {
                        // Connection might already exist
                    }
                }
            }
        }
    }

    // ============================================================================
    // Keyboard Note Triggering
    // ============================================================================

    /**
     * Trigger a note from keyboard input
     * @param keyboardId - The keyboard node ID
     * @param row - The active row (1, 2, or 3)
     * @param keyIndex - The key index within the row (0-11 for chromatic octave)
     * @param velocity - Normalized velocity (0-1), defaults to 0.8
     */
    triggerKeyboardNote(keyboardId: string, row: number, keyIndex: number, velocity: number = 0.8): void {
        // Validate input bounds to prevent array access errors
        if (row < MIN_KEYBOARD_ROW || row > MAX_KEYBOARD_ROW) return;
        if (keyIndex < MIN_KEY_INDEX || keyIndex > MAX_KEY_INDEX) return;

        // Clamp velocity to valid range (0-1) to prevent audio damage
        const clampedVelocity = Math.max(0, Math.min(1, velocity));

        const graphNodes = useGraphStore.getState().nodes;

        // Get the keyboard node
        const keyboardNode = graphNodes.get(keyboardId);
        if (!keyboardNode) return;

        // Get keyboard's row octave settings
        const keyboardData = keyboardNode.data as { rowOctaves?: number[] };
        const rowOctaves = keyboardData.rowOctaves ?? [4, 3, 2]; // Default octaves for rows 1, 2, 3
        const baseOctave = rowOctaves[row - 1] ?? 4;

        // Find which output port to use (same logic as releaseKeyboardNote)
        const sourcePortId = this.getKeyboardSourcePort(keyboardNode, row);
        if (!sourcePortId) return;

        // Get all connections from this port using O(1) indexed lookup
        const connections = this.getConnectionsFromSource(keyboardId, sourcePortId);

        // Process each connection to instruments
        for (const connection of connections) {
            const targetNodeId = connection.targetNodeId;
            const targetNode = graphNodes.get(targetNodeId);

            if (!targetNode) continue;

            // Check if target is an instrument type
            if (!INSTRUMENT_NODE_TYPES.includes(targetNode.type as typeof INSTRUMENT_NODE_TYPES[number])) continue;

            const targetPortId = connection.targetPortId;

            // Handle sampler nodes separately (they use SamplerRow instead of InstrumentRow)
            if (targetNode.type === 'sampler') {
                if (!isSamplerNodeData(targetNode.data)) continue;
                const samplerData = targetNode.data;

                // Find the sampler row for this keyboard connection
                const samplerRow = this.findSamplerRow(samplerData, keyboardId, sourcePortId);

                // Get the sampler adapter
                const sampler = this.getSamplerAdapter(targetNodeId);
                if (!sampler) {
                    continue;
                }

                // Calculate pitch: rootNote + (keyIndex * spread)
                const rootNote = samplerData.rootNote ?? 60; // Middle C

                let pitchOffset: number;
                let rowGain: number;

                if (samplerRow) {
                    // Row-based system: use row configuration
                    pitchOffset = keyIndex * (samplerRow.spread ?? 1);
                    rowGain = samplerRow.gain ?? 1;
                } else {
                    // Legacy fallback: 1 semitone per key, default gain
                    pitchOffset = keyIndex;
                    rowGain = samplerData.gain ?? 1;
                }

                const finalMidiNote = rootNote + pitchOffset;

                // Convert MIDI note to note name
                const octave = Math.floor(finalMidiNote / 12) - 1;
                const noteIndex = finalMidiNote % 12;
                const noteName = getNoteName(noteIndex, octave);

                // Apply row/default gain
                const finalVelocity = Math.max(0, Math.min(1, clampedVelocity * rowGain));

                sampler.playNote(noteName, finalVelocity);
                continue;
            }

            // Handle regular instrument nodes
            if (!isInstrumentNodeData(targetNode.data)) continue;
            const instrumentData = targetNode.data;

            // NEW: Check for row-based system first
            const instrumentRow = this.findInstrumentRow(instrumentData, keyboardId, sourcePortId);

            let noteName: string;
            let finalVelocity = clampedVelocity;

            if (instrumentRow) {
                // New row-based system: calculate note using spread
                // Spread-based offset: baseOffset + (keyIndex * spread)
                const spreadOffset = instrumentRow.baseOffset + (keyIndex * instrumentRow.spread);
                const finalOctave = instrumentRow.baseOctave + Math.floor(spreadOffset / 12);
                const noteIndex = instrumentRow.baseNote + (spreadOffset % 12);
                noteName = getNoteName(noteIndex, finalOctave);

                // Apply per-key gain from keyGains array (default 1.0 = normal, 2.0 = double)
                const keyGain = instrumentRow.keyGains?.[keyIndex] ?? 1;
                // Scale velocity by keyGain (already clamped at input)
                finalVelocity = Math.max(0, Math.min(1, clampedVelocity * keyGain));
            } else {
                // Legacy system: use per-port offsets
                const semitoneOffset = instrumentData.offsets?.[targetPortId] ?? 0;
                const octaveOffset = instrumentData.octaveOffsets?.[targetPortId] ?? 0;
                const noteOffset = instrumentData.noteOffsets?.[targetPortId] ?? 0;

                // Calculate final note
                const finalOctave = baseOctave + octaveOffset;
                const finalNoteIndex = keyIndex + noteOffset + semitoneOffset;

                // Convert to note name string (e.g., "C4", "D#4")
                noteName = getNoteName(finalNoteIndex, finalOctave);
            }

            // Get the instrument and play the note with adjusted velocity
            const instrument = this.getInstrument(targetNodeId);
            if (instrument) {
                instrument.playNote(noteName, finalVelocity);
            }
        }
    }

    /**
     * Get the source port ID for a keyboard row
     * Handles both bundled output mode and individual row ports
     */
    private getKeyboardSourcePort(keyboardNode: GraphNode, row: number): string | undefined {
        // Check if keyboard is using bundled output (simple mode) or individual ports (advanced mode)
        const bundlePort = keyboardNode.ports.find(p => p.id === 'bundle-out');

        if (bundlePort) {
            // Simple mode: use bundle port
            return 'bundle-out';
        }

        // Advanced mode or legacy: find the specific row port
        let sourcePortId = keyboardNode.ports.find(
            p => p.direction === 'output' && p.name.toLowerCase().includes(`row ${row}`)
        )?.id;

        // If no row-specific port found, try to use first available output port
        if (!sourcePortId) {
            sourcePortId = keyboardNode.ports.find(p => p.direction === 'output')?.id;
        }

        return sourcePortId;
    }

    /**
     * Find the instrument row that corresponds to a source keyboard and port
     */
    private findInstrumentRow(instrumentData: InstrumentNodeData, sourceNodeId: string, sourcePortId: string): InstrumentRow | undefined {
        if (!instrumentData.rows || instrumentData.rows.length === 0) {
            return undefined;
        }

        // Find row that matches BOTH the source node AND port
        return instrumentData.rows.find(row =>
            row.sourceNodeId === sourceNodeId &&
            (row.sourcePortId === sourcePortId || sourcePortId.includes(row.sourcePortId))
        );
    }

    /**
     * Find the sampler row that corresponds to a source keyboard and port
     */
    private findSamplerRow(samplerData: SamplerNodeData, sourceNodeId: string, sourcePortId: string): SamplerRow | undefined {
        if (!samplerData.rows || samplerData.rows.length === 0) {
            return undefined;
        }

        // Find row that matches BOTH the source node AND port
        return samplerData.rows.find(row =>
            row.sourceNodeId === sourceNodeId &&
            (row.sourcePortId === sourcePortId || sourcePortId.includes(row.sourcePortId))
        );
    }

    /**
     * Release a note from keyboard input
     * @param keyboardId - The keyboard node ID
     * @param row - The active row (1, 2, or 3)
     * @param keyIndex - The key index within the row (0-11 for chromatic octave)
     */
    releaseKeyboardNote(keyboardId: string, row: number, keyIndex: number): void {
        // Validate input bounds to prevent array access errors
        if (row < MIN_KEYBOARD_ROW || row > MAX_KEYBOARD_ROW) return;
        if (keyIndex < MIN_KEY_INDEX || keyIndex > MAX_KEY_INDEX) return;

        const graphNodes = useGraphStore.getState().nodes;

        // Get the keyboard node
        const keyboardNode = graphNodes.get(keyboardId);
        if (!keyboardNode) return;

        // Find which output port to use (same logic as triggerKeyboardNote)
        const sourcePortId = this.getKeyboardSourcePort(keyboardNode, row);
        if (!sourcePortId) return;

        // Get keyboard's row octave settings
        const keyboardData = keyboardNode.data as { rowOctaves?: number[] };
        const rowOctaves = keyboardData.rowOctaves ?? [4, 3, 2];
        const baseOctave = rowOctaves[row - 1] ?? 4;

        // Get all connections from this port using O(1) indexed lookup
        const connections = this.getConnectionsFromSource(keyboardId, sourcePortId);

        // Process each connection to instruments
        for (const connection of connections) {
            const targetNodeId = connection.targetNodeId;
            const targetNode = graphNodes.get(targetNodeId);

            if (!targetNode) continue;

            // Check if target is an instrument type
            if (!INSTRUMENT_NODE_TYPES.includes(targetNode.type as typeof INSTRUMENT_NODE_TYPES[number])) continue;

            const targetPortId = connection.targetPortId;

            // Handle sampler nodes separately (they use SamplerRow instead of InstrumentRow)
            if (targetNode.type === 'sampler') {
                if (!isSamplerNodeData(targetNode.data)) continue;
                const samplerData = targetNode.data;

                // Find the sampler row for this keyboard connection
                const samplerRow = this.findSamplerRow(samplerData, keyboardId, sourcePortId);

                // Get the sampler adapter
                const sampler = this.getSamplerAdapter(targetNodeId);
                if (!sampler) continue;

                // Calculate pitch: rootNote + (keyIndex * spread)
                const rootNote = samplerData.rootNote ?? 60; // Middle C
                let pitchOffset: number;

                if (samplerRow) {
                    // Row-based system: use row configuration
                    pitchOffset = keyIndex * (samplerRow.spread ?? 1);
                } else {
                    // Legacy fallback: 1 semitone per key
                    pitchOffset = keyIndex;
                }

                const finalMidiNote = rootNote + pitchOffset;

                // Convert MIDI note to note name
                const octave = Math.floor(finalMidiNote / 12) - 1;
                const noteIndex = finalMidiNote % 12;
                const noteName = getNoteName(noteIndex, octave);

                sampler.stopNote(noteName);
                continue;
            }

            // Handle regular instrument nodes
            if (!isInstrumentNodeData(targetNode.data)) continue;
            const instrumentData = targetNode.data;

            // NEW: Check for row-based system first
            const instrumentRow = this.findInstrumentRow(instrumentData, keyboardId, sourcePortId);

            let noteName: string;
            if (instrumentRow) {
                // New row-based system: calculate note using spread
                const spreadOffset = instrumentRow.baseOffset + (keyIndex * instrumentRow.spread);
                const finalOctave = instrumentRow.baseOctave + Math.floor(spreadOffset / 12);
                const noteIndex = instrumentRow.baseNote + (spreadOffset % 12);
                noteName = getNoteName(noteIndex, finalOctave);
            } else {
                // Legacy system: use per-port offsets
                const semitoneOffset = instrumentData.offsets?.[targetPortId] ?? 0;
                const octaveOffset = instrumentData.octaveOffsets?.[targetPortId] ?? 0;
                const noteOffset = instrumentData.noteOffsets?.[targetPortId] ?? 0;

                // Calculate final note (same as trigger)
                const finalOctave = baseOctave + octaveOffset;
                const finalNoteIndex = keyIndex + noteOffset + semitoneOffset;

                // Convert to note name string
                noteName = getNoteName(finalNoteIndex, finalOctave);
            }

            // Get the instrument and stop the note
            const instrument = this.getInstrument(targetNodeId);
            if (instrument) {
                instrument.stopNote(noteName);
            }
        }
    }

    /**
     * Trigger control signal on (e.g., sustain pedal down, switch on)
     * Routes control signal from keyboard to connected instruments
     * @param keyboardId - The keyboard node ID
     */
    triggerControlDown(keyboardId: string): void {
        const graphConnections = useGraphStore.getState().connections;
        const graphNodes = useGraphStore.getState().nodes;

        // Get the keyboard node
        const keyboardNode = graphNodes.get(keyboardId);
        if (!keyboardNode) return;

        // Find the control port using shared utility
        const controlPortId = getKeyboardControlPortId(keyboardNode);
        if (!controlPortId) return;

        // Find all connections from the control port
        for (const [, connection] of graphConnections) {
            if (connection.sourceNodeId === keyboardId && connection.sourcePortId === controlPortId) {
                const targetNodeId = connection.targetNodeId;
                const targetNode = graphNodes.get(targetNodeId);

                if (!targetNode) continue;

                // Get the instrument and activate control (pedal)
                // Use duck-typing: any instrument with setPedal method gets pedal support
                const instrument = this.getInstrument(targetNodeId);
                if (instrument && 'setPedal' in instrument) {
                    (instrument as { setPedal: (down: boolean) => void }).setPedal(true);
                }
            }
        }
    }

    /**
     * Trigger control signal off (e.g., sustain pedal up, switch off)
     * Routes control signal from keyboard to connected instruments
     * @param keyboardId - The keyboard node ID
     */
    triggerControlUp(keyboardId: string): void {
        const graphConnections = useGraphStore.getState().connections;
        const graphNodes = useGraphStore.getState().nodes;

        // Get the keyboard node
        const keyboardNode = graphNodes.get(keyboardId);
        if (!keyboardNode) return;

        // Find the control port using shared utility
        const controlPortId = getKeyboardControlPortId(keyboardNode);
        if (!controlPortId) return;

        // Find all connections from the control port
        for (const [, connection] of graphConnections) {
            if (connection.sourceNodeId === keyboardId && connection.sourcePortId === controlPortId) {
                const targetNodeId = connection.targetNodeId;
                const targetNode = graphNodes.get(targetNodeId);

                if (!targetNode) continue;

                // Get the instrument and deactivate control (pedal)
                // Use duck-typing: any instrument with setPedal method gets pedal support
                const instrument = this.getInstrument(targetNodeId);
                if (instrument && 'setPedal' in instrument) {
                    (instrument as { setPedal: (down: boolean) => void }).setPedal(false);
                }
            }
        }
    }

    // ============================================================================
    // MIDI Device Integration
    // ============================================================================

    /**
     * Subscribe a MIDI node to a device and route messages to connected instruments
     */
    subscribeMIDINode(midiNodeId: string, deviceId: string): void {
        // Unsubscribe from previous device if any
        this.unsubscribeMIDINode(midiNodeId);

        const manager = getMIDIManager();

        // MIDIManager already returns parsed events
        const subscription = manager.subscribe(deviceId, (event) => {
            // Route the parsed message to connected instruments
            // Note: Visual components subscribe separately via midiStore
            this.routeMIDIMessage(midiNodeId, event);
        });

        this.midiSubscriptions.set(midiNodeId, subscription.unsubscribe);
    }

    /**
     * Unsubscribe a MIDI node from its device
     */
    unsubscribeMIDINode(midiNodeId: string): void {
        const unsubscribe = this.midiSubscriptions.get(midiNodeId);
        if (unsubscribe) {
            unsubscribe();
            this.midiSubscriptions.delete(midiNodeId);
        }
    }

    /**
     * Route a parsed MIDI message to connected instruments
     */
    private routeMIDIMessage(
        midiNodeId: string,
        message: MIDIEvent
    ): void {

        const graphNodes = useGraphStore.getState().nodes;

        // Get the MIDI node
        const midiNode = graphNodes.get(midiNodeId);
        if (!midiNode) {
            return;
        }

        // Use cached connections for O(1) lookup instead of scanning all connections
        const midiConnections = this.midiConnectionCache.get(midiNodeId) ?? [];

        // Determine which source port this MIDI message corresponds to
        // For MiniLab 3: keys (48-72) → bundle-keys, pads (36-43 ch9) → pads bundle
        const matchingPortId = this.getMIDISourcePortId(midiNode, message);

        for (const connection of midiConnections) {
            const targetNodeId = connection.targetNodeId;
            const targetNode = graphNodes.get(targetNodeId);

            if (!targetNode) continue;

            // Check if target is an instrument
            if (!INSTRUMENT_NODE_TYPES.includes(targetNode.type as typeof INSTRUMENT_NODE_TYPES[number])) continue;

            // Get the instrument
            const instrument = this.getInstrument(targetNodeId);
            if (!instrument) continue;

            // Check if this connection matches the MIDI message's source port
            // If we can determine the port, only activate matching connections
            const connectionMatchesPort = !matchingPortId ||
                connection.sourcePortId.includes('bundle-keys') && matchingPortId === 'keys' ||
                connection.sourcePortId.includes('bundle-pads') && matchingPortId === 'pads' ||
                connection.sourcePortId === matchingPortId;

            // Route based on message type
            switch (message.type) {
                case 'noteOn': {
                    const noteName = midiNoteToName(message.note);
                    const velocity = normalizeMIDIValue(message.velocity);
                    instrument.playNote(noteName, velocity);
                    // Only activate visual feedback if this connection matches the source port
                    if (connectionMatchesPort) {
                        this.activateControlSignal(connection.id);
                    }
                    break;
                }

                case 'noteOff': {
                    const noteName = midiNoteToName(message.note);
                    instrument.stopNote(noteName);
                    // Only release visual feedback if this connection matches the source port
                    if (connectionMatchesPort) {
                        this.releaseControlSignal(connection.id);
                    }
                    break;
                }

                case 'cc': {
                    // Handle CC messages (e.g., sustain pedal CC 64)
                    if (message.controller === 64) {
                        // Sustain pedal - use duck-typing for any instrument with setPedal
                        if ('setPedal' in instrument) {
                            (instrument as { setPedal: (down: boolean) => void }).setPedal(message.value >= 64);
                        }
                        // Activate/release visual feedback for pedal (if connection matches)
                        if (connectionMatchesPort) {
                            if (message.value >= 64) {
                                this.activateControlSignal(connection.id);
                            } else {
                                this.releaseControlSignal(connection.id);
                            }
                        }
                    }
                    // Future: Handle other CC messages (mod wheel, expression, etc.)
                    break;
                }

                case 'pitchBend': {
                    // Future: Handle pitch bend
                    // Pitch bend value is -8192 to +8191, center is 0
                    break;
                }
            }
        }
    }

    /**
     * Determine which source port a MIDI message corresponds to
     * Returns a port identifier string or null if unknown
     */
    private getMIDISourcePortId(
        midiNode: GraphNode,
        message: MIDIEvent
    ): string | null {
        // MiniLab 3 specific mapping
        if (midiNode.type === 'minilab-3') {
            if (message.type === 'noteOn' || message.type === 'noteOff') {
                const note = message.note;
                const channel = message.channel;

                // Pads: notes 36-43 on channel 9 (channel 10 in human terms)
                if (channel === 9 && note >= 36 && note <= 43) {
                    return 'pads';
                }

                // Keys: notes 48-72 (C3-C5)
                if (note >= 48 && note <= 72) {
                    return 'keys';
                }
            }

            // CC messages map to specific controls
            if (message.type === 'cc') {
                // Could map specific CC numbers to knobs/faders here
                // For now, return null to activate all connections
                return null;
            }
        }

        // Generic MIDI node or unknown mapping - activate all connections
        return null;
    }

    /**
     * Update MIDI node device connection
     * Called when device selection changes
     */
    updateMIDIDevice(midiNodeId: string, deviceId: string | null): void {
        if (deviceId) {
            this.subscribeMIDINode(midiNodeId, deviceId);
        } else {
            this.unsubscribeMIDINode(midiNodeId);
        }
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const audioGraphManager = new AudioGraphManager();
