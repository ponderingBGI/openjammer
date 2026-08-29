/**
 * ScrollContainer - A wrapper component that captures scroll events
 *
 * Prevents scroll events from propagating to the canvas while allowing
 * either native scrolling or custom scroll handling.
 *
 * ## Quick Start
 *
 * ### For dropdowns/lists (native scroll inside, blocked from canvas):
 * ```tsx
 * <ScrollContainer mode="dropdown" className="my-dropdown">
 *     {items.map(item => <div key={item.id}>{item.label}</div>)}
 * </ScrollContainer>
 * ```
 *
 * ### For custom zoom/pan controls:
 * ```tsx
 * <ScrollContainer
 *     mode="custom"
 *     onScroll={(data) => {
 *         if (data.scrollingUp) zoomIn();
 *         if (data.scrollingDown) zoomOut();
 *     }}
 * >
 *     <canvas />
 * </ScrollContainer>
 * ```
 *
 * ## Mode Reference
 * - `dropdown`: Native scroll works inside, events don't reach canvas
 * - `custom`: Blocks all scroll, use onScroll for custom handling
 */

import React, { forwardRef, useCallback } from 'react';
import { useScrollCapture } from '../../hooks/useScrollCapture';
import type { ScrollData, UseScrollCaptureOptions } from '../../hooks/useScrollCapture';
import './ScrollContainer.css';

/** Re-export ScrollData for convenience */
export type { ScrollData } from '../../hooks/useScrollCapture';

export interface ScrollContainerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onScroll'> {
    /**
     * Child elements
     */
    children: React.ReactNode;

    /**
     * Preset mode for common use cases:
     *
     * - `dropdown`: For scrollable lists/dropdowns. Native scroll works inside,
     *   but events don't propagate to canvas. (capture=false)
     *
     * - `custom`: For zoom/pan/parameter controls. Blocks all default scroll,
     *   use onScroll callback for custom behavior. (capture=true)
     *
     * If not specified, defaults to `custom` when onScroll is provided,
     * otherwise `dropdown`.
     */
    mode?: 'dropdown' | 'custom';

    /**
     * Callback for custom scroll handling.
     * Use the helper properties for correct direction:
     * - data.scrollingUp / data.scrollingDown
     * - data.scrollingLeft / data.scrollingRight
     */
    onScroll?: (data: ScrollData) => void;

    /**
     * Manual override for capture behavior.
     * Usually you should use `mode` instead.
     *
     * - `true`: Blocks ALL scrolling including native overflow scroll
     * - `false`: Allows native scroll, only stops propagation to canvas
     */
    capture?: boolean;

    /**
     * Whether scroll capture is enabled
     * @default true
     */
    enabled?: boolean;

    /**
     * Sensitivity multiplier for normalized scroll values
     * @default 1
     */
    sensitivity?: number;
}

/**
 * A div wrapper that captures scroll events to prevent canvas panning.
 *
 * @example Dropdown with native scroll
 * ```tsx
 * <ScrollContainer mode="dropdown" className="dropdown-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
 *     {devices.map(d => <div key={d.id}>{d.label}</div>)}
 * </ScrollContainer>
 * ```
 *
 * @example Zoom control
 * ```tsx
 * <ScrollContainer
 *     mode="custom"
 *     onScroll={(data) => {
 *         if (data.scrollingUp) setZoom(z => z + 0.5);
 *         if (data.scrollingDown) setZoom(z => z - 0.5);
 *     }}
 * >
 *     <div className="zoomable-content">...</div>
 * </ScrollContainer>
 * ```
 *
 * @example Pan control (horizontal scroll)
 * ```tsx
 * <ScrollContainer
 *     mode="custom"
 *     onScroll={(data) => {
 *         if (data.isHorizontal) {
 *             setOffset(o => o + (data.scrollingRight ? 0.1 : -0.1));
 *         }
 *     }}
 * >
 *     <div className="pannable-content">...</div>
 * </ScrollContainer>
 * ```
 */
export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(
    function ScrollContainer(
        {
            children,
            mode,
            onScroll,
            capture,
            enabled = true,
            sensitivity = 1,
            className,
            ...divProps
        },
        forwardedRef
    ) {
        // Determine capture behavior:
        // 1. If capture is explicitly set, use it
        // 2. If mode is set, use mode's default
        // 3. If onScroll is provided, default to custom (capture=true)
        // 4. Otherwise, default to dropdown (capture=false)
        const resolvedCapture = capture ?? (
            mode === 'dropdown' ? false :
            mode === 'custom' ? true :
            onScroll ? true : false
        );

        const scrollOptions: UseScrollCaptureOptions = {
            onScroll,
            capture: resolvedCapture,
            enabled,
            sensitivity,
        };

        const { ref: scrollRef } = useScrollCapture<HTMLDivElement>(scrollOptions);

        // Merge the scroll capture callback ref with any forwarded ref
        const mergedRef = useCallback((node: HTMLDivElement | null) => {
            // Call scroll capture ref
            scrollRef(node);
            // Call forwarded ref
            if (typeof forwardedRef === 'function') {
                forwardedRef(node);
            } else if (forwardedRef) {
                forwardedRef.current = node;
            }
        }, [scrollRef, forwardedRef]);

        // `oj-scroll` carries the Firefox `scrollbar-color` (the WebKit rules are
        // global). Caller classes come after so they can still override anything.
        const classes = ['oj-scroll', className].filter(Boolean).join(' ');

        return (
            <div ref={mergedRef} className={classes} {...divProps}>
                {children}
            </div>
        );
    }
);

export default ScrollContainer;
