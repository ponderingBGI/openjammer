import { describe, expect, it } from 'vitest';
import { encodeWav24 } from '../wavEncoder';

describe('encodeWav24', () => {
    it('writes a golden 24-bit stereo RIFF header and signed PCM bytes', () => {
        const bytes = encodeWav24(new Float32Array([-1, 0, 0.5, 1]), 48_000, 2);
        expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
        expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
        expect(new TextDecoder().decode(bytes.slice(36, 40))).toBe('data');
        expect(new DataView(bytes.buffer).getUint16(22, true)).toBe(2);
        expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(48_000);
        expect(new DataView(bytes.buffer).getUint16(34, true)).toBe(24);
        expect(Array.from(bytes.slice(44))).toEqual([
            0x00, 0x00, 0x80,
            0x00, 0x00, 0x00,
            0x00, 0x00, 0x40,
            0xff, 0xff, 0x7f,
        ]);
    });

    it('rejects partial frames', () => {
        expect(() => encodeWav24(new Float32Array(3), 44_100, 2)).toThrow(/whole frames/);
    });
});
