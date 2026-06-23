// Throwaway generator for the Phase-1.4 stereo test assets (see the hardware test
// plan). Run: `bun test-assets/gen-test-wavs.ts`. Off the audio path entirely —
// just writes two 16-bit PCM WAVs you drag onto a Sampler node:
//   stereo-sweep.wav  L = 200→2000 Hz sweep, R = 2000→200 Hz sweep (audibly L≠R)
//   mono-sweep.wav    200→2000 Hz sweep (one channel; should center, L==R)
// Delete when done, or add test-assets/ to .gitignore.

import { join } from 'node:path';

const SR = 48_000;
const SECS = 2.0;
const AMP = 0.5;
const N = Math.round(SR * SECS);
const TWO_PI = Math.PI * 2;

/** Linear-chirp sample buffer (phase-accumulated so there are no clicks). */
function sweep(f0: number, f1: number): Float64Array {
  const out = new Float64Array(N);
  let phase = 0;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const freq = f0 + (f1 - f0) * t;
    phase += (TWO_PI * freq) / SR;
    // gentle 5 ms fade in/out so the start/stop don't pop on the M4
    const fade = Math.min(1, i / (SR * 0.005), (N - 1 - i) / (SR * 0.005));
    out[i] = Math.sin(phase) * AMP * fade;
  }
  return out;
}

/** Encode planar channels into an interleaved 16-bit PCM WAV byte buffer. */
function encodeWav(channels: Float64Array[]): Uint8Array {
  const numCh = channels.length;
  const dataLen = N * numCh * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, numCh, true);
  dv.setUint32(24, SR, true);
  dv.setUint32(28, SR * numCh * 2, true); // byte rate
  dv.setUint16(32, numCh * 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  w(36, 'data');
  dv.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < N; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const v = Math.max(-1, Math.min(1, channels[ch][i]));
      dv.setInt16(off, Math.round(v * 32767), true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

const dir = import.meta.dir;
const stereo = encodeWav([sweep(200, 2000), sweep(2000, 200)]);
const mono = encodeWav([sweep(200, 2000)]);
await Bun.write(join(dir, 'stereo-sweep.wav'), stereo);
await Bun.write(join(dir, 'mono-sweep.wav'), mono);
console.log(`wrote stereo-sweep.wav (${stereo.length} B) + mono-sweep.wav (${mono.length} B) to ${dir}`);
