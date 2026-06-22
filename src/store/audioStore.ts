/**
 * Audio Store - Manages audio engine state, keyboard mapping, and mode switching
 */

import { create } from 'zustand';
import { getExecutor } from '../audio/executor';
import { resumeAudio } from '../audio/audioContext';
import type { LatencyClassification } from '../audio/executor/latency';
import { getConnectionsForRow, getConnectionsForPedal } from '../utils/connectionActivity';

// Re-exported for back-compat: the classification type now lives with the
// latency seam (`audio/executor/latency`), its single source of truth.
export type { LatencyClassification };

// ============================================================================
// Audio Configuration Types
// ============================================================================

export interface AudioConfig {
    sampleRate: number; // User-requested or auto-detected engine/device rate in Hz.
    latencyHint: AudioContextLatencyCategory | number;
    lowLatencyMode: boolean; // Disables echo cancellation, noise suppression, AGC
}

export interface AudioMetrics {
    source: 'native' | 'browser'; // Which backend produced this snapshot
    running: boolean;             // Whether that backend is actually making sound
    baseLatency: number;          // Browser processing (ms); 0 on native
    outputLatency: number;        // Output device / cpal buffering floor (ms)
    totalLatency: number;         // baseLatency + outputLatency (ms)
    estimatedRoundTrip: number;   // Total perceived latency for live playing (ms)
    classification: LatencyClassification;
    isBluetoothSuspected: boolean; // True if outputLatency > 100ms (browser only)
    bufferFrames: number | null;  // Native fixed buffer; null = device period / browser
    sampleRate: number;           // Current sample rate (Hz)
    lastUpdated: number;          // Timestamp
}

export interface DeviceInfo {
    isUSBAudioInterface: boolean;
    deviceLabel: string;
    sampleRate: number | null; // Last detected engine/device rate, if known.
}

// ============================================================================
// Store Interface
// ============================================================================

interface AudioStore {
    // Audio Context State
    isAudioContextReady: boolean;
    setAudioContextReady: (ready: boolean) => void;

    // Audio Configuration
    audioConfig: AudioConfig;
    setAudioConfig: (config: Partial<AudioConfig>) => void;

    // True once the player has explicitly chosen a low-latency state this session.
    // Gates the USB auto-enable (useUsbLowLatencyDefault) so we never override an
    // explicit choice. Deliberately NOT persisted — each launch re-evaluates the
    // USB default, but an explicit toggle wins for the rest of the session.
    lowLatencyUserSet: boolean;
    setLowLatencyUserSet: (userSet: boolean) => void;

    // Audio Metrics
    audioMetrics: AudioMetrics;
    updateAudioMetrics: (metrics: Partial<AudioMetrics>) => void;

    // Device Detection
    deviceInfo: DeviceInfo;
    setDeviceInfo: (info: Partial<DeviceInfo>) => void;

    // Selected devices
    selectedInputDevice: string | null;
    selectedOutputDevice: string | null;
    setSelectedInputDevice: (deviceId: string | null) => void;
    setSelectedOutputDevice: (deviceId: string | null) => void;

    // Control State (sustain pedal, switches, triggers)
    controlDown: boolean;
    setControlDown: (down: boolean) => void;

    // Keyboard Velocity (0-1 normalized for computer keyboard)
    defaultVelocity: number; // 0-1, default 0.8
    setDefaultVelocity: (velocity: number) => void;

    // Mode Switching (key 1 = config mode, 2-9 = keyboard nodes)
    currentMode: number; // 1 = config, 2-9 = keyboard node modes
    setCurrentMode: (mode: number) => void;

    // Tracks if current mode has no keyboard assigned (for warning display)
    isModeUnassigned: boolean;

    // Active Keyboard Node (when in mode 2-9)
    activeKeyboardId: string | null;
    setActiveKeyboard: (keyboardId: string | null) => void;

    // Keyboard number to node ID mapping
    keyboardNumberMap: Map<number, string>;
    registerKeyboard: (num: number, nodeId: string) => void;
    unregisterKeyboard: (num: number) => void;
    getKeyboardByNumber: (num: number) => string | null;

    // Active Keys (for visual feedback)
    activeKeys: Set<string>;
    pressKey: (key: string) => void;
    releaseKey: (key: string) => void;
    clearActiveKeys: () => void;

    // Keyboard signal emission (triggers notes on connected instruments)
    emitKeyboardSignal: (keyboardId: string, row: number, keyIndex: number) => void;
    releaseKeyboardSignal: (keyboardId: string, row: number, keyIndex: number) => void;

    // Control signal emission (triggers control down/up on connected instruments)
    emitControlDown: (keyboardId: string) => void;
    emitControlUp: (keyboardId: string) => void;

    // Used keyboard numbers tracking (for auto-assignment)
    usedKeyboardNumbers: Set<number>;
    claimKeyboardNumber: (num: number) => void;
    releaseKeyboardNumber: (num: number) => void;
    getNextFreeKeyboardNumber: () => number;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
    // Audio Context State
    isAudioContextReady: false,
    setAudioContextReady: (ready) => set({ isAudioContextReady: ready }),

    // Audio Configuration
    audioConfig: {
        sampleRate: 48000,
        latencyHint: 'interactive',
        lowLatencyMode: false
    },
    setAudioConfig: (config) => set((state) => ({
        audioConfig: { ...state.audioConfig, ...config }
    })),

    lowLatencyUserSet: false,
    setLowLatencyUserSet: (userSet) => set({ lowLatencyUserSet: userSet }),

    // Audio Metrics
    audioMetrics: {
        source: 'browser' as const,
        running: false,
        baseLatency: 0,
        outputLatency: 0,
        totalLatency: 0,
        estimatedRoundTrip: 0,
        classification: 'good' as LatencyClassification,
        isBluetoothSuspected: false,
        bufferFrames: null,
        sampleRate: 48000,
        lastUpdated: 0
    },
    updateAudioMetrics: (metrics) => set((state) => ({
        audioMetrics: { ...state.audioMetrics, ...metrics }
    })),

    // Device Info
    deviceInfo: {
        isUSBAudioInterface: false,
        deviceLabel: '',
        sampleRate: null
    },
    setDeviceInfo: (info) => set((state) => ({
        deviceInfo: { ...state.deviceInfo, ...info }
    })),

    // Selected Devices
    selectedInputDevice: null,
    selectedOutputDevice: null,
    setSelectedInputDevice: (deviceId) => set({ selectedInputDevice: deviceId }),
    setSelectedOutputDevice: (deviceId) => set({ selectedOutputDevice: deviceId }),

    // Control State (sustain pedal, switches, triggers)
    controlDown: false,
    setControlDown: (down) => set({ controlDown: down }),

    // Keyboard Velocity
    defaultVelocity: 0.8,
    setDefaultVelocity: (velocity) => set({ defaultVelocity: Math.max(0, Math.min(1, velocity)) }),

    // Mode Switching
    currentMode: 1, // Start in config mode
    setCurrentMode: (mode) => {
        const state = get();
        // Check if mode 2-9 has a keyboard assigned
        const isModeUnassigned = mode >= 2 && mode <= 9 && !state.keyboardNumberMap.has(mode);

        // If switching to a keyboard mode, also set the active keyboard
        if (mode >= 2 && mode <= 9) {
            const keyboardId = state.keyboardNumberMap.get(mode) || null;
            set({
                currentMode: mode,
                isModeUnassigned,
                activeKeyboardId: keyboardId
            });
        } else {
            set({
                currentMode: mode,
                isModeUnassigned: false,
                activeKeyboardId: null
            });
        }
    },
    isModeUnassigned: false,

    // Active Keyboard
    activeKeyboardId: null,
    setActiveKeyboard: (keyboardId) => set({ activeKeyboardId: keyboardId }),

    // Keyboard number mapping
    keyboardNumberMap: new Map(),
    registerKeyboard: (num, nodeId) => set((state) => {
        const newMap = new Map(state.keyboardNumberMap);
        newMap.set(num, nodeId);
        // Update isModeUnassigned if current mode now has a keyboard
        const isModeUnassigned = state.currentMode >= 2 && state.currentMode <= 9 && !newMap.has(state.currentMode);
        return { keyboardNumberMap: newMap, isModeUnassigned };
    }),
    unregisterKeyboard: (num) => set((state) => {
        const newMap = new Map(state.keyboardNumberMap);
        newMap.delete(num);
        // Update isModeUnassigned if current mode lost its keyboard
        const isModeUnassigned = state.currentMode >= 2 && state.currentMode <= 9 && !newMap.has(state.currentMode);
        return { keyboardNumberMap: newMap, isModeUnassigned };
    }),
    getKeyboardByNumber: (num) => get().keyboardNumberMap.get(num) || null,

    // Active Keys
    activeKeys: new Set(),

    pressKey: (key) => set((state) => {
        const newActiveKeys = new Set(state.activeKeys);
        newActiveKeys.add(key);
        return { activeKeys: newActiveKeys };
    }),

    releaseKey: (key) => set((state) => {
        const newActiveKeys = new Set(state.activeKeys);
        newActiveKeys.delete(key);
        return { activeKeys: newActiveKeys };
    }),

    clearActiveKeys: () => set({ activeKeys: new Set() }),

    // Keyboard signal emission
    emitKeyboardSignal: (keyboardId, row, keyIndex) => {
        // Ensure AudioContext is running (user gesture triggered this)
        resumeAudio().catch(() => { /* ignore - context may not exist yet */ });

        // Track active key for visual feedback
        const keyId = `${keyboardId}-${row}-${keyIndex}`;
        set(state => ({
            activeKeys: new Set(state.activeKeys).add(keyId)
        }));

        // Trigger note on connected instruments via the executor with normalized velocity
        const velocity = get().defaultVelocity;
        const executor = getExecutor();
        executor.noteOn(keyboardId, row, keyIndex, velocity);

        // Activate visual feedback on connection cables
        const connectionIds = getConnectionsForRow(keyboardId, row);
        connectionIds.forEach(id => executor.activateControlSignal(id));
    },

    releaseKeyboardSignal: (keyboardId, row, keyIndex) => {
        // Remove active key
        const keyId = `${keyboardId}-${row}-${keyIndex}`;
        set(state => {
            const newKeys = new Set(state.activeKeys);
            newKeys.delete(keyId);
            return { activeKeys: newKeys };
        });

        // Release note on connected instruments
        const executor = getExecutor();
        executor.noteOff(keyboardId, row, keyIndex);

        // Release visual feedback on connection cables (fades out over 120ms)
        const connectionIds = getConnectionsForRow(keyboardId, row);
        connectionIds.forEach(id => executor.releaseControlSignal(id));
    },

    // Control signal emission (sustain pedal)
    emitControlDown: (keyboardId) => {
        set({ controlDown: true });
        const executor = getExecutor();
        executor.controlDown(keyboardId);

        // Activate visual feedback on pedal connection cables
        const connectionIds = getConnectionsForPedal(keyboardId);
        connectionIds.forEach(id => executor.activateControlSignal(id));
    },

    emitControlUp: (keyboardId) => {
        set({ controlDown: false });
        const executor = getExecutor();
        executor.controlUp(keyboardId);

        // Release visual feedback on pedal connection cables
        const connectionIds = getConnectionsForPedal(keyboardId);
        connectionIds.forEach(id => executor.releaseControlSignal(id));
    },

    // Keyboard Number Management
    usedKeyboardNumbers: new Set(),

    claimKeyboardNumber: (num) => set((state) => {
        const newUsed = new Set(state.usedKeyboardNumbers);
        newUsed.add(num);
        return { usedKeyboardNumbers: newUsed };
    }),

    releaseKeyboardNumber: (num) => set((state) => {
        const newUsed = new Set(state.usedKeyboardNumbers);
        newUsed.delete(num);
        return { usedKeyboardNumbers: newUsed };
    }),

    getNextFreeKeyboardNumber: () => {
        const used = get().usedKeyboardNumbers;
        for (let i = 2; i <= 9; i++) {
            if (!used.has(i)) return i;
        }
        return 2; // Fallback to 2 if all used
    }
}));
