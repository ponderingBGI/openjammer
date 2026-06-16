/**
 * Audio Clip Utilities
 *
 * Helper functions for creating, loading, and manipulating audio clips.
 * These enable the drag-and-drop flow between looper, library, and canvas.
 */

import type { AudioClip } from '../engine/types';
import type { Loop } from '../audio/executor';
import { useLibraryStore, getSampleFile, type LibraryItem } from '../store/libraryStore';
import { logWarn } from './log';

// Re-export async waveform generation for non-blocking execution
export { generateWaveformPeaksAsync } from '../workers/waveformWorkerClient';

// ============================================================================
// Clip Creation
// ============================================================================

/**
 * Create an AudioClip from a Looper loop
 *
 * This is used when dragging a loop out of the LooperNode onto the canvas.
 * The loop must have already been saved to the sample library with a sampleId.
 */
export function createClipFromLoop(
    loop: Loop,
    sampleId: string,
    sampleName: string,
    sourceNodeId: string
): AudioClip | null {
    const buffer = loop.buffer;
    if (!buffer) {
        logWarn('clips', 'Cannot create clip from loop with null buffer');
        return null;
    }

    const now = Date.now();

    return {
        id: `clip-${now}-${Math.random().toString(36).substr(2, 9)}`,
        sampleId,
        sampleName,
        startFrame: 0,
        endFrame: -1, // -1 means end of file
        durationSeconds: buffer.duration,
        sampleRate: buffer.sampleRate,
        waveformPeaks: downsampleWaveform(loop.waveformData, 64),
        position: null, // Will be set when placed on canvas
        width: 120,
        height: 40,
        sourceType: 'looper',
        sourceNodeId,
        createdAt: now,
        lastModifiedAt: now,
    };
}

/**
 * Create an AudioClip from a library sample
 *
 * This is used when dragging a sample from the LibraryNode onto the canvas.
 */
export function createClipFromSample(
    sample: LibraryItem,
    waveformData: number[] | Float32Array,
    sourceNodeId?: string
): AudioClip {
    const now = Date.now();

    // Convert Float32Array to number[] if needed
    const peaks = waveformData instanceof Float32Array
        ? Array.from(waveformData)
        : waveformData;

    return {
        id: `clip-${now}-${Math.random().toString(36).substr(2, 9)}`,
        sampleId: sample.id,
        sampleName: sample.fileName,
        startFrame: 0,
        endFrame: -1,
        durationSeconds: sample.duration,
        sampleRate: sample.sampleRate,
        waveformPeaks: downsampleWaveform(peaks, 64),
        position: null,
        width: 120,
        height: 40,
        sourceType: 'library',
        sourceNodeId,
        createdAt: now,
        lastModifiedAt: now,
    };
}

/**
 * Create an AudioClip from an imported AudioBuffer
 *
 * This is used for audio imported directly (not from library or looper).
 */
export function createClipFromBuffer(
    buffer: AudioBuffer,
    sampleId: string,
    sampleName: string
): AudioClip {
    const now = Date.now();
    const waveformPeaks = generateWaveformPeaks(buffer, 64);

    return {
        id: `clip-${now}-${Math.random().toString(36).substr(2, 9)}`,
        sampleId,
        sampleName,
        startFrame: 0,
        endFrame: -1,
        durationSeconds: buffer.duration,
        sampleRate: buffer.sampleRate,
        waveformPeaks,
        position: null,
        width: 120,
        height: 40,
        sourceType: 'imported',
        createdAt: now,
        lastModifiedAt: now,
    };
}

// ============================================================================
// Audio Loading
// ============================================================================

/**
 * Load the audio for a clip, applying crop region
 *
 * Returns a new AudioBuffer containing only the cropped portion.
 * The original sample in the library is never modified.
 */
export async function loadClipAudio(
    clip: AudioClip,
    audioContext: AudioContext
): Promise<AudioBuffer> {
    // Get item from library
    const store = useLibraryStore.getState();
    const item = store.items[clip.sampleId];

    if (!item) {
        throw new Error(`Item not found: ${clip.sampleId}`);
    }

    // Handle virtual items - resolve to parent file and apply crop
    let fileItemId = clip.sampleId;
    let cropStart = clip.startFrame;
    let cropEnd = clip.endFrame;

    if (item.isVirtual && item.parentItemId) {
        const parentItem = store.items[item.parentItemId];
        if (!parentItem) {
            throw new Error(`Parent item not found: ${item.parentItemId}`);
        }
        fileItemId = item.parentItemId;

        // Get the virtual item's crop region
        const virtualStart = item.cropStartFrame ?? 0;
        const virtualEnd = item.cropEndFrame ?? -1;

        // Combine clip crop with virtual item crop
        // Clip's crop is relative to the virtual item, not the parent
        cropStart = virtualStart + clip.startFrame;
        if (clip.endFrame === -1) {
            cropEnd = virtualEnd;
        } else {
            cropEnd = virtualStart + clip.endFrame;
            // Clamp to virtual item's end if defined
            if (virtualEnd !== -1 && cropEnd > virtualEnd) {
                cropEnd = virtualEnd;
            }
        }
    }

    // Load full audio buffer from actual file
    const file = await getSampleFile(fileItemId);
    if (!file) {
        throw new Error(`Could not load sample file: ${fileItemId}`);
    }

    const arrayBuffer = await file.arrayBuffer();
    const fullBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // If no cropping, return full buffer
    if (cropStart === 0 && cropEnd === -1) {
        return fullBuffer;
    }

    // Apply crop region
    const startSample = cropStart;
    const endSample = cropEnd === -1 ? fullBuffer.length : cropEnd;
    const length = Math.max(0, endSample - startSample);

    if (length === 0) {
        throw new Error('Crop region results in zero-length audio');
    }

    // Create new buffer with cropped audio
    const croppedBuffer = audioContext.createBuffer(
        fullBuffer.numberOfChannels,
        length,
        fullBuffer.sampleRate
    );

    // Copy channel data
    for (let channel = 0; channel < fullBuffer.numberOfChannels; channel++) {
        const source = fullBuffer.getChannelData(channel);
        const destination = croppedBuffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            destination[i] = source[startSample + i];
        }
    }

    return croppedBuffer;
}

/**
 * Get playback parameters for a clip (for use with AudioBufferSourceNode.start())
 *
 * Returns offset and duration in seconds for non-destructive playback.
 */
export function getClipPlaybackParams(clip: AudioClip): { offset: number; duration: number } {
    const startSeconds = clip.startFrame / clip.sampleRate;
    const endSeconds = clip.endFrame === -1
        ? clip.durationSeconds + startSeconds // Original duration
        : clip.endFrame / clip.sampleRate;

    return {
        offset: startSeconds,
        duration: endSeconds - startSeconds,
    };
}

// ============================================================================
// Waveform Processing
// ============================================================================

/**
 * Downsample waveform data to a target number of points
 *
 * Takes the maximum absolute value in each segment for peak display.
 */
export function downsampleWaveform(data: number[], targetPoints: number): number[] {
    if (data.length <= targetPoints) {
        // Pad with zeros if needed
        const padded = [...data];
        while (padded.length < targetPoints) {
            padded.push(0);
        }
        return padded;
    }

    const result: number[] = [];
    const segmentSize = data.length / targetPoints;

    for (let i = 0; i < targetPoints; i++) {
        const start = Math.floor(i * segmentSize);
        const end = Math.floor((i + 1) * segmentSize);

        let maxAbs = 0;
        for (let j = start; j < end && j < data.length; j++) {
            const abs = Math.abs(data[j]);
            if (abs > maxAbs) maxAbs = abs;
        }
        result.push(maxAbs);
    }

    return result;
}

/**
 * Generate waveform peaks from an AudioBuffer
 *
 * Analyzes the first channel and returns normalized peak values.
 */
export function generateWaveformPeaks(buffer: AudioBuffer, numPoints: number): number[] {
    const channelData = buffer.getChannelData(0);
    const segmentSize = Math.floor(channelData.length / numPoints);
    const peaks: number[] = [];

    for (let i = 0; i < numPoints; i++) {
        const start = i * segmentSize;
        const end = Math.min(start + segmentSize, channelData.length);

        let maxAbs = 0;
        for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > maxAbs) maxAbs = abs;
        }
        peaks.push(maxAbs);
    }

    return peaks;
}

/**
 * Update waveform peaks for a cropped clip
 *
 * Recalculates waveform data based on the new crop region.
 */
export function updateClipWaveformForCrop(
    originalPeaks: number[],
    startFrame: number,
    endFrame: number,
    totalFrames: number,
    targetPoints: number
): number[] {
    // Calculate which portion of the original waveform is visible
    const startRatio = startFrame / totalFrames;
    const endRatio = endFrame === -1 ? 1 : endFrame / totalFrames;

    const startIndex = Math.floor(startRatio * originalPeaks.length);
    const endIndex = Math.ceil(endRatio * originalPeaks.length);

    // Extract the visible portion
    const visiblePeaks = originalPeaks.slice(startIndex, endIndex);

    // Resample to target points
    return downsampleWaveform(visiblePeaks, targetPoints);
}

// ============================================================================
// Clip Dimensions
// ============================================================================

/**
 * Calculate clip width based on duration
 *
 * Clips get wider for longer audio (with min/max bounds).
 */
export function calculateClipWidth(durationSeconds: number): number {
    const minWidth = 80;
    const maxWidth = 200;
    const baseWidth = 120;

    // Scale width: 1s = baseWidth, 10s = maxWidth
    const scale = Math.log10(Math.max(durationSeconds, 0.1) + 1);
    const width = baseWidth + (scale * 40);

    return Math.min(Math.max(width, minWidth), maxWidth);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a clip references a valid item in the library
 */
export function isClipValid(clip: AudioClip): boolean {
    const store = useLibraryStore.getState();
    return clip.sampleId in store.items;
}

/**
 * Validate and repair clip crop region
 *
 * Ensures startFrame < endFrame and both are within bounds.
 */
export function validateCropRegion(
    startFrame: number,
    endFrame: number,
    totalFrames: number
): { startFrame: number; endFrame: number } {
    let validStart = Math.max(0, Math.floor(startFrame));
    let validEnd = endFrame === -1 ? -1 : Math.min(totalFrames, Math.floor(endFrame));

    // Ensure start < end
    if (validEnd !== -1 && validStart >= validEnd) {
        validStart = 0;
        validEnd = -1;
    }

    return { startFrame: validStart, endFrame: validEnd };
}
