/**
 * AudioHealthPanel (§4) — a one-screen "is my sound OK?" readout.
 *
 * Surfaces the SAME live diagnostics the AI assistant reads (`get_diagnostics`):
 * whether the AudioContext is running, the measured round-trip latency + its
 * classification, the sample rate, the selected output device, and cross-origin
 * isolation. Each row is a calm green / amber / red status so a performer can see
 * at a glance what's wrong — and fix it in one tap (Open Settings, or hand it to
 * the AI). Toggled with Ctrl/Cmd+Shift+H or the "Audio health" palette command.
 *
 * It reads the live Zustand audio store directly (reactive), mirroring the shape
 * of {@link import('../../ai/envAdapter').createEnvPort}'s diagnostics so the
 * panel and the agent never tell the player two different stories.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAudioStore } from '../../store/audioStore';
import { gatherDiagnostics } from '../../utils/diagnostics';
import './AudioHealthPanel.css';

type Status = 'ok' | 'warn' | 'bad' | 'idle';

/** One readout row. */
function Row({ label, value, status, hint }: { label: string; value: string; status: Status; hint?: string }) {
    return (
        <div className="ah-row" data-status={status} title={hint}>
            <span className="ah-dot" data-status={status} aria-hidden />
            <span className="ah-label">{label}</span>
            <span className="ah-value">{value}</span>
        </div>
    );
}

/** The latency classification → status colour. */
function latencyStatus(cls: string): Status {
    switch (cls) {
        case 'excellent':
        case 'good':
            return 'ok';
        case 'acceptable':
            return 'warn';
        default:
            return 'bad';
    }
}

const ASK_AI_SEED =
    'Check my audio health in OpenJammer: call get_diagnostics and get_logs, tell me ' +
    'in a sentence what (if anything) is wrong, and fix what you safely can — reversibly.';

export function AudioHealthPanel() {
    const [open, setOpen] = useState(false);

    const ready = useAudioStore((s) => s.isAudioContextReady);
    const metrics = useAudioStore((s) => s.audioMetrics);
    const device = useAudioStore((s) => s.deviceInfo);
    const config = useAudioStore((s) => s.audioConfig);

    // Global toggle + the palette-command bridge.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const hit = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h';
            if (!hit) return;
            e.preventDefault();
            setOpen((v) => !v);
        };
        const onCmd = () => setOpen((v) => !v);
        window.addEventListener('keydown', onKey);
        window.addEventListener('openjammer:toggle-audio-health', onCmd);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('openjammer:toggle-audio-health', onCmd);
        };
    }, []);

    if (!open) return null;

    const env = gatherDiagnostics();
    const rtMs = metrics.estimatedRoundTrip;
    const coi = env.crossOriginIsolated;

    const askAi = () => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent('openjammer:ask-ai', { detail: { prompt: ASK_AI_SEED } }));
    };
    const openSettings = () => {
        setOpen(false);
        window.dispatchEvent(new CustomEvent('openjammer:toggle-settings'));
    };

    return createPortal(
        <div className="ah-overlay" onClick={() => setOpen(false)}>
            <div className="ah-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Audio health">
                <header className="ah-header">
                    <span className="ah-title">Audio health</span>
                    <span className="ah-spacer" />
                    <button className="ah-btn" onClick={() => setOpen(false)} title="Close (Ctrl/Cmd+Shift+H)">
                        ✕
                    </button>
                </header>

                <div className="ah-rows">
                    <Row
                        label="Audio engine"
                        value={ready ? 'running' : 'not started'}
                        status={ready ? 'ok' : 'idle'}
                        hint={ready ? undefined : 'Click "Start OpenJammer" to enable audio.'}
                    />
                    <Row
                        label="Round-trip latency"
                        value={ready ? `${Math.round(rtMs)} ms (${metrics.classification})` : '—'}
                        status={ready ? latencyStatus(metrics.classification) : 'idle'}
                        hint="Lower is better; a USB interface + the interactive hint help."
                    />
                    <Row
                        label="Sample rate"
                        value={ready ? `${metrics.sampleRate || config.sampleRate} Hz` : `${config.sampleRate} Hz (set)`}
                        status="ok"
                    />
                    <Row
                        label="Output device"
                        value={device.deviceLabel || 'system default'}
                        status={device.isUSBAudioInterface ? 'ok' : 'warn'}
                        hint={device.isUSBAudioInterface ? 'USB audio interface detected.' : 'Built-in output — a USB interface lowers latency.'}
                    />
                    <Row
                        label="Cross-origin isolation"
                        value={coi ? 'on (low-latency path)' : 'off (fallback path)'}
                        status={coi ? 'ok' : 'warn'}
                        hint="Required for the SharedArrayBuffer zero-latency control ring."
                    />
                    <Row label="OpenJammer" value={`${env.version} (${env.channel})`} status="ok" />
                </div>

                <footer className="ah-footer">
                    <button className="ah-btn ah-btn-primary" onClick={openSettings}>
                        Open Settings
                    </button>
                    <button className="ah-btn ah-btn-ai" onClick={askAi}>
                        Ask AI to fix
                    </button>
                </footer>
            </div>
        </div>,
        document.body,
    );
}
