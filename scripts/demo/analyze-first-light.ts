import { readFile } from 'node:fs/promises';

export interface FirstLightAnalysis {
    durationSeconds: number;
    sampleRate: number;
    bitsPerSample: number;
    channels: number;
    peakDbfs: number;
    clippedSamples: number;
    sectionRmsDbfs: Record<'bar2' | 'bar8' | 'bar16' | 'bar22', number>;
}

const db = (amplitude: number) => amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;

export async function analyzeFirstLightWav(path: string): Promise<FirstLightAnalysis> {
    const bytes = await readFile(path);
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
    const channels = bytes.readUInt16LE(22);
    const sampleRate = bytes.readUInt32LE(24);
    const bitsPerSample = bytes.readUInt16LE(34);
    if (bitsPerSample !== 24) throw new Error(`expected 24-bit PCM, got ${bitsPerSample}`);
    let dataOffset = 12;
    let dataBytes = 0;
    while (dataOffset + 8 <= bytes.length) {
        const id = bytes.toString('ascii', dataOffset, dataOffset + 4);
        const size = bytes.readUInt32LE(dataOffset + 4);
        if (id === 'data') { dataBytes = size; dataOffset += 8; break; }
        dataOffset += 8 + size + (size & 1);
    }
    if (!dataBytes) throw new Error('WAV has no data chunk');
    const sampleCount = Math.floor(dataBytes / 3);
    const frames = Math.floor(sampleCount / channels);
    const values = new Float64Array(sampleCount);
    let peak = 0;
    let clippedSamples = 0;
    for (let index = 0; index < sampleCount; index++) {
        const at = dataOffset + index * 3;
        let raw = bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
        if (raw & 0x800000) raw |= ~0xffffff;
        const value = raw / 0x800000;
        values[index] = value;
        peak = Math.max(peak, Math.abs(value));
        if (raw === -0x800000 || raw === 0x7fffff) clippedSamples++;
    }
    const barSeconds = 4 * 60 / 84;
    const rmsWindow = (bar: number) => {
        const from = Math.floor((bar - 1) * barSeconds * sampleRate) * channels;
        const to = Math.min(values.length, Math.floor(bar * barSeconds * sampleRate) * channels);
        let sum = 0;
        for (let index = from; index < to; index++) sum += values[index]! ** 2;
        return db(Math.sqrt(sum / Math.max(1, to - from)));
    };
    return {
        durationSeconds: frames / sampleRate, sampleRate, bitsPerSample, channels,
        peakDbfs: db(peak), clippedSamples,
        sectionRmsDbfs: { bar2: rmsWindow(2), bar8: rmsWindow(8), bar16: rmsWindow(16), bar22: rmsWindow(22) },
    };
}

if (import.meta.main) {
    const path = Bun.argv[2];
    if (!path) throw new Error('Usage: bun scripts/demo/analyze-first-light.ts <first-light.wav>');
    const analysis = await analyzeFirstLightWav(path);
    console.log(JSON.stringify(analysis, null, 2));
    const rms = Object.values(analysis.sectionRmsDbfs);
    if (analysis.durationSeconds < 68 || analysis.durationSeconds > 100 || analysis.sampleRate !== 48_000 || analysis.bitsPerSample !== 24 || analysis.channels !== 2 || analysis.peakDbfs < -3.5 || analysis.peakDbfs > -1 || analysis.clippedSamples !== 0 || rms.some((value) => value <= -60)) process.exitCode = 1;
}
