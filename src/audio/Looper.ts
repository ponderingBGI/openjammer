/**
 * Looper - Recording and playback of audio loops
 */

import { getAudioContext, getMasterGain } from './AudioEngine';
import { RecordingWorklet } from './RecordingWorklet';

/**
 * Sentinel value for infinite duration.
 * Using -1 as it's clearly invalid for duration and serializes properly to JSON.
 * (Number.POSITIVE_INFINITY serializes to null)
 */
export const INFINITE_DURATION = -1;

/** Type guard to check if duration represents infinite */
export function isInfiniteDuration(duration: number): boolean {
    return duration < 0;
}

export interface Loop {
    id: string;
    buffer: AudioBuffer | null;  // Can be nulled when loop is stopped to free memory
    startTime: number;
    isMuted: boolean;
    gainNode: GainNode | null;
    sourceNode: AudioBufferSourceNode | null;
    waveformData: number[];  // Amplitude values over time for visualization
    libraryItemId?: string;  // Reference to saved library item (if auto-saved)
    // Pause state tracking for global transport control
    isPaused: boolean;
    pausedAtOffset: number;  // Position in buffer when paused (seconds)
}

/**
 * Looper class for recording and playing back loops
 *
 * Works like a traditional loop pedal:
 * - Recording happens in fixed cycles based on duration
 * - After each cycle, the recording becomes a loop and starts playing
 * - Recording continues, layering new audio on top of previous loops
 * - User manually stops recording when done
 */
// Maximum number of loops to prevent memory exhaustion in long sessions
const MAX_LOOPS = 50;

export class Looper {
    private duration: number;
    private loops: Loop[] = [];
    private isRecording: boolean = false;
    private currentTime: number = 0;
    private cycleStartTime: number = 0;
    private outputNode: GainNode | null = null;

    // Recording
    private mediaRecorder: MediaRecorder | null = null;
    private recordedChunks: Blob[] = [];
    private inputStream: MediaStream | null = null;
    private inputNode: AudioNode | null = null;
    private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
    private analyser: AnalyserNode | null = null;

    // LOW LATENCY: AudioWorklet recording (replaces MediaRecorder when available)
    // Saves 50-100ms by avoiding WebM/Opus encoding
    private recordingWorklet: RecordingWorklet | null = null;
    private useWorklet: boolean = false;
    private workletInitialized: boolean = false;

    // LOW LATENCY OPTIMIZATION: Direct monitoring bypass
    // Separates monitoring (zero latency) from recording (can have latency)
    private inputHub: GainNode | null = null;

    // Silent source to keep audio graph active during silence
    // Without this, the worklet won't receive callbacks when no audio is playing
    private silentSource: ConstantSourceNode | null = null;

    // Cycle timer
    private cycleTimerId: number | null = null;
    private animationFrameId: number | null = null;

    // Waveform history (builds during recording) - uses circular buffer for O(1) inserts
    private waveformHistory: Float32Array;
    private waveformIndex: number = 0;
    private waveformLength: number = 0; // Actual number of samples (may be less than MAX during initial recording)
    private lastWaveformSampleTime: number = 0;
    private readonly WAVEFORM_SAMPLE_INTERVAL = 50; // ms between samples
    private readonly MAX_WAVEFORM_SAMPLES = 2000; // Cap waveform data to prevent memory issues

    // Reusable buffers for analyser data (avoids allocation in animation loop)
    private timeDomainBuffer: Uint8Array<ArrayBuffer> | null = null;
    private frequencyBuffer: Uint8Array<ArrayBuffer> | null = null;

    // Callbacks
    private onLoopAdded: ((loop: Loop) => void) | null = null;
    private onLoopDeleted: ((loop: Loop) => void) | null = null;
    private onTimeUpdate: ((time: number) => void) | null = null;
    private onWaveformUpdate: ((bars: number[]) => void) | null = null;
    private onWaveformHistoryUpdate: ((history: number[], playheadPosition: number) => void) | null = null;

    constructor(duration: number = 10) {
        this.duration = duration;
        this.waveformHistory = new Float32Array(this.MAX_WAVEFORM_SAMPLES);
        this.initOutput();
    }

    private initOutput(): void {
        const ctx = getAudioContext();
        const master = getMasterGain();
        if (!ctx || !master) return;

        this.outputNode = ctx.createGain();
        this.outputNode.gain.value = 1;
        this.outputNode.connect(master);
    }

    setDuration(duration: number): void {
        this.duration = duration;
    }

    getDuration(): number {
        return this.duration;
    }

    getCurrentTime(): number {
        return this.currentTime;
    }

    getLoops(): Loop[] {
        return this.loops;
    }

    /**
     * Add a loop from an external AudioBuffer (e.g., from dropped audio clip)
     * The buffer is used directly without re-recording.
     */
    addLoopFromBuffer(buffer: AudioBuffer): void {
        // Generate waveform data from buffer
        const channelData = buffer.getChannelData(0);
        const numSamples = Math.min(this.MAX_WAVEFORM_SAMPLES, 100);
        const segmentSize = Math.floor(channelData.length / numSamples);
        const waveformData: number[] = [];

        for (let i = 0; i < numSamples; i++) {
            const start = i * segmentSize;
            const end = Math.min(start + segmentSize, channelData.length);
            let maxAbs = 0;
            for (let j = start; j < end; j++) {
                const abs = Math.abs(channelData[j]);
                if (abs > maxAbs) maxAbs = abs;
            }
            waveformData.push(maxAbs);
        }

        const loop: Loop = {
            id: `loop-${Date.now()}`,
            buffer: buffer,
            startTime: 0,
            isMuted: false,
            gainNode: null,
            sourceNode: null,
            waveformData,
            isPaused: false,
            pausedAtOffset: 0
        };

        this.loops.push(loop);

        // Enforce max loops limit
        while (this.loops.length > MAX_LOOPS) {
            const oldestLoop = this.loops.shift();
            if (oldestLoop) {
                this.stopLoop(oldestLoop);
            }
        }

        this.onLoopAdded?.(loop);
        this.playLoop(loop);
    }

    getOutput(): GainNode | null {
        return this.outputNode;
    }

    setOnLoopAdded(callback: (loop: Loop) => void): void {
        this.onLoopAdded = callback;
    }

    setOnLoopDeleted(callback: (loop: Loop) => void): void {
        this.onLoopDeleted = callback;
    }

    setOnTimeUpdate(callback: (time: number) => void): void {
        this.onTimeUpdate = callback;
    }

    setOnWaveformUpdate(callback: (bars: number[]) => void): void {
        this.onWaveformUpdate = callback;
    }

    setOnWaveformHistoryUpdate(callback: (history: number[], playheadPosition: number) => void): void {
        this.onWaveformHistoryUpdate = callback;
    }

    /**
     * Extract waveform history from circular buffer as a regular array.
     * Returns samples in chronological order (oldest to newest).
     */
    private getWaveformHistoryArray(): number[] {
        if (this.waveformLength === 0) return [];

        const result: number[] = new Array(this.waveformLength);

        if (this.waveformLength < this.MAX_WAVEFORM_SAMPLES) {
            // Buffer hasn't wrapped yet - simple copy from start
            for (let i = 0; i < this.waveformLength; i++) {
                result[i] = this.waveformHistory[i];
            }
        } else {
            // Buffer has wrapped - need to reorder
            // waveformIndex points to the next write position (oldest data)
            for (let i = 0; i < this.waveformLength; i++) {
                const srcIndex = (this.waveformIndex + i) % this.MAX_WAVEFORM_SAMPLES;
                result[i] = this.waveformHistory[srcIndex];
            }
        }

        return result;
    }

    /**
     * Get the input node for connecting upstream audio.
     *
     * LOW LATENCY OPTIMIZATION:
     * Uses a hub pattern to separate monitoring from recording:
     * - inputHub → outputNode: DIRECT path (zero added latency for live monitoring)
     * - inputHub → analyser → mediaStreamDestination: Recording path (latency OK, user doesn't hear this)
     *
     * This reduces monitoring latency by ~50-100ms compared to routing through MediaRecorder.
     */
    getInputNode(): AudioNode | null {
        const ctx = getAudioContext();
        if (!ctx) return null;

        if (!this.inputHub) {
            // Create input hub - this is the entry point for all audio
            this.inputHub = ctx.createGain();
            this.inputHub.gain.value = 1;

            // CRITICAL: Create a silent constant source to keep the audio graph active
            // Without this, the AudioWorklet won't receive process() callbacks during silence,
            // causing gaps in the recording when no notes are being played.
            // The ConstantSourceNode outputs a DC offset of 0 (silence) continuously.
            this.silentSource = ctx.createConstantSource();
            this.silentSource.offset.value = 0; // Silent - no audible output
            this.silentSource.connect(this.inputHub);
            this.silentSource.start();

            // DIRECT MONITORING PATH (zero added latency)
            // Audio flows directly to output without going through analyser/recorder
            if (this.outputNode) {
                this.inputHub.connect(this.outputNode);
            }

            // RECORDING PATH (higher latency OK - user doesn't hear this)
            // Create analyser for silence detection and waveform visualization
            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 256;

            // Connect input hub to analyser (separate from monitoring path)
            this.inputHub.connect(this.analyser);

            // Create MediaStreamDestination for recording from AudioNode
            this.mediaStreamDestination = ctx.createMediaStreamDestination();

            // Connect analyser to destination for recording
            this.analyser.connect(this.mediaStreamDestination);

            // Store the stream for MediaRecorder
            this.inputStream = this.mediaStreamDestination.stream;
        }

        // Return input hub as the connection point
        return this.inputHub;
    }

    /**
     * Connect an audio source to the looper input
     *
     * LOW LATENCY OPTIMIZATION:
     * Uses the same hub pattern as getInputNode() for direct monitoring.
     */
    async connectInput(source: AudioNode | MediaStream): Promise<void> {
        const ctx = getAudioContext();
        if (!ctx) return;

        // Ensure input hub and routing is set up
        if (!this.inputHub) {
            this.inputHub = ctx.createGain();
            this.inputHub.gain.value = 1;

            // DIRECT MONITORING PATH (zero added latency)
            if (this.outputNode) {
                this.inputHub.connect(this.outputNode);
            }

            // RECORDING PATH
            this.analyser = ctx.createAnalyser();
            this.analyser.fftSize = 256;
            this.inputHub.connect(this.analyser);

            this.mediaStreamDestination = ctx.createMediaStreamDestination();
            this.analyser.connect(this.mediaStreamDestination);
            this.inputStream = this.mediaStreamDestination.stream;
        }

        if (source instanceof MediaStream) {
            this.inputStream = source;
            const sourceNode = ctx.createMediaStreamSource(source);
            sourceNode.connect(this.inputHub);
        } else {
            // For AudioNode input, connect to hub
            this.inputNode = source;
            source.connect(this.inputHub);
        }
    }

    /**
     * Start recording - immediately begins recording in cycles
     * After each cycle (duration), the recording becomes a loop and plays
     * Recording continues until manually stopped
     */
    async startRecording(): Promise<void> {
        if (this.isRecording) return;

        const ctx = getAudioContext();
        if (!ctx || !this.inputStream) return;

        // Initialize AudioWorklet if available and not already done
        if (!this.workletInitialized && RecordingWorklet.isSupported()) {
            try {
                this.recordingWorklet = new RecordingWorklet(ctx);
                await this.recordingWorklet.initialize();
                this.useWorklet = true;
                this.workletInitialized = true;

                // Connect the worklet node to our recording path
                // inputHub → worklet (for recording)
                if (this.inputHub) {
                    const workletNode = this.recordingWorklet.getNode();
                    this.inputHub.connect(workletNode);
                }
            } catch (err) {
                console.warn('[Looper] AudioWorklet init failed, falling back to MediaRecorder:', err);
                this.useWorklet = false;
                this.workletInitialized = true; // Don't try again
            }
        }

        this.isRecording = true;
        this.cycleStartTime = ctx.currentTime;

        // Start the first recording cycle
        this.startRecordingCycle();

        // Start progress animation
        this.updateProgress();
    }

    /**
     * Start a single recording cycle
     */
    private startRecordingCycle(): void {
        if (!this.isRecording) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        // Reset circular buffer for new cycle (just reset indices, no allocation needed)
        this.waveformIndex = 0;
        this.waveformLength = 0;
        this.lastWaveformSampleTime = 0;
        this.cycleStartTime = ctx.currentTime;

        // Use AudioWorklet for low-latency recording when available
        if (this.useWorklet && this.recordingWorklet) {
            // Start worklet recording - it will call our callback when stopped
            this.recordingWorklet.start((audioBuffer) => {
                this.processWorkletRecording(audioBuffer);
            });
        } else if (this.inputStream) {
            // Fallback: Use MediaRecorder (higher latency due to encoding)
            this.startMediaRecorderCycle();
        }

        // Schedule end of cycle (for non-infinite duration)
        if (!isInfiniteDuration(this.duration)) {
            this.cycleTimerId = window.setTimeout(() => {
                this.endRecordingCycle();
            }, this.duration * 1000);
        }
    }

    /**
     * Start MediaRecorder-based recording (fallback when AudioWorklet not available)
     */
    private startMediaRecorderCycle(): void {
        if (!this.inputStream) return;

        // Stop any existing MediaRecorder before creating a new one
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            try {
                this.mediaRecorder.stop();
            } catch {
                // Already stopped or in error state
            }
        }

        this.recordedChunks = [];

        // Create new MediaRecorder for this cycle
        try {
            this.mediaRecorder = new MediaRecorder(this.inputStream, {
                mimeType: 'audio/webm;codecs=opus'
            });
        } catch {
            // Fallback for browsers that don't support opus
            this.mediaRecorder = new MediaRecorder(this.inputStream);
        }

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this.recordedChunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => this.processRecordingCycle();

        this.mediaRecorder.onerror = (event) => {
            const error = (event as Event & { error?: DOMException }).error;
            console.error('[Looper] MediaRecorder error:', error?.name, error?.message || event);

            this.isRecording = false;
            if (this.cycleTimerId !== null) {
                clearTimeout(this.cycleTimerId);
                this.cycleTimerId = null;
            }
            if (this.animationFrameId !== null) {
                cancelAnimationFrame(this.animationFrameId);
                this.animationFrameId = null;
            }
        };

        // Start recording immediately
        this.mediaRecorder.start();
    }

    /**
     * End current recording cycle and start next one
     */
    private endRecordingCycle(): void {
        if (!this.isRecording) return;

        // Stop current recording method (triggers callback -> process -> next cycle)
        if (this.useWorklet && this.recordingWorklet) {
            // Stop worklet recording - this triggers the callback with AudioBuffer
            this.recordingWorklet.stop();
        } else if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            // Stop MediaRecorder (triggers onstop -> processRecordingCycle)
            try {
                this.mediaRecorder.stop();
            } catch (err) {
                if (import.meta.env.DEV) {
                    console.warn('MediaRecorder stop failed in endRecordingCycle:', err);
                }
            }
        }
    }

    /**
     * Process the recorded cycle into a loop, then start next cycle
     */
    private async processRecordingCycle(): Promise<void> {
        if (this.recordedChunks.length === 0) {
            // No audio recorded, but continue if still recording
            if (this.isRecording) {
                this.startRecordingCycle();
            }
            return;
        }

        const ctx = getAudioContext();
        if (!ctx) return;

        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();

        try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            const loop: Loop = {
                id: `loop-${Date.now()}`,
                buffer: audioBuffer,
                startTime: 0,
                isMuted: false,
                gainNode: null,
                sourceNode: null,
                waveformData: this.getWaveformHistoryArray(),  // Store waveform shape
                isPaused: false,
                pausedAtOffset: 0
            };

            this.loops.push(loop);

            // Enforce max loops limit - remove oldest loops when limit exceeded
            while (this.loops.length > MAX_LOOPS) {
                const oldestLoop = this.loops.shift();
                if (oldestLoop) {
                    this.stopLoop(oldestLoop);
                }
            }

            this.onLoopAdded?.(loop);

            // Auto-start playing the loop
            this.playLoop(loop);
        } catch (err) {
            console.error('Failed to decode recorded audio:', err);
        }

        // Start next cycle if still recording
        if (this.isRecording) {
            this.startRecordingCycle();
        }
    }

    /**
     * Process AudioWorklet recording directly into a loop.
     * LOW LATENCY: No decoding step needed - AudioBuffer comes directly from worklet.
     * Saves ~50-100ms compared to MediaRecorder path.
     */
    private processWorkletRecording(audioBuffer: AudioBuffer): void {
        // Check if we got valid audio
        if (!audioBuffer || audioBuffer.length === 0) {
            // No audio recorded, but continue if still recording
            if (this.isRecording) {
                this.startRecordingCycle();
            }
            return;
        }

        const loop: Loop = {
            id: `loop-${Date.now()}`,
            buffer: audioBuffer,
            startTime: 0,
            isMuted: false,
            gainNode: null,
            sourceNode: null,
            waveformData: this.getWaveformHistoryArray(),
            isPaused: false,
            pausedAtOffset: 0
        };

        this.loops.push(loop);

        // Enforce max loops limit
        while (this.loops.length > MAX_LOOPS) {
            const oldestLoop = this.loops.shift();
            if (oldestLoop) {
                this.stopLoop(oldestLoop);
            }
        }

        this.onLoopAdded?.(loop);

        // Auto-start playing the loop
        this.playLoop(loop);

        // Start next cycle if still recording
        if (this.isRecording) {
            this.startRecordingCycle();
        }
    }

    /**
     * Update progress bar animation and waveform data
     */
    private updateProgress(): void {
        if (!this.isRecording && this.loops.length === 0) {
            return;
        }

        const ctx = getAudioContext();
        if (!ctx) return;

        const now = performance.now();

        if (!isInfiniteDuration(this.duration)) {
            this.currentTime = (ctx.currentTime - this.cycleStartTime) % this.duration;
        } else {
            this.currentTime = 0;
        }
        this.onTimeUpdate?.(this.currentTime);

        // Sample amplitude for waveform history during recording
        if (this.isRecording && this.analyser) {
            // Sample at fixed intervals
            if (now - this.lastWaveformSampleTime >= this.WAVEFORM_SAMPLE_INTERVAL) {
                // Reuse buffer to avoid allocation in hot path
                const binCount = this.analyser.frequencyBinCount;
                if (!this.timeDomainBuffer || this.timeDomainBuffer.length !== binCount) {
                    this.timeDomainBuffer = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
                }
                this.analyser.getByteTimeDomainData(this.timeDomainBuffer);
                const dataArray = this.timeDomainBuffer;

                // Calculate peak amplitude
                let peak = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const amplitude = Math.abs(dataArray[i] - 128) / 128;
                    if (amplitude > peak) peak = amplitude;
                }

                // Add to circular buffer - O(1) operation instead of O(n) shift
                this.waveformHistory[this.waveformIndex] = peak;
                this.waveformIndex = (this.waveformIndex + 1) % this.MAX_WAVEFORM_SAMPLES;
                if (this.waveformLength < this.MAX_WAVEFORM_SAMPLES) {
                    this.waveformLength++;
                }
                this.lastWaveformSampleTime = now;
            }

            // Skip UI updates when document is hidden (performance optimization)
            if (!document.hidden) {
                // Calculate playhead position (0-100)
                const playheadPosition = !isInfiniteDuration(this.duration)
                    ? (this.currentTime / this.duration) * 100
                    : 0;

                // Send waveform history update (extract ordered array from circular buffer)
                this.onWaveformHistoryUpdate?.(this.getWaveformHistoryArray(), playheadPosition);
            }
        }

        // Extract real-time waveform data from analyser (for live display)
        // Skip when document is hidden (performance optimization)
        if (this.analyser && this.onWaveformUpdate && !document.hidden) {
            // Reuse buffer to avoid allocation in hot path
            const binCount = this.analyser.frequencyBinCount;
            if (!this.frequencyBuffer || this.frequencyBuffer.length !== binCount) {
                this.frequencyBuffer = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
            }
            this.analyser.getByteFrequencyData(this.frequencyBuffer);
            const dataArray = this.frequencyBuffer;

            const NUM_BARS = 32;
            const bars: number[] = [];
            const step = Math.floor(dataArray.length / NUM_BARS);
            for (let i = 0; i < NUM_BARS; i++) {
                bars.push(dataArray[i * step] / 255);
            }
            this.onWaveformUpdate(bars);
        }

        this.animationFrameId = requestAnimationFrame(() => this.updateProgress());
    }

    /**
     * Stop recording manually
     */
    stopRecording(): void {
        if (!this.isRecording) return;

        this.isRecording = false;

        // Clear cycle timer
        if (this.cycleTimerId !== null) {
            clearTimeout(this.cycleTimerId);
            this.cycleTimerId = null;
        }

        // Stop animation
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Stop current recording method
        if (this.useWorklet && this.recordingWorklet) {
            // Stop worklet recording
            this.recordingWorklet.stop();
        } else if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            // Stop MediaRecorder
            try {
                this.mediaRecorder.stop();
            } catch (err) {
                if (import.meta.env.DEV) {
                    console.warn('MediaRecorder stop failed in stopRecording:', err);
                }
            }
        }
    }

    /**
     * Play a specific loop
     */
    playLoop(loop: Loop): void {
        if (loop.isMuted || loop.sourceNode) return;

        const ctx = getAudioContext();
        if (!ctx || !this.outputNode) return;

        // Create gain for this loop
        loop.gainNode = ctx.createGain();
        loop.gainNode.gain.value = loop.isMuted ? 0 : 1;
        loop.gainNode.connect(this.outputNode);

        // Create and start buffer source
        loop.sourceNode = ctx.createBufferSource();
        loop.sourceNode.buffer = loop.buffer;
        loop.sourceNode.loop = true;
        loop.sourceNode.connect(loop.gainNode);
        loop.sourceNode.start();
    }

    /**
     * Stop a specific loop
     */
    stopLoop(loop: Loop): void {
        if (loop.sourceNode) {
            loop.sourceNode.stop();
            loop.sourceNode.disconnect();
            loop.sourceNode = null;
        }
        if (loop.gainNode) {
            loop.gainNode.disconnect();
            loop.gainNode = null;
        }
        // Release buffer to allow garbage collection
        loop.buffer = null;
    }

    /**
     * Toggle mute for a loop
     */
    toggleLoopMute(loopId: string): void {
        const loop = this.loops.find(l => l.id === loopId);
        if (!loop) return;

        loop.isMuted = !loop.isMuted;

        if (loop.gainNode) {
            loop.gainNode.gain.value = loop.isMuted ? 0 : 1;
        }
    }

    /**
     * Delete a loop
     */
    deleteLoop(loopId: string): void {
        const index = this.loops.findIndex(l => l.id === loopId);
        if (index === -1) return;

        const loop = this.loops[index];
        this.stopLoop(loop);
        this.loops.splice(index, 1);

        // Notify for trash handling (if loop was saved to library)
        this.onLoopDeleted?.(loop);
    }

    /**
     * Play all loops
     */
    playAll(): void {
        this.loops.forEach(loop => {
            if (!loop.sourceNode) {
                this.playLoop(loop);
            }
        });
    }

    /**
     * Stop all loops
     */
    stopAll(): void {
        this.loops.forEach(loop => this.stopLoop(loop));
    }

    /**
     * Pause a specific loop, storing its current playback position.
     * Unlike stopLoop, this preserves the buffer so it can be resumed.
     */
    pauseLoop(loop: Loop): void {
        if (!loop.sourceNode || loop.isPaused || !loop.buffer) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        // Calculate current offset within the buffer
        // Time since loop started, modulo buffer duration for looping
        const elapsed = ctx.currentTime - loop.startTime;
        const bufferDuration = loop.buffer.duration;
        const offset = elapsed % bufferDuration;

        // Stop the source node (cannot pause AudioBufferSourceNode)
        loop.sourceNode.stop();
        loop.sourceNode.disconnect();
        loop.sourceNode = null;

        // Store pause state (keep gainNode connected for seamless resume)
        loop.isPaused = true;
        loop.pausedAtOffset = offset;
    }

    /**
     * Resume a paused loop from its stored position
     */
    resumeLoop(loop: Loop): void {
        if (!loop.isPaused || loop.isMuted || !loop.buffer) return;

        const ctx = getAudioContext();
        if (!ctx || !this.outputNode) return;

        // Ensure gain node exists
        if (!loop.gainNode) {
            loop.gainNode = ctx.createGain();
            loop.gainNode.gain.value = loop.isMuted ? 0 : 1;
            loop.gainNode.connect(this.outputNode);
        }

        // Create new source node
        loop.sourceNode = ctx.createBufferSource();
        loop.sourceNode.buffer = loop.buffer;
        loop.sourceNode.loop = true;
        loop.sourceNode.connect(loop.gainNode);

        // Start from the stored offset
        loop.sourceNode.start(0, loop.pausedAtOffset);
        loop.startTime = ctx.currentTime - loop.pausedAtOffset;

        // Clear pause state
        loop.isPaused = false;
        loop.pausedAtOffset = 0;
    }

    /**
     * Pause all loops, storing their positions
     */
    pauseAll(): void {
        this.loops.forEach(loop => this.pauseLoop(loop));
    }

    /**
     * Resume all paused loops from their stored positions
     */
    resumeAll(): void {
        this.loops.forEach(loop => this.resumeLoop(loop));
    }

    /**
     * Disconnect and cleanup
     */
    disconnect(): void {
        this.stopAll();
        this.stopRecording();

        // Clear timers
        if (this.cycleTimerId !== null) {
            clearTimeout(this.cycleTimerId);
            this.cycleTimerId = null;
        }

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Cleanup AudioWorklet
        if (this.recordingWorklet) {
            this.recordingWorklet.disconnect();
            this.recordingWorklet = null;
        }

        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }

        if (this.mediaStreamDestination) {
            this.mediaStreamDestination.disconnect();
            this.mediaStreamDestination = null;
        }

        // Stop and cleanup silent source (keeps audio graph active during recording)
        if (this.silentSource) {
            try {
                this.silentSource.stop();
                this.silentSource.disconnect();
            } catch {
                // May already be stopped
            }
            this.silentSource = null;
        }

        if (this.inputHub) {
            this.inputHub.disconnect();
            this.inputHub = null;
        }

        if (this.inputNode) {
            this.inputNode = null;
        }

        if (this.inputStream) {
            // Stop all tracks in the stream
            this.inputStream.getTracks().forEach(track => track.stop());
            this.inputStream = null;
        }

        if (this.outputNode) {
            this.outputNode.disconnect();
            this.outputNode = null;
        }
    }
}
