/**
 * Onboarding — three taps to a rig that is already making sound.
 *
 * It is an overlay on the REAL studio, blurred behind it: what you are about to
 * get, not a picture of it. Three questions, one tap each, number keys 1–3, and
 * a skip that keeps whatever you already answered. It runs ONCE — the absence of
 * a stored answer set is the only thing that opens it — because a modal in front
 * of a musician mid-set is the one thing this product must never do.
 *
 * THE BROWSER GATE. On the browser tier the final tap is also the user gesture
 * that unlocks Web Audio, so `onFinish` runs SYNCHRONOUSLY inside the click
 * handler and calls `initAudioContext` on that same stack. Deferring it into a
 * promise chain or an effect loses the gesture and the rig comes up silent —
 * which is exactly the failure this whole flow exists to prevent. Native has no
 * gate (the Rust engine is already running), so the copy there never pretends
 * this is why the overlay exists, and the play button never pulses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyTheme, getSavedThemeId, getThemeById, saveThemeId } from '@openjammer/oj-tokens';
import { isTauri } from '../../audio/executor';
import {
    DEFAULT_ANSWERS,
    type OnboardingAnswers,
    type Persona,
    type RigGoal,
    type ThemeChoice,
} from '../../store/onboardingStore';
import { OPTION_GLYPHS, type GlyphId } from './glyphs';
import './Onboarding.css';

interface StepOption {
    value: string;
    title: string;
    detail: string;
    glyph: GlyphId;
}

interface Step {
    id: 'exp' | 'goal';
    question: string;
    sub: string;
    options: StepOption[];
}

const STEPS: Step[] = [
    {
        id: 'exp',
        question: 'Made music with a computer before?',
        sub: 'Sets how much we show you — change it any time in Settings.',
        options: [
            { value: 'first', title: 'First time', detail: "We'll keep it simple and label everything", glyph: 'first' },
            { value: 'some', title: "I've dabbled", detail: 'GarageBand, a groovebox, some tinkering', glyph: 'some' },
            { value: 'pro', title: 'Years of it', detail: 'Dense layout, real numbers, no hand-holding', glyph: 'pro' },
        ],
    },
    {
        id: 'goal',
        question: 'What do you want to make right now?',
        sub: 'The rig behind this card gets wired for it — and starts playing.',
        options: [
            { value: 'jam', title: 'Jam some keys', detail: 'A warm electric piano with delay on it', glyph: 'jam' },
            { value: 'beat', title: 'Build a beat', detail: 'A kit and an 8-step groove, already looping', glyph: 'beat' },
            { value: 'sound', title: 'Design a sound', detail: 'A pad through a filter, knobs to sculpt', glyph: 'sound' },
        ],
    },
];

const TOTAL_STEPS = STEPS.length + 1;

/** Everything the focus trap may land on inside the card. */
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface OnboardingProps {
    /**
     * Finishes the run. MUST be safe to call synchronously from a click handler:
     * on the browser tier this call is the autoplay gesture.
     */
    onFinish: (answers: OnboardingAnswers) => void;
}

export function Onboarding({ onFinish }: OnboardingProps) {
    const [index, setIndex] = useState(0);
    const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({});
    const cardRef = useRef<HTMLDivElement>(null);
    const returnFocusTo = useRef<HTMLElement | null>(null);
    const native = isTauri();

    // The theme the overlay is currently wearing: whatever is saved, until the
    // player hovers a swatch on the last step.
    const [previewTheme, setPreviewTheme] = useState<ThemeChoice>(() =>
        getSavedThemeId() === 'dark' ? 'dark' : 'light',
    );

    /**
     * Finish with whatever has been answered so far. `Esc` and "Skip, take me
     * in" both land here — a skip must never throw away a choice already made.
     */
    const finish = useCallback(
        (theme?: ThemeChoice) => {
            const chosen: OnboardingAnswers = {
                exp: (answers.exp as Persona) ?? DEFAULT_ANSWERS.exp,
                goal: (answers.goal as RigGoal) ?? DEFAULT_ANSWERS.goal,
                theme: theme ?? (answers.theme as ThemeChoice) ?? previewTheme,
            };
            onFinish(chosen);
        },
        [answers, previewTheme, onFinish],
    );

    const pick = useCallback(
        (step: Step, value: string) => {
            setAnswers((current) => ({ ...current, [step.id]: value }));
            setIndex((current) => current + 1);
        },
        [],
    );

    /** Apply a theme immediately so the last step is a real preview, not a swatch. */
    const applyPreview = useCallback((theme: ThemeChoice) => {
        const definition = getThemeById(theme);
        if (!definition) return;
        applyTheme(definition);
        setPreviewTheme(theme);
    }, []);

    const chooseTheme = useCallback(
        (theme: ThemeChoice) => {
            const definition = getThemeById(theme);
            if (definition) {
                applyTheme(definition);
                saveThemeId(theme);
            }
            // Synchronous, on the click's own stack — this is the audio gesture.
            finish(theme);
        },
        [finish],
    );

    // Take the focus, and give it back where it came from.
    useEffect(() => {
        returnFocusTo.current = document.activeElement as HTMLElement | null;
        return () => returnFocusTo.current?.focus?.();
    }, []);

    // The studio behind is a peek, not a control surface.
    useEffect(() => {
        document.body.classList.add('oj-onboarding-open');
        return () => document.body.classList.remove('oj-onboarding-open');
    }, []);

    // Land focus on the first option of each step so the keyboard path is the
    // same as the pointer path.
    useEffect(() => {
        cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, [index]);

    /**
     * Keys. Escape finishes; 1–3 answer. The number keys are guarded: while a
     * text field has focus a "2" is a two, not an answer.
     */
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const typing =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement ||
                target?.isContentEditable === true;

            if (event.key === 'Escape') {
                event.preventDefault();
                finish();
                return;
            }
            if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

            const n = Number.parseInt(event.key, 10);
            if (!Number.isFinite(n) || n < 1) return;

            const step = STEPS[index];
            if (step) {
                const option = step.options[n - 1];
                if (option) {
                    event.preventDefault();
                    pick(step, option.value);
                }
                return;
            }
            if (n <= 2) {
                event.preventDefault();
                chooseTheme(n === 1 ? 'light' : 'dark');
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [index, pick, finish, chooseTheme]);

    /** A real focus trap: Tab cycles the card's live focusables, both ways. */
    const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab') return;
        // `FOCUSABLE` already excludes disabled controls, and the card renders
        // exactly one step at a time — so everything it matches is on screen.
        const focusables = [...(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    const step = STEPS[index];
    const counter = `${String(Math.min(index + 1, TOTAL_STEPS)).padStart(2, '0')} / ${String(TOTAL_STEPS).padStart(2, '0')}`;

    return (
        <div className="ob" role="dialog" aria-modal="true" aria-labelledby="ob-question" onKeyDown={trapTab}>
            <div className="ob-card" ref={cardRef} key={index}>
                <div className="ob-top">
                    <span className="ob-brand">
                        <i aria-hidden="true" />
                        OpenJammer
                    </span>
                    <span className="ob-count">{counter}</span>
                </div>

                {step ? (
                    <>
                        <h1 className="ob-q" id="ob-question">{step.question}</h1>
                        <p className="ob-sub">{step.sub}</p>
                        <div className="ob-opts">
                            {step.options.map((option, n) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    className="ob-opt"
                                    style={{ animationDelay: `${n * 70}ms` }}
                                    onClick={() => pick(step, option.value)}
                                >
                                    <span className="ob-glyph" aria-hidden="true">{OPTION_GLYPHS[option.glyph]}</span>
                                    <span className="ob-opt__text">
                                        {option.title}
                                        <small>{option.detail}</small>
                                    </span>
                                    <span className="ob-key" aria-hidden="true">{n + 1}</span>
                                </button>
                            ))}
                            <button
                                type="button"
                                className="ob-skip"
                                style={{ animationDelay: '210ms' }}
                                onClick={() => finish()}
                            >
                                Skip, take me in
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h1 className="ob-q" id="ob-question">Where do you like to work?</h1>
                        <p className="ob-sub">
                            {native
                                ? 'Your rig is ready either way.'
                                : 'Your rig starts playing the moment you pick.'}
                        </p>
                        <div className="ob-theme">
                            {(['light', 'dark'] as const).map((theme, n) => (
                                <button
                                    key={theme}
                                    type="button"
                                    className={`ob-swatch ob-swatch--${theme}${previewTheme === theme ? ' is-current' : ''}`}
                                    style={{ animationDelay: `${n * 70}ms` }}
                                    onPointerEnter={() => applyPreview(theme)}
                                    onFocus={() => applyPreview(theme)}
                                    onClick={() => chooseTheme(theme)}
                                >
                                    <span className="ob-swatch__preview" aria-hidden="true">
                                        <span className="ob-swatch__node" />
                                        <span className="ob-swatch__accent" />
                                    </span>
                                    <span className="ob-swatch__label">
                                        {theme === 'light' ? 'Light' : 'Dark'}
                                        <span className="ob-key" aria-hidden="true">{n + 1}</span>
                                    </span>
                                </button>
                            ))}
                            <button type="button" className="ob-skip" style={{ animationDelay: '210ms' }} onClick={() => finish()}>
                                Skip, take me in
                            </button>
                        </div>
                    </>
                )}

                <div className="ob-foot">
                    {index > 0 ? (
                        <button type="button" className="ob-back" onClick={() => setIndex(index - 1)}>
                            ← Back
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="ob-dots" aria-hidden="true">
                        {Array.from({ length: TOTAL_STEPS }, (_, n) => (
                            <i key={n} className={n <= index ? 'is-on' : ''} />
                        ))}
                    </div>
                </div>
            </div>

            <p className="sr-only" aria-live="polite">
                {`Step ${Math.min(index + 1, TOTAL_STEPS)} of ${TOTAL_STEPS}`}
            </p>
        </div>
    );
}
