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
 * panel and the agent never tell the player two different stories. The overlay
 * chrome (portal, scrim, Escape, focus-trap, click-outside) is the oj-ui Modal;
 * the header, status dots, and actions are oj-ui primitives.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, PanelHeader, Button, StatusDot } from '@openjammer/oj-ui';
import type { StatusDotStatus } from '@openjammer/oj-ui';
import { useAudioStore } from '../../store/audioStore';
import { isTauri } from '../../audio/executor';
import { gatherDiagnostics } from '../../utils/diagnostics';
import './AudioHealthPanel.css';
import { useBindingSet, useModalKeymap } from '../../keymap/useKeymap';

type Status = StatusDotStatus;

/** One readout row. */
function Row({ label, value, status, hint }: { label: string; value: string; status: Status; hint?: string }) {
    return (
        <div className="ah-row" title={hint}>
            <StatusDot status={status} />
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
    const modalEntries = useMemo(() => [{
        actionId: 'panel.audioHealth', run: () => { setOpen(false); return true; },
    }], []);
    useModalKeymap('audio-health', open, modalEntries);
    useBindingSet(useMemo(() => ({
        id: 'audio-health-toggle',
        scope: 'global' as const,
        entries: [{ actionId: 'panel.audioHealth', run: () => { setOpen((value) => !value); return true; } }],
    }), []));

    const ready = useAudioStore((s) => s.isAudioContextReady);
    const metrics = useAudioStore((s) => s.audioMetrics);
    const device = useAudioStore((s) => s.deviceInfo);
    const config = useAudioStore((s) => s.audioConfig);

    // Global toggle (Ctrl/Cmd+Shift+H) + the palette-command bridge. Escape-to-
    // close is now owned by the Modal's focus-trapped handler.
    useEffect(() => {
        const onCmd = () => setOpen((v) => !v);
        window.addEventListener('openjammer:toggle-audio-health', onCmd);
        return () => {
            window.removeEventListener('openjammer:toggle-audio-health', onCmd);
        };
    }, []);

    const close = () => setOpen(false);

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

    return (
        <Modal open={open} onClose={close} ariaLabel="Audio health" size="sm">
            <PanelHeader title="Audio health" onClose={close} />

            <div className="ah-rows">
                <Row
                    label="Audio engine"
                    value={ready ? 'running' : 'not started'}
                    status={ready ? 'ok' : 'idle'}
                    hint={ready || isTauri() ? undefined : 'Choose "Play here in your browser" to enable audio.'}
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
                <Button variant="secondary" className="ah-footer__btn" onClick={openSettings}>
                    Open Settings
                </Button>
                <Button variant="primary" className="ah-footer__btn" onClick={askAi}>
                    Ask AI to fix
                </Button>
            </footer>
        </Modal>
    );
}
