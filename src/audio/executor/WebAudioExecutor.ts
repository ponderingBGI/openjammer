/**
 * WebAudioExecutor — the Web Audio implementation of {@link Executor} (U9).
 *
 * Thin adapter shim over the existing `AudioGraphManager` singleton. Each method
 * forwards 1:1 to the manager (renaming a few methods to the seam's vocabulary).
 * No behavior changes: this is purely the indirection layer that lets the rest
 * of the app target the {@link Executor} contract.
 */

import { audioGraphManager } from '../AudioGraphManager';
import type { Looper } from '../Looper';
import type { Recorder } from '../Recorder';
import type { SamplerAdapter } from '../samplers/SamplerAdapter';
import type { Connection, GraphNode } from '../../engine/types';
import type {
    Executor,
    ConnectionChangeCallback,
    NodeChangeCallback,
    Unsubscribe
} from './Executor';

export class WebAudioExecutor implements Executor {
    // --- Lifecycle ---------------------------------------------------------

    initialize(
        subscribeToConnections: (callback: ConnectionChangeCallback) => Unsubscribe,
        subscribeToNodes: (callback: NodeChangeCallback) => Unsubscribe,
        getNodes: () => Map<string, GraphNode>,
        getConnections: () => Map<string, Connection>
    ): void {
        audioGraphManager.initialize(
            subscribeToConnections,
            subscribeToNodes,
            getNodes,
            getConnections
        );
    }

    dispose(): void {
        audioGraphManager.dispose();
    }

    // --- Note / control input ---------------------------------------------

    noteOn(keyboardId: string, row: number, keyIndex: number, velocity?: number): void {
        audioGraphManager.triggerKeyboardNote(keyboardId, row, keyIndex, velocity);
    }

    noteOff(keyboardId: string, row: number, keyIndex: number): void {
        audioGraphManager.releaseKeyboardNote(keyboardId, row, keyIndex);
    }

    controlDown(keyboardId: string): void {
        audioGraphManager.triggerControlDown(keyboardId);
    }

    controlUp(keyboardId: string): void {
        audioGraphManager.triggerControlUp(keyboardId);
    }

    activateControlSignal(connectionId: string): void {
        audioGraphManager.activateControlSignal(connectionId);
    }

    releaseControlSignal(connectionId: string): void {
        audioGraphManager.releaseControlSignal(connectionId);
    }

    // --- Speaker output ----------------------------------------------------

    setSpeakerVolume(nodeId: string, volume: number, isMuted: boolean): void {
        audioGraphManager.updateSpeakerVolume(nodeId, volume, isMuted);
    }

    setSpeakerDevice(nodeId: string, deviceId: string): void {
        audioGraphManager.updateSpeakerDevice(nodeId, deviceId);
    }

    // --- Signal level metering --------------------------------------------

    subscribeSignalLevels(callback: (levels: Map<string, number>) => void): Unsubscribe {
        return audioGraphManager.subscribeToSignalLevels(callback);
    }

    // --- Microphone --------------------------------------------------------

    setMicrophoneOutput(nodeId: string, outputNode: AudioNode): void {
        audioGraphManager.setMicrophoneOutput(nodeId, outputNode);
    }

    // --- Continuous sources ------------------------------------------------

    pauseContinuousSources(): void {
        audioGraphManager.pauseAllContinuousSources();
    }

    resumeContinuousSources(): void {
        audioGraphManager.resumeAllContinuousSources();
    }

    // --- Capability handles ------------------------------------------------

    getSamplerAdapter(nodeId: string): SamplerAdapter | null {
        return audioGraphManager.getSamplerAdapter(nodeId);
    }

    waitForSamplerAdapter(nodeId: string, timeoutMs?: number): Promise<SamplerAdapter | null> {
        return audioGraphManager.waitForSamplerAdapter(nodeId, timeoutMs);
    }

    getLooper(nodeId: string): Looper | null {
        return audioGraphManager.getLooper(nodeId);
    }

    getRecorder(nodeId: string): Recorder | null {
        return audioGraphManager.getRecorder(nodeId);
    }

    sendSampleBuffer(sourceNodeId: string, buffer: AudioBuffer): void {
        audioGraphManager.sendSampleBuffer(sourceNodeId, buffer);
    }
}
