/**
 * AudioClipVisual - Lightweight visual component for audio clips
 *
 * Renders identically whether on canvas, in looper, in library, or being dragged.
 * Displays a mini waveform preview with the sample name below.
 */

import { useRef, useCallback, memo } from 'react';
import type { AudioClip } from '../../engine/types';
import { useAudioClipStore } from '../../store/audioClipStore';
import { formatSampleDuration } from '../../utils/audioMetadata';
import './AudioClipVisual.css';

interface AudioClipVisualProps {
    clip: AudioClip;
    isOnCanvas?: boolean;       // If true, absolutely positioned at clip.position
    isDragging?: boolean;       // Visual feedback during drag
    isSelected?: boolean;       // Selection highlight
    isDropTarget?: boolean;     // Being dragged over a valid drop target
    onDragStart?: (e: React.MouseEvent) => void;
    onDoubleClick?: () => void;
    style?: React.CSSProperties;
    className?: string;
}

/**
 * Truncate filename for display
 */
function truncateFilename(name: string, maxLength: number = 16): string {
    if (name.length <= maxLength) return name;

    // Find extension
    const dotIndex = name.lastIndexOf('.');
    const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
    const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;

    // Truncate base, keep extension
    const availableLength = maxLength - ext.length - 3; // 3 for "..."
    if (availableLength <= 0) {
        return name.slice(0, maxLength - 3) + '...';
    }

    return base.slice(0, availableLength) + '...' + ext;
}

export const AudioClipVisual = memo(function AudioClipVisual({
    clip,
    isOnCanvas = false,
    isDragging = false,
    isSelected = false,
    isDropTarget = false,
    onDragStart,
    onDoubleClick,
    style,
    className = '',
}: AudioClipVisualProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const openEditor = useAudioClipStore((s) => s.openEditor);

    // Handle double-click to open editor
    const handleDoubleClick = useCallback(() => {
        if (onDoubleClick) {
            onDoubleClick();
        } else {
            openEditor(clip.id);
        }
    }, [clip.id, onDoubleClick, openEditor]);

    // Handle mouse down for drag initiation
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Only left click
        if (e.button !== 0) return;

        // Prevent text selection and event bubbling to canvas
        e.preventDefault();
        e.stopPropagation();

        if (onDragStart) {
            onDragStart(e);
        }
    }, [onDragStart]);

    // Handle native HTML5 drag start for dropping onto library tags
    const handleNativeDragStart = useCallback((e: React.DragEvent) => {
        // Set clip data for library drops
        e.dataTransfer.setData('application/audio-clip', JSON.stringify({
            sampleId: clip.sampleId,
            sampleName: clip.sampleName,
            startFrame: clip.startFrame,
            endFrame: clip.endFrame,
            durationSeconds: clip.durationSeconds,
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
    }, [clip.sampleId, clip.sampleName, clip.startFrame, clip.endFrame, clip.durationSeconds]);

    // Calculate waveform points for SVG polyline
    const waveformPoints = clip.waveformPeaks.length > 1
        ? clip.waveformPeaks.map((v, i) =>
            `${(i / (clip.waveformPeaks.length - 1)) * 100},${10 - Math.abs(v) * 8}`
        ).join(' ')
        : '0,10 100,10'; // Flat line if no waveform data

    // Build class names
    const classNames = [
        'audio-clip',
        className,
        isOnCanvas && 'on-canvas',
        isDragging && 'dragging',
        isSelected && 'selected',
        isDropTarget && 'drop-target',
    ].filter(Boolean).join(' ');

    // Build inline styles
    const inlineStyle: React.CSSProperties = {
        ...style,
        width: clip.width,
        height: clip.height + 16, // Extra height for filename
    };

    // Position absolutely if on canvas
    if (isOnCanvas && clip.position) {
        inlineStyle.position = 'absolute';
        inlineStyle.left = clip.position.x;
        inlineStyle.top = clip.position.y;
    }

    // Determine if we're showing a cropped region
    const isCropped = clip.startFrame > 0 || clip.endFrame !== -1;

    return (
        <div
            ref={containerRef}
            className={classNames}
            style={inlineStyle}
            draggable
            onDragStart={handleNativeDragStart}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            data-clip-id={clip.id}
        >
            {/* Waveform container */}
            <div className="audio-clip-waveform">
                <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                    <polyline
                        className="audio-clip-waveform-path"
                        fill="none"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={waveformPoints}
                    />
                    {/* Center line */}
                    <line
                        x1="0"
                        y1="10"
                        x2="100"
                        y2="10"
                        className="audio-clip-center-line"
                    />
                </svg>

                {/* Crop indicators */}
                {isCropped && (
                    <div className="audio-clip-crop-indicator" title="Cropped region">
                        <svg viewBox="0 0 12 12" fill="currentColor">
                            <path d="M2 2v8l3-4-3-4zm5 0v8l3-4-3-4z" />
                        </svg>
                    </div>
                )}

                {/* Duration badge */}
                <span className="audio-clip-duration">
                    {formatSampleDuration(clip.durationSeconds)}
                </span>
            </div>

            {/* Filename */}
            <div className="audio-clip-name" title={clip.sampleName}>
                {truncateFilename(clip.sampleName)}
            </div>

            {/* Drag handle indicator (visible on hover) */}
            <div className="audio-clip-drag-handle">
                <svg viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="5" cy="4" r="1.5" />
                    <circle cx="11" cy="4" r="1.5" />
                    <circle cx="5" cy="8" r="1.5" />
                    <circle cx="11" cy="8" r="1.5" />
                    <circle cx="5" cy="12" r="1.5" />
                    <circle cx="11" cy="12" r="1.5" />
                </svg>
            </div>
        </div>
    );
});

export default AudioClipVisual;
