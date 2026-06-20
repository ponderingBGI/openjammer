import './SettingsPanel.css';

export function AboutPanel() {
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

    return (
        <div className="about-panel">
            <div className="about-header">
                <h2>OpenJammer</h2>
                <span className="about-version">v{version}</span>
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
            </div>

            <div className="about-license">
                <span className="about-license-label">License:</span> AGPL-3.0
            </div>
        </div>
    );
}
