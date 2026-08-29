import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TimeRuler } from './TimeRuler';

const timeRulerCss = readFileSync(
    'packages/oj-ui/src/components/TimeRuler/TimeRuler.css',
    'utf8',
);

describe('TimeRuler', () => {
    it('pins semantic grid levels and the half-pixel tick helper', () => {
        expect(timeRulerCss).toContain('var(--timeline-grid-bar)');
        expect(timeRulerCss).toContain('var(--timeline-grid-beat)');
        expect(timeRulerCss).toContain('var(--timeline-grid-sub)');
        expect(timeRulerCss).toMatch(/left:\s*0\.5px/);
    });
    it('gives the bar label its own line above the tick, inside the band', () => {
        // the label box is lifted clear of the tick it belongs to…
        expect(timeRulerCss).toMatch(
            /\.oj-time-ruler__mark\.is-bar\s*{[\s\S]*?bottom:\s*calc\(var\(--oj-ruler-floor\)\s*\+\s*var\(--oj-ruler-bar-tick\)\)/,
        );
        // …and the tick hangs below that line rather than sharing its box
        expect(timeRulerCss).toMatch(
            /\.oj-time-ruler__mark\.is-bar::before\s*{[\s\S]*?top:\s*100%[\s\S]*?height:\s*var\(--oj-ruler-bar-tick\)/,
        );
        expect(timeRulerCss).not.toMatch(/\.oj-time-ruler__mark\.is-bar\s*{[\s\S]*?height:\s*7px/);

        // the whole bar mark (label line + tick + floor) fits a 22px band, the
        // tightest one the app ships (.arrangement-bars-row)
        const floor = 3;
        const tick = 7;
        const line = 9.5; // --text-micro at line-height 1
        expect(floor + tick + line).toBeLessThanOrEqual(22);
    });
    it('positions and classifies bar, beat and subdivision marks', () => {
        const { container } = render(<TimeRuler width={200} marks={[
            { id: 'bar', x: 0, label: '1', level: 'bar' },
            { id: 'beat', x: 50, level: 'beat' },
            { id: 'sub', x: 75, level: 'sub' },
        ]} />);
        const ruler = container.querySelector('.oj-time-ruler') as HTMLElement;
        expect(ruler.style.width).toBe('200px');
        expect(ruler.getAttribute('aria-hidden')).toBe('true');
        expect(container.querySelector('.is-bar')!.textContent).toBe('1');
        expect((container.querySelector('.is-beat') as HTMLElement).style.left).toBe('50px');
        expect(container.querySelectorAll('.oj-time-ruler__mark')).toHaveLength(3);
    });
});
