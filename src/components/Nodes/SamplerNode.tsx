/**
 * Sampler Node — one sample, played chromatically.
 *
 * The card is the sample: a real clip card (`WaveformView`) showing the trace,
 * the file name and the exact length, draggable back out onto the canvas and a
 * drop target for anything with audio in it. Under it, the four things that
 * decide how it sounds are four dials — bounded parameters get a `Knob` (the
 * W5-P6 control rule) — and the one exact FACT, the root note, is a mono
 * scrubber reading a real note name from the shared `noteNames` helper.
 *
 * Two things this file refuses to invent:
 *   • a "record" button — the Sampler has no capture path at the engine seam
 *     (`SamplerHandle` is get/setBuffer + rootNote/gain/attack/release). The
 *     Looper and the Recorder capture; the Sampler receives.
 *   • trim handles — a `SamplerNodeData` has no start/end frames, so a trim
 *     control would move a value nothing reads. Crop the clip on the canvas
 *     (double-click a clip) and drop the crop back in.
 *
 * ERR-1 (a persisted sample whose PCM could not be re-resolved) stays honest:
 * the slot keeps the cached shape so you recognise WHICH sample broke, and says
 * so in a Callout inside the card — never a modal, never a toast that steals the
 * canvas.
 *
 * Rebuilt in W5-P7.
 */

import { useCallback, useRef, useState, useEffect, memo } from 'react';
import type { GraphNode, SamplerNodeData, SamplerRow, AudioClip, ClipDropTarget } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { getItemFile, useLibraryStore } from '../../store/libraryStore';
import { getAudioContext } from '../../audio/audioContext';
import { getExecutor } from '../../audio/executor';
import { useAudioClipStore, getClipBuffer } from '../../store/audioClipStore';
import { loadClipAudio } from '../../utils/clipUtils';
import { formatSampleDuration } from '../../utils/audioMetadata';
import { isSamplerNodeData } from '../../engine/typeGuards';
import { resolvePersistedSample } from './samplerPersistence';
import { noteLabel } from '../controls/noteNames';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import {
    Button,
    Callout,
    IconButton,
    IconClose,
    Knob,
    NodeShell,
    PortRow,
    ValueScrubber,
    WaveformView,
} from '@openjammer/oj-ui';
import { useGestureBracket } from './nodeControls';
import './SamplerNode.css';

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
    const handleClearSample = useCallback(() => {
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

    // Change handlers. Each dial's whole sweep is ONE undo step: the bracket
    // opens on the first value change (pointer, wheel or Arrow key alike) and
    // closes on the control's commit.
    const rootGesture = useGestureBracket();
    const handleRootNoteChange = useCallback((newValue: number) => {
        const v = Math.round(Math.max(PARAM_RANGES.ROOT_NOTE.min, Math.min(PARAM_RANGES.ROOT_NOTE.max, newValue)));
        rootGesture.begin();
        updateNodeData(node.id, { rootNote: v });
        rootGesture.end();
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setRootNote(v);
    }, [node.id, updateNodeData, rootGesture]);

    const gain = useGestureBracket();
    const handleGainChange = useCallback((newValue: number) => {
        gain.begin();
        updateNodeData(node.id, { gain: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setGain(newValue);
    }, [node.id, updateNodeData, gain]);

    const spread = useGestureBracket();
    const handleSpreadChange = useCallback((newValue: number) => {
        spread.begin();
        updateNodeData(node.id, { spread: newValue });
    }, [node.id, updateNodeData, spread]);

    const attack = useGestureBracket();
    const handleAttackChange = useCallback((newValue: number) => {
        attack.begin();
        updateNodeData(node.id, { attack: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setAttack(newValue);
    }, [node.id, updateNodeData, attack]);

    const release = useGestureBracket();
    const handleReleaseChange = useCallback((newValue: number) => {
        release.begin();
        updateNodeData(node.id, { release: newValue });
        const sampler = getExecutor().getSamplerAdapter(node.id);
        if (sampler) sampler.setRelease(newValue);
    }, [node.id, updateNodeData, release]);

    // Scroll the root note by a semitone, with proper (non-passive) capture so
    // the canvas never pans under the pointer.
    const handleRootScroll = useCallback((scroll: ScrollData) => {
        handleRootNoteChange(data.rootNote + (scroll.scrollingUp ? 1 : -1));
    }, [data.rootNote, handleRootNoteChange]);

    const { ref: rootScrollRef } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleRootScroll,
        capture: true,
    });

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

    const cardClass = [
        'schematic-node',
        'sampler-node',
        hasLoadError && 'has-load-error',
        isHoveredWithConnections && 'hover-connecting',
        isClipDropTarget && 'clip-drop-target',
    ].filter(Boolean).join(' ');

    return (
        <NodeShell
            className={cardClass}
            style={style}
            title="Sampler"
            nodeType="SMPL"
            selected={!!isSelected}
            dragging={!!isDragging}
            headerProps={{ onMouseDown: handleHeaderMouseDown }}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
            inputs={bundleInPort ? (
                <PortRow
                    side="input"
                    kind="control"
                    label={bundleInPort.name || 'Keys'}
                    connected={!!hasConnection?.(bundleInPort.id) || hasRows}
                    data-node-id={node.id}
                    data-port-id={bundleInPort.id}
                    data-port-type="control"
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(bundleInPort.id, e); }}
                    onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(bundleInPort.id, e); }}
                    onMouseEnter={() => handlePortMouseEnter?.(bundleInPort.id)}
                    onMouseLeave={handlePortMouseLeave}
                    title="Control input — wire a keyboard here"
                />
            ) : undefined}
            outputs={audioOutPort ? (
                <PortRow
                    side="output"
                    kind="audio"
                    label={audioOutPort.name || 'Out'}
                    connected={!!hasConnection?.(audioOutPort.id)}
                    data-node-id={node.id}
                    data-port-id={audioOutPort.id}
                    data-port-type="audio"
                    onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(audioOutPort.id, e); }}
                    onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(audioOutPort.id, e); }}
                    onMouseEnter={() => handlePortMouseEnter?.(audioOutPort.id)}
                    onMouseLeave={handlePortMouseLeave}
                    title="Audio output"
                />
            ) : undefined}
        >
            <div className="sampler-body" onMouseDown={(e) => e.stopPropagation()}>
                {/* The slot. When it holds a sample it IS a clip card — the same
                    object you see on the canvas and in the library, so dragging it
                    out is obviously possible. */}
                <div
                    ref={sampleAreaRef}
                    className={`sampler-slot${isDragOver || isClipDropTarget ? ' is-drop-target' : ''}${hasSample ? ' has-sample' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {hasSample ? (
                        <WaveformView
                            className="sampler-clip"
                            peaks={waveformData}
                            durationLabel={data.duration ? formatSampleDuration(data.duration) : '—'}
                            name={data.sampleName}
                            draggable
                            dropTarget={isDragOver || isClipDropTarget}
                            onDragStart={handleSampleDragStart}
                            title={
                                hasLoadError
                                    ? 'Sample could not be loaded — drop the file again to restore it'
                                    : 'Drag to copy this sample onto the canvas'
                            }
                        />
                    ) : (
                        <div className="sampler-empty">
                            <Button
                                variant="secondary"
                                className="sampler-load"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                Load audio…
                            </Button>
                            <p className="sampler-empty__hint">
                                or drop a file, a clip, or a library sample here
                            </p>
                        </div>
                    )}
                </div>

                {/* Hidden picker for click-to-browse (bring your own sample). */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a"
                    className="sampler-file-input"
                    onChange={handleFileInputChange}
                />

                {/* ERR-1. The title now says the same thing as the body — W5-P7
                    titled it "Sample is silent" over a sentence about a file that
                    could not be found, which are two different faults. And the
                    box carries HEAD's accessible name ("Sample failed to load"),
                    which the rebuild dropped: a `role="note"` with no name is a
                    box a screen reader walks past. */}
                {hasLoadError && (
                    <Callout
                        variant="warning"
                        title="Sample not found"
                        aria-label="Sample failed to load"
                    >
                        Its audio could not be found on this machine, so this slot
                        makes no sound. Drop the file again — the shape above is
                        the one that broke.
                    </Callout>
                )}

                {/* The one exact FACT about the slot: which key plays it back at
                    its own pitch. Mono, because it is a machine value. */}
                {hasSample && (
                    <div className="sampler-slot-row">
                        <span ref={rootScrollRef} className="sampler-root">
                            <ValueScrubber
                                label="ROOT"
                                value={data.rootNote}
                                display={noteLabel(data.rootNote)}
                                onCommit={handleRootNoteChange}
                                title="Root note — the key that plays this sample at its own pitch. Scroll a semitone, click to type a MIDI number."
                            />
                        </span>
                        <IconButton
                            variant="ghost"
                            className="sampler-clear"
                            label="Remove this sample"
                            onClick={handleClearSample}
                            icon={<IconClose size={14} />}
                            title="Remove sample"
                        />
                    </div>
                )}

                {/* Four bounded parameters, so four dials (the W5-P6 control rule:
                    a bounded value gets a Knob up to six of them). */}
                <div className="sampler-dials">
                    <Knob
                        label="GAIN"
                        value={data.gain}
                        min={PARAM_RANGES.GAIN.min}
                        max={PARAM_RANGES.GAIN.max}
                        defaultValue={1}
                        size={44}
                        format={(v) => `${v.toFixed(2)}×`}
                        onChange={handleGainChange}
                        onCommit={gain.end}
                    />
                    <Knob
                        label="SPREAD"
                        value={data.spread}
                        min={PARAM_RANGES.SPREAD.min}
                        max={PARAM_RANGES.SPREAD.max}
                        defaultValue={1}
                        size={44}
                        format={(v) => `${v.toFixed(1)} st`}
                        onChange={handleSpreadChange}
                        onCommit={spread.end}
                    />
                    <Knob
                        label="ATTACK"
                        value={data.attack}
                        min={PARAM_RANGES.ATTACK.min}
                        max={PARAM_RANGES.ATTACK.max}
                        defaultValue={0.01}
                        size={44}
                        log
                        format={(v) => `${Math.round(v * 1000)} ms`}
                        onChange={handleAttackChange}
                        onCommit={attack.end}
                    />
                    <Knob
                        label="RELEASE"
                        value={data.release}
                        min={PARAM_RANGES.RELEASE.min}
                        max={PARAM_RANGES.RELEASE.max}
                        defaultValue={0.1}
                        size={44}
                        log
                        format={(v) => `${Math.round(v * 1000)} ms`}
                        onChange={handleReleaseChange}
                        onCommit={release.end}
                    />
                </div>

                {/* SPREAD only means something once a keyboard row is wired in,
                    so the sentence that explains it appears exactly then. An
                    idle card stays short. */}
                {hasRows && (
                    <p className="sampler-hint">
                        Spread is semitones per key — how far the pitch walks across the row.
                    </p>
                )}
            </div>
        </NodeShell>
    );
});

export default SamplerNode;
