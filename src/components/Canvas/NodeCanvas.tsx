/**
 * Node Canvas - Main canvas with pan/zoom, box selection, and node rendering
 */

import { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react';
import type { Position, NodeType, Connection } from '../../engine/types';
import { useGraphStore, getNodeDimensions, type NodeBounds } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useAudioStore } from '../../store/audioStore';
import { useKeybindingsStore } from '../../store/keybindingsStore';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { useTransportStore } from '../../store/transportStore';
import { getNodeDefinition } from '../../engine/registry';
import { getPortPosition as calculatePortPosition } from '../../utils/portPositions';
import { getConnectionBundleCount } from '../../utils/portSync';
import { getExecutor } from '../../audio/executor';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { ContextMenu } from './ContextMenu';
import { NodeWrapper } from '../Nodes/NodeWrapper';
import { useMIDIStore } from '../../store/midiStore';
import { useAudioClipStore } from '../../store/audioClipStore';
import { useLibraryStore, getSampleFile } from '../../store/libraryStore';
import { createClipFromSample, generateWaveformPeaksAsync } from '../../utils/clipUtils';
import { getAudioContext } from '../../audio/audioContext';
import { AudioClipVisual } from '../Clips/AudioClipVisual';
import { ClipDragLayer } from '../Clips/ClipDragLayer';
import { WaveformEditorModal } from '../Clips/WaveformEditorModal';
import { PresenceOverlay } from '../Collab/PresenceOverlay';
import { useCollabStore } from '../../store/collabStore';
import { logError } from '../../utils/log';
import './NodeCanvas.css';

interface SelectionBox {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

/** Props for the memoized ConnectionPath component */
interface ConnectionPathProps {
    conn: Connection;
    path: string;
    isSelected: boolean;
    isBundled: boolean;
    bundleCount: number;
    signalLevel: number;
    onSelect: (connId: string) => void;
}

/**
 * Memoized connection path component - only re-renders when connection changes
 * or signal level changes by more than 1%
 */
const ConnectionPath = memo(function ConnectionPath({
    conn,
    path,
    isSelected,
    isBundled,
    bundleCount,
    signalLevel,
    onSelect
}: ConnectionPathProps) {
    const signalStyle = {
        '--signal-level': signalLevel.toFixed(3)
    } as React.CSSProperties;

    return (
        <g>
            <path
                d={path}
                data-connection-id={conn.id}
                className={`connection-line ${conn.type} ${isSelected ? 'selected' : ''} ${isBundled ? 'bundled' : ''}`}
                style={signalStyle}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelect(conn.id);
                }}
            />
            {isBundled && (
                <title>{`Bundle (${bundleCount} connections)`}</title>
            )}
        </g>
    );
}, (prev, next) => {
    // Custom comparison: skip re-render if signal level changed by less than 1%
    return prev.conn.id === next.conn.id &&
           prev.path === next.path &&
           prev.isSelected === next.isSelected &&
           prev.isBundled === next.isBundled &&
           prev.bundleCount === next.bundleCount &&
           Math.abs(prev.signalLevel - next.signalLevel) < 0.01;
});

export function NodeCanvas() {
    const canvasRef = useRef<HTMLDivElement>(null);
    const [contextMenu, setContextMenu] = useState<Position | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

    // MIDI browser - open via store, MIDIIntegration handles rendering
    const openMIDIBrowser = useMIDIStore((s) => s.openBrowser);

    // Right-click drag state (for pan vs context menu)
    const [rightClickStart, setRightClickStart] = useState<Position | null>(null);
    const rightClickMoved = useRef(false);
    const rightClickOnCanvas = useRef(false);

    // Track if Ctrl was held when starting selection box (for port selection mode)
    const selectionBoxCtrlHeld = useRef(false);

    // Signal levels for audio visualization (connection key -> 0-1 level)
    // Use ref for raw data (updated at 60fps) and throttle state updates to reduce re-renders
    const [signalLevels, setSignalLevels] = useState<Map<string, number>>(new Map());
    const signalLevelsRef = useRef<Map<string, number>>(new Map());
    const signalUpdateScheduled = useRef(false);

    // Subscribe to signal level updates from the audio executor
    // Throttle state updates to ~30fps to reduce re-renders while keeping smooth animation
    useEffect(() => {
        const unsubscribe = getExecutor().subscribeSignalLevels((levels) => {
            signalLevelsRef.current = levels;

            // Throttle state updates using requestAnimationFrame
            if (!signalUpdateScheduled.current) {
                signalUpdateScheduled.current = true;
                requestAnimationFrame(() => {
                    setSignalLevels(new Map(signalLevelsRef.current));
                    signalUpdateScheduled.current = false;
                });
            }
        });
        return unsubscribe;
    }, []);

    // Canvas navigation store (simplified - just track which node we're viewing)
    const currentViewNodeId = useCanvasNavigationStore((s) => s.currentViewNodeId);
    const enterNode = useCanvasNavigationStore((s) => s.enterNode);
    const exitToParent = useCanvasNavigationStore((s) => s.exitToParent);

    // Graph store - use flat structure helpers to get nodes/connections at current view level
    const getNodesAtLevel = useGraphStore((s) => s.getNodesAtLevel);
    const getConnectionsAtLevel = useGraphStore((s) => s.getConnectionsAtLevel);
    const allNodes = useGraphStore((s) => s.nodes);
    const allConnections = useGraphStore((s) => s.connections);

    // Determine which nodes/connections to render based on current view
    const nodes = useMemo(() => {
        const nodeArray = getNodesAtLevel(currentViewNodeId);
        return new Map(nodeArray.map(n => [n.id, n]));
    }, [currentViewNodeId, getNodesAtLevel, allNodes]);

    const connections = useMemo(() => {
        const connArray = getConnectionsAtLevel(currentViewNodeId);
        return new Map(connArray.map(c => [c.id, c]));
    }, [currentViewNodeId, getConnectionsAtLevel, allConnections]);
    const addNode = useGraphStore((s) => s.addNode);
    const selectedConnectionIds = useGraphStore((s) => s.selectedConnectionIds);
    const selectConnection = useGraphStore((s) => s.selectConnection);
    const clearSelection = useGraphStore((s) => s.clearSelection);
    const deleteSelected = useGraphStore((s) => s.deleteSelected);
    const selectNodesInRect = useGraphStore((s) => s.selectNodesInRect);
    const undo = useGraphStore((s) => s.undo);
    const redo = useGraphStore((s) => s.redo);
    const copySelected = useGraphStore((s) => s.copySelected);
    const pasteClipboard = useGraphStore((s) => s.pasteClipboard);

    // Canvas store
    const pan = useCanvasStore((s) => s.pan);
    const zoom = useCanvasStore((s) => s.zoom);
    const isPanning = useCanvasStore((s) => s.isPanning);
    const setPanning = useCanvasStore((s) => s.setPanning);
    const panBy = useCanvasStore((s) => s.panBy);
    const zoomTo = useCanvasStore((s) => s.zoomTo);
    const screenToCanvas = useCanvasStore((s) => s.screenToCanvas);
    const isConnecting = useCanvasStore((s) => s.isConnecting);
    const connectingFrom = useCanvasStore((s) => s.connectingFrom);
    const startConnecting = useCanvasStore((s) => s.startConnecting);
    const stopConnecting = useCanvasStore((s) => s.stopConnecting);
    const ghostMode = useCanvasStore((s) => s.ghostMode);
    const toggleGhostMode = useCanvasStore((s) => s.toggleGhostMode);
    const fitToNodes = useCanvasStore((s) => s.fitToNodes);

    // Audio clip store
    const allClips = useAudioClipStore((s) => s.clips);
    const selectedClipIds = useAudioClipStore((s) => s.selectedClipIds);
    const clipDragState = useAudioClipStore((s) => s.dragState);
    const startClipDrag = useAudioClipStore((s) => s.startDrag);
    const updateClipDrag = useAudioClipStore((s) => s.updateDrag);
    const endClipDrag = useAudioClipStore((s) => s.endDrag);
    const selectClip = useAudioClipStore((s) => s.selectClip);
    const setClipPosition = useAudioClipStore((s) => s.setClipPosition);
    const openClipEditor = useAudioClipStore((s) => s.openEditor);
    const removeClip = useAudioClipStore((s) => s.removeClip);
    const addClip = useAudioClipStore((s) => s.addClip);

    // Library store for item lookup
    const libraryItems = useLibraryStore((s) => s.items);

    // Derive clips on canvas (memoized to avoid infinite loops)
    const clipsOnCanvas = useMemo(() => {
        return Array.from(allClips.values()).filter((clip) => clip.position !== null);
    }, [allClips]);

    // Audio store for mode switching
    const setCurrentMode = useAudioStore((s) => s.setCurrentMode);

    // Collaboration presence (U23): publish local cursor / selection / view level
    // to peers. These are no-ops when no session is active.
    const collabActive = useCollabStore((s) => s.status === 'connected');
    const publishCursor = useCollabStore((s) => s.setCursor);
    const publishSelection = useCollabStore((s) => s.setSelection);
    const publishViewNode = useCollabStore((s) => s.setViewNode);

    // Mouse position: ref for zoom (always updated), state for temp connection (only when connecting)
    const mousePosRef = useRef<Position>({ x: 0, y: 0 });
    const [mousePos, setMousePos] = useState<Position>({ x: 0, y: 0 });
    const lastPanPos = useRef<Position>({ x: 0, y: 0 });

    // Get port position in canvas coordinates for a given node and port
    // Used for box selection of ports
    const getPortCanvasPositionForSelection = useCallback((node: { id: string; position: Position; ports: { id: string; position?: { x: number; y: number } }[] }, portId: string): Position | null => {
        // First try DOM query for actual port position (more accurate)
        const portElement = document.querySelector(
            `[data-node-id="${node.id}"][data-port-id="${portId}"]`
        ) as HTMLElement | null;

        if (portElement && canvasRef.current) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            const portRect = portElement.getBoundingClientRect();

            const screenX = portRect.left + portRect.width / 2;
            const screenY = portRect.top + portRect.height / 2;

            const canvasX = (screenX - canvasRect.left - pan.x) / zoom;
            const canvasY = (screenY - canvasRect.top - pan.y) / zoom;

            return { x: canvasX, y: canvasY };
        }

        // Fallback: calculate from node position + port.position
        const port = node.ports.find(p => p.id === portId);
        if (port?.position) {
            const nodeWidth = 180;
            const nodeHeight = 120;
            return {
                x: node.position.x + port.position.x * nodeWidth,
                y: node.position.y + port.position.y * nodeHeight
            };
        }
        return null;
    }, [pan, zoom]);

    // Handle right-click context menu - just prevent default
    // Menu is shown on mouseup if no drag occurred
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
    }, []);

    // Handle adding a node (works at all levels - just pass parentId)
    const handleAddNode = useCallback((type: NodeType, screenPos: Position) => {
        const canvasPos = screenToCanvas(screenPos);
        // With flat structure, addNode accepts parentId directly
        // null = root level, nodeId = inside that node
        addNode(type, canvasPos, currentViewNodeId);
    }, [screenToCanvas, addNode, currentViewNodeId]);

    // Handle opening MIDI browser (when 'Midi' is selected from context menu)
    // MIDIIntegration handles the browser rendering and device selection
    const handleOpenMIDIBrowser = useCallback(() => {
        openMIDIBrowser();
    }, [openMIDIBrowser]);

    // Handle mouse down (start panning or box selection)
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Right mouse button - start potential pan or context menu
        if (e.button === 2) {
            e.preventDefault();
            setRightClickStart({ x: e.clientX, y: e.clientY });
            rightClickMoved.current = false;
            // Check if clicking on empty canvas (not on a node)
            const isOnNode = (e.target as HTMLElement).closest('.node, .schematic-node');
            rightClickOnCanvas.current = !isOnNode;
            return;
        }

        // Middle mouse button or Alt + left click for panning
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            e.preventDefault();
            setPanning(true);
            lastPanPos.current = { x: e.clientX, y: e.clientY };
            return;
        }

        // Left click on empty canvas - start box selection
        // Check for all node and port classes (standard and schematic)
        const isNodeOrPort = (e.target as HTMLElement).closest(
            '.node, .schematic-node, .port, .port-dot, .port-circle-marker, .note-input-port, .output-port, .speaker-input-port'
        );
        if (e.button === 0 && !isNodeOrPort) {
            clearSelection();
            stopConnecting();

            // Track if Ctrl is held (for port selection mode)
            selectionBoxCtrlHeld.current = e.ctrlKey;

            // Start box selection
            const canvasPos = screenToCanvas({ x: e.clientX, y: e.clientY });
            setSelectionBox({
                startX: canvasPos.x,
                startY: canvasPos.y,
                currentX: canvasPos.x,
                currentY: canvasPos.y
            });
        }
    }, [setPanning, clearSelection, stopConnecting, screenToCanvas]);

    // Throttle presence cursor broadcasts to one per animation frame.
    const cursorPublishScheduled = useRef(false);

    // Handle mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        // Always update ref for zoom operations
        mousePosRef.current = { x: e.clientX, y: e.clientY };

        // Broadcast cursor position (in canvas coords) to collaborators, throttled.
        if (collabActive && !cursorPublishScheduled.current) {
            cursorPublishScheduled.current = true;
            const screen = { x: e.clientX, y: e.clientY };
            requestAnimationFrame(() => {
                cursorPublishScheduled.current = false;
                publishCursor(screenToCanvas(screen));
            });
        }

        // Only update state when connecting (for temp connection line)
        if (isConnecting) {
            setMousePos({ x: e.clientX, y: e.clientY });
        }

        // Update clip drag position if dragging a clip
        if (clipDragState.isDragging) {
            updateClipDrag({ x: e.clientX, y: e.clientY });
        }

        // Right-click drag panning
        if (rightClickStart) {
            const dx = e.clientX - rightClickStart.x;
            const dy = e.clientY - rightClickStart.y;

            // If moved more than threshold, it's a drag (pan the canvas)
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                rightClickMoved.current = true;
                panBy({ x: dx, y: dy });
                setRightClickStart({ x: e.clientX, y: e.clientY });
            }
        }

        if (isPanning) {
            const dx = e.clientX - lastPanPos.current.x;
            const dy = e.clientY - lastPanPos.current.y;
            panBy({ x: dx, y: dy });
            lastPanPos.current = { x: e.clientX, y: e.clientY };
        }

        // Update box selection and select nodes in real-time
        if (selectionBox) {
            const canvasPos = screenToCanvas({ x: e.clientX, y: e.clientY });
            const newBox = {
                ...selectionBox,
                currentX: canvasPos.x,
                currentY: canvasPos.y
            };
            setSelectionBox(newBox);

            // Live selection - select nodes as the box changes
            const width = newBox.currentX - newBox.startX;
            const height = newBox.currentY - newBox.startY;
            if (Math.abs(width) > 5 || Math.abs(height) > 5) {
                selectNodesInRect({
                    x: Math.min(newBox.startX, newBox.currentX),
                    y: Math.min(newBox.startY, newBox.currentY),
                    width: Math.abs(width),
                    height: Math.abs(height)
                });
            }
        }
    }, [isPanning, panBy, selectionBox, screenToCanvas, rightClickStart, selectNodesInRect, clipDragState.isDragging, updateClipDrag, isConnecting, collabActive, publishCursor]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        setPanning(false);

        // Right-click release - show context menu if no drag
        if (rightClickStart) {
            if (!rightClickMoved.current && rightClickOnCanvas.current) {
                // Didn't drag and was on empty canvas - show context menu
                setContextMenu({ x: rightClickStart.x, y: rightClickStart.y });
            }
            setRightClickStart(null);
            rightClickMoved.current = false;
            rightClickOnCanvas.current = false;
        }

        // Complete box selection - check for ports first (if Ctrl held), then nodes
        if (selectionBox) {
            const width = selectionBox.currentX - selectionBox.startX;
            const height = selectionBox.currentY - selectionBox.startY;

            // Only select if dragged more than 5 pixels
            if (Math.abs(width) > 5 || Math.abs(height) > 5) {
                const rect = {
                    minX: Math.min(selectionBox.startX, selectionBox.currentX),
                    maxX: Math.max(selectionBox.startX, selectionBox.currentX),
                    minY: Math.min(selectionBox.startY, selectionBox.currentY),
                    maxY: Math.max(selectionBox.startY, selectionBox.currentY)
                };

                // Only check for ports if Ctrl was held when starting the selection
                if (selectionBoxCtrlHeld.current) {
                    const selectedPorts: { nodeId: string; portId: string }[] = [];

                    nodes.forEach(node => {
                        node.ports.forEach(port => {
                            const pos = getPortCanvasPositionForSelection(node, port.id);
                            if (pos && pos.x >= rect.minX && pos.x <= rect.maxX &&
                                pos.y >= rect.minY && pos.y <= rect.maxY) {
                                selectedPorts.push({ nodeId: node.id, portId: port.id });
                            }
                        });
                    });

                    if (selectedPorts.length > 0) {
                        // Ports found - start connecting with them (they follow cursor)
                        startConnecting(selectedPorts);
                        setSelectionBox(null);
                        selectionBoxCtrlHeld.current = false;
                        return;
                    }
                }

                // Normal node selection (no Ctrl or no ports found)
                selectNodesInRect({
                    x: rect.minX,
                    y: rect.minY,
                    width: Math.abs(width),
                    height: Math.abs(height)
                });
            }

            setSelectionBox(null);
            selectionBoxCtrlHeld.current = false;
        }

        // End clip drag if one is in progress
        if (clipDragState.isDragging) {
            // If not dropping on a target, update clip position on canvas
            if (!clipDragState.hoveredTargetId && clipDragState.draggedClipId) {
                const canvasPos = screenToCanvas({
                    x: clipDragState.currentPosition.x - clipDragState.dragOffset.x,
                    y: clipDragState.currentPosition.y - clipDragState.dragOffset.y
                });
                setClipPosition(clipDragState.draggedClipId, canvasPos);
            }
            endClipDrag();
        }

        // Cancel connection if mouseup happens on empty canvas (not on a valid port)
        // This runs after port mouseup handlers, so if isConnecting is still true,
        // it means the connection wasn't completed on a port
        // Note: We use requestAnimationFrame instead of setTimeout(0) for more reliable
        // timing with React's synthetic events
        if (isConnecting) {
            requestAnimationFrame(() => {
                if (useCanvasStore.getState().isConnecting) {
                    stopConnecting();
                }
            });
        }
    }, [setPanning, selectionBox, selectNodesInRect, rightClickStart, isConnecting, stopConnecting, nodes, startConnecting, getPortCanvasPositionForSelection, clipDragState, endClipDrag, setClipPosition, screenToCanvas]);

    // Handle drag over for library items
    const handleDragOver = useCallback((e: React.DragEvent) => {
        // Allow drop if it's a library item
        if (e.dataTransfer.types.includes('application/library-item')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    }, []);

    // Handle drop of library items onto canvas
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        const itemDataStr = e.dataTransfer.getData('application/library-item');
        if (!itemDataStr) return;

        e.preventDefault();

        try {
            const itemData = JSON.parse(itemDataStr) as {
                id: string;
                fileName: string;
                duration: number;
                sampleRate: number;
                sourceNodeId: string;
            };

            // Get the full item from the library store
            const item = libraryItems[itemData.id];
            if (!item) {
                logError('canvas', 'Library item not found:', { itemId: itemData.id });
                return;
            }

            // Load the audio file and create clip
            const file = await getSampleFile(item.id);
            if (!file) {
                logError('canvas', 'Could not load file for item:', { itemId: item.id });
                return;
            }

            const ctx = getAudioContext();
            if (!ctx) {
                logError('canvas', 'No audio context available');
                return;
            }

            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            // Use async worker for non-blocking waveform generation
            const waveformPeaksF32 = await generateWaveformPeaksAsync(audioBuffer, 64);
            const waveformPeaks = Array.from(waveformPeaksF32);
            const clipData = createClipFromSample(item, waveformPeaks, itemData.sourceNodeId);

            // Calculate canvas position from drop coordinates
            const canvasPos = screenToCanvas({ x: e.clientX - 60, y: e.clientY - 20 });

            // Add clip with position
            const { id: _id, createdAt: _ca, lastModifiedAt: _lm, ...clipWithoutMeta } = clipData;
            const clipId = addClip({
                ...clipWithoutMeta,
                position: canvasPos,
            });

            // Select the new clip
            selectClip(clipId);
        } catch (err) {
            logError('canvas', 'Failed to create clip from dropped item:', { error: String(err) });
        }
    }, [libraryItems, screenToCanvas, addClip, selectClip]);

    // Handle wheel for zoom and two-finger trackpad pan
    // Uses standardized scroll capture to prevent propagation and handle touchpad/mouse correctly
    const handleCanvasScroll = useCallback((data: ScrollData) => {
        // Pinch-to-zoom gesture (ctrlKey/metaKey set by browser for pinch gestures)
        if (data.isPinch) {
            const delta = data.scrollingDown ? 0.9 : 1.1;
            const newZoom = zoom * delta;
            // Use tracked mouse position ref for zoom-toward-cursor (avoids re-render dependency)
            zoomTo(newZoom, mousePosRef.current);
            return;
        }

        // Two-finger trackpad pan - pans in all directions (horizontal, vertical, diagonal)
        // This allows natural panning with two fingers on laptop trackpads
        panBy({ x: -data.deltaX, y: -data.deltaY });
    }, [zoom, zoomTo, panBy]);

    // Attach scroll capture to canvas
    const { ref: scrollCaptureRef } = useScrollCapture<HTMLDivElement>({
        onScroll: handleCanvasScroll,
        capture: true, // Block all scrolling, handle custom zoom/pan
    });

    // Keyboard row key mappings
    const ROW_KEYS: Record<number, string[]> = {
        1: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
        2: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        3: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/']
    };

    // Track active keyboard keys with their source keyboard ID
    // This prevents stuck notes when mode changes between keydown and keyup
    const activeKeyboardKeys = useRef<Map<string, { keyboardId: string; row: number; keyIndex: number }>>(new Map());

    // Handle keyboard shortcuts using keybindings store
    useEffect(() => {
        const { matchesAction } = useKeybindingsStore.getState();
        const { emitKeyboardSignal, releaseKeyboardSignal } = useAudioStore.getState();

        function handleKeyDown(e: KeyboardEvent) {
            // Skip if typing in input
            if ((e.target as HTMLElement).tagName === 'INPUT') return;

            // ESC Key - Unified escape behavior (works in all modes)
            if (e.key === 'Escape') {
                e.preventDefault();

                // Priority 1: Close MIDI browser
                if (useMIDIStore.getState().isBrowserOpen) {
                    useMIDIStore.getState().closeBrowser();
                    return;
                }

                // Priority 2: Close waveform editor
                if (useAudioClipStore.getState().editingClipId) {
                    useAudioClipStore.getState().closeEditor();
                    return;
                }

                // Priority 3: Close context menu
                if (contextMenu) {
                    setContextMenu(null);
                    return;
                }

                // Priority 4: Cancel box selection
                if (selectionBox) {
                    setSelectionBox(null);
                    return;
                }

                // Priority 5: Cancel connection in progress
                if (useCanvasStore.getState().isConnecting) {
                    stopConnecting();
                    return;
                }

                // Priority 6: Clear clip selection
                const clipStore = useAudioClipStore.getState();
                if (clipStore.selectedClipIds.size > 0) {
                    clipStore.clearClipSelection();
                    return;
                }

                // Priority 7: Clear node/connection selection
                const graphState = useGraphStore.getState();
                if (graphState.selectedNodeIds.size > 0 || graphState.selectedConnectionIds.size > 0) {
                    clearSelection();
                    return;
                }

                // Priority 8: Exit current node level (like Q key)
                if (currentViewNodeId !== null) {
                    exitToParent();
                    return;
                }

                // At root with nothing to escape - silently do nothing
                return;
            }

            // Get current mode from audio store
            const currentMode = useAudioStore.getState().currentMode;

            // 1-9 Keys - Mode switching (always works)
            const keyNum = parseInt(e.key, 10);
            if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
                e.preventDefault();
                setCurrentMode(keyNum);
                return;
            }

            // Delete/Backspace always works - delete nodes and clips
            if (matchesAction(e, 'edit.delete') || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelected();
                // Also delete selected audio clips
                selectedClipIds.forEach(clipId => removeClip(clipId));
                return;
            }

            // Mode 1 only shortcuts (config mode)
            if (currentMode === 1) {
                // Q key - Go back up one level in hierarchical canvas (only in mode 1)
                if (e.key === 'q' || e.key === 'Q') {
                    e.preventDefault();  // Always prevent default for consistency
                    if (currentViewNodeId !== null) {
                        exitToParent();
                    }
                    // At root level, Q silently does nothing (consistent with navigation being unavailable)
                    return;
                }

                // Spacebar in config mode - toggle global play/pause for continuous sources
                if (e.code === 'Space' && !e.repeat) {
                    e.preventDefault();
                    useTransportStore.getState().toggleGlobalPause();
                    return;
                }

                if (matchesAction(e, 'view.ghostMode')) {
                    e.preventDefault();
                    toggleGhostMode();
                    return;
                }

                if (matchesAction(e, 'edit.undo')) {
                    e.preventDefault();
                    undo();
                    return;
                }

                if (matchesAction(e, 'edit.redo')) {
                    e.preventDefault();
                    redo();
                    return;
                }

                // Ctrl+C / Cmd+C - Copy
                if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                    e.preventDefault();
                    copySelected();
                    return;
                }

                // Ctrl+V / Cmd+V - Paste
                if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                    e.preventDefault();
                    pasteClipboard();
                    return;
                }

                if (matchesAction(e, 'canvas.multiConnect')) {
                    // Ctrl+A while hovering over a port - select all ports of same type on that node
                    const hoverTarget = useCanvasStore.getState().hoverTarget;

                    if (e.ctrlKey && hoverTarget?.portId && hoverTarget?.portType && hoverTarget?.portDirection) {
                        e.preventDefault();

                        const graphNodes = useGraphStore.getState().nodes;
                        const node = graphNodes.get(hoverTarget.nodeId);
                        if (!node) return;

                        // Find all ports matching type AND direction on this node
                        const matchingPorts = node.ports.filter(
                            p => p.type === hoverTarget.portType &&
                                 p.direction === hoverTarget.portDirection
                        );

                        if (matchingPorts.length > 0) {
                            // Start connecting with all matching ports
                            startConnecting(
                                matchingPorts.map(p => ({ nodeId: node.id, portId: p.id }))
                            );
                        }
                        return;
                    }

                    // If already dragging a connection, expand to include all empty ports of same type/direction
                    const { isConnecting, connectingFrom } = useCanvasStore.getState();
                    if (isConnecting && connectingFrom && connectingFrom.length > 0) {
                        e.preventDefault();

                        const graphNodes = useGraphStore.getState().nodes;
                        const graphConnections = useGraphStore.getState().connections;

                        // Build set of already-connected port keys
                        const existingKeys = new Set(connectingFrom.map(s => `${s.nodeId}:${s.portId}`));

                        // Get unique source nodes and their port types from current selection
                        const nodePortInfo = new Map<string, { type: string; direction: string }>();
                        for (const source of connectingFrom) {
                            const node = graphNodes.get(source.nodeId);
                            if (!node) continue;
                            const port = node.ports.find(p => p.id === source.portId);
                            if (port) {
                                nodePortInfo.set(source.nodeId, { type: port.type, direction: port.direction });
                            }
                        }

                        // Expand: add all other empty ports of same type/direction from those nodes
                        const expandedSources = [...connectingFrom];
                        for (const [nodeId, portInfo] of nodePortInfo) {
                            const node = graphNodes.get(nodeId);
                            if (!node) continue;

                            const matchingPorts = node.ports.filter(
                                p => p.type === portInfo.type && p.direction === portInfo.direction
                            );

                            for (const port of matchingPorts) {
                                const key = `${nodeId}:${port.id}`;
                                if (existingKeys.has(key)) continue; // Already included

                                // Check if port is empty (not connected)
                                const hasConnection = Array.from(graphConnections.values()).some(conn =>
                                    (portInfo.direction === 'output'
                                        ? conn.sourceNodeId === nodeId && conn.sourcePortId === port.id
                                        : conn.targetNodeId === nodeId && conn.targetPortId === port.id)
                                );

                                if (!hasConnection) {
                                    expandedSources.push({ nodeId, portId: port.id });
                                    existingKeys.add(key);
                                }
                            }
                        }

                        if (expandedSources.length > connectingFrom.length) {
                            startConnecting(expandedSources);
                        }
                        return;
                    }

                    // Fallback: Get all selected nodes (original behavior)
                    const selectedIds = useGraphStore.getState().selectedNodeIds;
                    const graphNodes = useGraphStore.getState().nodes;
                    const graphConnections = useGraphStore.getState().connections;

                    if (selectedIds.size >= 1) {
                        e.preventDefault();

                        // Build array of all empty output ports from all selected nodes
                        const allSources: { nodeId: string; portId: string }[] = [];

                        for (const nodeId of selectedIds) {
                            const node = graphNodes.get(nodeId);
                            if (!node) continue;

                            // Get all output ports (both audio and control)
                            const outputPorts = node.ports.filter(p => p.direction === 'output');

                            // Filter to only empty (unconnected) ports
                            const emptyOutputs = outputPorts.filter(port => {
                                const hasConnection = Array.from(graphConnections.values()).some(
                                    conn => conn.sourceNodeId === nodeId && conn.sourcePortId === port.id
                                );
                                return !hasConnection;
                            });

                            for (const port of emptyOutputs) {
                                allSources.push({ nodeId, portId: port.id });
                            }
                        }

                        if (allSources.length > 0) {
                            startConnecting(allSources);
                        }
                    }
                    return;
                }

                // E key - Dive into selected node's internal canvas
                if (e.key === 'e' || e.key === 'E') {
                    e.preventDefault();
                    const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
                    if (selectedIds.length !== 1) return;

                    // Use fresh state to avoid stale closure issues
                    const selectedNode = useGraphStore.getState().nodes.get(selectedIds[0]);
                    if (!selectedNode) return;

                    const definition = getNodeDefinition(selectedNode.type);
                    const canEnter = definition.canEnter !== false;
                    const hasChildren = selectedNode.childIds && selectedNode.childIds.length > 0;

                    if (canEnter && hasChildren) {
                        enterNode(selectedNode.id);
                    } else {
                        // Flash node for ANY failure reason (canEnter=false OR no children)
                        useUIFeedbackStore.getState().flashNode(selectedNode.id);
                    }
                    return;
                }
            }

            // Keyboard input mode (modes 2-9)
            if (currentMode > 1) {
                const activeKeyboardId = useAudioStore.getState().activeKeyboardId;
                if (activeKeyboardId) {
                    // Handle spacebar for control signal (prevent repeat)
                    if (e.code === 'Space' && !e.repeat) {
                        e.preventDefault();
                        const emitControlDown = useAudioStore.getState().emitControlDown;
                        emitControlDown(activeKeyboardId);
                        return;
                    }

                    // Check all three rows for the pressed key
                    const key = e.key.toLowerCase();
                    for (let row = 1; row <= 3; row++) {
                        const rowKeys = ROW_KEYS[row];
                        const keyIndex = rowKeys?.indexOf(key);

                        if (keyIndex !== -1) {
                            e.preventDefault();
                            // Store keyboardId at press time for reliable release
                            // This prevents stuck notes if mode changes between keydown and keyup
                            activeKeyboardKeys.current.set(key, { keyboardId: activeKeyboardId, row, keyIndex });
                            emitKeyboardSignal(activeKeyboardId, row, keyIndex);
                            break; // Only one row can match per key
                        }
                    }
                }
            }
        }

        function handleKeyUp(e: KeyboardEvent) {
            // Skip if typing in input
            if ((e.target as HTMLElement).tagName === 'INPUT') return;

            const key = e.key.toLowerCase();

            // First check if this key was pressed in keyboard mode (stored in activeKeyboardKeys)
            // This ensures the note is released even if mode changed since keydown
            const storedKey = activeKeyboardKeys.current.get(key);
            if (storedKey) {
                e.preventDefault();
                releaseKeyboardSignal(storedKey.keyboardId, storedKey.row, storedKey.keyIndex);
                activeKeyboardKeys.current.delete(key);
                return;
            }

            const currentMode = useAudioStore.getState().currentMode;

            // Keyboard input mode (modes 2-9) - release control signals
            if (currentMode > 1) {
                const activeKeyboardId = useAudioStore.getState().activeKeyboardId;
                if (activeKeyboardId) {
                    // Handle spacebar for control signal
                    if (e.code === 'Space') {
                        e.preventDefault();
                        const emitControlUp = useAudioStore.getState().emitControlUp;
                        emitControlUp(activeKeyboardId);
                        return;
                    }
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [deleteSelected, toggleGhostMode, undo, redo, startConnecting, setCurrentMode, enterNode, exitToParent, allNodes, currentViewNodeId, copySelected, pasteClipboard, selectedClipIds, removeClip]);

    // Collaboration presence (U23): publish current view level + node selection
    // whenever they change. No-op when no session is active.
    useEffect(() => {
        if (!collabActive) return;
        publishViewNode(currentViewNodeId);
    }, [collabActive, currentViewNodeId, publishViewNode]);

    const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
    useEffect(() => {
        if (!collabActive) return;
        publishSelection(Array.from(selectedNodeIds));
    }, [collabActive, selectedNodeIds, publishSelection]);

    // Cache for port positions - invalidated when pan/zoom/nodes change
    // This prevents expensive DOM queries on every render for every connection
    const portPositionCache = useRef<Map<string, Position>>(new Map());
    const [portLayoutVersion, setPortLayoutVersion] = useState(0);
    const lastPanZoom = useRef({ pan, zoom });

    // Invalidate cache when pan/zoom changes
    useEffect(() => {
        if (lastPanZoom.current.pan.x !== pan.x ||
            lastPanZoom.current.pan.y !== pan.y ||
            lastPanZoom.current.zoom !== zoom) {
            portPositionCache.current.clear();
            lastPanZoom.current = { pan, zoom };
        }
    }, [pan, zoom]);

    // Also invalidate cache when nodes change (positions may have changed)
    useEffect(() => {
        portPositionCache.current.clear();
    }, [allNodes]);

    // Connections render before nodes, so the first pass can only use fallback
    // math. Re-render once after the node DOM paints so cables anchor to dots.
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            portPositionCache.current.clear();
            setPortLayoutVersion(version => version + 1);
        });

        return () => window.cancelAnimationFrame(frame);
    }, [nodes, connections.size]);

    // Get port position for connection rendering
    // Uses cached positions or DOM query for accurate positions, falls back to math calculation
    const getPortPosition = useCallback((nodeId: string, portId: string): Position | null => {
        const cacheKey = `${nodeId}:${portId}`;

        // Check cache first
        const cached = portPositionCache.current.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Try DOM query for actual port position (more accurate for schematic nodes)
        const portElement = document.querySelector(
            `[data-node-id="${nodeId}"][data-port-id="${portId}"]`
        ) as HTMLElement | null;

        if (portElement && canvasRef.current) {
            const canvasRect = canvasRef.current.getBoundingClientRect();
            const portRect = portElement.getBoundingClientRect();

            // Convert screen position to canvas coordinates (accounting for pan/zoom)
            const screenX = portRect.left + portRect.width / 2;
            const screenY = portRect.top + portRect.height / 2;

            // Reverse the canvas transform to get canvas coordinates
            const canvasX = (screenX - canvasRect.left - pan.x) / zoom;
            const canvasY = (screenY - canvasRect.top - pan.y) / zoom;

            const position = { x: canvasX, y: canvasY };
            portPositionCache.current.set(cacheKey, position);
            return position;
        }

        // Fall back to math-based calculation
        const node = allNodes.get(nodeId);
        if (!node) return null;
        return calculatePortPosition(node, portId);
    }, [allNodes, pan, zoom]);

    // Render connection path using memoized component
    const renderConnection = useCallback((conn: Connection) => {
        const startPos = getPortPosition(conn.sourceNodeId, conn.sourcePortId);
        const endPos = getPortPosition(conn.targetNodeId, conn.targetPortId);

        if (!startPos || !endPos) return null;

        const dx = endPos.x - startPos.x;
        const controlOffset = Math.min(Math.abs(dx) / 2, 100);

        const path = `M ${startPos.x} ${startPos.y}
                  C ${startPos.x + controlOffset} ${startPos.y},
                    ${endPos.x - controlOffset} ${endPos.y},
                    ${endPos.x} ${endPos.y}`;

        const isSelected = selectedConnectionIds.has(conn.id);

        // Auto-detect bundle status from internal wiring
        const bundleCount = getConnectionBundleCount(conn, allNodes, allConnections);
        const isBundled = bundleCount > 1;

        // Get signal level for visualization (works for all connection types)
        // Audio: uses "sourceNodeId->targetNodeId" key from RMS analyzer
        // Control: uses connection ID directly from control signal tracking
        const audioConnectionKey = `${conn.sourceNodeId}->${conn.targetNodeId}`;
        const signalLevel = signalLevels.get(audioConnectionKey) ?? signalLevels.get(conn.id) ?? 0;

        return (
            <ConnectionPath
                key={conn.id}
                conn={conn}
                path={path}
                isSelected={isSelected}
                isBundled={isBundled}
                bundleCount={bundleCount}
                signalLevel={signalLevel}
                onSelect={selectConnection}
            />
        );
    }, [getPortPosition, selectedConnectionIds, selectConnection, allNodes, allConnections, signalLevels, portLayoutVersion]);

    // Render temporary connection while dragging
    const renderTempConnection = useCallback(() => {
        if (!isConnecting || !connectingFrom) return null;

        const sources = Array.isArray(connectingFrom) ? connectingFrom : [connectingFrom];
        const endPos = screenToCanvas(mousePos);

        return (
            <>
                {sources.map((source, index) => {
                    const startPos = getPortPosition(source.nodeId, source.portId);
                    if (!startPos) return null;

                    const targetX = endPos.x;
                    const targetY = endPos.y + (index * 10);

                    const dx = targetX - startPos.x;
                    const controlOffset = Math.min(Math.abs(dx) / 2, 100);

                    const path = `M ${startPos.x} ${startPos.y} 
                              C ${startPos.x + controlOffset} ${startPos.y},
                                ${targetX - controlOffset} ${targetY},
                                ${targetX} ${targetY}`;

                    return (
                        <path
                            key={`${source.nodeId}-${source.portId}`}
                            d={path}
                            className={`connection-line control connection-temp`}
                        />
                    );
                })}
            </>
        );
    }, [isConnecting, connectingFrom, getPortPosition, screenToCanvas, mousePos, portLayoutVersion]);

    // Calculate bounds for current level's nodes (not root)
    const getCurrentLevelBounds = useCallback((): NodeBounds | null => {
        if (nodes.size === 0) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        nodes.forEach(node => {
            const dims = getNodeDimensions(node);
            minX = Math.min(minX, node.position.x);
            minY = Math.min(minY, node.position.y);
            maxX = Math.max(maxX, node.position.x + dims.width);
            maxY = Math.max(maxY, node.position.y + dims.height);
        });

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }, [nodes]);

    // Visibility detection for BackToAction button
    const nodesVisibility = useMemo(() => {
        if (nodes.size === 0) return { visible: true, direction: null };

        const bounds = getCurrentLevelBounds();
        if (!bounds) return { visible: true, direction: null };

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Convert bounds to screen coordinates
        const screenLeft = bounds.x * zoom + pan.x;
        const screenTop = bounds.y * zoom + pan.y;
        const screenRight = (bounds.x + bounds.width) * zoom + pan.x;
        const screenBottom = (bounds.y + bounds.height) * zoom + pan.y;

        // Check if any part of bounds is visible
        const visible = !(
            screenRight < 0 ||           // All nodes to the left
            screenLeft > viewportWidth || // All nodes to the right
            screenBottom < 0 ||          // All nodes above
            screenTop > viewportHeight   // All nodes below
        );

        // Check if zoomed out too far (nodes too small to see)
        const nodeScreenSize = Math.max(bounds.width, bounds.height) * zoom;
        const tooSmall = nodeScreenSize < 20;

        // Calculate direction to nodes
        let direction: number | null = null;
        if (!visible || tooSmall) {
            const centerScreenX = bounds.centerX * zoom + pan.x;
            const centerScreenY = bounds.centerY * zoom + pan.y;
            const viewCenterX = viewportWidth / 2;
            const viewCenterY = viewportHeight / 2;

            direction = Math.atan2(
                centerScreenY - viewCenterY,
                centerScreenX - viewCenterX
            ) * (180 / Math.PI);
        }

        return {
            visible: visible && !tooSmall,
            direction
        };
    }, [nodes.size, pan.x, pan.y, zoom, getCurrentLevelBounds]);

    // Handle back to action navigation
    const handleBackToAction = useCallback(() => {
        const bounds = getCurrentLevelBounds();
        if (bounds) {
            fitToNodes(bounds, window.innerWidth, window.innerHeight);
        }
    }, [getCurrentLevelBounds, fitToNodes]);

    // Render selection box
    const renderSelectionBox = () => {
        if (!selectionBox) return null;

        const x = Math.min(selectionBox.startX, selectionBox.currentX);
        const y = Math.min(selectionBox.startY, selectionBox.currentY);
        const width = Math.abs(selectionBox.currentX - selectionBox.startX);
        const height = Math.abs(selectionBox.currentY - selectionBox.startY);

        return (
            <div
                className="selection-box"
                style={{
                    left: x,
                    top: y,
                    width,
                    height
                }}
            />
        );
    };

    // Merge canvas ref with scroll capture ref
    const mergedCanvasRef = useCallback((node: HTMLDivElement | null) => {
        // Update our internal ref
        (canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        // Also pass to scroll capture
        scrollCaptureRef(node);
    }, [scrollCaptureRef]);

    return (
        <div
            ref={mergedCanvasRef}
            className={`node-canvas ${ghostMode ? 'ghost-mode' : ''} ${isConnecting ? 'is-connecting' : ''}`}
            onContextMenu={handleContextMenu}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{ cursor: isPanning || (rightClickStart && rightClickMoved.current) ? 'grabbing' : selectionBox ? 'crosshair' : 'default' }}
        >
            <div className="node-canvas-grid" style={{
                backgroundPosition: `${pan.x}px ${pan.y}px`,
                backgroundSize: `${20 * zoom}px ${20 * zoom}px`
            }} />

            <div
                className="node-canvas-content"
                style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                }}
            >
                {/* Connections Layer */}
                <div className="connections-layer">
                    <svg>
                        {Array.from(connections.values()).map(renderConnection)}
                        {renderTempConnection()}
                    </svg>
                </div>

                {/* Nodes Layer */}
                <div className="nodes-layer">
                    {Array.from(nodes.values()).map((node) => (
                        <NodeWrapper key={node.id} node={node} />
                    ))}
                </div>

                {/* Audio Clips Layer */}
                <div className="clips-layer">
                    {clipsOnCanvas.map((clip) => (
                        <AudioClipVisual
                            key={clip.id}
                            clip={clip}
                            isOnCanvas={true}
                            isDragging={clipDragState.draggedClipId === clip.id}
                            isSelected={selectedClipIds.has(clip.id)}
                            onDragStart={(e) => {
                                const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                selectClip(clip.id, e.shiftKey);
                                startClipDrag(clip.id, { x: e.clientX, y: e.clientY }, bounds);
                            }}
                            onDoubleClick={() => openClipEditor(clip.id)}
                        />
                    ))}
                </div>

                {/* Collaboration presence overlay (U23): remote peer cursors +
                    selection rings. Renders nothing when not in a session. */}
                <PresenceOverlay />

                {/* Selection Box */}
                {renderSelectionBox()}
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu}
                    onClose={() => setContextMenu(null)}
                    onAddNode={handleAddNode}
                    onOpenMIDIBrowser={handleOpenMIDIBrowser}
                />
            )}

            {/* Audio Clip Drag Layer (portal) */}
            <ClipDragLayer />

            {/* Waveform Editor Modal (portal) */}
            <WaveformEditorModal />

            {/* Back to Action button - appears when nodes are not visible on any level */}
            {nodes.size > 0 && !nodesVisibility.visible && nodesVisibility.direction !== null && (
                <button
                    className="back-to-action"
                    onClick={handleBackToAction}
                    style={{ '--arrow-rotation': `${nodesVisibility.direction}deg` } as React.CSSProperties}
                >
                    <span className="back-to-action-arrow">→</span>
                    <span className="back-to-action-label">Back to nodes</span>
                </button>
            )}

        </div>
    );
}
