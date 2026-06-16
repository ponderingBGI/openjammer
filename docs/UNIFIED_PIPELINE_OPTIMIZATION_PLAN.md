# Unified Pipeline Optimization Plan for OpenJammer

**Status**: Implementation Strategy
**Date**: 2026-01-17
**Goal**: Zero-latency compiled pipelines with full dynamic input support for live performance

---

## Executive Summary

This plan unifies GPU acceleration and pipeline pre-rendering into a **compiled pipeline architecture** that:

1. **Compiles static effect chains** into optimized programs (zero DSP overhead at runtime)
2. **Supports dynamic inputs** (microphone → looper → effects → speaker) in live performance
3. **Enables parallel execution** through pipeline segmentation
4. **Uses GPU acceleration** for visualization and offline batch processing
5. **Maintains sub-20ms latency** for all live audio paths

**Key Innovation**: Instead of pre-rendering static buffers, we **compile the processing graph** into an optimized execution plan that can handle both static AND dynamic sources with minimal overhead.

---

## Part 1: The Compilation Model

### 1.1 Why Compilation > Pre-Rendering for Live Performance

The original pre-rendering strategy has a critical flaw for live performance:

**Pre-rendering assumes static sources:**
```
Static Looper → Effect A → Effect B → Speaker
         └─ Pre-render entire chain into buffer
```

**But live performance needs dynamic sources:**
```
Microphone (LIVE) → Looper (recording) → Effect A → Effect B → Speaker
                           ↑
                    Can't pre-render - source is live!
```

**Solution: Compile the OPERATIONS, not the audio:**
```
Instead of: buffer = render(source, effectA, effectB)
Do this:    program = compile(effectA, effectB)
            output = program.execute(ANY_input)  // Works with live OR static
```

### 1.2 The Compiled Pipeline Concept

**Current Architecture (Interpreted):**
```
For each audio sample block:
  1. Route sample through GainNode A
  2. Route sample through BiquadFilter B
  3. Route sample through ConvolverNode C
  4. Route sample through GainNode D

Cost: 4 separate node traversals, 4 memory copies, 4 scheduling decisions
```

**Compiled Architecture:**
```
Compile once:
  program = {
    gainA: 0.5,
    filterB: {type: 'lowpass', freq: 1000, Q: 1},
    convolverC: impulseBuffer,
    gainD: 0.8
  }

Execute per block:
  output = AudioWorklet.process(input, program)

Cost: 1 worklet invocation, 1 memory copy, operations fused in WASM/native code
```

### 1.3 Your Example Explained

> "a node that cuts the volume by 50% and then one right after that adds 50% should be calculated end so add 0 latency"

**Current (Naive):**
```
sample → GainNode(0.5) → GainNode(1.5) → output
         ↓ 3ms latency    ↓ 3ms latency
Total: 6ms + potential phase issues
```

**Compiled:**
```
compile([Gain(0.5), Gain(1.5)]) → fusedGain = 0.5 * 1.5 = 0.75

sample → FusedGainWorklet(0.75) → output
         ↓ ~0ms added latency (single multiply)
```

**Even More Complex Example:**
```
sample → Gain(0.5) → LowPass(1kHz) → Gain(2.0) → HighPass(200Hz) → output

Compiled into single AudioWorklet:
  fusedProgram = {
    preGain: 0.5 * 2.0 = 1.0,  // Gains fused
    filters: BiQuadCascade([lowpass@1kHz, highpass@200Hz])  // Filters fused
  }
```

---

## Part 2: Pipeline Segmentation for Dynamic Inputs

### 2.1 The Segment Model

A **segment** is a contiguous chain of nodes that can be compiled together.

**Segment Boundaries** occur at:
1. **Dynamic sources** (microphone, live MIDI)
2. **Branch points** (one node feeds multiple destinations)
3. **Merge points** (multiple sources feed one node)
4. **State-changing nodes** (looper in record mode)

**Example Graph:**
```
Microphone ──┐                          ┌── Speaker A
             ↓                          │
         Looper ─→ Effect A ─→ Add ──→ Amplifier ─→ Speaker B
             ↑                 ↑
Library ─────┘      Effect B ──┘
```

**Segmentation:**
```
Segment 1: [Microphone] (DYNAMIC - cannot compile, always live)
Segment 2: [Looper] (STATEFUL - compiles when playing, live when recording)
Segment 3: [Library → Effect B] (STATIC - fully compilable)
Segment 4: [Effect A] (STATIC - compilable)
Segment 5: [Add → Amplifier] (MERGE - can compile post-merge operations)
Segment 6: [Speaker A], [Speaker B] (OUTPUT - terminal nodes)
```

### 2.2 Segment Types

| Type | Characteristics | Compilation Strategy |
|------|-----------------|---------------------|
| **DYNAMIC** | Live input (mic, MIDI) | No compilation, direct passthrough |
| **STATEFUL** | Mode-dependent (looper) | Compile playback path, bypass record path |
| **STATIC** | Fixed source + effects | Fully compile into single worklet |
| **MERGE** | Multiple inputs | Compile post-merge, inputs remain separate |
| **OUTPUT** | Terminal (speaker) | Compile final gain/routing |

### 2.3 The Looper Special Case

The looper is critical for live performance and needs special handling:

**Recording Mode:**
```
Microphone ─→ [LOOPER: RECORDING] ─→ Speaker
                    ↑
              Write to buffer (NO compilation possible)
              Latency: Input device + minimal processing
```

**Playback Mode:**
```
[LOOPER: PLAYING] ─→ Effect A ─→ Effect B ─→ Speaker
        ↑
  Read from buffer

Compiled into:
  CompiledSegment {
    source: looper.buffer,
    program: fuse(effectA, effectB),
    output: speaker
  }
```

**Overdub Mode (Recording + Playback):**
```
Microphone ─→ [LOOPER: OVERDUB] ─→ Effect A ─→ Speaker
                    │
              ┌─────┴─────┐
              │ Playback  │ ← Compiled path
              │ + Live    │ ← Dynamic path (mixed)
              └───────────┘
```

**Implementation:**
```typescript
interface LooperSegmentStrategy {
  mode: 'record' | 'play' | 'overdub';

  // Record: pass through dynamically
  recordPath: DynamicSegment | null;

  // Play: compiled buffer playback
  playbackPath: CompiledSegment | null;

  // Downstream effects (always compile these)
  effectsPath: CompiledSegment;
}
```

---

## Part 3: The Compilation Engine

### 3.1 Compilable Operations

| Operation | Compilation Strategy | Fusion Potential |
|-----------|---------------------|------------------|
| **Gain** | Multiply constants | Full (chain of gains → single multiply) |
| **BiquadFilter** | Cascade coefficients | Full (multiple filters → single biquad cascade) |
| **Convolution** | Pre-compute IR | Partial (IR can be pre-convolved for static chains) |
| **Delay** | Circular buffer | None (stateful, time-based) |
| **Distortion** | Waveshaper LUT | Full (generate lookup table once) |
| **Add/Subtract** | Sum/diff buffers | Full (multiple adds → single vector op) |

### 3.2 The CompiledProgram Structure

```typescript
interface CompiledProgram {
  id: string;
  version: number;  // Increments on recompilation

  // Fused operations in execution order
  operations: CompiledOperation[];

  // Pre-computed data
  lookupTables: Map<string, Float32Array>;  // Waveshaper curves
  impulseResponses: Map<string, AudioBuffer>;  // Convolution IRs
  filterCoefficients: Float64Array;  // Biquad cascade

  // Metadata for dirty tracking
  nodeVersions: Map<nodeId, number>;  // Which node versions were compiled

  // Execution hints
  canRunParallel: boolean;  // No dependencies between channels
  estimatedCost: number;    // CPU cycles estimate
}

interface CompiledOperation {
  type: 'gain' | 'biquad_cascade' | 'waveshaper' | 'convolution' | 'delay' | 'passthrough';
  params: OperationParams;
}
```

### 3.3 Compilation Algorithm

```typescript
function compileSegment(nodes: GraphNode[], connections: Connection[]): CompiledProgram {
  const operations: CompiledOperation[] = [];
  let pendingGains: number[] = [];
  let pendingFilters: BiquadParams[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'amplifier':
        // Accumulate gains for later fusion
        pendingGains.push(node.data.gain);
        break;

      case 'effect':
        if (node.data.effectType === 'distortion') {
          // Flush pending gains into distortion input
          if (pendingGains.length > 0) {
            const fusedGain = pendingGains.reduce((a, b) => a * b, 1);
            operations.push({ type: 'gain', params: { value: fusedGain } });
            pendingGains = [];
          }
          // Add waveshaper
          operations.push({
            type: 'waveshaper',
            params: { curve: generateDistortionCurve(node.data.amount) }
          });
        } else if (node.data.effectType === 'filter') {
          // Accumulate filters for cascade
          pendingFilters.push(node.data.filterParams);
        } else if (node.data.effectType === 'reverb') {
          // Flush everything before convolution (can't fuse through convolution)
          flushPending();
          operations.push({
            type: 'convolution',
            params: { impulseResponse: node.data.ir }
          });
        } else if (node.data.effectType === 'delay') {
          // Delay is stateful, can't fuse
          flushPending();
          operations.push({
            type: 'delay',
            params: { time: node.data.delayTime, feedback: node.data.feedback }
          });
        }
        break;

      case 'add':
      case 'subtract':
        // These mark merge points - handled at segment level
        break;
    }
  }

  // Flush remaining pending operations
  flushPending();

  return {
    id: generateProgramId(),
    version: 1,
    operations,
    // ... other fields
  };

  function flushPending() {
    if (pendingGains.length > 0) {
      const fusedGain = pendingGains.reduce((a, b) => a * b, 1);
      if (Math.abs(fusedGain - 1.0) > 0.0001) {  // Skip identity gains
        operations.push({ type: 'gain', params: { value: fusedGain } });
      }
      pendingGains = [];
    }
    if (pendingFilters.length > 0) {
      operations.push({
        type: 'biquad_cascade',
        params: { filters: fuseFilters(pendingFilters) }
      });
      pendingFilters = [];
    }
  }
}
```

### 3.4 The Execution Worklet

```typescript
// CompiledPipelineWorklet.ts
class CompiledPipelineProcessor extends AudioWorkletProcessor {
  private program: CompiledProgram | null = null;
  private delayBuffers: Map<string, Float32Array> = new Map();
  private filterStates: Float64Array[] = [];

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.program) {
      // Passthrough if no program
      outputs[0][0].set(inputs[0][0]);
      return true;
    }

    let buffer = inputs[0][0];

    for (const op of this.program.operations) {
      switch (op.type) {
        case 'gain':
          // SIMD-friendly: single multiply per sample
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] *= op.params.value;
          }
          break;

        case 'biquad_cascade':
          buffer = this.processBiquadCascade(buffer, op.params);
          break;

        case 'waveshaper':
          buffer = this.processWaveshaper(buffer, op.params.curve);
          break;

        case 'convolution':
          buffer = this.processConvolution(buffer, op.params);
          break;

        case 'delay':
          buffer = this.processDelay(buffer, op.params);
          break;
      }
    }

    outputs[0][0].set(buffer);
    return true;
  }

  // Efficient biquad cascade using direct form II
  private processBiquadCascade(input: Float32Array, params: BiquadCascadeParams): Float32Array {
    // Process all filters in series, maintaining state
    let buffer = input;
    for (let f = 0; f < params.filters.length; f++) {
      const coeffs = params.filters[f];
      const state = this.filterStates[f];

      for (let i = 0; i < buffer.length; i++) {
        const x = buffer[i];
        const y = coeffs.b0 * x + state[0];
        state[0] = coeffs.b1 * x - coeffs.a1 * y + state[1];
        state[1] = coeffs.b2 * x - coeffs.a2 * y;
        buffer[i] = y;
      }
    }
    return buffer;
  }
}
```

---

## Part 4: Dirty Tracking and Incremental Recompilation

### 4.1 What Triggers Recompilation

| Change Type | Recompilation Scope | Strategy |
|-------------|-------------------|----------|
| **Effect parameter** (gain, filter freq) | Single segment | Update program coefficients only |
| **Add/remove node** | Affected segment | Full segment recompile |
| **Add/remove connection** | All connected segments | Re-segment and recompile |
| **Looper mode change** | Looper segment | Switch between compiled/dynamic |

### 4.2 Version-Based Dirty Tracking

```typescript
interface SegmentState {
  segmentId: string;
  compiledProgram: CompiledProgram | null;

  // Track what's compiled
  nodeVersions: Map<string, number>;  // nodeId → version when compiled

  // Check if recompilation needed
  isDirty(): boolean {
    for (const [nodeId, compiledVersion] of this.nodeVersions) {
      const currentVersion = graphStore.getNodeVersion(nodeId);
      if (currentVersion > compiledVersion) {
        return true;
      }
    }
    return false;
  }
}

// In graphStore, increment version on ANY change:
function updateNodeData(nodeId: string, data: Partial<NodeData>) {
  const node = nodes.get(nodeId);
  node.data = { ...node.data, ...data };
  node.version++;  // Triggers dirty check
}
```

### 4.3 Incremental Parameter Updates

For simple parameter changes, avoid full recompilation:

```typescript
function updateSegmentParameter(segmentId: string, nodeId: string, param: string, value: any) {
  const segment = segments.get(segmentId);
  const program = segment.compiledProgram;

  if (!program) return;

  // Find the operation for this node
  const opIndex = program.nodeToOperationMap.get(nodeId);
  if (opIndex === undefined) return;

  const op = program.operations[opIndex];

  // Hot-patch the parameter
  switch (op.type) {
    case 'gain':
      op.params.value = value;
      break;
    case 'biquad_cascade':
      // Recalculate coefficients for this filter
      recalculateFilterCoefficients(op, param, value);
      break;
    case 'delay':
      op.params[param] = value;
      break;
  }

  // Send updated program to worklet
  workletNode.port.postMessage({
    type: 'UPDATE_PROGRAM',
    program: program
  });
}
```

---

## Part 5: Parallel Execution

### 5.1 Identifying Parallel Opportunities

**Independent Pipelines** can run in parallel:

```
         ┌── Segment A (Mic → Effects → Speaker 1)
Graph ───┤
         └── Segment B (Looper → Effects → Speaker 2)

A and B have no connections = CAN RUN IN PARALLEL
```

**Merge Points** require synchronization:

```
Segment A (Looper 1) ──┐
                       ├── Add ─→ Segment C (Effects → Speaker)
Segment B (Looper 2) ──┘

A and B run in parallel, C waits for both
```

### 5.2 Execution Scheduler

```typescript
interface ExecutionPlan {
  // Segments grouped by execution wave
  waves: SegmentId[][];

  // Wave 0: All independent segments (run in parallel)
  // Wave 1: Segments that depend on Wave 0
  // Wave 2: Segments that depend on Wave 1
  // ...
}

function buildExecutionPlan(segments: Segment[], connections: Connection[]): ExecutionPlan {
  const dependencies = buildDependencyGraph(segments, connections);
  const waves: SegmentId[][] = [];
  const scheduled = new Set<string>();

  while (scheduled.size < segments.length) {
    const wave: SegmentId[] = [];

    for (const segment of segments) {
      if (scheduled.has(segment.id)) continue;

      // Check if all dependencies are scheduled
      const deps = dependencies.get(segment.id) || [];
      if (deps.every(d => scheduled.has(d))) {
        wave.push(segment.id);
      }
    }

    for (const id of wave) {
      scheduled.add(id);
    }

    waves.push(wave);
  }

  return { waves };
}
```

### 5.3 Web Worker Parallelism

Since Web Audio runs in audio thread, we use **Web Workers for compilation** and **SharedArrayBuffer for data sharing**:

```typescript
// Main thread
class ParallelExecutor {
  private workers: Worker[] = [];
  private sharedBuffers: SharedArrayBuffer[] = [];

  constructor(numWorkers: number = navigator.hardwareConcurrency || 4) {
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker('segment-processor.js');
      this.workers.push(worker);

      // Each worker gets a shared buffer for its output
      const buffer = new SharedArrayBuffer(BUFFER_SIZE * Float32Array.BYTES_PER_ELEMENT);
      this.sharedBuffers.push(buffer);
      worker.postMessage({ type: 'INIT', buffer });
    }
  }

  async executeWave(wave: SegmentId[]): Promise<void> {
    // Assign segments to workers
    const promises = wave.map((segmentId, i) => {
      const workerIndex = i % this.workers.length;
      const worker = this.workers[workerIndex];

      return new Promise<void>(resolve => {
        worker.onmessage = (e) => {
          if (e.data.type === 'DONE' && e.data.segmentId === segmentId) {
            resolve();
          }
        };
        worker.postMessage({
          type: 'PROCESS',
          segmentId,
          program: segments.get(segmentId).compiledProgram
        });
      });
    });

    await Promise.all(promises);
  }
}
```

---

## Part 6: GPU Acceleration (Refined)

### 6.1 GPU Role in Compiled Pipeline Architecture

**GPU is NOT for real-time audio** (transfer latency too high). Instead:

| GPU Task | When | Benefit |
|----------|------|---------|
| **Batch compilation** | On graph change | 10x faster program generation |
| **FFT visualization** | Continuous | Free up CPU for audio |
| **Offline rendering** | Export/bounce | 100x faster than real-time |
| **IR generation** | Reverb setup | Instant parameter tweaks |

### 6.2 GPU-Accelerated Compilation

```typescript
// Compile multiple segments in parallel on GPU
async function gpuBatchCompile(segments: Segment[]): Promise<CompiledProgram[]> {
  const device = await navigator.gpu.requestAdapter().then(a => a.requestDevice());

  // Prepare segment data
  const segmentData = segments.map(s => ({
    nodeCount: s.nodes.length,
    operations: flattenOperations(s.nodes)
  }));

  // Upload to GPU
  const inputBuffer = device.createBuffer({
    size: calculateBufferSize(segmentData),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(inputBuffer, 0, encodeSegmentData(segmentData));

  // Run compilation shader
  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: COMPILATION_SHADER }),
      entryPoint: 'compileSegments'
    }
  });

  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(computePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(segments.length);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);

  // Read back compiled programs
  const outputBuffer = await readGPUBuffer(outputBuffer);
  return decodeCompiledPrograms(outputBuffer);
}
```

### 6.3 GPU-Accelerated Visualization

```typescript
// Run FFT on GPU, render spectrogram directly to canvas
class GPUSpectrogram {
  private device: GPUDevice;
  private fftPipeline: GPUComputePipeline;
  private renderPipeline: GPURenderPipeline;

  async processFrame(audioBuffer: Float32Array): Promise<void> {
    // Upload audio to GPU
    this.device.queue.writeBuffer(this.audioBuffer, 0, audioBuffer);

    // Run FFT compute shader
    const encoder = this.device.createCommandEncoder();

    const fftPass = encoder.beginComputePass();
    fftPass.setPipeline(this.fftPipeline);
    fftPass.setBindGroup(0, this.fftBindGroup);
    fftPass.dispatchWorkgroups(1);  // 2048-point FFT
    fftPass.end();

    // Render directly to canvas (no CPU roundtrip)
    const renderPass = encoder.beginRenderPass(this.renderPassDescriptor);
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.spectrogramBindGroup);
    renderPass.draw(6);  // Full-screen quad
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
  }
}
```

---

## Part 7: Memory and State Management

### 7.1 Segment State Isolation

Each segment maintains its own state, enabling parallel execution:

```typescript
interface SegmentRuntime {
  segmentId: string;

  // Audio buffers (double-buffered for lock-free swap)
  inputBuffer: Float32Array;
  outputBuffer: Float32Array;
  bufferIndex: 0 | 1;

  // Effect state (isolated per segment)
  delayLines: Map<string, CircularBuffer>;
  filterStates: Float64Array[];
  convolverState: ConvolverState | null;

  // Execution state
  currentProgram: CompiledProgram | null;
  programVersion: number;
}
```

### 7.2 Lock-Free Buffer Swapping

```typescript
// Double-buffer pattern for parallel execution
class DoubleBuffer {
  private buffers: [Float32Array, Float32Array];
  private writeIndex: 0 | 1 = 0;

  getWriteBuffer(): Float32Array {
    return this.buffers[this.writeIndex];
  }

  getReadBuffer(): Float32Array {
    return this.buffers[1 - this.writeIndex];
  }

  swap(): void {
    this.writeIndex = 1 - this.writeIndex as 0 | 1;
  }
}
```

### 7.3 Memory Budget

```
Per Segment:
  - Input buffer:  4KB (128 samples × 2 channels × 4 bytes × 2 double-buffer)
  - Output buffer: 4KB
  - Filter states: ~200 bytes per filter
  - Delay lines:   48KB per second of delay

100 Segments = ~1 MB base + delay lines

Compiled Programs:
  - Average program: ~500 bytes
  - Lookup tables:   ~16KB per waveshaper
  - Impulse responses: ~4MB per reverb

Total for 100 segments with 10 reverbs: ~50 MB
```

---

## Part 8: Live Performance Scenarios

### 8.1 Scenario: Microphone → Looper → Effects → Speaker

**Setup:**
```
[Microphone] ─→ [Looper] ─→ [Distortion] ─→ [Reverb] ─→ [Speaker]
```

**Recording Phase:**
```
Segments:
  1. [Microphone] - DYNAMIC (live input)
  2. [Looper] - RECORDING (passthrough + capture)
  3. [Distortion → Reverb → Speaker] - COMPILED

Execution:
  Audio flows: Mic → Looper(capture) → Compiled(dist+verb) → Speaker
  Latency: Input device latency + ~5ms compiled processing
```

**Playback Phase:**
```
Segments:
  1. [Microphone] - DISCONNECTED (or new path)
  2. [Looper → Distortion → Reverb → Speaker] - FULLY COMPILED

Execution:
  Audio flows: LooperBuffer → Compiled(all effects) → Speaker
  Latency: ~0ms (buffer playback + compiled effects)
```

**Overdub Phase:**
```
Segments:
  1. [Microphone] - DYNAMIC
  2. [Looper] - OVERDUB (playback + capture mixed)
  3. [Distortion → Reverb → Speaker] - COMPILED

Execution:
  - Playback buffer → Compiled effects
  - Live mic → Mix with playback → Capture
  Latency: ~10ms (live path) + 0ms (playback path)
```

### 8.2 Scenario: Multiple Parallel Loopers

**Setup:**
```
[Looper A] ─→ [Effect A] ─┐
                          ├─→ [Add] ─→ [Master Effect] ─→ [Speaker]
[Looper B] ─→ [Effect B] ─┘
```

**Compilation:**
```
Segment 1: [Looper A → Effect A] - COMPILED (independent)
Segment 2: [Looper B → Effect B] - COMPILED (independent)
Segment 3: [Add → Master Effect → Speaker] - COMPILED (depends on 1,2)

Execution Plan:
  Wave 0: [Segment 1, Segment 2] - PARALLEL
  Wave 1: [Segment 3] - SEQUENTIAL (after wave 0)
```

### 8.3 Scenario: Live MIDI Performance

**Setup:**
```
[MIDI Keyboard] ─→ [Piano Synth] ─→ [Reverb] ─→ [Speaker]
```

**Compilation:**
```
Segments:
  1. [MIDI Keyboard] - DYNAMIC (event-driven, no audio)
  2. [Piano Synth] - DYNAMIC (triggered by MIDI events)
  3. [Reverb → Speaker] - COMPILED

The Piano Synth remains dynamic because:
  - Note-on/off events arrive in real-time
  - Polyphony varies (can't pre-compute voices)
  - Envelope states are per-voice

But downstream effects are compiled:
  - Reverb IR is static
  - Speaker routing is fixed
```

---

## Part 9: Implementation Phases

### Phase 1: Segmentation Engine (Week 1-2)

**Goals:**
- Implement segment detection algorithm
- Handle dynamic/static/stateful classification
- Build dependency graph for parallel execution

**Files:**
```
src/audio/pipeline/
├── SegmentDetector.ts      # Detect and classify segments
├── DependencyGraph.ts      # Build execution order
├── types.ts                # Segment, CompiledProgram types
└── __tests__/
    └── segmentation.test.ts
```

**Success Criteria:**
- Correctly segment 95%+ of graphs
- Handle all node types (dynamic, static, merge)
- < 5ms segmentation time for 100 nodes

### Phase 2: Compilation Engine (Week 3-4)

**Goals:**
- Implement operation fusion (gains, filters)
- Build CompiledProgram structure
- Create parameter hot-patching system

**Files:**
```
src/audio/pipeline/
├── Compiler.ts             # Main compilation logic
├── OperationFuser.ts       # Fuse compatible operations
├── ProgramBuilder.ts       # Build CompiledProgram
└── __tests__/
    └── compilation.test.ts
```

**Success Criteria:**
- Fuse 3+ gains into single multiply
- Fuse cascaded filters into single biquad chain
- < 10ms compilation time per segment

### Phase 3: Execution Worklet (Week 5-6)

**Goals:**
- Implement CompiledPipelineProcessor
- Support all operation types
- Handle program updates without glitches

**Files:**
```
src/audio/worklets/
├── CompiledPipelineWorklet.ts  # Main worklet processor
├── operations/
│   ├── gain.ts                 # Gain operation
│   ├── biquad.ts              # Biquad cascade
│   ├── waveshaper.ts          # Distortion LUT
│   ├── convolution.ts         # Convolution (partitioned)
│   └── delay.ts               # Delay line
└── __tests__/
    └── worklet.test.ts
```

**Success Criteria:**
- Process 128 samples in < 1ms
- Seamless program switching (no clicks)
- Support 10 operations per segment

### Phase 4: Dynamic Input Integration (Week 7-8)

**Goals:**
- Integrate microphone bypass
- Implement looper mode switching
- Handle MIDI event routing through compiled paths

**Files:**
```
src/audio/pipeline/
├── DynamicRouter.ts        # Route dynamic inputs
├── LooperIntegration.ts    # Looper mode handling
├── MIDIIntegration.ts      # MIDI through compiled effects
└── __tests__/
    └── dynamic.test.ts
```

**Success Criteria:**
- Mic latency unchanged from current (~10ms)
- Looper mode switch < 5ms
- No audio dropouts on mode change

### Phase 5: Parallel Execution (Week 9-10)

**Goals:**
- Implement parallel segment execution
- Add Web Worker parallelism
- Optimize for multi-core systems

**Files:**
```
src/audio/pipeline/
├── ParallelExecutor.ts     # Manage parallel execution
├── workers/
│   └── segment-worker.ts   # Worker for segment processing
└── __tests__/
    └── parallel.test.ts
```

**Success Criteria:**
- 2x speedup on 4-core systems
- No race conditions or glitches
- Graceful fallback on single-core

### Phase 6: GPU Integration (Week 11-12)

**Goals:**
- GPU-accelerated FFT for visualization
- GPU batch compilation
- Graceful fallback when unavailable

**Files:**
```
src/audio/gpu/
├── GPUCompiler.ts          # Batch compilation on GPU
├── GPUSpectrogram.ts       # FFT visualization
├── shaders/
│   ├── fft.wgsl           # FFT compute shader
│   └── compile.wgsl       # Compilation shader
└── __tests__/
    └── gpu.test.ts
```

**Success Criteria:**
- 100x faster FFT than CPU
- 10x faster batch compilation
- Works without GPU (CPU fallback)

### Phase 7: UI Integration (Week 13-14)

**Goals:**
- Visualize segment boundaries
- Show compilation status
- Manual recompile controls

**Files:**
```
src/components/
├── SegmentOverlay.tsx      # Visual segment boundaries
├── CompilationStatus.tsx   # Per-segment status
└── PipelineDebugger.tsx    # Developer tools
```

**Success Criteria:**
- Clear visual feedback
- < 100ms UI update on recompilation
- Helpful error messages

---

## Part 10: Performance Targets

### Current vs Target

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| **Latency (static path)** | 10-20ms | 0-5ms | 2-4x |
| **Latency (dynamic path)** | 10-20ms | 10-15ms | Maintained |
| **CPU (10 effects)** | 15-25% | 5-10% | 2-3x |
| **CPU (50 effects)** | 60-80% | 15-25% | 3-4x |
| **Parallel speedup** | 1x | 2-4x | 2-4x |
| **Recompile time** | N/A | < 10ms | New |

### Benchmark Scenarios

```
Scenario 1: Single looper with 5 effects
  Current: 15ms latency, 20% CPU
  Target:  3ms latency, 8% CPU

Scenario 2: 10 loopers, each with 3 effects, mixed to stereo
  Current: 25ms latency, 60% CPU
  Target:  5ms latency (parallel), 20% CPU

Scenario 3: Live mic → looper → 5 effects → speaker
  Recording: 12ms latency (mic input + minimal processing)
  Playback:  3ms latency (compiled path)

Scenario 4: Live MIDI → instrument → 3 effects → speaker
  Current: 15ms latency
  Target:  10ms latency (compiled downstream effects)
```

---

## Part 11: Risks and Mitigations

### Risk 1: Compilation Overhead

**Risk**: Frequent recompilation causes audio dropouts

**Mitigation**:
- Compile in background thread (Web Worker)
- Use version-based dirty tracking (only recompile changed segments)
- Hot-patch parameters instead of full recompile
- Queue compilation requests, debounce rapid changes

### Risk 2: Worklet Complexity

**Risk**: Custom worklet introduces bugs in audio path

**Mitigation**:
- Comprehensive unit tests for each operation
- A/B testing against native Web Audio nodes
- Fallback to native nodes if worklet fails
- Automated fuzz testing with random parameters

### Risk 3: Parallel Execution Bugs

**Risk**: Race conditions cause incorrect audio

**Mitigation**:
- Double-buffering for lock-free execution
- Immutable program structures
- Clear dependency ordering
- Extensive integration tests

### Risk 4: Browser Compatibility

**Risk**: WebGPU/SharedArrayBuffer not available

**Mitigation**:
- Feature detection with graceful fallback
- CPU-only path works without GPU
- Main thread execution if workers unavailable
- Progressive enhancement (better with features, works without)

---

## Part 12: Conclusion

This unified plan combines the best aspects of:

1. **GPU Acceleration Strategy**: GPU for visualization and batch processing, CPU for real-time audio
2. **Pipeline Pre-rendering Strategy**: Intelligent caching and dirty tracking
3. **New Compilation Approach**: Compile operations, not buffers, enabling dynamic input support

**Key Innovations:**

- **Operation Fusion**: Chain of gains/filters → single optimized operation
- **Segment Classification**: Dynamic vs static vs stateful paths
- **Parallel Execution**: Independent segments run concurrently
- **Hot Parameter Patching**: Update effects without recompilation
- **Live Performance Support**: Microphone → looper → effects works seamlessly

**Expected Outcomes:**

- **2-4x latency reduction** for static paths (0-5ms vs 10-20ms)
- **2-3x CPU reduction** through operation fusion
- **Full dynamic input support** for live performance
- **Graceful scaling** to 100+ nodes with parallel execution

**Next Step**: Implement **Phase 1 (Segmentation Engine)** to validate the segment detection algorithm with real audio graphs.

---

**Document Version**: 1.0
**Last Updated**: 2026-01-17
**Author**: Claude (Opus 4.5)
**Based On**: GPU_LATENCY_STRATEGY.md, PIPELINE_PRERENDERING_STRATEGY.md
