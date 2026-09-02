/**
 * Microphone Node — live audio input.
 *
 * SINGLE DEVICE OWNER: this component never opens its own `getUserMedia`. The
 * EXECUTOR owns exactly one OS mic stream and is the single source of truth; the
 * node only DECLARES intent (mute + selected device) via
 * `executor.setMicrophoneInput`, which is provably silent at the engine seam when
 * muted (wasm disconnects the worklet input; native `set_mic(node, false)`). So a
 * "muted" mic is truly off on stage, not merely dimmed here.
 *
 * The live level is the engine's per-node meter (`subscribeSignalLevels`, keyed
 * by node id) — the REAL signal reaching the engine, not a parallel
 * AnalyserNode — and it is drawn by an oj-ui `Meter` on the app's one shared
 * frame. Nothing about the level passes through React (UI-023): the old version
 * pushed a 16-element array into `useState` sixty times a second and re-rendered
 * the whole card for it.
 *
 * Mute/device persist in `node.data` and are re-applied to the executor on load
 * (PERSIST-1).
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { GraphNode, MicrophoneNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { useIsAgentPending } from '../../store/agentSessionStore';
import { getExecutor } from '../../audio/executor';
import { registerTimelineLevelWriter } from '../Arrangement/timelineSignalLevels';
import { meterScale } from '../Shell/masterSignal';
import { detectLowLatencyDevice } from '../../utils/audioDeviceDetection';
import {
    Callout,
    Chip,
    DeviceSelect,
    IconBolt,
    IconButton,
    IconMute,
    IconSpeaker,
    Meter,
    NodeShell,
    PortRow,
    type DeviceSelectItem,
    type MeterHandle,
} from '@openjammer/oj-ui';
import './MicrophoneNode.css';

interface MicrophoneNodeProps {
    node: GraphNode;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection: (portId: string) => boolean;
    handleHeaderMouseDown: (e: React.MouseEvent) => void;
    handleNodeMouseEnter: () => void;
    handleNodeMouseLeave: () => void;
    isSelected: boolean;
    isDragging: boolean;
    isHoveredWithConnections: boolean;
    incomingConnectionCount: number;
    style: React.CSSProperties;
}

interface AudioDevice {
    deviceId: string;
    label: string;
    isUSB?: boolean;
}

/** What the enumeration told us about our right to see this machine's inputs. */
type Access = 'unknown' | 'granted' | 'unnamed' | 'unavailable';

/** Below this the readout reads as silence. Same scale as the Speaker's. */
const FLOOR_DB = -60;

/** Linear 0..1 to the dB string. "Is my mic hot?" is a number, not a feeling. */
function formatInputDb(level: number): string {
    if (!Number.isFinite(level) || level <= 0) return '-∞ dB';
    const db = 20 * Math.log10(level);
    return db <= FLOOR_DB + 0.5 ? '-∞ dB' : `${db.toFixed(1)} dB`;
}

export const MicrophoneNode = memo(function MicrophoneNode({
    node,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    handleHeaderMouseDown,
    handleNodeMouseEnter,
    handleNodeMouseLeave,
    isSelected,
    isDragging,
    isHoveredWithConnections,
    style,
}: MicrophoneNodeProps) {
    const data = node.data as MicrophoneNodeData;
    const isAgentPending = useIsAgentPending(node.id);
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const setDeviceInfo = useAudioStore((s) => s.setDeviceInfo);

    // Use node-specific lowLatencyMode if set, otherwise the global setting.
    const lowLatencyMode = data.lowLatencyMode ?? audioConfig.lowLatencyMode;

    const [devices, setDevices] = useState<AudioDevice[]>([]);
    // Resolved once, up front: a browser with no `enumerateDevices` will never
    // gain one, and deciding that in the effect body would be a setState the
    // first render has to be re-run for.
    const [access, setAccess] = useState<Access>(() =>
        typeof navigator.mediaDevices?.enumerateDevices === 'function' ? 'unknown' : 'unavailable');
    const [showDevices, setShowDevices] = useState(false);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>(data.deviceId || 'default');
    const deviceSelectorRef = useRef<HTMLDivElement>(null);
    const meterRef = useRef<MeterHandle>(null);
    const readoutRef = useRef<HTMLSpanElement>(null);

    const isMuted = data.isMuted ?? false;
    const mutedRef = useRef(isMuted);
    // The frame writer reads this; syncing in an effect (not during render) is
    // what lets the meter stay outside React entirely.
    useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

    const outputPort = node.ports.find((p) => p.direction === 'output' && p.type === 'audio');
    const outputPortId = outputPort?.id || 'audio-out';

    // Enumerate input devices. Labels are withheld until the OS permission has
    // been granted once, and that is worth SAYING rather than showing a list of
    // "Microphone a1b2".
    useEffect(() => {
        if (!navigator.mediaDevices?.enumerateDevices) return;

        let cancelled = false;
        const updateDevices = async () => {
            try {
                const devs = await navigator.mediaDevices.enumerateDevices();
                if (cancelled) return;
                const raw = devs.filter((d) => d.kind === 'audioinput');
                const named = raw.filter((d) => d.label.length > 0);
                const inputs = named.map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label,
                    isUSB: detectLowLatencyDevice(d.label),
                }));
                setDevices(inputs);
                setAccess(raw.length === 0 ? 'unavailable' : named.length === 0 ? 'unnamed' : 'granted');

                const lowLatencyDevice = inputs.find((d) => d.isUSB);
                if (lowLatencyDevice) {
                    setDeviceInfo({ isUSBAudioInterface: true, deviceLabel: lowLatencyDevice.label });
                }

                // Recover an explicit route the OS no longer offers. `{ record: false }`
                // — the interface was unplugged; that is the environment, not an edit.
                // Undoing it would restore a deviceId that no longer exists.
                if (selectedDeviceId !== 'default' && named.length > 0 && !inputs.some((d) => d.deviceId === selectedDeviceId)) {
                    setSelectedDeviceId('default');
                    updateNodeData<MicrophoneNodeData>(node.id, { deviceId: 'default' }, { record: false });
                }
            } catch {
                if (!cancelled) {
                    setDevices([]);
                    setAccess('unavailable');
                }
            }
        };

        void updateDevices();
        navigator.mediaDevices.addEventListener('devicechange', updateDevices);
        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
        };
    }, [setDeviceInfo, selectedDeviceId, node.id, updateNodeData]);

    // Per-instance outside-click, so two Microphones do not share one dropdown
    // (UI-018).
    useEffect(() => {
        if (!showDevices) return;
        const handleClickOutside = (e: PointerEvent) => {
            if (!deviceSelectorRef.current?.contains(e.target as Node)) setShowDevices(false);
        };
        document.addEventListener('pointerdown', handleClickOutside);
        return () => document.removeEventListener('pointerdown', handleClickOutside);
    }, [showDevices]);

    // Drive the ENGINE mic input from this node's persisted intent. The executor
    // is the single device owner: it opens exactly one stream, feeds the engine
    // MicIn, and goes SILENT at the seam when muted. Re-applied on (re)load once
    // the audio context is ready (PERSIST-1) — a project saved muted reloads muted.
    useEffect(() => {
        if (!isAudioContextReady) return;
        getExecutor().setMicrophoneInput(node.id, { isMuted, deviceId: selectedDeviceId });
    }, [isAudioContextReady, node.id, isMuted, selectedDeviceId]);

    // The live level, on the shared frame. When muted the engine feed IS silence,
    // so the meter falls because the mic is truly off — not because we zeroed a
    // local analyser.
    //
    // The bars ride the SAME dB scale as the readout beside them (the shared
    // `meterScale`, -60…0 dBFS onto 0…1). Drawing the raw linear level under a dB
    // number would make the meter lie about its own readout: a normal −34 dB
    // input is 0.02 linear, which is an empty bar.
    useEffect(() => {
        let lastText = '';
        return registerTimelineLevelWriter((levels) => {
            const level = mutedRef.current ? 0 : (levels.get(node.id) ?? 0);
            meterRef.current?.setSignal(meterScale(level));
            const text = formatInputDb(level);
            if (text !== lastText && readoutRef.current) {
                lastText = text;
                readoutRef.current.textContent = text;
            }
        });
    }, [node.id]);

    const handleMuteToggle = useCallback(() => {
        updateNodeData<MicrophoneNodeData>(node.id, { isMuted: !isMuted });
    }, [node.id, isMuted, updateNodeData]);

    const handleDeviceSelect = useCallback((deviceId: string) => {
        setSelectedDeviceId(deviceId);
        updateNodeData<MicrophoneNodeData>(node.id, { deviceId });
        setShowDevices(false);
    }, [node.id, updateNodeData]);

    const deviceItems = useMemo<DeviceSelectItem[]>(
        () => [
            { id: 'default', label: 'Default Input' },
            ...devices
                .filter((d) => d.deviceId.length > 0 && d.deviceId !== 'default')
                .map((d) => ({ id: d.deviceId, label: d.label, lowLatency: d.isUSB })),
        ],
        [devices],
    );

    return (
        <NodeShell
            className={`schematic-node microphone-node${isHoveredWithConnections ? ' hover-connecting' : ''}`}
            style={style}
            title="Microphone"
            nodeType="IN"
            selected={isSelected}
            dragging={isDragging}
            agentPending={isAgentPending}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            outputs={
                <PortRow
                    side="output"
                    kind="audio"
                    label={outputPort?.name ?? 'Out'}
                    connected={hasConnection(outputPortId)}
                    data-node-id={node.id}
                    data-port-id={outputPortId}
                    data-port-type={outputPort?.type ?? 'audio'}
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(outputPortId, e); }}
                    onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(outputPortId, e); }}
                    onMouseEnter={() => handlePortMouseEnter?.(outputPortId)}
                    onMouseLeave={handlePortMouseLeave}
                />
            }
        >
            {/* What is coming in, right now. The one moving thing on the card, so
                it sits on the card surface — a meter drawn on an inset bed is a
                meter whose own bars are the colour of the bed. */}
            <div className={`mic-stage${isMuted ? ' is-muted' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
                <div className="mic-level">
                    <Meter ref={meterRef} bars={12} height={36} barWidth={5} label="Microphone input level" />
                    <span ref={readoutRef} className="oj-node__readout mic-db">
                        -&#8734; dB
                    </span>
                </div>
                <IconButton
                    className="mic-mute"
                    variant="node"
                    label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    aria-pressed={isMuted}
                    title={isMuted ? 'Muted — the engine input is silent' : 'Live — click to mute'}
                    onClick={handleMuteToggle}
                    icon={isMuted ? <IconMute size={18} /> : <IconSpeaker size={18} />}
                />
            </div>

            {/* Where it is coming from. */}
            <div ref={deviceSelectorRef} className="mic-route">
                <DeviceSelect
                    items={deviceItems}
                    value={selectedDeviceId}
                    open={showDevices}
                    onToggle={() => setShowDevices((v) => !v)}
                    onSelect={handleDeviceSelect}
                    ariaLabel="Microphone input device"
                    placeholder="Default Input"
                    disabled={access === 'unavailable'}
                />
                {lowLatencyMode && (
                    <div className="oj-node__meta">
                        <Chip tone="success">
                            <IconBolt size={12} aria-hidden="true" />
                            low latency
                        </Chip>
                    </div>
                )}
                {access === 'unnamed' && (
                    <Callout variant="warning" title="Inputs are unnamed">
                        The browser hides device names until you allow microphone access once.
                        The default input still works.
                    </Callout>
                )}
                {access === 'unavailable' && (
                    <Callout variant="danger" title="No input available">
                        This browser reports no audio input. Check the OS privacy settings,
                        then reload.
                    </Callout>
                )}
            </div>
        </NodeShell>
    );
});
