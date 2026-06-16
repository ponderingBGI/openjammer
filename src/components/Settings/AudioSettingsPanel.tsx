/**
 * Audio Settings Panel - Configure audio latency and devices
 * Enhanced with detailed latency monitoring and smart warnings
 */

import { useState, useEffect } from 'react';
import { useAudioStore } from '../../store/audioStore';
import type { LatencyClassification } from '../../store/audioStore';
import { reinitAudioContext, getLatencyMetrics, startLatencyMonitoring } from '../../audio/audioContext';
import { getExecutor } from '../../audio/executor';
import { LowLatencyGuide } from '../Guides';
import { useLowLatencyGuide } from '../../store/guideStore';
import './AudioSettingsPanel.css';

// Friendly messages for each latency classification
const LATENCY_MESSAGES: Record<LatencyClassification, { message: string; hint: string }> = {
    excellent: {
        message: 'Perfect for real-time performance',
        hint: 'Professional-grade latency'
    },
    good: {
        message: 'Great for playing instruments',
        hint: 'Most musicians won\'t notice any delay'
    },
    acceptable: {
        message: 'Usable with slight delay',
        hint: 'Fine for practice, consider optimizing for recording'
    },
    poor: {
        message: 'Noticeable delay',
        hint: 'May affect timing - try enabling Low Latency Mode'
    },
    bad: {
        message: 'High latency detected',
        hint: 'Not recommended for live playing'
    }
};

export function AudioSettingsPanel() {
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const audioMetrics = useAudioStore((s) => s.audioMetrics);
    const deviceInfo = useAudioStore((s) => s.deviceInfo);
    const setAudioConfig = useAudioStore((s) => s.setAudioConfig);
    const updateAudioMetrics = useAudioStore((s) => s.updateAudioMetrics);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const setAudioContextReady = useAudioStore((s) => s.setAudioContextReady);

    const [pendingConfig, setPendingConfig] = useState(audioConfig);
    const [isRestarting, setIsRestarting] = useState(false);

    // Low latency guide
    const lowLatencyGuide = useLowLatencyGuide();

    // Sync pendingConfig with audioConfig when it changes externally
    useEffect(() => {
        setPendingConfig(audioConfig);
    }, [audioConfig]);

    // Monitor latency
    useEffect(() => {
        if (!isAudioContextReady) return;

        const stopMonitoring = startLatencyMonitoring((metrics) => {
            updateAudioMetrics({
                ...metrics,
                lastUpdated: Date.now()
            });
        }, 1000);

        return stopMonitoring;
    }, [updateAudioMetrics, isAudioContextReady]);

    // Apply configuration changes
    const handleApplyConfig = async () => {
        setIsRestarting(true);

        try {
            // Update store config first
            setAudioConfig(pendingConfig);

            // Mark audio context as not ready - this triggers App.tsx to dispose the executor
            setAudioContextReady(false);

            // Dispose the audio graph (clears all audio nodes)
            getExecutor().dispose();

            // Reinitialize audio context with new settings
            await reinitAudioContext({
                sampleRate: pendingConfig.sampleRate,
                latencyHint: pendingConfig.latencyHint,
                lowLatencyMode: pendingConfig.lowLatencyMode
            });

            // Mark audio context as ready again - this triggers App.tsx to reinitialize
            // the executor, which will rebuild all audio connections.
            // MicrophoneNode and other components will reinitialize with new settings.
            setAudioContextReady(true);

            // Update metrics
            const metrics = getLatencyMetrics();
            if (metrics) {
                updateAudioMetrics({
                    ...metrics,
                    lastUpdated: Date.now()
                });
            }
        } catch (err) {
            console.error('Failed to apply audio config:', err);
            alert('Failed to apply audio settings. Please try again.');
            // Try to restore audio context ready state on error
            setAudioContextReady(true);
        } finally {
            setIsRestarting(false);
        }
    };

    const hasChanges = JSON.stringify(pendingConfig) !== JSON.stringify(audioConfig);

    return (
        <div className="audio-settings-panel">
            {/* Low Latency Setup Guide Button */}
            <button
                className="guide-launch-btn"
                onClick={lowLatencyGuide.open}
            >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                </svg>
                Low Latency Setup Guide
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="arrow-icon">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>

            {/* Low Latency Guide Modal */}
            <LowLatencyGuide />

            {/* USB Audio Interface Detection */}
            {deviceInfo.isUSBAudioInterface && (
                <div className="audio-info-banner usb-detected">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
                    </svg>
                    <div>
                        <strong>USB Audio Interface Detected</strong>
                        <p>{deviceInfo.deviceLabel}</p>
                        <p className="suggestion">Enable Low Latency Mode for best performance</p>
                    </div>
                </div>
            )}

            {/* Enhanced Latency Status */}
            {isAudioContextReady && (
                <div className="latency-status-section">
                    <div className="latency-status-card">
                        <div className={`latency-status-indicator ${audioMetrics.classification}`}>
                            <span className={`latency-value-large ${audioMetrics.classification}`}>
                                {audioMetrics.estimatedRoundTrip.toFixed(0)}
                            </span>
                            <span className="latency-label-small">ms round-trip</span>
                        </div>
                        <div className="latency-status-info">
                            <div className="latency-status-message">
                                {LATENCY_MESSAGES[audioMetrics.classification].message}
                            </div>
                            <div className="latency-status-hint">
                                {LATENCY_MESSAGES[audioMetrics.classification].hint}
                            </div>
                        </div>
                    </div>

                    {/* Bluetooth Warning */}
                    {audioMetrics.isBluetoothSuspected && (
                        <div className="bluetooth-warning">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                            </svg>
                            <span>Bluetooth audio detected - connect wired headphones for lower latency</span>
                        </div>
                    )}

                    {/* Detailed Breakdown (expandable) */}
                    <details className="latency-breakdown">
                        <summary>View detailed breakdown</summary>
                        <div className="latency-breakdown-content">
                            <div className="latency-breakdown-row">
                                <span className="breakdown-label">Browser Processing</span>
                                <span className="breakdown-value">{audioMetrics.baseLatency.toFixed(1)} ms</span>
                            </div>
                            <div className="latency-breakdown-row">
                                <span className="breakdown-label">Audio Output Device</span>
                                <span className="breakdown-value">{audioMetrics.outputLatency.toFixed(1)} ms</span>
                            </div>
                            <div className="latency-breakdown-row">
                                <span className="breakdown-label">Tone.js Scheduler</span>
                                <span className="breakdown-value">{audioMetrics.toneJsLookAhead.toFixed(1)} ms</span>
                            </div>
                            <div className="latency-breakdown-row">
                                <span className="breakdown-label">Sample Rate</span>
                                <span className="breakdown-value">{(audioMetrics.sampleRate / 1000).toFixed(1)} kHz</span>
                            </div>
                            <div className="latency-breakdown-row total">
                                <span className="breakdown-label">Estimated Round-Trip</span>
                                <span className="breakdown-value highlight">{audioMetrics.estimatedRoundTrip.toFixed(1)} ms</span>
                            </div>
                        </div>
                    </details>

                    {/* Suggestions for poor/bad latency */}
                    {(audioMetrics.classification === 'poor' || audioMetrics.classification === 'bad') && !audioConfig.lowLatencyMode && (
                        <div className="latency-suggestions">
                            <h4>
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
                                </svg>
                                How to reduce latency
                            </h4>
                            <ul>
                                <li>Enable <strong>Low Latency Mode</strong> below</li>
                                <li>Use wired headphones instead of Bluetooth</li>
                                <li>Close other audio applications</li>
                                <li>Use a USB audio interface (like Focusrite Scarlett)</li>
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/* Audio Configuration */}
            <div className="audio-config-section">
                <h3>Audio Configuration</h3>

                {/* Sample Rate */}
                <div className="setting-group">
                    <label>Sample Rate</label>
                    <select
                        value={pendingConfig.sampleRate}
                        onChange={(e) => setPendingConfig({
                            ...pendingConfig,
                            sampleRate: Number(e.target.value)
                        })}
                    >
                        <option value={44100}>44.1 kHz (CD Quality)</option>
                        <option value={48000}>48 kHz (Recommended)</option>
                        <option value={96000}>96 kHz (High Quality)</option>
                    </select>
                    <p className="setting-description">
                        Higher sample rates provide better audio quality but increase CPU usage.
                    </p>
                </div>

                {/* Latency Hint */}
                <div className="setting-group">
                    <label>Latency Mode</label>
                    <select
                        value={pendingConfig.latencyHint}
                        onChange={(e) => setPendingConfig({
                            ...pendingConfig,
                            latencyHint: e.target.value as AudioContextLatencyCategory
                        })}
                    >
                        <option value="interactive">Interactive (Lowest Latency)</option>
                        <option value="balanced">Balanced</option>
                        <option value="playback">Playback (Highest Quality)</option>
                    </select>
                    <p className="setting-description">
                        Interactive mode minimizes latency for live performance.
                    </p>
                </div>

                {/* Low Latency Mode Toggle */}
                <div className="setting-group">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={pendingConfig.lowLatencyMode}
                            onChange={(e) => setPendingConfig({
                                ...pendingConfig,
                                lowLatencyMode: e.target.checked
                            })}
                        />
                        <span>Low Latency Mode</span>
                    </label>
                    <p className="setting-description">
                        Disables echo cancellation, noise suppression, and auto gain control
                        for microphone input. Reduces latency by 20-50ms.
                        <strong>Recommended with USB audio interfaces.</strong>
                    </p>
                </div>

                {/* Apply Button */}
                {hasChanges && (
                    <button
                        className="apply-config-btn"
                        onClick={handleApplyConfig}
                        disabled={isRestarting}
                    >
                        {isRestarting ? 'Restarting Audio...' : 'Apply Changes'}
                    </button>
                )}
            </div>

            {/* Browser Support Info */}
            <div className="audio-info-section">
                <h3>Browser Audio System</h3>
                <ul className="info-list">
                    <li>
                        <strong>Windows:</strong> Uses WASAPI (10-30ms latency)
                    </li>
                    <li>
                        <strong>macOS:</strong> Uses Core Audio (3-5ms latency)
                    </li>
                    <li>
                        <strong>Note:</strong> ASIO drivers are not accessible from browsers.
                        Use a USB audio interface for lowest latency.
                    </li>
                </ul>
            </div>
        </div>
    );
}
