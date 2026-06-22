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
 * "Reload last saved version" remains available when one exists. Styling reuses
 * the welcome-screen classes so there is no second full-screen vocabulary.
 */

import { useCrashRecovery } from '../../persistence/recovery/useCrashRecovery';

type SafeModeApi = ReturnType<typeof useCrashRecovery>;

export function SafeModeScreen({ api }: { api: SafeModeApi }) {
    const { safeMode } = api;
    if (!safeMode) return null;

    const canRecover = safeMode.quarantinedId !== null;

    return (
        <div
            className="oj-welcome"
            role="dialog"
            aria-modal="true"
            aria-labelledby="oj-safemode-title"
            onKeyDown={(e) => {
                // Keep Tab inside the dialog (aria-modal is asserted). Mirrors the
                // welcome screen's loop; focusables span the cards and footer links.
                if (e.key !== 'Tab') return;
                const focusables = e.currentTarget.querySelectorAll<HTMLElement>(
                    '.oj-welcome-option, .oj-welcome-link',
                );
                if (focusables.length === 0) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }}
        >
            <div className="oj-welcome-card">
                <h1 id="oj-safemode-title" className="oj-welcome-title">
                    Let&rsquo;s get you playing again
                </h1>
                <p className="oj-welcome-intro">
                    OpenJammer restarted a few times just now, so it paused here instead of charging
                    back in. Your work is still on the canvas behind this &mdash; nothing was deleted.
                    Pick how you&rsquo;d like to continue.
                </p>

                {/* The decision: start clean, or keep the patch already on the canvas. */}
                <button
                    type="button"
                    className="oj-welcome-option oj-welcome-option--primary"
                    onClick={api.startFresh}
                    autoFocus
                >
                    <span className="oj-welcome-option-main">
                        <span className="oj-welcome-option-label">Start fresh</span>
                        <span className="oj-welcome-option-sub">
                            Clear the canvas and start clean. Your current work stays saved on disk.
                        </span>
                    </span>
                    <span className="oj-welcome-option-glyph" aria-hidden="true">
                        &rarr;
                    </span>
                </button>

                <button
                    type="button"
                    className="oj-welcome-option oj-welcome-option--secondary"
                    onClick={api.dismiss}
                >
                    <span className="oj-welcome-option-main">
                        <span className="oj-welcome-option-label">Back to my work</span>
                        <span className="oj-welcome-option-sub">
                            Keep the patch you can see behind this and pick up playing. If it crashes
                            again, you&rsquo;ll land right back here.
                        </span>
                    </span>
                    <span className="oj-welcome-option-glyph" aria-hidden="true">
                        &larrhk;
                    </span>
                </button>

                {/* Quiet utilities — escape hatches, not the main decision. */}
                <div className="oj-welcome-footer">
                    <button
                        type="button"
                        className="oj-welcome-link"
                        onClick={() => {
                            window.dispatchEvent(new CustomEvent('openjammer:new-project'));
                            api.dismiss();
                        }}
                    >
                        Open a different project
                    </button>
                    <span className="oj-welcome-footer-sep" aria-hidden="true">
                        &middot;
                    </span>
                    <button
                        type="button"
                        className="oj-welcome-link"
                        onClick={() => window.dispatchEvent(new CustomEvent('openjammer:report-issue'))}
                    >
                        Send a report
                    </button>
                    {canRecover && (
                        <>
                            <span className="oj-welcome-footer-sep" aria-hidden="true">
                                &middot;
                            </span>
                            <button
                                type="button"
                                className="oj-welcome-link"
                                onClick={api.recoverAnyway}
                            >
                                Reload last saved version
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
