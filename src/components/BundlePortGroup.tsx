/**
 * BundlePortGroup - Expandable/collapsible bundle port component
 *
 * Displays a bundle port that can be:
 * - Collapsed: Shows "MiniLab3 Keys (25)" with disclosure triangle
 * - Expanded: Shows all 25 individual channel ports
 *
 * Used inside InputPanelNode to show incoming bundle connections.
 */

import { useState, useCallback, useEffect, memo } from 'react';
import type { BundlePortDefinition } from '../engine/types';
import { ScrollContainer } from './common/ScrollContainer';
import './BundlePortGroup.css';

interface BundlePortGroupProps {
    /** The bundle port with bundleInfo */
    port: BundlePortDefinition;

    /** Node ID for port events */
    nodeId: string;

    /** Whether port labels are on the left (input panel) or right (output panel) */
    labelPosition: 'left' | 'right';

    /** Port event handlers */
    handlePortMouseDown?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseUp?: (portId: string, e: React.MouseEvent) => void;
    handlePortMouseEnter?: (portId: string) => void;
    handlePortMouseLeave?: () => void;

    /** Check if a port has a connection */
    hasConnection?: (portId: string) => boolean;

    /** Callback when bundle expansion is toggled */
    onToggleExpand?: (portId: string, expanded: boolean) => void;
}

export const BundlePortGroup = memo(function BundlePortGroup({
    port,
    nodeId,
    labelPosition,
    handlePortMouseDown,
    handlePortMouseUp,
    handlePortMouseEnter,
    handlePortMouseLeave,
    hasConnection,
    onToggleExpand
}: BundlePortGroupProps) {
    const bundleInfo = port.bundleInfo;

    // Local expansion state (synced with bundleInfo.expanded prop)
    const [isExpanded, setIsExpanded] = useState(bundleInfo?.expanded ?? false);

    // Sync local state when prop changes
    useEffect(() => {
        if (bundleInfo?.expanded !== undefined) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop→state sync: mirrors the controlled bundleInfo.expanded into local state, only when the prop changes
            setIsExpanded(bundleInfo.expanded);
        }
    }, [bundleInfo?.expanded]);

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const newExpanded = !isExpanded;
        setIsExpanded(newExpanded);
        onToggleExpand?.(port.id, newExpanded);
    }, [isExpanded, port.id, onToggleExpand]);

    if (!bundleInfo) {
        // Not a bundle port, render nothing (shouldn't happen)
        return null;
    }

    const channelCount = bundleInfo.channels.length;
    const isConnected = hasConnection?.(port.id);

    // Render collapsed view
    if (!isExpanded) {
        return (
            <div className={`bundle-port-group collapsed ${labelPosition}`}>
                <div className="bundle-port-row">
                    {/* Disclosure triangle + label on left for input panel */}
                    {labelPosition === 'left' && (
                        <>
                            <button
                                className="bundle-expand-button"
                                onClick={handleToggle}
                                aria-label={`Expand ${bundleInfo.bundleLabel}`}
                                aria-expanded={false}
                            >
                                <span className="bundle-triangle">&#9654;</span>
                            </button>
                            <span className="bundle-label" title={bundleInfo.bundleLabel}>
                                {bundleInfo.bundleLabel}
                                <span className="bundle-count">({channelCount})</span>
                            </span>
                        </>
                    )}

                    {/* Port marker */}
                    <div
                        className={`bundle-port-marker ${port.type}-port ${port.direction}-port ${isConnected ? 'connected' : ''}`}
                        data-node-id={nodeId}
                        data-port-id={port.id}
                        data-port-type={port.type}
                        role="button"
                        tabIndex={0}
                        aria-label={`${bundleInfo.bundleLabel} bundle port`}
                        onMouseDown={(e) => handlePortMouseDown?.(port.id, e)}
                        onMouseUp={(e) => handlePortMouseUp?.(port.id, e)}
                        onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                        onMouseLeave={handlePortMouseLeave}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handlePortMouseDown?.(port.id, e as unknown as React.MouseEvent);
                            }
                        }}
                    />

                    {/* Disclosure triangle + label on right for output panel */}
                    {labelPosition === 'right' && (
                        <>
                            <span className="bundle-label" title={bundleInfo.bundleLabel}>
                                {bundleInfo.bundleLabel}
                                <span className="bundle-count">({channelCount})</span>
                            </span>
                            <button
                                className="bundle-expand-button"
                                onClick={handleToggle}
                                aria-label={`Expand ${bundleInfo.bundleLabel}`}
                                aria-expanded={false}
                            >
                                <span className="bundle-triangle">&#9654;</span>
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    // Render expanded view
    return (
        <div className={`bundle-port-group expanded ${labelPosition}`}>
            {/* Bundle header with collapse button */}
            <div className="bundle-port-row bundle-header">
                {labelPosition === 'left' && (
                    <>
                        <button
                            className="bundle-expand-button expanded"
                            onClick={handleToggle}
                            aria-label={`Collapse ${bundleInfo.bundleLabel}`}
                            aria-expanded={true}
                        >
                            <span className="bundle-triangle">&#9660;</span>
                        </button>
                        <span className="bundle-label" title={bundleInfo.bundleLabel}>
                            {bundleInfo.bundleLabel}
                            <span className="bundle-count">({channelCount})</span>
                        </span>
                    </>
                )}

                {/* Main bundle port marker */}
                <div
                    className={`bundle-port-marker ${port.type}-port ${port.direction}-port ${isConnected ? 'connected' : ''}`}
                    data-node-id={nodeId}
                    data-port-id={port.id}
                    data-port-type={port.type}
                    role="button"
                    tabIndex={0}
                    aria-label={`${bundleInfo.bundleLabel} bundle port`}
                    onMouseDown={(e) => handlePortMouseDown?.(port.id, e)}
                    onMouseUp={(e) => handlePortMouseUp?.(port.id, e)}
                    onMouseEnter={() => handlePortMouseEnter?.(port.id)}
                    onMouseLeave={handlePortMouseLeave}
                />

                {labelPosition === 'right' && (
                    <>
                        <span className="bundle-label" title={bundleInfo.bundleLabel}>
                            {bundleInfo.bundleLabel}
                            <span className="bundle-count">({channelCount})</span>
                        </span>
                        <button
                            className="bundle-expand-button expanded"
                            onClick={handleToggle}
                            aria-label={`Collapse ${bundleInfo.bundleLabel}`}
                            aria-expanded={true}
                        >
                            <span className="bundle-triangle">&#9660;</span>
                        </button>
                    </>
                )}
            </div>

            {/* Individual channel rows */}
            <ScrollContainer mode="dropdown" className="bundle-channels">
                {bundleInfo.channels.map((channel, index) => (
                    <div
                        key={channel.id}
                        className={`bundle-channel-row ${labelPosition}`}
                    >
                        {labelPosition === 'left' && (
                            <>
                                <span className="bundle-channel-indent" />
                                <span className="bundle-channel-connector">
                                    {index === channelCount - 1 ? '└' : '├'}
                                </span>
                                <span className="bundle-channel-label" title={channel.label}>
                                    {channel.label}
                                </span>
                            </>
                        )}

                        {/* Channel port marker (visual only in expanded view) */}
                        <div
                            className={`bundle-channel-marker ${port.type}-port ${port.direction}-port`}
                            data-channel-id={channel.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${channel.label} channel`}
                        />

                        {labelPosition === 'right' && (
                            <>
                                <span className="bundle-channel-label" title={channel.label}>
                                    {channel.label}
                                </span>
                                <span className="bundle-channel-connector">
                                    {index === channelCount - 1 ? '┘' : '┤'}
                                </span>
                                <span className="bundle-channel-indent" />
                            </>
                        )}
                    </div>
                ))}
            </ScrollContainer>
        </div>
    );
});

export default BundlePortGroup;
