/**
 * The onboarding option glyphs — miniatures of the instrument itself.
 *
 * Each is a tiny, true picture of what the answer leads to: lit pads, keys, a
 * dial with a tick, an audio waveform in the wiring colour. They are drawn from
 * the same tokens as the real controls (`--bg-node`, `--border-control`,
 * `--accent-primary`, `--audio-connection`), so they read as the same instrument
 * at 15px as they do at 48px.
 *
 * They are deliberately NOT real `KeyTile` / `Knob` instances: those carry an
 * embedded port and a `role="slider"`, and a decorative control that announces
 * itself to a screen reader — or shows a socket at 15px — is noise, not
 * fidelity. The whole glyph is `aria-hidden`; the option's text carries meaning.
 */

/*
 * These are element BUILDERS, not components: they are called, never mounted, so
 * the module exports one frozen table of markup rather than a family of
 * one-line components nobody renders directly.
 */

const pad = (key: string, lit = false) => <span key={key} className={`ob-glyph__pad${lit ? ' is-lit' : ''}`} />;

const tile = (key: string, lit = false) => <span key={key} className={`ob-glyph__key${lit ? ' is-lit' : ''}`} />;

/** A dial at a fixed angle, sweeping the same -135°…+135° a real Knob does. */
const dial = (key: string, turn: number) => (
    <span key={key} className="ob-glyph__knob">
        <i style={{ transform: `rotate(${-135 + 270 * Math.max(0, Math.min(1, turn))}deg)` }} />
    </span>
);

/** A little audio waveform, in the wiring colour — "this one makes sound". */
const wave = (key: string) => (
    <svg key={key} width="34" height="16" viewBox="0 0 34 16" focusable="false" style={{ overflow: 'visible' }}>
        <path
            d="M0 8 Q 4 1 8 8 T 16 8 T 24 8 T 32 8"
            stroke="var(--audio-connection)"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
        />
    </svg>
);

export const OPTION_GLYPHS = {
    first: [pad('a', true), pad('b'), pad('c')],
    some: [tile('a'), tile('b', true), tile('c'), pad('d')],
    pro: [dial('a', 0.32), dial('b', 0.72), <span key="v" className="ob-glyph__value">-6.0</span>],
    jam: [tile('a'), tile('b', true), tile('c'), tile('d')],
    beat: [pad('a', true), pad('b'), pad('c')],
    sound: [dial('a', 0.37), wave('w')],
} as const;

export type GlyphId = keyof typeof OPTION_GLYPHS;
