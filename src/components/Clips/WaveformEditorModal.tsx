/**
 * WaveformEditorModal - Non-destructive audio clip editor
 *
 * Features:
 * - Click and drag to select a region
 * - Drag handles to adjust selection
 * - 50% opacity overlay on cropped regions
 * - Spacebar to preview selected region
 * - Clear waveform visualization
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { useAudioClipStore, getClipBuffer } from '../../store/audioClipStore';
import { getSampleFile } from '../../store/libraryStore';
import { getAudioContext } from '../../audio/audioContext';
import { useScrollCapture } from '../../hooks/useScrollCapture';
import type { ScrollData } from '../../hooks/useScrollCapture';
import { Button, Slider } from '@openjammer/oj-ui';
import './WaveformEditorModal.css';

// Preview audio state
let previewSource: AudioBufferSourceNode | null = null;

export const WaveformEditorModal = memo(function WaveformEditorModal() {
    const editingClipId = useAudioClipStore((s) => s.editingClipId);
    const clips = useAudioClipStore((s) => s.clips);
    const closeEditor = useAudioClipStore((s) => s.closeEditor);
    const updateCropRegion = useAudioClipStore((s) => s.updateCropRegion);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [scrollOffset, setScrollOffset] = useState(0); // 0-1 normalized scroll position
    const [isPlaying, setIsPlaying] = useState(false);

    // Crop handles state (normalized 0-1)
    const [startHandle, setStartHandle] = useState(0);
    const [endHandle, setEndHandle] = useState(1);

    // Drag state
    const [dragMode, setDragMode] = useState<'none' | 'start' | 'end' | 'select'>('none');
    const [dragStartX, setDragStartX] = useState(0);

    // Minimap drag state
    const [minimapDragging, setMinimapDragging] = useState(false);

    const clip = editingClipId ? clips.get(editingClipId) : null;

    // Load audio when clip changes
    useEffect(() => {
        if (!clip) {
            setAudioBuffer(null);
            return;
        }

        const loadAudio = async () => {
            setIsLoading(true);
            try {
                // First try buffer cache (for looper-originated clips)
                const cachedBuffer = getClipBuffer(clip.sampleId);
                if (cachedBuffer) {
                    setAudioBuffer(cachedBuffer);
                    // Set initial handles from clip crop region
                    const startNorm = clip.startFrame / cachedBuffer.length;
                    const endNorm = clip.endFrame === -1 ? 1 : clip.endFrame / cachedBuffer.length;
                    setStartHandle(startNorm);
                    setEndHandle(endNorm);
                    setIsLoading(false);
                    return;
                }

                // Otherwise load from sample library
                const file = await getSampleFile(clip.sampleId);
                if (file) {
                    const ctx = getAudioContext();
                    if (ctx) {
                        const arrayBuffer = await file.arrayBuffer();
                        const buffer = await ctx.decodeAudioData(arrayBuffer);
                        setAudioBuffer(buffer);

                        // Set initial handles from clip crop region
                        const startNorm = clip.startFrame / buffer.length;
                        const endNorm = clip.endFrame === -1 ? 1 : clip.endFrame / buffer.length;
                        setStartHandle(startNorm);
                        setEndHandle(endNorm);
                    }
                }
            } catch (error) {
                console.error('Failed to load audio for editor:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadAudio();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the specific clip fields read here; depending on the whole clip object would re-trigger audio decode on any unrelated clip identity change
    }, [clip?.sampleId, clip?.startFrame, clip?.endFrame]);

    // Draw waveform
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !audioBuffer) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const channelData = audioBuffer.getChannelData(0);

        // Clear canvas with dark background
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // Draw center line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Calculate visible range based on zoom and scroll
        const visibleRange = 1 / zoom; // How much of the waveform is visible (0-1)
        const maxScroll = 1 - visibleRange;
        const clampedScroll = Math.max(0, Math.min(maxScroll, scrollOffset));
        const viewStart = clampedScroll; // Start position in normalized coords
        const viewEnd = clampedScroll + visibleRange; // End position in normalized coords

        const totalSamples = channelData.length;
        const startSampleIndex = Math.floor(viewStart * totalSamples);
        const endSampleIndex = Math.floor(viewEnd * totalSamples);
        const visibleSamples = endSampleIndex - startSampleIndex;
        const samplesPerPixel = Math.max(1, Math.floor(visibleSamples / width));
        const middleY = height / 2;

        // Draw waveform with gradient based on amplitude
        for (let x = 0; x < width; x++) {
            const sampleStart = startSampleIndex + Math.floor((x / width) * visibleSamples);
            const sampleEnd = Math.min(sampleStart + samplesPerPixel, totalSamples);

            let min = 0, max = 0;
            for (let i = sampleStart; i < sampleEnd; i++) {
                const sample = channelData[i];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }

            const amplitude = Math.max(Math.abs(min), Math.abs(max));
            const minY = middleY + min * middleY * 0.9;
            const maxY = middleY + max * middleY * 0.9;

            // Color based on amplitude - brighter for louder parts
            const brightness = 0.4 + amplitude * 0.6;
            ctx.strokeStyle = `rgba(0, 212, 170, ${brightness})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, minY);
            ctx.lineTo(x, maxY);
            ctx.stroke();
        }

        // Convert handles from absolute (0-1) to view-relative coordinates
        const handleToViewX = (handle: number) => {
            return ((handle - viewStart) / visibleRange) * width;
        };

        const startX = handleToViewX(startHandle);
        const endX = handleToViewX(endHandle);

        // Draw 50% opacity overlay on cropped regions (clipped to visible area)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        if (startX > 0) {
            ctx.fillRect(0, 0, Math.max(0, startX), height);
        }
        if (endX < width) {
            ctx.fillRect(Math.min(width, endX), 0, width - Math.min(width, endX), height);
        }

        // Draw selection border (only if visible)
        if (startX < width && endX > 0) {
            ctx.strokeStyle = 'rgba(0, 212, 170, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(
                Math.max(0, startX),
                0,
                Math.min(width, endX) - Math.max(0, startX),
                height
            );
        }

        // Draw handles with larger grab area visual
        const handleWidth = 6;
        const handleColor = '#3b82f6';

        // Start handle (only if visible)
        if (startX >= -handleWidth && startX <= width + handleWidth) {
            ctx.fillStyle = handleColor;
            ctx.fillRect(startX - handleWidth / 2, 0, handleWidth, height);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(startX + i, height * 0.3);
                ctx.lineTo(startX + i, height * 0.7);
                ctx.stroke();
            }
        }

        // End handle (only if visible)
        if (endX >= -handleWidth && endX <= width + handleWidth) {
            ctx.fillStyle = handleColor;
            ctx.fillRect(endX - handleWidth / 2, 0, handleWidth, height);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            for (let i = -2; i <= 2; i++) {
                ctx.beginPath();
                ctx.moveTo(endX + i, height * 0.3);
                ctx.lineTo(endX + i, height * 0.7);
                ctx.stroke();
            }
        }

        // Draw time markers at bottom (adjusted for view)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '10px monospace';
        const duration = audioBuffer.duration;
        const viewDuration = visibleRange * duration;
        const viewStartTime = viewStart * duration;

        // Calculate appropriate marker interval based on visible duration
        const targetMarkers = 8;
        const rawInterval = viewDuration / targetMarkers;
        const niceIntervals = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60];
        const interval = niceIntervals.find(i => i >= rawInterval) || rawInterval;

        const firstMarker = Math.ceil(viewStartTime / interval) * interval;
        for (let t = firstMarker; t <= viewStartTime + viewDuration; t += interval) {
            const markerX = ((t - viewStartTime) / viewDuration) * width;
            if (markerX >= 0 && markerX <= width) {
                ctx.fillText(`${t.toFixed(1)}s`, markerX + 2, height - 4);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.beginPath();
                ctx.moveTo(markerX, height - 15);
                ctx.lineTo(markerX, height);
                ctx.stroke();
            }
        }

    }, [audioBuffer, zoom, scrollOffset, startHandle, endHandle]);

    // Draw minimap
    useEffect(() => {
        const canvas = minimapRef.current;
        if (!canvas || !audioBuffer) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;
        const channelData = audioBuffer.getChannelData(0);

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw simplified waveform
        const samplesPerPixel = Math.floor(channelData.length / width);
        const middleY = height / 2;

        for (let x = 0; x < width; x++) {
            const startSample = Math.floor(x * samplesPerPixel);
            const endSample = Math.min(startSample + samplesPerPixel, channelData.length);

            let min = 0, max = 0;
            for (let i = startSample; i < endSample; i++) {
                const sample = channelData[i];
                if (sample < min) min = sample;
                if (sample > max) max = sample;
            }

            const minY = middleY + min * middleY * 0.85;
            const maxY = middleY + max * middleY * 0.85;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, minY);
            ctx.lineTo(x, maxY);
            ctx.stroke();
        }

        // Draw viewport indicator (only when zoomed)
        if (zoom > 1) {
            const visibleRange = 1 / zoom;
            const maxScroll = 1 - visibleRange;
            const clampedScroll = Math.max(0, Math.min(maxScroll, scrollOffset));

            const viewportX = clampedScroll * width;
            const viewportWidth = visibleRange * width;

            // Draw viewport box
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(viewportX + 0.5, 0.5, viewportWidth - 1, height - 1);

            // Dim areas outside viewport
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(0, 0, viewportX, height);
            ctx.fillRect(viewportX + viewportWidth, 0, width - viewportX - viewportWidth, height);
        }

    }, [audioBuffer, zoom, scrollOffset]);

    // Minimap mouse handlers
    const handleMinimapMouseDown = useCallback((e: React.MouseEvent) => {
        if (zoom <= 1) return;

        const canvas = minimapRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) / rect.width;

        // Center viewport on click position
        const visibleRange = 1 / zoom;
        const newOffset = clickX - visibleRange / 2;
        const maxScroll = 1 - visibleRange;
        setScrollOffset(Math.max(0, Math.min(maxScroll, newOffset)));
        setMinimapDragging(true);
    }, [zoom]);

    const handleMinimapMouseMove = useCallback((e: React.MouseEvent) => {
        if (!minimapDragging || zoom <= 1) return;

        const canvas = minimapRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) / rect.width;

        const visibleRange = 1 / zoom;
        const newOffset = clickX - visibleRange / 2;
        const maxScroll = 1 - visibleRange;
        setScrollOffset(Math.max(0, Math.min(maxScroll, newOffset)));
    }, [minimapDragging, zoom]);

    const handleMinimapMouseUp = useCallback(() => {
        setMinimapDragging(false);
    }, []);

    // Get position from mouse event (normalized 0-1 in absolute coordinates)
    const getPositionFromEvent = useCallback((e: React.MouseEvent | MouseEvent): number => {
        const canvas = canvasRef.current;
        if (!canvas) return 0;
        const rect = canvas.getBoundingClientRect();
        const viewX = (e.clientX - rect.left) / rect.width; // 0-1 in view coordinates

        // Convert from view coordinates to absolute coordinates
        const visibleRange = 1 / zoom;
        const maxScroll = 1 - visibleRange;
        const clampedScroll = Math.max(0, Math.min(maxScroll, scrollOffset));

        const absoluteX = clampedScroll + viewX * visibleRange;
        return Math.max(0, Math.min(1, absoluteX));
    }, [zoom, scrollOffset]);

    // Handle mouse down - start drag or create new selection
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const x = getPositionFromEvent(e);
        // Adjust hit area based on zoom (smaller absolute area when zoomed in)
        const handleHitArea = 0.02 / zoom;

        // Check if clicking on start handle
        if (Math.abs(x - startHandle) < handleHitArea) {
            setDragMode('start');
            return;
        }

        // Check if clicking on end handle
        if (Math.abs(x - endHandle) < handleHitArea) {
            setDragMode('end');
            return;
        }

        // Start new selection
        setDragMode('select');
        setDragStartX(x);
        setStartHandle(x);
        setEndHandle(x);
    }, [startHandle, endHandle, getPositionFromEvent, zoom]);

    // Handle mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (dragMode === 'none') return;

        const x = getPositionFromEvent(e);

        if (dragMode === 'start') {
            setStartHandle(Math.min(x, endHandle - 0.005));
        } else if (dragMode === 'end') {
            setEndHandle(Math.max(x, startHandle + 0.005));
        } else if (dragMode === 'select') {
            // Update selection based on drag direction
            if (x < dragStartX) {
                setStartHandle(x);
                setEndHandle(dragStartX);
            } else {
                setStartHandle(dragStartX);
                setEndHandle(x);
            }
        }
    }, [dragMode, dragStartX, startHandle, endHandle, getPositionFromEvent]);

    // Handle mouse up
    const handleMouseUp = useCallback(() => {
        // Ensure minimum selection size
        if (endHandle - startHandle < 0.01) {
            setStartHandle(0);
            setEndHandle(1);
        }
        setDragMode('none');
    }, [startHandle, endHandle]);

    // Get cursor style based on position
    const getCursor = useCallback((e: React.MouseEvent): string => {
        if (dragMode !== 'none') return 'ew-resize';

        const x = getPositionFromEvent(e);
        const handleHitArea = 0.02 / zoom;

        if (Math.abs(x - startHandle) < handleHitArea || Math.abs(x - endHandle) < handleHitArea) {
            return 'ew-resize';
        }
        return 'crosshair';
    }, [dragMode, startHandle, endHandle, getPositionFromEvent, zoom]);

    const [cursorStyle, setCursorStyle] = useState('crosshair');

    const handleMouseMoveForCursor = useCallback((e: React.MouseEvent) => {
        setCursorStyle(getCursor(e));
        handleMouseMove(e);
    }, [getCursor, handleMouseMove]);

    // Handle scroll for zoom and pan (uses native event listener via hook)
    const handleScroll = useCallback((data: ScrollData) => {
        // Horizontal scroll = pan left/right (when zoomed)
        if (data.isHorizontal && zoom > 1) {
            const visibleRange = 1 / zoom;
            const maxScroll = 1 - visibleRange;
            const scrollDelta = (data.scrollingRight ? 1 : -1) * 0.05 * visibleRange;
            setScrollOffset(prev => Math.max(0, Math.min(maxScroll, prev + scrollDelta)));
        }
        // Vertical scroll = zoom in/out
        else if (data.isVertical) {
            // Use direction helpers for correct behavior on all devices
            const zoomDelta = data.scrollingUp ? 0.5 : -0.5;
            const newZoom = Math.max(1, Math.min(20, zoom + zoomDelta));

            // Zoom into center of current view
            const oldVisibleRange = 1 / zoom;
            const newVisibleRange = 1 / newZoom;
            const viewCenter = scrollOffset + oldVisibleRange / 2;
            const newScrollOffset = viewCenter - newVisibleRange / 2;
            const maxScroll = Math.max(0, 1 - newVisibleRange);

            setScrollOffset(Math.max(0, Math.min(maxScroll, newScrollOffset)));
            setZoom(newZoom);
        }
    }, [zoom, scrollOffset]);

    // Capture scroll events on the canvas container (uses native listener with { passive: false })
    const { ref: scrollContainerRef } = useScrollCapture<HTMLDivElement>({
        onScroll: handleScroll,
    });

    // Preview playback
    const handlePreview = useCallback(() => {
        if (!audioBuffer) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        // Stop any existing preview
        if (previewSource) {
            previewSource.stop();
            previewSource = null;
        }

        if (isPlaying) {
            setIsPlaying(false);
            return;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const startTime = startHandle * audioBuffer.duration;
        const duration = (endHandle - startHandle) * audioBuffer.duration;

        source.start(0, startTime, duration);
        source.onended = () => {
            setIsPlaying(false);
            previewSource = null;
        };

        previewSource = source;
        setIsPlaying(true);
    }, [audioBuffer, startHandle, endHandle, isPlaying]);

    // Apply crop
    const handleApply = useCallback(() => {
        if (!clip || !audioBuffer) return;

        const totalFrames = audioBuffer.length;
        const startFrame = Math.floor(startHandle * totalFrames);
        const endFrame = Math.floor(endHandle * totalFrames);

        updateCropRegion(clip.id, startFrame, endFrame === totalFrames ? -1 : endFrame);
        closeEditor();
    }, [clip, audioBuffer, startHandle, endHandle, updateCropRegion, closeEditor]);

    // Handle cancel
    const handleCancel = useCallback(() => {
        if (previewSource) {
            previewSource.stop();
            previewSource = null;
        }
        setIsPlaying(false);
        closeEditor();
    }, [closeEditor]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleCancel();
            } else if (e.code === 'Space') {
                e.preventDefault();
                handlePreview();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                handleApply();
            }
        };

        if (editingClipId) {
            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }
    }, [editingClipId, handleCancel, handlePreview, handleApply]);

    if (!editingClipId || !clip) {
        return null;
    }

    return createPortal(
        <div className="waveform-editor-overlay" onClick={handleCancel}>
            <div
                ref={containerRef}
                className="waveform-editor-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="waveform-editor-header">
                    <span className="waveform-editor-title">
                        Edit Clip: {clip.sampleName}
                    </span>
                    <Button variant="ghost" iconOnly onClick={handleCancel}>
                        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </Button>
                </div>

                <div className="waveform-editor-content">
                    <div ref={scrollContainerRef} className="waveform-editor-canvas-container">
                        {isLoading ? (
                            <div className="waveform-editor-loading">Loading audio...</div>
                        ) : (
                            <>
                                <canvas
                                    ref={canvasRef}
                                    className="waveform-editor-canvas"
                                    width={800}
                                    height={200}
                                    onMouseDown={handleMouseDown}
                                    onMouseMove={handleMouseMoveForCursor}
                                    onMouseUp={handleMouseUp}
                                    onMouseLeave={handleMouseUp}
                                    style={{ cursor: cursorStyle }}
                                />
                                {zoom > 1 && (
                                    <canvas
                                        ref={minimapRef}
                                        className="waveform-editor-minimap"
                                        width={400}
                                        height={24}
                                        onMouseDown={handleMinimapMouseDown}
                                        onMouseMove={handleMinimapMouseMove}
                                        onMouseUp={handleMinimapMouseUp}
                                        onMouseLeave={handleMinimapMouseUp}
                                        style={{ cursor: minimapDragging ? 'grabbing' : 'grab' }}
                                    />
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="waveform-editor-actions">
                    <Button
                        variant="ghost"
                        active={isPlaying}
                        onClick={handlePreview}
                        title="Space to play/stop"
                    >
                        {isPlaying ? '■ Stop' : '▶ Play'}
                    </Button>
                    <div className="waveform-editor-zoom-track">
                        <span className="waveform-editor-zoom-label">−</span>
                        <Slider
                            aria-label="Zoom"
                            min={1}
                            max={20}
                            step={0.1}
                            value={zoom}
                            onChange={(newZoom) => {
                                const oldVisibleRange = 1 / zoom;
                                const newVisibleRange = 1 / newZoom;
                                const viewCenter = scrollOffset + oldVisibleRange / 2;
                                const newScrollOffset = viewCenter - newVisibleRange / 2;
                                const maxScroll = Math.max(0, 1 - newVisibleRange);
                                setScrollOffset(Math.max(0, Math.min(maxScroll, newScrollOffset)));
                                setZoom(newZoom);
                            }}
                            className="waveform-editor-zoom"
                            title="Ctrl+scroll to zoom"
                        />
                        <span className="waveform-editor-zoom-label">+</span>
                    </div>
                    <Button variant="secondary" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleApply}>
                        Apply
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
});

export default WaveformEditorModal;
