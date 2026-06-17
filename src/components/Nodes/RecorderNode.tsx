/**
 * Recorder Node - Record audio to WAV
 * Connected to the real Recorder audio class via the audio executor seam
 */

import { useState, useCallback, useEffect, memo } from 'react';
import { toast } from 'sonner';
import type { GraphNode } from '../../engine/types';
import { useAudioStore } from '../../store/audioStore';
import { useProjectStore } from '../../store/projectStore';
import { useLibraryStore } from '../../store/libraryStore';
import { getExecutor } from '../../audio/executor';
import { getAudioContext } from '../../audio/audioContext';
import type { Recording as AudioRecording } from '../../audio/executor';

interface RecorderNodeProps {
    node: GraphNode;
}

interface RecordingState {
    id: string;
    name: string;
    duration: number;
    timestamp: number;
    savedToProject?: boolean;
    libraryItemId?: string;  // Reference to saved library item
}

export const RecorderNode = memo(function RecorderNode({ node }: RecorderNodeProps) {
    const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
    const projectName = useProjectStore((s) => s.name);
    const getProjectHandle = useProjectStore((s) => s.getProjectHandle);
    const addAudioFile = useProjectStore((s) => s.addAudioFile);

    // Library store for saving recordings and trashing deleted items
    const saveAudioToLibrary = useLibraryStore((s) => s.saveAudioToLibrary);
    const trashItem = useLibraryStore((s) => s.trashItem);

    const [isRecording, setIsRecording] = useState(false);
    const [recordings, setRecordings] = useState<RecordingState[]>([]);
    const [recordingTime, setRecordingTime] = useState(0);
    const [isSaving, setIsSaving] = useState<string | null>(null);

    // Get the Recorder instance from the audio executor
    const getRecorder = useCallback(() => {
        return getExecutor().getRecorder(node.id);
    }, [node.id]);

    // Set up Recorder callbacks when component mounts or audio context becomes ready
    useEffect(() => {
        if (!isAudioContextReady) return;

        const recorder = getRecorder();
        if (!recorder) return;

        // Set up callbacks
        recorder.setOnRecordingComplete((recording: AudioRecording) => {
            const newRecording: RecordingState = {
                id: recording.id,
                name: recording.name,
                duration: recording.duration,
                timestamp: recording.timestamp
            };
            setRecordings(prev => [...prev, newRecording]);
            setIsRecording(false);
            setRecordingTime(0);
        });

        recorder.setOnTimeUpdate((time: number) => {
            setRecordingTime(time);
        });

        recorder.setOnRecordingDeleted((deletedRecording: AudioRecording) => {
            // Trash the library item if the recording was saved
            if (deletedRecording.libraryItemId) {
                trashItem(deletedRecording.libraryItemId);
            }
        });

        // Initial sync of recordings from recorder
        const existingRecordings = recorder.getRecordings();
        if (existingRecordings.length > 0) {
            setRecordings(existingRecordings.map(r => ({
                id: r.id,
                name: r.name,
                duration: r.duration,
                timestamp: r.timestamp
            })));
        }

        return () => {
            // Cleanup callbacks
            recorder.setOnRecordingComplete(() => {});
            recorder.setOnRecordingDeleted(() => {});
            recorder.setOnTimeUpdate(() => {});
        };
    }, [isAudioContextReady, node.id, getRecorder, trashItem]);

    // Start recording
    const handleStartRecording = useCallback(() => {
        const recorder = getRecorder();
        if (recorder) {
            recorder.startRecording();
            setIsRecording(true);
        }
    }, [getRecorder]);

    // Stop recording
    const handleStopRecording = useCallback(() => {
        const recorder = getRecorder();
        if (recorder) {
            recorder.stopRecording();
        }
        // isRecording will be set to false by the callback
    }, [getRecorder]);

    // Download recording
    const handleDownload = useCallback((recordingId: string) => {
        const recorder = getRecorder();
        if (recorder) {
            recorder.downloadRecording(recordingId);
        }
    }, [getRecorder]);

    // Delete recording
    const handleDelete = useCallback((recordingId: string) => {
        const recorder = getRecorder();
        if (recorder) {
            recorder.deleteRecording(recordingId);
        }
        setRecordings(prev => prev.filter(r => r.id !== recordingId));
    }, [getRecorder]);

    // Save recording to project folder and library
    const handleSaveToProject = useCallback(async (recordingId: string) => {
        if (!projectName) {
            toast.error('No project open. Create or open a project first.');
            return;
        }

        const recorder = getRecorder();
        if (!recorder) return;

        // Get the recording blob for library save
        const recordingBlob = recorder.getRecordingBlob(recordingId);
        if (!recordingBlob) {
            toast.error('Recording not found');
            return;
        }

        setIsSaving(recordingId);
        try {
            // First, convert the blob to an AudioBuffer for library storage
            const ctx = getAudioContext();
            if (!ctx) {
                toast.error('Audio context not available');
                return;
            }

            const arrayBuffer = await recordingBlob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            // Find the recording name for the library
            const recordingState = recordings.find(r => r.id === recordingId);
            const recordingName = recordingState?.name || 'Recording';

            // Save to library store (this creates a library item visible in the library browser)
            const libraryItemId = await saveAudioToLibrary(audioBuffer, recordingName, ['recording']);

            if (!libraryItemId) {
                toast.error('Failed to save recording to library');
                return;
            }

            // Store the libraryItemId on the Recording object for trash handling
            const allRecordings = recorder.getRecordings();
            const recording = allRecordings.find(r => r.id === recordingId);
            if (recording) {
                recording.libraryItemId = libraryItemId;
            }

            // Also save to project manifest (for compatibility with old system)
            const handle = await getProjectHandle();
            if (handle) {
                const result = await recorder.saveRecordingToProject(recordingId, handle);
                if (result) {
                    await addAudioFile(recordingId, result);
                }
            }

            // Mark as saved in local state with libraryItemId
            setRecordings(prev => prev.map(r =>
                r.id === recordingId ? { ...r, savedToProject: true, libraryItemId } : r
            ));
            toast.success('Recording saved to project');
        } catch (err) {
            console.error('Failed to save recording:', err);
            toast.error('Failed to save recording');
        } finally {
            setIsSaving(null);
        }
    }, [projectName, getRecorder, getProjectHandle, addAudioFile, saveAudioToLibrary, recordings]);

    // Format time
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="recorder-node">
            {/* Recording Status */}
            <div style={{
                textAlign: 'center',
                marginBottom: '8px',
                padding: '12px',
                background: isRecording ? 'var(--accent-danger)' : 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                transition: 'background 0.2s'
            }}>
                <div style={{
                    fontSize: '28px',
                    animation: isRecording ? 'pulse 1s infinite' : 'none'
                }}>
                    {isRecording ? '⏺' : '⏹'}
                </div>
                <div style={{
                    fontSize: '18px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    marginTop: '4px'
                }}>
                    {formatTime(recordingTime)}
                </div>
            </div>

            {/* Record Button */}
            <div className="node-controls">
                {!isRecording ? (
                    <button
                        className="node-btn node-btn-danger"
                        onClick={handleStartRecording}
                        disabled={!isAudioContextReady}
                        style={{ flex: 1 }}
                    >
                        ⏺ Start Recording
                    </button>
                ) : (
                    <button
                        className="node-btn node-btn-secondary"
                        onClick={handleStopRecording}
                        style={{ flex: 1 }}
                    >
                        ⏹ Stop Recording
                    </button>
                )}
            </div>

            {/* Recordings List */}
            {recordings.length > 0 && (
                <div className="loop-list" style={{ marginTop: '8px' }}>
                    {recordings.map((recording, index) => (
                        <div key={recording.id} className="loop-item">
                            <span>
                                Recording {index + 1} ({formatTime(recording.duration)})
                            </span>
                            <div className="loop-actions">
                                {projectName && !recording.savedToProject && (
                                    <button
                                        className="node-btn node-btn-success"
                                        onClick={() => handleSaveToProject(recording.id)}
                                        disabled={isSaving === recording.id}
                                        style={{ padding: '2px 6px', fontSize: '10px' }}
                                        title="Save to Project"
                                    >
                                        {isSaving === recording.id ? '...' : '📁'}
                                    </button>
                                )}
                                {recording.savedToProject && (
                                    <span
                                        style={{ padding: '2px 6px', fontSize: '10px', color: 'var(--accent-success)' }}
                                        title="Saved to project"
                                    >
                                        ✓
                                    </span>
                                )}
                                <button
                                    className="node-btn node-btn-primary"
                                    onClick={() => handleDownload(recording.id)}
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                    title="Download WAV"
                                >
                                    💾
                                </button>
                                <button
                                    className="node-btn node-btn-danger"
                                    onClick={() => handleDelete(recording.id)}
                                    style={{ padding: '2px 6px', fontSize: '10px' }}
                                    title="Delete"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {recordings.length === 0 && !isRecording && (
                <div style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    textAlign: 'center',
                    marginTop: '8px'
                }}>
                    Connect audio input and click Record
                </div>
            )}

            <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
        </div>
    );
});
