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
import { getItemFile, useLibraryStore } from '../../store/libraryStore';
import { getAudioContext } from '../../audio/audioContext';
import { getExecutor } from '../../audio/executor';
import { useAudioClipStore, getClipBuffer } from '../../store/audioClipStore';
import { loadClipAudio } from '../../utils/clipUtils';
import { isSamplerNodeData } from '../../engine/typeGuards';
import { resolvePersistedSample } from './samplerPersistence';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { Port } from '@openjammer/oj-ui';

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

/**
 * Set/clear the node's `sampleLoadError` flag (ERR-1) WITHOUT going through the
 * React `updateNodeData` closure. Read straight from the store so we compare
 * against the live value (never a stale render closure) and write only on a real
 * change — no spurious version bump, no undo-history entry (this derived state is
 * set outside any gesture, so it is correctly non-undoable). Mount-time only.
 */
function setLoadError(nodeId: string, value: boolean): void {
    const store = useGraphStore.getState();
    const current = store.nodes.get(nodeId)?.data as SamplerNodeData | undefined;
    if (!current || !!current.sampleLoadError === value) return;
    store.updateNodeData<SamplerNodeData>(nodeId, { sampleLoadError: value });
}

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
    // Persist user-dropped PCM through the SAME project-library path that library
    // and looper samples use (PERSIST-1): a bring-your-own sample becomes a real,
    // re-resolvable asset whose itemId we store in node.data — never the decoded
    // bytes — so undo-history snapshots and project size stay bounded. Read via a
    // ref so the load callbacks don't re-create when the library store mutates.
    const saveAudioToLibrary = useLibraryStore((s) => s.saveAudioToLibrary);
    const saveAudioToLibraryRef = useRef(saveAudioToLibrary);
    useEffect(() => {
        saveAudioToLibraryRef.current = saveAudioToLibrary;
    }, [saveAudioToLibrary]);
    const nodeRef = useRef<HTMLDivElement>(null);
    const sampleAreaRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
            // eslint-disable-next-line react-hooks/set-state-in-effect -- clears local waveform to mirror external sampleId being removed; runs only on that specific dep change, not every render
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
            const buffer = sampler.getBuffer();
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
                // PERSIST-1 round-trip (DEFECT 1 fix). The single re-resolve rule
                // lives in resolvePersistedSample: a REAL asset id (library sample
                // OR a user-dropped sample we persisted via saveAudioToLibrary) is
                // decoded and re-installed into the engine via setBuffer so the node
                // SOUNDS again; a throwaway legacy 'file:' id is unresolvable (its
                // PCM was never persisted).
                const result = await resolvePersistedSample(
                    data.sampleId,
                    sampler,
                    getItemFile,
                    (bytes) => ctx.decodeAudioData(bytes),
                );
                if (aborted) return;

                if (result.kind === 'loaded') {
                    const points = generateWaveform(result.buffer);
                    setWaveformData(points);
                    // Clear any stale error: the PCM is back in the engine.
                    setLoadError(node.id, false);
                } else if (result.kind === 'unresolved') {
                    // The engine has no PCM, so the node is silent. Keep the cached
                    // waveform so the user still recognizes WHICH sample is broken,
                    // and flag ERR-1 so the dead slot is visually distinct from an
                    // empty one — never a silent "looks loaded" fake visual.
                    if (data.waveformData && data.waveformData.length > 0) {
                        setWaveformData(data.waveformData);
                    }
                    setLoadError(node.id, true);
                }
            } catch (err) {
                if (!aborted) {
                    console.error('[SamplerNode] Failed to restore sample buffer:', err);
                    setLoadError(node.id, true);
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
                duration: buffer.duration,
                sampleLoadError: false,
            });
        } catch (error) {
            console.error('[SamplerNode] Failed to load clip audio:', error);
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

    // Decode an audio File and bind it as this sampler's voice (the bring-your-own
    // path). Shared by the drag-drop zone AND the click-to-browse file input.
    const loadAudioFile = useCallback(
        async (file: File) => {
            if (!(file.type.startsWith('audio/') || file.name.match(/\.(wav|mp3|ogg|flac|aiff|m4a)$/i))) {
                return;
            }
            const ctx = getAudioContext();
            if (!ctx) return;
            try {
                const arrayBuffer = await file.arrayBuffer();
                const buffer = await ctx.decodeAudioData(arrayBuffer);
                const sampler = await getExecutor().waitForSamplerAdapter(node.id);
                if (sampler) sampler.setBuffer(buffer);
                const points = generateWaveform(buffer);
                setWaveformData(points);

                // PERSIST-1: write the decoded PCM into the project library — the
                // SAME store library/looper samples use — so it becomes a real,
                // re-resolvable asset. We store the resulting itemId (NOT the bytes)
                // as sampleId; on remount the existing getItemFile -> decode ->
                // setBuffer flow re-installs the PCM into the engine, so the node
                // plays again instead of being a silent waveform polyline.
                //
                // Fallback: with no project open there is no library to write to,
                // so we keep the legacy throwaway 'file:' id — the sample still
                // sounds THIS session (engine has the live buffer); it just can't
                // be recovered on reload, which is the honest limit of "no project".
                let persistedId: string | null = null;
                try {
                    persistedId = await saveAudioToLibraryRef.current(buffer, file.name, ['sampler']);
                } catch (saveErr) {
                    // A library write failure is a background convenience, not a
                    // performance path — fall through to the live-only fallback id.
                    console.warn('[SamplerNode] Could not persist sample to library:', saveErr);
                }

                updateNodeData(node.id, {
                    sampleName: file.name,
                    sampleId: persistedId ?? `file:${file.name}:${Date.now()}`,
                    waveformData: points,
                    duration: buffer.duration,
                    sampleLoadError: false,
                });
            } catch (err) {
                console.error('[SamplerNode] Failed to decode audio file:', err);
            }
        },
        [node.id, updateNodeData, generateWaveform],
    );

    const handleFileInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) void loadAudioFile(file);
            e.target.value = ''; // allow re-picking the same file
        },
        [loadAudioFile],
    );

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const ctx = getAudioContext();

        // Handle file system files
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await loadAudioFile(files[0]);
            return;
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
                        duration: buffer.duration,
                        sampleLoadError: false,
                    });
                }
            } catch (err) {
                console.error('[SamplerNode] Failed to load library sample:', err);
            }
        }
    }, [node.id, updateNodeData, generateWaveform, loadAudioFile]);

    // Clear sample
    const handleClearSample = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        updateNodeData(node.id, {
            sampleId: null,
            sampleName: null,
            waveformData: undefined,
            duration: undefined,
            sampleLoadError: false,
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
    // ERR-1: a persisted sample whose PCM could not be re-resolved this mount —
    // the slot LOOKS loaded (name + cached waveform) but the engine is silent.
    // Render it distinctly so a broken sample is never mistaken for an empty or a
    // working one. Non-modal: it never steals focus.
    const hasLoadError = hasSample && !!data.sampleLoadError;

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
                <Port
                    kind="control"
                    direction="input"
                    connected={!!hasConnection?.(bundleInPort.id) || hasRows}
                    className={`sampler-side-port input ${hasConnection?.(bundleInPort.id) || hasRows ? 'connected' : ''}`}
                    style={{ width: '14px', height: '14px' }}
                    data-node-id={node.id}
                    data-port-id={bundleInPort.id}
                    data-port-type="control"
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(bundleInPort.id, e); }}
                    onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(bundleInPort.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(bundleInPort.id)}
                    onMouseLeave={handlePortMouseLeave}
                    title="Control input"
                />
            )}

            {/* Right side output port */}
            {audioOutPort && (
                <Port
                    kind="audio"
                    direction="output"
                    connected={!!hasConnection?.(audioOutPort.id)}
                    className={`sampler-side-port output ${hasConnection?.(audioOutPort.id) ? 'connected' : ''}`}
                    style={{ width: '14px', height: '14px' }}
                    data-node-id={node.id}
                    data-port-id={audioOutPort.id}
                    data-port-type="audio"
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(audioOutPort.id, e); }}
                    onMouseUp={(e: React.MouseEvent) => handlePortMouseUp?.(audioOutPort.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(audioOutPort.id)}
                    onMouseLeave={handlePortMouseLeave}
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
                className={`sampler-sample-area ${isDragOver || isClipDropTarget ? 'drag-over' : ''} ${hasSample ? 'has-sample' : ''} ${hasLoadError ? 'load-error' : ''}`}
                draggable={hasSample}
                onDragStart={handleSampleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                title={
                    hasLoadError
                        ? 'Sample could not be loaded — drop the file again to restore it'
                        : hasSample
                          ? 'Drag to copy sample to canvas'
                          : 'Drop audio file or clip here'
                }
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
                            {hasLoadError && (
                                <span
                                    className="sampler-load-error-badge"
                                    title="Sample could not be loaded — drop the file again to restore it"
                                    aria-label="Sample failed to load"
                                >
                                    !
                                </span>
                            )}
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
                    <button
                        type="button"
                        className="sampler-drop-text"
                        onClick={() => fileInputRef.current?.click()}
                        title="Click to choose an audio file, or drop one here"
                    >
                        Drop or click to load audio
                    </button>
                )}
            </div>
            {/* Hidden picker for click-to-browse (bring your own sample). */}
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
            />

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
