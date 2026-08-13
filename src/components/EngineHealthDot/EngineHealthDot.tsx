/**
 * EngineHealthDot (Phase 2) — the ONE calm, ambient engine-health indicator.
 *
 * Lives in the existing app chrome (the toolbar status strip), NOT a second
 * dashboard. It subscribes to the Wave-1 {@link useEngineHealthStore} tri-state
 * and renders an oj-ui {@link StatusDot} + a Caveat label — a dot is never shown
 * naked (the Signal-Not-Brand Rule: a state colour always rides with a label).
 *
 * It is deliberately QUIET:
 *   • IDLE renders the muted `idle` token, never an alarm colour — "nothing has
 *     happened yet" must read as calm, not as a fault (cold-start cry-wolf trap).
 *   • There is no pulse / glow (No-Surprise Rule); the colour + glyph are the
 *     whole signal, and `prefers-reduced-motion` is honoured for the tiny
 *     hover/press feedback.
 *   • The presentation comes from the single pure {@link presentHealth} mapping,
 *     so the dot, its tooltip, and the toast policy can never tell three stories.
 *
 * Clicking (or Enter/Space) opens the existing Audio-health readout — the dot is
 * the at-a-glance signal; the panel is the detail-on-demand. The whole control
 * is keyboard-reachable and, via that same panel, Ctrl+K-reachable.
 *
 * The tooltip carries the HONEST latency tier (never dressed up as sub-5 ms).
 */

import { useEngineHealthStore, presentHealth, latencyTierLabel } from '../../store/engineHealthStore';
import { StatusDot } from '@openjammer/oj-ui';
import { isTauri } from '../../audio/executor';
import './EngineHealthDot.css';

export function EngineHealthDot() {
    const health = useEngineHealthStore((s) => s.health);
    const reason = useEngineHealthStore((s) => s.reason);

    const present = presentHealth(health, reason);
    const tier = latencyTierLabel(isTauri());
    const tooltip = `${present.label}. ${present.blurb} Latency: ${tier}.`;

    const openDetail = () => {
        window.dispatchEvent(new CustomEvent('openjammer:toggle-audio-health'));
    };

    return (
        <button
            type="button"
            className="engine-health-dot"
            onClick={openDetail}
            title={tooltip}
            aria-label={tooltip}
            data-health={health}
        >
            <StatusDot status={present.status} aria-hidden="true" />
            <span className="engine-health-dot__glyph" aria-hidden="true">
                {present.icon}
            </span>
            <span className="engine-health-dot__label">{present.label}</span>
        </button>
    );
}
