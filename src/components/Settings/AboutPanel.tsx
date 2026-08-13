import { Button } from '@openjammer/oj-ui';
import './SettingsPanel.css';

export function AboutPanel() {
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

    // Opens the IssueReporter, which assembles a LOCAL diagnostic bundle (the
    // DevLog tail + "copy diagnostics" + "reveal log file"). Nothing is uploaded.
    const reportProblem = () => window.dispatchEvent(new CustomEvent('openjammer:report-issue'));

    return (
        <div className="about-panel">
            <div className="about-header">
                <h2>OpenJammer</h2>
                <span className="about-version">v{version}</span>
            </div>

            <p className="about-description">
                Browser-based node-driven music creation tool for live performance.
            </p>

            <div className="about-diagnostics">
                <h3 className="about-diagnostics-title">Diagnostics</h3>
                <p className="about-diagnostics-note">
                    Something not sounding right? Open a local diagnostics bundle — copy it to
                    the clipboard or reveal the on-device log file. Nothing is ever uploaded.
                </p>
                <Button onClick={reportProblem}>Report a problem…</Button>
            </div>

            <div className="about-links">
                <a
                    href="https://github.com/ponderingBGI/openjammer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-github-link"
                >
                    View on GitHub
                </a>
            </div>

            <div className="about-license">
                <span className="about-license-label">License:</span> AGPL-3.0
            </div>
        </div>
    );
}
