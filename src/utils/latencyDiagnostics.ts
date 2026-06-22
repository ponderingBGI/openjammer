/**
 * Latency Diagnostics Utility
 * Provides smart detection and user-friendly warnings for audio latency issues
 */

import type { LatencyClassification } from '../store/audioStore';

// ============================================================================
// Constants
// ============================================================================

/** Threshold in ms above which we suspect Bluetooth audio */
export const BLUETOOTH_LATENCY_THRESHOLD_MS = 100;

/** Duration in ms to suppress warning after dismissal (1 hour) */
export const WARNING_DISMISSAL_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// Types
// ============================================================================

export interface LatencyIssue {
    severity: 'high' | 'medium' | 'low';
    issue: string;
    fix: string;
    icon?: string;
}

export interface LatencyDiagnosis {
    issues: LatencyIssue[];
    suggestions: string[];
    showWarningBanner: boolean;
    overallSeverity: 'none' | 'low' | 'medium' | 'high';
}

export interface LatencyMetricsInput {
    baseLatency: number;
    outputLatency: number;
    totalLatency: number;
    estimatedRoundTrip: number;
    classification: LatencyClassification;
    isBluetoothSuspected: boolean;
    sampleRate: number;
}

// ============================================================================
// Diagnostic Functions
// ============================================================================

/**
 * Analyze latency metrics and diagnose issues
 */
export function diagnoseLatency(
    metrics: LatencyMetricsInput,
    lowLatencyModeEnabled: boolean
): LatencyDiagnosis {
    const issues: LatencyIssue[] = [];
    const suggestions: string[] = [];

    // 1. Check for Bluetooth audio (highest priority)
    if (metrics.isBluetoothSuspected) {
        issues.push({
            severity: 'high',
            issue: 'Bluetooth audio adds 100-200ms delay',
            fix: 'Connect wired headphones or speakers',
            icon: '🎧'
        });
    }

    // 2. Check overall latency classification
    if (metrics.classification === 'bad') {
        issues.push({
            severity: 'high',
            issue: `Audio latency is ${metrics.estimatedRoundTrip.toFixed(0)}ms - too high for live playing`,
            fix: 'Enable Low Latency Mode and use wired audio',
            icon: '⚠️'
        });
    } else if (metrics.classification === 'poor') {
        issues.push({
            severity: 'medium',
            issue: `Audio latency is ${metrics.estimatedRoundTrip.toFixed(0)}ms - may affect timing`,
            fix: 'Enable Low Latency Mode for better performance',
            icon: '⏱️'
        });
    }

    // 3. Check if low latency mode should be enabled
    if (!lowLatencyModeEnabled && metrics.classification !== 'excellent' && metrics.classification !== 'good') {
        suggestions.push('Enable Low Latency Mode in Audio Settings');
    }

    // 4. Browser-specific suggestions using feature detection (more reliable than UA sniffing)
    // Note: User-agent sniffing is unreliable - Edge includes "chrome", browsers spoof UAs
    if (metrics.classification === 'poor') {
        // Feature detection for browser engine
        const isChromium = 'chrome' in window && !('opr' in window);
        // Safari has a unique CSS property
        const isSafari = 'webkitLineBreak' in document.documentElement.style && !isChromium;

        if (isChromium && isWindowsPlatform()) {
            suggestions.push('Try launching Chrome with --enable-exclusive-audio flag for lower latency');
        } else if (isSafari) {
            suggestions.push('Safari has limited audio optimization - consider using Chrome or Firefox');
        } else {
            // Generic suggestion for all other browsers
            suggestions.push('Check your system audio settings for optimization options');
        }
    }

    // 5. General suggestions for poor latency
    if (metrics.classification === 'poor' || metrics.classification === 'bad') {
        suggestions.push('Close other audio applications (Spotify, YouTube, etc.)');
        suggestions.push('Use a USB audio interface for professional results');
    }

    // Determine overall severity
    let overallSeverity: LatencyDiagnosis['overallSeverity'] = 'none';
    if (issues.some(i => i.severity === 'high')) {
        overallSeverity = 'high';
    } else if (issues.some(i => i.severity === 'medium')) {
        overallSeverity = 'medium';
    } else if (issues.length > 0) {
        overallSeverity = 'low';
    }

    return {
        issues,
        suggestions,
        showWarningBanner: overallSeverity === 'high',
        overallSeverity
    };
}

/**
 * Get a user-friendly summary of the current latency state
 */
export function getLatencySummary(classification: LatencyClassification): string {
    switch (classification) {
        case 'excellent':
            return 'Your audio latency is excellent - perfect for professional use!';
        case 'good':
            return 'Your audio latency is good - great for playing instruments.';
        case 'acceptable':
            return 'Your audio latency is acceptable - fine for practice.';
        case 'poor':
            return 'Your audio latency is high - you may notice a delay when playing.';
        case 'bad':
            return 'Your audio latency is very high - not suitable for live playing.';
        default:
            return 'Measuring audio latency...';
    }
}

/**
 * Check if the user should see a latency warning
 * Returns true if latency is poor/bad and they haven't dismissed the warning recently
 */
export function shouldShowLatencyWarning(
    classification: LatencyClassification,
    dismissedAt: number | null
): boolean {
    // Don't show for good latency
    if (classification === 'excellent' || classification === 'good' || classification === 'acceptable') {
        return false;
    }

    // Don't show if dismissed within the cooldown period
    if (dismissedAt && Date.now() - dismissedAt < WARNING_DISMISSAL_DURATION_MS) {
        return false;
    }

    return true;
}

/**
 * Get Chrome-specific optimization instructions
 */
export function getChromeOptimizationInstructions(): string {
    return `To enable low-latency audio in Chrome:

1. Right-click your Chrome shortcut
2. Select "Properties"
3. In the "Target" field, add: --enable-exclusive-audio
4. Click "OK" and restart Chrome

This enables WASAPI exclusive mode which can reduce latency from ~60ms to ~10ms on Windows.

Note: This locks the audio device to Chrome while it's running.`;
}

/**
 * Detect if we're likely running on Windows
 */
export function isWindowsPlatform(): boolean {
    return navigator.platform.toLowerCase().includes('win');
}

/**
 * Detect if we're likely running on macOS
 */
export function isMacPlatform(): boolean {
    return navigator.platform.toLowerCase().includes('mac');
}

/**
 * Get platform-specific latency expectations
 */
export function getPlatformLatencyExpectation(): { min: number; typical: number; description: string } {
    if (isMacPlatform()) {
        return {
            min: 3,
            typical: 10,
            description: 'macOS Core Audio typically achieves 3-10ms latency'
        };
    } else if (isWindowsPlatform()) {
        return {
            min: 10,
            typical: 30,
            description: 'Windows WASAPI typically achieves 10-30ms latency'
        };
    } else {
        // Assume Linux
        return {
            min: 5,
            typical: 30,
            description: 'Linux audio latency varies by configuration (5-30ms typical)'
        };
    }
}
