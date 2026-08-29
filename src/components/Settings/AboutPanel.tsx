import { Button, Chip } from '@openjammer/oj-ui';
import './SettingsPanel.css';

/**
 * Settings -> About. Version, what this thing is, the local-only diagnostics
 * path, and the source. Built from the shared `.oj-set-*` row vocabulary.
 */
export function AboutPanel() {
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

    // Opens the IssueReporter, which assembles a LOCAL diagnostic bundle (the
    // DevLog tail + "copy diagnostics" + "reveal log file"). Nothing is uploaded.
    const reportProblem = () => window.dispatchEvent(new CustomEvent('openjammer:report-issue'));

    return (
        <div className="oj-set">
            <section className="oj-set-section">
                <h3 className="oj-set-section__title">OpenJammer</h3>
                <p className="oj-about__lede">
                    A node-driven instrument for live performance — you patch it while it is
                    sounding, and it never stops to think.
                </p>
                <div className="oj-set-actions">
                    <Chip title="Application version">v{version}</Chip>
                    <Chip title="Software licence">AGPL-3.0</Chip>
                </div>
            </section>

            <section className="oj-set-section">
                <h3 className="oj-set-section__title">Diagnostics</h3>
                <div className="oj-set-row">
                    <div className="oj-set-row__text">
                        <span className="oj-set-row__label">Report a problem</span>
                        <span className="oj-set-row__desc">
                            Opens a local diagnostics bundle you can copy to the clipboard, or
                            reveal as an on-device log file. Nothing is ever uploaded.
                        </span>
                    </div>
                    <div className="oj-set-row__control">
                        <Button onClick={reportProblem}>Report a problem…</Button>
                    </div>
                </div>
            </section>

            <section className="oj-set-section">
                <h3 className="oj-set-section__title">Source</h3>
                <div className="oj-about__links">
                    <a
                        href="https://github.com/ponderingBGI/openjammer"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="oj-about__link"
                    >
                        View on GitHub
                    </a>
                    <a
                        href="https://github.com/ponderingBGI/openjammer/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="oj-about__link"
                    >
                        Releases
                    </a>
                </div>
            </section>
        </div>
    );
}
