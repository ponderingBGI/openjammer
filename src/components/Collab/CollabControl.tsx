/**
 * U23 — Share / Join session control + peer list.
 *
 * A small floating control that lets a user HOST a collaboration session
 * (generating a shareable code) or JOIN one (entering a code), and shows the
 * live peer list while connected. Behind a clean component; it does not touch
 * the canvas internals.
 *
 * Default transport is BroadcastChannel (same-origin tabs, zero infra). The
 * manual-signaling WebRTC path is also exposed for true LAN/peer links via the
 * "LAN (WebRTC)" toggle — the host shares an offer code, the guest pastes it
 * and returns an answer code (see ./WebRTCSignaling.tsx).
 *
 * Realtime AUDIO is a separate, deferred plane — this control governs the
 * collaborative STATE plane only.
 */

import { useState } from 'react';
import { Button, Input, Select } from '@openjammer/oj-ui';
import { useCollabStore, type TransportKind } from '../../store/collabStore';
import { WebRTCSignaling } from './WebRTCSignaling';
import './CollabControl.css';

export function CollabControl() {
    const status = useCollabStore((s) => s.status);
    const sessionCode = useCollabStore((s) => s.sessionCode);
    const transportLabel = useCollabStore((s) => s.transportLabel);
    const self = useCollabStore((s) => s.self);
    const peers = useCollabStore((s) => s.peers);
    const error = useCollabStore((s) => s.error);
    const hostSession = useCollabStore((s) => s.hostSession);
    const joinSession = useCollabStore((s) => s.joinSession);
    const leaveSession = useCollabStore((s) => s.leaveSession);

    const [open, setOpen] = useState(false);
    const [joinCode, setJoinCode] = useState('');
    const [name, setNameInput] = useState('');
    const [transport, setTransport] = useState<TransportKind>('broadcast-channel');
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    const connected = status === 'connected';

    const handleHost = async () => {
        setBusy(true);
        try {
            await hostSession({ name: name || undefined, transport });
        } finally {
            setBusy(false);
        }
    };

    const handleJoin = async () => {
        if (!joinCode.trim()) return;
        setBusy(true);
        try {
            await joinSession(joinCode.trim().toUpperCase(), { name: name || undefined, transport });
        } finally {
            setBusy(false);
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(sessionCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard may be unavailable */
        }
    };

    return (
        <div className="collab-control">
            <button
                className={`collab-toggle ${connected ? 'connected' : ''}`}
                onClick={() => setOpen((o) => !o)}
                title={connected ? `In session ${sessionCode}` : 'Share / Join a jam session'}
            >
                <span className="collab-toggle-dot" />
                {connected ? `Jam: ${sessionCode}` : 'Collaborate'}
                {connected && peers.length > 0 && (
                    <span className="collab-peer-count">{peers.length + 1}</span>
                )}
            </button>

            {open && (
                <div className="collab-panel">
                    {!connected ? (
                        <>
                            <h3 className="collab-panel-title">Jam together</h3>

                            <label className="collab-field">
                                <span>Your name</span>
                                <Input
                                    type="text"
                                    value={name}
                                    placeholder="Anonymous"
                                    onChange={(e) => setNameInput(e.target.value)}
                                />
                            </label>

                            <label className="collab-field">
                                <span>Link</span>
                                <Select
                                    value={transport}
                                    onChange={(e) => setTransport(e.target.value as TransportKind)}
                                >
                                    <option value="broadcast-channel">Same browser (tabs)</option>
                                    <option value="webrtc-manual">LAN / peer (WebRTC)</option>
                                </Select>
                            </label>

                            <Button variant="primary" onClick={handleHost} disabled={busy}>
                                Host new session
                            </Button>

                            <div className="collab-divider"><span>or</span></div>

                            <div className="collab-join-row">
                                <Input
                                    type="text"
                                    className="collab-code-input"
                                    value={joinCode}
                                    placeholder="Enter code"
                                    maxLength={12}
                                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                                />
                                <Button variant="primary" onClick={handleJoin} disabled={busy || !joinCode.trim()}>
                                    Join
                                </Button>
                            </div>

                            {error && <p className="collab-error">{error}</p>}
                        </>
                    ) : (
                        <>
                            <div className="collab-session-head">
                                <h3 className="collab-panel-title">Session {sessionCode}</h3>
                                <Button variant="ghost" onClick={handleCopy}>
                                    {copied ? 'Copied!' : 'Copy code'}
                                </Button>
                            </div>
                            <p className="collab-transport">via {transportLabel}</p>

                            {transport === 'webrtc-manual' && <WebRTCSignaling />}

                            <ul className="collab-peer-list">
                                {self && (
                                    <li className="collab-peer">
                                        <span className="collab-peer-dot" style={{ background: self.color }} />
                                        <span className="collab-peer-name">{self.name} (you)</span>
                                    </li>
                                )}
                                {peers.map((p) => (
                                    <li className="collab-peer" key={p.peerId}>
                                        <span className="collab-peer-dot" style={{ background: p.color }} />
                                        <span className="collab-peer-name">{p.name}</span>
                                    </li>
                                ))}
                                {peers.length === 0 && (
                                    <li className="collab-peer-empty">Waiting for peers…</li>
                                )}
                            </ul>

                            <Button variant="danger" onClick={leaveSession}>
                                Leave session
                            </Button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
