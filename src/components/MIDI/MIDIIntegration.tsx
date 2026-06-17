/**
 * MIDIIntegration - Global MIDI device detection and management
 *
 * Handles:
 * - MIDI initialization on mount
 * - Auto-reconnection to devices based on deviceSignature
 * - Auto-detect popup when new device connects (if no node exists)
 * - Adding MIDI nodes to the canvas with stable device signatures
 * - Preventing duplicate nodes for the same device
 * - Opening the MIDI device browser
 */

import { useEffect, useCallback, useRef } from 'react';
import { useMIDIStore } from '../../store/midiStore';
import { useGraphStore } from '../../store/graphStore';
import { useCanvasStore } from '../../store/canvasStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import { useMIDIConnectionToast } from './useMIDIConnectionToast';
import { MIDIDeviceBrowser } from './MIDIDeviceBrowser';
import { getPresetRegistry } from '../../midi';
import { initMidiVoiceRouting, disposeMidiVoiceRouting } from '../../midi/routing';
import type { NodeType, MIDIInputNodeData, MIDIDeviceSignature } from '../../engine/types';

/**
 * Map preset IDs to node types
 */
function getNodeTypeForPreset(presetId: string): NodeType {
    switch (presetId) {
        case 'arturia-minilab-3':
            return 'minilab-3';
        default:
            return 'midi';
    }
}

/**
 * Calculate canvas position from screen center, accounting for pan and zoom
 */
function getCanvasCenterPosition(): { x: number; y: number } {
    const { pan, zoom } = useCanvasStore.getState();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Convert screen center to canvas coordinates
    // Screen position = (canvasPosition * zoom) + pan
    // So: canvasPosition = (screenPosition - pan) / zoom
    const screenCenterX = viewportWidth / 2;
    const screenCenterY = viewportHeight / 2;

    return {
        x: (screenCenterX - pan.x) / zoom + (Math.random() * 100 - 50),
        y: (screenCenterY - pan.y) / zoom + (Math.random() * 100 - 50),
    };
}

export function MIDIIntegration() {
    // MIDI store state
    const isSupported = useMIDIStore((s) => s.isSupported);
    const isInitialized = useMIDIStore((s) => s.isInitialized);
    const initialize = useMIDIStore((s) => s.initialize);
    const pendingDevices = useMIDIStore((s) => s.pendingDevices);
    const browserTargetNodeId = useMIDIStore((s) => s.browserTargetNodeId);
    const inputs = useMIDIStore((s) => s.inputs);
    const generateDeviceName = useMIDIStore((s) => s.generateDeviceName);
    const getDeviceBySignature = useMIDIStore((s) => s.getDeviceBySignature);

    // Graph store for adding nodes
    const addNode = useGraphStore((s) => s.addNode);
    const updateNodeData = useGraphStore((s) => s.updateNodeData);
    const nodes = useGraphStore((s) => s.nodes);

    // Track which nodes we've already reconnected to prevent redundant processing
    const reconnectedNodesRef = useRef<Set<string>>(new Set());

    // Initialize MIDI on mount, cleanup on unmount
    useEffect(() => {
        if (isSupported && !isInitialized) {
            initialize();
        }

        // Start MIDI -> voice routing so device notes actually DRIVE instruments.
        // This was the missing wire: the MIDIVoiceRouter is implemented + unit-
        // tested, and `initMidiVoiceRouting` is documented as "the app calls once
        // at startup" — but nothing called it. So a MiniLab key lit its on-screen
        // key (via the separate midiStore subscription) yet no note reached the
        // executor/engine: no signal glow, no sound. Idempotent; torn down below.
        initMidiVoiceRouting();

        // Cleanup on unmount to prevent memory leaks and stale handlers
        return () => {
            disposeMidiVoiceRouting();
            useMIDIStore.getState().cleanup();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init/teardown (init is idempotent); adding isSupported/isInitialized/initialize would re-run MIDI initialization and the dispose-on-cleanup mid-session
    }, []); // Empty deps - only run on mount/unmount, init is idempotent

    // Auto-reconnect MIDI nodes when devices become available
    // Only runs when inputs change (device connected/disconnected) - not on every nodes change
    useEffect(() => {
        if (!isInitialized) return;

        // Get current nodes from store (don't need reactive updates here)
        const currentNodes = useGraphStore.getState().nodes;

        // Find all MIDI nodes that have signatures but are disconnected
        for (const node of currentNodes.values()) {
            // Only process MIDI-related node types
            if (node.type !== 'midi' && node.type !== 'minilab-3') continue;

            const data = node.data as MIDIInputNodeData;
            if (!data?.deviceSignature) continue;

            // Skip if already connected
            if (data.isConnected && data.deviceId) {
                reconnectedNodesRef.current.add(node.id);
                continue;
            }

            // Clear from tracking if disconnected (device was removed)
            if (reconnectedNodesRef.current.has(node.id)) {
                reconnectedNodesRef.current.delete(node.id);
            }

            // Try to find a matching device
            const device = getDeviceBySignature(data.deviceSignature);
            if (device) {
                reconnectedNodesRef.current.add(node.id);
                updateNodeData(node.id, {
                    deviceId: device.id,
                    isConnected: true,
                });
            }
        }
    }, [isInitialized, inputs, getDeviceBySignature, updateNodeData]);

    // Check if a device already has a node on the canvas (by deviceId or signature)
    const deviceHasNode = useCallback((deviceId: string): boolean => {
        for (const node of nodes.values()) {
            if (node.data?.deviceId === deviceId) {
                return true;
            }
        }
        return false;
    }, [nodes]);

    // Check if a signature already has a node on the canvas and return the node ID
    const findNodeBySignature = useCallback((presetId: string, deviceName: string): string | null => {
        for (const node of nodes.values()) {
            const sig = (node.data as MIDIInputNodeData)?.deviceSignature;
            if (sig?.presetId === presetId && sig?.deviceName === deviceName) {
                return node.id;
            }
        }
        return null;
    }, [nodes]);

    // Find existing node by deviceId
    const findNodeByDeviceId = useCallback((deviceId: string): string | null => {
        for (const node of nodes.values()) {
            if (node.data?.deviceId === deviceId) {
                return node.id;
            }
        }
        return null;
    }, [nodes]);

    // Check if any pending device already has a node - auto-dismiss handled in hook
    // Filter out devices that already have nodes by dismissing them
    useEffect(() => {
        pendingDevices.forEach((_, deviceId) => {
            if (deviceHasNode(deviceId)) {
                useMIDIStore.getState().dismissPendingDevice(deviceId);
            }
        });
    }, [pendingDevices, deviceHasNode]);

    // Lock to prevent duplicate node creation from rapid clicks
    const isCreatingNodeRef = useRef(false);

    // Handle adding a device from the auto-detect toast or browser
    // Returns true if node was created, false if duplicate was detected
    const handleAddDevice = useCallback((deviceId: string, presetId: string): boolean => {
        // Prevent rapid double-clicks
        if (isCreatingNodeRef.current) return false;

        // Check if device already has a node (by deviceId)
        const existingByDeviceId = findNodeByDeviceId(deviceId);
        if (existingByDeviceId) {
            useUIFeedbackStore.getState().flashNode(existingByDeviceId);
            return false;
        }

        // Get preset name for auto-naming
        const registry = getPresetRegistry();
        const preset = registry.getPreset(presetId);
        const presetName = preset?.name || 'MIDI Device';

        // Generate device name (auto-names like "MiniLab 3", "MiniLab 3 2", etc.)
        const deviceName = generateDeviceName(deviceId, presetId, presetName);

        // Check if this signature already has a node
        const existingBySignature = findNodeBySignature(presetId, deviceName);
        if (existingBySignature) {
            useUIFeedbackStore.getState().flashNode(existingBySignature);
            return false;
        }

        isCreatingNodeRef.current = true;

        try {
            // Create signature for stable identification
            const deviceSignature: MIDIDeviceSignature = {
                presetId,
                deviceName,
            };

            // Get node type based on preset
            const nodeType = getNodeTypeForPreset(presetId);

            // Calculate position - center of canvas view with some randomness
            const position = getCanvasCenterPosition();

            // Add the node to the canvas with stable signature
            addNode(nodeType, position, null, {
                deviceId,
                deviceSignature,
                presetId,
                isConnected: true,
                activeChannel: 0,
            });
            return true;
        } finally {
            isCreatingNodeRef.current = false;
        }
    }, [addNode, generateDeviceName, findNodeBySignature, findNodeByDeviceId]);

    // Handle selecting a device from the browser
    // Returns true if node was created/updated, false if duplicate was detected
    const handleSelectDevice = useCallback((deviceId: string | null, presetId: string): boolean => {
        // If we have a target node (opened browser from existing MIDI node), update that node
        if (browserTargetNodeId) {
            // Validate target node still exists (could have been deleted while browser was open)
            const targetNode = nodes.get(browserTargetNodeId);
            if (targetNode) {
                if (deviceId) {
                    // Switching to a new device, update signature too
                    const registry = getPresetRegistry();
                    const preset = registry.getPreset(presetId);
                    const presetName = preset?.name || 'MIDI Device';
                    const deviceName = generateDeviceName(deviceId, presetId, presetName);

                    updateNodeData(browserTargetNodeId, {
                        deviceId,
                        deviceSignature: { presetId, deviceName },
                        presetId,
                        isConnected: true,
                    });
                } else {
                    updateNodeData(browserTargetNodeId, {
                        deviceId: null,
                        isConnected: false,
                    });
                }
                return true; // Update succeeded
            }
            // Node was deleted while browser was open, fall through to create new node
        }

        // Otherwise, create a new node
        if (!deviceId) return false; // Don't create node without device

        // Check if device already has a node (by deviceId)
        const existingByDeviceId = findNodeByDeviceId(deviceId);
        if (existingByDeviceId) {
            useUIFeedbackStore.getState().flashNode(existingByDeviceId);
            return false;
        }

        const registry = getPresetRegistry();
        const preset = registry.getPreset(presetId);
        const presetName = preset?.name || 'MIDI Device';
        const deviceName = generateDeviceName(deviceId, presetId, presetName);

        // Check if this signature already has a node
        const existingBySignature = findNodeBySignature(presetId, deviceName);
        if (existingBySignature) {
            useUIFeedbackStore.getState().flashNode(existingBySignature);
            return false;
        }

        // Prevent rapid double-clicks
        if (isCreatingNodeRef.current) return false;
        isCreatingNodeRef.current = true;

        try {
            const deviceSignature: MIDIDeviceSignature = {
                presetId,
                deviceName,
            };

            const nodeType = getNodeTypeForPreset(presetId);
            const position = getCanvasCenterPosition();

            addNode(nodeType, position, null, {
                deviceId,
                deviceSignature,
                presetId,
                isConnected: true,
                activeChannel: 0,
            });
            return true;
        } finally {
            isCreatingNodeRef.current = false;
        }
    }, [browserTargetNodeId, nodes, addNode, updateNodeData, generateDeviceName, findNodeBySignature, findNodeByDeviceId]);

    // Use the MIDI connection toast hook to show Sonner toasts
    useMIDIConnectionToast(handleAddDevice);

    return (
        <>
            {/* MIDI Device Browser */}
            <MIDIDeviceBrowser onSelectDevice={handleSelectDevice} />
        </>
    );
}
