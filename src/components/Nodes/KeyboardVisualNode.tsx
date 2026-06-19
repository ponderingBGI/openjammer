/**
 * Keyboard Visual Node - Full visual keyboard with per-key outputs
 *
 * Used inside the keyboard node's internal canvas (level 1)
 * Shows a visual keyboard layout with Q-P, A-L, Z-/ rows and spacebar
 * Each key has its own output port that can be connected to different outputs
 */

import { useAudioStore } from '../../store/audioStore';
import { useUIFeedbackStore } from '../../store/uiFeedbackStore';
import type { GraphNode } from '../../engine/types';
import { KeyTile } from '@openjammer/oj-ui';
import './SchematicNodes.css';

// Lock each KeyTile to the original square-key footprint (visual no-op vs the
// legacy 50x50 .keyboard-visual-key). The spacebar keeps its wide 300px form.
const KEY_SIZE: React.CSSProperties = { width: 50, height: 50 };
const SPACEBAR_SIZE: React.CSSProperties = { width: 300, height: 50 };

interface KeyboardVisualNodeProps {
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
    style?: React.CSSProperties;
}

// Keyboard layout
const ROW_1_KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
const ROW_2_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
const ROW_3_KEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'];

// Map display characters to port IDs
const getPortId = (key: string): string => {
    const keyMap: Record<string, string> = {
        ',': 'key-comma',
        '.': 'key-period',
        '/': 'key-slash'
    };
    return keyMap[key] || `key-${key.toLowerCase()}`;
};

export function KeyboardVisualNode({
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
}: KeyboardVisualNodeProps) {
    const activeKeys = useAudioStore((s) => s.activeKeys);
    const controlDown = useAudioStore((s) => s.controlDown);
    const flashingNodes = useUIFeedbackStore((s) => s.flashingNodes);
    const isFlashing = flashingNodes.has(node.id);

    // Check if a key is currently pressed
    const isKeyActive = (key: string): boolean => {
        // Active keys are stored as "nodeId-row-keyIndex"
        // For visual keyboard, we check by key letter
        const keyLower = key.toLowerCase();
        for (const activeKey of activeKeys) {
            // Parse the active key format
            const parts = activeKey.split('-');
            if (parts.length >= 3) {
                const row = parseInt(parts[parts.length - 2]);
                const keyIndex = parseInt(parts[parts.length - 1]);

                // Check if this matches our key
                if (row === 1 && ROW_1_KEYS[keyIndex]?.toLowerCase() === keyLower) return true;
                if (row === 2 && ROW_2_KEYS[keyIndex]?.toLowerCase() === keyLower) return true;
                if (row === 3 && ROW_3_KEYS[keyIndex]?.toLowerCase() === keyLower) return true;
            }
        }
        return false;
    };

    const isSpaceActive = (): boolean => {
        // Space is tracked via controlDown in audio store (now properly subscribed)
        return controlDown;
    };

    const renderKey = (key: string, _row: number) => {
        const portId = getPortId(key);
        const isActive = isKeyActive(key);
        const isConnected = hasConnection?.(portId);

        return (
            <KeyTile
                key={portId}
                variant="key"
                label={key}
                active={isActive}
                connected={!!isConnected}
                className="keyboard-visual-key"
                style={KEY_SIZE}
                title={`${key} → ${portId}`}
                data-node-id={node.id}
                data-port-id={portId}
                data-port-type="control"
                onMouseDown={(e) => handlePortMouseDown?.(portId, e)}
                onMouseUp={(e) => handlePortMouseUp?.(portId, e)}
                onMouseEnter={() => handlePortMouseEnter?.(portId)}
                onMouseLeave={handlePortMouseLeave}
            />
        );
    };

    return (
        <div
            className={`keyboard-visual-node schematic-node ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isFlashing ? 'flashing' : ''}`}
            style={style}
            onMouseEnter={handleNodeMouseEnter}
            onMouseLeave={handleNodeMouseLeave}
        >
            {/* Header */}
            <div
                className="schematic-header keyboard-visual-header"
                onMouseDown={handleHeaderMouseDown}
            >
                <span className="schematic-title">Keyboard</span>
            </div>

            {/* Keyboard Body */}
            <div className="keyboard-visual-body">
                {/* Row 1: Q-P */}
                <div className="keyboard-row row-1">
                    {ROW_1_KEYS.map((key) => renderKey(key, 1))}
                </div>

                {/* Row 2: A-L (indented) */}
                <div className="keyboard-row row-2">
                    {ROW_2_KEYS.map((key) => renderKey(key, 2))}
                </div>

                {/* Row 3: Z-/ (more indented) */}
                <div className="keyboard-row row-3">
                    {ROW_3_KEYS.map((key) => renderKey(key, 3))}
                </div>

                {/* Spacebar */}
                <div className="keyboard-row row-space">
                    <KeyTile
                        variant="key"
                        label="SPACE"
                        active={isSpaceActive()}
                        connected={!!hasConnection?.('key-space')}
                        className="keyboard-visual-key spacebar"
                        style={SPACEBAR_SIZE}
                        title="Space → key-space"
                        data-node-id={node.id}
                        data-port-id="key-space"
                        data-port-type="control"
                        onMouseDown={(e) => handlePortMouseDown?.('key-space', e)}
                        onMouseUp={(e) => handlePortMouseUp?.('key-space', e)}
                        onMouseEnter={() => handlePortMouseEnter?.('key-space')}
                        onMouseLeave={handlePortMouseLeave}
                    />
                </div>
            </div>
        </div>
    );
}
