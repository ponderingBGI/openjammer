/**
 * OnboardingHost — what actually happens when the third question is answered.
 *
 * The order here is the whole contract, and it is deliberate:
 *   1. THEME first, so the studio behind the overlay is already wearing the
 *      answer when the overlay lifts.
 *   2. AUDIO second, synchronously, on the click's own stack. `onActivate` is
 *      the same call the old welcome screen made; it constructs the
 *      AudioContext before its first `await`, so the browser still sees this as
 *      the user gesture it was waiting for. Anything that defers this loses the
 *      gesture and the rig comes up silent.
 *   3. ANSWERS third, which takes the overlay down.
 *   4. RIG last, through the same reversible verbs the player and the agent use
 *      — one history entry, `Ctrl+Z` removes it.
 *
 * A rig with a Song (the beat rig) also has to START. It waits for the engine to
 * report LIVE rather than guessing at a delay: the transport can only roll once
 * the executor has accepted a graph, and asking earlier just produces a
 * `transportError` the player would have to read.
 */

import { useCallback, useEffect, useRef } from 'react';
import { applyTheme, getThemeById, saveThemeId } from '@openjammer/oj-tokens';
import { useOnboardingStore, type OnboardingAnswers } from '../../store/onboardingStore';
import { useAudioStore } from '../../store/audioStore';
import { useArrangementStore } from '../../store/arrangementStore';
import { useEngineHealthStore } from '../../store/engineHealthStore';
import { focusRig, installRigFor } from '../../rigs';
import { logger } from '../../utils/log';
import { Onboarding } from './Onboarding';

const log = logger('onboarding');

/** How long to wait for the engine before starting a rig that must loop. */
const ENGINE_WAIT_MS = 4000;

export function OnboardingHost({ onActivate }: { onActivate: () => void }) {
    const answers = useOnboardingStore((state) => state.answers);
    const isAudioContextReady = useAudioStore((state) => state.isAudioContextReady);
    const autoPlay = useRef(false);

    const finish = useCallback(
        (chosen: OnboardingAnswers) => {
            // 1 — theme.
            const theme = getThemeById(chosen.theme);
            if (theme) {
                applyTheme(theme);
                saveThemeId(chosen.theme);
            }

            // 2 — audio, on this stack. Do NOT await: the AudioContext is
            // constructed before the first suspension point, which is what the
            // autoplay policy actually inspects.
            onActivate();

            // 3 — the answers; the overlay lifts on this state change.
            useOnboardingStore.getState().complete(chosen);

            // 4 — the rig, through the graph verbs.
            const installed = installRigFor(chosen.goal, chosen.exp);
            autoPlay.current = installed.spec.song !== undefined;
            if (installed.unwired.length) {
                log.warn('preset rig came up with unwired cables', {
                    rig: installed.spec.id,
                    unwired: installed.unwired,
                });
            }

            // Fit the view and hand the keys over once the nodes have painted.
            requestAnimationFrame(() => focusRig(installed));
        },
        [onActivate],
    );

    /**
     * Start a rig that is supposed to already be running. The engine reports
     * LIVE the moment it has accepted a graph; until then `play()` would fail
     * loudly and truthfully, which is not what a first run should show.
     */
    useEffect(() => {
        if (!autoPlay.current || !isAudioContextReady) return;
        let cancelled = false;
        const start = () => {
            if (cancelled || !autoPlay.current) return;
            autoPlay.current = false;
            const arrangement = useArrangementStore.getState();
            if (arrangement.arrangement && !arrangement.isPlaying) arrangement.play();
        };

        if (useEngineHealthStore.getState().health === 'LIVE') {
            // Still let this commit finish: the executor is wired in an effect
            // that may run after this one on the very first ready render.
            const id = setTimeout(start, 0);
            return () => { cancelled = true; clearTimeout(id); };
        }

        const unsubscribe = useEngineHealthStore.subscribe((state) => {
            if (state.health === 'LIVE') start();
        });
        // A rig that never rolls must not hang silently waiting for a signal
        // that is not coming — try once, then let the play button do its job.
        const timer = setTimeout(start, ENGINE_WAIT_MS);
        return () => {
            cancelled = true;
            unsubscribe();
            clearTimeout(timer);
        };
    }, [isAudioContextReady]);

    if (answers) return null;
    return <Onboarding onFinish={finish} />;
}
