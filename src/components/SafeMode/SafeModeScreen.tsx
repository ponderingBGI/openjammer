/**
 * Safe Mode (Track B P0) — the ONE full-screen state OpenJammer ever shows, and
 * only after REPEATED crashes, when there is no held note left to protect.
 *
 * It boots over a valid (last-good) canvas and offers calm choices rather than
 * blindly re-loading the state that kept crashing — refusing the "deadly crash
 * cycle." Suspects are preserved on disk (quarantined, never deleted), so
 * "Recover anyway" stays available. Styling reuses the welcome-screen classes so
 * there is no second visual vocabulary for a full-screen takeover.
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
        >
            <div className="oj-welcome-card">
                <h1 id="oj-safemode-title" className="oj-welcome-title">
                    Let&rsquo;s get you playing again
                </h1>
                <p className="oj-welcome-intro">
                    OpenJammer restarted a few times just now, so it opened a clean canvas to break
                    the loop. Your previous work is safe on disk &mdash; nothing was deleted. Pick how
                    you&rsquo;d like to continue.
                </p>

                <button
                    type="button"
                    className="oj-welcome-option oj-welcome-option--primary"
                    onClick={api.startFresh}
                    autoFocus
                >
                    <span className="oj-welcome-option-main">
                        <span className="oj-welcome-option-label">Start fresh</span>
                        <span className="oj-welcome-option-sub">
                            Begin with an empty canvas. Your previous work stays saved and can be
                            opened later.
                        </span>
                    </span>
                    <span className="oj-welcome-option-glyph" aria-hidden="true">
                        &rarr;
                    </span>
                </button>

                {canRecover && (
                    <button
                        type="button"
                        className="oj-welcome-option oj-welcome-option--secondary"
                        onClick={api.recoverAnyway}
                    >
                        <span className="oj-welcome-option-main">
                            <span className="oj-welcome-option-label">Try to recover my work anyway</span>
                            <span className="oj-welcome-option-sub">
                                Re-open the project that was crashing. If it crashes again, you&rsquo;ll
                                land right back here.
                            </span>
                        </span>
                        <span className="oj-welcome-option-glyph" aria-hidden="true">
                            &uarr;
                        </span>
                    </button>
                )}

                <button
                    type="button"
                    className="oj-welcome-option oj-welcome-option--secondary"
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('openjammer:new-project'));
                        api.dismiss();
                    }}
                >
                    <span className="oj-welcome-option-main">
                        <span className="oj-welcome-option-label">Open a different project</span>
                        <span className="oj-welcome-option-sub">Pick another project folder to work in.</span>
                    </span>
                    <span className="oj-welcome-option-glyph" aria-hidden="true">
                        &rarr;
                    </span>
                </button>

                <button
                    type="button"
                    className="oj-welcome-option oj-welcome-option--secondary"
                    onClick={() => window.dispatchEvent(new CustomEvent('openjammer:report-issue'))}
                >
                    <span className="oj-welcome-option-main">
                        <span className="oj-welcome-option-label">Send a report</span>
                        <span className="oj-welcome-option-sub">
                            Share a redacted log bundle so we can stop this from happening again.
                        </span>
                    </span>
                    <span className="oj-welcome-option-glyph" aria-hidden="true">
                        &rarr;
                    </span>
                </button>
            </div>
        </div>
    );
}
