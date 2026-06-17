/**
 * Settings → Updates: the single explicit surface for the native auto-updater.
 *
 * Everything else about updating is silent (the Live Performance Rule): with
 * auto-update on, a new build downloads in the background and installs when you
 * quit — no toasts, no modals, no mid-session interruptions. This panel is where
 * you set the channel, toggle auto-update, and (notably right after switching to
 * Canary) choose to update right now.
 */

import { useState } from 'react';

import { isTauri, openExternal } from '../../ai/tauri';
import { useNativeUpdater } from '../../hooks/useNativeUpdater';
import { useUpdatePreferences, type UpdateChannel } from '../../store/updatePreferencesStore';
import './UpdatesPanel.css';

const RELEASES_URL = 'https://github.com/ponderingBGI/openjammer/releases';

const CHANNEL_BLURB: Record<UpdateChannel, string> = {
    stable: 'Polished releases, tested before they ship.',
    canary: 'The bleeding edge — newest features first, and sometimes rough.',
};

export function UpdatesPanel() {
    const native = isTauri();
    const { supported, status, checking, error, checkNow, installNow, rollback } = useNativeUpdater();

    const autoUpdateEnabled = useUpdatePreferences((s) => s.autoUpdateEnabled);
    const updateChannel = useUpdatePreferences((s) => s.updateChannel);
    const pinnedVersion = useUpdatePreferences((s) => s.pinnedVersion);
    const setAutoUpdateEnabled = useUpdatePreferences((s) => s.setAutoUpdateEnabled);
    const setUpdateChannel = useUpdatePreferences((s) => s.setUpdateChannel);
    const resumeUpdates = useUpdatePreferences((s) => s.resumeUpdates);

    const [installNote, setInstallNote] = useState<string | null>(null);
    const [confirmingRollback, setConfirmingRollback] = useState(false);

    // Browser build — the PWA updates itself on reload; nothing to configure.
    if (!native) {
        return (
            <div className="oj-upd">
                <h3 className="oj-upd-title">Updates</h3>
                <p className="oj-upd-note">
                    You’re running OpenJammer in the browser — it refreshes itself automatically.
                    Auto-update settings live in the desktop app.
                </p>
            </div>
        );
    }

    // macOS / a platform without the updater compiled in.
    if (!supported) {
        return (
            <div className="oj-upd">
                <h3 className="oj-upd-title">Updates</h3>
                <p className="oj-upd-note">
                    Automatic updates aren’t available on this platform yet. Grab new versions from
                    the{' '}
                    <button className="oj-upd-linkbtn" onClick={() => void openExternal(RELEASES_URL)}>
                        releases page
                    </button>
                    .
                </p>
            </div>
        );
    }

    const currentVersion = status?.current_version ?? '—';
    const isCanaryBuild = currentVersion.includes('canary');
    const pending = status?.pending ?? false;
    const pendingVersion = status?.pending_version ?? null;
    const lastGood = status?.last_good_version ?? null;
    const channelLabel = (c: UpdateChannel) => (c === 'stable' ? 'Stable' : 'Canary');

    const switchChannel = async (channel: UpdateChannel) => {
        if (channel === updateChannel) return;
        setUpdateChannel(channel);
        setInstallNote(null);
        // An explicit choice — check right away so the result shows here.
        await checkNow();
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

            {/* Current version + live state */}
            <div className="oj-upd-status">
                <div className="oj-upd-status-line">
                    <span className="oj-upd-label">You’re on</span>
                    <code className="oj-upd-ver">{currentVersion}</code>
                    <span className="oj-upd-chip">{channelLabel(updateChannel)}</span>
                </div>
                <div className="oj-upd-state">
                    {checking
                        ? 'Checking…'
                        : pending
                          ? 'Update ready · installs when you quit'
                          : 'Up to date'}
                    {!checking && (
                        <button
                            className="oj-upd-linkbtn oj-upd-check"
                            onClick={() => void checkNow()}
                            disabled={!!pinnedVersion}
                        >
                            Check now
                        </button>
                    )}
                </div>
            </div>

            {/* Auto-update toggle */}
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

            {/* Channel selector */}
            <div className="oj-upd-row">
                <span className="oj-upd-label">Release channel</span>
                <div className="oj-upd-seg" role="group" aria-label="Release channel">
                    {(['stable', 'canary'] as const).map((c) => (
                        <button
                            key={c}
                            className={`oj-upd-seg-btn ${updateChannel === c ? 'is-active' : ''}`}
                            aria-pressed={updateChannel === c}
                            onClick={() => void switchChannel(c)}
                        >
                            {channelLabel(c)}
                        </button>
                    ))}
                </div>
                <p className="oj-upd-desc">{CHANNEL_BLURB[updateChannel]}</p>
            </div>

            {/* The one explicit "get it now" — surfaced after a switch / when ready */}
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
            ) : updateChannel === 'stable' && isCanaryBuild ? (
                <p className="oj-upd-desc oj-upd-ahead">
                    You’re ahead of Stable. You’ll move to Stable when it reaches your version — no
                    downgrade.
                </p>
            ) : null}

            {/* Rollback — restore the pre-update data snapshot + pin + auto-off. */}
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
