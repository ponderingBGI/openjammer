/**
 * Safe Mode (Track B P0) — the ONE full-screen state OpenJammer ever shows, and
 * only after REPEATED crashes, when there is no held note left to protect.
 *
 * It refuses the "deadly crash cycle": rather than blindly re-loading the state
 * that kept crashing, it stops here and offers calm choices. Recovery itself
 * loads NOTHING in Safe Mode (see recover.ts) — the patch the player can see
 * behind this dialog is whatever the graph store hydrated from its own `persist`.
 * So "Back to my work" simply keeps that canvas (a dismiss, not a disk load), and
 * quarantined suspects stay preserved on disk (never deleted) so the explicit
 * "Reload last saved version" remains available when one exists.
 *
 * It wears the same New DNA card language as the first run — the two moments a
 * player ever sees a full-screen OpenJammer should feel like the same product,
 * not two different eras of it.
 */

import { useEffect, useRef } from 'react';
import { useCrashRecovery } from '../../persistence/recovery/useCrashRecovery';
import './SafeModeScreen.css';

type SafeModeApi = ReturnType<typeof useCrashRecovery>;

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function SafeModeScreen({ api }: { api: SafeModeApi }) {
    const { safeMode } = api;
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!safeMode) return;
        cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, [safeMode]);

    if (!safeMode) return null;

    const canRecover = safeMode.quarantinedId !== null;

    return (
        <div
            className="oj-fullscreen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="oj-safemode-title"
            onKeyDown={(e) => {
                // A real trap over the live focusables, both directions.
                if (e.key !== 'Tab') return;
                const focusables = [...(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
                if (focusables.length === 0) return;
                const first = focusables[0]!;
                const last = focusables[focusables.length - 1]!;
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }}
        >
            <div className="oj-fullscreen__card" ref={cardRef}>
                <div className="oj-fullscreen__brand">
                    <i aria-hidden="true" />
                    OpenJammer
                </div>

                <h1 id="oj-safemode-title" className="oj-fullscreen__title">
                    Let&rsquo;s get you playing again
                </h1>
                <p className="oj-fullscreen__intro">
                    OpenJammer restarted a few times just now, so it paused here instead of charging
                    back in. Your work is still on the canvas behind this &mdash; nothing was deleted.
                    Pick how you&rsquo;d like to continue.
                </p>

                {/* The decision: start clean, or keep the patch already on the canvas. */}
                <button type="button" className="oj-fullscreen__option" onClick={api.startFresh}>
                    <span className="oj-fullscreen__option-text">
                        Start fresh
                        <small>Clear the canvas and start clean. Your current work stays saved on disk.</small>
                    </span>
                    <span className="oj-fullscreen__option-glyph" aria-hidden="true">&rarr;</span>
                </button>

                <button type="button" className="oj-fullscreen__option" onClick={api.dismiss}>
                    <span className="oj-fullscreen__option-text">
                        Back to my work
                        <small>
                            Keep the patch you can see behind this and pick up playing. If it crashes
                            again, you&rsquo;ll land right back here.
                        </small>
                    </span>
                    <span className="oj-fullscreen__option-glyph" aria-hidden="true">&larr;</span>
                </button>

                {/* Quiet utilities — escape hatches, not the main decision. */}
                <div className="oj-fullscreen__foot">
                    <button
                        type="button"
                        className="oj-fullscreen__link"
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent('openjammer:new-project'));
                            api.dismiss();
                        }}
                    >
                        Open a different project
                    </button>
                    <span className="oj-fullscreen__sep" aria-hidden="true">&middot;</span>
                    <button
                        type="button"
                        className="oj-fullscreen__link"
                        onClick={() => window.dispatchEvent(new CustomEvent('openjammer:report-issue'))}
                    >
                        Send a report
                    </button>
                    {canRecover && (
                        <>
                            <span className="oj-fullscreen__sep" aria-hidden="true">&middot;</span>
                            <button type="button" className="oj-fullscreen__link" onClick={api.recoverAnyway}>
                                Reload last saved version
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
