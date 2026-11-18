/**
 * Onboarding Store — the three answers the first run asks for, and nothing else.
 *
 * Three taps decide how dense the instrument looks (`experience`), what is
 * already wired and sounding when the overlay closes (`goal`), and which theme
 * it wears. They persist under ONE key so the answer set is trivially
 * inspectable, resettable ("Redo setup" in Settings) and forward-compatible: an
 * unreadable or partial blob is treated as "never answered" rather than
 * half-trusted, because a wrong persona is worse than asking again.
 *
 * The absence of an answer set is the ONLY trigger for the overlay. Nothing
 * here knows about audio, the graph, or the browser's autoplay policy — the
 * overlay owns that, because the unlock must happen synchronously inside the
 * click handler that answers the last question.
 */

import { create } from 'zustand';
import { logger } from '../utils/log';

const log = logger('onboarding');

/** Where the storage key lives. Versioned: a shape change starts a fresh run. */
export const ONBOARDING_STORAGE_KEY = 'oj-onboarding-v1';

/** Whether the beginner hint bubble has been dismissed (survives reloads). */
const HINT_KEY = 'oj-onboarding-hint-dismissed';

/** How much the instrument shows by default. */
export type Persona = 'first' | 'some' | 'pro';

/** Which rig is pre-wired and playing when onboarding finishes. */
export type RigGoal = 'jam' | 'beat' | 'sound';

export type ThemeChoice = 'light' | 'dark';

export interface OnboardingAnswers {
    exp: Persona;
    goal: RigGoal;
    theme: ThemeChoice;
}

/**
 * What a skipped run means. `some` is the honest middle: it shows the labels a
 * beginner needs without the hand-holding a pro would resent, and `jam` is the
 * rig that makes sound the instant a key is pressed.
 */
export const DEFAULT_ANSWERS: OnboardingAnswers = { exp: 'some', goal: 'jam', theme: 'light' };

const PERSONAS: readonly Persona[] = ['first', 'some', 'pro'];
const GOALS: readonly RigGoal[] = ['jam', 'beat', 'sound'];
const THEMES: readonly ThemeChoice[] = ['light', 'dark'];

/** Parse a stored blob, accepting ONLY a complete, in-vocabulary answer set. */
export function parseAnswers(raw: string | null): OnboardingAnswers | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<OnboardingAnswers> | null;
        if (!value || typeof value !== 'object') return null;
        const { exp, goal, theme } = value;
        if (!PERSONAS.includes(exp as Persona)) return null;
        if (!GOALS.includes(goal as RigGoal)) return null;
        if (!THEMES.includes(theme as ThemeChoice)) return null;
        return { exp: exp as Persona, goal: goal as RigGoal, theme: theme as ThemeChoice };
    } catch {
        return null;
    }
}

function readAnswers(): OnboardingAnswers | null {
    try {
        return parseAnswers(localStorage.getItem(ONBOARDING_STORAGE_KEY));
    } catch {
        // Private mode / disabled storage: treat it as a first run every time
        // rather than pretending we remember something we do not.
        return null;
    }
}

function readHintDismissed(): boolean {
    try {
        return localStorage.getItem(HINT_KEY) === 'true';
    } catch {
        return false;
    }
}

interface OnboardingState {
    /** `null` until the run completes (or is skipped). Drives the overlay. */
    answers: OnboardingAnswers | null;
    /** The beginner's "nothing can break" bubble has been dismissed. */
    hintDismissed: boolean;

    /** Finish the run: persist the answers and take the overlay down. */
    complete: (answers: OnboardingAnswers) => void;
    /** "Redo setup" — forget the answers so the next paint asks again. */
    reset: () => void;
    /** Change the density persona later, without re-running the whole flow. */
    setPersona: (exp: Persona) => void;
    /** Remember the theme the player picked elsewhere (the topbar toggle). */
    setTheme: (theme: ThemeChoice) => void;
    dismissHint: () => void;
}

function persist(answers: OnboardingAnswers | null): void {
    try {
        if (answers) localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(answers));
        else localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch (error) {
        // Never let a full/blocked quota break the first run — the session still
        // works, it just asks again next time. Say so in the log, not a toast.
        log.warn('onboarding answers could not be persisted', {
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
    answers: readAnswers(),
    hintDismissed: readHintDismissed(),

    complete: (answers) => {
        persist(answers);
        set({ answers });
    },

    reset: () => {
        persist(null);
        try {
            localStorage.removeItem(HINT_KEY);
        } catch {
            // Best effort; the bubble is a nicety, never a blocker.
        }
        set({ answers: null, hintDismissed: false });
    },

    setPersona: (exp) => {
        const answers = { ...(get().answers ?? DEFAULT_ANSWERS), exp };
        persist(answers);
        set({ answers });
    },

    setTheme: (theme) => {
        const current = get().answers;
        // Before the run finishes there is nothing to remember — the overlay
        // carries the pending choice itself.
        if (!current || current.theme === theme) return;
        const answers = { ...current, theme };
        persist(answers);
        set({ answers });
    },

    dismissHint: () => {
        try {
            localStorage.setItem(HINT_KEY, 'true');
        } catch {
            // Ignore — dismissal just will not survive the reload.
        }
        set({ hintDismissed: true });
    },
}));

/** The effective persona: the answered one, or the honest middle default. */
export function currentPersona(): Persona {
    return useOnboardingStore.getState().answers?.exp ?? DEFAULT_ANSWERS.exp;
}
