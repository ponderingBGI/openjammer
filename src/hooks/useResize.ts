/**
 * useResize - Hook for making nodes resizable
 *
 * Provides zoom-aware resizing with all 8 handles (corners + edges).
 * Uses local state during drag for performance, commits to store on mouseup.
 *
 * @example
 * ```tsx
 * const { width, height, handleResizeStart, nodeRef, isResizing } = useResize({
 *   nodeId: node.id,
 *   initialWidth: data.width ?? 300,
 *   initialHeight: data.height ?? 200,
 *   minWidth: 200,
 *   minHeight: 150,
 *   onDimensionsChange: (w, h) => updateNodeData(node.id, { width: w, height: h }),
 * });
 *
 * return (
 *   <div ref={nodeRef} style={{ width, height }}>
 *     {content}
 *     <ResizeHandles onResizeStart={handleResizeStart} />
 *   </div>
 * );
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvasStore';

// All 8 resize handle positions
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export interface UseResizeOptions {
  /** Node ID for debugging/logging */
  nodeId: string;
  /** Initial width (from node.data or default) */
  initialWidth: number;
  /** Initial height (from node.data or default) */
  initialHeight: number;
  /** Minimum allowed width */
  minWidth?: number;
  /** Maximum allowed width */
  maxWidth?: number;
  /** Minimum allowed height */
  minHeight?: number;
  /** Maximum allowed height */
  maxHeight?: number;
  /** Optional aspect ratio to maintain (width/height) */
  aspectRatio?: number | null;
  /** Callback to persist dimensions (called on mouseup) */
  onDimensionsChange: (width: number, height: number) => void;
  /** Enable debug warnings for common mistakes */
  debugMode?: boolean;
  /** Whether resize is enabled (default: true) */
  enabled?: boolean;
}

export interface UseResizeReturn {
  /** Current width */
  width: number;
  /** Current height */
  height: number;
  /** Whether currently resizing */
  isResizing: boolean;
  /** Which handle is being dragged */
  activeHandle: ResizeHandle | null;
  /** Handler to attach to ResizeHandles component */
  handleResizeStart: (handle: ResizeHandle, e: React.MouseEvent) => void;
  /** Ref to attach to node container */
  nodeRef: React.RefObject<HTMLDivElement | null>;
}

// Helper to determine which directions a handle affects
function getHandleDirections(handle: ResizeHandle): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  switch (handle) {
    case 'n': return { x: 0, y: -1 };
    case 's': return { x: 0, y: 1 };
    case 'e': return { x: 1, y: 0 };
    case 'w': return { x: -1, y: 0 };
    case 'nw': return { x: -1, y: -1 };
    case 'ne': return { x: 1, y: -1 };
    case 'sw': return { x: -1, y: 1 };
    case 'se': return { x: 1, y: 1 };
  }
}

export function useResize(options: UseResizeOptions): UseResizeReturn {
  const {
    nodeId,
    initialWidth,
    initialHeight,
    minWidth = 100,
    maxWidth = Infinity,
    minHeight = 100,
    maxHeight = Infinity,
    aspectRatio = null,
    onDimensionsChange,
    debugMode = false,
    enabled = true,
  } = options;

  // Local state for smooth dragging
  const [dimensions, setDimensions] = useState({ width: initialWidth, height: initialHeight });
  const [isResizing, setIsResizing] = useState(false);
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null);

  // Refs for tracking drag state
  const nodeRef = useRef<HTMLDivElement>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startDimensions = useRef({ width: 0, height: 0 });
  const startNodePos = useRef({ x: 0, y: 0 });

  // Track latest dimensions for mouseup closure (avoids stale closure bug)
  const dimensionsRef = useRef(dimensions);
  useEffect(() => {
    dimensionsRef.current = dimensions;
  }, [dimensions]);

  // Get zoom for delta calculations
  const zoom = useCanvasStore(state => state.zoom);

  // Dev warnings
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && debugMode) {
      if (!minWidth) {
        console.warn(`[useResize] Node "${nodeId}": No minWidth set - node may collapse to 0px`);
      }
      if (!minHeight) {
        console.warn(`[useResize] Node "${nodeId}": No minHeight set - node may collapse to 0px`);
      }
      if (initialWidth < minWidth) {
        console.warn(`[useResize] Node "${nodeId}": initialWidth (${initialWidth}) < minWidth (${minWidth})`);
      }
      if (initialHeight < minHeight) {
        console.warn(`[useResize] Node "${nodeId}": initialHeight (${initialHeight}) < minHeight (${minHeight})`);
      }
    }
  }, [nodeId, minWidth, minHeight, initialWidth, initialHeight, debugMode]);

  // Sync with external changes (e.g., undo/redo)
  useEffect(() => {
    setDimensions({ width: initialWidth, height: initialHeight });
  }, [initialWidth, initialHeight]);

  // Constrain dimensions to bounds
  const constrain = useCallback((width: number, height: number) => {
    let w = Math.max(minWidth, Math.min(maxWidth, width));
    let h = Math.max(minHeight, Math.min(maxHeight, height));

    // Apply aspect ratio if set
    if (aspectRatio !== null) {
      const currentRatio = w / h;
      if (currentRatio > aspectRatio) {
        w = h * aspectRatio;
      } else {
        h = w / aspectRatio;
      }
      // Re-constrain after aspect ratio adjustment
      w = Math.max(minWidth, Math.min(maxWidth, w));
      h = Math.max(minHeight, Math.min(maxHeight, h));
    }

    return { width: w, height: h };
  }, [minWidth, maxWidth, minHeight, maxHeight, aspectRatio]);

  // Start resize handler
  const handleResizeStart = useCallback((handle: ResizeHandle, e: React.MouseEvent) => {
    if (!enabled) return;

    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    setActiveHandle(handle);
    startPos.current = { x: e.clientX, y: e.clientY };
    startDimensions.current = { ...dimensions };

    // Store node position for handles that move the node (n, w, nw, ne, sw)
    if (nodeRef.current) {
      const rect = nodeRef.current.getBoundingClientRect();
      startNodePos.current = { x: rect.left, y: rect.top };
    }
  }, [enabled, dimensions]);

  // Mouse move and mouse up handlers
  useEffect(() => {
    if (!isResizing || !activeHandle) return;

    const directions = getHandleDirections(activeHandle);

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate delta with zoom correction
      const dx = (e.clientX - startPos.current.x) / zoom;
      const dy = (e.clientY - startPos.current.y) / zoom;

      // Calculate new dimensions based on handle direction
      let newWidth = startDimensions.current.width;
      let newHeight = startDimensions.current.height;

      // East/West affects width
      if (directions.x === 1) {
        newWidth = startDimensions.current.width + dx;
      } else if (directions.x === -1) {
        newWidth = startDimensions.current.width - dx;
      }

      // North/South affects height
      if (directions.y === 1) {
        newHeight = startDimensions.current.height + dy;
      } else if (directions.y === -1) {
        newHeight = startDimensions.current.height - dy;
      }

      // Apply constraints
      const constrained = constrain(newWidth, newHeight);
      setDimensions(constrained);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setActiveHandle(null);
      // Commit to store using ref to get latest dimensions (avoids stale closure)
      onDimensionsChange(dimensionsRef.current.width, dimensionsRef.current.height);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, activeHandle, zoom, constrain, onDimensionsChange]);

  return {
    width: dimensions.width,
    height: dimensions.height,
    isResizing,
    activeHandle,
    handleResizeStart,
    nodeRef,
  };
}
