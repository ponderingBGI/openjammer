/**
 * WAV encoder — pure, dependency-free AudioBuffer -> WAV conversion.
 *
 * Engine-agnostic export helper used by the recorder/library save paths and the
 * ojcore recorder handle. Pure JavaScript: no AudioContext, no Tone.js, no Web
 * Audio engine dependency.
 */

// ============================================================================
// Constants - PCM Audio Sample Conversion
// ============================================================================

/**
 * PCM sample conversion multipliers for different bit depths. These convert
 * normalized float samples (-1.0 to 1.0) to signed integers.
 *
 * For negative samples: multiply by the positive max value (asymmetric, two's complement).
 * For positive samples: multiply by max positive value.
 */
const PCM_MULTIPLIERS = {
    16: { negative: 0x8000, positive: 0x7fff },
    24: { negative: 0x800000, positive: 0x7fffff },
    32: { negative: 0x80000000, positive: 0x7fffffff },
} as const;

/** WAV header size in bytes (RIFF + fmt + data headers). */
const WAV_HEADER_SIZE = 44;

/** WAV format code for PCM audio. */
const WAV_FORMAT_PCM = 1;

/** Size of fmt sub-chunk for PCM (no extra format bytes). */
const FMT_SUBCHUNK_SIZE = 16;

// ============================================================================
// Types
// ============================================================================

export interface WavEncoderOptions {
    sampleRate?: number;
    bitDepth?: 16 | 24 | 32;
    channels?: 1 | 2;
}

/** Error thrown when WAV encoding fails. */
export class WavEncoderError extends Error {
    readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'WavEncoderError';
        this.cause = cause;
    }
}

// ============================================================================
// Encoder: AudioBuffer -> WAV
// ============================================================================

/** Write a string to a DataView at the given offset. */
function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * Encode an AudioBuffer to WAV format (16-bit PCM by default).
 * @throws {WavEncoderError} If encoding fails due to invalid input.
 */
export function encodeWAV(audioBuffer: AudioBuffer, options: WavEncoderOptions = {}): ArrayBuffer {
    const { bitDepth = 16 } = options;

    if (!audioBuffer || audioBuffer.length === 0) {
        throw new WavEncoderError('Cannot encode empty or invalid AudioBuffer');
    }

    if (!(bitDepth in PCM_MULTIPLIERS)) {
        throw new WavEncoderError(`Unsupported bit depth: ${bitDepth}. Use 16, 24, or 32.`);
    }

    const multipliers = PCM_MULTIPLIERS[bitDepth];
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    // Interleave channels.
    const length = audioBuffer.length * numChannels;
    const interleaved = new Float32Array(length);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        for (let i = 0; i < audioBuffer.length; i++) {
            interleaved[i * numChannels + channel] = channelData[i];
        }
    }

    const dataLength = length * bytesPerSample;
    const fileSize = WAV_HEADER_SIZE + dataLength;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor.
    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk.
    writeString(view, 12, 'fmt ');
    view.setUint32(16, FMT_SUBCHUNK_SIZE, true);
    view.setUint16(20, WAV_FORMAT_PCM, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // Byte rate.
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);

    // data sub-chunk.
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write PCM samples.
    let offset = WAV_HEADER_SIZE;

    if (bitDepth === 16) {
        for (let i = 0; i < interleaved.length; i++) {
            const sample = Math.max(-1, Math.min(1, interleaved[i]));
            const int16 = sample < 0 ? sample * multipliers.negative : sample * multipliers.positive;
            view.setInt16(offset, int16, true);
            offset += 2;
        }
    } else if (bitDepth === 24) {
        for (let i = 0; i < interleaved.length; i++) {
            const sample = Math.max(-1, Math.min(1, interleaved[i]));
            const int24 = sample < 0 ? sample * multipliers.negative : sample * multipliers.positive;
            view.setUint8(offset, int24 & 0xff);
            view.setUint8(offset + 1, (int24 >> 8) & 0xff);
            view.setUint8(offset + 2, (int24 >> 16) & 0xff);
            offset += 3;
        }
    } else if (bitDepth === 32) {
        for (let i = 0; i < interleaved.length; i++) {
            const sample = Math.max(-1, Math.min(1, interleaved[i]));
            const int32 = sample < 0 ? sample * multipliers.negative : sample * multipliers.positive;
            view.setInt32(offset, int32, true);
            offset += 4;
        }
    }

    return buffer;
}

// ============================================================================
// High-Level API
// ============================================================================

/** Convert an AudioBuffer directly to a WAV blob. */
export function audioBufferToWAV(audioBuffer: AudioBuffer, options: WavEncoderOptions = {}): Blob {
    const wavBuffer = encodeWAV(audioBuffer, options);
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

// ============================================================================
// Utilities
// ============================================================================

/** Generate a timestamped filename for recordings. */
export function generateRecordingFilename(prefix = 'recording'): string {
    const now = new Date();
    const timestamp = now
        .toISOString()
        .replace(/:/g, '-') // Windows-safe.
        .replace(/\./g, '-')
        .replace('T', '_')
        .replace('Z', '');

    return `${prefix}_${timestamp}.wav`;
}
