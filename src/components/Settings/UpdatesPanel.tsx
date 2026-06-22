/**
 * Settings → Updates: the single explicit surface for release channel choice.
 *
 * Auto-update remains quiet (the Live Performance Rule): supported desktop
 * installs stage updates in the background and install silently after close. Platforms
 * that cannot safely auto-update still get the same channel selector plus a
 * manual download button, so Settings never hides the path to Stable/Canari.
 */

import {
    Button,
    Callout,
    Chip,
    IconDownload,
    SegmentedControl,
    Spinner,
    StatusDot,
    Surface,
    Toggle,
} from '@openjammer/oj-ui';
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
        if (pending) return 'Update ready · installs after you close OpenJammer';
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

    const checkFailed = !!error && !checking;
    const headline = checkFailed ? 'Couldn’t check for updates' : statusText;
    const heroStatus = checkFailed
        ? 'bad'
        : pending
          ? 'info'
          : autoUpdateAvailable
            ? 'ok'
            : 'idle';

    const primaryAction =
        pending && pendingVersion ? (
            <Button variant="primary" onClick={() => void handleInstallNow()}>
                Update &amp; restart now
            </Button>
        ) : autoUpdateAvailable && !checking ? (
            <Button
                variant="secondary"
                onClick={() => void checkNow(updateChannel)}
                disabled={!!pinnedVersion}
            >
                Check now
            </Button>
        ) : null;

    return (
        <div className="oj-upd">
            {pinnedVersion && (
                <Callout
                    variant="warning"
                    className="oj-upd-callout"
                    title={
                        <>
                            Pinned to <code className="oj-upd-ver">{pinnedVersion}</code>
                        </>
                    }
                >
                    <div className="oj-upd-callout-row">
                        <span>Auto-update is paused after a rollback. Resume when you’re ready.</span>
                        <Button variant="secondary" onClick={resumeUpdates}>
                            Resume updates
                        </Button>
                    </div>
                </Callout>
            )}

            <Surface
                className="oj-upd-hero"
                elevation="rest"
                radius="lg"
                role="status"
                aria-live="polite"
            >
                <div className="oj-upd-hero-main">
                    <div className="oj-upd-hero-state">
                        {checking ? (
                            <Spinner size={18} />
                        ) : (
                            <StatusDot status={heroStatus} />
                        )}
                        <span className="oj-upd-hero-head">{headline}</span>
                    </div>
                    <div className="oj-upd-hero-meta">
                        <code className="oj-upd-ver">{currentVersion}</code>
                        <Chip>{channelLabel(updateChannel)}</Chip>
                        {status?.install_kind && <Chip>{status.install_kind}</Chip>}
                    </div>
                </div>
                {primaryAction}
            </Surface>

            {installNote && <p className="oj-upd-note">{installNote}</p>}

            <div className="oj-upd-group">
                {autoUpdateAvailable ? (
                    <Toggle
                        label="Automatic updates"
                        description="Downloads in the background, installs silently after you close OpenJammer."
                        checked={autoUpdateEnabled}
                        disabled={!!pinnedVersion}
                        onChange={setAutoUpdateEnabled}
                    />
                ) : (
                    <div className="oj-upd-row">
                        <div className="oj-upd-row-text">
                            <span className="oj-upd-row-label">Automatic updates</span>
                            <span className="oj-upd-row-desc">
                                {native
                                    ? status?.manual_reason ?? 'This build uses manual downloads.'
                                    : 'The browser version updates on reload; desktop channels are manual downloads here.'}
                            </span>
                        </div>
                    </div>
                )}

                <div className="oj-upd-row">
                    <div className="oj-upd-row-text">
                        <span className="oj-upd-row-label">Release channel</span>
                        <span className="oj-upd-row-desc">
                            {updateChannel === 'stable' && isCanariBuild
                                ? 'You’re ahead of Stable — you’ll move over when it catches up, no downgrade.'
                                : CHANNEL_BLURB[updateChannel]}
                        </span>
                    </div>
                    <SegmentedControl
                        aria-label="Release channel"
                        options={[
                            { value: 'stable', label: 'Stable' },
                            { value: 'canary', label: 'Canari' },
                        ]}
                        value={updateChannel}
                        disabled={!!pinnedVersion}
                        onChange={(c) => void switchChannel(c)}
                    />
                </div>
            </div>

            <div className="oj-upd-group">
                <div className="oj-upd-row">
                    <div className="oj-upd-row-text">
                        <span className="oj-upd-row-label">Download installer</span>
                        <span className="oj-upd-row-desc">
                            For a clean reinstall, another platform, or a stale shortcut.
                        </span>
                    </div>
                    <Button
                        variant="secondary"
                        className="oj-upd-dl"
                        disabled={manualOpening}
                        onClick={() => void handleManualDownload()}
                    >
                        <IconDownload size={16} aria-hidden="true" />
                        {manualOpening ? 'Opening…' : `Download ${channelLabel(updateChannel)}`}
                    </Button>
                </div>

                {lastGood && !pinnedVersion && (
                    <div className="oj-upd-row">
                        {!confirmingRollback ? (
                            <>
                                <div className="oj-upd-row-text">
                                    <span className="oj-upd-row-label">Roll back</span>
                                    <span className="oj-upd-row-desc">
                                        Restore <code className="oj-upd-ver">{lastGood}</code> and your
                                        projects, settings &amp; AI memory.
                                    </span>
                                </div>
                                <Button variant="danger" onClick={() => setConfirmingRollback(true)}>
                                    Roll back…
                                </Button>
                            </>
                        ) : (
                            <div className="oj-upd-confirm">
                                <p className="oj-upd-row-desc">
                                    Restores your data from before the last update and turns auto-update
                                    off. Restart afterwards; to revert the app itself, reinstall from the{' '}
                                    <Button variant="link" onClick={() => void openExternal(RELEASES_URL)}>
                                        releases page
                                    </Button>
                                    .
                                </p>
                                <div className="oj-upd-confirm-actions">
                                    <Button variant="danger" onClick={() => void handleRollback()}>
                                        Yes, roll back to <code className="oj-upd-ver">{lastGood}</code>
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setConfirmingRollback(false)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {checkFailed && (
                <Callout variant="danger" className="oj-upd-callout">
                    {error}
                </Callout>
            )}
        </div>
    );
}
