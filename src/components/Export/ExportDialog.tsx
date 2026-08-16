import { useMemo, useState } from 'react';
import { Button, Callout, Field, Input, Modal, PanelHeader, ProgressBar, SegmentedControl, Select } from '@openjammer/oj-ui';
import { toast } from 'sonner';
import { isTauri } from '../../ai/tauri';
import { useModalKeymap } from '../../keymap/useKeymap';
import type { Arrangement } from '../../song/types';
import { useProjectStore } from '../../store/projectStore';
import { assembleExportArgs, clipWarning, joinExportPath, peakWarning, safeExportFilename } from './exportSpec';
import { exportBrowser } from './browserExport';
import { exportNative, revealExport } from './nativeExport';
import type { BounceSpec, ExportProgress, ExportSampleRate, ExportStats } from './types';
import { arrangementLengthTicks, tickToSeconds, timebase } from '../../song/time';
import './ExportDialog.css';

type FormatChoice = 'wav24' | 'wav16' | 'wav32f' | 'flac24' | 'flac16';

const CHOICES: Record<FormatChoice, Pick<BounceSpec, 'format' | 'bitDepth'>> = {
    wav24: { format: 'wav', bitDepth: '24' },
    wav16: { format: 'wav', bitDepth: '16' },
    wav32f: { format: 'wav', bitDepth: '32f' },
    flac24: { format: 'flac', bitDepth: '24' },
    flac16: { format: 'flac', bitDepth: '16' },
};

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
    const [choice, setChoice] = useState<FormatChoice>('wav24');
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
        ...CHOICES[choice],
        tail: tailMode === 'auto' ? { mode: 'auto' } : { mode: 'fixed', seconds: Math.max(0, tailSeconds) },
    }), [choice, sampleRate, tailMode, tailSeconds]);
    const preflight = useMemo(() => {
        const lengthTicks = arrangementLengthTicks(arrangement);
        const seconds = tickToSeconds(arrangement, lengthTicks) + (tailMode === 'fixed' ? Math.max(0, tailSeconds) : 0);
        const bytesPerSample = spec.bitDepth === '16' ? 2 : 3;
        const megabytes = Math.max(1, Math.round(seconds * sampleRate * 2 * bytesPerSample / 1_000_000));
        return `${Math.ceil(lengthTicks / timebase(arrangement).ticksPerBar)} bars · ${formatPreflightDuration(seconds)} · ≈${megabytes} MB`;
    }, [arrangement, sampleRate, spec.bitDepth, tailMode, tailSeconds]);

    const close = () => {
        if (status !== 'exporting') onClose();
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
        <Modal open={open} onClose={close} closeOnScrim={status !== 'exporting'} ariaLabel="Export song" align="top" size="md">
            <PanelHeader title="Export song" onClose={status === 'exporting' ? undefined : close} />
            <div className="export-dialog">
                <p className="export-dialog__intro">Make a finished audio file from this arrangement.</p>
                <div className="export-dialog__form">
                    <Field className="export-dialog__filename" label="Filename" htmlFor="export-filename">
                        <Input id="export-filename" value={filename} onChange={(event) => setFilename(event.target.value)} disabled={status === 'exporting'} />
                    </Field>
                    <Field label="Format" htmlFor="export-format">
                        <Select id="export-format" value={choice} onChange={(event) => setChoice(event.target.value as FormatChoice)} disabled={status === 'exporting'}>
                            <option value="wav24">WAV 24-bit — recommended</option>
                            <option value="wav16" disabled={!native}>WAV 16-bit, dithered{!native ? ' — desktop only' : ''}</option>
                            <option value="wav32f" disabled={!native}>WAV 32-bit float{!native ? ' — desktop only' : ''}</option>
                            <option value="flac24" disabled={!native}>FLAC 24-bit{!native ? ' — desktop only' : ''}</option>
                            <option value="flac16" disabled={!native}>FLAC 16-bit{!native ? ' — desktop only' : ''}</option>
                        </Select>
                    </Field>
                    <Field label="Sample rate" htmlFor="export-rate">
                        <Select id="export-rate" value={sampleRate} onChange={(event) => setSampleRate(Number(event.target.value) as ExportSampleRate)} disabled={status === 'exporting'}>
                            <option value={48_000}>48 kHz — recommended</option>
                            <option value={44_100}>44.1 kHz</option>
                            <option value={88_200}>88.2 kHz</option>
                            <option value={96_000}>96 kHz</option>
                        </Select>
                    </Field>
                    <fieldset className="export-dialog__tail" disabled={status === 'exporting'}>
                        <legend>Tail</legend>
                        <SegmentedControl aria-label="Export tail" className="export-dialog__tail-options" value={tailMode} disabled={status === 'exporting'} onChange={setTailMode} options={[{ value: 'auto', label: 'Auto — listen for the ring-out' }, { value: 'fixed', label: 'Fixed' }]} />
                        {tailMode === 'fixed' && <Input aria-label="Tail seconds" type="number" min={0} step={0.1} value={tailSeconds} onChange={(event) => setTailSeconds(Number(event.target.value))} />}
                        {tailMode === 'fixed' && <span className="export-dialog__unit">seconds</span>}
                    </fieldset>
                    {native ? (
                        <Field label="Destination folder" htmlFor="export-destination">
                            <div className="export-dialog__destination">
                                <Input id="export-destination" value={destination} placeholder="Choose a folder or type its full path" onChange={(event) => setDestination(event.target.value)} disabled={status === 'exporting'} />
                                <Button type="button" disabled={status === 'exporting'} onClick={() => void chooseDestination()}>Choose…</Button>
                            </div>
                        </Field>
                    ) : <p className="export-dialog__destination-note">Destination: your browser’s Downloads folder.</p>}
                </div>

                <p className="export-dialog__preflight" aria-label="Estimated export size">{preflight}</p>
                <p className="export-dialog__advice">24-bit WAV or FLAC at 44.1/48 kHz is what streaming services want.</p>
                {!native && <Callout variant="info">Browser export steps the wasm engine faster than real time and writes 24-bit WAV. FLAC and 16-bit dither are desktop-only.</Callout>}

                {status === 'exporting' && (
                    <div className="export-dialog__progress">
                        <ProgressBar value={progress} max={100} aria-label="Song export progress" />
                        <p>Writing the song… {progress}%</p>
                        <p className="export-dialog__cancel-note">This renderer has no safe cancellation seam yet, so the dialog stays put until the file is finished.</p>
                    </div>
                )}
                <div className="sr-only" aria-live="polite">{progressText}</div>
                {status === 'error' && <Callout variant="danger" title="Export stopped">{error}</Callout>}
                {stats && (
                    <section className="export-stats" aria-label="Export statistics">
                        <div><span>Duration</span><strong>{formatDuration(stats.frames, stats.sampleRate)}</strong></div>
                        <div className={peakWarning(stats.maxSamplePeakDbfs) ? 'is-warning' : ''}><span>Peak (dBFS proxy)</span><strong>{displayPeak(stats.maxSamplePeakDbfs)}</strong></div>
                        <div className={clipWarning(stats.clippedSampleCount) ? 'is-danger' : ''}><span>Clipped samples</span><strong>{stats.clippedSampleCount.toLocaleString()}</strong></div>
                        {clipWarning(stats.clippedSampleCount) && <p className="export-stats__hint">A few samples hit the ceiling. Lower the master fader and try once more.</p>}
                        <p className="export-stats__path">{stats.path}</p>
                        {native && <Button onClick={() => void revealExport(stats.path)}>Reveal file</Button>}
                        <Button variant="ghost" onClick={() => setStats(null)}>Dismiss results</Button>
                    </section>
                )}
                <div className="export-dialog__actions">
                    <Button variant="ghost" onClick={close} disabled={status === 'exporting'}>{stats ? 'Close' : 'Not now'}</Button>
                    <Button variant="primary" onClick={() => void start()} disabled={status === 'exporting' || !filename.trim()}>{status === 'exporting' ? 'Exporting…' : 'Export song'}</Button>
                </div>
            </div>
        </Modal>
    );
}
