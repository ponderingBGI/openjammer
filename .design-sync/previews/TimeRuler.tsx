import type { ReactNode } from 'react';
import { TimeRuler } from '@openjammer/oj-ui';

/**
 * TimeRuler fills its parent's height (`height: 100%`) and hangs its marks off the
 * bottom edge, so it needs a strip with a real height AND a few px of room below —
 * the bar labels overhang the ruler box and a clipping wrapper cuts them in half.
 */
const strip = (children: ReactNode) => (
    <div
        style={{
            width: 312,
            paddingBottom: 8,
            background: 'var(--timeline-chrome-bg)',
            borderBottom: '1px solid var(--timeline-lane-divider)',
        }}
    >
        <div style={{ height: 26 }}>{children}</div>
    </div>
);

/** Zoomed out — one tick per bar, carrying the bar number. */
export const Bars = () => strip(
    <TimeRuler
        width={312}
        marks={Array.from({ length: 4 }, (_, bar) => ({
            id: `bar-${bar}`,
            x: bar * 78,
            label: String(bar + 1),
            level: 'bar' as const,
        }))}
    />,
);

/**
 * Zoomed in on two bars — the three tick levels step down in height:
 * `bar` (tallest, numbered), `beat`, then `sub` sixteenths.
 */
export const BarsBeatsAndSubdivisions = () => {
    const BAR = 156;
    return strip(
        <TimeRuler
            width={312}
            marks={Array.from({ length: 2 }).flatMap((_, bar) =>
                Array.from({ length: 4 }).flatMap((_, beat) => {
                    const beatX = bar * BAR + (beat * BAR) / 4;
                    const isBar = beat === 0;
                    return [
                        {
                            id: `${bar}-${beat}`,
                            x: beatX,
                            label: isBar ? String(bar + 1) : undefined,
                            level: (isBar ? 'bar' : 'beat') as 'bar' | 'beat',
                        },
                        ...Array.from({ length: 3 }, (_, sub) => ({
                            id: `${bar}-${beat}-${sub}`,
                            x: beatX + ((sub + 1) * BAR) / 16,
                            level: 'sub' as const,
                        })),
                    ];
                }),
            )}
        />,
    );
};
