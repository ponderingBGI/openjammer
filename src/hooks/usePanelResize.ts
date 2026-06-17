/**
 * usePanelResize - Hook for resizable internal panel separators
 *
 * Use this for draggable dividers between sections inside a node,
 * like the tag section separator in LibraryNode.
 *
 * @example
 * ```tsx
 * const { position, isDragging, handleSeparatorMouseDown, containerRef } = usePanelResize({
 *   nodeId: node.id,
 *   initialPosition: data.separatorPosition ?? 0.5,
 *   mode: 'percentage',
 *   min: 0.2,
 *   max: 0.8,
 *   direction: 'vertical',
 *   onPositionChange: (pos) => updateNodeData(node.id, { separatorPosition: pos }),
 * });
 *
 * return (
 *   <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column' }}>
 *     <div style={{ height: `${position * 100}%` }}>Top panel</div>
 *     <PanelSeparator onMouseDown={handleSeparatorMouseDown} direction="horizontal" />
 *     <div style={{ flex: 1 }}>Bottom panel</div>
 *   </div>
 * );
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SeparatorDirection = 'horizontal' | 'vertical';

export interface UsePanelResizeOptions {
  /** Node ID for debugging */
  nodeId: string;
  /** Initial separator position */
  initialPosition: number;
  /** 'percentage' for 0-1 normalized, 'pixels' for absolute pixel values */
  mode: 'percentage' | 'pixels';
  /** Minimum position (0.2 for percentage, or pixels) */
  min?: number;
  /** Maximum position (0.8 for percentage, or pixels) */
  max?: number;
  /** Direction of the separator: 'horizontal' (left/right panels) or 'vertical' (top/bottom) */
  direction: SeparatorDirection;
  /** Callback to persist position (called on mouseup) */
  onPositionChange: (position: number) => void;
  /** Enable debug warnings */
  debugMode?: boolean;
}

export interface UsePanelResizeReturn {
  /** Current position (in mode units) */
  position: number;
  /** Whether currently dragging the separator */
  isDragging: boolean;
  /** Handler to attach to separator element */
  handleSeparatorMouseDown: (e: React.MouseEvent) => void;
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function usePanelResize(options: UsePanelResizeOptions): UsePanelResizeReturn {
  const {
    nodeId,
    initialPosition,
    mode,
    min = mode === 'percentage' ? 0.1 : 50,
    max = mode === 'percentage' ? 0.9 : Infinity,
    direction,
    onPositionChange,
    debugMode = false,
  } = options;

  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track latest position for mouseup closure (avoids stale closure bug)
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Dev warnings
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && debugMode) {
      if (mode === 'percentage' && (initialPosition < 0 || initialPosition > 1)) {
        console.warn(`[usePanelResize] Node "${nodeId}": initialPosition (${initialPosition}) should be 0-1 for percentage mode`);
      }
      if (min >= max) {
        console.warn(`[usePanelResize] Node "${nodeId}": min (${min}) >= max (${max})`);
      }
    }
  }, [nodeId, mode, initialPosition, min, max, debugMode]);

  // Sync with external changes
  useEffect(() => {
    setPosition(initialPosition);
  }, [initialPosition]);

  // Constrain position to bounds
  const constrain = useCallback((pos: number) => {
    return Math.max(min, Math.min(max, pos));
  }, [min, max]);

  // Start drag handler
  const handleSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  // Mouse move and mouse up handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();

      let newPosition: number;

      if (direction === 'vertical') {
        // Vertical: separator moves up/down, position is based on Y
        if (mode === 'percentage') {
          newPosition = (e.clientY - rect.top) / rect.height;
        } else {
          newPosition = e.clientY - rect.top;
        }
      } else {
        // Horizontal: separator moves left/right, position is based on X
        if (mode === 'percentage') {
          newPosition = (e.clientX - rect.left) / rect.width;
        } else {
          newPosition = e.clientX - rect.left;
        }
      }

      setPosition(constrain(newPosition));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Commit to store using ref to get latest position (avoids stale closure)
      onPositionChange(positionRef.current);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, mode, constrain, onPositionChange]);

  return {
    position,
    isDragging,
    handleSeparatorMouseDown,
    containerRef,
  };
}
