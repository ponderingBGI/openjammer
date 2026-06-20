import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from '@openjammer/oj-ui';
import type { ModalAlign, ModalSize } from '@openjammer/oj-ui';
import { Button } from '@openjammer/oj-ui';

const panelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
    padding: 'var(--space-lg)',
};

export const Default = () => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="primary" onClick={() => setOpen(true)}>
                Open dialog
            </Button>
            <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Example dialog">
                <div style={panelStyle}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-sketch)' }}>
                        Escape, a scrim click, or the button below all close this.
                    </p>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                        <Button onClick={() => setOpen(false)}>Cancel</Button>
                        <Button variant="primary" onClick={() => setOpen(false)}>
                            Confirm
                        </Button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

export const Alignments = () => {
    const [align, setAlign] = useState<ModalAlign | null>(null);
    return (
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            {(['top', 'center', 'bottom'] as ModalAlign[]).map((a) => (
                <Button key={a} onClick={() => setAlign(a)}>
                    {a}
                </Button>
            ))}
            <Modal
                open={align !== null}
                onClose={() => setAlign(null)}
                ariaLabel={`Aligned ${align ?? ''}`}
                align={align ?? 'center'}
            >
                <div style={panelStyle}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-sketch)' }}>
                        Aligned to <strong>{align}</strong>.
                    </p>
                    <Button onClick={() => setAlign(null)}>Close</Button>
                </div>
            </Modal>
        </div>
    );
};

export const Sizes = () => {
    const [size, setSize] = useState<ModalSize | null>(null);
    return (
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            {(['sm', 'md', 'lg', 'auto'] as ModalSize[]).map((s) => (
                <Button key={s} onClick={() => setSize(s)}>
                    {s}
                </Button>
            ))}
            <Modal
                open={size !== null}
                onClose={() => setSize(null)}
                ariaLabel={`Size ${size ?? ''}`}
                size={size ?? 'md'}
            >
                <div style={panelStyle}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-sketch)' }}>
                        Size <strong>{size}</strong>.
                    </p>
                    <Button onClick={() => setSize(null)}>Close</Button>
                </div>
            </Modal>
        </div>
    );
};

export const ScrimLocked = () => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button onClick={() => setOpen(true)}>Open (scrim won't close)</Button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                ariaLabel="Scrim-locked dialog"
                closeOnScrim={false}
            >
                <div style={panelStyle}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-sketch)' }}>
                        Clicking the scrim does nothing here — only Escape or the button closes it.
                    </p>
                    <Button variant="primary" onClick={() => setOpen(false)}>
                        Done
                    </Button>
                </div>
            </Modal>
        </>
    );
};
