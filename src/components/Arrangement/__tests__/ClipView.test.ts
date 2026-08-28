import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { timebase } from '../../../song/time';
import { clipBarSpan } from '../geometry';
import { ClipView } from '../ClipView';

describe('ClipView bar labels', () => {
    it('uses the arrangement timebase for a non-4/4 meter', () => {
        const tb = timebase({ tempoBpm: 120, ppq: 960, timeSignature: [3, 4] });
        expect(clipBarSpan(tb, 2_880, 5_760)).toEqual({ startBar: 2, endBar: 3 });
    });

    it('treats the clip end as exclusive at an exact bar boundary', () => {
        const tb = timebase({ tempoBpm: 120, ppq: 960, timeSignature: [3, 4] });
        expect(clipBarSpan(tb, 0, 2_880)).toEqual({ startBar: 1, endBar: 1 });
    });

    it('wires a 3/4 arrangement timebase into the rendered ClipView label', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        HTMLElement.prototype.setPointerCapture = vi.fn();
        render(createElement(ClipView, { clip: { id: 'clip-1', sourceId: 'midi', startTick: 2_880, lengthTick: 5_760 }, source: { id: 'midi', kind: 'midi', name: 'Phrase', lengthTick: 8_640, notes: [] }, trackName: 'Keys', range: { lo: 48, hi: 72 }, pxPerTick: 0.1, laneHeight: 72, selected: false, trackId: 'track-1', timebase: timebase({ tempoBpm: 120, ppq: 960, timeSignature: [3, 4] }), onSelect: () => undefined }));
        expect(screen.getByRole('listitem')).toHaveAccessibleName('Keys — bars 2 to 3, 0 notes');
    });
});
