import { memo } from 'react';
import type { CSSProperties, SVGProps } from 'react';
import { cablePath } from './cablePath';
import type { CablePoint } from './cablePath';
import './Cable.css';

export type CableKind = 'audio' | 'control' | 'universal';

export interface CableProps
    extends Omit<SVGProps<SVGPathElement>, 'd' | 'onSelect' | 'start' | 'end'> {
    /** Where the cable leaves the source socket (canvas coords). */
    start: CablePoint;
    /** Where the cable enters the target socket (canvas coords). */
    end: CablePoint;
    /** What travels the cable: `audio` (teal), `control` (grey), `universal`
     *  (violet). Stroke color follows the type — Port-Color-Is-Meaning. */
    kind: CableKind;
    /** Selected — full opacity, a pixel wider, and an accent halo. */
    selected?: boolean;
    /** This cable stands in for several wired together — drawn heavier. */
    bundled?: boolean;
    /** How many connections the bundle represents (for the hover `<title>`). */
    bundleCount?: number;
    /** Live signal RMS, 0..1 — raises stroke-width, opacity and the glow. This
     *  is the canvas's meter: a cable is one of the only two things here allowed
     *  to light up, and only while it is actually carrying sound. */
    signalLevel?: number;
    /** In-progress drag from a socket to the cursor — drawn dashed. */
    temp?: boolean;
    /** Click the stroke to select the connection. */
    onSelect?: () => void;
}

/**
 * A connection cable between two sockets: an SVG `<g>` holding a fat invisible
 * hit path and, over it, the visible wire. The wire is `pointer-events: none`
 * and the hit path is 14px wide, so a 2.5px quiet cable is still clickable at
 * any zoom without either path stealing the canvas underneath.
 *
 * Theme-agnostic: stroke AND `color` come from the kind's wiring token, so the
 * signal glow (which draws with `currentColor`) matches the wire instead of
 * inheriting the surrounding text ink. Wrapped in `React.memo` with a
 * comparator that treats sub-1% `signalLevel` changes as equal — the
 * live-canvas perf guard for 60fps meter updates.
 */
function CableBase({
    start,
    end,
    kind,
    selected = false,
    bundled = false,
    bundleCount = 0,
    signalLevel = 0,
    temp = false,
    onSelect,
    className,
    style,
    ...rest
}: CableProps) {
    const signal = Math.max(0, Math.min(1, signalLevel));
    const states = [
        selected && 'is-selected',
        bundled && 'is-bundled',
        temp && 'is-temp',
        signal === 0 && 'is-quiet',
    ].filter(Boolean) as string[];

    const classes = ['oj-cable', `oj-cable--${kind}`, ...states, className]
        .filter(Boolean)
        .join(' ');

    const signalStyle = {
        ...style,
        // Clamp + fixed precision so the variable is stable and CSS calc-friendly.
        '--oj-cable-signal': signal.toFixed(3),
    } as CSSProperties;

    const d = cablePath(start, end);
    const handleSelect = onSelect
        ? (e: React.MouseEvent<SVGPathElement>) => {
              e.stopPropagation();
              onSelect();
          }
        : undefined;

    return (
        <g className={['oj-cable-group', ...states].join(' ')}>
            {/* The click target, under the wire and invisible (UI-022). */}
            <path d={d} className="oj-cable__hit" onClick={handleSelect} />
            <path d={d} className={classes} style={signalStyle} {...rest} />
            {bundled && bundleCount > 1 && (
                <title>{`Bundle (${bundleCount} connections)`}</title>
            )}
        </g>
    );
}

/**
 * Skip the re-render when nothing visible changed. Signal level drifts every
 * audio frame; a change under 1% is below what the eye reads as motion, so we
 * treat it as equal and let the canvas stay still.
 */
function areEqual(prev: CableProps, next: CableProps): boolean {
    return (
        prev.start.x === next.start.x &&
        prev.start.y === next.start.y &&
        prev.end.x === next.end.x &&
        prev.end.y === next.end.y &&
        prev.kind === next.kind &&
        prev.selected === next.selected &&
        prev.bundled === next.bundled &&
        prev.bundleCount === next.bundleCount &&
        prev.temp === next.temp &&
        prev.onSelect === next.onSelect &&
        prev.className === next.className &&
        Math.abs((prev.signalLevel ?? 0) - (next.signalLevel ?? 0)) < 0.01
    );
}

export const Cable = memo(CableBase, areEqual);
