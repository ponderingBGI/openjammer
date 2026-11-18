/**
 * U23 — Share / Join session control + peer list.
 *
 * A topbar control that lets a user HOST a collaboration session (generating a
 * shareable code) or JOIN one (entering a code), and shows the live peer list
 * while connected. Behind a clean component; it does not touch the canvas
 * internals.
 *
 * Default transport is BroadcastChannel (same-origin tabs, zero infra). The
 * manual-signaling WebRTC path is also exposed for true LAN/peer links via the
 * "LAN (WebRTC)" option — the host shares an offer code, the guest pastes it and
 * returns an answer code (see ./WebRTCSignaling.tsx).
 *
 * Realtime AUDIO is a separate, deferred plane — this control governs the
 * collaborative STATE plane only.
 *
 * Shape: a chip-sized trigger in the topbar's right cluster and a popover
 * Surface below it, built from oj-ui Fields, ListRows and StatusDots. The peer
 * colour is DATA (each peer picks one), so it is the only inline colour here and
 * it only ever paints an 8px dot beside a name — never text or a fill whose
 * contrast we cannot vouch for.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Callout, Chip, Field, Input, List, ListRow, Select, StatusDot, Surface } from '@openjammer/oj-ui';
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
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const connected = status === 'connected';

    // A popover closes when you look away from it or press Escape — the same
    // contract as every other transient surface in the app.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);

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
        <div className="collab-control" ref={rootRef}>
            <button
                ref={triggerRef}
                type="button"
                className={`collab-toggle ${connected ? 'is-connected' : ''}`}
                aria-expanded={open}
                aria-haspopup="dialog"
                title={connected ? `In session ${sessionCode}` : 'Share / Join a jam session'}
                onClick={() => setOpen((o) => !o)}
            >
                <StatusDot status={connected ? 'ok' : 'idle'} />
                {connected ? `Jam ${sessionCode}` : 'Collaborate'}
                {connected && peers.length > 0 && (
                    <span className="collab-peer-count">{peers.length + 1}</span>
                )}
            </button>

            {open && (
                <Surface
                    elevation="overlay"
                    radius="lg"
                    className="collab-panel"
                    role="dialog"
                    aria-label={connected ? `Session ${sessionCode}` : 'Jam together'}
                >
                    {!connected ? (
                        <>
                            <h3 className="collab-panel-title">Jam together</h3>

                            <Field label="Your name" htmlFor="collab-name">
                                <Input
                                    id="collab-name"
                                    type="text"
                                    value={name}
                                    placeholder="Anonymous"
                                    onChange={(e) => setNameInput(e.target.value)}
                                />
                            </Field>

                            <Field label="Link" htmlFor="collab-transport">
                                <Select
                                    id="collab-transport"
                                    value={transport}
                                    onChange={(e) => setTransport(e.target.value as TransportKind)}
                                >
                                    <option value="broadcast-channel">Same browser (tabs)</option>
                                    <option value="webrtc-manual">LAN / peer (WebRTC)</option>
                                </Select>
                            </Field>

                            <Button variant="primary" onClick={handleHost} loading={busy} disabled={busy}>
                                Host new session
                            </Button>

                            <div className="collab-divider"><span>or</span></div>

                            <div className="collab-join-row">
                                <Input
                                    mono
                                    type="text"
                                    aria-label="Session code"
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

                            {error && <Callout variant="danger" title="Couldn’t connect">{error}</Callout>}
                        </>
                    ) : (
                        <>
                            <div className="collab-session-head">
                                <h3 className="collab-panel-title">Session</h3>
                                <Chip className="collab-code">{sessionCode}</Chip>
                                <Button variant="ghost" onClick={handleCopy}>
                                    {copied ? 'Copied' : 'Copy code'}
                                </Button>
                            </div>
                            <p className="collab-transport">via {transportLabel}</p>

                            {transport === 'webrtc-manual' && <WebRTCSignaling />}

                            <List aria-label="People in this session" className="collab-peer-list">
                                {self && (
                                    <ListRow className="collab-peer">
                                        <span
                                            className="collab-peer-dot"
                                            style={{ background: self.color }}
                                            aria-hidden="true"
                                        />
                                        <span className="collab-peer-name">{self.name}</span>
                                        <Chip>you</Chip>
                                    </ListRow>
                                )}
                                {peers.map((p) => (
                                    <ListRow className="collab-peer" key={p.peerId}>
                                        <span
                                            className="collab-peer-dot"
                                            style={{ background: p.color }}
                                            aria-hidden="true"
                                        />
                                        <span className="collab-peer-name">{p.name}</span>
                                    </ListRow>
                                ))}
                                {peers.length === 0 && (
                                    <p className="collab-peer-empty">
                                        Waiting for peers — send them the code above.
                                    </p>
                                )}
                            </List>

                            <Button variant="danger" onClick={leaveSession}>
                                Leave session
                            </Button>
                        </>
                    )}
                </Surface>
            )}
        </div>
    );
}
