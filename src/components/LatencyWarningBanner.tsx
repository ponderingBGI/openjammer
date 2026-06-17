/**
 * Latency Warning Banner
 * Shows a dismissible warning when audio latency is too high
 */

import { useState, useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';
import { diagnoseLatency, shouldShowLatencyWarning } from '../utils/latencyDiagnostics';
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

    // Get the primary issue to display
    const primaryIssue = diagnosis.issues[0];

    return (
        <div className="latency-warning-banner">
            <div className="warning-icon">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                </svg>
            </div>
            <div className="warning-content">
                <div className="warning-title">High Audio Latency Detected</div>
                <div className="warning-message">
                    {primaryIssue?.issue || 'Your audio latency may affect live playing experience.'}
                </div>
            </div>
            <div className="warning-actions">
                <button className="warning-btn primary" onClick={handleFixNow}>
                    Fix Now
                </button>
                <button className="warning-btn secondary" onClick={handleDismiss}>
                    Dismiss
                </button>
            </div>
        </div>
    );
}
