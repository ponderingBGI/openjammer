/**
 * Latency Warning Banner
 * Shows a dismissible warning when audio latency is too high
 */

import { useState, useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';
import { diagnoseLatency, shouldShowLatencyWarning } from '../utils/latencyDiagnostics';
import { Banner, Button, IconWarning } from '@openjammer/oj-ui';
import './LatencyWarningBanner.css';

// Local storage key for dismissed timestamp
const DISMISSED_KEY = 'latency-warning-dismissed';

interface LatencyWarningBannerProps {
    onOpenSettings?: () => void;
}

export function LatencyWarningBanner({ onOpenSettings }: LatencyWarningBannerProps) {
    const audioMetrics = useAudioStore((s) => s.audioMetrics);
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);

    const [dismissed, setDismissed] = useState(false);
    const [dismissedAt, setDismissedAt] = useState<number | null>(null);

    // Load dismissed state from localStorage ONCE on mount (prevents race condition)
    useEffect(() => {
        const stored = localStorage.getItem(DISMISSED_KEY);
        if (stored) {
            const timestamp = parseInt(stored, 10);
            // Validate the parsed timestamp - NaN check prevents corrupted data issues
            if (!isNaN(timestamp) && timestamp > 0) {
                // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating React state from localStorage (external store) once on mount; this is the sanctioned sync-from-external-system pattern
                setDismissedAt(timestamp);
            } else {
                console.warn('[LatencyWarningBanner] Invalid timestamp in localStorage, clearing');
                localStorage.removeItem(DISMISSED_KEY);
            }
        }
    }, []); // Empty deps - only run on mount

    // Check if we should show warning based on dismissedAt and current classification
    useEffect(() => {
        if (dismissedAt && !shouldShowLatencyWarning(audioMetrics.classification, dismissedAt)) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing banner visibility to live audio-classification changes (external engine state); intentional external-system sync
            setDismissed(true);
        }
    }, [audioMetrics.classification, dismissedAt]);

    // Don't show if not ready, dismissed, or latency is acceptable
    if (!isAudioContextReady || dismissed) {
        return null;
    }

    // Check if we should show the warning
    if (!shouldShowLatencyWarning(audioMetrics.classification, dismissedAt)) {
        return null;
    }

    // Get diagnosis
    const diagnosis = diagnoseLatency(audioMetrics, audioConfig.lowLatencyMode);

    // Only show if there are high-severity issues
    if (!diagnosis.showWarningBanner) {
        return null;
    }

    const handleDismiss = () => {
        const now = Date.now();
        setDismissed(true);
        setDismissedAt(now);

        try {
            localStorage.setItem(DISMISSED_KEY, now.toString());
        } catch (e) {
            // Handle QuotaExceededError (storage full, private browsing, iOS limits)
            if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                console.warn('[LatencyWarningBanner] localStorage full, dismissal will not persist');
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

    // Get the primary issue to display
    const primaryIssue = diagnosis.issues[0];

    return (
        <div className="latency-warning-banner">
            <Banner
                tone="warning"
                icon={<IconWarning />}
                title="High Audio Latency Detected"
                message={primaryIssue?.issue || 'Your audio latency may affect live playing experience.'}
                actions={
                    <>
                        <Button variant="primary" onClick={handleFixNow}>
                            Fix Now
                        </Button>
                        <Button variant="secondary" onClick={handleAskAi}>
                            Ask AI
                        </Button>
                        <Button variant="secondary" onClick={handleDismiss}>
                            Dismiss
                        </Button>
                    </>
                }
            />
        </div>
    );
}
