import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_ANSWERS,
    ONBOARDING_STORAGE_KEY,
    currentPersona,
    parseAnswers,
    useOnboardingStore,
} from '../onboardingStore';

function reset() {
    localStorage.clear();
    useOnboardingStore.setState({ answers: null, hintDismissed: false });
}

describe('onboardingStore', () => {
    beforeEach(reset);

    describe('parseAnswers', () => {
        it('accepts a complete, in-vocabulary answer set', () => {
            expect(parseAnswers('{"exp":"pro","goal":"beat","theme":"dark"}')).toEqual({
                exp: 'pro',
                goal: 'beat',
                theme: 'dark',
            });
        });

        it('treats a partial or unknown answer set as never answered', () => {
            // A half-trusted persona is worse than asking again.
            expect(parseAnswers('{"exp":"pro"}')).toBeNull();
            expect(parseAnswers('{"exp":"wizard","goal":"beat","theme":"dark"}')).toBeNull();
            expect(parseAnswers('{"exp":"pro","goal":"opera","theme":"dark"}')).toBeNull();
            expect(parseAnswers('{"exp":"pro","goal":"beat","theme":"cream"}')).toBeNull();
            expect(parseAnswers('not json')).toBeNull();
            expect(parseAnswers(null)).toBeNull();
        });
    });

    it('persists the answers under one versioned key', () => {
        useOnboardingStore.getState().complete({ exp: 'first', goal: 'sound', theme: 'light' });
        expect(useOnboardingStore.getState().answers).toEqual({ exp: 'first', goal: 'sound', theme: 'light' });
        expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual({
            exp: 'first',
            goal: 'sound',
            theme: 'light',
        });
    });

    it('forgets everything on "Redo setup" so the next paint asks again', () => {
        useOnboardingStore.getState().complete(DEFAULT_ANSWERS);
        useOnboardingStore.getState().dismissHint();
        useOnboardingStore.getState().reset();

        expect(useOnboardingStore.getState().answers).toBeNull();
        expect(useOnboardingStore.getState().hintDismissed).toBe(false);
        expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    });

    it('changes the persona later without re-running the flow', () => {
        useOnboardingStore.getState().complete({ exp: 'first', goal: 'jam', theme: 'light' });
        useOnboardingStore.getState().setPersona('pro');
        expect(useOnboardingStore.getState().answers).toEqual({ exp: 'pro', goal: 'jam', theme: 'light' });
    });

    it('starts from the honest middle when the persona is set before any run', () => {
        useOnboardingStore.getState().setPersona('pro');
        expect(useOnboardingStore.getState().answers).toEqual({ ...DEFAULT_ANSWERS, exp: 'pro' });
    });

    it('remembers a theme picked elsewhere, but only once the run has finished', () => {
        // Mid-run the overlay owns the pending choice; the store must not invent
        // an answer set from a theme toggle.
        useOnboardingStore.getState().setTheme('dark');
        expect(useOnboardingStore.getState().answers).toBeNull();

        useOnboardingStore.getState().complete(DEFAULT_ANSWERS);
        useOnboardingStore.getState().setTheme('dark');
        expect(useOnboardingStore.getState().answers?.theme).toBe('dark');
    });

    it('remembers a dismissed hint across reloads', () => {
        useOnboardingStore.getState().dismissHint();
        expect(localStorage.getItem('oj-onboarding-hint-dismissed')).toBe('true');
    });

    it('falls back to the honest middle persona when nothing was answered', () => {
        expect(currentPersona()).toBe(DEFAULT_ANSWERS.exp);
        useOnboardingStore.getState().complete({ exp: 'pro', goal: 'jam', theme: 'light' });
        expect(currentPersona()).toBe('pro');
    });

    it('survives storage being unavailable rather than breaking the first run', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });
        expect(() => useOnboardingStore.getState().complete(DEFAULT_ANSWERS)).not.toThrow();
        // The session still works; it just asks again next time.
        expect(useOnboardingStore.getState().answers).toEqual(DEFAULT_ANSWERS);
        setItem.mockRestore();
    });
});
