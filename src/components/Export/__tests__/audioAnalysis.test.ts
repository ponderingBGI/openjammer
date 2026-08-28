import { describe, expect, it } from 'vitest';
import { decodeWav, energyFingerprint, peakDbfs, rmsDbfs } from '../../../../e2e/helpers/audio';
import { encodeWav24 } from '../wavEncoder';

describe('WAV analysis decoder', () => {
    it('round-trips the TypeScript 24-bit encoder', () => {
        const input = Float32Array.from([-1, -0.5, 0, 0.25, 0.75, 1]);
        const bytes = encodeWav24(input, 48_000, 2);
        const decoded = decodeWav(bytes.slice().buffer);
        expect(decoded.bitsPerSample).toBe(24);
        expect(decoded.channels).toBe(2);
        expect(decoded.frames).toBe(3);
        decoded.interleaved.forEach((value, index) => expect(value).toBeCloseTo(input[index]!, 6));
        expect(peakDbfs(decoded.interleaved)).toBeCloseTo(0, 5);
        expect(rmsDbfs(decoded.interleaved)).toBeGreaterThan(-10);
        expect(energyFingerprint(decoded, 3)).toHaveLength(3);
    });

    it('decodes signed little-endian 16-bit PCM', () => {
        const buffer = new ArrayBuffer(48);
        const view = new DataView(buffer);
        const text = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 40, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8_000, true); view.setUint32(28, 16_000, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 4, true);
        view.setInt16(44, -32_768, true); view.setInt16(46, 16_384, true);
        expect([...decodeWav(buffer).interleaved]).toEqual([-1, 0.5]);
    });
});
