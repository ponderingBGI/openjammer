import type { Story } from '@ladle/react';
import { TimeRuler } from './TimeRuler';
export const Bars: Story = () => <TimeRuler width={416} marks={Array.from({ length: 5 }, (_, index) => ({ id: index, x: index * 104, label: String(index + 1), level: 'bar' as const }))} />;
