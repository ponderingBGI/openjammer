import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';

/**
 * Default Low Latency Mode ON when a USB / pro audio interface is in use.
 *
 * A USB interface bypasses the OS's processing chain, so a musician who plugs one
 * in almost always wants the low-latency path (no AGC / echo / noise processing on
 * the mic, the tightest buffer). We make that the *default* — not a setting they
 * have to hunt for — but strictly as a default:
 *
 *  - It never overrides an explicit choice (`lowLatencyUserSet`); the moment the
 *    player flips the toggle themselves, their choice wins for the session.
 *  - It only sets the store value; it never forces an engine restart. At audio
 *    start the context is created low-latency (gap-free). If the interface is
 *    plugged in mid-session, the running Microphone node re-acquires with
 *    low-latency constraints on its own (it re-inits when `lowLatencyMode` flips),
 *    while the audience hears no dropout — the Live Performance Rule, a held note
 *    beats a glitch.
 *
 * Mount once, near the app root.
 */
export function useUsbLowLatencyDefault(): void {
    const isUSB = useAudioStore((s) => s.deviceInfo.isUSBAudioInterface);
    const lowLatencyMode = useAudioStore((s) => s.audioConfig.lowLatencyMode);
    const userSet = useAudioStore((s) => s.lowLatencyUserSet);
    const setAudioConfig = useAudioStore((s) => s.setAudioConfig);

    useEffect(() => {
        if (!isUSB || userSet || lowLatencyMode) return;
        setAudioConfig({ lowLatencyMode: true });
    }, [isUSB, userSet, lowLatencyMode, setAudioConfig]);
}
