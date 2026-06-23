import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useUsbLowLatencyDefault } from '../useUsbLowLatencyDefault';
import { useAudioStore } from '../../store/audioStore';

function reset() {
    useAudioStore.setState({
        deviceInfo: { isUSBAudioInterface: false, deviceLabel: '', sampleRate: null },
        audioConfig: { sampleRate: 48000, latencyHint: 'interactive', lowLatencyMode: false },
        lowLatencyUserSet: false,
    });
}

describe('useUsbLowLatencyDefault', () => {
    beforeEach(reset);
    afterEach(cleanup);

    it('enables low latency when a USB interface is present', () => {
        useAudioStore.setState({
            deviceInfo: { isUSBAudioInterface: true, deviceLabel: 'Focusrite Scarlett 2i2', sampleRate: null },
        });
        renderHook(() => useUsbLowLatencyDefault());
        expect(useAudioStore.getState().audioConfig.lowLatencyMode).toBe(true);
    });

    it('never overrides an explicit user choice', () => {
        useAudioStore.setState({
            deviceInfo: { isUSBAudioInterface: true, deviceLabel: 'Scarlett', sampleRate: null },
            lowLatencyUserSet: true,
        });
        renderHook(() => useUsbLowLatencyDefault());
        expect(useAudioStore.getState().audioConfig.lowLatencyMode).toBe(false);
    });

    it('leaves a non-USB session untouched', () => {
        renderHook(() => useUsbLowLatencyDefault());
        expect(useAudioStore.getState().audioConfig.lowLatencyMode).toBe(false);
    });

    it('enables when a USB interface is plugged in after mount', () => {
        renderHook(() => useUsbLowLatencyDefault());
        expect(useAudioStore.getState().audioConfig.lowLatencyMode).toBe(false);

        act(() => {
            useAudioStore.setState({
                deviceInfo: { isUSBAudioInterface: true, deviceLabel: 'Behringer UMC204HD', sampleRate: null },
            });
        });

        expect(useAudioStore.getState().audioConfig.lowLatencyMode).toBe(true);
    });
});
