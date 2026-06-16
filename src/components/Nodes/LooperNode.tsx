/**
 * Looper Node - Record and loop audio (Schematic Style)
 *
 * Compact horizontal layout with inline ports, waveform visualization,
 * and a minimal record button.
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import type { GraphNode, LooperNodeData, AudioClip, ClipDropTarget } from '../../engine/types';
import { useGraphStore } from '../../store/graphStore';
import { useAudioStore } from '../../store/audioStore';
import { useAudioClipStore, setClipBuffer, getClipBuffer } from '../../store/audioClipStore';
import { useLibraryStore } from '../../store/libraryStore';
import { getExecutor } from '../../audio/executor';
import { getAudioContext } from '../../audio/AudioEngine';
import { INFINITE_DURATION, isInfiniteDuration, type Loop } from '../../audio/Looper';
import { createClipFromLoop, loadClipAudio } from '../../utils/clipUtils';
import { useScrollCapture } from '../../hooks/useScrollCapture';
import type { ScrollData } from '../../hooks/useScrollCapture';
import { ScrollContainer } from '../common/ScrollContainer';
import { toast } from 'sonner';

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

interface LoopState {
    id: string;
    waveformData: number[];  // The recorded waveform shape
    isMuted: boolean;
    libraryItemId?: string;  // Reference to saved library item
}

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

    const [loops, setLoops] = useState<LoopState[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const [duration, setDuration] = useState(data.duration || 10);
    const [isEditingDuration, setIsEditingDuration] = useState(false);
    const [editValue, setEditValue] = useState('');

    // Active recording waveform
    const [waveformHistory, setWaveformHistory] = useState<number[]>([]);
    const [playheadPosition, setPlayheadPosition] = useState(0);
    const [currentLevel, setCurrentLevel] = useState(0); // For infinite mode bouncing line

    // Ref for auto-scrolling loops list
    const loopsContainerRef = useRef<HTMLDivElement>(null);

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

        const setupCallbacks = (l: ReturnType<typeof getLooper>) => {
            if (!l || isSetup) return;
            isSetup = true;

            l.setOnLoopAdded(async (audioLoop: Loop) => {
                const newLoop: LoopState = {
                    id: audioLoop.id,
                    waveformData: audioLoop.waveformData || [],
                    isMuted: audioLoop.isMuted,
                    libraryItemId: undefined  // Will be set after save completes
                };
                setLoops(prev => [...prev, newLoop]);
                // Reset active waveform history for next recording
                setWaveformHistory([]);
                setPlayheadPosition(0);

                if (audioLoop.buffer) {
                    // Auto-save to project library with "loop" tag
                    // Use ref to get latest function without causing effect re-runs
                    try {
                        const itemId = await saveAudioToLibraryRef.current(audioLoop.buffer, 'Loop', ['loop']);
                        if (itemId) {
                            // Store the library item ID on both the Loop object and React state
                            audioLoop.libraryItemId = itemId;
                            setLoops(prev => prev.map(loop =>
                                loop.id === audioLoop.id ? { ...loop, libraryItemId: itemId } : loop
                            ));
                        } else {
                            toast.error('Failed to save loop to library');
                        }
                    } catch (err) {
                        console.warn('[Looper] Failed to auto-save loop to library:', err);
                        toast.error('Failed to save loop to library');
                    }
                }
            });

            l.setOnLoopDeleted((deletedLoop: Loop) => {
                // Trash the library item if the loop was saved
                // Use ref to get latest function without causing effect re-runs
                if (deletedLoop.libraryItemId) {
                    trashItemRef.current(deletedLoop.libraryItemId);
                }
            });

            l.setOnWaveformHistoryUpdate((history: number[], playhead: number) => {
                setWaveformHistory(history);
                setPlayheadPosition(playhead);
                // Track current level for infinite mode visualization
                if (history.length > 0) {
                    setCurrentLevel(history[history.length - 1]);
                }
            });

            l.setDuration(duration);

            const existingLoops = l.getLoops();
            if (existingLoops.length > 0) {
                setLoops(existingLoops.map(loop => ({
                    id: loop.id,
                    waveformData: loop.waveformData || [],
                    isMuted: loop.isMuted,
                    libraryItemId: loop.libraryItemId
                })));
            }
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
                l.setOnWaveformHistoryUpdate(() => {});
            }
        };
    // Note: saveAudioToLibrary and trashItem are accessed via refs to prevent
    // effect re-runs when the library store updates (which happens during saving).
    // This fixes a bug where loops were being trashed immediately after recording
    // due to effect re-runs causing callback re-registration.
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
        if (!looper) {
            console.warn('No looper instance available');
            return;
        }

        await looper.startRecording();
        setIsRecording(true);
    }, [getLooper]);

    const handleStopRecord = useCallback(() => {
        const looper = getLooper();
        if (looper) {
            looper.stopRecording();
        }
        setIsRecording(false);
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
        setLoops(prev => prev.filter(loop => loop.id !== loopId));
    }, [getLooper]);

    const handleExportLoop = useCallback(async (loopId: string, loopIndex: number) => {
        const looper = getLooper();
        if (!looper) return;

        const audioLoop = looper.getLoops().find(l => l.id === loopId);
        if (!audioLoop?.buffer) return;

        // Prompt for name
        const defaultName = `Loop ${loopIndex + 1}`;
        const name = window.prompt('Export name:', defaultName);
        if (!name) return;

        // Save to library
        const itemId = await saveAudioToLibraryRef.current(audioLoop.buffer, name, ['exported', 'loop']);
        if (itemId) {
            // Update loop state with library item ID
            setLoops(prev => prev.map(l =>
                l.id === loopId ? { ...l, libraryItemId: itemId } : l
            ));
        }
    }, [getLooper]);

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
        updateNodeData<LooperNodeData>(node.id, { duration: finalDuration });

        const looper = getLooper();
        if (looper) {
            looper.setDuration(finalDuration);
        }
    }, [node.id, updateNodeData, getLooper]);

    // Handle scroll on duration value (uses native listener for proper trackpad support)
    const handleDurationScroll = useCallback((data: ScrollData) => {
        if (isRecording || isEditingDuration) return;

        if (isInfinite && data.scrollingDown) {
            // Scrolling down from infinite goes to 60
            handleDurationChange(60);
        } else if (duration === 60 && data.scrollingUp) {
            // Scrolling up from 60 goes to infinite
            handleDurationChange(INFINITE_DURATION);
        } else if (!isInfinite) {
            const delta = data.scrollingUp ? 1 : -1;
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
    const handleLoopDragStart = useCallback((loopState: LoopState, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const looper = getLooper();
        if (!looper) return;

        // Find the actual loop with buffer
        const loop = looper.getLoops().find(l => l.id === loopState.id);
        if (!loop || !loop.buffer) return;

        // Create a temporary sample ID based on the loop
        const tempSampleId = `looper-${node.id}-${loopState.id}-${Date.now()}`;
        const tempSampleName = `Loop ${loops.indexOf(loopState) + 1}.wav`;

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
        looper.deleteLoop(loopState.id);
        // Update React state to reflect removal
        setLoops(prev => prev.filter(l => l.id !== loopState.id));

        // Start dragging
        startClipDrag(clipId, { x: e.clientX, y: e.clientY }, bounds);
    }, [getLooper, node.id, loops, addClip, startClipDrag]);

    // Handle clip drop into looper (add as new loop layer)
    const handleClipDrop = useCallback(async (clip: AudioClip) => {
        const looper = getLooper();
        if (!looper) {
            console.warn('Looper not available for clip drop');
            return;
        }

        try {
            // First check if buffer is in cache (for looper-originated clips)
            const cachedBuffer = getClipBuffer(clip.sampleId);
            if (cachedBuffer) {
                // Use cached buffer directly
                looper.addLoopFromBuffer(cachedBuffer);
                return;
            }

            // Otherwise load from sample library
            const audioContext = getAudioContext();
            if (!audioContext) {
                console.warn('AudioContext not available');
                return;
            }

            const buffer = await loadClipAudio(clip, audioContext);

            // Add as a new loop
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
            {/* Header - only "Looper" text */}
            <div className="schematic-header" onMouseDown={handleHeaderMouseDown}>
                <span>Looper</span>
            </div>

            {/* Main row: Audio In - Duration - Audio Out */}
            <div className="looper-main-row">
                <div
                    className={`looper-input-port ${hasConnection(inputPortId) ? 'connected' : ''}`}
                    onMouseDown={(e) => handlePortMouseDown?.(inputPortId, e)}
                    onMouseUp={(e) => handlePortMouseUp?.(inputPortId, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(inputPortId)}
                    onMouseLeave={handlePortMouseLeave}
                    data-node-id={node.id}
                    data-port-id={inputPortId}
                />
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
                <div
                    className={`looper-output-port ${hasConnection(outputPortId) ? 'connected' : ''}`}
                    onMouseDown={(e) => handlePortMouseDown?.(outputPortId, e)}
                    onMouseUp={(e) => handlePortMouseUp?.(outputPortId, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(outputPortId)}
                    onMouseLeave={handlePortMouseLeave}
                    data-node-id={node.id}
                    data-port-id={outputPortId}
                />
            </div>

            {/* Active recording waveform with playhead */}
            {isRecording && (
                <div className="looper-active-waveform">
                    <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                        {isInfinite ? (
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
                                {/* Waveform line building up */}
                                {waveformHistory.length > 1 && (
                                    <polyline
                                        className="looper-waveform-path recording"
                                        fill="none"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        points={waveformHistory.map((v, i) =>
                                            `${(i / (waveformHistory.length - 1)) * playheadPosition},${10 - v * 8}`
                                        ).join(' ')}
                                    />
                                )}
                                {/* Playhead vertical line */}
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

            {/* Completed loops as line waveforms */}
            {loops.length > 0 && (
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
                                    onClick={(e) => { e.stopPropagation(); handleExportLoop(loop.id, loops.indexOf(loop)); }}
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
                        </div>
                    ))}
                </ScrollContainer>
            )}

            {/* Record button - centered red circle with white center */}
            <div className="looper-record-container">
                <button
                    className={`looper-record-btn ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? handleStopRecord : handleRecord}
                    disabled={!isAudioContextReady}
                />
            </div>

        </div>
    );
});
