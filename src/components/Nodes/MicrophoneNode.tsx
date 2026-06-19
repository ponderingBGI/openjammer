/**
 * Microphone Node - Live audio input (Schematic Style)
 * Supports professional audio interfaces with low-latency detection
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { GraphNode, MicrophoneNodeData } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { getAudioContext } from '../../audio/audioContext';
import { getExecutor } from '../../audio/executor';
import { ScrollContainer } from '../common/ScrollContainer';
import { detectLowLatencyDevice } from '../../utils/audioDeviceDetection';
import { Port } from '@openjammer/oj-ui';

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

const NUM_WAVEFORM_BARS = 16;
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

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
    style
}: MicrophoneNodeProps) {
    const data = node.data as MicrophoneNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const audioConfig = useAudioStore((s) => s.audioConfig);
    const setDeviceInfo = useAudioStore((s) => s.setDeviceInfo);

    // Use node-specific lowLatencyMode if set, otherwise use global setting
    const lowLatencyMode = data.lowLatencyMode ?? audioConfig.lowLatencyMode;

    const [stream, setStream] = useState<MediaStream | null>(null);
    const [_sourceNode, setSourceNode] = useState<MediaStreamAudioSourceNode | null>(null);
    const [gainNode, setGainNode] = useState<GainNode | null>(null);
    const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
    const [waveformBars, setWaveformBars] = useState<number[]>(Array(NUM_WAVEFORM_BARS).fill(0));
    const [devices, setDevices] = useState<AudioDevice[]>([]);
    const [showDevices, setShowDevices] = useState(false);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>(data.deviceId || 'default');

    const animationRef = useRef<number | null>(null);

    // Use refs for cleanup to avoid stale closures
    const streamRef = useRef<MediaStream | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const analyserNodeRef = useRef<AnalyserNode | null>(null);

    // Get output port
    const outputPort = node.ports.find(p => p.direction === 'output' && p.type === 'audio');
    const outputPortId = outputPort?.id || 'audio-out';

    // Fetch input devices with low-latency detection
    useEffect(() => {
        if (!navigator.mediaDevices?.enumerateDevices) return;

        const updateDevices = () => {
            navigator.mediaDevices.enumerateDevices().then(devs => {
                const inputs = devs
                    .filter(d => d.kind === 'audioinput')
                    .map(d => ({
                        deviceId: d.deviceId,
                        label: d.label || `Microphone ${d.deviceId.slice(0, 4)}`,
                        isUSB: detectLowLatencyDevice(d.label)
                    }));
                setDevices(inputs);

                // Update store with USB/low-latency device detection
                const lowLatencyDevice = inputs.find(d => d.isUSB);
                if (lowLatencyDevice) {
                    setDeviceInfo({
                        isUSBAudioInterface: true,
                        deviceLabel: lowLatencyDevice.label
                    });
                }

                // Check if currently selected device still exists
                if (selectedDeviceId !== 'default') {
                    const deviceStillExists = inputs.some(d => d.deviceId === selectedDeviceId);
                    if (!deviceStillExists) {
                        // Device was unplugged, fall back to default
                        setSelectedDeviceId('default');
                        updateNodeData<MicrophoneNodeData>(node.id, { deviceId: 'default' });
                    }
                }
            });
        };

        // Initial fetch
        updateDevices();

        // Listen for device changes (plug/unplug)
        navigator.mediaDevices.addEventListener('devicechange', updateDevices);

        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
        };
    }, [setDeviceInfo, selectedDeviceId, node.id, updateNodeData]);

    // Click outside to close device dropdown
    useEffect(() => {
        if (!showDevices) return;

        const handleClickOutside = (e: MouseEvent) => {
            const dropdown = document.querySelector('.mic-device-selector .device-dropdown');
            const button = document.querySelector('.mic-device-selector .mic-source-btn');
            if (dropdown && !dropdown.contains(e.target as Node) &&
                button && !button.contains(e.target as Node)) {
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

    // Initialize microphone
    const initMicrophone = useCallback(async (deviceId?: string) => {
        if (!isAudioContextReady) return;

        // Clean up existing resources using refs (avoids stale closures)
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (sourceNodeRef.current) {
            sourceNodeRef.current.disconnect();
        }
        if (gainNodeRef.current) {
            gainNodeRef.current.disconnect();
        }
        if (analyserNodeRef.current) {
            analyserNodeRef.current.disconnect();
        }

        try {
            // Use low-latency constraints if enabled
            // Note: Use 'ideal' for latency/channels since 'exact' values cause OverconstrainedError
            const constraints = lowLatencyMode ? {
                audio: {
                    deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    latency: { ideal: 0 },
                    channelCount: { ideal: 2 }
                }
            } : {
                audio: {
                    deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            };

            const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

            const ctx = getAudioContext();
            if (!ctx) return;

            const source = ctx.createMediaStreamSource(mediaStream);
            const gain = ctx.createGain();
            gain.gain.value = data.isMuted ? 0 : 1;

            // Create analyser for waveform (after gain so it reflects mute state)
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64;

            // Connect: source -> gain -> analyser
            // Analyser is after gain so waveform shows 0 when muted
            source.connect(gain);
            gain.connect(analyser);

            // Register the analyser as output (it passes audio through)
            // This way the waveform reflects what's actually being sent out
            getExecutor().setMicrophoneOutput(node.id, analyser);

            // Update refs for cleanup
            streamRef.current = mediaStream;
            sourceNodeRef.current = source;
            gainNodeRef.current = gain;
            analyserNodeRef.current = analyser;

            // Update state for rendering
            setStream(mediaStream);
            setSourceNode(source);
            setGainNode(gain);
            setAnalyserNode(analyser);
        } catch (err) {
            console.error('Failed to access microphone:', err);
        }
    }, [isAudioContextReady, node.id, data.isMuted, lowLatencyMode]);

    // Initialize microphone when audio context is ready
    // This effect handles both initial mount and audio context reinitialization
    useEffect(() => {
        if (isAudioContextReady) {
            // Initialize (or reinitialize) the microphone
            // initMicrophone already handles cleanup of existing resources
            initMicrophone(selectedDeviceId);
        } else {
            // Audio context is not ready - clean up resources
            // This happens when audio settings are changed and context is reinitialized
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
            if (sourceNodeRef.current) {
                sourceNodeRef.current.disconnect();
                sourceNodeRef.current = null;
            }
            if (gainNodeRef.current) {
                gainNodeRef.current.disconnect();
                gainNodeRef.current = null;
            }
            if (analyserNodeRef.current) {
                analyserNodeRef.current.disconnect();
                analyserNodeRef.current = null;
            }
            // Clear state
            setStream(null);
            setSourceNode(null);
            setGainNode(null);
            setAnalyserNode(null);
        }

        // Cleanup on unmount or when deps change
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
            if (sourceNodeRef.current) {
                sourceNodeRef.current.disconnect();
            }
            if (gainNodeRef.current) {
                gainNodeRef.current.disconnect();
            }
            if (analyserNodeRef.current) {
                analyserNodeRef.current.disconnect();
            }
        };
    }, [isAudioContextReady, initMicrophone, selectedDeviceId]);

    // Update waveform with FPS throttling for performance
    useEffect(() => {
        if (!analyserNode) return;

        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        let lastFrameTime = 0;

        const updateWaveform = () => {
            const now = performance.now();

            // Throttle to TARGET_FPS for performance with multiple nodes
            if (now - lastFrameTime >= FRAME_INTERVAL) {
                lastFrameTime = now;

                // Skip updates when document is hidden (performance optimization)
                if (!document.hidden) {
                    analyserNode.getByteFrequencyData(dataArray);

                    // Sample bars from frequency data
                    const bars: number[] = [];
                    const step = Math.floor(dataArray.length / NUM_WAVEFORM_BARS);
                    for (let i = 0; i < NUM_WAVEFORM_BARS; i++) {
                        const value = dataArray[i * step] / 255;
                        bars.push(value);
                    }
                    setWaveformBars(bars);
                }
            }

            animationRef.current = requestAnimationFrame(updateWaveform);
        };

        updateWaveform();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [analyserNode]);

    // Update gain when muted changes
    useEffect(() => {
        if (gainNode) {
            // eslint-disable-next-line react-hooks/immutability -- gainNode is a Web Audio GainNode, not React state; setting AudioParam.value is the supported way to drive gain
            gainNode.gain.value = data.isMuted ? 0 : 1;
        }
    }, [data.isMuted, gainNode]);

    // Toggle mute
    const handleMuteToggle = useCallback(() => {
        updateNodeData<MicrophoneNodeData>(node.id, {
            isMuted: !data.isMuted
        });
    }, [node.id, data.isMuted, updateNodeData]);

    // Handle device selection
    const handleDeviceSelect = useCallback((deviceId: string) => {
        setSelectedDeviceId(deviceId);
        updateNodeData<MicrophoneNodeData>(node.id, { deviceId });
        setShowDevices(false);
        initMicrophone(deviceId);
    }, [node.id, updateNodeData, initMicrophone]);

    const currentLabel = devices.find(d => d.deviceId === selectedDeviceId)?.label || 'Select source';

    // Calculate dynamic dropdown dimensions based on device names and count
    const dropdownStyle = useMemo(() => {
        // Include "Default Input" in the list for width calculation
        const allLabels = ['Default Input', ...devices.map(d => d.label)];
        const longestLabel = allLabels.reduce((a, b) => a.length > b.length ? a : b, '');

        // Calculate width: ~8px per character + padding (32px for left/right padding)
        // Min: 150px, Max: 320px
        const charWidth = 7;
        const padding = 32;
        const calculatedWidth = Math.min(320, Math.max(150, longestLabel.length * charWidth + padding));

        // Calculate height: ~36px per item (padding + font size)
        // +1 for "Default Input", Min: auto, Max: 240px (about 6-7 items)
        const itemHeight = 36;
        const itemCount = devices.length + 1; // +1 for Default Input
        const calculatedHeight = Math.min(240, itemCount * itemHeight);

        return {
            width: `${calculatedWidth}px`,
            maxHeight: `${calculatedHeight}px`,
        };
    }, [devices]);

    return (
        <div
            className={`schematic-node microphone-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                <span className="schematic-title">Microphone</span>
                {/* Low Latency Mode Badge */}
                {lowLatencyMode && (
                    <div className="mic-latency-badge" title="Low Latency Mode Active">
                        <svg viewBox="0 0 24 24" width="12" height="12">
                            <path d="M13 3L3 14h8v8l10-11h-8z" fill="currentColor"/>
                        </svg>
                    </div>
                )}
            </div>

            {/* Content Container */}
            <div className="mic-content">
                {/* Top row: Mute button + Source selector */}
                <div className="mic-controls-row">
                    {/* Mute Button */}
                    <button
                        className={`mic-mute-btn ${data.isMuted ? 'muted' : 'live'}`}
                        onClick={handleMuteToggle}
                        disabled={!stream}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                        </svg>
                    </button>

                    {/* Device Selector */}
                    <div className="mic-device-selector">
                        <button
                            className="mic-source-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowDevices(!showDevices);
                            }}
                            title={currentLabel}
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z"/>
                                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                            </svg>
                        </button>

                        {showDevices && (
                            <ScrollContainer
                                mode="dropdown"
                                className="device-dropdown schematic-dropdown"
                                style={dropdownStyle}
                            >
                                <div
                                    className="device-item"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeviceSelect('default');
                                    }}
                                >
                                    Default Input
                                </div>
                                {devices.map(d => (
                                    <div
                                        key={d.deviceId}
                                        className="device-item"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeviceSelect(d.deviceId);
                                        }}
                                    >
                                        {d.label}
                                    </div>
                                ))}
                            </ScrollContainer>
                        )}
                    </div>

                    {/* Output Port */}
                    <Port
                        kind="audio"
                        direction="output"
                        connected={hasConnection(outputPortId)}
                        style={{ marginLeft: 'auto' }}
                        data-node-id={node.id}
                        data-port-id={outputPortId}
                        onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(outputPortId, e); }}
                        onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(outputPortId, e); }}
                        onMouseEnter={() => handlePortMouseEnter?.(outputPortId)}
                        onMouseLeave={handlePortMouseLeave}
                    />
                </div>

                {/* Waveform Line */}
                <svg className="mic-waveform-line" viewBox="0 0 100 20" preserveAspectRatio="none">
                    <polyline
                        className="mic-waveform-path"
                        fill="none"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={waveformBars.map((v, i) => `${(i / (NUM_WAVEFORM_BARS - 1)) * 100},${10 - v * 8}`).join(' ')}
                    />
                </svg>
            </div>
        </div>
    );
});
