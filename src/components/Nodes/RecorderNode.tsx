/**
 * Recorder Node — capture what is reaching this input, to a WAV.
 *
 * Two states and one clock. Idle, the card is a red button and a list of what
 * you already caught; armed, the elapsed time is the only thing that matters and
 * it is the biggest thing on the card.
 *
 * The clock and the level never pass through React (UI-023): the time is written
 * straight into a text node from the Recorder's own callback, and the level is
 * an oj-ui `Meter` fed from the app's one shared animation frame. A recorder
 * that re-rendered its node ten times a second would be spending a performer's
 * frame budget on a number.
 */

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { toast } from 'sonner';
import {
    Button,
    IconButton,
    IconCheck,
    IconClose,
    IconDownload,
    List,
    ListRow,
    Meter,
    type MeterHandle,
} from '@openjammer/oj-ui';
import type { GraphNode } from '../../engine/types';
import { useAudioStore } from '../../store/audioStore';
import { useProjectStore } from '../../store/projectStore';
import { useLibraryStore } from '../../store/libraryStore';
import { getExecutor } from '../../audio/executor';
import { getAudioContext } from '../../audio/audioContext';
import { registerTimelineLevelWriter } from '../Arrangement/timelineSignalLevels';
import { meterScale } from '../Shell/masterSignal';
import type { Recording as AudioRecording } from '../../audio/executor';
import './RecorderNode.css';

interface RecorderNodeProps {
    node: GraphNode;
}

interface RecordingState {
    id: string;
    name: string;
    duration: number;
    timestamp: number;
    savedToProject?: boolean;
    libraryItemId?: string;
}

/** `m:ss`. The one time format on this card, and on the clips beside it. */
function formatClock(seconds: number): string {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const RecorderNode = memo(function RecorderNode({ node }: RecorderNodeProps) {
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const projectName = useProjectStore((s) => s.name);
    const getProjectHandle = useProjectStore((s) => s.getProjectHandle);
    const addAudioFile = useProjectStore((s) => s.addAudioFile);

    const saveAudioToLibrary = useLibraryStore((s) => s.saveAudioToLibrary);
    const trashItem = useLibraryStore((s) => s.trashItem);

    const [isRecording, setIsRecording] = useState(false);
    const [recordings, setRecordings] = useState<RecordingState[]>([]);
    const [isSaving, setIsSaving] = useState<string | null>(null);

    const clockRef = useRef<HTMLSpanElement>(null);
    const meterRef = useRef<MeterHandle>(null);
    const recordingRef = useRef(false);
    // Read by the shared frame writer; synced in an effect so the level never
    // touches render.
    useEffect(() => { recordingRef.current = isRecording; }, [isRecording]);

    const getRecorder = useCallback(() => getExecutor().getRecorder(node.id), [node.id]);

    // The incoming level, on the shared frame. Only while armed — a recorder
    // that is not recording has nothing to report. On the same dB scale as every
    // other meter in the app (the shared `meterScale`): a linear bar under a dB
    // world is a lie dressed as precision.
    useEffect(() => registerTimelineLevelWriter((levels) => {
        meterRef.current?.setSignal(recordingRef.current ? meterScale(levels.get(node.id) ?? 0) : 0);
    }), [node.id]);

    useEffect(() => {
        if (!isAudioContextReady) return;
        const recorder = getRecorder();
        if (!recorder) return;

        recorder.setOnRecordingComplete((recording: AudioRecording) => {
            setRecordings((prev) => [
                ...prev,
                {
                    id: recording.id,
                    name: recording.name,
                    duration: recording.duration,
                    timestamp: recording.timestamp,
                },
            ]);
            setIsRecording(false);
            if (clockRef.current) clockRef.current.textContent = formatClock(0);
        });

        // The clock is a text node, not state.
        recorder.setOnTimeUpdate((time: number) => {
            if (clockRef.current) clockRef.current.textContent = formatClock(time);
        });

        recorder.setOnRecordingDeleted((deletedRecording: AudioRecording) => {
            if (deletedRecording.libraryItemId) trashItem(deletedRecording.libraryItemId);
        });

        const existingRecordings = recorder.getRecordings();
        if (existingRecordings.length > 0) {
            setRecordings(existingRecordings.map((r) => ({
                id: r.id,
                name: r.name,
                duration: r.duration,
                timestamp: r.timestamp,
            })));
        }

        return () => {
            recorder.setOnRecordingComplete(() => {});
            recorder.setOnRecordingDeleted(() => {});
            recorder.setOnTimeUpdate(() => {});
        };
    }, [isAudioContextReady, node.id, getRecorder, trashItem]);

    const handleStartRecording = useCallback(() => {
        const recorder = getRecorder();
        if (!recorder) return;
        recorder.startRecording();
        setIsRecording(true);
    }, [getRecorder]);

    const handleStopRecording = useCallback(() => {
        getRecorder()?.stopRecording();
        // isRecording is cleared by the completion callback.
    }, [getRecorder]);

    const handleDownload = useCallback((recordingId: string) => {
        getRecorder()?.downloadRecording(recordingId);
    }, [getRecorder]);

    const handleDelete = useCallback((recordingId: string) => {
        getRecorder()?.deleteRecording(recordingId);
        setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
    }, [getRecorder]);

    const handleSaveToProject = useCallback(async (recordingId: string) => {
        if (!projectName) {
            toast.error('No project open. Create or open a project first.');
            return;
        }

        const recorder = getRecorder();
        if (!recorder) return;

        const recordingBlob = recorder.getRecordingBlob(recordingId);
        if (!recordingBlob) {
            toast.error('Recording not found');
            return;
        }

        setIsSaving(recordingId);
        try {
            const ctx = getAudioContext();
            if (!ctx) {
                toast.error('Audio context not available');
                return;
            }

            const arrayBuffer = await recordingBlob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            const recordingName = recordings.find((r) => r.id === recordingId)?.name || 'Recording';
            const libraryItemId = await saveAudioToLibrary(audioBuffer, recordingName, ['recording']);

            if (!libraryItemId) {
                toast.error('Failed to save recording to library');
                return;
            }

            const recording = recorder.getRecordings().find((r) => r.id === recordingId);
            if (recording) recording.libraryItemId = libraryItemId;

            const handle = await getProjectHandle();
            if (handle) {
                const result = await recorder.saveRecordingToProject(recordingId, handle);
                if (result) await addAudioFile(recordingId, result);
            }

            setRecordings((prev) => prev.map((r) =>
                r.id === recordingId ? { ...r, savedToProject: true, libraryItemId } : r,
            ));
            toast.success('Recording saved to project');
        } catch (err) {
            console.error('Failed to save recording:', err);
            toast.error('Failed to save recording');
        } finally {
            setIsSaving(null);
        }
    }, [projectName, getRecorder, getProjectHandle, addAudioFile, saveAudioToLibrary, recordings]);

    return (
        <div className="recorder-node">
            {/* The clock, and what is arriving. The meter sits on the card
                surface rather than inside the inset clock, because the oj-ui
                Meter's idle track IS `--bg-tertiary` — on that bed it would be
                invisible. */}
            <div className={`recorder-clock${isRecording ? ' is-recording' : ''}`}>
                <span className="recorder-clock__time" ref={clockRef}>0:00</span>
            </div>
            <div className="recorder-level">
                <Meter ref={meterRef} bars={12} height={18} barWidth={4} label="Recording input level" />
            </div>

            {!isRecording ? (
                <Button
                    variant="danger"
                    className="recorder-arm"
                    onClick={handleStartRecording}
                    disabled={!isAudioContextReady}
                >
                    Record
                </Button>
            ) : (
                <Button variant="node" className="recorder-arm" onClick={handleStopRecording}>
                    Stop
                </Button>
            )}

            {recordings.length > 0 && (
                <List aria-label="Recordings" className="recorder-takes">
                    {recordings.map((recording, index) => (
                        <ListRow
                            key={recording.id}
                            actions={
                                <>
                                    {projectName && !recording.savedToProject && (
                                        <IconButton
                                            label={`Save take ${index + 1} to the project`}
                                            disabled={isSaving === recording.id}
                                            onClick={() => void handleSaveToProject(recording.id)}
                                            icon={<IconCheck size={14} />}
                                        />
                                    )}
                                    {recording.savedToProject && (
                                        <span className="recorder-saved" title="Saved to project">
                                            <IconCheck size={14} aria-hidden="true" />
                                        </span>
                                    )}
                                    <IconButton
                                        label={`Download take ${index + 1}`}
                                        onClick={() => handleDownload(recording.id)}
                                        icon={<IconDownload size={14} />}
                                    />
                                    <IconButton
                                        label={`Delete take ${index + 1}`}
                                        onClick={() => handleDelete(recording.id)}
                                        icon={<IconClose size={14} />}
                                    />
                                </>
                            }
                        >
                            <span className="recorder-take__name">Take {index + 1}</span>
                            <span className="recorder-take__length">{formatClock(recording.duration)}</span>
                        </ListRow>
                    ))}
                </List>
            )}

            {recordings.length === 0 && !isRecording && (
                <p className="recorder-hint">Wire an audio cable in, then press Record.</p>
            )}
        </div>
    );
});
