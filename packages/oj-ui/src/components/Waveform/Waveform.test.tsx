import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Waveform } from './Waveform';

const sine = Array.from({ length: 16 }, (_, i) => Math.sin((i / 15) * Math.PI * 2));

describe('Waveform', () => {
    it('renders the base wrapper, an svg, and a polyline trace', () => {
        const { container } = render(<Waveform data={sine} />);
        const root = container.querySelector('.oj-waveform')!;
        expect(root).not.toBeNull();
        expect(root.className).toBe('oj-waveform');
        expect(container.querySelector('svg.oj-waveform__svg')).not.toBeNull();
        expect(container.querySelector('polyline.oj-waveform__trace')).not.toBeNull();
    });

    it('applies the given height to the wrapper and defaults to 48', () => {
        const { container: a } = render(<Waveform data={sine} />);
        expect((a.querySelector('.oj-waveform') as HTMLElement).style.height).toBe('48px');
        const { container: b } = render(<Waveform data={sine} height={96} />);
        expect((b.querySelector('.oj-waveform') as HTMLElement).style.height).toBe('96px');
    });

    it('builds one polyline point per sample', () => {
        const { container } = render(<Waveform data={sine} />);
        const pts = container.querySelector('polyline.oj-waveform__trace')!.getAttribute('points')!;
        expect(pts.trim().split(/\s+/).length).toBe(sine.length);
    });

    it('omits the trace for an empty or single-point buffer', () => {
        const { container: empty } = render(<Waveform data={[]} />);
        expect(empty.querySelector('polyline.oj-waveform__trace')).toBeNull();
        const { container: one } = render(<Waveform data={[0.5]} />);
        expect(one.querySelector('polyline.oj-waveform__trace')).toBeNull();
    });

    it('draws the playhead only when a finite fraction is given, clamped to [0,1]', () => {
        const { container: none } = render(<Waveform data={sine} />);
        expect(none.querySelector('.oj-waveform__playhead')).toBeNull();

        const { container } = render(<Waveform data={sine} playhead={0.25} />);
        const ph = container.querySelector('.oj-waveform__playhead')!;
        expect(ph.getAttribute('x1')).toBe('250'); // 0.25 * 1000 viewBox width

        const { container: over } = render(<Waveform data={sine} playhead={5} />);
        expect(over.querySelector('.oj-waveform__playhead')!.getAttribute('x1')).toBe('1000');
    });

    it('renders the center line only when showCenterLine is set', () => {
        const { container: off } = render(<Waveform data={sine} />);
        expect(off.querySelector('.oj-waveform__center')).toBeNull();
        const { container: on } = render(<Waveform data={sine} showCenterLine />);
        const center = on.querySelector('.oj-waveform__center')!;
        expect(center.getAttribute('y1')).toBe('50'); // viewBox center
        expect(center.getAttribute('y2')).toBe('50');
    });

    it('adds the recording state class', () => {
        const { container } = render(<Waveform data={sine} recording />);
        expect(container.querySelector('.oj-waveform')!.className).toContain('is-recording');
    });

    it('maps bipolar samples around the center axis', () => {
        // A peak of +1 sits at the top (y=0); the trough -1 at the bottom (y=100).
        const { container } = render(<Waveform data={[1, -1]} />);
        const pts = container.querySelector('polyline.oj-waveform__trace')!.getAttribute('points')!;
        expect(pts).toBe('0,0 1000,100');
    });

    it('maps a unipolar (0..1) buffer as height from the bottom', () => {
        // No negative sample => 0 sits at the bottom (y=100), 1 at the top (y=0).
        const { container } = render(<Waveform data={[0, 1]} />);
        const pts = container.querySelector('polyline.oj-waveform__trace')!.getAttribute('points')!;
        expect(pts).toBe('0,100 1000,0');
    });

    it('forwards aria-label onto the svg and merges custom className', () => {
        const { container } = render(
            <Waveform data={sine} aria-label="Loop buffer" className="mine" />,
        );
        expect(container.querySelector('.oj-waveform')!.className).toContain('mine');
        expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Loop buffer');
    });
});
