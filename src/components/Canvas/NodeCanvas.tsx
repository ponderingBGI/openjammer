/**
 * Node Canvas - Main canvas with pan/zoom, box selection, and node rendering
 */

import { useCallback, useRef, useState, useEffect, useLayoutEffect, useMemo, lazy, Suspense } from 'react';
import type { Position, Connection } from '../../engine/types';
import { useGraphStore, getNodeDimensions, type NodeBounds } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useAudioStore } from '../../store/audioStore';
import { useCanvasNavigationStore } from '../../store/canvasNavigationStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { useTransportStore } from '../../store/transportStore';
import { resolveNodeDefinition } from '../../engine/registry';
import { getPortPosition as calculatePortPosition } from '../../utils/portPositions';
import { getConnectionBundleCount } from '../../utils/portSync';
import { getExecutor } from '../../audio/executor';
import { useScrollCapture, type ScrollData } from '../../hooks/useScrollCapture';
import { ContextMenu, type CanvasVerbs, type ContextMenuTarget } from './ContextMenu';
import { LiveAnnouncer } from '../../a11y/LiveAnnouncer';
import { announce } from '../../a11y/announce';
import { NodeWrapper } from '../Nodes/NodeWrapper';
import { beginConnectionFrom, completeConnectionAt } from '../Nodes/connectionVerbs';
import { Cable } from '@openjammer/oj-ui';
import { useMIDIStore } from '../../store/midiStore';
import { useAudioClipStore } from '../../store/audioClipStore';
import { useLibraryStore, getSampleFile } from '../../store/libraryStore';
import { createClipFromSample, generateWaveformPeaksAsync } from '../../utils/clipUtils';
import { getAudioContext } from '../../audio/audioContext';
import { isEditableTarget } from '../../utils/editableTarget';
import { AudioClipVisual } from '../Clips/AudioClipVisual';
import { ClipDragLayer } from '../Clips/ClipDragLayer';
// The waveform editor is a heavy, on-demand modal (canvas rendering + clip DSP)
// that renders null until a clip is opened for editing. Code-split it behind a
// real dynamic import so its weight stays out of the first-paint entry chunk;
// the canvas itself loads eagerly. The Suspense fallback is never seen on the
// hot path — only on the first clip-edit open, where a frame's delay is invisible.
const WaveformEditorModal = lazy(() =>
    import('../Clips/WaveformEditorModal').then((m) => ({
        default: m.WaveformEditorModal,
    })),
);
import { PresenceOverlay } from '../Collab/PresenceOverlay';
import { registerBindingSet } from '../../keymap/registry';
import { useUiViewStore } from '../../store/uiViewStore';
import { useCollabStore } from '../../store/collabStore';
import './NodeCanvas.css';
import { runAction } from '../Shell/runAction';

/**
 * Editing commands that must reach the canvas in EVERY mode, not just config
 * mode — they are chords, not notes. See the comment at their handler below.
 */
/**
 * ONE sentence for one event (U10). A cable in the air can be let go from four
 * places — the socket's own `Escape`, the global Escape cascade, a click on empty
 * paper, and a mouse-up that landed on nothing — and three of them used to do it
 * in silence while the fourth said "Cable dropped." "Released" rather than
 * "dropped" because a cable *dropped on a port* is the successful landing.
 */
const CABLE_RELEASED = 'Cable released.';

const COMMAND_ACTIONS = new Set([
    'edit.undo', 'edit.redo', 'canvas.copy', 'canvas.paste', 'canvas.selectAll', 'canvas.duplicate',
]);

interface SelectionBox {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

export function NodeCanvas() {
    const canvasRef = useRef<HTMLDivElement>(null);
    const [contextMenu, setContextMenu] = useState<Position | null>(null);
    /** The card the open menu belongs to, or null for the empty-canvas menu. */
    const [contextTarget, setContextTarget] = useState<ContextMenuTarget | null>(null);
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);

    // MIDI browser - open via store, MIDIIntegration handles rendering
    const openMIDIBrowser = useMIDIStore((s) => s.openBrowser);

    // Right-click drag state (for pan vs context menu)
    const [rightClickStart, setRightClickStart] = useState<Position | null>(null);
    const rightClickMoved = useRef(false);
    // What the pending right-click landed on: a card, or null for bare canvas.
    const rightClickTarget = useRef<ContextMenuTarget | null>(null);

    // Track if Ctrl was held when starting selection box (for port selection mode)
    const selectionBoxCtrlHeld = useRef(false);

    // Signal levels for audio visualization (connection key -> 0-1 level)
    // Use ref for raw data (updated at 60fps) and throttle state updates to reduce re-renders
    const [signalLevels, setSignalLevels] = useState<Map<string, number>>(new Map());
    const signalLevelsRef = useRef<Map<string, number>>(new Map());
    const signalUpdateScheduled = useRef(false);
    const signalUpdateFrame = useRef<number | null>(null);

    // Subscribe to signal level updates from the audio executor
    // Throttle state updates to ~30fps to reduce re-renders while keeping smooth animation
    useEffect(() => {
        const unsubscribe = getExecutor().subscribeSignalLevels((levels) => {
            signalLevelsRef.current = levels;

            // Throttle state updates using requestAnimationFrame
            if (!signalUpdateScheduled.current) {
                signalUpdateScheduled.current = true;
                signalUpdateFrame.current = requestAnimationFrame(() => {
                    setSignalLevels(new Map(signalLevelsRef.current));
                    signalUpdateScheduled.current = false;
                });
            }
        });
        return () => {
            unsubscribe();
            if (signalUpdateFrame.current !== null) cancelAnimationFrame(signalUpdateFrame.current);
        };
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- allNodes is the reactivity trigger: getNodesAtLevel reads the store via get(), so this memo must recompute when the nodes Map identity changes
    }, [currentViewNodeId, getNodesAtLevel, allNodes]);

    const connections = useMemo(() => {
        const connArray = getConnectionsAtLevel(currentViewNodeId);
        return new Map(connArray.map(c => [c.id, c]));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- allConnections is the reactivity trigger: getConnectionsAtLevel reads the store via get(), so this memo must recompute when the connections Map identity changes
    }, [currentViewNodeId, getConnectionsAtLevel, allConnections]);
    const selectedConnectionIds = useGraphStore((s) => s.selectedConnectionIds);
    // Read high, because the canvas EDIT VERBS below need it and the collab
    // presence effect further down needs the same subscription.
    const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
    const selectConnection = useGraphStore((s) => s.selectConnection);
    const clearSelection = useGraphStore((s) => s.clearSelection);
    const deleteSelected = useGraphStore((s) => s.deleteSelected);
    const selectNodesInRect = useGraphStore((s) => s.selectNodesInRect);
    const undo = useGraphStore((s) => s.undo);
    const redo = useGraphStore((s) => s.redo);
    const copySelected = useGraphStore((s) => s.copySelected);
    const pasteClipboard = useGraphStore((s) => s.pasteClipboard);
    const duplicateSelected = useGraphStore((s) => s.duplicateSelected);

    // Canvas store
    const pan = useCanvasStore((s) => s.pan);
    const zoom = useCanvasStore((s) => s.zoom);
    const isPanning = useCanvasStore((s) => s.isPanning);
    const setPanning = useCanvasStore((s) => s.setPanning);
    const setDragging = useCanvasStore((s) => s.setDragging);
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
    const setCanvasRect = useCanvasStore((s) => s.setCanvasRect);
    const canvasRect = useCanvasStore((s) => s.canvasRect);

    const refreshCanvasRect = useCallback(() => {
        const element = canvasRef.current;
        if (!element) return useCanvasStore.getState().canvasRect;
        const rect = element.getBoundingClientRect();
        const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        const current = useCanvasStore.getState().canvasRect;
        if (current.left !== next.left || current.top !== next.top ||
            current.width !== next.width || current.height !== next.height) {
            setCanvasRect(next);
        }
        return next;
    }, [setCanvasRect]);

    useEffect(() => {
        const element = canvasRef.current;
        if (!element) return;
        const updateRect = () => { refreshCanvasRect(); };
        const surfaceRoot = element.closest('[data-surface-root]');
        updateRect();
        const frame = requestAnimationFrame(updateRect);
        const observer = new ResizeObserver(updateRect);
        observer.observe(element);
        window.addEventListener('resize', updateRect);
        window.addEventListener('scroll', updateRect, true);
        surfaceRoot?.addEventListener('transitionend', updateRect);
        surfaceRoot?.addEventListener('animationend', updateRect);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('resize', updateRect);
            window.removeEventListener('scroll', updateRect, true);
            surfaceRoot?.removeEventListener('transitionend', updateRect);
            surfaceRoot?.removeEventListener('animationend', updateRect);
        };
    }, [refreshCanvasRect]);

    // Audio clip store
    const allClips = useAudioClipStore((s) => s.clips);
    // Drives the lazy WaveformEditorModal mount: gating the mount on this (instead
    // of rendering it unconditionally) is what actually defers the code-split chunk
    // to first clip-edit, rather than fetching it on canvas mount.
    const editingClipId = useAudioClipStore((s) => s.editingClipId);
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

    // Mouse position state is updated only while connecting for the temporary cable.
    const [mousePos, setMousePos] = useState<Position>({ x: 0, y: 0 });
    const lastPanPos = useRef<Position>({ x: 0, y: 0 });

    // Get port position in canvas coordinates for a given node and port
    // Used for box selection of ports
    const getPortCanvasPositionForSelection = useCallback((node: { id: string; position: Position; ports: { id: string; position?: { x: number; y: number } }[] }, portId: string): Position | null => {
        // First try DOM query for actual port position (more accurate)
        const portElement = canvasRef.current?.querySelector(
            `[data-node-id="${CSS.escape(node.id)}"][data-port-id="${CSS.escape(portId)}"]`
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

        // Fallback: the ONE port-geometry home (utils/portPositions), so the
        // marquee and the cables can never disagree about where a socket is.
        const graphNode = useGraphStore.getState().nodes.get(node.id);
        if (!graphNode) return null;
        return calculatePortPosition(graphNode, portId);
    }, [pan, zoom]);

    // Handle right-click context menu - just prevent default
    // Menu is shown on mouseup if no drag occurred
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
    }, []);

    /*
     * THE CANVAS EDIT VERBS — one implementation, two routes (HA-26).
     *
     * These are the bodies the keymap's `canvas.copy` / `canvas.paste` /
     * `canvas.duplicate` / `canvas.selectAll` / `edit.delete` entries run, lifted
     * out of the keydown handler so the right-click menu can run the SAME
     * function rather than a second copy of it. Until now none of them had a
     * pointer route at all: delete, copy, paste, duplicate and select-all were
     * keyboard-only, undiscoverable, and invisible to anyone who had not read the
     * shortcuts panel.
     *
     * `Cut` is deliberately NOT here. The canvas has no cut action and no
     * `Ctrl+X` binding (`keybindingActions` has `arrangement.cut` and
     * `pianoroll.cut`, and nothing for the graph), and a menu row that advertises
     * a verb the keyboard does not perform is the mirror image of the bug this
     * lane is fixing. It wants a real `canvas.cut` action first.
     */
    const verbsRef = useRef<CanvasVerbs | null>(null);
    const canvasVerbs = useMemo<CanvasVerbs>(() => ({
        /*
         * RG-04 — these two record NO history, so `LiveAnnouncer` (which listens
         * to the history store) can never name them. They are two of HA-26's five
         * new pointer verbs and they answered with nothing on either route; the
         * measured symptom was the live region still holding the PREVIOUS
         * sentence after a Copy. `announce()` exists for exactly this: gesture
         * moments that change no document state.
         */
        copy: () => {
            const count = useGraphStore.getState().selectedNodeIds.size;
            copySelected();
            if (count > 0) announce(`Copied ${count} ${count === 1 ? 'node' : 'nodes'}`);
        },
        paste: () => pasteClipboard(),
        duplicate: () => duplicateSelected(),
        selectAll: () => {
            const ids = useGraphStore.getState().getNodesAtLevel(currentViewNodeId).map((node) => node.id);
            useGraphStore.getState().selectNodes(ids);
            announce(`Selected all ${ids.length} ${ids.length === 1 ? 'node' : 'nodes'}`);
        },
        remove: () => {
            deleteSelected();
            // Clips live in their own store but share the selection gesture.
            useAudioClipStore.getState().selectedClipIds.forEach((clipId) => removeClip(clipId));
        },
        disconnectNode: (nodeId: string) => {
            const graph = useGraphStore.getState();
            const cables = graph.getConnectionsForNode(nodeId);
            if (cables.length === 0) return;
            // One gesture, one Ctrl+Z: pulling six cables out of a card is one
            // thing the player did, not six things.
            graph.beginGesture();
            try {
                for (const cable of cables) graph.removeConnection(cable.id);
            } finally {
                graph.endGesture();
            }
        },
        hasSelection: selectedNodeIds.size > 0 || selectedConnectionIds.size > 0,
    }), [copySelected, pasteClipboard, duplicateSelected, deleteSelected, removeClip, currentViewNodeId, selectedNodeIds, selectedConnectionIds]);
    // The keydown effect is deliberately not re-subscribed per render (see its
    // own note), so it reads the verbs through a ref rather than a closure. The
    // write is in an EFFECT, not the render body: a concurrent render that React
    // discards can still run the body, and a ref left pointing at verbs from a
    // commit that never happened is a trap even when today's value is harmless.
    useEffect(() => {
        verbsRef.current = canvasVerbs;
    }, [canvasVerbs]);

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
            /*
             * HA-26 — a right-click on a CARD used to be thrown away, so delete,
             * duplicate and disconnect had no pointer route anywhere in the app.
             * Now it opens the node's own menu. `data-canvas-node-root` is the
             * attribute every faceplate already carries for exactly this kind of
             * lookup (schematic cards wrap themselves in a `display: contents`
             * div that holds it, so `closest` still finds it).
             */
            const nodeRoot = (e.target as HTMLElement).closest<HTMLElement>('[data-canvas-node-root]');
            const nodeId = nodeRoot?.dataset.canvasNodeRoot ?? null;
            const node = nodeId ? useGraphStore.getState().nodes.get(nodeId) : undefined;
            rightClickTarget.current = node
                ? { id: node.id, title: resolveNodeDefinition(node).name }
                : null;
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
        // The union must always be EVERY node-root + port class currently mounted on
        // the canvas (Invariant B). oj-ui classes are added additively as nodes migrate;
        // legacy classes are dropped only after their last emitter is gone.
        // Belt and braces beside `ContextMenu`'s own `stopPropagation` (1C-01):
        // the menu host is portalled to the body but is a React child of this
        // div, so a row's mousedown arrives here. Never clear the selection or
        // start a marquee underneath an open menu.
        const isNodeOrPort = (e.target as HTMLElement).closest(
            '.node, .schematic-node, .oj-node-frame, .oj-node, ' +
                '.oj-port, .oj-port-row, .context-menu-host'
        );
        if (e.button === 0 && !isNodeOrPort) {
            clearSelection();
            // A click on empty paper discards an armed cable. For a keyboard
            // player that gesture had no other feedback at all, so it says so.
            if (useCanvasStore.getState().isConnecting) announce(CABLE_RELEASED);
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
            setDragging(true);
        }
    }, [setPanning, setDragging, clearSelection, stopConnecting, screenToCanvas]);

    // Throttle presence cursor broadcasts to one per animation frame.
    const cursorPublishScheduled = useRef(false);
    const cursorPublishFrame = useRef<number | null>(null);
    useEffect(() => () => {
        if (cursorPublishFrame.current !== null) cancelAnimationFrame(cursorPublishFrame.current);
    }, []);

    // Handle mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        // Broadcast cursor position (in canvas coords) to collaborators, throttled.
        if (collabActive && !cursorPublishScheduled.current) {
            cursorPublishScheduled.current = true;
            const screen = { x: e.clientX, y: e.clientY };
            cursorPublishFrame.current = requestAnimationFrame(() => {
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
                setDragging(true);
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
            if (Math.abs(width * zoom) > 5 || Math.abs(height * zoom) > 5) {
                selectNodesInRect({
                    x: Math.min(newBox.startX, newBox.currentX),
                    y: Math.min(newBox.startY, newBox.currentY),
                    width: Math.abs(width),
                    height: Math.abs(height)
                });
            }
        }
    }, [isPanning, panBy, setDragging, selectionBox, screenToCanvas, rightClickStart, selectNodesInRect, clipDragState.isDragging, updateClipDrag, isConnecting, collabActive, publishCursor, zoom]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        setPanning(false);
        setDragging(false);

        // Right-click release - show context menu if no drag
        if (rightClickStart) {
            if (!rightClickMoved.current) {
                // Didn't drag — show the menu for whatever was under the pointer.
                const target = rightClickTarget.current;
                // Right-clicking a card that is not in the selection makes it the
                // selection first, so "Delete" in the menu deletes the card the
                // player pointed at rather than something they forgot was selected.
                if (target && !useGraphStore.getState().selectedNodeIds.has(target.id)) {
                    useGraphStore.getState().selectNode(target.id);
                }
                setContextTarget(target);
                setContextMenu({ x: rightClickStart.x, y: rightClickStart.y });
            }
            setRightClickStart(null);
            rightClickMoved.current = false;
            rightClickTarget.current = null;
        }

        // Complete box selection - check for ports first (if Ctrl held), then nodes
        if (selectionBox) {
            const width = selectionBox.currentX - selectionBox.startX;
            const height = selectionBox.currentY - selectionBox.startY;

            // Only select if dragged more than 5 pixels
            if (Math.abs(width * zoom) > 5 || Math.abs(height * zoom) > 5) {
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
                // The mouse came up somewhere that is not a port: the drag is
                // over and the cable goes with it. Say so rather than having the
                // wire simply vanish.
                if (useCanvasStore.getState().isConnecting) {
                    stopConnecting();
                    announce(CABLE_RELEASED);
                }
            });
        }
    }, [setPanning, setDragging, selectionBox, selectNodesInRect, rightClickStart, isConnecting, stopConnecting, nodes, startConnecting, getPortCanvasPositionForSelection, clipDragState, endClipDrag, setClipPosition, screenToCanvas, zoom]);

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
                console.error('Library item not found:', itemData.id);
                return;
            }

            // Load the audio file and create clip
            const file = await getSampleFile(item.id);
            if (!file) {
                console.error('Could not load file for item:', item.id);
                return;
            }

            const ctx = getAudioContext();
            if (!ctx) {
                console.error('No audio context available');
                return;
            }

            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            // Use async worker for non-blocking waveform generation
            const waveformPeaksF32 = await generateWaveformPeaksAsync(audioBuffer, 64);
            const waveformPeaks = Array.from(waveformPeaksF32);
            const clipData = createClipFromSample(item, waveformPeaks, itemData.sourceNodeId);

            // Calculate canvas position from drop coordinates
            refreshCanvasRect();
            const canvasPos = useCanvasStore.getState().screenToCanvas({ x: e.clientX - 60, y: e.clientY - 20 });

            // Add clip with position
            const { id: _id, createdAt: _ca, lastModifiedAt: _lm, ...clipWithoutMeta } = clipData;
            const clipId = addClip({
                ...clipWithoutMeta,
                position: canvasPos,
            });

            // Select the new clip
            selectClip(clipId);
        } catch (err) {
            console.error('Failed to create clip from dropped item:', err);
        }
    }, [libraryItems, refreshCanvasRect, addClip, selectClip]);

    // Handle wheel for zoom and two-finger trackpad pan
    // Uses standardized scroll capture to prevent propagation and handle touchpad/mouse correctly
    const handleCanvasScroll = useCallback((data: ScrollData) => {
        // Pinch-to-zoom gesture (ctrlKey/metaKey set by browser for pinch gestures)
        if (data.isPinch) {
            const liveRect = refreshCanvasRect();
            const delta = data.scrollingDown ? 0.9 : 1.1;
            const newZoom = zoom * delta;
            zoomTo(newZoom, {
                x: data.clientX - liveRect.left,
                y: data.clientY - liveRect.top,
            });
            return;
        }

        // Two-finger trackpad pan - pans in all directions (horizontal, vertical, diagonal)
        // This allows natural panning with two fingers on laptop trackpads
        panBy({ x: -data.deltaX, y: -data.deltaY });
    }, [zoom, zoomTo, panBy, refreshCanvasRect]);

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
    const flushActiveNotesRef = useRef<() => void>(() => {});

    useEffect(() => {
        const flush = () => flushActiveNotesRef.current();
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        window.addEventListener('blur', flush);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            flush();
            window.removeEventListener('blur', flush);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    // Handle keyboard shortcuts using keybindings store
    useEffect(() => {
        const { emitKeyboardSignal, releaseKeyboardSignal } = useAudioStore.getState();

        const flushActiveNotes = () => {
            for (const active of activeKeyboardKeys.current.values()) {
                releaseKeyboardSignal(active.keyboardId, active.row, active.keyIndex);
            }
            activeKeyboardKeys.current.clear();
            const audio = useAudioStore.getState();
            if (audio.controlDown && audio.activeKeyboardId) audio.emitControlUp(audio.activeKeyboardId);
        };
        flushActiveNotesRef.current = flushActiveNotes;

        function handleKeyDown(e: KeyboardEvent, actionId?: string) {
            // ESC Key - Unified escape behavior (works in all modes)
            if (actionId === 'canvas.escape') {
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
                    setContextTarget(null);
                    return;
                }

                // Priority 4: Cancel box selection
                if (selectionBox) {
                    setSelectionBox(null);
                    return;
                }

                /*
                 * Priority 5: Cancel connection in progress.
                 *
                 * This path is reached whenever focus is NOT on the socket that
                 * armed the cable — press `Enter`, `Tab` away, `Escape` — and it
                 * used to drop the cable in silence, leaving the live region
                 * still saying "…armed. Move to another card's socket…". The
                 * player is then told they are holding something they are not,
                 * which is HA-07's shape inside the feature built to close it.
                 */
                if (useCanvasStore.getState().isConnecting) {
                    stopConnecting();
                    announce(CABLE_RELEASED);
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
            if (actionId === 'edit.delete' || actionId === 'canvas.deleteBackspace') {
                e.preventDefault();
                verbsRef.current?.remove();
                return;
            }

            /*
             * Editing commands work in EVERY mode.
             *
             * Modes 2–9 are keyboard modes: the bare letters belong to the notes,
             * which is why note keys stay gated below. But `Ctrl`/`Cmd` is exactly
             * the modifier that says "this is not a note" — a chord carrying it can
             * never collide with a key the player is holding, which is why
             * `edit.delete` has always sat outside the gate too.
             *
             * Leaving these inside the gate is what made `Ctrl+Z` dead for every
             * first-run player: installing a rig switches the app into that rig's
             * keyboard mode so typing plays immediately, and from that moment the
             * player's first edit was un-undoable until they pressed `1`. A rig
             * that promises "one Ctrl+Z away from gone" has to mean it.
             *
             * The `currentMode === 1` half of the condition keeps config mode
             * behaving as before for anyone who has REBOUND one of these actions
             * onto a bare key — the mode gate is what keeps that rebinding safe.
             */
            if (COMMAND_ACTIONS.has(actionId ?? '') && (e.ctrlKey || e.metaKey || currentMode === 1)) {
                if (actionId === 'edit.undo') {
                    e.preventDefault();
                    undo();
                    return;
                }

                if (actionId === 'edit.redo') {
                    e.preventDefault();
                    redo();
                    return;
                }

                // The four clipboard/selection verbs run the SAME functions the
                // right-click menu runs — one body each, two routes (HA-26).
                if (actionId === 'canvas.copy') {
                    e.preventDefault();
                    verbsRef.current?.copy();
                    return;
                }

                if (actionId === 'canvas.paste') {
                    e.preventDefault();
                    verbsRef.current?.paste();
                    return;
                }

                if (actionId === 'canvas.selectAll') {
                    e.preventDefault();
                    verbsRef.current?.selectAll();
                    return;
                }

                if (actionId === 'canvas.duplicate') {
                    e.preventDefault();
                    verbsRef.current?.duplicate();
                    return;
                }
            }

            /*
             * §4's LEVEL GRAMMAR — `E` goes in, `Q` comes out — and it reads the
             * same way on all three surfaces, in EVERY mode.
             *
             * These two used to sit inside the `currentMode === 1` gate below,
             * and their binding entries sat AFTER the computer-keyboard note row
             * (`ROW_KEYS[1]` is `q w e r t y u i o p`) in the same set. Installing
             * a rig switches the app into that rig's keyboard mode so typing plays
             * straight away — and every preset rig that carries a Song also carries
             * a keyboard — so from the first second of a first run, `E` over a
             * selected Song node was a note and the arrangement was unreachable by
             * key (W6-E2E finding F2).
             *
             * The note row is now the FALL-THROUGH rather than the gate: these
             * entries are registered first, but they consume their key only when
             * there is a level to change. Nothing selected, nothing to enter,
             * already at the root — the key is a note again, so a jam with nothing
             * selected (which is how a jam looks) plays exactly as before. In
             * config mode they still always consume, because there is no note
             * behind them and a rebound key must keep behaving as it always has.
             */
            if (actionId === 'canvas.exitLevel') {
                if (currentViewNodeId !== null) {
                    e.preventDefault();
                    exitToParent();
                    return;
                }
                // At the root there is nowhere to go. In config mode Q still owns
                // the key (silently); in a keyboard mode it is the note Q.
                if (currentMode === 1) e.preventDefault();
                return;
            }

            if (actionId === 'canvas.enterNode') {
                const selectedIds = Array.from(useGraphStore.getState().selectedNodeIds);
                // Use fresh state to avoid stale closure issues.
                const selectedNode = selectedIds.length === 1 ? useGraphStore.getState().nodes.get(selectedIds[0]) : undefined;
                if (selectedNode) {
                    // M5: resolve via the node's OPEN identity when set, so a
                    // dynamic AI node honours its dynamic def's canEnter:false.
                    const definition = resolveNodeDefinition(selectedNode);
                    const canEnter = definition.canEnter !== false;
                    const hasChildren = Boolean(selectedNode.childIds && selectedNode.childIds.length > 0);
                    if (selectedNode.type === 'song') {
                        e.preventDefault();
                        useUiViewStore.getState().setSurface('arrangement', selectedNode.id);
                        return;
                    }
                    if (canEnter && hasChildren) {
                        e.preventDefault();
                        enterNode(selectedNode.id);
                        return;
                    }
                    // Nothing to enter. In config mode the flash is the honest
                    // "no" for ANY failure reason (canEnter=false OR no children);
                    // in a keyboard mode the key is a note, and a flash there
                    // would be noise on top of a note the player did want.
                    if (currentMode === 1) {
                        e.preventDefault();
                        useUIFeedbackStore.getState().flashNode(selectedNode.id);
                    }
                    return;
                }
                if (currentMode === 1) e.preventDefault();
                return;
            }

            // Mode 1 only shortcuts (config mode)
            if (currentMode === 1) {
                // Spacebar in config mode - toggle global play/pause for continuous sources
                if (actionId === 'canvas.transport' && !e.repeat) {
                    e.preventDefault();
                    useTransportStore.getState().toggleGlobalPause();
                    return;
                }

                if (actionId === 'view.ghostMode') {
                    e.preventDefault();
                    toggleGhostMode();
                    return;
                }

                // Undo/redo, copy/paste, select-all and duplicate are handled
                // ABOVE the gate — they carry Ctrl/Cmd and must survive a keyboard
                // mode.

                if (actionId === 'view.zoomIn' || actionId === 'view.zoomOut') {
                    e.preventDefault();
                    const state = useCanvasStore.getState();
                    state.zoomTo(state.zoom * (actionId === 'view.zoomIn' ? 1.1 : 0.9), {
                        x: state.canvasRect.width / 2,
                        y: state.canvasRect.height / 2,
                    });
                    return;
                }

                if (actionId === 'view.resetView') {
                    e.preventDefault();
                    useCanvasStore.getState().resetView();
                    return;
                }

                if (actionId === 'canvas.multiConnect') {
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

                // `canvas.enterNode` (`E`) and `canvas.exitLevel` (`Q`) are handled
                // ABOVE the gate — §4's level grammar is not a config-mode feature.
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
                    const key = actionId?.startsWith('note.')
                        ? actionId.slice('note.'.length)
                        : e.key.toLowerCase();
                    for (let row = 1; row <= 3; row++) {
                        const rowKeys = ROW_KEYS[row];
                        const keyIndex = rowKeys?.indexOf(key);

                        if (keyIndex !== -1) {
                            e.preventDefault();
                            // Store keyboardId at press time for reliable release
                            // This prevents stuck notes if mode changes between keydown and keyup
                            activeKeyboardKeys.current.set(e.key.toLowerCase(), { keyboardId: activeKeyboardId, row, keyIndex });
                            emitKeyboardSignal(activeKeyboardId, row, keyIndex);
                            break; // Only one row can match per key
                        }
                    }
                }
            }
        }

        function handleKeyUp(e: KeyboardEvent) {
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

            // Releases for active sources must win over editable-target routing.
            if (isEditableTarget(e.target)) return;

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

        /*
         * §4's level grammar runs BEFORE the note row, and only these two do.
         *
         * Order inside a binding set is priority: `runSets` walks the entries and
         * stops at the first whose `run` returns true. The note entries returned
         * `event.defaultPrevented` after unconditionally consuming their key, so
         * while any keyboard mode was live — which is every first run, because
         * installing a rig selects that rig's keyboard mode — `E` and `Q` never
         * reached the canvas at all.
         *
         * They are lifted above the row rather than the row being scoped to a
         * focused keyboard node, because the row is played while looking at the
         * whole canvas with nothing focused: taking that away would cost real
         * playing to buy one key. Instead the handlers above fall through when
         * they have nothing to do, so the row keeps every key that was not about
         * to move the player somewhere. `canvas.transport` deliberately stays
         * below: in a keyboard mode `Space` is the sustain pedal.
         */
        const levelActions = ['canvas.enterNode', 'canvas.exitLevel'];
        const regularActions = [
            'canvas.escape', 'edit.delete', 'canvas.deleteBackspace',
            'canvas.transport', 'view.ghostMode', 'edit.undo', 'edit.redo',
            'canvas.copy', 'canvas.paste', 'canvas.multiConnect',
            'canvas.selectAll', 'canvas.duplicate', 'view.zoomIn', 'view.zoomOut', 'view.resetView',
        ];
        const noteActions = Object.values(ROW_KEYS).flat().map((key) => `note.${key}`);
        const unregister = registerBindingSet({
            id: 'node-canvas',
            scope: 'surface',
            surface: 'canvas',
            entries: [
                ...levelActions.map((actionId) => ({
                    actionId,
                    run: (event: KeyboardEvent) => {
                        handleKeyDown(event, actionId);
                        return event.defaultPrevented;
                    },
                })),
                ...noteActions.map((actionId) => ({
                    actionId,
                    guard: () => useAudioStore.getState().currentMode > 1,
                    run: (event: KeyboardEvent) => {
                        handleKeyDown(event, actionId);
                        return event.defaultPrevented;
                    },
                })),
                {
                    actionId: 'note.controlSpace',
                    guard: () => useAudioStore.getState().currentMode > 1,
                    run: (event: KeyboardEvent) => {
                        handleKeyDown(event, 'note.controlSpace');
                        return event.defaultPrevented;
                    },
                },
                ...regularActions.map((actionId) => ({
                    actionId,
                    run: (event: KeyboardEvent) => {
                        handleKeyDown(event, actionId);
                        return event.defaultPrevented;
                    },
                })),
            ],
        });
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            unregister();
            window.removeEventListener('keyup', handleKeyUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- stable window listeners by design: ROW_KEYS (recreated each render), contextMenu/selectionBox (frequently-changing local state read via closure) intentionally omitted so the handlers are not torn down/re-added mid-keystroke; clearSelection/stopConnecting are stable Zustand actions
    }, [deleteSelected, toggleGhostMode, undo, redo, startConnecting, setCurrentMode, enterNode, exitToParent, allNodes, currentViewNodeId, copySelected, pasteClipboard, duplicateSelected, selectedClipIds, removeClip]);

    // Collaboration presence (U23): publish current view level + node selection
    // whenever they change. No-op when no session is active.
    useEffect(() => {
        if (!collabActive) return;
        publishViewNode(currentViewNodeId);
    }, [collabActive, currentViewNodeId, publishViewNode]);

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

    // Connections render before nodes, so the first render pass of a mount or a
    // node add can only use fallback math. This runs AFTER the DOM is committed
    // but BEFORE the browser paints, so the re-render it schedules is flushed
    // synchronously and the very first painted frame already has cables measured
    // off the real sockets. As a rAF this was one frame late — visible as cables
    // snapping from the card corner into the well on every add. (Design for
    // instant: the player watches the change land, never a correction.)
    useLayoutEffect(() => {
        portPositionCache.current.clear();
        setPortLayoutVersion(version => version + 1);
    }, [nodes, connections.size]);

    // Cable anchors can move without a graph mutation when a node's content or
    // loaded font changes its measured box. Observe the rendered node roots and
    // republish the cached layout after either event.
    useEffect(() => {
        const invalidate = () => {
            portPositionCache.current.clear();
            setPortLayoutVersion((version) => version + 1);
        };
        const observer = new ResizeObserver(invalidate);
        canvasRef.current?.querySelectorAll('[data-canvas-node-root]').forEach((element) => {
            // Schematic nodes use a display:contents marker; observe their actual,
            // resizable visual root. NodeFrame roots are observed directly.
            observer.observe(element.firstElementChild ?? element);
        });
        let cancelled = false;
        void document.fonts?.ready.then(() => {
            if (!cancelled) invalidate();
        });
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [nodes]);

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
        const portElement = canvasRef.current?.querySelector(
            `[data-node-id="${CSS.escape(nodeId)}"][data-port-id="${CSS.escape(portId)}"]`
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

        const isSelected = selectedConnectionIds.has(conn.id);

        // Auto-detect bundle status from internal wiring
        const bundleCount = getConnectionBundleCount(conn, allNodes, allConnections);
        const isBundled = bundleCount > 1;

        // Signal level for visualization — Cable maps it to width/opacity/glow.
        // Audio: "sourceNodeId->targetNodeId" RMS key; control: connection ID.
        const audioConnectionKey = `${conn.sourceNodeId}->${conn.targetNodeId}`;
        const signalLevel = signalLevels.get(audioConnectionKey) ?? signalLevels.get(conn.id) ?? 0;

        return (
            <Cable
                key={conn.id}
                start={startPos}
                end={endPos}
                kind={conn.type}
                selected={isSelected}
                bundled={isBundled}
                bundleCount={bundleCount}
                signalLevel={signalLevel}
                onSelect={() => selectConnection(conn.id)}
            />
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- portLayoutVersion is a deliberate cache-bust: getPortPosition reads the portPositionCache ref (untracked), so this callback must change identity when the cache is invalidated after DOM paint, or cables render with stale anchor positions
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

                    // Fan multiple sources out vertically toward the cursor.
                    const targetY = endPos.y + (index * 10);

                    return (
                        <Cable
                            key={`${source.nodeId}-${source.portId}`}
                            temp
                            kind={allNodes.get(source.nodeId)?.ports.find(port => port.id === source.portId)?.type ?? 'control'}
                            start={startPos}
                            end={{ x: endPos.x, y: targetY }}
                        />
                    );
                })}
            </>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- portLayoutVersion is a deliberate cache-bust: getPortPosition reads the portPositionCache ref (untracked), so this callback must change identity when the cache is invalidated after DOM paint, or the temp cable renders from a stale anchor position
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

        const viewportWidth = canvasRect.width;
        const viewportHeight = canvasRect.height;

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
    }, [nodes.size, pan.x, pan.y, zoom, getCurrentLevelBounds, canvasRect.width, canvasRect.height]);

    // Handle back to action navigation
    const handleBackToAction = useCallback(() => {
        const bounds = getCurrentLevelBounds();
        if (bounds) {
            fitToNodes(bounds, canvasRect.width, canvasRect.height);
        }
    }, [getCurrentLevelBounds, fitToNodes, canvasRect.width, canvasRect.height]);

    /* =====================================================================
     * KEYBOARD PORTS (U8 / HA-02) — one roving tab stop per card, arrows to
     * walk it, Enter to wire.
     *
     * Measured before this: 0 of 84 ports tabbable, 42 of 42 with no role and no
     * name. A keyboard-only player could build a rig from Ctrl+K and then had NO
     * route to connect any of it — not a shortcut, not a palette command, not a
     * menu item. `docs/shell.md` recorded the gap as an open product decision;
     * this closes it.
     *
     * Two decisions worth stating:
     *
     * 1. ONE STOP PER CARD, not one per port. The piano roll already learned this
     *    the hard way: 128 tab stops is not accessibility, it is a maze. Tab
     *    walks cards, Arrow keys walk that card's sockets.
     *
     * 2. The tab stop is written STRAIGHT TO THE DOM rather than passed down as a
     *    prop. Twenty-three faceplates render their own ports, and threading a
     *    roving index through all of them would put the same rule in twenty-three
     *    places. React never writes `tabindex` on a port (no component passes
     *    one), so it never fights us for the attribute — and one MutationObserver
     *    keeps it true for cards that appear later.
     * ===================================================================== */
    const nodesLayerRef = useRef<HTMLDivElement>(null);
    /** The socket that currently holds each card's tab stop, by node id. */
    const rovingPort = useRef<Map<string, string>>(new Map());

    /** Every port on the canvas a keyboard may land on, in DOM order. */
    const keyboardPorts = useCallback((): HTMLElement[] => {
        const layer = nodesLayerRef.current;
        if (!layer) return [];
        return Array.from(layer.querySelectorAll<HTMLElement>('.oj-port[data-node-id][data-port-id]'))
            // A gated port is rendered visibly inert and carries no handlers; a
            // KeyTile's socket is hidden from the tree because the TILE is the
            // control there. Neither is a place to land.
            .filter((el) => el.getAttribute('aria-hidden') !== 'true' && el.dataset.portDisabled !== 'true');
    }, []);

    const applyRovingTabStops = useCallback(() => {
        const chosen = rovingPort.current;
        const byNode = new Map<string, HTMLElement[]>();
        for (const el of keyboardPorts()) {
            const nodeId = el.dataset.nodeId;
            if (!nodeId) continue;
            const list = byNode.get(nodeId);
            if (list) list.push(el);
            else byNode.set(nodeId, [el]);
        }
        for (const [nodeId, ports] of byNode) {
            const wanted = chosen.get(nodeId);
            const stop = ports.find((el) => el.dataset.portId === wanted) ?? ports[0];
            chosen.set(nodeId, stop.dataset.portId as string);
            for (const el of ports) el.tabIndex = el === stop ? 0 : -1;
        }
        // Cards that went away must not keep a stale preference forever.
        for (const nodeId of Array.from(chosen.keys())) {
            if (!byNode.has(nodeId)) chosen.delete(nodeId);
        }
    }, [keyboardPorts]);

    useEffect(() => {
        applyRovingTabStops();
        const layer = nodesLayerRef.current;
        if (!layer || typeof MutationObserver === 'undefined') return;
        /*
         * `keyboardPorts()` filters on two ATTRIBUTES (`aria-hidden`,
         * `data-port-disabled`), so watching `childList` alone would leave a
         * card's roving stop pointing at a socket that had since become
         * unreachable — without any DOM insert to notice. Nothing toggles those
         * at runtime today; the gated-port affordance is kept deliberately for
         * future nodes, and this is what makes it safe when one arrives.
         *
         * Self-retrigger stays impossible: our own write is `tabindex`, which is
         * not in the filter.
         */
        const observer = new MutationObserver(() => applyRovingTabStops());
        observer.observe(layer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-hidden', 'data-port-disabled'],
        });
        return () => observer.disconnect();
    }, [applyRovingTabStops, nodes]);

    /*
     * The ARMED socket, painted for the keyboard the same way the pointer path
     * paints it — a `data-armed` attribute `Port.css` styles. Written to the DOM
     * for the same reason the tab stop is: it must reach every faceplate without
     * a prop drilled through all of them.
     */
    useEffect(() => {
        const armed = new Set(
            (isConnecting && connectingFrom ? connectingFrom : []).map((source) => `${source.nodeId}:${source.portId}`),
        );
        for (const el of keyboardPorts()) {
            const key = `${el.dataset.nodeId}:${el.dataset.portId}`;
            if (armed.has(key)) el.setAttribute('data-armed', '');
            else el.removeAttribute('data-armed');
        }
    }, [isConnecting, connectingFrom, keyboardPorts, nodes]);

    /** The graph port behind a socket element. */
    const portModelOf = useCallback((el: HTMLElement) => {
        const nodeId = el.dataset.nodeId;
        const portId = el.dataset.portId;
        if (!nodeId || !portId) return null;
        const node = useGraphStore.getState().nodes.get(nodeId);
        const port = node?.ports.find((p) => p.id === portId);
        return node && port ? { node, port } : null;
    }, []);

    /**
     * Keys on a socket. Arrows walk this card's sockets; Enter arms and lands a
     * cable; Escape drops it.
     *
     * Arming and landing call the SHARED CONNECTION VERBS
     * (`../Nodes/connectionVerbs`) — the same two functions the card's pointer
     * handlers call, with the event plumbing stripped off. The first version of
     * this dispatched synthetic `MouseEvent`s at the socket to reach those
     * bodies; that reused the right code for the right reason (ghost ports
     * becoming real ports, an instrument growing inputs, the pending reconnect,
     * the one-`Ctrl+Z` bracket) but shared the wrong seam, and it left the
     * keyboard carrying a private pre-flight refusal set — a second opinion about
     * what is legal, which measurably disagreed with the pointer about a card
     * wiring to itself. The verb is the seam; `graphStore.addConnection` owns the
     * rules; this only speaks the answer.
     */
    const handlePortKeyDown = useCallback((e: React.KeyboardEvent) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('.oj-port[data-node-id][data-port-id]');
        if (!el) return;
        const nodeId = el.dataset.nodeId as string;

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const siblings = keyboardPorts().filter((candidate) => candidate.dataset.nodeId === nodeId);
            if (siblings.length < 2) return;
            e.preventDefault();
            e.stopPropagation();
            const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
            const index = siblings.indexOf(el);
            const next = siblings[(index + step + siblings.length) % siblings.length];
            rovingPort.current.set(nodeId, next.dataset.portId as string);
            applyRovingTabStops();
            next.focus();
            return;
        }

        if (e.key === 'Escape') {
            if (!useCanvasStore.getState().isConnecting) return;
            e.preventDefault();
            e.stopPropagation();
            stopConnecting();
            announce(CABLE_RELEASED);
            return;
        }

        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();

        const here = portModelOf(el);
        if (!here) return;

        if (!useCanvasStore.getState().isConnecting) {
            beginConnectionFrom(here.node, here.port.id);
            announce(`${here.port.name} armed. Move to another card's socket and press Enter to connect.`);
            return;
        }

        const result = completeConnectionAt(here.node, here.port.id);
        // A refusal keeps the cable in hand and says why; a landing says what it
        // did when it did something worth a sentence (a MOVE), and otherwise
        // lets the history announcement name the new connection.
        if (result.ok) announce(result.announcement ?? '');
        else announce(result.reason);
    }, [applyRovingTabStops, keyboardPorts, portModelOf, stopConnecting]);

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
                    <div className="nodes-layer" ref={nodesLayerRef} onKeyDown={handlePortKeyDown}>
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

            {/* ---------------------------------------------------------------
                UX-1B / HA-05 — THE EMPTY CANVAS. One block, nothing else in
                this file touches it.

                Deleting everything (or opening with a pre-answered profile) used
                to leave a page that said nothing at all: no copy, no
                affordance, no hint that right-click is how a node gets made. The
                only route out was a gesture with no on-screen twin, which is the
                definition of a secret. It speaks in the same voice the
                arrangement's empty page already uses (`ArrangementSurface.tsx`),
                and both buttons are the VISIBLE twins of hidden gestures: one
                opens the add-node menu at the middle of the paper, the other
                presses Ctrl+K itself, through the live keymap, so a rebound key
                is never advertised wrong.
                --------------------------------------------------------------- */}
            {nodes.size === 0 && !isConnecting && (
                <div className="node-canvas-empty">
                    <p className="node-canvas-empty__line">An empty canvas. Add a node — right-click, or Ctrl+K.</p>
                    <div className="node-canvas-empty__actions">
                        <button
                            type="button"
                            className="node-canvas-empty__button is-primary"
                            onClick={() => {
                                const rect = canvasRef.current?.getBoundingClientRect();
                                if (!rect) return;
                                setContextMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                            }}
                        >
                            Add a node
                        </button>
                        <button
                            type="button"
                            className="node-canvas-empty__button"
                            onClick={() => runAction('commandBar.toggle')}
                        >
                            Open the command bar
                        </button>
                    </div>
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu}
                    target={contextTarget}
                    verbs={canvasVerbs}
                    onClose={() => { setContextMenu(null); setContextTarget(null); }}
                    onOpenMIDIBrowser={handleOpenMIDIBrowser}
                />
            )}

            {/* The one polite live region for player verbs (U12). Portalled to
                the body from here because this component is always mounted, and
                a live region inside an `inert` surface goes quiet. */}
            <LiveAnnouncer />

            {/* Audio Clip Drag Layer (portal) */}
            <ClipDragLayer />

            {/* Waveform Editor Modal (portal) — mounted only while a clip is open
                for editing, so its lazy chunk loads on first edit, not first paint. */}
            {editingClipId && (
                <Suspense fallback={null}>
                    <WaveformEditorModal />
                </Suspense>
            )}

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
