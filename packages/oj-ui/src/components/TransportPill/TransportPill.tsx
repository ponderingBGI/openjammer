import {
    useEffect,
    useId,
    useRef,
    useState,
    type HTMLAttributes,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type RefObject,
} from 'react';
import { Input } from '../Input/Input';
import { Kbd } from '../Kbd/Kbd';
import './TransportPill.css';

/** Record button state. Omit the whole prop to hide the zone. */
export interface TransportRecord {
    /** True while the engine is actually recording. */
    recording: boolean;
    /** Nothing is armed (or recording is impossible here) — dimmed, with a reason. */
    disabled?: boolean;
    /** Tooltip shown when `disabled` — say WHY, never just refuse. */
    disabledReason?: string;
    /** Armed, but the playhead is outside the punch range: shown at 48%. */
    outsidePunch?: boolean;
    onToggle: () => void;
}

/** The bar.beat readout. Omit to hide the zone. */
export interface TransportPosition {
    /** Pre-formatted `bar.beat[.tick]` — the owner formats, the pill never parses. */
    display: string;
    /** A transport command is in flight and unconfirmed: the readout goes muted. */
    pending?: boolean;
    /** Commit a typed position, exactly as the player wrote it. */
    onSeek?: (text: string) => void;
}

/** The tempo scrubber. Omit to hide the zone. */
export interface TransportTempo {
    value: number;
    min?: number;
    max?: number;
    /** Fired ONCE when the gesture ends — one undo step per drag. */
    onCommit: (bpm: number) => void;
    /** No song, no tempo. Dimmed and inert, with a reason instead of a shrug. */
    disabled?: boolean;
    disabledReason?: string;
}

/** Loop toggle. Omit to hide. */
export interface TransportLoop {
    on: boolean;
    onToggle: () => void;
}

/** Metronome + count-in. Omit to hide. */
export interface TransportMetronome {
    on: boolean;
    /** 0, 1 or 2 bars — rendered as a superscript on the glyph when > 0. */
    countInBars: 0 | 1 | 2;
    onToggle: () => void;
    onCountIn: (bars: 0 | 1 | 2) => void;
}

export interface TransportPillProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onPlay'> {
    /** Is the transport rolling right now? Drives the glyph and the label. */
    playing: boolean;
    /** The one transport gesture. Must run synchronously — it is a user gesture. */
    onPlayToggle: () => void;
    /** Verb for the play button's accessible name when stopped. Default "Play". */
    playLabel?: string;
    /** Verb when rolling. Default "Stop". */
    stopLabel?: string;
    /**
     * Spec §7's SECOND Stop is armed: the transport is stopped away from where
     * playback last started, so the next press of this button rewinds there
     * rather than playing. The glyph and the name follow, because a play
     * triangle that does not play is the second-worst lie this component can
     * tell (the worst is a stop square over a rolling transport). Ignored while
     * `playing`.
     */
    returnArmed?: boolean;
    /** Accessible name for the armed second Stop. Default "Return to where playback started". */
    returnLabel?: string;
    /**
     * Cold-load attention pulse. TRUE only in the browser tier, only before the
     * first user gesture of the session, and never while rolling — a pulsing
     * button on stage is noise. The pill enforces the last of those itself.
     */
    pulse?: boolean;
    /** Return-to-start (`Home`). Omit to hide the zone. */
    onReturnToStart?: () => void;
    record?: TransportRecord;
    position?: TransportPosition;
    /**
     * A ref onto the bar.beat readout element. A rolling playhead moves every
     * frame, and a position that arrived through React state would put the whole
     * tree on the transport's clock. The owner writes `textContent` here from the
     * app's shared animation frame instead; `position.display` remains what React
     * renders when the transport is still, and the two never fight because React
     * leaves an unchanged text child alone.
     */
    positionRef?: RefObject<HTMLSpanElement | null>;
    tempo?: TransportTempo;
    loop?: TransportLoop;
    metronome?: TransportMetronome;
    /** The live meter — pass `<Meter ref={…} />`; the pill never drives it. */
    meter?: ReactNode;
    /** Keycap hint at the tail, e.g. `space`. Omit when the key is not bound. */
    hint?: string;
    /**
     * Why the transport is not doing what it was told — the engine's silence, a
     * track with no instrument. It belongs to the PLAY BUTTON, not to the group:
     * the button is what wears the warning dot, so it is what a pointer hovers
     * and what a keyboard lands on, and a description hung on the surrounding
     * `role="group"` is read on entry and never again. Composed into the
     * button's own `title` and named by its `aria-describedby`.
     */
    faultReason?: string;
}

const PlayGlyph = () => (
    <svg viewBox="0 0 14 16" width="13" height="15" aria-hidden="true" focusable="false">
        <path d="M2 1.6 12.2 8 2 14.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
);

const StopGlyph = () => (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill="currentColor" />
    </svg>
);

/**
 * Spec §7's SECOND Stop: go back to where playback last started. Deliberately
 * NOT the `ReturnGlyph` below — that one sits two controls away and means "to
 * bar 1", and two identical arrows 40px apart meaning different ticks is exactly
 * the kind of thing a hand learns wrong once and then trusts. Filled bar +
 * filled triangle is the universal rewind mark; the neighbour stays a hairline.
 */
const RewindGlyph = () => (
    <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true" focusable="false">
        <path d="M12.4 1.8 4.4 7l8 5.2Z" fill="currentColor" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <rect x="1.3" y="1.6" width="2.2" height="10.8" rx="1.1" fill="currentColor" />
    </svg>
);

const ReturnGlyph = () => (
    <svg viewBox="0 0 16 12" width="15" height="12" aria-hidden="true" focusable="false">
        <path d="M14.5 1.6 6.2 6l8.3 4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.4 1v10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
);

const LoopGlyph = () => (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <path d="M3 6.6A4 4 0 0 1 7 3h5.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M10.4 1.1 12.9 3l-2.5 1.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 9.4A4 4 0 0 1 9 13H3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5.6 14.9 3.1 13l2.5-1.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ClickGlyph = () => (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
        <circle cx="5" cy="12" r="2.6" fill="currentColor" />
        <path d="M7.6 12V3.2l4.6-1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** How long a press must hold before it opens the count-in popover. */
const LONG_PRESS_MS = 450;

/** Tempo drag: 3px of travel per BPM (the handoff's feel). */
const PX_PER_BPM = 3;

function TempoZone({ tempo }: { tempo: TransportTempo }) {
    const min = tempo.min ?? 20;
    const max = tempo.max ?? 300;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    // The live value during a drag. React state here is fine: it changes only
    // while a finger is down, never per audio frame.
    const [dragValue, setDragValue] = useState<number | null>(null);
    const moved = useRef(false);

    const shown = dragValue ?? tempo.value;
    const clamp = (v: number) => Math.max(min, Math.min(max, v));

    const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
        if (tempo.disabled || editing || event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const start = tempo.value;
        moved.current = false;
        let latest = start;
        const move = (e: PointerEvent) => {
            // Shift = fine (a tenth), Alt = coarse (five times) — the same
            // modifier grammar every scrubbable value in the app uses.
            const scale = e.shiftKey ? 0.1 : e.altKey ? 5 : 1;
            const next = clamp(Math.round(start + ((e.clientX - startX) / PX_PER_BPM) * scale));
            if (next !== latest) {
                latest = next;
                moved.current = true;
                setDragValue(next);
            }
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            setDragValue(null);
            // ONE commit per gesture — one engine write, one undo step.
            if (moved.current && latest !== start) tempo.onCommit(latest);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    const openEditor = () => {
        if (tempo.disabled) return;
        setDraft(String(Math.round(tempo.value)));
        setEditing(true);
    };

    const commitEditor = () => {
        const parsed = Number.parseFloat(draft);
        setEditing(false);
        if (Number.isFinite(parsed)) {
            const next = clamp(Math.round(parsed));
            if (next !== tempo.value) tempo.onCommit(next);
        }
    };

    if (editing) {
        return (
            <span className="oj-transport__tempo is-editing">
                <Input
                    autoFocus
                    mono
                    type="number"
                    inputMode="decimal"
                    className="oj-transport__tempo-input"
                    aria-label="Tempo in BPM"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={commitEditor}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitEditor(); }
                        else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
                    }}
                />
            </span>
        );
    }

    return (
        <span
            className={`oj-transport__tempo${tempo.disabled ? ' is-disabled' : ''}`}
            role="button"
            tabIndex={tempo.disabled ? -1 : 0}
            aria-disabled={tempo.disabled || undefined}
            aria-label={`Tempo ${Math.round(shown)} BPM`}
            title={tempo.disabled ? tempo.disabledReason : 'Drag to change tempo · double-click to type'}
            onPointerDown={onPointerDown}
            onDoubleClick={openEditor}
            onKeyDown={(e) => {
                if (tempo.disabled) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); return; }
                const step = e.shiftKey ? 10 : 1;
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); tempo.onCommit(clamp(tempo.value + step)); }
                else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); tempo.onCommit(clamp(tempo.value - step)); }
            }}
        >
            <b className="oj-transport__tempo-value">{Math.round(shown)}</b>
            <small className="oj-transport__tempo-unit">BPM</small>
        </span>
    );
}

function PositionZone({ position, elementRef }: { position: TransportPosition; elementRef?: RefObject<HTMLSpanElement | null> }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const editable = typeof position.onSeek === 'function';

    if (editing) {
        return (
            <span className="oj-transport__position is-editing">
                <Input
                    autoFocus
                    mono
                    className="oj-transport__position-input"
                    aria-label="Go to position"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => { setEditing(false); position.onSeek?.(draft); }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); setEditing(false); position.onSeek?.(draft); }
                        else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
                    }}
                />
            </span>
        );
    }

    const open = () => {
        if (!editable) return;
        setDraft(position.display);
        setEditing(true);
    };

    return (
        <span
            ref={elementRef}
            className={`oj-transport__position${position.pending ? ' is-pending' : ''}`}
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={`Playhead at ${position.display}`}
            title={editable ? 'Click to type a position' : undefined}
            onClick={open}
            onKeyDown={(e) => {
                if (!editable) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            }}
        >
            {position.display}
        </span>
    );
}

function MetronomeZone({ metronome }: { metronome: TransportMetronome }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const opened = useRef(false);
    const wrapRef = useRef<HTMLSpanElement>(null);
    const menuId = useId();

    useEffect(() => {
        if (!menuOpen) return;
        const away = (e: PointerEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('pointerdown', away);
        return () => document.removeEventListener('pointerdown', away);
    }, [menuOpen]);

    useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

    const startHold = () => {
        opened.current = false;
        holdTimer.current = setTimeout(() => { opened.current = true; setMenuOpen(true); }, LONG_PRESS_MS);
    };
    const endHold = () => {
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    };

    return (
        <span className="oj-transport__click-wrap" ref={wrapRef}>
            <button
                type="button"
                className={`oj-transport__btn oj-transport__click${metronome.on ? ' is-on' : ''}`}
                aria-pressed={metronome.on}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title={`${metronome.on ? 'Turn the click off' : 'Turn the click on'} · hold or right-click for count-in`}
                aria-label={`Metronome${metronome.countInBars ? `, ${metronome.countInBars} bar count-in` : ''}`}
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onContextMenu={(e) => { e.preventDefault(); endHold(); setMenuOpen(true); }}
                onClick={() => { if (opened.current) { opened.current = false; return; } metronome.onToggle(); }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMenuOpen(true); }
                }}
            >
                <ClickGlyph />
                {metronome.countInBars > 0 && (
                    <span className="oj-transport__count-in" aria-hidden="true">{metronome.countInBars}</span>
                )}
            </button>
            {menuOpen && (
                <span className="oj-transport__popover" role="menu" id={menuId} aria-label="Count-in">
                    {([0, 1, 2] as const).map((bars) => (
                        <button
                            key={bars}
                            type="button"
                            role="menuitemradio"
                            aria-checked={metronome.countInBars === bars}
                            className={`oj-transport__popover-item${metronome.countInBars === bars ? ' is-on' : ''}`}
                            onClick={() => { metronome.onCountIn(bars); setMenuOpen(false); }}
                        >
                            {bars === 0 ? 'Off' : bars === 1 ? '1 bar' : '2 bars'}
                        </button>
                    ))}
                </span>
            )}
        </span>
    );
}

/**
 * The ONE transport in OpenJammer — a floating pill, top-centre, identical on the
 * canvas, the arrangement and the piano roll, so a performer's hand learns a
 * single place for *is it running and where am I*.
 *
 * Purely presentational: every zone is driven by props and the pill owns no
 * engine state. Zones it is not given simply do not render, which is how the
 * same component serves a bare canvas (play + meter) and a full song (record,
 * position, tempo, loop, click). A zone is never shown dead without a reason —
 * `disabledReason` is a tooltip, and the honest answer beats a shrug.
 *
 * Undo/redo deliberately live in the topbar, not here: the pill carries only what
 * is true on every surface and is about TIME.
 */
export function TransportPill({
    playing,
    onPlayToggle,
    playLabel = 'Play',
    stopLabel = 'Stop',
    returnArmed = false,
    returnLabel = 'Return to where playback started',
    pulse = false,
    onReturnToStart,
    record,
    position,
    positionRef,
    tempo,
    loop,
    metronome,
    meter,
    hint,
    faultReason,
    className,
    ...rest
}: TransportPillProps) {
    const faultId = useId();
    // The pulse exists to say "the browser has not let sound through yet".
    // While the transport rolls it would be a lie, so it is suppressed here as
    // well as at the call site — belt and braces on a stage.
    const attn = pulse && !playing && !record?.recording;
    // Three states, one button, and the glyph names the one you are in:
    // rolling → Stop, second-Stop armed → Return, otherwise → Play.
    const rewind = !playing && returnArmed;
    const transportName = playing ? stopLabel : rewind ? returnLabel : playLabel;

    const hasTime = Boolean(position || tempo);
    const hasState = Boolean(loop || metronome);
    const hasSignal = Boolean(meter || hint);

    return (
        <div className={['oj-transport', className].filter(Boolean).join(' ')} role="group" aria-label="Transport" {...rest}>
            <div className="oj-transport__zone oj-transport__zone--transport">
                <button
                    type="button"
                    className={`oj-transport__play${playing ? ' is-playing' : ''}${rewind ? ' is-return-armed' : ''}${attn ? ' is-attn' : ''}`}
                    aria-label={transportName}
                    title={`${transportName}${hint ? ` (${hint})` : ''}${faultReason ? ` — ${faultReason}` : ''}`}
                    aria-describedby={faultReason ? faultId : undefined}
                    onClick={onPlayToggle}
                >
                    {playing ? <StopGlyph /> : rewind ? <RewindGlyph /> : <PlayGlyph />}
                </button>
                {faultReason && (
                    <span id={faultId} className="oj-transport__fault-reason">
                        {faultReason}
                    </span>
                )}

                {record && (
                    <button
                        type="button"
                        className={[
                            'oj-transport__record',
                            record.recording && 'is-recording',
                            record.outsidePunch && !record.recording && 'is-outside-punch',
                        ].filter(Boolean).join(' ')}
                        aria-pressed={record.recording}
                        disabled={record.disabled}
                        title={record.disabled ? (record.disabledReason ?? 'Recording is unavailable') : record.recording ? 'Stop recording' : 'Record'}
                        aria-label={record.recording ? 'Stop recording' : 'Record'}
                        onClick={record.onToggle}
                    >
                        <span className="oj-transport__record-dot" aria-hidden="true" />
                    </button>
                )}

                {onReturnToStart && (
                    <button
                        type="button"
                        className="oj-transport__btn oj-transport__return"
                        aria-label="Return to start"
                        title="Return to start (Home)"
                        onClick={onReturnToStart}
                    >
                        <ReturnGlyph />
                    </button>
                )}
            </div>

            {hasTime && (
                <div className="oj-transport__zone oj-transport__zone--time">
                    {position && <PositionZone position={position} elementRef={positionRef} />}
                    {tempo && <TempoZone tempo={tempo} />}
                </div>
            )}

            {hasState && (
                <div className="oj-transport__zone oj-transport__zone--state">
                    {loop && (
                        <button
                            type="button"
                            className={`oj-transport__btn${loop.on ? ' is-on' : ''}`}
                            aria-pressed={loop.on}
                            aria-label="Loop"
                            title={loop.on ? 'Disable loop' : 'Enable loop'}
                            onClick={loop.onToggle}
                        >
                            <LoopGlyph />
                        </button>
                    )}
                    {metronome && <MetronomeZone metronome={metronome} />}
                </div>
            )}

            {hasSignal && (
                <div className="oj-transport__zone oj-transport__zone--signal">
                    {meter}
                    {hint && <Kbd className="oj-transport__hint">{hint}</Kbd>}
                </div>
            )}
        </div>
    );
}
