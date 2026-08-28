import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ParamRow } from './ParamRow';

describe('ParamRow gesture lifetime', () => {
    it.each(['cancel', 'blur', 'window-blur', 'unmount'] as const)('closes an open slider gesture on %s exactly once', (ending) => {
        const onGestureStart = vi.fn();
        const onGestureEnd = vi.fn();
        const view = render(<ParamRow label="Gain" value={0.5} valueText="50%" min={0} max={1} onChange={() => {}} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} />);
        const slider = screen.getByRole('slider', { name: 'Gain' });
        fireEvent.pointerDown(slider);
        if (ending === 'cancel') {
            fireEvent.pointerCancel(slider);
            fireEvent.pointerUp(slider);
        }
        else if (ending === 'blur') fireEvent.blur(slider);
        else if (ending === 'window-blur') fireEvent.blur(window);
        else view.unmount();
        expect(onGestureStart).toHaveBeenCalledTimes(1);
        expect(onGestureEnd).toHaveBeenCalledTimes(1);
        if (ending !== 'unmount') view.unmount();
        expect(onGestureEnd).toHaveBeenCalledTimes(1);
    });
});
