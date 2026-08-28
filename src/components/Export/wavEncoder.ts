const PCM24_MAX = 8_388_607;

function writeAscii(view: DataView, offset: number, value: string): void {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

/** Encode interleaved Float32 PCM as a canonical little-endian 24-bit WAV. */
export function encodeWav24(
    interleaved: Float32Array,
    sampleRate: number,
    channels = 2,
): Uint8Array {
    if (!Number.isInteger(channels) || channels < 1) throw new Error('WAV channels must be positive');
    if (interleaved.length % channels !== 0) throw new Error('PCM length must contain whole frames');
    const bytesPerSample = 3;
    const dataLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 24, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let at = 44;
    for (const sample of interleaved) {
        const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
        const value = clamped <= -1 ? -8_388_608 : Math.round(clamped * PCM24_MAX);
        view.setUint8(at, value & 0xff);
        view.setUint8(at + 1, (value >> 8) & 0xff);
        view.setUint8(at + 2, (value >> 16) & 0xff);
        at += 3;
    }
    return new Uint8Array(buffer);
}

export function downloadWav(bytes: Uint8Array, filename: string): void {
    const blob = new Blob([bytes.slice().buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
