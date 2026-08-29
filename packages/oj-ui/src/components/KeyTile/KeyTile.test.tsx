import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { KeyTile } from './KeyTile';

const keyTileCss = readFileSync(
    'packages/oj-ui/src/components/KeyTile/KeyTile.css',
    'utf8',
);

type Box = { left: number; top: number; right: number; bottom: number };

function intersects(a: Box, b: Box) {
    return Math.min(a.right, b.right) > Math.max(a.left, b.left)
        && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
}

/** Pull a number out of the stylesheet so the model cannot drift from the CSS. */
function cssNumber(pattern: RegExp) {
    const match = keyTileCss.match(pattern);
    if (!match) throw new Error(`KeyTile.css no longer declares ${pattern}`);
    return Number(match[1]);
}

/* The geometry the CSS actually declares — read out of the file, not retyped. */
const PORT_MIN = cssNumber(/--port-size:\s*clamp\((\d+(?:\.\d+)?)px/);
const PORT_RATIO = cssNumber(/--port-size:\s*clamp\([^;]*?\*\s*(\d+(?:\.\d+)?)\)/);
const PORT_MAX = cssNumber(/--port-size:\s*clamp\([^;]*?,\s*(\d+(?:\.\d+)?)px\)/);
const INSET_MIN = cssNumber(/--oj-key-tile-socket-inset:\s*clamp\(\s*(\d+(?:\.\d+)?)px/);
const INSET_RATIO = cssNumber(/--oj-key-tile-socket-inset:[\s\S]*?\*\s*(\d+(?:\.\d+)?)\)/);
const INSET_MAX = cssNumber(/--oj-key-tile-socket-inset:[\s\S]*?,\s*(\d+(?:\.\d+)?)px\s*\)/);
const GAP_MIN = cssNumber(/--oj-key-tile-gap:\s*clamp\((\d+(?:\.\d+)?)px/);
const GAP_RATIO = cssNumber(/--oj-key-tile-gap:\s*clamp\([^;]*?\*\s*(\d+(?:\.\d+)?)\)/);
const GAP_MAX = cssNumber(/--oj-key-tile-gap:\s*clamp\([^;]*?,\s*(\d+(?:\.\d+)?)px\)/);
const BASE_MAX = cssNumber(/--oj-key-tile-base:\s*min\((\d+(?:\.\d+)?)px/);
const BASE_RATIO = cssNumber(/--oj-key-tile-base:\s*min\([^;]*?\*\s*(\d+(?:\.\d+)?)\)/);
const KEY_GAP_MAX = cssNumber(/\.oj-key-tile--key\s*{[\s\S]*?gap:\s*min\((\d+(?:\.\d+)?)px/);
const KEY_GAP_RATIO = cssNumber(/\.oj-key-tile--key\s*{[\s\S]*?gap:\s*min\([^;]*?\*\s*(\d+(?:\.\d+)?)\)/);
const KEY_BASE_MAX = cssNumber(/\.oj-key-tile--key\s*{[\s\S]*?padding-bottom:\s*min\((\d+(?:\.\d+)?)px/);
const KEY_BASE_RATIO = cssNumber(/\.oj-key-tile--key\s*{[\s\S]*?padding-bottom:\s*min\([^;]*?\*\s*(\d+(?:\.\d+)?)\)/);
/* `--key-tile-size`, the fallback sizing axis when no `size` prop is given. */
const DEFAULT_AXIS = 48;
const BORDER = 1;
/* Line boxes: `font: 600 10px/1` on the base, the key's own size-relative
   legend, and the 9px/1 hint chip inside its own 2px vertical padding. */
const BASE_LABEL_H = 10;
const KEY_FONT_MAX = cssNumber(/\.oj-key-tile--key\s*{[\s\S]*?font:\s*600 min\((\d+(?:\.\d+)?)px/);
const KEY_FONT_RATIO = cssNumber(/\.oj-key-tile--key\s*{[\s\S]*?font:\s*600 min\([^;]*?\*\s*(\d+(?:\.\d+)?)\)/);
const HINT_H = 9 + 2 * 2;

/* The reserved lane only exists if the stylesheet actually spends its padding
   on it — so the model reads that fact out of the CSS rather than assuming it. */
const RESERVES_LANE = /padding:\s*var\(--oj-key-tile-socket-band\)/.test(keyTileCss)
    && /--oj-key-tile-socket-band:\s*calc\(\s*var\(--oj-key-tile-socket-inset\)\s*\+\s*var\(--port-size\)\s*\+\s*var\(--oj-key-tile-gap\)\s*\)/
        .test(keyTileCss);

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The boxes the declared CSS produces for a tile of `width` x `height`. The
 * label box is modelled at the FULL content width — the strongest form of the
 * claim: even a label as wide as the whole tile cannot reach the socket,
 * because the socket owns a reserved top band that the label stack never
 * enters. Only the vertical lanes can decide the question.
 */
function keyTileBoxes({
    width,
    height,
    variant,
    hint = false,
    size,
}: {
    width: number;
    height: number;
    variant: 'key' | 'pad' | 'black' | 'white';
    hint?: boolean;
    size?: number;
}) {
    // Only the `size` prop feeds `--oj-key-tile-size`; an inline width/height
    // override (KeyboardVisualNode) leaves the axis on its `--key-tile-size`
    // fallback, so the model must use the fallback there too.
    const axis = size ?? DEFAULT_AXIS;
    const portSize = clamp(PORT_MIN, axis * PORT_RATIO, PORT_MAX);
    const inset = clamp(INSET_MIN, axis * INSET_RATIO, INSET_MAX);
    const gap = variant === 'key'
        ? Math.min(KEY_GAP_MAX, axis * KEY_GAP_RATIO)
        : clamp(GAP_MIN, axis * GAP_RATIO, GAP_MAX);
    const base = variant === 'key'
        ? Math.min(KEY_BASE_MAX, axis * KEY_BASE_RATIO)
        : Math.min(BASE_MAX, axis * BASE_RATIO);
    const band = RESERVES_LANE ? inset + portSize + gap : 0;

    const contentTop = BORDER + band;
    const contentBottom = height - BORDER - base;
    const labelH = variant === 'key'
        ? Math.min(KEY_FONT_MAX, axis * KEY_FONT_RATIO)
        : BASE_LABEL_H;
    // `key` stacks the chip above the label; the others sit on one bottom row.
    const stackH = hint
        ? (variant === 'key' ? labelH + gap + HINT_H : Math.max(labelH, HINT_H))
        : labelH;

    return {
        contentTop,
        stackTop: contentBottom - stackH,
        port: {
            left: width - BORDER - inset - portSize,
            top: BORDER + inset,
            right: width - BORDER - inset,
            bottom: BORDER + inset + portSize,
        },
        label: {
            left: BORDER + inset,
            top: contentBottom - labelH,
            right: width - BORDER - inset,
            bottom: contentBottom,
        },
    };
}

describe('KeyTile', () => {
    it('pins the pad geometry, press physics and solid hit treatment', () => {
        expect(keyTileCss).toMatch(/--pad[\s\S]*?var\(--oj-key-tile-size, var\(--key-tile-size\)\)/);
        expect(keyTileCss).toContain('scale(var(--press-scale-pad))');
        expect(keyTileCss).toMatch(/\.oj-key-tile\.is-active[\s\S]*?var\(--accent-primary\)[\s\S]*?var\(--shadow-pressed\)/);
        expect(keyTileCss).not.toMatch(/\.oj-key-tile\.is-active[\s\S]*?(glow|drop-shadow)/);
    });
    it('renders the base + variant classes and defaults to type=button', () => {
        const { container } = render(<KeyTile variant="key" label="A" />);
        const btn = container.querySelector('button')!;
        expect(btn.className).toContain('oj-key-tile');
        expect(btn.className).toContain('oj-key-tile--key');
        expect(btn.getAttribute('type')).toBe('button');
    });

    it('renders the label and an embedded control Port', () => {
        const { container } = render(<KeyTile variant="white" label="C" />);
        expect(container.querySelector('.oj-key-tile__label')!.textContent).toBe('C');
        const port = container.querySelector('.oj-key-tile__port')!;
        expect(port.className).toContain('oj-port');
        expect(port.className).toContain('oj-port--control');
    });

    it('omits the label span when no label is given', () => {
        const { container } = render(<KeyTile variant="pad" />);
        expect(container.querySelector('.oj-key-tile__label')).toBeNull();
    });

    it('applies active and connected state classes', () => {
        const { container } = render(<KeyTile variant="pad" active connected label="x" />);
        const cls = container.querySelector('button')!.className;
        expect(cls).toContain('is-active');
        expect(cls).toContain('is-connected');
        // the connected state propagates to the embedded port core (never a glow)
        expect(container.querySelector('.oj-key-tile__port')!.className).toContain('is-connected');
    });

    it('selects each variant modifier', () => {
        for (const v of ['key', 'pad', 'black', 'white'] as const) {
            const { container } = render(<KeyTile variant={v} />);
            expect(container.querySelector('button')!.className).toContain(`oj-key-tile--${v}`);
        }
    });

    it('forwards data-* attributes and pointer handlers to the tile', () => {
        const onPointerDown = vi.fn();
        const { container } = render(
            <KeyTile
                variant="key"
                label="A"
                data-node-id="n1"
                data-port-id="out"
                data-port-type="control"
                onPointerDown={onPointerDown}
            />,
        );
        const btn = container.querySelector('button')!;
        expect(btn.getAttribute('data-node-id')).toBeNull();
        const port = container.querySelector('.oj-key-tile__port')!;
        expect(port.getAttribute('data-node-id')).toBe('n1');
        expect(port.getAttribute('data-port-id')).toBe('out');
        expect(port.getAttribute('data-port-type')).toBe('control');
        fireEvent.pointerDown(btn);
        expect(onPointerDown).toHaveBeenCalledTimes(1);
    });

    it('renders the inset hint and applies a numeric vignette size', () => {
        const { container } = render(<KeyTile variant="pad" label="Kick" hint="Q" size={34} />);
        const button = container.querySelector('button')!;
        expect(container.querySelector('.oj-key-tile__hint')!.textContent).toBe('Q');
        expect(button.style.getPropertyValue('--oj-key-tile-size')).toBe('34px');
    });

    it('reserves a size-relative socket lane with the label anchored below it', () => {
        // The lane itself: a top band as tall as the well, expressed as padding
        // so a consumer class that re-centres the tile cannot dissolve it.
        expect(keyTileCss).toMatch(/--oj-key-tile-sizing-axis:\s*var\(--oj-key-tile-size/);
        expect(RESERVES_LANE, 'the socket band is not what the tile spends its top padding on').toBe(true);
        expect(keyTileCss).toMatch(/--port-size:\s*clamp\([\s\S]*?var\(--oj-key-tile-sizing-axis\)/);
        expect(keyTileCss).toMatch(/\.oj-key-tile__port\s*{[\s\S]*?top:\s*var\(--oj-key-tile-socket-inset\)/);
        expect(keyTileCss).toMatch(/\.oj-key-tile--key\s*{[\s\S]*?justify-content:\s*flex-end/);

        // The default well is still the shared 18px one at 48px and up.
        expect(clamp(PORT_MIN, 48 * PORT_RATIO, PORT_MAX)).toBe(18);
        expect(Math.min(BASE_MAX, 48 * BASE_RATIO)).toBe(5);
        // …and the handoff `.key` gap/baseline at the same default axis
        expect(Math.min(KEY_GAP_MAX, 48 * KEY_GAP_RATIO)).toBe(4);
        expect(Math.min(KEY_BASE_MAX, 48 * KEY_BASE_RATIO)).toBe(6);
        expect(Math.min(KEY_FONT_MAX, 48 * KEY_FONT_RATIO)).toBe(11);

        const cases = [
            { name: 'pad 34 (canvas vignette)', variant: 'pad' as const, width: 34, height: 34, size: 34 },
            { name: 'pad 48 (default)', variant: 'pad' as const, width: 48, height: 48, size: 48 },
            { name: 'pad 50', variant: 'pad' as const, width: 50, height: 50, size: 50 },
            { name: 'pad 74', variant: 'pad' as const, width: 74, height: 74, size: 74 },
            { name: 'key 34x74 + hint', variant: 'key' as const, width: 34, height: 74, hint: true },
            { name: 'key size=34 (vignette)', variant: 'key' as const, width: 34, height: 34, size: 34 },
            { name: 'key size=74', variant: 'key' as const, width: 74, height: 74, size: 74 },
            { name: 'key 50x50 (KeyboardVisualNode)', variant: 'key' as const, width: 50, height: 50 },
            { name: 'key 300x50 (spacebar)', variant: 'key' as const, width: 300, height: 50 },
            { name: 'white 34x96', variant: 'white' as const, width: 34, height: 96 },
            { name: 'black 24x64', variant: 'black' as const, width: 24, height: 64 },
        ];

        for (const c of cases) {
            const { container } = render(
                <KeyTile
                    variant={c.variant}
                    label="C4"
                    hint={c.hint ? 'A' : undefined}
                    size={c.size}
                    style={c.size == null ? { width: c.width, height: c.height } : undefined}
                />,
            );
            expect(container.querySelector('.oj-key-tile__label')).not.toBeNull();
            expect(container.querySelector('.oj-key-tile__port')).not.toBeNull();

            const boxes = keyTileBoxes(c);
            expect(intersects(boxes.label, boxes.port), `${c.name}: label over socket`).toBe(false);
            // …and the label stack fits inside the lane it was given, so it can
            // never overflow upward into the band either.
            expect(boxes.stackTop, `${c.name}: stack overflows into the socket band`)
                .toBeGreaterThanOrEqual(boxes.contentTop);
        }
    });

    it('keeps the hit hint chip AA-readable in light', () => {
        // The lit face is `--accent-primary` with dark `--text-on-accent` ink in
        // BOTH themes, so a translucent on-accent wash reads 3.81:1. The chip is
        // an inset legend instead: the library's own surface/ink pair.
        expect(keyTileCss).toMatch(
            /\.oj-key-tile\.is-active \.oj-key-tile__hint\s*{[\s\S]*?background:\s*var\(--bg-node\)[\s\S]*?color:\s*var\(--accent-ink\)/,
        );
        expect(keyTileCss).not.toMatch(
            /\.oj-key-tile\.is-active \.oj-key-tile__hint\s*{[\s\S]*?color:\s*var\(--text-on-accent\)/,
        );
    });

    it('keeps the white face lighter than the black face in BOTH themes', () => {
        // A piano key is a physical object. Mixing toward literal white/black
        // (not toward --bg-node / --text-primary, which trade places between
        // themes) is what stops dark mode handing a pianist an inverted keyboard.
        expect(keyTileCss).toMatch(
            /--oj-piano-white:\s*color-mix\(in oklab,\s*var\(--bg-node\)\s*\d+%,\s*white\)/,
        );
        expect(keyTileCss).toMatch(
            /--oj-piano-black:\s*color-mix\(in oklab,\s*var\(--text-primary\)\s*\d+%,\s*black\)/,
        );
        expect(keyTileCss).toMatch(
            /\.oj-key-tile--white\s*{[\s\S]*?background:\s*var\(--oj-piano-white\);[\s\S]*?color:\s*var\(--oj-piano-black\)/,
        );
        expect(keyTileCss).toMatch(
            /\.oj-key-tile--black\s*{[\s\S]*?background:\s*var\(--oj-piano-black\);[\s\S]*?color:\s*var\(--oj-piano-white\)/,
        );
        // the ink of one face IS the face of the other — no theme-flipping token
        // is left anywhere in the piano pair
        expect(keyTileCss).not.toMatch(
            /\.oj-key-tile--(white|black)\s*{[\s\S]*?color:\s*color-mix\(in oklab,\s*var\(--text-primary\)/,
        );
        expect(keyTileCss).not.toMatch(/\.oj-key-tile--black:not\(\.is-active\) \.oj-key-tile__label/);
    });

    it('merges a custom className', () => {
        const { container } = render(<KeyTile variant="key" className="mine" />);
        expect(container.querySelector('button')!.className).toContain('mine');
    });
});
