import '../Nodes/SchematicNodes.css';

/** App version inlined from package.json (the SSOT); falls back under non-Vite runners. */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

export function AboutPanel() {
    return (
        <div className="about-panel">
            <div className="about-header">
                <h2>OpenJammer</h2>
                <span className="about-version">v{APP_VERSION}</span>
            </div>

            <p className="about-description">
                Browser-based node-driven music creation tool for live performance.
            </p>

            <div className="about-links">
                <a
                    href="https://github.com/ponderingBGI/openjammer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="about-github-link"
                >
                    View on GitHub
                </a>
                <button
                    type="button"
                    className="about-github-link about-report-link"
                    onClick={() => window.dispatchEvent(new CustomEvent('openjammer:report-issue'))}
                >
                    Report a problem
                </button>
            </div>

            <div className="about-license">
                <span className="about-license-label">License:</span> AGPL-3.0
            </div>
        </div>
    );
}
