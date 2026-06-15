/**
 * RecordingWorklet - Main Thread Wrapper for AudioWorklet Recording
 *
 * Provides a high-level API for low-latency PCM recording using AudioWorklet.
 * Handles worklet loading, message passing, and buffer assembly.
 *
 * Usage:
 *   const recorder = new RecordingWorklet(audioContext);
 *   await recorder.initialize();
 *   const node = recorder.getNode();
 *   sourceNode.connect(node);
 *   recorder.start((buffer) => { ... });
 *   // Later...
 *   recorder.stop();
 */

export interface RecordingWorkletOptions {
    channels?: 1 | 2;
}

/**
 * Maximum buffer size in bytes before warning (100 MB)
 * At 48kHz mono, this is about 17 minutes of audio
 */
const MAX_BUFFER_BYTES_WARNING = 100 * 1024 * 1024;

/**
 * Maximum buffer size in bytes before forced flush (200 MB)
 * Prevents memory exhaustion that causes audio distortion
 */
const MAX_BUFFER_BYTES_LIMIT = 200 * 1024 * 1024;

export class RecordingWorklet {
    private context: AudioContext;
    private workletNode: AudioWorkletNode | null = null;
    private buffers: Float32Array[] = [];
    private totalBufferBytes: number = 0;
    private hasWarnedMemory: boolean = false;
    private onComplete: ((buffer: AudioBuffer) => void) | null = null;
    private isInitialized = false;
    private isRecording = false;
    private channels: 1 | 2 = 1;

    constructor(context: AudioContext) {
        this.context = context;
    }

    /**
     * Check if AudioWorklet is supported in this browser
     */
    static isSupported(): boolean {
        return typeof AudioWorkletNode !== 'undefined' &&
               typeof AudioContext !== 'undefined' &&
               'audioWorklet' in AudioContext.prototype;
    }

    /**
     * Initialize the worklet module (must be called before use)
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Load the worklet module
            // Vite handles the URL transformation for worklet modules
            await this.context.audioWorklet.addModule(
                new URL('./worklets/recording-processor.ts', import.meta.url)
            );
            this.isInitialized = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('[RecordingWorklet] Failed to load worklet module:', error);
            throw new Error(
                `AudioWorklet initialization failed: ${message}. ` +
                'Your browser may not support AudioWorklet, CSP may be blocking the module, ' +
                'or the worklet file may be missing.'
            );
        }
    }

    /**
     * Get the AudioWorkletNode for connecting to audio graph
     */
    getNode(): AudioWorkletNode {
        if (!this.isInitialized) {
            throw new Error('RecordingWorklet not initialized. Call initialize() first.');
        }

        if (!this.workletNode) {
            this.workletNode = new AudioWorkletNode(
                this.context,
                'recording-processor',
                {
                    numberOfInputs: 1,
                    numberOfOutputs: 0, // Recording only, no output
                    channelCount: this.channels,
                    channelCountMode: 'explicit'
                }
            );

            this.workletNode.port.onmessage = this.handleMessage.bind(this);
            this.workletNode.port.onmessageerror = (e) => {
                console.error('[RecordingWorklet] Message error:', e);
            };
        }

        return this.workletNode;
    }

    /**
     * Start recording
     * @param onComplete Callback when recording is complete (after stop())
     * @param options Recording options
     */
    start(onComplete: (buffer: AudioBuffer) => void, options?: RecordingWorkletOptions): void {
        if (!this.workletNode) {
            throw new Error('Worklet node not created. Call getNode() first.');
        }

        if (this.isRecording) {
            return;
        }

        this.buffers = [];
        this.totalBufferBytes = 0;
        this.hasWarnedMemory = false;
        this.onComplete = onComplete;
        this.channels = options?.channels || 1;
        this.isRecording = true;

        this.workletNode.port.postMessage({
            command: 'start',
            channels: this.channels
        });
    }

    /**
     * Stop recording and trigger callback with assembled AudioBuffer
     */
    stop(): void {
        if (!this.workletNode || !this.isRecording) {
            return;
        }

        this.isRecording = false;
        this.workletNode.port.postMessage({ command: 'stop' });
    }

    /**
     * Check if currently recording
     */
    get recording(): boolean {
        return this.isRecording;
    }

    /**
     * Handle messages from the worklet processor
     */
    private handleMessage(e: MessageEvent): void {
        const { type, data } = e.data;

        switch (type) {
            case 'buffer': {
                // Received a chunk of PCM data
                const buffer = data as Float32Array;
                const bufferBytes = buffer.byteLength;

                // MEMORY PROTECTION: Prevent unbounded buffer growth
                // This prevents audio distortion from memory exhaustion in long sessions
                if (this.totalBufferBytes + bufferBytes > MAX_BUFFER_BYTES_LIMIT) {
                    console.error('[RecordingWorklet] Buffer limit reached! Forcing flush to prevent audio distortion.');
                    // Force stop and process what we have
                    this.stop();
                    return;
                }

                // Memory warning (once per recording session)
                if (!this.hasWarnedMemory && this.totalBufferBytes > MAX_BUFFER_BYTES_WARNING) {
                    console.warn('[RecordingWorklet] Recording buffer exceeds 100MB. Consider stopping to prevent audio issues.');
                    this.hasWarnedMemory = true;
                }

                this.buffers.push(buffer);
                this.totalBufferBytes += bufferBytes;
                break;
            }

            case 'complete':
                // Recording finished, assemble the AudioBuffer
                this.assembleBuffer();
                break;
        }
    }

    /**
     * Assemble all received buffers into a single AudioBuffer
     */
    private assembleBuffer(): void {
        if (this.buffers.length === 0) {
            this.onComplete?.(this.context.createBuffer(1, 1, this.context.sampleRate));
            return;
        }

        // Calculate total length
        const totalLength = this.buffers.reduce((sum, b) => sum + b.length, 0);

        if (totalLength === 0) {
            this.onComplete?.(this.context.createBuffer(1, 1, this.context.sampleRate));
            return;
        }

        // Create AudioBuffer
        const audioBuffer = this.context.createBuffer(
            this.channels,
            totalLength,
            this.context.sampleRate
        );

        // Copy all buffers into the AudioBuffer
        const channelData = audioBuffer.getChannelData(0);
        let offset = 0;

        for (const buffer of this.buffers) {
            channelData.set(buffer, offset);
            offset += buffer.length;
        }

        // Clear buffers to free memory
        this.buffers = [];
        this.totalBufferBytes = 0;

        // Invoke callback
        if (this.onComplete) {
            this.onComplete(audioBuffer);
            this.onComplete = null;
        } else {
            console.error('[RecordingWorklet] onComplete is null - buffer will be lost');
        }
    }

    /**
     * Disconnect and cleanup
     */
    disconnect(): void {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ command: 'stop' });
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        this.buffers = [];
        this.totalBufferBytes = 0;
        this.onComplete = null;
        this.isRecording = false;
    }

    /**
     * Get current buffer memory usage in bytes
     * Useful for monitoring memory in long sessions
     */
    getBufferMemoryUsage(): number {
        return this.totalBufferBytes;
    }
}
