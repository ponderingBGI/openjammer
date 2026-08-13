/**
 * Looper Node - Record and loop audio (Schematic Style)
 *
 * Compact horizontal layout with inline ports, waveform visualization, and a
 * minimal record button.
 *
 * STATE IS ENGINE-DRIVEN. The transport (idle / recording / overdubbing /
 * playing), the committed rows, the playhead and the live trace all come FROM
 * the engine through the looper handle's return-frame callbacks
 * (`onEngineFrame` -> `setOnWaveformHistoryUpdate`, `onEngineEdge` ->
 * `setOnLoopAdded`/`setOnLoopDeleted`). The UI never guesses a state that can
 * fail to reset: after a cycle wrap the engine reports PLAYING, the handle adds
 * a real row, and the playhead rides the engine's sample position. A held note
 * beats a glitch — control errors surface as inline, non-focus-stealing hints,
 * never a modal prompt or a toast that steals the canvas.
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import type { GraphNode, LooperNodeData, AudioClip, ClipDropTarget } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { useAudioClipStore, setClipBuffer, getClipBuffer } from '../../store/audioClipStore';
import { useLibraryStore } from '../../store/libraryStore';
import { getExecutor, INFINITE_DURATION, isInfiniteDuration, type Loop } from '../../audio/executor';
import { getAudioContext } from '../../audio/audioContext';
import { createClipFromLoop, loadClipAudio } from '../../utils/clipUtils';
import { useScrollCapture } from '../../hooks/useScrollCapture';
import type { ScrollData } from '../../hooks/useScrollCapture';
import { ScrollContainer } from '../common/ScrollContainer';
import { LooperState } from '../../../packages/oj-protocol-ts/src/index';
import { Port } from '@openjammer/oj-ui';

// Type for library store functions to use in refs
type SaveAudioToLibraryFn = (buffer: AudioBuffer, name: string, tags?: string[]) => Promise<string | null>;
type TrashItemFn = (itemId: string) => void;

interface LooperNodeProps {
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

interface LoopRow {
    id: string;
    waveformData: number[];  // The recorded waveform shape
    isMuted: boolean;
    libraryItemId?: string;  // Reference to saved library item
}

/** Default loop-level wet gain when the node has none persisted (kernel default). */
const DEFAULT_LOOP_VOLUME = 1;

export const LooperNode = memo(function LooperNode({
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
}: LooperNodeProps) {
    const data = node.data as LooperNodeData;
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const beginGesture = useGraphStore((s) => s.beginGesture);
    const endGesture = useGraphStore((s) => s.endGesture);
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);

    // Audio clip store for drag-out functionality
    const addClip = useAudioClipStore((s) => s.addClip);
    const startClipDrag = useAudioClipStore((s) => s.startDrag);
    const registerDropTarget = useAudioClipStore((s) => s.registerDropTarget);
    const unregisterDropTarget = useAudioClipStore((s) => s.unregisterDropTarget);
    const clipDragState = useAudioClipStore((s) => s.dragState);

    // Library store for auto-saving loops and trashing deleted items
    const saveAudioToLibrary = useLibraryStore((s) => s.saveAudioToLibrary);
    const trashItem = useLibraryStore((s) => s.trashItem);

    // Refs for library store functions to avoid re-running effect when store updates
    // This prevents the effect from re-running when saveAudioToLibrary updates the store,
    // which could cause stale closures or unnecessary callback re-registrations
    const saveAudioToLibraryRef = useRef<SaveAudioToLibraryFn>(saveAudioToLibrary);
    const trashItemRef = useRef<TrashItemFn>(trashItem);

    // Keep refs in sync with latest function references
    useEffect(() => {
        saveAudioToLibraryRef.current = saveAudioToLibrary;
    }, [saveAudioToLibrary]);

    useEffect(() => {
        trashItemRef.current = trashItem;
    }, [trashItem]);

    // Ref for drop target bounds
    const nodeRef = useRef<HTMLDivElement>(null);

    const [loops, setLoops] = useState<LoopRow[]>([]);
    // The engine looper state — the SSOT for the transport UI. Driven by the
    // return frames, NEVER a local guess that can fail to reset.
    const [engineState, setEngineState] = useState<LooperState>(LooperState.IDLE);
    const [duration, setDuration] = useState(data.duration || 10);
    const [isEditingDuration, setIsEditingDuration] = useState(false);
    const [editValue, setEditValue] = useState('');

    // Loop-level wet gain (0..1) — the balance control for the summed layers.
    const [loopVolume, setLoopVolume] = useState(
        data.loopVolume ?? DEFAULT_LOOP_VOLUME
    );

    // Inline rename affordance for export (replaces the focus-stealing prompt).
    const [renamingLoopId, setRenamingLoopId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    // Active recording/playback waveform + playhead (driven by the engine frame).
    const [waveformHistory, setWaveformHistory] = useState<number[]>([]);
    const [playheadPosition, setPlayheadPosition] = useState(0);
    const [currentLevel, setCurrentLevel] = useState(0); // For infinite mode bouncing line

    // Ref for auto-scrolling loops list
    const loopsContainerRef = useRef<HTMLDivElement>(null);

    // Derived transport flags from the engine state (no separate local boolean).
    const isRecording =
        engineState === LooperState.RECORDING ||
        engineState === LooperState.OVERDUBBING;
    const isPlaying = engineState === LooperState.PLAYING;
    const hasLayers = loops.length > 0;

    // Get port IDs from node.ports
    const inputPort = node.ports.find(p => p.direction === 'input' && p.type === 'audio');
    const outputPort = node.ports.find(p => p.direction === 'output' && p.type === 'audio');
    const inputPortId = inputPort?.id || 'audio-in';
    const outputPortId = outputPort?.id || 'audio-out';

    // Get the Looper instance from the audio executor
    const getLooper = useCallback(() => {
        return getExecutor().getLooper(node.id);
    }, [node.id]);

    // Set up Looper callbacks when component mounts or audio context becomes ready
    // Uses refs for library store functions to prevent effect re-runs when store updates
    useEffect(() => {
        if (!isAudioContextReady) return;

        let looper = getLooper();
        let pollIntervalId: number | null = null;
        let isSetup = false;

        const syncRowsFromHandle = (l: ReturnType<typeof getLooper>) => {
            if (!l) return;
            // The handle's getLoops() is the SSOT for the committed layers (in
            // kernel/commit order); mirror it verbatim so row order == layer index.
            setLoops(l.getLoops().map((loop) => ({
                id: loop.id,
                waveformData: loop.waveformData || [],
                isMuted: loop.isMuted,
                libraryItemId: loop.libraryItemId,
            })));
        };

        const setupCallbacks = (l: ReturnType<typeof getLooper>) => {
            if (!l || isSetup) return;
            isSetup = true;

            l.setOnLoopAdded(async (audioLoop: Loop) => {
                // The handle already appended the row to getLoops(); re-sync from
                // it so order stays aligned with the kernel layer indices.
                syncRowsFromHandle(getLooper());
                // Reset active waveform history for next recording.
                setWaveformHistory([]);

                if (audioLoop.buffer) {
                    // Auto-save to project library with "loop" tag. Use a ref to
                    // read the latest fn without causing effect re-runs.
                    try {
                        const itemId = await saveAudioToLibraryRef.current(audioLoop.buffer, 'Loop', ['loop']);
                        if (itemId) {
                            audioLoop.libraryItemId = itemId;
                            setLoops(prev => prev.map(loop =>
                                loop.id === audioLoop.id ? { ...loop, libraryItemId: itemId } : loop
                            ));
                        }
                        // A failed library save is a background convenience, not a
                        // performance-critical path — no focus-stealing toast.
                        // The loop still plays; we stay quiet (a held note beats a glitch).
                    } catch (err) {
                        console.warn('[Looper] Failed to auto-save loop to library:', err);
                    }
                }
            });

            l.setOnLoopDeleted((deletedLoop: Loop) => {
                // Trash the library item if the loop was saved (ref avoids re-runs).
                if (deletedLoop.libraryItemId) {
                    trashItemRef.current(deletedLoop.libraryItemId);
                }
                // Re-sync rows from the handle (it already spliced its list).
                syncRowsFromHandle(getLooper());
            });

            // Stage 3: a committed layer's TRUE captured PCM arrived after the row
            // was created (it crosses the seam on a separate path). Re-sync rows so
            // the meter-envelope trace swaps to the real waveform shape, and
            // auto-save the now-real buffer to the library (parity with the
            // clip-dropped path in onLoopAdded). The row's `buffer` is now non-null,
            // so drag-to-library + export light up for recorded loops.
            l.setOnLoopUpdated(async (updatedLoop: Loop) => {
                syncRowsFromHandle(getLooper());
                if (updatedLoop.buffer && !updatedLoop.libraryItemId) {
                    try {
                        const itemId = await saveAudioToLibraryRef.current(
                            updatedLoop.buffer,
                            'Loop',
                            ['loop'],
                        );
                        if (itemId) {
                            updatedLoop.libraryItemId = itemId;
                            setLoops((prev) =>
                                prev.map((loop) =>
                                    loop.id === updatedLoop.id
                                        ? { ...loop, libraryItemId: itemId }
                                        : loop,
                                ),
                            );
                        }
                    } catch (err) {
                        // Background convenience; a held note beats a glitch.
                        console.warn('[Looper] Failed to auto-save finalized loop:', err);
                    }
                }
            });

            l.setOnWaveformHistoryUpdate((history: number[], playhead: number) => {
                // Every engine return frame drives the transport state, the live
                // trace and the real playhead. This is the ONLY clock — no rAF, no
                // synthetic local tick (the engine owns transport timing).
                const st = l.getEngineState() as LooperState;
                setEngineState(st);
                setWaveformHistory(history);
                setPlayheadPosition(playhead);
                if (history.length > 0) {
                    setCurrentLevel(history[history.length - 1]);
                }
            });

            l.setDuration(duration);
            // Push the persisted loop-level wet into the engine on (re)mount so the
            // balance survives reload (no-op until the node is in the graph).
            l.setWet(data.loopVolume ?? DEFAULT_LOOP_VOLUME);

            // Mirror any layers the handle already holds (e.g. after a remount).
            syncRowsFromHandle(l);
            setEngineState(l.getEngineState() as LooperState);
        };

        // If looper is available, set up immediately
        if (looper) {
            setupCallbacks(looper);
        } else {
            // Poll for looper availability with exponential backoff
            let delay = 50;
            const maxDelay = 1000;
            const maxAttempts = 10;
            let attempts = 0;

            const poll = () => {
                attempts++;
                looper = getLooper();
                if (looper) {
                    setupCallbacks(looper);
                } else if (attempts < maxAttempts) {
                    delay = Math.min(delay * 2, maxDelay);
                    pollIntervalId = window.setTimeout(poll, delay);
                } else if (import.meta.env.DEV) {
                    console.warn(`LooperNode: Failed to get looper after ${maxAttempts} attempts`);
                }
            };
            pollIntervalId = window.setTimeout(poll, delay);
        }

        return () => {
            if (pollIntervalId !== null) {
                clearTimeout(pollIntervalId);
            }
            const l = getLooper();
            if (l) {
                l.setOnLoopAdded(() => {});
                l.setOnLoopDeleted(() => {});
                l.setOnLoopUpdated(() => {});
                l.setOnWaveformHistoryUpdate(() => {});
            }
        };
    // Note: saveAudioToLibrary and trashItem are accessed via refs to prevent
    // effect re-runs when the library store updates (which happens during saving).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAudioContextReady, node.id, duration, getLooper]);

    // Auto-scroll to show newest loops when new loop is added
    useEffect(() => {
        if (loopsContainerRef.current && loops.length > 0) {
            // With column-reverse, scroll to top to see newest
            loopsContainerRef.current.scrollTop = 0;
        }
    }, [loops.length]);

    const handleRecord = useCallback(async () => {
        const looper = getLooper();
        if (!looper) return;
        // Start a pass. The engine decides RECORDING (first take) vs OVERDUBBING
        // (layers exist) and reports it back; the UI reflects that, never guesses.
        await looper.startRecording();
    }, [getLooper]);

    const handleStopRecord = useCallback(() => {
        const looper = getLooper();
        if (looper) {
            looper.stopRecording();
        }
        // Do NOT set a local state here — the engine reports the commit edge
        // (RECORDING|OVERDUBBING -> PLAYING) which flips the UI authoritatively.
    }, [getLooper]);

    const handleToggleMute = useCallback((loopId: string) => {
        const looper = getLooper();
        if (looper) {
            looper.toggleLoopMute(loopId);
        }
        setLoops(prev => prev.map(loop =>
            loop.id === loopId ? { ...loop, isMuted: !loop.isMuted } : loop
        ));
    }, [getLooper]);

    const handleDeleteLoop = useCallback((loopId: string) => {
        const looper = getLooper();
        if (looper) {
            looper.deleteLoop(loopId);
        }
        // The handle's onLoopDeleted re-syncs rows; splice optimistically too so
        // the row vanishes instantly (design-for-instant).
        setLoops(prev => prev.filter(loop => loop.id !== loopId));
    }, [getLooper]);

    // Undo the most-recently committed layer (LIFO) — a real engine UNDO_LAST.
    const handleUndoLast = useCallback(() => {
        const looper = getLooper();
        if (!looper) return;
        looper.undoLast();
        // onLoopDeleted re-syncs; pop optimistically for instant feedback.
        setLoops(prev => prev.slice(0, -1));
    }, [getLooper]);

    // Begin an inline rename for export (replaces window.prompt).
    const beginExportRename = useCallback((loopId: string, loopIndex: number) => {
        setRenamingLoopId(loopId);
        setRenameValue(`Loop ${loopIndex + 1}`);
    }, []);

    const commitExportRename = useCallback(async () => {
        const loopId = renamingLoopId;
        setRenamingLoopId(null);
        if (!loopId) return;
        const name = renameValue.trim();
        if (!name) return;

        const looper = getLooper();
        if (!looper) return;
        const audioLoop = looper.getLoops().find(l => l.id === loopId);
        if (!audioLoop?.buffer) return;

        const itemId = await saveAudioToLibraryRef.current(audioLoop.buffer, name, ['exported', 'loop']);
        if (itemId) {
            setLoops(prev => prev.map(l =>
                l.id === loopId ? { ...l, libraryItemId: itemId } : l
            ));
        }
    }, [renamingLoopId, renameValue, getLooper]);

    const isInfinite = isInfiniteDuration(duration);

    const handleDurationChange = useCallback((newDuration: number) => {
        let finalDuration: number;
        if (isInfiniteDuration(newDuration)) {
            finalDuration = INFINITE_DURATION;
        } else {
            // Clamp to valid range: 1-60 seconds
            finalDuration = Math.max(1, Math.min(60, newDuration));
        }
        setDuration(finalDuration);
        // Bracket the node.data write in a gesture so Ctrl+Z reverts it.
        beginGesture();
        updateNodeData<LooperNodeData>(node.id, { duration: finalDuration });
        endGesture();

        const looper = getLooper();
        if (looper) {
            looper.setDuration(finalDuration);
        }
    }, [node.id, updateNodeData, getLooper, beginGesture, endGesture]);

    // Loop-level wet (balance) control. Drives SetParam(WET) on the looper and
    // persists into node.data inside a gesture so Ctrl+Z reverts it.
    const handleLoopVolumeChange = useCallback((next: number) => {
        const v = Math.max(0, Math.min(1, next));
        setLoopVolume(v);
        const looper = getLooper();
        if (looper) {
            looper.setWet(v);
        }
        beginGesture();
        updateNodeData<LooperNodeData>(node.id, { loopVolume: v });
        endGesture();
    }, [node.id, updateNodeData, getLooper, beginGesture, endGesture]);

    // Handle scroll on duration value (uses native listener for proper trackpad support)
    const handleDurationScroll = useCallback((scroll: ScrollData) => {
        if (isRecording || isEditingDuration) return;

        if (isInfinite && scroll.scrollingDown) {
            // Scrolling down from infinite goes to 60
            handleDurationChange(60);
        } else if (duration === 60 && scroll.scrollingUp) {
            // Scrolling up from 60 goes to infinite
            handleDurationChange(INFINITE_DURATION);
        } else if (!isInfinite) {
            const delta = scroll.scrollingUp ? 1 : -1;
            handleDurationChange(duration + delta);
        }
    }, [duration, isInfinite, isRecording, isEditingDuration, handleDurationChange]);

    // Scroll capture for duration adjustment
    const { ref: durationScrollRef } = useScrollCapture<HTMLSpanElement>({
        onScroll: handleDurationScroll,
        enabled: !isRecording && !isEditingDuration,
    });

    const handleDurationClick = useCallback((e: React.MouseEvent) => {
        if (isRecording) return;
        e.stopPropagation();
        setEditValue(isInfinite ? '' : String(duration));
        setIsEditingDuration(true);
    }, [isRecording, duration, isInfinite]);

    const handleDurationBlur = useCallback(() => {
        const newDuration = parseInt(editValue, 10);
        if (!isNaN(newDuration) && newDuration > 0) {
            handleDurationChange(newDuration);
        } else if (editValue === '' && isInfinite) {
            // Keep infinite if input was cleared while infinite
        } else if (editValue === '') {
            // Empty input defaults to 10
            handleDurationChange(10);
        }
        setIsEditingDuration(false);
    }, [editValue, isInfinite, handleDurationChange]);

    const handleDurationKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleDurationBlur();
        } else if (e.key === 'Escape') {
            setIsEditingDuration(false);
        }
    }, [handleDurationBlur]);

    // Handle drag-out from loop items
    const handleLoopDragStart = useCallback((loopRow: LoopRow, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const looper = getLooper();
        if (!looper) return;

        // Find the actual loop with buffer
        const loop = looper.getLoops().find(l => l.id === loopRow.id);
        if (!loop || !loop.buffer) return;

        // Create a temporary sample ID based on the loop
        const tempSampleId = `looper-${node.id}-${loopRow.id}-${Date.now()}`;
        const tempSampleName = `Loop ${loops.indexOf(loopRow) + 1}.wav`;

        // Store the buffer in global cache so any looper can access it
        setClipBuffer(tempSampleId, loop.buffer);

        // Create the clip
        const clipData = createClipFromLoop(loop, tempSampleId, tempSampleName, node.id);
        if (!clipData) return; // Buffer was null (shouldn't happen since we checked above)

        // Add to store and get the ID
        const clipId = addClip(clipData);

        // Get bounds of the loop item element
        const target = e.currentTarget as HTMLElement;
        const bounds = target.getBoundingClientRect();

        // Remove the loop from the looper (move semantics - the loop becomes a clip)
        looper.deleteLoop(loopRow.id);
        setLoops(prev => prev.filter(l => l.id !== loopRow.id));

        // Start dragging
        startClipDrag(clipId, { x: e.clientX, y: e.clientY }, bounds);
    }, [getLooper, node.id, loops, addClip, startClipDrag]);

    // Handle clip drop into looper (add as new loop layer)
    const handleClipDrop = useCallback(async (clip: AudioClip) => {
        const looper = getLooper();
        if (!looper) return;

        try {
            // First check if buffer is in cache (for looper-originated clips)
            const cachedBuffer = getClipBuffer(clip.sampleId);
            if (cachedBuffer) {
                looper.addLoopFromBuffer(cachedBuffer);
                return;
            }

            const audioContext = getAudioContext();
            if (!audioContext) return;

            const buffer = await loadClipAudio(clip, audioContext);
            looper.addLoopFromBuffer(buffer);
        } catch (error) {
            console.error('Failed to load clip audio for looper:', error);
        }
    }, [getLooper]);

    // Register as drop target
    useEffect(() => {
        const dropTarget: ClipDropTarget = {
            nodeId: node.id,
            targetName: 'Looper',
            onClipDrop: handleClipDrop,
            canAcceptClip: () => true, // Accept any audio clip
            getDropZoneBounds: () => nodeRef.current?.getBoundingClientRect() ?? null,
        };

        registerDropTarget(dropTarget);
        return () => unregisterDropTarget(node.id);
    }, [node.id, handleClipDrop, registerDropTarget, unregisterDropTarget]);

    // Visual feedback when being dragged over
    const isDropTarget = clipDragState.hoveredTargetId === node.id;

    return (
        <div
            ref={nodeRef}
            className={`schematic-node looper-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'clip-drop-target' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header - "Looper" + live transport status */}
            <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                <span>Looper</span>
                {(isRecording || isPlaying) && (
                    <span
                        className={`looper-status ${isRecording ? 'recording' : 'playing'}`}
                        title={isRecording ? 'Recording a pass' : 'Looping'}
                    >
                        {engineState === LooperState.OVERDUBBING
                            ? 'OVERDUB'
                            : isRecording
                                ? 'REC'
                                : 'LOOP'}
                    </span>
                )}
            </div>

            {/* Main row: Audio In - Duration - Audio Out */}
            <div className="looper-main-row">
                <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}>
                    <Port
                        kind="audio"
                        direction="input"
                        connected={hasConnection(inputPortId)}
                        style={{ width: '14px', height: '14px' }}
                        data-node-id={node.id}
                        data-port-id={inputPortId}
                        onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(inputPortId, e); }}
                        onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(inputPortId, e); }}
                        onMouseEnter={() => handlePortMouseEnter?.(inputPortId)}
                        onMouseLeave={handlePortMouseLeave}
                    />
                </div>
                <div className="looper-duration-container">
                    {isEditingDuration ? (
                        <input
                            className="looper-duration-input"
                            type="number"
                            min="1"
                            max="60"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleDurationBlur}
                            onKeyDown={handleDurationKeyDown}
                            autoFocus
                        />
                    ) : (
                        <span
                            ref={durationScrollRef}
                            className={`looper-duration editable-value ${isRecording ? 'disabled' : ''}`}
                            onClick={handleDurationClick}
                            title="Click to edit, scroll to adjust"
                        >
                            {isInfinite ? '∞' : duration}
                        </span>
                    )}
                    {!isInfinite && <span className="looper-duration-unit">s</span>}
                </div>
                <div style={{ position: 'absolute', right: 0, top: '50%', transform: 'translate(50%, -50%)' }}>
                    <Port
                        kind="audio"
                        direction="output"
                        connected={hasConnection(outputPortId)}
                        style={{ width: '14px', height: '14px' }}
                        data-node-id={node.id}
                        data-port-id={outputPortId}
                        onMouseDown={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseDown?.(outputPortId, e); }}
                        onMouseUp={(e: React.MouseEvent) => { e.stopPropagation(); handlePortMouseUp?.(outputPortId, e); }}
                        onMouseEnter={() => handlePortMouseEnter?.(outputPortId)}
                        onMouseLeave={handlePortMouseLeave}
                    />
                </div>
            </div>

            {/* Active recording / playback waveform with playhead. Shown while a
                pass is recording (red trace) OR while looping (the playhead rides
                the engine's real sample position). */}
            {(isRecording || isPlaying) && (
                <div className="looper-active-waveform">
                    <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                        {isInfinite && isRecording ? (
                            /* Infinite mode: bouncing horizontal line */
                            <line
                                x1="0"
                                y1={10 - currentLevel * 8}
                                x2="100"
                                y2={10 - currentLevel * 8}
                                className="looper-waveform-path recording"
                                strokeWidth="2"
                            />
                        ) : (
                            <>
                                {/* Waveform line building up (recording) */}
                                {isRecording && waveformHistory.length > 1 && (
                                    <polyline
                                        className="looper-waveform-path recording"
                                        fill="none"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        points={waveformHistory.map((v, i) =>
                                            `${(i / (waveformHistory.length - 1)) * Math.max(playheadPosition, 1)},${10 - v * 8}`
                                        ).join(' ')}
                                    />
                                )}
                                {/* Playhead vertical line at the engine cycle position */}
                                <line
                                    x1={playheadPosition}
                                    y1="0"
                                    x2={playheadPosition}
                                    y2="20"
                                    className="looper-playhead"
                                />
                            </>
                        )}
                    </svg>
                </div>
            )}

            {/* Completed loops as line waveforms (real committed layers in order) */}
            {hasLayers && (
                <ScrollContainer
                    mode="dropdown"
                    className="looper-loops"
                    ref={loopsContainerRef}
                >
                    {loops.map((loop) => (
                        <div
                            key={loop.id}
                            className={`looper-loop-item ${loop.isMuted ? 'muted' : ''}`}
                            onMouseDown={(e) => handleLoopDragStart(loop, e)}
                            style={{ cursor: 'grab' }}
                            title="Drag to canvas or another node"
                        >
                            <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                                {loop.waveformData.length > 1 ? (
                                    <polyline
                                        className="looper-waveform-path"
                                        fill="none"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        points={loop.waveformData.map((v, i) =>
                                            `${(i / (loop.waveformData.length - 1)) * 100},${10 - v * 8}`
                                        ).join(' ')}
                                    />
                                ) : (
                                    <line x1="0" y1="10" x2="100" y2="10" className="looper-waveform-path" />
                                )}
                            </svg>
                            {renamingLoopId === loop.id ? (
                                <input
                                    className="looper-rename-input"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={commitExportRename}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitExportRename();
                                        else if (e.key === 'Escape') setRenamingLoopId(null);
                                    }}
                                    autoFocus
                                    placeholder="Export name…"
                                />
                            ) : (
                                <div className="looper-loop-controls">
                                    <button
                                        className={`looper-loop-btn ${loop.isMuted ? 'muted' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); handleToggleMute(loop.id); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        title={loop.isMuted ? 'Unmute' : 'Mute'}
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                            {loop.isMuted ? (
                                                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                                            ) : (
                                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                                            )}
                                        </svg>
                                    </button>
                                    <button
                                        className={`looper-loop-btn export ${loop.libraryItemId ? 'exported' : ''}`}
                                        onClick={(e) => { e.stopPropagation(); beginExportRename(loop.id, loops.indexOf(loop)); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        title={loop.libraryItemId ? 'Re-export to library' : 'Export to library'}
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                                        </svg>
                                    </button>
                                    <button
                                        className="looper-loop-btn delete"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteLoop(loop.id); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        title="Delete"
                                    >
                                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </ScrollContainer>
            )}

            {/* Loop-level balance (wet) control — tames the "loop adds on top"
                loudness. Only meaningful once there are layers. */}
            {hasLayers && (
                <div className="looper-balance-row" title="Loop balance (wet)">
                    <span className="looper-balance-label">Balance</span>
                    <input
                        className="looper-balance-slider"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={loopVolume}
                        onChange={(e) => handleLoopVolumeChange(parseFloat(e.target.value))}
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                    <span className="looper-balance-value">{Math.round(loopVolume * 100)}</span>
                    <button
                        className="looper-undo-btn"
                        onClick={(e) => { e.stopPropagation(); handleUndoLast(); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        title="Undo last layer"
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                            <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
                        </svg>
                    </button>
                </div>
            )}

            {/* Record button - centered red circle with white center */}
            <div className="looper-record-container">
                <button
                    className={`looper-record-btn ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? handleStopRecord : handleRecord}
                    disabled={!isAudioContextReady}
                    aria-label={
                        isRecording
                            ? 'Stop and commit this loop pass'
                            : hasLayers
                              ? 'Overdub a new layer'
                              : 'Record a loop'
                    }
                    aria-pressed={isRecording}
                    title={isRecording ? 'Stop / commit pass' : hasLayers ? 'Overdub a layer' : 'Record'}
                />
            </div>

        </div>
    );
});
