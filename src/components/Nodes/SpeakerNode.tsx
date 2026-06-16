/**
 * Speaker Node - Audio output to device
 * Supports professional audio interfaces with low-latency detection
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import type { GraphNode, SpeakerNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { getExecutor } from '../../audio/executor';
import { reinitAudioContext } from '../../audio/audioContext';
import {
    type EnhancedAudioDevice,
    enhanceAudioDevices,
    sortDevicesByPriority,
    getBestOutputDevice,
    detectLowLatencyDevice
} from '../../utils/audioDeviceDetection';

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
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const setAudioConfig = useAudioStore((s) => s.setAudioConfig);
    const setAudioContextReady = useAudioStore((s) => s.setAudioContextReady);

    const [devices, setDevices] = useState<EnhancedAudioDevice[]>([]);
    const [showDevices, setShowDevices] = useState(false);
    const [supportsSinkId] = useState(() => {
        const audio = document.createElement('audio');
        return typeof (audio as HTMLAudioElement & { setSinkId?: unknown }).setSinkId === 'function';
    });
    const isMuted = data.isMuted ?? false;

    // Track if we've done auto-selection to avoid re-selecting on every render
    const hasAutoSelected = useRef(false);
    // Use refs to access current audio config without triggering re-renders
    const audioConfigRef = useRef(audioConfig);
    useEffect(() => {
        audioConfigRef.current = audioConfig;
    }, [audioConfig]);

    // Helper to apply low latency mode with proper audio context reinitialization
    const applyLowLatencyMode = useCallback(async () => {
        const currentConfig = audioConfigRef.current;
        if (currentConfig.lowLatencyMode) return; // Already enabled

        // Update config
        setAudioConfig({
            lowLatencyMode: true,
            latencyHint: 'interactive' as AudioContextLatencyCategory
        });

        // Toggle audio context to trigger full reinitialization
        setAudioContextReady(false);
        getExecutor().dispose();

        try {
            await reinitAudioContext({
                sampleRate: currentConfig.sampleRate,
                latencyHint: 'interactive'
            });
            setAudioContextReady(true);
        } catch (err) {
            console.error('Failed to apply low latency mode:', err);
            setAudioContextReady(true); // Restore on error
        }
    }, [setAudioConfig, setAudioContextReady]);

    // Fetch output devices and auto-select best one
    useEffect(() => {
        if (!navigator.mediaDevices?.enumerateDevices) return;

        const updateDevices = async () => {
            const devs = await navigator.mediaDevices.enumerateDevices();
            const outputs = devs.filter(d => d.kind === 'audiooutput');
            const enhanced = enhanceAudioDevices(outputs);
            const sorted = sortDevicesByPriority(enhanced);
            setDevices(sorted);

            // Auto-select best low-latency device if current is default and we haven't already
            const currentDeviceId = data.deviceId || 'default';
            if (currentDeviceId === 'default' && !hasAutoSelected.current) {
                const bestDevice = getBestOutputDevice(sorted);
                if (bestDevice && bestDevice.isLowLatency) {
                    hasAutoSelected.current = true;
                    updateNodeData<SpeakerNodeData>(node.id, { deviceId: bestDevice.deviceId });
                    getExecutor().setSpeakerDevice(node.id, bestDevice.deviceId);

                    // Also enable low latency mode automatically
                    await applyLowLatencyMode();
                }
            }

            // Check if currently selected device still exists
            if (currentDeviceId !== 'default') {
                const deviceStillExists = sorted.some(d => d.deviceId === currentDeviceId);
                if (!deviceStillExists) {
                    // Device was unplugged, fall back to default
                    updateNodeData<SpeakerNodeData>(node.id, { deviceId: 'default' });
                    getExecutor().setSpeakerDevice(node.id, 'default');
                }
            }
        };

        // Initial fetch
        updateDevices();

        // Listen for device changes (plug/unplug)
        navigator.mediaDevices.addEventListener('devicechange', updateDevices);

        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
        };
    }, [data.deviceId, node.id, updateNodeData, applyLowLatencyMode]);

    // Click outside to close device dropdown
    useEffect(() => {
        if (!showDevices) return;

        const handleClickOutside = (e: MouseEvent) => {
            const dropdown = document.querySelector('.speaker-node .device-dropdown');
            const trigger = document.querySelector('.speaker-node .device-select-trigger');
            if (dropdown && !dropdown.contains(e.target as Node) &&
                trigger && !trigger.contains(e.target as Node)) {
                setShowDevices(false);
            }
        };

        // Delay adding listener to avoid immediate trigger from the click that opened the dropdown
        const timeoutId = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showDevices]);

    const currentDeviceId = data.deviceId || 'default';
    const currentDevice = devices.find(d => d.deviceId === currentDeviceId);
    const currentLabel = currentDevice?.label || 'Default Output';
    const isCurrentLowLatency = currentDevice?.isLowLatency || detectLowLatencyDevice(currentLabel);

    // Handle device selection
    const handleDeviceSelect = async (deviceId: string) => {
        updateNodeData<SpeakerNodeData>(node.id, { deviceId });
        setShowDevices(false);

        // Apply device change immediately
        getExecutor().setSpeakerDevice(node.id, deviceId);

        // Auto-enable low latency mode when selecting a low-latency device
        const selectedDevice = devices.find(d => d.deviceId === deviceId);
        if (selectedDevice?.isLowLatency && !audioConfig.lowLatencyMode) {
            await applyLowLatencyMode();
        }
    };

    // Handle mute toggle
    const handleMuteToggle = () => {
        const newMuted = !isMuted;
        updateNodeData<SpeakerNodeData>(node.id, { isMuted: newMuted });
        // Update the actual audio node
        getExecutor().setSpeakerVolume(node.id, data.volume ?? 1, newMuted);
    };

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
                        className={`speaker-input-port ${hasConnection?.(inputPort.id) ? 'connected' : ''}`}
                        data-node-id={node.id}
                        data-port-id={inputPort.id}
                        data-port-type={inputPort.type}
                        onMouseDown={(e) => handlePortMouseDown?.(inputPort.id, e)}
                        onMouseUp={(e) => handlePortMouseUp?.(inputPort.id, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(inputPort.id)}
                        onMouseLeave={handlePortMouseLeave}
                        title={inputPort.name}
                    />
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

                {/* Output Device Selector */}
                <div className="device-selector-container">
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
                            <div
                                className="device-item"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeviceSelect('default');
                                }}
                            >
                                Default Output
                            </div>
                            {devices.map(d => (
                                <div
                                    key={d.deviceId}
                                    className={`device-item ${d.isLowLatency ? 'low-latency' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeviceSelect(d.deviceId);
                                    }}
                                >
                                    {d.isLowLatency && <span className="low-latency-icon" title="Low-latency audio interface">⚡</span>}
                                    <span className="device-label">{d.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
