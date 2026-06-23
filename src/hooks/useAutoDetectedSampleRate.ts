import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';

/**
 * Keep the user-facing sample-rate setting aligned with the engine/device rate.
 *
 * The browser AudioContext and the native cpal stream both report the sample rate
 * they actually negotiated. That live value is more trustworthy than a stored
 * request: browsers may ignore an unsupported request, and native devices often
 * run at their own default (44.1/48/96/192 kHz). Syncing the Settings value here
 * is control-thread/UI-only — it never rebuilds the stream, so a detected change
 * cannot ambush a set with an audio restart.
 */
export function useAutoDetectedSampleRate(): void {
    const ready = useAudioStore((s) => s.isAudioContextReady);
    const detectedSampleRate = useAudioStore((s) => s.audioMetrics.sampleRate);
    const detectedAt = useAudioStore((s) => s.audioMetrics.lastUpdated);
    const configuredSampleRate = useAudioStore((s) => s.audioConfig.sampleRate);
    const deviceSampleRate = useAudioStore((s) => s.deviceInfo.sampleRate);
    const setAudioConfig = useAudioStore((s) => s.setAudioConfig);
    const setDeviceInfo = useAudioStore((s) => s.setDeviceInfo);

    useEffect(() => {
        const sampleRate = Math.round(detectedSampleRate);
        if (!ready || detectedAt <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
            return;
        }

        if (deviceSampleRate !== sampleRate) {
            setDeviceInfo({ sampleRate });
        }
        if (configuredSampleRate !== sampleRate) {
            setAudioConfig({ sampleRate });
        }
    }, [
        ready,
        detectedSampleRate,
        detectedAt,
        configuredSampleRate,
        deviceSampleRate,
        setAudioConfig,
        setDeviceInfo,
    ]);
}
