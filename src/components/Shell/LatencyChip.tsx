/**
 * LatencyChip — the honest-latency signal, moved out of the surfaces' way.
 *
 * It used to be a full-width banner that collided with the arrangement's
 * transport row and, on the canvas, sat on top of the patch. On a live
 * instrument that is exactly backwards: a warning must be *seen* without
 * *stealing the moment* (PRODUCT.md, the Live Performance Rule). So the signal
 * becomes a small warning-ink chip in the topbar's status cluster, and the
 * detail — the same diagnosis, the same Fix now / Ask AI / Dismiss actions, the
 * same store — waits in a popover until the player asks for it.
 *
 * The honesty copy is never the dimmest pixel: the chip uses `--warning-ink`,
 * the contrast-safe text tone, not the raw warning fill.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Callout, Chip, IconWarning } from '@openjammer/oj-ui';
import { useAudioStore } from '../../store/audioStore';
import { diagnoseLatency, shouldShowLatencyWarning } from '../../utils/latencyDiagnostics';
import './LatencyChip.css';

const DISMISSED_KEY = 'latency-warning-dismissed';

export function LatencyChip({ onOpenSettings }: { onOpenSettings?: () => void }) {
    const audioMetrics = useAudioStore((s) => s.audioMetrics);
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);

    const [dismissed, setDismissed] = useState(false);
    const [dismissedAt, setDismissedAt] = useState<number | null>(null);
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    // Hydrate the dismissal ONCE on mount (external store -> React state).
    useEffect(() => {
        const stored = localStorage.getItem(DISMISSED_KEY);
        if (!stored) return;
        const timestamp = Number.parseInt(stored, 10);
        if (!Number.isNaN(timestamp) && timestamp > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating React state from localStorage (external store) once on mount; this is the sanctioned sync-from-external-system pattern
            setDismissedAt(timestamp);
        } else {
            console.warn('[LatencyChip] Invalid timestamp in localStorage, clearing');
            localStorage.removeItem(DISMISSED_KEY);
        }
    }, []);

    useEffect(() => {
        if (dismissedAt && !shouldShowLatencyWarning(audioMetrics.classification, dismissedAt)) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing chip visibility to live audio-classification changes (external engine state); intentional external-system sync
            setDismissed(true);
        }
    }, [audioMetrics.classification, dismissedAt]);

    useEffect(() => {
        if (!open) return;
        const away = (event: PointerEvent) => {
            if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', away);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', away);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);

    if (!isAudioContextReady || dismissed) return null;
    if (!shouldShowLatencyWarning(audioMetrics.classification, dismissedAt)) return null;

    const diagnosis = diagnoseLatency(audioMetrics, audioConfig.lowLatencyMode);
    if (!diagnosis.showWarningBanner) return null;

    const handleDismiss = () => {
        const now = Date.now();
        setOpen(false);
        setDismissed(true);
        setDismissedAt(now);
        try {
            localStorage.setItem(DISMISSED_KEY, now.toString());
        } catch (e) {
            if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                console.warn('[LatencyChip] localStorage full, dismissal will not persist');
            }
        }
    };

    const handleFixNow = () => {
        handleDismiss();
        onOpenSettings?.();
    };

    // Hand the latency problem to the AI co-pilot, seeded so it uses its
    // diagnostics/settings tools rather than guessing.
    const handleAskAi = () => {
        handleDismiss();
        window.dispatchEvent(
            new CustomEvent('openjammer:ask-ai', {
                detail: {
                    prompt:
                        'My audio latency is high in OpenJammer. Call get_diagnostics and ' +
                        'get_settings, tell me in a sentence why the round-trip is high, and fix ' +
                        'what you safely can — e.g. switch to the interactive latency hint, enable ' +
                        'low-latency mode, or recommend selecting a USB audio interface. Keep every ' +
                        'change reversible.',
                },
            }),
        );
    };

    const primaryIssue = diagnosis.issues[0];
    const roundTrip = Math.round(audioMetrics.estimatedRoundTrip ?? 0);

    return (
        <div className="oj-latency-chip" ref={wrapRef}>
            <button
                type="button"
                className="oj-latency-chip__trigger"
                aria-haspopup="dialog"
                aria-expanded={open}
                title="Audio latency is high — press for the details"
                onClick={() => setOpen((value) => !value)}
            >
                <Chip tone="warning">{roundTrip > 0 ? `${roundTrip} ms` : 'High latency'}</Chip>
            </button>

            {open && (
                <div className="oj-latency-chip__popover" role="dialog" aria-label="High audio latency">
                    <Callout variant="warning" icon={<IconWarning />} title="High audio latency">
                        <span>{primaryIssue?.issue || 'Your audio latency may affect live playing experience.'}</span>
                        <span className="oj-latency-chip__actions">
                            <Button variant="primary" onClick={handleFixNow}>Fix now</Button>
                            <Button variant="secondary" onClick={handleAskAi}>Ask AI</Button>
                            <Button variant="secondary" onClick={handleDismiss}>Dismiss</Button>
                        </span>
                    </Callout>
                </div>
            )}
        </div>
    );
}
