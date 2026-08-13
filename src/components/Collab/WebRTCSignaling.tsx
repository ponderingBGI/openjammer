/**
 * U23 — Manual WebRTC signaling UI (copy/paste offer & answer codes).
 *
 * No signaling server is required: the host generates an OFFER code, the guest
 * pastes it to produce an ANSWER code, and the host pastes the answer back. Once
 * both sides have exchanged codes the DataChannel opens and the session syncs.
 *
 * This component only appears when the active session's transport is the
 * manual-signaling WebRTC transport.
 */

import { useState } from 'react';
import { Button, Textarea } from '@openjammer/oj-ui';
import { useCollabStore } from '../../store/collabStore';

export function WebRTCSignaling() {
    const role = useCollabStore((s) => s.session?.getState().role);
    const webrtc = useCollabStore((s) => s.webrtcTransport);

    const [offer, setOffer] = useState('');
    const [answer, setAnswer] = useState('');
    const [remoteOffer, setRemoteOffer] = useState('');
    const [remoteAnswer, setRemoteAnswer] = useState('');
    const [step, setStep] = useState<'idle' | 'offered' | 'answered' | 'done'>('idle');

    if (!webrtc) return null;

    // HOST flow: create offer -> share -> paste answer.
    if (role === 'host') {
        return (
            <div className="collab-signaling">
                {step === 'idle' && (
                    <Button
                        variant="secondary"
                        onClick={async () => {
                            setOffer(await webrtc.createOffer());
                            setStep('offered');
                        }}
                    >
                        Generate invite code
                    </Button>
                )}
                {step !== 'idle' && (
                    <>
                        <label className="collab-field">
                            <span>1. Share this invite code</span>
                            <Textarea readOnly value={offer} rows={3} onFocus={(e) => e.target.select()} />
                        </label>
                        <label className="collab-field">
                            <span>2. Paste their answer code</span>
                            <Textarea
                                value={remoteAnswer}
                                rows={3}
                                placeholder="Paste answer…"
                                onChange={(e) => setRemoteAnswer(e.target.value)}
                            />
                        </label>
                        <Button
                            variant="primary"
                            disabled={!remoteAnswer.trim() || step === 'done'}
                            onClick={async () => {
                                await webrtc.acceptAnswer(remoteAnswer.trim());
                                setStep('done');
                            }}
                        >
                            {step === 'done' ? 'Connecting…' : 'Connect'}
                        </Button>
                    </>
                )}
            </div>
        );
    }

    // GUEST flow: paste offer -> get answer -> share answer back.
    return (
        <div className="collab-signaling">
            <label className="collab-field">
                <span>1. Paste the host's invite code</span>
                <Textarea
                    value={remoteOffer}
                    rows={3}
                    placeholder="Paste invite…"
                    onChange={(e) => setRemoteOffer(e.target.value)}
                />
            </label>
            <Button
                variant="secondary"
                disabled={!remoteOffer.trim() || step === 'answered'}
                onClick={async () => {
                    setAnswer(await webrtc.acceptOffer(remoteOffer.trim()));
                    setStep('answered');
                }}
            >
                Generate answer
            </Button>
            {answer && (
                <label className="collab-field">
                    <span>2. Send this answer back to the host</span>
                    <Textarea readOnly value={answer} rows={3} onFocus={(e) => e.target.select()} />
                </label>
            )}
        </div>
    );
}
