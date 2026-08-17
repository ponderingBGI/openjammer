export interface DecodedWav {
    sampleRate: number;
    channels: number;
    bitsPerSample: 16 | 24;
    frames: number;
    durationSeconds: number;
    interleaved: Float32Array;
    channelData: Float32Array[];
}

export interface BarWindow {
    fromBar: number;
    toBar: number;
    label?: string;
}

const ascii = (view: DataView, offset: number, length: number) =>
    Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('');

export function decodeWav(buffer: ArrayBuffer): DecodedWav {
    const view = new DataView(buffer);
    if (buffer.byteLength < 44 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
        throw new Error('Export is not a RIFF/WAVE file');
    }
    let offset = 12;
    let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | undefined;
    let dataOffset = -1;
    let dataLength = 0;
    while (offset + 8 <= view.byteLength) {
        const id = ascii(view, offset, 4);
        const length = view.getUint32(offset + 4, true);
        const body = offset + 8;
        if (body + length > view.byteLength) throw new Error(`WAV ${id} chunk extends past the file`);
        if (id === 'fmt ') format = {
            audioFormat: view.getUint16(body, true), channels: view.getUint16(body + 2, true),
            sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true),
        };
        if (id === 'data') { dataOffset = body; dataLength = length; break; }
        offset = body + length + (length & 1);
    }
    if (!format || dataOffset < 0) throw new Error('WAV is missing fmt or data');
    if (format.audioFormat !== 1) throw new Error(`WAV uses unsupported format ${format.audioFormat}; expected PCM`);
    if (format.bits !== 16 && format.bits !== 24) throw new Error(`WAV uses unsupported ${format.bits}-bit PCM; expected 16 or 24`);
    if (format.channels < 1 || format.sampleRate < 1) throw new Error('WAV has invalid channel or sample-rate metadata');
    const bytesPerSample = format.bits / 8;
    const sampleCount = Math.floor(dataLength / bytesPerSample);
    if (sampleCount % format.channels !== 0) throw new Error('WAV data ends inside a sample frame');
    const interleaved = new Float32Array(sampleCount);
    let at = dataOffset;
    for (let index = 0; index < sampleCount; index++, at += bytesPerSample) {
        if (format.bits === 16) interleaved[index] = view.getInt16(at, true) / 32_768;
        else {
            let value = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
            if (value & 0x80_0000) value |= 0xff00_0000;
            interleaved[index] = value / 8_388_608;
        }
    }
    const frames = sampleCount / format.channels;
    const channelData = Array.from({ length: format.channels }, (_, channel) => {
        const samples = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame++) samples[frame] = interleaved[frame * format.channels + channel]!;
        return samples;
    });
    return {
        sampleRate: format.sampleRate, channels: format.channels, bitsPerSample: format.bits,
        frames, durationSeconds: frames / format.sampleRate, interleaved, channelData,
    };
}

export function peakDbfs(samples: Float32Array): number {
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}

export function rmsDbfs(samples: Float32Array, from = 0, to = samples.length): number {
    const start = Math.max(0, Math.floor(from));
    const end = Math.min(samples.length, Math.ceil(to));
    if (end <= start) return -Infinity;
    let sum = 0;
    for (let index = start; index < end; index++) sum += samples[index]! * samples[index]!;
    const rms = Math.sqrt(sum / (end - start));
    return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

export function barWindowRms(
    wav: DecodedWav,
    windows: readonly BarWindow[],
    bpm: number,
    ppq: number,
    beatsPerBar = 4,
): Array<BarWindow & { rmsDbfs: number }> {
    if (!(bpm > 0) || !(ppq > 0)) throw new Error('Musical window analysis needs positive bpm and ppq');
    const framesPerTick = wav.sampleRate * 60 / (bpm * ppq);
    const ticksPerBar = ppq * beatsPerBar;
    return windows.map((window) => ({
        ...window,
        rmsDbfs: rmsDbfs(wav.interleaved, window.fromBar * ticksPerBar * framesPerTick * wav.channels, window.toBar * ticksPerBar * framesPerTick * wav.channels),
    }));
}

/** Eight-band zero-crossing/energy sketch. Coarse by design, stable across engines. */
export function energyFingerprint(wav: DecodedWav, buckets = 8): number[] {
    const mono = wav.channelData[0]!;
    const bucketLength = Math.max(1, Math.floor(mono.length / buckets));
    return Array.from({ length: buckets }, (_, bucket) => {
        const start = bucket * bucketLength;
        const end = bucket === buckets - 1 ? mono.length : Math.min(mono.length, start + bucketLength);
        let energy = 0;
        let crossings = 0;
        for (let index = start; index < end; index++) {
            const value = mono[index]!;
            energy += value * value;
            if (index > start && (value >= 0) !== (mono[index - 1]! >= 0)) crossings++;
        }
        const rms = Math.sqrt(energy / Math.max(1, end - start));
        return Number((Math.log10(1 + rms * 1_000) + crossings / Math.max(1, end - start)).toFixed(5));
    });
}

export function assertMusicalDuration(wav: DecodedWav, expectedSeconds: number, toleranceSeconds = 0.12): void {
    const drift = Math.abs(wav.durationSeconds - expectedSeconds);
    if (drift > toleranceSeconds) throw new Error(`Bounce length is ${wav.durationSeconds.toFixed(3)}s; expected ${expectedSeconds.toFixed(3)}s ±${toleranceSeconds}s (${drift.toFixed(3)}s musical drift)`);
}

export function assertAudiblePeak(wav: DecodedWav, minimumDbfs = -48, maximumDbfs = 0.01): void {
    const peak = peakDbfs(wav.interleaved);
    if (peak < minimumDbfs) throw new Error(`Bounce is effectively silent: peak ${peak.toFixed(2)} dBFS, expected at least ${minimumDbfs} dBFS`);
    if (peak > maximumDbfs) throw new Error(`Bounce clips the master: peak ${peak.toFixed(2)} dBFS exceeds ${maximumDbfs} dBFS`);
}

export function assertSectionsDiffer(fingerprints: readonly number[][], minimumDistance = 0.02): void {
    for (let index = 1; index < fingerprints.length; index++) {
        const previous = fingerprints[index - 1]!;
        const current = fingerprints[index]!;
        const distance = current.reduce((sum, value, item) => sum + Math.abs(value - (previous[item] ?? 0)), 0) / Math.max(current.length, previous.length);
        if (distance < minimumDistance) throw new Error(`Sections ${index} and ${index + 1} sound unexpectedly alike (fingerprint distance ${distance.toFixed(4)} < ${minimumDistance})`);
    }
}
