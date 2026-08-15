import type { Story } from '@ladle/react';
import { WaveformCanvas } from './WaveformCanvas';
const peaks = new Float32Array(Array.from({ length: 128 }, (_, index) => index % 2 === 0 ? -Math.abs(Math.sin(index / 10)) : Math.abs(Math.sin(index / 10))));
export const Peaks: Story = () => <WaveformCanvas peaks={peaks} width={320} height={64} label="Example waveform" />;
export const Missing: Story = () => <WaveformCanvas width={320} height={64} label="Waveform peaks unavailable" />;
