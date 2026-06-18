/**
 * Settings → Updates: the single explicit surface for release channel choice.
 *
 * Auto-update remains quiet (the Live Performance Rule): supported desktop
 * installs stage updates in the background and install on quit/idle. Platforms
 * that cannot safely auto-update still get the same channel selector plus a
 * manual download button, so Settings never hides the path to Stable/Canari.
 */

import { useState } from 'react';

import { isTauri, openExternal } from '../../ai/tauri';
import { useNativeUpdater, type UpdateStatus } from '../../hooks/useNativeUpdater';
import { useUpdatePreferences, type UpdateChannel } from '../../store/updatePreferencesStore';
import './UpdatesPanel.css';

const RELEASES_URL = 'https://github.com/ponderingBGI/openjammer/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/ponderingBGI/openjammer/releases/latest';
const RELEASES_API = 'https://api.github.com/repos/ponderingBGI/openjammer/releases?per_page=50';

const CHANNEL_BLURB: Record<UpdateChannel, string> = {
    stable: 'Polished releases, tested before they ship.',
    canary: 'Canari builds — newest features first, and sometimes rough.',
};

type GithubAsset = {
    name: string;
    browser_download_url: string;
};

type GithubRelease = {
    tag_name: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    assets: GithubAsset[];
};

type ManualTarget = {
    platform: UpdateStatus['platform'];
    arch: string;
    installKind: string;
};

const appVersion = () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev');
const channelLabel = (c: UpdateChannel) => (c === 'stable' ? 'Stable' : 'Canari');

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    return (await res.json()) as T;
}

function parseCanariRank(tag: string): [number, number, number, number] | null {
    const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)-canari\.(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

function compareRank(a: [number, number, number, number], b: [number, number, number, number]) {
    for (let i = 0; i < a.length; i += 1) {
        const delta = a[i] - b[i];
        if (delta !== 0) return delta;
    }
    return 0;
}

async function selectedRelease(channel: UpdateChannel): Promise<GithubRelease> {
    if (channel === 'stable') {
        try {
            const latest = await fetchJson<GithubRelease>(LATEST_RELEASE_API);
            if (!latest.draft && !latest.prerelease) return latest;
        } catch {
            // Fall through to the release list. The manual button should still
            // work when GitHub's latest alias is temporarily unavailable.
        }
    }

    const releases = await fetchJson<GithubRelease[]>(RELEASES_API);
    if (channel === 'stable') {
        const stable = releases.find((r) => !r.draft && !r.prerelease);
        if (stable) return stable;
    } else {
        const canari = releases
            .filter((r) => !r.draft && r.prerelease)
            .map((release) => ({ release, rank: parseCanariRank(release.tag_name) }))
            .filter((entry): entry is { release: GithubRelease; rank: [number, number, number, number] } => !!entry.rank)
            .sort((a, b) => compareRank(b.rank, a.rank))[0]?.release;
        if (canari) return canari;
    }

    throw new Error(`No ${channelLabel(channel)} release found`);
}

function browserPlatform(): UpdateStatus['platform'] {
    const ua = navigator.userAgent || '';
    if (/Windows NT/i.test(ua)) return 'windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
    if (/Linux|X11/i.test(ua)) return 'linux';
    return 'unknown';
}

function manualTarget(status: UpdateStatus | null, native: boolean): ManualTarget {
    if (native && status) {
        return {
            platform: status.platform,
            arch: status.arch,
            installKind: status.install_kind,
        };
    }

    const platform = browserPlatform();
    return {
        platform,
        arch: platform === 'windows' || platform === 'linux' ? 'x86_64' : 'unknown',
        installKind: platform === 'linux' ? 'appimage' : 'manual',
    };
}

function assetPatternFor(target: ManualTarget): RegExp | null {
    if (target.platform === 'windows') return /_x64-setup\.exe$/i;
    if (target.platform === 'linux') {
        return target.installKind === 'linux-package' ? /_amd64\.deb$/i : /_amd64\.AppImage$/i;
    }
    if (target.platform === 'macos') {
        if (target.arch === 'aarch64' || target.arch === 'arm64') return /_aarch64\.dmg$/i;
        if (target.arch === 'x86_64' || target.arch === 'x64' || target.arch === 'amd64') return /_x64\.dmg$/i;
        return null;
    }
    return null;
}

async function resolveManualDownloadUrl(
    channel: UpdateChannel,
    status: UpdateStatus | null,
    native: boolean,
): Promise<string> {
    const release = await selectedRelease(channel);
    const pattern = assetPatternFor(manualTarget(status, native));
    if (!pattern) return release.html_url || RELEASES_URL;
    const asset = release.assets.find((a) => pattern.test(a.name));
    return asset?.browser_download_url || release.html_url || RELEASES_URL;
}

export function UpdatesPanel() {
    const native = isTauri();
    const { status, checking, error, checkNow, installNow, rollback } = useNativeUpdater();

    const autoUpdateEnabled = useUpdatePreferences((s) => s.autoUpdateEnabled);
    const updateChannel = useUpdatePreferences((s) => s.updateChannel);
    const pinnedVersion = useUpdatePreferences((s) => s.pinnedVersion);
    const setAutoUpdateEnabled = useUpdatePreferences((s) => s.setAutoUpdateEnabled);
    const setUpdateChannel = useUpdatePreferences((s) => s.setUpdateChannel);
    const resumeUpdates = useUpdatePreferences((s) => s.resumeUpdates);

    const [installNote, setInstallNote] = useState<string | null>(null);
    const [manualOpening, setManualOpening] = useState(false);
    const [confirmingRollback, setConfirmingRollback] = useState(false);

    const currentVersion = status?.current_version ?? appVersion();
    const autoUpdateAvailable = native && !!status?.can_auto_update;
    const pending = autoUpdateAvailable && (status?.pending ?? false);
    const pendingVersion = status?.pending_version ?? null;
    const lastGood = native ? (status?.last_good_version ?? null) : null;
    const isCanariBuild = currentVersion.includes('canari') || currentVersion.includes('canary');

    const statusText = (() => {
        if (!native) return 'Browser/PWA updates apply on reload; desktop installers are manual downloads.';
        if (!status) return 'Reading updater status…';
        if (!autoUpdateAvailable) return status.manual_reason ?? 'Manual updates are used on this platform.';
        if (checking) return 'Checking…';
        if (pending) return 'Update ready · installs when you quit';
        return 'Up to date';
    })();

    const switchChannel = async (channel: UpdateChannel) => {
        if (channel === updateChannel) return;
        setUpdateChannel(channel);
        setInstallNote(null);
        // Explicit channel switches should check the intended next channel, not
        // the previous React render's preference.
        if (autoUpdateAvailable) await checkNow(channel);
    };

    const handleInstallNow = async () => {
        setInstallNote(null);
        const began = await installNow();
        if (!began) {
            setInstallNote('Audio is playing — it’ll install when you stop audio or quit.');
        }
        // When `began` is true the app restarts; nothing else to render.
    };

    const handleRollback = async () => {
        const ok = await rollback();
        setConfirmingRollback(false);
        // On success the store pins the version → the pinned banner takes over.
        if (!ok) setInstallNote('Couldn’t roll back — no backup was found.');
    };

    const handleManualDownload = async () => {
        setManualOpening(true);
        try {
            await openExternal(await resolveManualDownloadUrl(updateChannel, status, native));
        } catch {
            await openExternal(RELEASES_URL);
        } finally {
            setManualOpening(false);
        }
    };

    return (
        <div className="oj-upd">
            <h3 className="oj-upd-title">Updates</h3>

            {pinnedVersion && (
                <div className="oj-upd-pinned" role="status">
                    <div>
                        <strong>Pinned to <code className="oj-upd-ver">{pinnedVersion}</code></strong>
                        <p>Auto-update is off after a rollback. Resume when you’re ready.</p>
                    </div>
                    <button className="oj-upd-btn" onClick={resumeUpdates}>
                        Resume updates
                    </button>
                </div>
            )}

            <div className="oj-upd-status">
                <div className="oj-upd-status-line">
                    <span className="oj-upd-label">You’re on</span>
                    <code className="oj-upd-ver">{currentVersion}</code>
                    <span className="oj-upd-chip">{channelLabel(updateChannel)}</span>
                    {status?.install_kind && <span className="oj-upd-chip">{status.install_kind}</span>}
                </div>
                <div className="oj-upd-state">
                    {statusText}
                    {autoUpdateAvailable && !checking && (
                        <button
                            className="oj-upd-linkbtn oj-upd-check"
                            onClick={() => void checkNow(updateChannel)}
                            disabled={!!pinnedVersion}
                        >
                            Check now
                        </button>
                    )}
                </div>
            </div>

            {autoUpdateAvailable ? (
                <div className="oj-upd-row">
                    <label className="oj-upd-toggle">
                        <input
                            type="checkbox"
                            checked={autoUpdateEnabled}
                            disabled={!!pinnedVersion}
                            onChange={(e) => setAutoUpdateEnabled(e.target.checked)}
                        />
                        <span>Keep OpenJammer up to date automatically</span>
                    </label>
                    <p className="oj-upd-desc">
                        Updates download in the background and install when you quit. You’re never
                        interrupted mid-session.
                    </p>
                </div>
            ) : (
                <div className="oj-upd-row oj-upd-manual-info">
                    <span className="oj-upd-label">Automatic updates</span>
                    <p className="oj-upd-desc">
                        {native
                            ? status?.manual_reason ?? 'This build uses manual downloads for updates.'
                            : 'The browser version updates through its service worker. Desktop release channels are manual downloads here.'}
                    </p>
                </div>
            )}

            <div className="oj-upd-row">
                <span className="oj-upd-label">Release channel</span>
                <div className="oj-upd-seg" role="group" aria-label="Release channel">
                    {(['stable', 'canary'] as const).map((c) => (
                        <button
                            key={c}
                            className={`oj-upd-seg-btn ${updateChannel === c ? 'is-active' : ''}`}
                            aria-pressed={updateChannel === c}
                            disabled={!!pinnedVersion}
                            onClick={() => void switchChannel(c)}
                        >
                            {channelLabel(c)}
                        </button>
                    ))}
                </div>
                <p className="oj-upd-desc">{CHANNEL_BLURB[updateChannel]}</p>
            </div>

            <div className="oj-upd-card oj-upd-card-manual">
                <div className="oj-upd-card-body">
                    <strong>Download {channelLabel(updateChannel)} manually</strong>
                    <p>
                        Use this for a clean reinstall, macOS updates, Linux package-manager installs,
                        or a stale shortcut that still launches an old copy.
                    </p>
                </div>
                <button className="oj-upd-btn" disabled={manualOpening} onClick={() => void handleManualDownload()}>
                    {manualOpening ? 'Opening…' : `Download ${channelLabel(updateChannel)}`}
                </button>
            </div>

            {pending && pendingVersion ? (
                <div className="oj-upd-card" role="status">
                    <div className="oj-upd-card-body">
                        <strong>
                            {channelLabel(updateChannel)} <code className="oj-upd-ver">{pendingVersion}</code> is
                            ready.
                        </strong>
                        <p>It’ll install automatically when you quit — or get it now.</p>
                        {installNote && <p className="oj-upd-installnote">{installNote}</p>}
                    </div>
                    <button className="oj-upd-btn oj-upd-btn-primary" onClick={() => void handleInstallNow()}>
                        Update &amp; restart now
                    </button>
                </div>
            ) : updateChannel === 'stable' && isCanariBuild ? (
                <p className="oj-upd-desc oj-upd-ahead">
                    You’re ahead of Stable. You’ll move to Stable when it reaches your version — no
                    downgrade.
                </p>
            ) : null}

            {lastGood && !pinnedVersion && (
                <div className="oj-upd-rollback">
                    {!confirmingRollback ? (
                        <button
                            className="oj-upd-btn oj-upd-btn-danger"
                            onClick={() => setConfirmingRollback(true)}
                        >
                            Roll back to <code className="oj-upd-ver">{lastGood}</code>
                        </button>
                    ) : (
                        <div className="oj-upd-confirm">
                            <p>
                                Restores your projects, settings &amp; AI memory from before the last
                                update and turns auto-update off, so the bad build can’t come back.
                                Restart OpenJammer afterwards to finish. To revert the app itself,
                                reinstall <code className="oj-upd-ver">{lastGood}</code> from the{' '}
                                <button
                                    className="oj-upd-linkbtn"
                                    onClick={() => void openExternal(RELEASES_URL)}
                                >
                                    releases page
                                </button>
                                .
                            </p>
                            <div className="oj-upd-confirm-actions">
                                <button
                                    className="oj-upd-btn oj-upd-btn-danger"
                                    onClick={() => void handleRollback()}
                                >
                                    Yes, roll back
                                </button>
                                <button className="oj-upd-btn" onClick={() => setConfirmingRollback(false)}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {error && <p className="oj-upd-error">Couldn’t check for updates: {error}</p>}
        </div>
    );
}
