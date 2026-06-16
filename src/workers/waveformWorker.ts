/**
 * Web Worker for Waveform Peak Generation
 *
 * Offloads CPU-intensive waveform peak calculation to a background thread.
 * This prevents blocking the main thread during audio file processing.
 */

export interface WaveformWorkerMessage {
  type: 'generatePeaks';
  channelData: Float32Array;
  numPoints: number;
  requestId: number;
}

export interface WaveformWorkerResponse {
  type: 'peaksGenerated';
  peaks: Float32Array;
  requestId: number;
}

/**
 * Generate waveform peaks from channel data
 * Same algorithm as audioMetadata.ts but runs in worker thread
 */
function generateWaveformPeaks(channelData: Float32Array, numPoints: number): Float32Array {
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

// Worker message handler
self.onmessage = (e: MessageEvent<WaveformWorkerMessage>) => {
  const { type, channelData, numPoints, requestId } = e.data;

  if (type === 'generatePeaks') {
    const peaks = generateWaveformPeaks(channelData, numPoints);

    const response: WaveformWorkerResponse = {
      type: 'peaksGenerated',
      peaks,
      requestId,
    };

    // Transfer the peaks buffer for zero-copy performance
    (self.postMessage as (message: unknown, transfer: Transferable[]) => void)(response, [peaks.buffer]);
  }
};

export {};
