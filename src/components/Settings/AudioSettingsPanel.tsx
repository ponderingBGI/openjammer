/**
 * Settings -> Audio — essentials first, depth on demand.
 *
 * The live latency readout is the hero; the output device and a single clear
 * "Low latency" control are the body; sample rate (auto-synced to the detected
 * device rate when possible), the latency hint, the click level and the numeric
 * breakdown live in a collapsed Advanced disclosure. Low latency defaults ON for
 * a USB interface (see useUsbLowLatencyDefault); changes are staged and applied
 * on the player's command so the brief audio restart never ambushes a set.
 *
 * Built from the shared `.oj-set-*` row vocabulary (SettingsPanel.css) so this
 * tab and every other tab speak one form language.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAudioStore } from '../../store/audioStore';
import type { LatencyClassification } from '../../store/audioStore';
import { reinitAudioContext } from '../../audio/audioContext';
import { getExecutor, isTauri } from '../../audio/executor';
import { useGraphStore } from '../../store/graphStore';
import type { MicrophoneNodeData, SpeakerNodeData } from '../../engine/types';
import { detectLowLatencyDevice } from '../../utils/audioDeviceDetection';
import { LowLatencyGuide } from '../Guides';
import { useLowLatencyGuide } from '../../store/guideStore';
import {
    Button,
    Callout,
    Chip,
    DeviceSelect,
    SegmentedControl,
    Select,
    Slider,
    Spinner,
    StatusDot,
    Surface,
    Toggle,
} from '@openjammer/oj-ui';
import type { StatusDotStatus } from '@openjammer/oj-ui';
import './AudioSettingsPanel.css';

/**
 * A native OUTPUT device, as enumerated by the Rust/cpal host. The
 * `list_output_devices` Tauri command returns these (B1): `id` is the stable
 * cpal `DeviceId` string the engine resolves on a controlled stream rebuild;
 * `name` is the human label for the picker.
 */
interface NativeOutputDevice {
    id: string;
    name: string;
}

/**
 * Resolve the Tauri `invoke` from the global IPC bridge (mirrors the native
 * executor's resolver — we read the same `__TAURI__` global rather than bundle
 * the `@tauri-apps/api` SDK). Returns null off the native tier, so the native
 * device picker simply does not render in the browser (which uses the per-node
 * Web-Audio picker on the Speaker node instead).
 */
function getTauriInvoke():
    | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
    | null {
    if (typeof window === 'undefined') return null;
    const t = (window as unknown as {
        __TAURI__?: {
            core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
            invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
    }).__TAURI__;
    if (!t) return null;
    if (t.core?.invoke) return t.core.invoke.bind(t.core);
    if (t.invoke) return t.invoke.bind(t);
    return null;
}

// Plain-language verdict for each latency band — the headline a musician reads.
const LATENCY_VERDICT: Record<LatencyClassification, string> = {
    excellent: 'Perfect for live performance',
    good: 'Great for playing live',
    acceptable: 'Usable, with a slight delay',
    poor: 'Noticeable delay',
    bad: 'Too much delay for live playing',
};

// Classification → the health dot, mirroring AudioHealthPanel so the two surfaces
// never tell different stories about the same number.
function latencyDot(c: LatencyClassification): StatusDotStatus {
    if (c === 'excellent' || c === 'good') return 'ok';
    if (c === 'acceptable') return 'warn';
    return 'bad';
}

const COMMON_SAMPLE_RATES = [44_100, 48_000, 96_000];

const LATENCY_HINTS = [
    { value: 'interactive', label: 'Interactive' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'playback', label: 'Playback' },
] as const;

function formatSampleRate(rate: number): string {
    const khz = rate / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function sampleRateOptionsFor(current: number, detected: number | null): number[] {
    return Array.from(
        new Set(
            [...COMMON_SAMPLE_RATES, current, detected]
                .filter((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate > 0)
                .map((rate) => Math.round(rate)),
        ),
    ).sort((a, b) => a - b);
}

export function AudioSettingsPanel() {
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const audioMetrics = useAudioStore((s) => s.audioMetrics);
    const deviceInfo = useAudioStore((s) => s.deviceInfo);
    const setAudioConfig = useAudioStore((s) => s.setAudioConfig);
    const setLowLatencyUserSet = useAudioStore((s) => s.setLowLatencyUserSet);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const setAudioContextReady = useAudioStore((s) => s.setAudioContextReady);

    const [pendingConfig, setPendingConfig] = useState(audioConfig);
    const [isRestarting, setIsRestarting] = useState(false);
    const [outputPickerOpen, setOutputPickerOpen] = useState(false);

    // Native (Tauri) output-device routing (B1). On the native tier the engine —
    // not Web Audio — owns the output stream, so the Speaker node's browser picker
    // does not apply; instead we enumerate the host's cpal devices here and route
    // the (single) Speaker node to the chosen device via the executor seam. The
    // whole section is suppressed in the browser, where the per-node picker rules.
    const isNative = isTauri();
    const [outputDevices, setOutputDevices] = useState<NativeOutputDevice[]>([]);
    // Subscribe to the node map (its reference changes on every graph edit) so the
    // routing controls stay correct as the Speaker / Microphone nodes appear and
    // vanish on the canvas; derive the (single) target node of each kind from it.
    const nodes = useGraphStore((s) => s.nodes);
    const speakerNode = [...nodes.values()].find((n) => n.type === 'speaker');
    const micNode = [...nodes.values()].find((n) => n.type === 'microphone');
    const selectedOutput = (speakerNode?.data as SpeakerNodeData | undefined)?.deviceId ?? 'default';

    // Low latency guide
    const lowLatencyGuide = useLowLatencyGuide();

    // Enumerate the host's output devices once on the native tier (and refresh
    // whenever this panel mounts). Best-effort: an empty/failed list just leaves
    // the picker on "System Default", which is always a valid target.
    useEffect(() => {
        if (!isNative) return;
        const invoke = getTauriInvoke();
        if (!invoke) return;
        let cancelled = false;
        invoke('list_output_devices')
            .then((res) => {
                if (cancelled) return;
                const devices = Array.isArray(res) ? (res as NativeOutputDevice[]) : [];
                setOutputDevices(devices);
            })
            .catch(() => {
                // Host enumeration failed — keep the default-only picker; selecting
                // "System Default" still routes correctly via the engine.
            });
        return () => {
            cancelled = true;
        };
    }, [isNative]);

    // Route the (single) Speaker node to the chosen output device. The engine
    // performs a brief controlled stream rebuild on the new device — the same
    // held-note gap as device-loss recovery (a held note beats a glitch). Records
    // the choice on the node so it survives reloads and reconciles with autosave.
    const handleOutputDeviceChange = useCallback(
        (deviceId: string) => {
            setOutputPickerOpen(false);
            if (!speakerNode) return;
            useGraphStore
                .getState()
                .updateNodeData<SpeakerNodeData>(speakerNode.id, { deviceId });
            getExecutor().setSpeakerDevice(speakerNode.id, deviceId);
        },
        [speakerNode],
    );

    // Route the (existing) Microphone node into the engine's input bus. The
    // executor is the single owner of the OS device; we declare intent (the node's
    // persisted mute/device) and it acquires/feeds the engine. Only offered when a
    // Microphone node is on the canvas — removing that node (Ctrl+Z) stops capture.
    const handleRouteMic = useCallback(() => {
        if (!micNode) return;
        const micData = micNode.data as MicrophoneNodeData;
        getExecutor().setMicrophoneInput(micNode.id, {
            isMuted: micData.isMuted ?? false,
            deviceId: micData.deviceId,
        });
    }, [micNode]);

    // Sync pendingConfig with audioConfig when it changes externally (e.g. the USB
    // auto-enable flipping low latency on — the toggle then reflects it with no
    // pending diff, so no stray "Apply" appears for a default we set automatically).
    useEffect(() => {
        setPendingConfig(audioConfig);
    }, [audioConfig]);

    // Apply configuration changes — the one place the engine restarts. The player
    // chooses the moment (the staged "Apply" button), so the brief gap never
    // ambushes a live set (the Live Performance Rule).
    const handleApplyConfig = async () => {
        setIsRestarting(true);
        try {
            setAudioConfig(pendingConfig);
            setAudioContextReady(false);
            getExecutor().dispose();
            await reinitAudioContext({
                sampleRate: pendingConfig.sampleRate,
                latencyHint: pendingConfig.latencyHint,
                lowLatencyMode: pendingConfig.lowLatencyMode,
            });
            setAudioContextReady(true);
        } catch (err) {
            console.error('Failed to apply audio config:', err);
            setAudioContextReady(true);
        } finally {
            setIsRestarting(false);
        }
    };

    // The player flips low latency themselves → record the intent so the USB
    // auto-enable never fights their choice for the rest of the session.
    const handleLowLatencyChange = (checked: boolean) => {
        setPendingConfig((prev) => ({ ...prev, lowLatencyMode: checked }));
        setLowLatencyUserSet(true);
    };

    const hasChanges = JSON.stringify(pendingConfig) !== JSON.stringify(audioConfig);
    const measured = isAudioContextReady && audioMetrics.estimatedRoundTrip > 0;
    const detectedSampleRate =
        deviceInfo.sampleRate ??
        (audioMetrics.lastUpdated > 0 && audioMetrics.sampleRate > 0
            ? Math.round(audioMetrics.sampleRate)
            : null);
    const sampleRateOptions = sampleRateOptionsFor(pendingConfig.sampleRate, detectedSampleRate);
    const sampleRateIsDetected = detectedSampleRate != null && pendingConfig.sampleRate === detectedSampleRate;
    const latencyHintValue =
        typeof pendingConfig.latencyHint === 'number' ? 'interactive' : pendingConfig.latencyHint;
    const showTips =
        measured &&
        (audioMetrics.classification === 'poor' || audioMetrics.classification === 'bad') &&
        !audioConfig.lowLatencyMode;
    const clickGain = pendingConfig.clickGain ?? 0.2;

    // The device list the native picker shows. "System Default" is always a valid
    // target, so it heads the list even when enumeration returned nothing.
    const outputItems = [
        { id: 'default', label: 'System Default' },
        ...outputDevices.map((device) => ({
            id: device.id,
            label: device.name,
            lowLatency: detectLowLatencyDevice(device.name),
        })),
    ];

    return (
        <div className="oj-set oj-aud">
            {/* Latency hero — the one lifted surface; reflects real measured metrics. */}
            <Surface className="oj-aud-hero" elevation="raised" radius="lg" role="status" aria-live="polite">
                {measured ? (
                    <div className="oj-aud-hero-main">
                        <div className="oj-aud-hero-state">
                            <StatusDot status={latencyDot(audioMetrics.classification)} />
                            <span className="oj-aud-ms">
                                <span className="oj-aud-ms-num">
                                    {Math.round(audioMetrics.estimatedRoundTrip)}
                                </span>{' '}
                                ms
                            </span>
                            <span className="oj-aud-verdict">
                                {LATENCY_VERDICT[audioMetrics.classification]}
                            </span>
                        </div>
                        <div className="oj-aud-hero-meta">
                            <Chip>{audioMetrics.source === 'native' ? 'Native engine' : 'Browser'}</Chip>
                            <Chip>{(audioMetrics.sampleRate / 1000).toFixed(1)} kHz</Chip>
                            {deviceInfo.isUSBAudioInterface && <Chip tone="success">USB interface</Chip>}
                        </div>
                    </div>
                ) : isAudioContextReady ? (
                    <div className="oj-aud-hero-state">
                        <Spinner size={18} />
                        <span className="oj-aud-verdict">Measuring latency…</span>
                    </div>
                ) : (
                    <div className="oj-aud-hero-main">
                        <div className="oj-aud-hero-state">
                            <StatusDot status="idle" />
                            <span className="oj-aud-verdict">Start audio to measure latency</span>
                        </div>
                        <span className="oj-set-row__desc">
                            Press play once and the round-trip appears here.
                        </span>
                    </div>
                )}
            </Surface>

            {audioMetrics.isBluetoothSuspected && (
                <Callout variant="warning" title="Bluetooth output adds delay">
                    Wired headphones or a USB interface play tighter.
                </Callout>
            )}

            {/* Devices + the one clear low-latency control. */}
            <section className="oj-set-section">
                <h3 className="oj-set-section__title">Devices</h3>

                {isNative ? (
                    <div className="oj-set-row">
                        <div className="oj-set-row__text">
                            <span className="oj-set-row__label">Output</span>
                            <span className="oj-set-row__desc">
                                {speakerNode
                                    ? 'Where the engine sends sound.'
                                    : 'Add a Speaker node to the canvas to choose an output.'}
                            </span>
                        </div>
                        <div className="oj-set-row__control">
                            <DeviceSelect
                                className="oj-aud-device"
                                ariaLabel="Output device"
                                items={outputItems}
                                value={selectedOutput}
                                open={outputPickerOpen}
                                disabled={!speakerNode}
                                onToggle={() => setOutputPickerOpen((value) => !value)}
                                onSelect={handleOutputDeviceChange}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="oj-set-row">
                        <div className="oj-set-row__text">
                            <span className="oj-set-row__label">Output</span>
                            <span className="oj-set-row__desc">
                                Chosen on the Speaker node on your canvas.
                            </span>
                        </div>
                    </div>
                )}

                {isNative && micNode && (
                    <div className="oj-set-row">
                        <div className="oj-set-row__text">
                            <span className="oj-set-row__label">Microphone</span>
                            <span className="oj-set-row__desc">
                                Capture your mic into the engine. Use headphones to avoid feedback.
                            </span>
                        </div>
                        <div className="oj-set-row__control">
                            <Button variant="secondary" onClick={handleRouteMic}>
                                Capture mic
                            </Button>
                        </div>
                    </div>
                )}
            </section>

            <section className="oj-set-section">
                <h3 className="oj-set-section__title">Latency</h3>

                <Toggle
                    label="Low latency"
                    description={
                        deviceInfo.isUSBAudioInterface
                            ? 'On by default for your USB interface — strips mic processing for the tightest timing.'
                            : 'Strips echo, noise & gain processing from the mic for tighter timing. Best with a USB interface.'
                    }
                    checked={pendingConfig.lowLatencyMode}
                    onChange={handleLowLatencyChange}
                />

                {showTips && (
                    <Callout variant="tip" title="How to go faster">
                        <ul className="oj-aud-tips">
                            <li>Turn on <strong>Low latency</strong> above.</li>
                            <li>Use wired headphones, not Bluetooth.</li>
                            <li>Close other apps using audio.</li>
                            <li>Play through a USB audio interface.</li>
                        </ul>
                    </Callout>
                )}

                <div className="oj-set-actions">
                    <Button variant="secondary" onClick={lowLatencyGuide.open}>
                        Set up low latency…
                    </Button>
                </div>
            </section>

            {/* Advanced — engineer depth, collapsed by default. */}
            <details className="oj-aud-advanced">
                <summary>Advanced</summary>
                <div className="oj-aud-advanced-body">
                    <div className="oj-set-row">
                        <div className="oj-set-row__text">
                            <span className="oj-set-row__label">
                                Sample rate
                                {sampleRateIsDetected && <Chip>Detected</Chip>}
                            </span>
                            <span className="oj-set-row__desc">
                                {detectedSampleRate
                                    ? `Detected from the running audio device at ${formatSampleRate(detectedSampleRate)}. Change only if you need another rate.`
                                    : 'Detected when audio starts; higher rates use more CPU.'}
                            </span>
                        </div>
                        <div className="oj-set-row__control">
                            {sampleRateOptions.length <= 4 ? (
                                <SegmentedControl
                                    aria-label="Sample rate"
                                    value={String(pendingConfig.sampleRate)}
                                    options={sampleRateOptions.map((rate) => ({
                                        value: String(rate),
                                        label: formatSampleRate(rate),
                                    }))}
                                    onChange={(value) =>
                                        setPendingConfig((prev) => ({ ...prev, sampleRate: Number(value) }))
                                    }
                                />
                            ) : (
                                <Select
                                    aria-label="Sample rate"
                                    value={pendingConfig.sampleRate}
                                    onChange={(e) =>
                                        setPendingConfig((prev) => ({
                                            ...prev,
                                            sampleRate: Number(e.target.value),
                                        }))
                                    }
                                >
                                    {sampleRateOptions.map((rate) => (
                                        <option key={rate} value={rate}>
                                            {formatSampleRate(rate)}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </div>
                    </div>

                    <div className="oj-set-row">
                        <div className="oj-set-row__text">
                            <span className="oj-set-row__label">Buffer hint</span>
                            <span className="oj-set-row__desc">
                                {pendingConfig.lowLatencyMode
                                    ? 'Low latency overrides this.'
                                    : 'Interactive asks the device for the smallest buffer it will give.'}
                            </span>
                        </div>
                        <div className="oj-set-row__control">
                            <SegmentedControl
                                aria-label="Buffer hint"
                                value={latencyHintValue}
                                disabled={pendingConfig.lowLatencyMode}
                                options={LATENCY_HINTS.map((hint) => ({ ...hint }))}
                                onChange={(value) =>
                                    setPendingConfig((prev) => ({
                                        ...prev,
                                        latencyHint: value as AudioContextLatencyCategory,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className="oj-set-row">
                        <div className="oj-set-row__text">
                            <span className="oj-set-row__label">Click level</span>
                            <span className="oj-set-row__desc">Level used by the metronome and count-in.</span>
                        </div>
                        <div className="oj-set-row__control oj-aud-slider">
                            <Slider
                                aria-label="Click level"
                                min={0}
                                max={1}
                                step={0.05}
                                value={clickGain}
                                onChange={(value) =>
                                    setPendingConfig((prev) => ({ ...prev, clickGain: value }))
                                }
                            />
                            <output className="oj-set-value">{Math.round(clickGain * 100)}%</output>
                        </div>
                    </div>

                    {measured && (
                        <div className="oj-aud-breakdown">
                            <div className="oj-aud-bd-row">
                                <span className="oj-aud-bd-label">Backend</span>
                                <span className="oj-set-value">
                                    {audioMetrics.source === 'native'
                                        ? 'Native engine (cpal)'
                                        : 'Browser (AudioContext)'}
                                </span>
                            </div>
                            {audioMetrics.source === 'browser' ? (
                                <>
                                    <div className="oj-aud-bd-row">
                                        <span className="oj-aud-bd-label">Browser processing</span>
                                        <span className="oj-set-value">
                                            {audioMetrics.baseLatency.toFixed(1)} ms
                                        </span>
                                    </div>
                                    <div className="oj-aud-bd-row">
                                        <span className="oj-aud-bd-label">Output device</span>
                                        <span className="oj-set-value">
                                            {audioMetrics.outputLatency.toFixed(1)} ms
                                        </span>
                                    </div>
                                </>
                            ) : (
                                <div className="oj-aud-bd-row">
                                    <span className="oj-aud-bd-label">Negotiated buffer</span>
                                    <span className="oj-set-value">
                                        {audioMetrics.bufferFrames != null
                                            ? `${audioMetrics.bufferFrames} frames`
                                            : 'device period'}
                                    </span>
                                </div>
                            )}
                            <div className="oj-aud-bd-row oj-aud-bd-total">
                                <span className="oj-aud-bd-label">Round-trip</span>
                                <span className="oj-set-value">
                                    {audioMetrics.estimatedRoundTrip.toFixed(1)} ms
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            </details>

            {hasChanges && (
                <Button
                    variant="primary"
                    className="oj-aud-apply"
                    onClick={handleApplyConfig}
                    loading={isRestarting}
                >
                    {isRestarting ? 'Restarting…' : 'Apply — restarts audio briefly'}
                </Button>
            )}

            <LowLatencyGuide />
        </div>
    );
}
