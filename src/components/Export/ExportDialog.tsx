import { useMemo, useState } from 'react';
import { Button, Callout, Chip, Field, Input, Modal, PanelHeader, ProgressBar, SegmentedControl, StatusDot, ValueScrubber } from '@openjammer/oj-ui';
import { toast } from 'sonner';
import { isTauri } from '../../ai/tauri';
import { useModalKeymap } from '../../keymap/useKeymap';
import type { Arrangement } from '../../song/types';
import { useProjectStore } from '../../store/projectStore';
import { assembleExportArgs, clipWarning, joinExportPath, peakWarning, safeExportFilename } from './exportSpec';
import { exportBrowser } from './browserExport';
import { exportNative, revealExport } from './nativeExport';
import type { BounceSpec, ExportBitDepth, ExportFormat, ExportProgress, ExportSampleRate, ExportStats } from './types';
import { arrangementLengthTicks, tickToSeconds, timebase } from '../../song/time';
import './ExportDialog.css';

/**
 * Format and bit depth are two decisions, not one dropdown of five strings.
 * The browser tier can only write 24-bit WAV, so off the desktop both controls
 * are locked to what is actually true rather than offering a lie.
 */
const FORMATS: { value: ExportFormat; label: string }[] = [
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC' },
];

const BIT_DEPTHS: Record<ExportFormat, { value: ExportBitDepth; label: string }[]> = {
    wav: [
        { value: '16', label: '16-bit' },
        { value: '24', label: '24-bit' },
        { value: '32f', label: '32-bit float' },
    ],
    flac: [
        { value: '16', label: '16-bit' },
        { value: '24', label: '24-bit' },
    ],
};

const SAMPLE_RATES: { value: string; label: string }[] = [
    { value: '44100', label: '44.1 kHz' },
    { value: '48000', label: '48 kHz' },
    { value: '88200', label: '88.2 kHz' },
    { value: '96000', label: '96 kHz' },
];

interface Props {
    open: boolean;
    arrangement: Arrangement;
    onClose: () => void;
}

function formatDuration(frames: number, sampleRate: number): string {
    const seconds = frames / sampleRate;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

function displayPeak(value: number): string {
    return Number.isFinite(value) ? `${value.toFixed(2)} dBFS` : '−∞ dBFS';
}

function formatPreflightDuration(seconds: number): string {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

async function pickNativeDirectory(): Promise<string | null> {
    const tauri = (window as unknown as {
        __TAURI__?: { dialog?: { open?: (options: { directory: boolean; multiple: boolean; title: string }) => Promise<string | string[] | null> } };
    }).__TAURI__;
    const selected = await tauri?.dialog?.open?.({ directory: true, multiple: false, title: 'Choose an export folder' });
    const direct = Array.isArray(selected) ? selected[0] ?? null : selected ?? null;
    if (direct) return direct;
    // Existing project/library flows use the File System Access picker. Some native
    // webviews add an absolute `path` to its handle; standard browsers intentionally do not.
    if (window.showDirectoryPicker) {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'music' });
        return (handle as FileSystemDirectoryHandle & { path?: string }).path ?? null;
    }
    return null;
}

export function ExportDialog({ open, arrangement, onClose }: Props) {
    const native = isTauri();
    const projectName = useProjectStore((state) => state.name);
    const [filename, setFilename] = useState(() => safeExportFilename(projectName ?? arrangement.name));
    const [format, setFormat] = useState<ExportFormat>('wav');
    const [bitDepth, setBitDepth] = useState<ExportBitDepth>('24');
    const [sampleRate, setSampleRate] = useState<ExportSampleRate>(48_000);
    const [tailMode, setTailMode] = useState<'auto' | 'fixed'>('auto');
    const [tailSeconds, setTailSeconds] = useState(2);
    const [destination, setDestination] = useState('');
    const [status, setStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');
    const [stats, setStats] = useState<ExportStats | null>(null);
    useModalKeymap('export', open);

    const spec = useMemo<BounceSpec>(() => ({
        sampleRate,
        format,
        bitDepth,
        tail: tailMode === 'auto' ? { mode: 'auto' } : { mode: 'fixed', seconds: Math.max(0, tailSeconds) },
    }), [bitDepth, format, sampleRate, tailMode, tailSeconds]);
    const preflight = useMemo(() => {
        const lengthTicks = arrangementLengthTicks(arrangement);
        const seconds = tickToSeconds(arrangement, lengthTicks) + (tailMode === 'fixed' ? Math.max(0, tailSeconds) : 0);
        const bytesPerSample = spec.bitDepth === '16' ? 2 : 3;
        const megabytes = Math.max(1, Math.round(seconds * sampleRate * 2 * bytesPerSample / 1_000_000));
        return `${Math.ceil(lengthTicks / timebase(arrangement).ticksPerBar)} bars · ${formatPreflightDuration(seconds)} · ≈${megabytes} MB`;
    }, [arrangement, sampleRate, spec.bitDepth, tailMode, tailSeconds]);

    /** While a render is in flight every control is frozen — the file is being written. */
    const busy = status === 'exporting';

    const close = () => {
        if (!busy) onClose();
    };

    const reportProgress = (next: ExportProgress) => {
        const ratio = next.totalBlocksEstimate > 0 ? next.blocksRendered / next.totalBlocksEstimate : 0;
        const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        setProgress(percent);
        setProgressText(`Export ${percent}% complete`);
    };

    const chooseDestination = async () => {
        try {
            const path = await pickNativeDirectory();
            if (path) setDestination(path);
            else setError('This shell cannot return a folder path. Type the full destination folder below.');
        } catch (caught) {
            if (caught instanceof DOMException && caught.name === 'AbortError') return;
            setError(caught instanceof Error ? caught.message : String(caught));
        }
    };

    const start = async () => {
        const cleanName = safeExportFilename(filename);
        if (native && !destination.trim()) {
            setError('Choose a folder, or type its full path.');
            setStatus('error');
            return;
        }
        setStatus('exporting');
        setError('');
        setStats(null);
        setProgress(0);
        setProgressText('Export started');
        try {
            let result: ExportStats;
            if (native) {
                const outPath = joinExportPath(destination.trim(), cleanName, spec);
                const args = assembleExportArgs(arrangement, spec, outPath, 'native');
                result = await exportNative(args, reportProgress);
            } else {
                result = await exportBrowser(arrangement, spec, cleanName, reportProgress);
            }
            setProgress(100);
            setProgressText('Export complete');
            setStats(result);
            setStatus('done');
            toast.success('Your song found its way onto the page.', { description: native ? result.path : `${cleanName}.wav downloaded` });
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            setError(message);
            setStatus('error');
            setProgressText('Export failed');
        }
    };

    return (
        <Modal open={open} onClose={close} closeOnScrim={!busy} ariaLabel="Export song" align="top" size="md">
            <PanelHeader title="Export song" onClose={busy ? undefined : close} />
            <div className="export-dialog">
                <p className="export-dialog__intro">Make a finished audio file from this arrangement.</p>
                <div className="export-dialog__form">
                    <Field className="export-dialog__wide" label="Filename" htmlFor="export-filename">
                        <Input id="export-filename" value={filename} onChange={(event) => setFilename(event.target.value)} disabled={busy} />
                    </Field>

                    {/* Off the desktop there is no choice to make, so the value is
                        STATED rather than shown as a greyed-out control you cannot
                        read the selection off. */}
                    <Field label="Format" description={native ? undefined : 'FLAC is desktop only'}>
                        {native ? (
                            <SegmentedControl
                                aria-label="Export format"
                                value={format}
                                disabled={busy}
                                options={FORMATS}
                                onChange={(next) => {
                                    setFormat(next);
                                    // FLAC has no 32-bit float — keep the pair legal.
                                    if (next === 'flac' && bitDepth === '32f') setBitDepth('24');
                                }}
                            />
                        ) : (
                            <span className="export-dialog__fixed" aria-label="Export format">
                                <Chip>WAV</Chip>
                            </span>
                        )}
                    </Field>

                    <Field label="Bit depth" description={native ? undefined : 'The browser writes 24-bit'}>
                        {native ? (
                            <SegmentedControl
                                aria-label="Bit depth"
                                value={bitDepth}
                                disabled={busy}
                                options={BIT_DEPTHS[format]}
                                onChange={setBitDepth}
                            />
                        ) : (
                            <span className="export-dialog__fixed" aria-label="Bit depth">
                                <Chip>24-bit</Chip>
                            </span>
                        )}
                    </Field>

                    <Field className="export-dialog__wide" label="Sample rate">
                        <SegmentedControl
                            aria-label="Sample rate"
                            value={String(sampleRate)}
                            disabled={busy}
                            options={SAMPLE_RATES}
                            onChange={(next) => setSampleRate(Number(next) as ExportSampleRate)}
                        />
                    </Field>

                    <Field className="export-dialog__wide" label="Tail" description="How much of the ring-out to keep after the last note.">
                        <div className="export-dialog__tail">
                            <SegmentedControl
                                aria-label="Export tail"
                                value={tailMode}
                                disabled={busy}
                                onChange={setTailMode}
                                options={[{ value: 'auto', label: 'Auto — listen for the ring-out' }, { value: 'fixed', label: 'Fixed' }]}
                            />
                            {tailMode === 'fixed' && (
                                <ValueScrubber
                                    label="Length"
                                    value={tailSeconds}
                                    display={`${tailSeconds.toFixed(1)} s`}
                                    disabled={busy}
                                    onCommit={(next) => setTailSeconds(Math.max(0, next))}
                                    onWheel={(event) => {
                                        if (busy) return;
                                        event.preventDefault();
                                        setTailSeconds((current) => Math.max(0, Number((current + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(1))));
                                    }}
                                />
                            )}
                        </div>
                    </Field>

                    {native ? (
                        <Field className="export-dialog__wide" label="Destination folder" htmlFor="export-destination">
                            <div className="export-dialog__destination">
                                <Input mono id="export-destination" value={destination} placeholder="Choose a folder or type its full path" onChange={(event) => setDestination(event.target.value)} disabled={busy} />
                                <Button type="button" disabled={busy} onClick={() => void chooseDestination()}>Choose…</Button>
                            </div>
                        </Field>
                    ) : <p className="export-dialog__destination-note export-dialog__wide">Destination: your browser’s Downloads folder.</p>}
                </div>

                <div className="export-dialog__preflight" aria-label="Estimated export size">
                    <Chip>{preflight}</Chip>
                </div>
                <p className="export-dialog__advice">24-bit WAV or FLAC at 44.1/48 kHz is what streaming services want.</p>
                {!native && <Callout variant="info" title="Browser export">Steps the wasm engine faster than real time and writes 24-bit WAV. FLAC and 16-bit dither are desktop-only.</Callout>}

                {status === 'exporting' && (
                    <div className="export-dialog__progress">
                        <ProgressBar value={progress} max={100} aria-label="Song export progress" />
                        <p className="export-dialog__progress-line">Writing the song… <span className="export-dialog__mono">{progress}%</span></p>
                        <p className="export-dialog__cancel-note">This renderer has no safe cancellation seam yet, so the dialog stays put until the file is finished.</p>
                    </div>
                )}
                <div className="sr-only" aria-live="polite">{progressText}</div>
                {status === 'error' && <Callout variant="danger" title="Export stopped">{error}</Callout>}
                {stats && (
                    <Callout
                        className="export-stats"
                        variant={clipWarning(stats.clippedSampleCount) ? 'danger' : peakWarning(stats.maxSamplePeakDbfs) ? 'warning' : 'success'}
                        title={clipWarning(stats.clippedSampleCount) ? 'Exported, but it clipped' : 'Exported'}
                        aria-label="Export statistics"
                    >
                        <div className="export-stats__grid">
                            <div className="export-stats__cell">
                                <span>Duration</span>
                                <strong className="export-dialog__mono">{formatDuration(stats.frames, stats.sampleRate)}</strong>
                            </div>
                            <div className="export-stats__cell">
                                <span>Peak (dBFS proxy)</span>
                                <strong className="export-dialog__mono">
                                    <StatusDot status={peakWarning(stats.maxSamplePeakDbfs) ? 'warn' : 'ok'} />
                                    {displayPeak(stats.maxSamplePeakDbfs)}
                                </strong>
                            </div>
                            <div className="export-stats__cell">
                                <span>Clipped samples</span>
                                <strong className="export-dialog__mono">
                                    <StatusDot status={clipWarning(stats.clippedSampleCount) ? 'bad' : 'ok'} />
                                    {stats.clippedSampleCount.toLocaleString()}
                                </strong>
                            </div>
                        </div>
                        {clipWarning(stats.clippedSampleCount) && <p className="export-stats__hint">A few samples hit the ceiling. Lower the master fader and try once more.</p>}
                        <p className="export-stats__path">{stats.path}</p>
                        <div className="export-stats__actions">
                            {native && <Button onClick={() => void revealExport(stats.path)}>Reveal file</Button>}
                            <Button variant="ghost" onClick={() => setStats(null)}>Dismiss results</Button>
                        </div>
                    </Callout>
                )}
                <div className="export-dialog__actions">
                    <Button variant="ghost" onClick={close} disabled={busy}>{stats ? 'Close' : 'Not now'}</Button>
                    <Button variant="primary" loading={busy} onClick={() => void start()} disabled={busy || !filename.trim()}>{busy ? 'Exporting…' : 'Export song'}</Button>
                </div>
            </div>
        </Modal>
    );
}
