/**
 * Audio Metadata Extraction Utilities
 *
 * Extracts metadata from audio files including:
 * - Format information (duration, sample rate, channels)
 * - BPM detection (from ACID chunks or audio analysis)
 * - Waveform peak generation
 */

import { parseBlob, type IAudioMetadata } from 'music-metadata';

// ============================================================================
// Types
// ============================================================================

export interface SampleMetadata {
  id: string;
  fileName: string;
  relativePath: string;
  libraryId: string;

  // Audio properties
  duration: number; // seconds
  sampleRate: number;
  channels: number;
  format: string; // 'wav', 'mp3', 'flac', etc.
  bitDepth?: number;
  bitrate?: number; // bits per second

  // Extracted metadata
  bpm?: number;
  key?: string; // 'C', 'Cm', 'C#', etc.

  // Waveform (stored separately, referenced here)
  hasWaveform: boolean;

  // Organization
  tags: string[];
  favorite: boolean;
  rating?: number; // 1-5

  // Timestamps
  addedAt: number;
  lastUsedAt?: number;

  // Source tracking
  fileSize: number;
  lastModified: number;
}

export interface ExtractedMetadata {
  duration: number;
  sampleRate: number;
  channels: number;
  format: string;
  bitDepth?: number;
  bitrate?: number;
  bpm?: number;
  key?: string;
  title?: string;
  artist?: string;
}

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Extract metadata from an audio file
 */
export async function extractMetadata(file: File): Promise<ExtractedMetadata> {
  try {
    const metadata = await parseBlob(file, {
      duration: true,
      skipCovers: true, // Skip cover art for memory savings
    });

    return parseAudioMetadata(metadata);
  } catch (error) {
    console.warn(`Failed to parse metadata for ${file.name}:`, error);

    // Return minimal metadata
    return {
      duration: 0,
      sampleRate: 44100,
      channels: 2,
      format: getFormatFromExtension(file.name),
    };
  }
}

/**
 * Parse music-metadata result into our format
 */
function parseAudioMetadata(metadata: IAudioMetadata): ExtractedMetadata {
  return {
    duration: metadata.format.duration ?? 0,
    sampleRate: metadata.format.sampleRate ?? 44100,
    channels: metadata.format.numberOfChannels ?? 2,
    format: metadata.format.codec ?? metadata.format.container ?? 'unknown',
    bitDepth: metadata.format.bitsPerSample,
    bitrate: metadata.format.bitrate,
    bpm: metadata.common.bpm,
    key: metadata.common.key,
    title: metadata.common.title,
    artist: metadata.common.artist,
  };
}

/**
 * Get format from file extension
 */
function getFormatFromExtension(fileName: string): string {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.') + 1);
  const formatMap: Record<string, string> = {
    wav: 'WAV',
    mp3: 'MP3',
    flac: 'FLAC',
    aiff: 'AIFF',
    aif: 'AIFF',
    ogg: 'OGG',
    m4a: 'AAC',
  };
  return formatMap[ext] ?? ext.toUpperCase();
}

// ============================================================================
// BPM Detection
// ============================================================================

/**
 * Detect BPM from an AudioBuffer using beat detection
 * Uses the web-audio-beat-detector library
 */
export async function detectBPM(audioBuffer: AudioBuffer): Promise<number | null> {
  try {
    // Dynamic import to avoid loading if not needed
    const { analyze } = await import('web-audio-beat-detector');

    const tempo = await analyze(audioBuffer);
    return Math.round(tempo);
  } catch (error) {
    console.warn('BPM detection failed:', error);
    return null;
  }
}

/**
 * Detect BPM from a File (loads and decodes first)
 */
export async function detectBPMFromFile(
  file: File,
  audioContext: AudioContext
): Promise<number | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return detectBPM(audioBuffer);
  } catch (error) {
    console.warn('Failed to load file for BPM detection:', error);
    return null;
  }
}

// ============================================================================
// Waveform Generation
// ============================================================================

// Import and re-export the async worker-based waveform generation
import {
  generateWaveformPeaksAsync,
  generateWaveformFromFileAsync,
  terminateWaveformWorker,
} from '../workers/waveformWorkerClient';

export {
  generateWaveformPeaksAsync,
  generateWaveformFromFileAsync,
  terminateWaveformWorker,
};

/**
 * Generate waveform peaks from an AudioBuffer (synchronous, main thread)
 *
 * @deprecated Prefer generateWaveformPeaksAsync for non-blocking execution
 * @param audioBuffer - The decoded audio buffer
 * @param numPoints - Number of peak points to generate (default 100)
 * @returns Float32Array of peak values (0-1 normalized)
 */
export function generateWaveformPeaks(
  audioBuffer: AudioBuffer,
  numPoints = 100
): Float32Array {
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  const peaks = new Float32Array(numPoints);
  const samplesPerPoint = Math.floor(channelData.length / numPoints);

  for (let i = 0; i < numPoints; i++) {
    const start = i * samplesPerPoint;
    const end = start + samplesPerPoint;

    let max = 0;
    for (let j = start; j < end && j < channelData.length; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }

    peaks[i] = max;
  }

  return peaks;
}

/**
 * Generate waveform peaks from a File (uses Web Worker for non-blocking execution)
 */
export async function generateWaveformFromFile(
  file: File,
  audioContext: AudioContext,
  numPoints = 100
): Promise<Float32Array | null> {
  // Use the async worker version for non-blocking execution
  return generateWaveformFromFileAsync(file, audioContext, numPoints);
}

/**
 * Convert Float32Array peaks to a compact format for storage
 */
export function peaksToBase64(peaks: Float32Array): string {
  const bytes = new Uint8Array(peaks.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string back to Float32Array peaks
 */
export function base64ToPeaks(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// ============================================================================
// Tag Extraction
// ============================================================================

/**
 * Extract auto-tags from file path and name
 */
export function extractAutoTags(relativePath: string): string[] {
  const tags: string[] = [];

  // Split path into parts
  const parts = relativePath.toLowerCase().split('/');
  const fileName = parts.pop() || '';
  const folders = parts;

  // Common category keywords
  const categoryKeywords: Record<string, string[]> = {
    drums: ['drum', 'drums', 'percussion', 'perc'],
    kicks: ['kick', 'kicks', 'bd'],
    snares: ['snare', 'snares', 'sd'],
    hihats: ['hihat', 'hihats', 'hi-hat', 'hh', 'hat'],
    bass: ['bass', 'sub', '808'],
    synth: ['synth', 'synthesizer', 'lead', 'pad'],
    fx: ['fx', 'sfx', 'effect', 'effects', 'riser', 'impact'],
    vocals: ['vocal', 'vocals', 'vox', 'voice'],
    guitar: ['guitar', 'gtr'],
    piano: ['piano', 'keys', 'keyboard'],
    strings: ['string', 'strings', 'violin', 'cello', 'orchestra'],
    loops: ['loop', 'loops'],
    oneshot: ['oneshot', 'one-shot', 'shot', 'hit'],
  };

  // Check folders for category matches
  for (const folder of folders) {
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(kw => folder.includes(kw))) {
        if (!tags.includes(category)) {
          tags.push(category);
        }
      }
    }
  }

  // Check filename for category matches
  const baseName = fileName.replace(/\.[^.]+$/, ''); // Remove extension
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => baseName.includes(kw))) {
      if (!tags.includes(category)) {
        tags.push(category);
      }
    }
  }

  return tags;
}

// ============================================================================
// Full Sample Processing
// ============================================================================

/**
 * Create a complete SampleMetadata object from a file
 */
export async function createSampleMetadata(
  id: string,
  file: File,
  relativePath: string,
  libraryId: string
): Promise<SampleMetadata> {
  const extracted = await extractMetadata(file);
  const autoTags = extractAutoTags(relativePath);

  return {
    id,
    fileName: file.name,
    relativePath,
    libraryId,

    duration: extracted.duration,
    sampleRate: extracted.sampleRate,
    channels: extracted.channels,
    format: extracted.format,
    bitDepth: extracted.bitDepth,
    bitrate: extracted.bitrate,

    bpm: extracted.bpm,
    key: extracted.key,

    hasWaveform: false, // Will be set after waveform generation

    tags: autoTags,
    favorite: false,

    addedAt: Date.now(),

    fileSize: file.size,
    lastModified: file.lastModified,
  };
}

// ============================================================================
// Format Utilities
// ============================================================================

/**
 * Format duration as MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format file size as human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format sample rate as human-readable string
 */
export function formatSampleRate(rate: number): string {
  if (rate >= 1000) {
    return `${(rate / 1000).toFixed(1)} kHz`;
  }
  return `${rate} Hz`;
}
