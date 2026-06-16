/**
 * WAV Encoder Tests
 *
 * Tests WAV encoding, error handling, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { encodeWAV, WavEncoderError, audioBufferToWAV } from '../wav';

// Create a mock AudioBuffer for testing
function createMockAudioBuffer(
  length: number,
  numberOfChannels: number,
  sampleRate: number
): AudioBuffer {
  const channelData: Float32Array[] = [];

  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      // Generate a simple sine wave for testing
      data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    }
    channelData.push(data);
  }

  return {
    length,
    numberOfChannels,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => channelData[channel],
  } as unknown as AudioBuffer;
}

describe('WavEncoder', () => {
  describe('encodeWAV', () => {
    it('should encode a mono AudioBuffer to WAV', () => {
      const buffer = createMockAudioBuffer(1000, 1, 44100);
      const result = encodeWAV(buffer);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(44 + 1000 * 2); // 44 byte header + samples * 2 bytes
    });

    it('should encode a stereo AudioBuffer to WAV', () => {
      const buffer = createMockAudioBuffer(1000, 2, 44100);
      const result = encodeWAV(buffer);

      expect(result).toBeInstanceOf(ArrayBuffer);
      expect(result.byteLength).toBe(44 + 1000 * 2 * 2); // 44 byte header + samples * channels * 2 bytes
    });

    it('should write correct RIFF header', () => {
      const buffer = createMockAudioBuffer(100, 1, 44100);
      const result = encodeWAV(buffer);
      const view = new DataView(result);

      // Check RIFF chunk
      expect(String.fromCharCode(view.getUint8(0))).toBe('R');
      expect(String.fromCharCode(view.getUint8(1))).toBe('I');
      expect(String.fromCharCode(view.getUint8(2))).toBe('F');
      expect(String.fromCharCode(view.getUint8(3))).toBe('F');

      // Check WAVE format
      expect(String.fromCharCode(view.getUint8(8))).toBe('W');
      expect(String.fromCharCode(view.getUint8(9))).toBe('A');
      expect(String.fromCharCode(view.getUint8(10))).toBe('V');
      expect(String.fromCharCode(view.getUint8(11))).toBe('E');
    });

    it('should write correct fmt sub-chunk', () => {
      const buffer = createMockAudioBuffer(100, 2, 48000);
      const result = encodeWAV(buffer);
      const view = new DataView(result);

      // fmt sub-chunk
      expect(String.fromCharCode(view.getUint8(12))).toBe('f');
      expect(String.fromCharCode(view.getUint8(13))).toBe('m');
      expect(String.fromCharCode(view.getUint8(14))).toBe('t');
      expect(String.fromCharCode(view.getUint8(15))).toBe(' ');

      // Sub-chunk size (16 for PCM)
      expect(view.getUint32(16, true)).toBe(16);

      // Audio format (1 = PCM)
      expect(view.getUint16(20, true)).toBe(1);

      // Number of channels
      expect(view.getUint16(22, true)).toBe(2);

      // Sample rate
      expect(view.getUint32(24, true)).toBe(48000);

      // Bit depth
      expect(view.getUint16(34, true)).toBe(16);
    });

    it('should write correct data sub-chunk header', () => {
      const buffer = createMockAudioBuffer(100, 1, 44100);
      const result = encodeWAV(buffer);
      const view = new DataView(result);

      // data sub-chunk
      expect(String.fromCharCode(view.getUint8(36))).toBe('d');
      expect(String.fromCharCode(view.getUint8(37))).toBe('a');
      expect(String.fromCharCode(view.getUint8(38))).toBe('t');
      expect(String.fromCharCode(view.getUint8(39))).toBe('a');

      // Data length
      expect(view.getUint32(40, true)).toBe(100 * 2); // samples * bytes per sample
    });

    it('should handle different sample rates', () => {
      const rates = [22050, 44100, 48000, 96000];

      for (const rate of rates) {
        const buffer = createMockAudioBuffer(100, 1, rate);
        const result = encodeWAV(buffer);
        const view = new DataView(result);

        expect(view.getUint32(24, true)).toBe(rate);
      }
    });

    it('should encode 24-bit audio', () => {
      const buffer = createMockAudioBuffer(100, 1, 44100);
      const result = encodeWAV(buffer, { bitDepth: 24 });

      expect(result.byteLength).toBe(44 + 100 * 3); // 3 bytes per sample

      const view = new DataView(result);
      expect(view.getUint16(34, true)).toBe(24); // Bit depth
    });

    it('should encode 32-bit audio', () => {
      const buffer = createMockAudioBuffer(100, 1, 44100);
      const result = encodeWAV(buffer, { bitDepth: 32 });

      expect(result.byteLength).toBe(44 + 100 * 4); // 4 bytes per sample

      const view = new DataView(result);
      expect(view.getUint16(34, true)).toBe(32); // Bit depth
    });

    it('should clamp samples to valid range', () => {
      // Create a buffer with out-of-range values
      const buffer = {
        length: 3,
        numberOfChannels: 1,
        sampleRate: 44100,
        duration: 3 / 44100,
        getChannelData: () => new Float32Array([-2.0, 0.0, 2.0]), // Out of range values
      } as unknown as AudioBuffer;

      const result = encodeWAV(buffer);
      const view = new DataView(result);

      // Check that extreme values are clamped
      const sample1 = view.getInt16(44, true);
      const sample3 = view.getInt16(48, true);

      // -2.0 should be clamped to -1.0 -> -32768
      expect(sample1).toBe(-32768);
      // 2.0 should be clamped to 1.0 -> 32767
      expect(sample3).toBe(32767);
    });
  });

  describe('Error Handling', () => {
    it('should throw WavEncoderError for empty AudioBuffer', () => {
      const emptyBuffer = createMockAudioBuffer(0, 1, 44100);

      expect(() => encodeWAV(emptyBuffer)).toThrow(WavEncoderError);
      expect(() => encodeWAV(emptyBuffer)).toThrow('Cannot encode empty or invalid AudioBuffer');
    });

    it('should throw WavEncoderError for null AudioBuffer', () => {
      expect(() => encodeWAV(null as unknown as AudioBuffer)).toThrow(WavEncoderError);
    });

    it('should throw WavEncoderError for unsupported bit depth', () => {
      const buffer = createMockAudioBuffer(100, 1, 44100);

      expect(() => encodeWAV(buffer, { bitDepth: 8 as 16 })).toThrow(WavEncoderError);
      expect(() => encodeWAV(buffer, { bitDepth: 8 as 16 })).toThrow('Unsupported bit depth');
    });

    it('should include cause in WavEncoderError', () => {
      const cause = new Error('Original error');
      const error = new WavEncoderError('Test error', cause);

      expect(error.cause).toBe(cause);
      expect(error.name).toBe('WavEncoderError');
    });
  });

  describe('audioBufferToWAV', () => {
    it('should return a WAV Blob', () => {
      const buffer = createMockAudioBuffer(1000, 2, 44100);
      const blob = audioBufferToWAV(buffer);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/wav');
      expect(blob.size).toBe(44 + 1000 * 2 * 2);
    });

    it('should pass options to encodeWAV', () => {
      const buffer = createMockAudioBuffer(100, 1, 44100);
      const blob = audioBufferToWAV(buffer, { bitDepth: 24 });

      expect(blob.size).toBe(44 + 100 * 3);
    });
  });

  describe('PCM Sample Conversion', () => {
    it('should convert silence (0.0) to zero', () => {
      const buffer = {
        length: 1,
        numberOfChannels: 1,
        sampleRate: 44100,
        duration: 1 / 44100,
        getChannelData: () => new Float32Array([0.0]),
      } as unknown as AudioBuffer;

      const result = encodeWAV(buffer);
      const view = new DataView(result);

      expect(view.getInt16(44, true)).toBe(0);
    });

    it('should convert max positive (1.0) correctly', () => {
      const buffer = {
        length: 1,
        numberOfChannels: 1,
        sampleRate: 44100,
        duration: 1 / 44100,
        getChannelData: () => new Float32Array([1.0]),
      } as unknown as AudioBuffer;

      const result = encodeWAV(buffer);
      const view = new DataView(result);

      expect(view.getInt16(44, true)).toBe(32767); // 0x7FFF
    });

    it('should convert max negative (-1.0) correctly', () => {
      const buffer = {
        length: 1,
        numberOfChannels: 1,
        sampleRate: 44100,
        duration: 1 / 44100,
        getChannelData: () => new Float32Array([-1.0]),
      } as unknown as AudioBuffer;

      const result = encodeWAV(buffer);
      const view = new DataView(result);

      expect(view.getInt16(44, true)).toBe(-32768); // 0x8000
    });
  });

  describe('Channel Interleaving', () => {
    it('should correctly interleave stereo channels', () => {
      const leftChannel = new Float32Array([0.5, 0.5]);
      const rightChannel = new Float32Array([-0.5, -0.5]);

      const buffer = {
        length: 2,
        numberOfChannels: 2,
        sampleRate: 44100,
        duration: 2 / 44100,
        getChannelData: (ch: number) => ch === 0 ? leftChannel : rightChannel,
      } as unknown as AudioBuffer;

      const result = encodeWAV(buffer);
      const view = new DataView(result);

      // Samples should be interleaved: L0, R0, L1, R1
      const l0 = view.getInt16(44, true);
      const r0 = view.getInt16(46, true);
      const l1 = view.getInt16(48, true);
      const r1 = view.getInt16(50, true);

      expect(l0).toBeGreaterThan(0); // Left positive
      expect(r0).toBeLessThan(0);    // Right negative
      expect(l1).toBeGreaterThan(0); // Left positive
      expect(r1).toBeLessThan(0);    // Right negative
    });
  });
});
