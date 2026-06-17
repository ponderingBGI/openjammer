/**
 * useScrollCapture - A hook for capturing scroll/wheel events
 *
 * Properly prevents scroll events from propagating to parent elements (like the canvas)
 * while allowing custom handling for zoom, pan, or parameter adjustment.
 *
 * Key: Uses native addEventListener with { passive: false } to allow preventDefault(),
 * which React's onWheel doesn't support (passive by default).
 *
 * ## Common Mistakes & Solutions
 *
 * ### Mistake 1: Using capture=true (default) on scrollable dropdowns
 * - WRONG: `<ScrollContainer>` blocks native scroll inside dropdown
 * - RIGHT: `<ScrollContainer mode="dropdown">` allows native scroll, blocks canvas
 *
 * ### Mistake 2: Wrong scroll direction logic
 * - Trackpad "natural scrolling" and mouse wheel have OPPOSITE deltaY signs!
 * - Use the helper properties instead: scrollingUp, scrollingDown, scrollingLeft, scrollingRight
 */

import { useRef, useEffect, useState } from 'react';

// Normalization constant (typical trackpad scroll is ~100px per gesture)
const SCROLL_NORMALIZATION_FACTOR = 100;

/**
 * Scroll event data with normalized values and gesture detection
 */
export interface ScrollData {
    /** Raw horizontal delta (negative = left, positive = right) */
    deltaX: number;
    /** Raw vertical delta (negative = up, positive = down for mouse wheel) */
    deltaY: number;
    /** Normalized horizontal delta (-1 to 1) */
    normalizedDeltaX: number;
    /** Normalized vertical delta (-1 to 1) */
    normalizedDeltaY: number;

    // === Direction helpers (use these instead of raw deltas!) ===
    /** True when scrolling up (works correctly for both trackpad and mouse) */
    scrollingUp: boolean;
    /** True when scrolling down */
    scrollingDown: boolean;
    /** True when scrolling left */
    scrollingLeft: boolean;
    /** True when scrolling right */
    scrollingRight: boolean;

    /** Whether this is a pinch gesture (ctrlKey/metaKey - browsers report pinch this way) */
    isPinch: boolean;
    /** Whether scroll is primarily horizontal */
    isHorizontal: boolean;
    /** Whether scroll is primarily vertical */
    isVertical: boolean;

    /** Ctrl key held */
    ctrlKey: boolean;
    /** Meta/Cmd key held */
    metaKey: boolean;
    /** Shift key held */
    shiftKey: boolean;
    /** Alt/Option key held */
    altKey: boolean;
}

export interface UseScrollCaptureOptions {
    /**
     * Callback for handling scroll events.
     * If not provided, scroll is simply captured (contained within the element).
     */
    onScroll?: (data: ScrollData) => void;

    /**
     * Whether to prevent default browser scrolling behavior.
     *
     * - `true` (default): Blocks ALL scrolling including native overflow scroll.
     *   Use for custom scroll handling (zoom, pan, parameter adjustment).
     *
     * - `false`: Allows native scroll within the element, only stops propagation.
     *   Use for scrollable dropdowns/lists that need native overflow-y: auto.
     *
     * @default true
     */
    capture?: boolean;

    /**
     * Whether the hook is enabled. Useful for conditional scroll capture.
     * @default true
     */
    enabled?: boolean;

    /**
     * Sensitivity multiplier for normalized deltas.
     * Higher = more sensitive, lower = less sensitive.
     * @default 1
     */
    sensitivity?: number;
}

export interface UseScrollCaptureReturn<T extends HTMLElement = HTMLElement> {
    /**
     * Callback ref to attach to the element that should capture scroll events.
     * Can be used as ref={ref} in JSX.
     */
    ref: (node: T | null) => void;

    /**
     * Whether currently processing a scroll event (for visual feedback)
     */
    isCapturing: boolean;
}

/**
 * Hook for capturing scroll/wheel events with proper event prevention.
 *
 * @example Simple dropdown (native scroll, block canvas)
 * ```tsx
 * const { ref } = useScrollCapture({ capture: false });
 * return <div ref={ref} className="dropdown" style={{ overflowY: 'auto' }}>{items}</div>;
 * ```
 *
 * @example Zoom control (scroll up = zoom in)
 * ```tsx
 * const { ref } = useScrollCapture({
 *     onScroll: (data) => {
 *         if (data.scrollingUp) setZoom(z => Math.min(20, z + 0.5));
 *         if (data.scrollingDown) setZoom(z => Math.max(1, z - 0.5));
 *     }
 * });
 * ```
 *
 * @example Pan control (horizontal scroll)
 * ```tsx
 * const { ref } = useScrollCapture({
 *     onScroll: (data) => {
 *         if (data.isHorizontal) {
 *             if (data.scrollingRight) setOffset(o => o + 0.1);
 *             if (data.scrollingLeft) setOffset(o => o - 0.1);
 *         }
 *     }
 * });
 * ```
 *
 * @example Parameter adjustment (shift for fine control)
 * ```tsx
 * const { ref } = useScrollCapture({
 *     onScroll: (data) => {
 *         const step = data.shiftKey ? 0.1 : 1;
 *         if (data.scrollingUp) onChange(value + step);
 *         if (data.scrollingDown) onChange(value - step);
 *     },
 *     sensitivity: 0.5
 * });
 * ```
 */
export function useScrollCapture<T extends HTMLElement = HTMLElement>(
    options: UseScrollCaptureOptions = {}
): UseScrollCaptureReturn<T> {
    const {
        onScroll,
        capture = true,
        enabled = true,
        sensitivity = 1,
    } = options;

    // Use state to track the element so effect re-runs when it's attached
    const [element, setElement] = useState<T | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);

    // Callback ref that updates state when element is attached/detached
    const ref = useRef<T | null>(null);
    const setRef = (node: T | null) => {
        ref.current = node;
        setElement(node);
    };

    // Ref the latest callback + options so the attached listener stays stable
    // (avoids re-attaching on every render). Synced in an effect rather than
    // during render so the ref write is not a render-phase side effect.
    const onScrollRef = useRef(onScroll);
    const captureRef = useRef(capture);
    const sensitivityRef = useRef(sensitivity);
    useEffect(() => {
        onScrollRef.current = onScroll;
        captureRef.current = capture;
        sensitivityRef.current = sensitivity;
    });

    // Development warning for common mistakes
    useEffect(() => {
        if (process.env.NODE_ENV === 'development' && element) {
            const style = window.getComputedStyle(element);
            const hasOverflow = style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                               style.overflowX === 'auto' || style.overflowX === 'scroll';

            if (hasOverflow && captureRef.current) {
                console.warn(
                    '[useScrollCapture] Element has overflow scroll but capture={true} (default).\n' +
                    'This will block native scrolling inside the element.\n' +
                    'If you want native scroll inside (e.g., dropdown), use capture={false}.\n' +
                    'Element:', element
                );
            }
        }
    }, [element]);

    useEffect(() => {
        if (!element || !enabled) return;

        const handleWheel = (e: WheelEvent) => {
            // Always stop propagation to prevent canvas/parent handling
            e.stopPropagation();

            // Prevent default browser scrolling when capturing
            if (captureRef.current) {
                e.preventDefault();
            }

            setIsCapturing(true);

            // Detect pinch gesture (browsers report trackpad pinch as ctrl+wheel)
            const isPinch = e.ctrlKey || e.metaKey;

            // Direction helpers - deltaY > 0 means "scroll down" gesture (content moves up)
            // For zoom: "scroll up" (deltaY > 0 with natural scrolling) should zoom in
            const scrollingUp = e.deltaY > 0;
            const scrollingDown = e.deltaY < 0;
            const scrollingRight = e.deltaX > 0;
            const scrollingLeft = e.deltaX < 0;

            // Build normalized scroll data
            const scrollData: ScrollData = {
                deltaX: e.deltaX,
                deltaY: e.deltaY,
                normalizedDeltaX: Math.max(-1, Math.min(1,
                    (e.deltaX / SCROLL_NORMALIZATION_FACTOR) * sensitivityRef.current
                )),
                normalizedDeltaY: Math.max(-1, Math.min(1,
                    (e.deltaY / SCROLL_NORMALIZATION_FACTOR) * sensitivityRef.current
                )),
                scrollingUp,
                scrollingDown,
                scrollingLeft,
                scrollingRight,
                isPinch,
                isHorizontal: Math.abs(e.deltaX) > Math.abs(e.deltaY),
                isVertical: Math.abs(e.deltaY) >= Math.abs(e.deltaX),
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
            };

            // Call handler if provided
            onScrollRef.current?.(scrollData);

            // Reset capturing state after a brief delay
            requestAnimationFrame(() => setIsCapturing(false));
        };

        // CRITICAL: Use { passive: false } to allow preventDefault()
        // React's synthetic onWheel events are passive by default
        element.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            element.removeEventListener('wheel', handleWheel);
        };
    }, [element, enabled]);

    // Return callback ref (can be used as ref={ref} in JSX)
    return { ref: setRef, isCapturing };
}

export default useScrollCapture;
