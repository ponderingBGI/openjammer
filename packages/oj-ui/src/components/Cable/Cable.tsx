import { memo } from 'react';
import type { CSSProperties, SVGProps } from 'react';
import { cablePath } from './cablePath';
import type { CablePoint } from './cablePath';
import './Cable.css';

export type CableKind = 'audio' | 'control' | 'universal';

export interface CableProps
    extends Omit<SVGProps<SVGPathElement>, 'd' | 'onSelect' | 'start' | 'end'> {
    /** Where the cable leaves the source port (canvas coords). */
    start: CablePoint;
    /** Where the cable enters the target port (canvas coords). */
    end: CablePoint;
    /** What travels the cable: `audio` (blue), `control` (grey), `universal`
     *  (violet). Stroke color follows the type — Port-Color-Is-Meaning. */
    kind: CableKind;
    /** Selected — brightens to the kind's connected color and thickens. */
    selected?: boolean;
    /** This cable stands in for several wired together — drawn heavier. */
    bundled?: boolean;
    /** How many connections the bundle represents (for the hover `<title>`). */
    bundleCount?: number;
    /** Live signal RMS, 0..1 — subtly raises stroke-width and opacity so a hot
     *  cable reads as alive. No blur (Hard-Shadow): width and opacity only. */
    signalLevel?: number;
    /** In-progress drag from a port to the cursor — drawn dashed. */
    temp?: boolean;
    /** Click the stroke to select the connection. */
    onSelect?: () => void;
}

/**
 * A connection cable between two ports, drawn as a single SVG `<path>` inside
 * a `<g>`. Theme-agnostic: stroke comes from the kind's wiring token, so it
 * recolors with the active theme. The stroke is the only pointer target, so a
 * click selects the cable without swallowing the canvas underneath. Wrapped in
 * `React.memo` with a comparator that treats sub-1% `signalLevel` changes as
 * equal — the live-canvas perf guard for 60fps meter updates.
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
    const classes = [
        'oj-cable',
        `oj-cable--${kind}`,
        selected && 'is-selected',
        bundled && 'is-bundled',
        temp && 'is-temp',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    const signalStyle = {
        ...style,
        // Clamp + fixed precision so the variable is stable and CSS calc-friendly.
        '--oj-cable-signal': Math.max(0, Math.min(1, signalLevel)).toFixed(3),
    } as CSSProperties;

    return (
        <g className="oj-cable-group">
            <path
                d={cablePath(start, end)}
                className={classes}
                style={signalStyle}
                onClick={
                    onSelect
                        ? (e) => {
                              e.stopPropagation();
                              onSelect();
                          }
                        : undefined
                }
                {...rest}
            />
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
