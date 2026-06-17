/**
 * Waveform Worker Client
 *
 * Provides an async API for offloading waveform generation to a Web Worker.
 * Falls back to main thread if workers aren't supported.
 */

import type { WaveformWorkerMessage, WaveformWorkerResponse } from './waveformWorker';

let worker: Worker | null = null;
let requestCounter = 0;
const pendingRequests = new Map<number, {
  resolve: (peaks: Float32Array) => void;
  reject: (error: Error) => void;
}>();

/**
 * Get or create the waveform worker
 */
function getWorker(): Worker | null {
  if (worker) return worker;

  if (typeof Worker === 'undefined') {
    console.warn('Web Workers not supported, waveform generation will run on main thread');
    return null;
  }

  try {
    // Vite web worker import
    worker = new Worker(new URL('./waveformWorker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WaveformWorkerResponse>) => {
      const { type, peaks, requestId } = e.data;

      if (type === 'peaksGenerated') {
        const pending = pendingRequests.get(requestId);
        if (pending) {
          pending.resolve(peaks);
          pendingRequests.delete(requestId);
        }
      }
    };

    worker.onerror = (error) => {
      console.error('Waveform worker error:', error);
      // Reject all pending requests
      pendingRequests.forEach(({ reject }) => {
        reject(new Error('Worker error'));
      });
      pendingRequests.clear();
    };

    return worker;
  } catch (error) {
    console.warn('Failed to create waveform worker:', error);
    return null;
  }
}

/**
 * Fallback: generate peaks on main thread
 */
function generatePeaksMainThread(channelData: Float32Array, numPoints: number): Float32Array {
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
 * Generate waveform peaks using Web Worker (or fallback to main thread)
 *
 * @param audioBuffer - The decoded audio buffer
 * @param numPoints - Number of peak points to generate (default 100)
 * @returns Promise<Float32Array> of peak values (0-1 normalized)
 */
export async function generateWaveformPeaksAsync(
  audioBuffer: AudioBuffer,
  numPoints = 100
): Promise<Float32Array> {
  const channelData = audioBuffer.getChannelData(0);
  const w = getWorker();

  if (!w) {
    // Fallback to main thread
    return generatePeaksMainThread(channelData, numPoints);
  }

  const requestId = ++requestCounter;

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    const message: WaveformWorkerMessage = {
      type: 'generatePeaks',
      channelData,
      numPoints,
      requestId,
    };

    // Transfer the buffer for zero-copy send (worker receives ownership)
    // Note: We create a copy since we transfer ownership
    const channelDataCopy = new Float32Array(channelData);
    w.postMessage(
      { ...message, channelData: channelDataCopy },
      [channelDataCopy.buffer]
    );

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Waveform generation timeout'));
      }
    }, 30000);
  });
}

/**
 * Generate waveform peaks from a File using Web Worker
 */
export async function generateWaveformFromFileAsync(
  file: File,
  audioContext: AudioContext,
  numPoints = 100
): Promise<Float32Array | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return generateWaveformPeaksAsync(audioBuffer, numPoints);
  } catch (error) {
    console.warn('Failed to generate waveform:', error);
    return null;
  }
}

/**
 * Terminate the worker (call on app shutdown)
 */
export function terminateWaveformWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    pendingRequests.clear();
  }
}
