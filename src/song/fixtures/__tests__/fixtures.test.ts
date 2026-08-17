import { describe, expect, it } from 'vitest';
import { conduct } from '../../conduct';
import { buildDenseEdit } from '../denseEdit';
import { buildFirstLight } from '../firstLight';
import { buildHundredTracks } from '../hundredTracks';
import { buildPathological } from '../pathological';

const stable = (value: unknown) => JSON.stringify(value);

describe.each([
    ['firstLight', buildFirstLight],
    ['hundredTracks', buildHundredTracks],
    ['denseEdit', buildDenseEdit],
    ['pathological', buildPathological],
] as const)('%s fixture', (_name, build) => {
    it('is byte-deterministic and conduct-able', () => {
        const first = build();
        const second = build();
        expect(stable(first)).toBe(stable(second));
        const lowered = conduct(first, 'wasm');
        expect(lowered.timeline.events.length).toBeGreaterThan(0);
        expect(lowered.seconds).toBeGreaterThan(0);
    });
});

it('hundredTracks preserves the doctrine scale and mixed media', () => {
    const fixture = buildHundredTracks();
    expect(fixture.tracks).toHaveLength(100);
    expect(fixture.tracks.flatMap((track) => track.clips)).toHaveLength(2_000);
    const sources = Object.values(fixture.sources ?? {});
    expect(sources.filter((source) => source.kind === 'midi').flatMap((source) => source.notes)).toHaveLength(40_000);
    expect(sources.some((source) => source.kind === 'audio')).toBe(true);
});
