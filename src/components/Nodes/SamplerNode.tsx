/**
 * Sampler Node - Simplified design similar to Instrument Node
 *
 * Layout:
 * ┌─────────────────────────────────────────┐
 * │ ● bundle-in     SAMPLER                 │
 * │ ┌─────────────────────────────────────┐ │
 * │ │ ~~~waveform~~~  sample.wav   [C4] X │ │  ← Draggable clip with root note
 * │ └─────────────────────────────────────┘ │
 * │   Gain: 1.0     Spread: 1.0             │
 * │   Attack: 0.01  Release: 0.1      ○ out │
 * └─────────────────────────────────────────┘
 */

import { useCallback, useRef, useState, useEffect, memo } from 'react';
import type { GraphNode, SamplerNodeData, SamplerRow, AudioClip, ClipDropTarget } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { getItemFile } from '../../store/libraryStore';
import { getAudioContext } from '../../audio/audioContext';
import { getExecutor } from '../../audio/executor';
import { useAudioClipStore, getClipBuffer } from '../../store/audioClipStore';
import { loadClipAudio } from '../../utils/clipUtils';
import { isSamplerNodeData } from '../../engine/typeGuards';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { logError } from '../../utils/log';

interface SamplerNodeProps {
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

/** Note names for MIDI display */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Convert MIDI note to display string (e.g., 60 -> "C4") */
function midiToNoteName(midiNote: number): string {
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = NOTE_NAMES[midiNote % 12];
    return `${noteName}${octave}`;
}

/** Format duration for display */
function formatDuration(seconds: number): string {
    if (seconds < 1) return `${seconds.toFixed(1)}s`;
    return `${Math.round(seconds)}s`;
}

/** Waveform resolution (number of sample points for display) */
const WAVEFORM_RESOLUTION = 50;

/** Parameter ranges and steps */
const PARAM_RANGES = {
    ROOT_NOTE: { min: 24, max: 96, step: 1 },    // C1 to C7
    GAIN: { min: 0, max: 2, step: 0.1 },
    SPREAD: { min: 0, max: 12, step: 0.5 },
    ATTACK: { min: 0.001, max: 1, step: 0.01 },
    RELEASE: { min: 0.01, max: 2, step: 0.01 },
} as const;

/** Scrollable control component with proper scroll capture */
interface ScrollableControlProps {
    value: number;
    onChange: (newValue: number) => void;
    range: { min: number; max: number; step: number };
    children: React.ReactNode;
    className?: string;
    title?: string;
}

const ScrollableControl = memo(function ScrollableControl({
    value,
    onChange,
    range,
    children,
    className,
    title
}: ScrollableControlProps) {
    const handleScroll = useCallback((data: ScrollData) => {
        const delta = data.scrollingUp ? 1 : -1;
        let newValue = value + delta * range.step;
        newValue = Math.max(range.min, Math.min(range.max, newValue));
        // Round to avoid floating point issues
        const rounded = Math.round(newValue * 1000) / 1000;
        if (rounded !== value) onChange(rounded);
    }, [value, onChange, range]);

    const { ref } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleScroll,
        capture: true,
    });

    return (
        <span ref={ref} className={className} title={title}>
            {children}
        </span>
    );
});

export const SamplerNode = memo(function SamplerNode({
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
}: SamplerNodeProps) {
    const defaultData: SamplerNodeData = {
        sampleId: null,
        sampleName: null,
        waveformData: undefined,
        duration: undefined,
        rootNote: 60,
        gain: 1.0,
        spread: 1.0,
        attack: 0.01,
        release: 0.1,
        rows: [],
    };

    const data: SamplerNodeData = isSamplerNodeData(node.data)
        ? { ...defaultData, ...(node.data as Partial<SamplerNodeData>) }
        : defaultData;

    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const nodeRef = useRef<HTMLDivElement>(null);
    const sampleAreaRef = useRef<HTMLDivElement>(null);

    // Audio clip store for accepting clip drops
    const registerDropTarget = useAudioClipStore((s) => s.registerDropTarget);
    const unregisterDropTarget = useAudioClipStore((s) => s.unregisterDropTarget);
    const clipDragState = useAudioClipStore((s) => s.dragState);

    const [isDragOver, setIsDragOver] = useState(false);
    const [waveformData, setWaveformData] = useState<number[]>(data.waveformData || []);

    // Get rows from data
    const rows: SamplerRow[] = data.rows || [];

    // Get ports by direction/type (IDs may change after port syncing)
    const audioOutPort = node.ports.find(p => p.type === 'audio' && p.direction === 'output');
    const bundleInPort = node.ports.find(p => p.type === 'control' && p.direction === 'input');

    // Generate waveform data from audio buffer
    const generateWaveform = useCallback((buffer: AudioBuffer): number[] => {
        const channelData = buffer.getChannelData(0);
        const samplesPerPoint = Math.floor(channelData.length / WAVEFORM_RESOLUTION);
        const points: number[] = [];

        for (let i = 0; i < WAVEFORM_RESOLUTION; i++) {
            let max = 0;
            const start = i * samplesPerPoint;
            for (let j = 0; j < samplesPerPoint; j++) {
                const val = Math.abs(channelData[start + j] || 0);
                if (val > max) max = val;
            }
            points.push(max);
        }
        return points;
    }, []);

    // Sync waveform from adapter on mount, restore buffer if needed
    useEffect(() => {
        if (!data.sampleId) {
            setWaveformData([]);
            return;
        }

        // Track if effect has been cleaned up to prevent state updates on unmounted component
        let aborted = false;

        const loadAndSyncBuffer = async () => {
            const ctx = getAudioContext();
            const sampler = getExecutor().getSamplerAdapter(node.id);

            if (!sampler) {
                return;
            }

            // Check if buffer already exists in adapter
            let buffer = sampler.getBuffer();
            if (buffer) {
                if (aborted) return;
                const points = generateWaveform(buffer);
                setWaveformData(points);
                return;
            }

            // Buffer not loaded - restore from library using sampleId
            if (!ctx) {
                return;
            }

            try {
                // Check if it's a library sample (not a file: prefix)
                if (data.sampleId && !data.sampleId.startsWith('file:')) {
                    const file = await getItemFile(data.sampleId);
                    if (aborted) return;
                    if (file) {
                        const arrayBuffer = await file.arrayBuffer();
                        if (aborted) return;
                        buffer = await ctx.decodeAudioData(arrayBuffer);
                        if (aborted) return;
                        sampler.setBuffer(buffer);
                        const points = generateWaveform(buffer);
                        setWaveformData(points);
                    }
                } else if (data.waveformData && data.waveformData.length > 0) {
                    // For file: samples, use cached waveform data (buffer can't be restored)
                    if (aborted) return;
                    setWaveformData(data.waveformData);
                }
            } catch (err) {
                if (!aborted) {
                    logError("nodes", "Failed to restore sample buffer:", { error: String(err) });
                }
            }
        };

        loadAndSyncBuffer();

        return () => {
            aborted = true;
        };
    }, [node.id, data.sampleId, data.sampleName, data.waveformData, generateWaveform]);

    // Handle audio clip drop (from looper or canvas)
    const handleClipDrop = useCallback(async (clip: AudioClip) => {
        const ctx = getAudioContext();
        if (!ctx) return;

        try {
            let buffer = getClipBuffer(clip.sampleId);
            if (!buffer) {
                buffer = await loadClipAudio(clip, ctx);
            }

            // Wait for sampler adapter to be available
            const sampler = await getExecutor().waitForSamplerAdapter(node.id);
            if (sampler) {
                sampler.setBuffer(buffer);
            }

            const points = generateWaveform(buffer);
            setWaveformData(points);

            updateNodeData(node.id, {
                sampleId: clip.sampleId,
                sampleName: clip.sampleName,
                waveformData: points,
                duration: buffer.duration
            });
        } catch (error) {
            logError("nodes", "Failed to load clip audio:", { error: String(error) });
        }
    }, [node.id, updateNodeData, generateWaveform]);

    // Register as drop target for audio clips
    useEffect(() => {
        const dropTarget: ClipDropTarget = {
            nodeId: node.id,
            targetName: 'Sampler',
            onClipDrop: handleClipDrop,
            canAcceptClip: () => true,
            getDropZoneBounds: () => sampleAreaRef.current?.getBoundingClientRect() ?? null,
        };

        registerDropTarget(dropTarget);
        return () => unregisterDropTarget(node.id);
    }, [node.id, handleClipDrop, registerDropTarget, unregisterDropTarget]);

    const isClipDropTarget = clipDragState.hoveredTargetId === node.id;

    // Handle drag events for audio file drop zone
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const ctx = getAudioContext();

        // Handle file system files
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('audio/') || file.name.match(/\.(wav|mp3|ogg|flac|aiff|m4a)$/i)) {
                try {
                    const arrayBuffer = await file.arrayBuffer();
                    if (ctx) {
                        const buffer = await ctx.decodeAudioData(arrayBuffer);

                        // Wait for sampler adapter to be available
                        const sampler = await getExecutor().waitForSamplerAdapter(node.id);
                        if (sampler) {
                            sampler.setBuffer(buffer);
                        }

                        const points = generateWaveform(buffer);
                        setWaveformData(points);

                        updateNodeData(node.id, {
                            sampleName: file.name,
                            sampleId: `file:${file.name}:${Date.now()}`,
                            waveformData: points,
                            duration: buffer.duration
                        });
                    }
                } catch (err) {
                    logError("nodes", "Failed to decode audio file:", { error: String(err) });
                }
                return;
            }
        }

        // Handle library sample drop
        const sampleId = e.dataTransfer.getData('application/x-sample-id');
        if (sampleId) {
            try {
                const file = await getItemFile(sampleId);
                if (file && ctx) {
                    const arrayBuffer = await file.arrayBuffer();
                    const buffer = await ctx.decodeAudioData(arrayBuffer);

                    // Wait for sampler adapter to be available
                    const sampler = await getExecutor().waitForSamplerAdapter(node.id);
                    if (sampler) {
                        sampler.setBuffer(buffer);
                    }

                    const points = generateWaveform(buffer);
                    setWaveformData(points);

                    updateNodeData(node.id, {
                        sampleId,
                        sampleName: file.name,
                        waveformData: points,
                        duration: buffer.duration
                    });
                }
            } catch (err) {
                logError("nodes", "Failed to load library sample:", { error: String(err) });
            }
        }
    }, [node.id, updateNodeData, generateWaveform]);

    // Clear sample
    const handleClearSample = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        updateNodeData(node.id, {
            sampleId: null,
            sampleName: null,
            waveformData: undefined,
            duration: undefined
        });
        setWaveformData([]);
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) {
            sampler.setBuffer(null);
        }
    }, [node.id, updateNodeData]);

    // Change handlers for scrollable controls
    const handleRootNoteChange = useCallback((newValue: number) => {
        updateNodeData(node.id, { rootNote: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setRootNote(newValue);
    }, [node.id, updateNodeData]);

    const handleGainChange = useCallback((newValue: number) => {
        updateNodeData(node.id, { gain: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setGain(newValue);
    }, [node.id, updateNodeData]);

    const handleSpreadChange = useCallback((newValue: number) => {
        updateNodeData(node.id, { spread: newValue });
    }, [node.id, updateNodeData]);

    const handleAttackChange = useCallback((newValue: number) => {
        updateNodeData(node.id, { attack: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setAttack(newValue);
    }, [node.id, updateNodeData]);

    const handleReleaseChange = useCallback((newValue: number) => {
        updateNodeData(node.id, { release: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setRelease(newValue);
    }, [node.id, updateNodeData]);

    const hasSample = !!data.sampleName;
    const hasRows = rows.length > 0;

    // Handle drag start for dragging sample OUT of the node
    const handleSampleDragStart = useCallback((e: React.DragEvent) => {
        if (!data.sampleId || !data.sampleName) {
            e.preventDefault();
            return;
        }

        // Set drag data for the audio clip
        e.dataTransfer.setData('application/x-audio-clip', JSON.stringify({
            sampleId: data.sampleId,
            sampleName: data.sampleName,
            duration: data.duration,
            waveformData: data.waveformData,
            sourceNodeId: node.id,
        }));
        e.dataTransfer.effectAllowed = 'copy';
    }, [data.sampleId, data.sampleName, data.duration, data.waveformData, node.id]);

    return (
        <div
            ref={nodeRef}
            className={`sampler-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isHoveredWithConnections ? 'hover-connecting' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Left side input port */}
            {bundleInPort && (
                <div
                    className={`sampler-side-port input ${hasConnection?.(bundleInPort.id) || hasRows ? 'connected' : ''}`}
                    data-node-id={node.id}
                    data-port-id={bundleInPort.id}
                    onMouseDown={(e) => { e.stopPropagation(); handlePortMouseDown?.(bundleInPort.id, e); }}
                    onMouseUp={(e) => handlePortMouseUp?.(bundleInPort.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(bundleInPort.id)}
                    onMouseLeave={handlePortMouseLeave}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePortMouseDown?.(bundleInPort.id, e as unknown as React.MouseEvent);
                        }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label="Control input port"
                    title="Control input"
                />
            )}

            {/* Right side output port */}
            {audioOutPort && (
                <div
                    className={`sampler-side-port output ${hasConnection?.(audioOutPort.id) ? 'connected' : ''}`}
                    data-node-id={node.id}
                    data-port-id={audioOutPort.id}
                    onMouseDown={(e) => { e.stopPropagation(); handlePortMouseDown?.(audioOutPort.id, e); }}
                    onMouseUp={(e) => handlePortMouseUp?.(audioOutPort.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(audioOutPort.id)}
                    onMouseLeave={handlePortMouseLeave}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePortMouseDown?.(audioOutPort.id, e as unknown as React.MouseEvent);
                        }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label="Audio output port"
                    title="Audio output"
                />
            )}

            {/* Header */}
            <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                <span className="schematic-title">Sampler</span>
            </div>

            {/* Sample drop zone - AudioClipVisual style, draggable OUT */}
            <div
                ref={sampleAreaRef}
                className={`sampler-sample-area ${isDragOver || isClipDropTarget ? 'drag-over' : ''} ${hasSample ? 'has-sample' : ''}`}
                draggable={hasSample}
                onDragStart={handleSampleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                title={hasSample ? 'Drag to copy sample to canvas' : 'Drop audio file or clip here'}
            >
                {hasSample ? (
                    <>
                        {/* Waveform */}
                        <div className="sampler-waveform-container">
                            <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                                {waveformData.length > 1 ? (
                                    <polyline
                                        className="sampler-waveform-path"
                                        fill="none"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        points={waveformData.map((v, i) =>
                                            `${(i / (waveformData.length - 1)) * 100},${10 - v * 8}`
                                        ).join(' ')}
                                    />
                                ) : (
                                    <line x1="0" y1="10" x2="100" y2="10" className="sampler-waveform-path" />
                                )}
                                {/* Center line */}
                                <line x1="0" y1="10" x2="100" y2="10" className="sampler-center-line" />
                            </svg>

                            {/* Duration badge */}
                            {data.duration && (
                                <span className="sampler-duration-badge">
                                    {formatDuration(data.duration)}
                                </span>
                            )}
                        </div>

                        {/* Sample info bar */}
                        <div className="sampler-info-bar">
                            <span className="sampler-sample-name" title={data.sampleName || ''}>
                                {data.sampleName}
                            </span>
                            <ScrollableControl
                                value={data.rootNote}
                                onChange={handleRootNoteChange}
                                range={PARAM_RANGES.ROOT_NOTE}
                                className="sampler-root-note"
                                title="Root note (scroll to change)"
                            >
                                {midiToNoteName(data.rootNote)}
                            </ScrollableControl>
                            <button
                                className="sampler-clear-btn"
                                onClick={handleClearSample}
                                title="Remove sample"
                            >
                                <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                </svg>
                            </button>
                        </div>
                    </>
                ) : (
                    <span className="sampler-drop-text">Drop audio file</span>
                )}
            </div>

            {/* Controls */}
            <div className="sampler-controls">
                <div className="sampler-controls-row">
                    <ScrollableControl
                        value={data.gain}
                        onChange={handleGainChange}
                        range={PARAM_RANGES.GAIN}
                        className="sampler-control"
                        title="Gain (0-2) - scroll to change"
                    >
                        Gain: {data.gain.toFixed(1)}
                    </ScrollableControl>
                    <ScrollableControl
                        value={data.spread}
                        onChange={handleSpreadChange}
                        range={PARAM_RANGES.SPREAD}
                        className="sampler-control"
                        title="Spread in semitones - scroll to change"
                    >
                        Spread: {data.spread.toFixed(1)}
                    </ScrollableControl>
                </div>
                <div className="sampler-controls-row">
                    <ScrollableControl
                        value={data.attack}
                        onChange={handleAttackChange}
                        range={PARAM_RANGES.ATTACK}
                        className="sampler-control"
                        title="Attack time - scroll to change"
                    >
                        Att: {data.attack.toFixed(2)}
                    </ScrollableControl>
                    <ScrollableControl
                        value={data.release}
                        onChange={handleReleaseChange}
                        range={PARAM_RANGES.RELEASE}
                        className="sampler-control"
                        title="Release time - scroll to change"
                    >
                        Rel: {data.release.toFixed(2)}
                    </ScrollableControl>
                </div>
            </div>
        </div>
    );
});

export default SamplerNode;
