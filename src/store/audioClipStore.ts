/**
 * Audio Clip Store - Manages draggable audio clips on the canvas
 *
 * Audio clips are lightweight visual elements that reference audio in the sample library.
 * They support drag-and-drop between nodes and non-destructive cropping.
 */

import { create } from 'zustand';
import type { AudioClip, ClipDropTarget, Position } from '../engine/types';
import { useLibraryStore } from './libraryStore';

// ============================================================================
// Buffer Cache for Looper-originated clips (LRU implementation)
// ============================================================================
// Clips from loopers don't have samples in the library, so we cache their buffers here
// Using LRU (Least Recently Used) eviction to prevent unbounded memory growth

/** Maximum number of buffers to keep in cache */
const MAX_CLIP_BUFFER_CACHE_SIZE = 50;

/** Map storing buffer data - order represents LRU (most recent at end) */
const clipBufferCache = new Map<string, AudioBuffer>();

/** Track access order for LRU eviction */
const cacheAccessOrder: string[] = [];

/**
 * Move a key to the end of the access order (marking it as most recently used)
 */
function markAsRecentlyUsed(sampleId: string): void {
    const index = cacheAccessOrder.indexOf(sampleId);
    if (index !== -1) {
        cacheAccessOrder.splice(index, 1);
    }
    cacheAccessOrder.push(sampleId);
}

/**
 * Evict least recently used entries until cache is under the limit
 */
function evictIfNeeded(): void {
    while (cacheAccessOrder.length > MAX_CLIP_BUFFER_CACHE_SIZE) {
        const lruKey = cacheAccessOrder.shift();
        if (lruKey) {
            clipBufferCache.delete(lruKey);
        }
    }
}

export function setClipBuffer(sampleId: string, buffer: AudioBuffer): void {
    clipBufferCache.set(sampleId, buffer);
    markAsRecentlyUsed(sampleId);
    evictIfNeeded();
}

export function getClipBuffer(sampleId: string): AudioBuffer | undefined {
    const buffer = clipBufferCache.get(sampleId);
    if (buffer) {
        markAsRecentlyUsed(sampleId);
    }
    return buffer;
}

export function removeClipBuffer(sampleId: string): void {
    clipBufferCache.delete(sampleId);
    const index = cacheAccessOrder.indexOf(sampleId);
    if (index !== -1) {
        cacheAccessOrder.splice(index, 1);
    }
}

/**
 * Clear all cached clip buffers - called when closing project to prevent memory leaks
 */
export function clearClipBufferCache(): void {
    clipBufferCache.clear();
    cacheAccessOrder.length = 0;
}

// ============================================================================
// Drag State Types
// ============================================================================

interface DragState {
    isDragging: boolean;
    draggedClipId: string | null;
    dragOffset: Position;           // Offset from clip origin to mouse at drag start
    currentPosition: Position;      // Current mouse position (screen coords)
    hoveredTargetId: string | null; // Which drop target is being hovered
}

// ============================================================================
// Store Interface
// ============================================================================

interface AudioClipStore {
    // State
    clips: Map<string, AudioClip>;
    selectedClipIds: Set<string>;
    dragState: DragState;
    registeredDropTargets: Map<string, ClipDropTarget>;

    // Waveform editor modal state
    editingClipId: string | null;

    // Clip CRUD
    addClip: (clip: Omit<AudioClip, 'id' | 'createdAt' | 'lastModifiedAt'>) => string;
    updateClip: (clipId: string, updates: Partial<AudioClip>) => void;
    removeClip: (clipId: string, options?: { skipTrash?: boolean }) => void;
    getClipById: (clipId: string) => AudioClip | undefined;
    getClipsOnCanvas: () => AudioClip[];

    // Positioning
    setClipPosition: (clipId: string, position: Position | null) => void;

    // Selection
    selectClip: (clipId: string, addToSelection?: boolean) => void;
    deselectClip: (clipId: string) => void;
    clearClipSelection: () => void;
    isClipSelected: (clipId: string) => boolean;

    // Drag operations
    startDrag: (clipId: string, mousePosition: Position, clipBounds: DOMRect) => void;
    updateDrag: (mousePosition: Position) => void;
    endDrag: () => Promise<void>;
    cancelDrag: () => void;

    // Drop targets
    registerDropTarget: (target: ClipDropTarget) => void;
    unregisterDropTarget: (nodeId: string) => void;
    getDropTargetAt: (position: Position) => ClipDropTarget | null;

    // Crop operations
    updateCropRegion: (clipId: string, startFrame: number, endFrame: number) => void;

    // Waveform editor modal
    openEditor: (clipId: string) => void;
    closeEditor: () => void;

    // Bulk operations
    clearAllClips: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialDragState: DragState = {
    isDragging: false,
    draggedClipId: null,
    dragOffset: { x: 0, y: 0 },
    currentPosition: { x: 0, y: 0 },
    hoveredTargetId: null,
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useAudioClipStore = create<AudioClipStore>((set, get) => ({
    // Initial State
    clips: new Map(),
    selectedClipIds: new Set(),
    dragState: { ...initialDragState },
    registeredDropTargets: new Map(),
    editingClipId: null,

    // ========================================================================
    // Clip CRUD
    // ========================================================================

    addClip: (clipData) => {
        const id = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();

        const clip: AudioClip = {
            ...clipData,
            id,
            createdAt: now,
            lastModifiedAt: now,
        };

        set((state) => {
            const newClips = new Map(state.clips);
            newClips.set(id, clip);
            return { clips: newClips };
        });

        return id;
    },

    updateClip: (clipId, updates) => {
        set((state) => {
            const clip = state.clips.get(clipId);
            if (!clip) return state;

            const newClips = new Map(state.clips);
            newClips.set(clipId, {
                ...clip,
                ...updates,
                lastModifiedAt: Date.now(),
            });
            return { clips: newClips };
        });
    },

    removeClip: (clipId, options) => {
        // Get clip before removing to clean up buffer cache
        const clip = get().clips.get(clipId);
        if (clip) {
            removeClipBuffer(clip.sampleId);

            // Trash the corresponding library item (add "trash" tag)
            // Only trash if:
            // 1. skipTrash is not set (clip is being deleted, not consumed by a node)
            // 2. It's a real library item (not a temporary looper buffer)
            if (!options?.skipTrash) {
                const libraryState = useLibraryStore.getState();
                if (libraryState.items[clip.sampleId]) {
                    libraryState.trashItem(clip.sampleId);
                }
            }
        }

        set((state) => {
            const newClips = new Map(state.clips);
            newClips.delete(clipId);

            const newSelectedIds = new Set(state.selectedClipIds);
            newSelectedIds.delete(clipId);

            return {
                clips: newClips,
                selectedClipIds: newSelectedIds,
                editingClipId: state.editingClipId === clipId ? null : state.editingClipId,
            };
        });
    },

    getClipById: (clipId) => {
        return get().clips.get(clipId);
    },

    getClipsOnCanvas: () => {
        const clips = get().clips;
        return Array.from(clips.values()).filter((clip) => clip.position !== null);
    },

    // ========================================================================
    // Positioning
    // ========================================================================

    setClipPosition: (clipId, position) => {
        set((state) => {
            const clip = state.clips.get(clipId);
            if (!clip) return state;

            const newClips = new Map(state.clips);
            newClips.set(clipId, {
                ...clip,
                position,
                lastModifiedAt: Date.now(),
            });
            return { clips: newClips };
        });
    },

    // ========================================================================
    // Selection
    // ========================================================================

    selectClip: (clipId, addToSelection = false) => {
        set((state) => {
            if (addToSelection) {
                const newSelected = new Set(state.selectedClipIds);
                newSelected.add(clipId);
                return { selectedClipIds: newSelected };
            } else {
                return { selectedClipIds: new Set([clipId]) };
            }
        });
    },

    deselectClip: (clipId) => {
        set((state) => {
            const newSelected = new Set(state.selectedClipIds);
            newSelected.delete(clipId);
            return { selectedClipIds: newSelected };
        });
    },

    clearClipSelection: () => {
        set({ selectedClipIds: new Set() });
    },

    isClipSelected: (clipId) => {
        return get().selectedClipIds.has(clipId);
    },

    // ========================================================================
    // Drag Operations
    // ========================================================================

    startDrag: (clipId, mousePosition, clipBounds) => {
        const clip = get().clips.get(clipId);
        if (!clip) return;

        // Calculate offset from clip origin to mouse position
        const dragOffset = {
            x: mousePosition.x - clipBounds.left,
            y: mousePosition.y - clipBounds.top,
        };

        set({
            dragState: {
                isDragging: true,
                draggedClipId: clipId,
                dragOffset,
                currentPosition: mousePosition,
                hoveredTargetId: null,
            },
        });
    },

    updateDrag: (mousePosition) => {
        const { dragState, registeredDropTargets } = get();
        if (!dragState.isDragging) return;

        // Check which drop target is under the cursor
        let hoveredTargetId: string | null = null;

        for (const [nodeId, target] of registeredDropTargets) {
            const bounds = target.getDropZoneBounds();
            if (bounds) {
                if (
                    mousePosition.x >= bounds.left &&
                    mousePosition.x <= bounds.right &&
                    mousePosition.y >= bounds.top &&
                    mousePosition.y <= bounds.bottom
                ) {
                    // Also check if target can accept the clip
                    const clip = get().clips.get(dragState.draggedClipId!);
                    if (clip && target.canAcceptClip(clip)) {
                        hoveredTargetId = nodeId;
                        break;
                    }
                }
            }
        }

        set({
            dragState: {
                ...dragState,
                currentPosition: mousePosition,
                hoveredTargetId,
            },
        });
    },

    endDrag: async () => {
        const { dragState, clips, registeredDropTargets } = get();

        if (!dragState.isDragging || !dragState.draggedClipId) {
            set({ dragState: { ...initialDragState } });
            return;
        }

        const clip = clips.get(dragState.draggedClipId);
        if (!clip) {
            set({ dragState: { ...initialDragState } });
            return;
        }

        // Check if dropping on a target
        if (dragState.hoveredTargetId) {
            const target = registeredDropTargets.get(dragState.hoveredTargetId);
            if (target && target.canAcceptClip(clip)) {
                try {
                    await target.onClipDrop(clip);
                    // Remove clip from canvas after successful drop into node
                    // Use skipTrash because the clip is being consumed by the node, not deleted
                    get().removeClip(clip.id, { skipTrash: true });
                } catch (error) {
                    console.error('Failed to drop clip:', error);
                }
            }
        } else {
            // Dropping on canvas - update position
            // Position is set by the drag layer, this is handled in NodeCanvas
        }

        set({ dragState: { ...initialDragState } });
    },

    cancelDrag: () => {
        set({ dragState: { ...initialDragState } });
    },

    // ========================================================================
    // Drop Targets
    // ========================================================================

    registerDropTarget: (target) => {
        set((state) => {
            const newTargets = new Map(state.registeredDropTargets);
            newTargets.set(target.nodeId, target);
            return { registeredDropTargets: newTargets };
        });
    },

    unregisterDropTarget: (nodeId) => {
        set((state) => {
            const newTargets = new Map(state.registeredDropTargets);
            newTargets.delete(nodeId);
            return { registeredDropTargets: newTargets };
        });
    },

    getDropTargetAt: (position) => {
        const { registeredDropTargets, dragState, clips } = get();
        const clip = dragState.draggedClipId ? clips.get(dragState.draggedClipId) : null;

        for (const target of registeredDropTargets.values()) {
            const bounds = target.getDropZoneBounds();
            if (bounds) {
                if (
                    position.x >= bounds.left &&
                    position.x <= bounds.right &&
                    position.y >= bounds.top &&
                    position.y <= bounds.bottom
                ) {
                    if (!clip || target.canAcceptClip(clip)) {
                        return target;
                    }
                }
            }
        }
        return null;
    },

    // ========================================================================
    // Crop Operations
    // ========================================================================

    updateCropRegion: (clipId, startFrame, endFrame) => {
        set((state) => {
            const clip = state.clips.get(clipId);
            if (!clip) return state;

            // Calculate new duration from crop region
            const totalFrames = endFrame === -1
                ? (clip.durationSeconds * clip.sampleRate) - startFrame
                : endFrame - startFrame;
            const newDuration = totalFrames / clip.sampleRate;

            const newClips = new Map(state.clips);
            newClips.set(clipId, {
                ...clip,
                startFrame,
                endFrame,
                durationSeconds: newDuration,
                lastModifiedAt: Date.now(),
            });
            return { clips: newClips };
        });
    },

    // ========================================================================
    // Waveform Editor Modal
    // ========================================================================

    openEditor: (clipId) => {
        set({ editingClipId: clipId });
    },

    closeEditor: () => {
        set({ editingClipId: null });
    },

    // ========================================================================
    // Bulk Operations
    // ========================================================================

    clearAllClips: () => {
        // Clean up buffer cache and trash library items for all clips
        const clips = get().clips;
        const libraryState = useLibraryStore.getState();

        for (const clip of clips.values()) {
            removeClipBuffer(clip.sampleId);
            // Trash library items that exist
            if (libraryState.items[clip.sampleId]) {
                libraryState.trashItem(clip.sampleId);
            }
        }

        set({
            clips: new Map(),
            selectedClipIds: new Set(),
            editingClipId: null,
            dragState: { ...initialDragState },
        });
    },
}));
