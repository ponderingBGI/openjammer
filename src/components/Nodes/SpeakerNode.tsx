/**
 * Speaker Node — the canvas's master output, and the New DNA's signature
 * faceplate (the handoff's "Output" card): a LEVEL knob, a big live meter, and
 * one exact dB readout. Everything else on the card is a fact about the route.
 *
 * Two rules this file exists to keep:
 *
 *  1. The meter AND the readout never pass through React. Both ride the app's
 *     one shared animation frame and write a custom property / a text node
 *     directly (UI-023). A meter that re-rendered a node 60 times a second
 *     would put the whole tree on the audio-visual hot path for a pixel height.
 *  2. Device discovery is display-only. The global low-latency policy owns
 *     defaults (P10); the sole automatic route change here is recovery when the
 *     OS reports that an explicitly selected output was unplugged — a held note
 *     beats a glitch.
 */

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import type { GraphNode, SpeakerNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { getExecutor } from '../../audio/executor';
import { registerTimelineLevelWriter } from '../Arrangement/timelineSignalLevels';
import {
    type EnhancedAudioDevice,
    enhanceAudioDevices,
    sortDevicesByPriority,
    detectLowLatencyDevice,
} from '../../utils/audioDeviceDetection';
import {
    Callout,
    Chip,
    DeviceSelect,
    IconBolt,
    IconButton,
    IconMute,
    IconSpeaker,
    Knob,
    Meter,
    NodeShell,
    PortRow,
    type DeviceSelectItem,
    type MeterHandle,
} from '@openjammer/oj-ui';
import { useGestureBracket } from './nodeControls';
import './SpeakerNode.css';

interface SpeakerNodeProps {
    node: GraphNode;
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;
    hasConnection?: (portId: string) => boolean;
    handleHeaderMouseDown?: (e: React.MouseEvent) => void;
    handleNodeMouseEnter?: () => void;
    handleNodeMouseLeave?: () => void;
    isSelected?: boolean;
    isDragging?: boolean;
    isHoveredWithConnections?: boolean;
    style?: React.CSSProperties;
}

/** Below this the readout reads as silence, exactly like the handoff prototype. */
const FLOOR_DB = -60;

/** Linear 0..1 to the dB string a performer reads. */
function formatDb(level: number): string {
    if (!Number.isFinite(level) || level <= 0) return '-∞ dB';
    const db = 20 * Math.log10(level);
    return db <= FLOOR_DB + 0.5 ? '-∞ dB' : `${db.toFixed(1)} dB`;
}

/**
 * The meter's own scale: -60…0 dBFS mapped onto 0…1, so 0 dBFS stays exactly
 * 1.0 and the clip latch keeps meaning what it says. A linear meter is a lie
 * dressed as precision. Mirrors `Shell/masterSignal`.
 */
function meterScale(level: number): number {
    if (!Number.isFinite(level) || level <= 0) return 0;
    const db = 20 * Math.log10(level);
    return Math.max(0, Math.min(1, 1 + db / -FLOOR_DB));
}

export const SpeakerNode = memo(function SpeakerNode({
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
}: SpeakerNodeProps) {
    const data = node.data as SpeakerNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);

    const [devices, setDevices] = useState<EnhancedAudioDevice[]>([]);
    const [showDevices, setShowDevices] = useState(false);
    const deviceSelectorRef = useRef<HTMLDivElement>(null);
    const [supportsSinkId] = useState(() => {
        const audio = document.createElement('audio');
        return typeof (audio as HTMLAudioElement & { setSinkId?: unknown }).setSinkId === 'function';
    });
    const isMuted = data.isMuted ?? false;
    const volume = data.volume ?? 1;

    const meterRef = useRef<MeterHandle>(null);
    const readoutRef = useRef<HTMLSpanElement>(null);
    const mutedRef = useRef(isMuted);
    // The frame writer reads this; keeping it in sync in an effect (not during
    // render) is what lets the meter stay outside React entirely.
    useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

    // Device discovery is display-only on mount. The global low-latency policy owns
    // defaults; the sole automatic route change here is recovery when the OS reports
    // that an explicitly selected output was unplugged (held note beats a glitch).
    useEffect(() => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        let cancelled = false;

        const updateDevices = async (recoverMissingSelection: boolean) => {
            try {
                const devs = await navigator.mediaDevices.enumerateDevices();
                if (cancelled) return;
                const outputs = devs.filter((d) => d.kind === 'audiooutput');
                const sorted = sortDevicesByPriority(enhanceAudioDevices(outputs));
                setDevices(sorted);

                if (recoverMissingSelection) {
                    const current = useGraphStore.getState().nodes.get(node.id);
                    const selectedId = (current?.data as SpeakerNodeData | undefined)?.deviceId ?? 'default';
                    const hasEnumeratedIds = sorted.some((device) => device.deviceId.length > 0);
                    if (hasEnumeratedIds && selectedId !== 'default' && !sorted.some((device) => device.deviceId === selectedId)) {
                        updateNodeData<SpeakerNodeData>(node.id, { deviceId: 'default' });
                        getExecutor().setSpeakerDevice(node.id, 'default');
                    }
                }
            } catch {
                if (!cancelled) setDevices([]);
            }
        };

        void updateDevices(false);

        const handleDeviceChange = () => { void updateDevices(true); };
        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
    }, [node.id, updateNodeData]);

    // Close the device list on any pointer-down outside THIS node's own selector
    // — a per-instance ref, so two Speakers no longer fight over one global
    // `querySelector` (UI-018).
    useEffect(() => {
        if (!showDevices) return;
        const handleClickOutside = (e: PointerEvent) => {
            if (!deviceSelectorRef.current?.contains(e.target as Node)) setShowDevices(false);
        };
        document.addEventListener('pointerdown', handleClickOutside);
        return () => document.removeEventListener('pointerdown', handleClickOutside);
    }, [showDevices]);

    const currentDeviceId = data.deviceId || 'default';
    const currentDevice = devices.find((d) => d.deviceId === currentDeviceId);
    const currentLabel = currentDevice?.label || 'Default Output';
    const isCurrentLowLatency = currentDevice?.isLowLatency || detectLowLatencyDevice(currentLabel);

    /**
     * The list the picker shows: the OS default first, then every enumerated
     * output. Devices whose id the browser withholds before permission are left
     * out — an unpickable row is a lie.
     */
    const deviceItems = useMemo<DeviceSelectItem[]>(
        () => [
            { id: 'default', label: 'Default Output' },
            ...devices
                .filter((d) => d.deviceId.length > 0 && d.deviceId !== 'default')
                .map((d) => ({
                    id: d.deviceId,
                    label: d.label || 'Output',
                    lowLatency: d.isLowLatency,
                })),
        ],
        [devices],
    );

    const handleDeviceSelect = useCallback((deviceId: string) => {
        updateNodeData<SpeakerNodeData>(node.id, { deviceId });
        setShowDevices(false);
        getExecutor().setSpeakerDevice(node.id, deviceId);
    }, [node.id, updateNodeData]);

    // Re-apply the persisted volume/mute to the engine on (re)load once the audio
    // context is ready, and whenever they change (PERSIST-1).
    useEffect(() => {
        if (!isAudioContextReady) return;
        getExecutor().setSpeakerVolume(node.id, volume, isMuted);
    }, [isAudioContextReady, node.id, volume, isMuted]);

    // The meter AND the dB readout, from the engine's per-node level for this
    // SpeakerOut (VIS-1), on the app's ONE shared frame. No React state: one
    // custom-property write and one text node per frame, and the text only when
    // the number actually changed.
    useEffect(() => {
        let lastText = '';
        return registerTimelineLevelWriter((levels) => {
            const raw = mutedRef.current ? 0 : (levels.get(node.id) ?? 0);
            meterRef.current?.setSignal(meterScale(raw));
            const text = formatDb(raw);
            if (text !== lastText && readoutRef.current) {
                lastText = text;
                readoutRef.current.textContent = text;
            }
        });
    }, [node.id]);

    // Mute is one reversible step (REV-1); the persist effect drives the engine.
    const handleMuteToggle = useCallback(() => {
        beginGesture();
        updateNodeData<SpeakerNodeData>(node.id, { isMuted: !isMuted });
        endGesture();
    }, [beginGesture, endGesture, isMuted, node.id, updateNodeData]);

    // LEVEL: the whole sweep is one Ctrl+Z step. The bracket opens on the first
    // value change (pointer, wheel or Arrow key alike) and closes on commit.
    const level = useGestureBracket();
    const handleLevelChange = useCallback((next: number) => {
        level.begin();
        updateNodeData<SpeakerNodeData>(node.id, { volume: Math.max(0, Math.min(1, next)) });
    }, [level, node.id, updateNodeData]);

    const inputPort = node.ports.find((p) => p.direction === 'input' && p.type === 'audio');

    return (
        <NodeShell
            className={`schematic-node speaker-node${isHoveredWithConnections ? ' hover-connecting' : ''}`}
            style={style}
            title="Speaker"
            nodeType="OUT"
            selected={!!isSelected}
            dragging={!!isDragging}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            inputs={inputPort ? (
                <PortRow
                    side="input"
                    kind="audio"
                    label={inputPort.name}
                    connected={!!hasConnection?.(inputPort.id)}
                    data-node-id={node.id}
                    data-port-id={inputPort.id}
                    data-port-type={inputPort.type}
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(inputPort.id, e); }}
                    onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(inputPort.id, e); }}
                    onMouseEnter={() => handlePortMouseEnter?.(inputPort.id)}
                    onMouseLeave={handlePortMouseLeave}
                />
            ) : undefined}
        >
            {/* The instrument half of the card: one dial, one meter, one number. */}
            <div className="speaker-stage" onMouseDown={(e) => e.stopPropagation()}>
                <Knob
                    label="LEVEL"
                    value={volume}
                    min={0}
                    max={1}
                    defaultValue={1}
                    disabled={isMuted}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={handleLevelChange}
                    onCommit={level.end}
                />
                <div className="speaker-readout">
                    <Meter
                        ref={meterRef}
                        bars={9}
                        height={44}
                        barWidth={5}
                        label="Speaker output level"
                    />
                    <span ref={readoutRef} className="oj-node__readout speaker-db">
                        -&#8734; dB
                    </span>
                </div>
            </div>

            {/* The route, and what it costs. Facts, not controls — the quiet voice. */}
            <div ref={deviceSelectorRef} className="speaker-route">
                <div className="speaker-route__row">
                    <DeviceSelect
                        items={deviceItems}
                        value={currentDeviceId}
                        open={showDevices}
                        onToggle={() => setShowDevices((v) => !v)}
                        onSelect={handleDeviceSelect}
                        ariaLabel="Speaker output device"
                        placeholder="Default Output"
                    />
                    <IconButton
                        className="speaker-mute"
                        variant="node"
                        label={isMuted ? 'Unmute speaker' : 'Mute speaker'}
                        aria-pressed={isMuted}
                        onClick={handleMuteToggle}
                        icon={isMuted ? <IconMute size={18} /> : <IconSpeaker size={18} />}
                    />
                </div>
                {isCurrentLowLatency && (
                    <div className="oj-node__meta">
                        <Chip tone="success">
                            <IconBolt size={12} aria-hidden="true" />
                            low latency
                        </Chip>
                    </div>
                )}
                {!supportsSinkId && currentDeviceId !== 'default' && (
                    <Callout variant="warning" title="Route not applied">
                        This browser cannot choose an output device. Sound is going to the
                        system default.
                    </Callout>
                )}
            </div>
        </NodeShell>
    );
});
