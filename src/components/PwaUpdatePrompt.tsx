/**
 * PwaUpdatePrompt (§6 R3) — channel-aware, apply-on-idle PWA updates.
 *
 * The service worker is registered `prompt` (not autoUpdate), so a new version
 * NEVER silently reloads the page mid-show. When one is ready this:
 *   • applies it AUTOMATICALLY while audio is idle (the safe moment — no
 *     AudioContext to yank), and
 *   • otherwise surfaces a non-blocking toast so the performer applies it
 *     themselves at a break.
 * Renders nothing; it just wires {@link useServiceWorker} to the audio state.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useServiceWorker } from '../hooks/usePWA';
import { useAudioStore } from '../store/audioStore';

/** Build channel (mirrors the diagnostics snapshot) for a channel-aware message. */
const CHANNEL =
    import.meta.env.VITE_OJ_CANARY === 'true' || import.meta.env.VITE_OJ_CANARY === '1'
        ? 'canary'
        : 'stable';

export function PwaUpdatePrompt() {
    const { needRefresh, updateServiceWorker } = useServiceWorker();
    const audioReady = useAudioStore((s) => s.isAudioContextReady);
    const toastShown = useRef(false);

    useEffect(() => {
        if (!needRefresh) return;

        // Apply-on-idle: if no AudioContext is running, it is safe to swap the SW
        // and reload now (a short grace so a just-loaded app settles first).
        if (!audioReady) {
            const t = setTimeout(() => updateServiceWorker(), 1500);
            return () => clearTimeout(t);
        }

        // Audio IS running: never reload under the performer. Offer it once.
        if (!toastShown.current) {
            toastShown.current = true;
            toast(`A new ${CHANNEL} version is ready`, {
                description: 'It will apply automatically when you stop audio, or update now.',
                duration: Infinity,
                action: { label: 'Update now', onClick: () => updateServiceWorker() },
            });
        }
    }, [needRefresh, audioReady, updateServiceWorker]);

    return null;
}
