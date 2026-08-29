/**
 * Speaker Node - Audio output to device
 * Supports professional audio interfaces with low-latency detection
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import type { GraphNode, SpeakerNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { getExecutor } from '../../audio/executor';
import {
    type EnhancedAudioDevice,
    enhanceAudioDevices,
    sortDevicesByPriority,
    detectLowLatencyDevice
} from '../../utils/audioDeviceDetection';
import { Port } from '@openjammer/oj-ui';
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
    style
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
    // Live output level (0..1) from the engine's per-node meter — the REAL master
    // mix leaving this SpeakerOut (VIS-1), not a parallel analyser. When muted, the
    // engine's `master_gain` is 0, so the meter naturally reads ~0.
    const [outputLevel, setOutputLevel] = useState(0);

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
                const outputs = devs.filter(d => d.kind === 'audiooutput');
                const sorted = sortDevicesByPriority(enhanceAudioDevices(outputs));
                setDevices(sorted);

                if (recoverMissingSelection) {
                    const current = useGraphStore.getState().nodes.get(node.id);
                    const selectedId = (current?.data as SpeakerNodeData | undefined)?.deviceId ?? 'default';
                    const hasEnumeratedIds = sorted.some(device => device.deviceId.length > 0);
                    if (hasEnumeratedIds && selectedId !== 'default' && !sorted.some(device => device.deviceId === selectedId)) {
                        updateNodeData<SpeakerNodeData>(node.id, { deviceId: 'default' });
                        getExecutor().setSpeakerDevice(node.id, 'default');
                    }
                }
            } catch {
                if (!cancelled) setDevices([]);
            }
        };

        // Initial fetch
        void updateDevices(false);

        // Listen for device changes (plug/unplug)
        const handleDeviceChange = () => { void updateDevices(true); };
        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

        return () => {
            cancelled = true;
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
    }, [node.id, updateNodeData]);

    // Click outside to close device dropdown
    useEffect(() => {
        if (!showDevices) return;

        const handleClickOutside = (e: PointerEvent) => {
            if (!deviceSelectorRef.current?.contains(e.target as Node)) {
                setShowDevices(false);
            }
        };
        document.addEventListener('pointerdown', handleClickOutside);

        return () => {
            document.removeEventListener('pointerdown', handleClickOutside);
        };
    }, [showDevices]);
    const currentDeviceId = data.deviceId || 'default';
    const currentDevice = devices.find(d => d.deviceId === currentDeviceId);
    const currentLabel = currentDevice?.label || 'Default Output';
    const isCurrentLowLatency = currentDevice?.isLowLatency || detectLowLatencyDevice(currentLabel);

    // Handle device selection
    const handleDeviceSelect = (deviceId: string) => {
        updateNodeData<SpeakerNodeData>(node.id, { deviceId });
        setShowDevices(false);

        // Apply device change immediately
        getExecutor().setSpeakerDevice(node.id, deviceId);

    };

    // Re-apply the persisted volume/mute to the engine on (re)load once the audio
    // context is ready, and whenever they change (PERSIST-1). The engine bakes both
    // into the SpeakerOut `master_param`s and re-applies them on graph load, so a
    // project saved muted/quiet reloads muted/quiet at the engine seam — this drives
    // the live engine to match the SSOT in node.data.
    useEffect(() => {
        if (!isAudioContextReady) return;
        getExecutor().setSpeakerVolume(node.id, volume, isMuted);
    }, [isAudioContextReady, node.id, volume, isMuted]);

    // Drive the output meter from the engine's per-node level (the REAL master mix),
    // keyed by this node's id (VIS-1) — no parallel AnalyserNode.
    useEffect(() => {
        const unsubscribe = getExecutor().subscribeSignalLevels((levels) => {
            setOutputLevel(Math.max(0, Math.min(1, levels.get(node.id) ?? 0)));
        });
        return unsubscribe;
    }, [node.id]);

    // Handle mute toggle. Bracket the data edit in a gesture so undo/redo treats it
    // as one reversible step (REV-1); the persist effect above drives the engine.
    const handleMuteToggle = () => {
        beginGesture();
        updateNodeData<SpeakerNodeData>(node.id, { isMuted: !isMuted });
        endGesture();
    };

    // Volume slider: live drag updates node.data (the SSOT) on every input; the
    // effect re-applies to the engine so volume is heard immediately. The whole
    // drag is one gesture (begin on first change, end on release) so a slider sweep
    // is a single Ctrl+Z step (REV-1).
    const gestureActiveRef = useRef(false);
    const beginVolumeGesture = useCallback(() => {
        if (gestureActiveRef.current) return;
        gestureActiveRef.current = true;
        beginGesture();
    }, [beginGesture]);
    const endVolumeGesture = useCallback(() => {
        if (!gestureActiveRef.current) return;
        gestureActiveRef.current = false;
        endGesture();
    }, [endGesture]);
    useEffect(() => () => endVolumeGesture(), [endVolumeGesture]);
    const handleVolumeChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            beginVolumeGesture();
            const next = Math.max(0, Math.min(1, Number(e.target.value)));
            updateNodeData<SpeakerNodeData>(node.id, { volume: next });
        },
        [node.id, updateNodeData, beginVolumeGesture],
    );

    // Get input port for the speaker
    const inputPort = node.ports.find(p => p.direction === 'input' && p.type === 'audio');

    return (
        <div
            className={`speaker-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isHoveredWithConnections ? 'hover-connecting' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div
                className="schematic-header"
                onMouseDown={handleHeaderMouseDown}
            >
                <span className="schematic-title">Speaker</span>
                {/* Warning badge if browser doesn't support setSinkId and non-default device selected */}
                {!supportsSinkId && currentDeviceId !== 'default' && (
                    <div className="speaker-warning" title="Browser doesn't support output device selection">
                        ⚠️
                    </div>
                )}
            </div>

            {/* Visual Container */}
            <div className="speaker-body">
                {/* Input Port - positioned in top left corner under header */}
                {inputPort && (
                    <div
                        className="speaker-input-port-wrapper"
                        style={{ position: 'absolute', left: 'var(--space-sm)', top: 'var(--space-sm)' }}
                    >
                        <Port
                            kind="audio"
                            direction="input"
                            connected={!!hasConnection?.(inputPort.id)}
                            style={{ width: '14px', height: '14px' }}
                            data-node-id={node.id}
                            data-port-id={inputPort.id}
                            data-port-type={inputPort.type}
                            onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(inputPort.id, e); }}
                            onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(inputPort.id, e); }}
                            onMouseEnter={() => handlePortMouseEnter?.(inputPort.id)}
                            onMouseLeave={handlePortMouseLeave}
                            title={inputPort.name}
                        />
                    </div>
                )}

                {/* Speaker Symbol with Mute Button */}
                <div className="speaker-symbol-container">
                    <button
                        className={`speaker-mute-btn ${isMuted ? 'muted' : 'live'}`}
                        onClick={handleMuteToggle}
                        title={isMuted ? 'Unmute' : 'Mute'}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                            {isMuted ? (
                                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                            ) : (
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                            )}
                        </svg>
                    </button>
                </div>

                {/* Master volume + live output meter. The slider drives node.data
                    (the SSOT); the engine applies it ONCE via the SpeakerOut master
                    param. The meter reads the engine's per-node level (VIS-1). */}
                <div className="speaker-volume-row" onMouseDown={(e) => e.stopPropagation()}>
                    <input
                        className="speaker-volume-slider"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        disabled={isMuted}
                        onChange={handleVolumeChange}
                        onPointerUp={endVolumeGesture}
                        onPointerCancel={endVolumeGesture}
                        onBlur={endVolumeGesture}
                        title={`Volume ${Math.round(volume * 100)}%`}
                        aria-label="Speaker volume"
                    />
                    <div className="speaker-output-meter" aria-hidden="true">
                        <div
                            className="speaker-output-meter-fill"
                            style={{ width: `${Math.round((isMuted ? 0 : outputLevel) * 100)}%` }}
                        />
                    </div>
                </div>

                {/* Output Device Selector */}
                <div ref={deviceSelectorRef} className="device-selector-container">
                    <button
                        className={`device-select-trigger ${isCurrentLowLatency ? 'low-latency' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowDevices(!showDevices);
                        }}
                    >
                        {isCurrentLowLatency && <span className="low-latency-icon" title="Low-latency audio interface">⚡</span>}
                        <span className="device-label">{currentLabel}</span>
                    </button>

                    {showDevices && (
                        <div
                            className="device-dropdown schematic-dropdown"
                            onWheel={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                className="device-item"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeviceSelect('default');
                                }}
                            >
                                Default Output
                            </button>
                            {devices.map(d => (
                                <button
                                    type="button"
                                    key={d.deviceId}
                                    className={`device-item ${d.isLowLatency ? 'low-latency' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeviceSelect(d.deviceId);
                                    }}
                                >
                                    {d.isLowLatency && <span className="low-latency-icon" title="Low-latency audio interface">⚡</span>}
                                    <span className="device-label">{d.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
