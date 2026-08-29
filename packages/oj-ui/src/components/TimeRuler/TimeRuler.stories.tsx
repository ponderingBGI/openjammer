import type { Story } from '@ladle/react';
import { TimeRuler } from './TimeRuler';
export const Bars: Story = () => <div style={{ width: 416, height: 28, background: 'var(--timeline-lane-bg)' }}><TimeRuler width={416} marks={Array.from({ length: 17 }, (_, index) => ({ id: index, x: index * 26, label: index % 4 === 0 ? String(index / 4 + 1) : undefined, level: index % 4 === 0 ? 'bar' as const : index % 2 === 0 ? 'beat' as const : 'sub' as const }))} /></div>;
