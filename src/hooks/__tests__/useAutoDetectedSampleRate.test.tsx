import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useAutoDetectedSampleRate } from '../useAutoDetectedSampleRate';
import { useAudioStore } from '../../store/audioStore';

function reset() {
    useAudioStore.setState({
        isAudioContextReady: false,
        audioConfig: { sampleRate: 48000, latencyHint: 'interactive', lowLatencyMode: false },
        audioMetrics: {
            source: 'browser',
            running: false,
            baseLatency: 0,
            outputLatency: 0,
            totalLatency: 0,
            estimatedRoundTrip: 0,
            classification: 'good',
            isBluetoothSuspected: false,
            bufferFrames: null,
            sampleRate: 48000,
            lastUpdated: 0,
        },
        deviceInfo: { isUSBAudioInterface: false, deviceLabel: '', sampleRate: null },
    });
}

describe('useAutoDetectedSampleRate', () => {
    beforeEach(reset);
    afterEach(cleanup);

    it('syncs the settings sample rate to the live detected rate', () => {
        renderHook(() => useAutoDetectedSampleRate());

        act(() => {
            useAudioStore.setState((state) => ({
                isAudioContextReady: true,
                audioMetrics: {
                    ...state.audioMetrics,
                    running: true,
                    sampleRate: 96000,
                    lastUpdated: 123,
                },
            }));
        });

        expect(useAudioStore.getState().audioConfig.sampleRate).toBe(96000);
        expect(useAudioStore.getState().deviceInfo.sampleRate).toBe(96000);
    });

    it('ignores the boot default until latency metrics have reported', () => {
        useAudioStore.setState({
            audioConfig: { sampleRate: 44100, latencyHint: 'interactive', lowLatencyMode: false },
        });

        renderHook(() => useAutoDetectedSampleRate());

        act(() => {
            useAudioStore.setState((state) => ({
                isAudioContextReady: true,
                audioMetrics: {
                    ...state.audioMetrics,
                    sampleRate: 48000,
                    lastUpdated: 0,
                },
            }));
        });

        expect(useAudioStore.getState().audioConfig.sampleRate).toBe(44100);
        expect(useAudioStore.getState().deviceInfo.sampleRate).toBeNull();
    });

    it('rounds fractional backend readings before publishing to settings', () => {
        renderHook(() => useAutoDetectedSampleRate());

        act(() => {
            useAudioStore.setState((state) => ({
                isAudioContextReady: true,
                audioMetrics: {
                    ...state.audioMetrics,
                    sampleRate: 44100.4,
                    lastUpdated: 456,
                },
            }));
        });

        expect(useAudioStore.getState().audioConfig.sampleRate).toBe(44100);
        expect(useAudioStore.getState().deviceInfo.sampleRate).toBe(44100);
    });
});
