import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WaveformView } from './WaveformView';

const PEAKS = [0, 0.5, -0.5, 0.8, -0.3, 0];

describe('WaveformView', () => {
    it('renders the base class, name and mono duration', () => {
        const { container } = render(
            <WaveformView peaks={PEAKS} durationLabel="2.4s" name="kick.wav" />,
        );
        const card = container.querySelector('.oj-waveform-view')!;
        expect(card.className).toBe('oj-waveform-view');
        expect(container.querySelector('.oj-waveform-view__name')!.textContent).toBe('kick.wav');
        expect(container.querySelector('.oj-waveform-view__duration')!.textContent).toBe('2.4s');
    });

    it('composes the Waveform trace', () => {
        const { container } = render(
            <WaveformView peaks={PEAKS} durationLabel="1s" name="x" />,
        );
        expect(container.querySelector('.oj-waveform-view__trace.oj-waveform')).not.toBeNull();
        expect(container.querySelector('polyline.oj-waveform__trace')).not.toBeNull();
    });

    it('applies selected, dragging and drop-target state classes', () => {
        const { container } = render(
            <WaveformView peaks={PEAKS} durationLabel="1s" name="x" selected dragging dropTarget />,
        );
        const cls = container.querySelector('.oj-waveform-view')!.className;
        expect(cls).toContain('is-selected');
        expect(cls).toContain('is-dragging');
        expect(cls).toContain('is-drop-target');
    });

    it('renders the crop indicator only when cropped', () => {
        const { container: plain } = render(
            <WaveformView peaks={PEAKS} durationLabel="1s" name="x" />,
        );
        expect(plain.querySelector('.oj-waveform-view__crop')).toBeNull();

        const { container: cropped } = render(
            <WaveformView peaks={PEAKS} durationLabel="1s" name="x" cropped />,
        );
        expect(cropped.querySelector('.oj-waveform-view__crop')).not.toBeNull();
    });

    it('sets the native draggable attribute when draggable', () => {
        const { container } = render(
            <WaveformView peaks={PEAKS} durationLabel="1s" name="x" draggable />,
        );
        expect((container.querySelector('.oj-waveform-view') as HTMLElement).draggable).toBe(true);
    });

    it('forwards pointer/drag callbacks and merges className', () => {
        const onPointerDown = vi.fn();
        const onDoubleClick = vi.fn();
        const onDragStart = vi.fn();
        const { container } = render(
            <WaveformView
                peaks={PEAKS}
                durationLabel="1s"
                name="x"
                className="extra"
                onPointerDown={onPointerDown}
                onDoubleClick={onDoubleClick}
                onDragStart={onDragStart}
            />,
        );
        const card = container.querySelector('.oj-waveform-view') as HTMLElement;
        expect(card.className).toContain('extra');

        card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        card.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }));
        expect(onPointerDown).toHaveBeenCalledTimes(1);
        expect(onDoubleClick).toHaveBeenCalledTimes(1);
        expect(onDragStart).toHaveBeenCalledTimes(1);
    });
});
