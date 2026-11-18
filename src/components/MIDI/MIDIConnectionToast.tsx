/**
 * MIDI Connection Toast — "something got plugged in".
 *
 * Banner physics: a raised Surface, the tone tinting the title only, the body in
 * secondary ink, the responses pinned to the trailing edge. It carries one extra
 * thing a Banner has no slot for — the auto-dismiss countdown — so it is drawn
 * as a hairline ProgressBar along the bottom edge rather than a coloured strip.
 *
 * Sonner owns positioning and the enter/exit animation; this owns the content.
 */

import { Banner, Button, IconButton, IconClose, ProgressBar } from '@openjammer/oj-ui';
import type { MIDIDeviceInfo, MIDIDevicePreset } from '../../midi/types';
import './MIDIConnectionToast.css';

/** Auto-dismiss timeout in seconds */
export const AUTO_DISMISS_SECONDS = 10;

interface MIDIConnectionToastProps {
    device: MIDIDeviceInfo;
    preset: MIDIDevicePreset | null;
    previewDeviceName: string;
    countdown: number;
    onAdd: () => void;
    onBrowse: () => void;
    onDismiss: () => void;
}

/** A five-pin DIN, drawn — the one glyph that says MIDI without a word. */
function MidiGlyph() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle cx="7.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="16.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="9.2" cy="8.2" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="14.8" cy="8.2" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
        </svg>
    );
}

export function MIDIConnectionToast({
    device,
    preset,
    previewDeviceName,
    countdown,
    onAdd,
    onBrowse,
    onDismiss,
}: MIDIConnectionToastProps) {
    const isRecognized = preset !== null;
    const presetName = preset?.name || 'Generic MIDI Device';

    return (
        <div className="midi-connection-toast" role="alert" aria-live="polite" aria-atomic="true">
            <Banner
                tone="info"
                icon={<MidiGlyph />}
                title={device.name}
                message={
                    <>
                        <span className="midi-connection-toast-line">
                            {isRecognized ? `Matched preset: ${presetName}` : 'Unknown device type'}
                        </span>
                        <span className="midi-connection-toast-line">
                            Add as <span className="midi-connection-toast-assign">{previewDeviceName}</span>
                        </span>
                    </>
                }
                actions={
                    <>
                        <Button variant="primary" onClick={onAdd}>
                            Add Device
                        </Button>
                        <Button variant="secondary" onClick={onBrowse}>
                            Browse
                        </Button>
                        <IconButton
                            label="Dismiss notification"
                            icon={<IconClose size={14} />}
                            onClick={onDismiss}
                        />
                    </>
                }
            />
            <ProgressBar
                className="midi-connection-toast-countdown"
                value={countdown}
                max={AUTO_DISMISS_SECONDS}
                aria-label={`Dismissing in ${Math.max(0, Math.round(countdown))} seconds`}
            />
        </div>
    );
}
