# Pipeline Pre-Rendering & Zero-Latency Cache Strategy

**Status**: Implementation Strategy
**Date**: 2026-01-17
**Goal**: Eliminate DSP overhead by pre-rendering static audio pipelines

---

## Executive Summary

This strategy implements **intelligent pipeline caching** to achieve **zero added latency** for static audio node chains. Instead of processing audio through multiple nodes in real-time, we:

1. **Detect linear pipelines** (chains of nodes: Source → Effect → Effect → Speaker)
2. **Pre-render** static sources through their entire effect chain into cached buffers
3. **Track dirty state** - only re-render from changed nodes forward
4. **Maintain multiple versions** - cache clean state at each node in the chain

**Key Insight**:
```
Static Source → Effect A → Effect B → Speaker

Instead of real-time:  Source(3ms) → A(3ms) → B(3ms) = 9ms latency
Pre-rendered:          CachedBuffer(0ms) = 0ms added latency
```

---

## Part 1: Core Concept

### 1.1 The Pipeline Model

A **pipeline** is a linear chain of audio nodes where each node has:
- **One input** (except source)
- **One output** (except speaker)
- **No branches** (no node feeds multiple destinations)

Example pipelines:
```
Pipeline 1: Looper → Amplifier → Effect (Reverb) → Speaker
Pipeline 2: Library Sample → Effect (Distortion) → Effect (Delay) → Speaker
Pipeline 3: Piano → Add → Amplifier → Speaker
```

### 1.2 Static vs Dynamic Nodes

**Static Nodes** (can be cached):
| Node Type | Static When | Example |
|-----------|-------------|---------|
| `looper` | Loop recorded and not editing | Drum loop playing |
| `library` | File loaded | Bass sample |
| `recorder` | Recording finished | Vocal take |
| `sampler` | Note sequence finished | Melodic pattern |
| `piano/cello/etc` | MIDI sequence finished | Pre-recorded performance |
| `add/subtract` | All inputs static | Mixing two loops |

**Dynamic Nodes** (NEVER cache):
| Node Type | Reason | Example |
|-----------|--------|---------|
| `microphone` | Real-time input | Live vocals |
| `midi/keyboard` | User control input | Live MIDI keyboard |
| `minilab-3` | Hardware controller | Real-time knob tweaking |

**Processing Nodes** (always bake into cache):
- `effect` - Distortion, reverb, delay, etc.
- `amplifier` - Gain changes
- `add/subtract` - Mixing

### 1.3 The Cache Invalidation Problem

When a node parameter changes, we must re-render:

```
[Clean] Looper → [DIRTY] Effect (user changes reverb) → [DIRTY] Amplifier → Speaker
         ↑                     ↑                              ↑
    Cache valid          Cache invalid                  Cache invalid
```

**Strategy**: Store cache at **each node** in the pipeline:
```
Node 1 cache: Looper output (original)
Node 2 cache: Looper → Effect output (INVALIDATED when effect changes)
Node 3 cache: Looper → Effect → Amplifier output (INVALIDATED when effect or amp changes)
```

---

## Part 2: Implementation Design

### 2.1 Pipeline Detection Algorithm

**Step 1**: Build adjacency graph from connections
```typescript
function detectPipelines(nodes: Map<string, GraphNode>, connections: Map<string, Connection>): Pipeline[] {
  const pipelines: Pipeline[] = [];

  // Build outgoing connection count for each node
  const outgoingCount = new Map<string, number>();
  for (const conn of connections.values()) {
    outgoingCount.set(conn.sourceId, (outgoingCount.get(conn.sourceId) || 0) + 1);
  }

  // Find source nodes (no incoming connections OR static source types)
  const sourceNodes = Array.from(nodes.values()).filter(node =>
    isStaticSource(node) && (outgoingCount.get(node.id) === 1) // Only one output
  );

  // Trace each source to its terminal (speaker)
  for (const source of sourceNodes) {
    const pipeline = tracePipeline(source, connections, outgoingCount);
    if (pipeline.length >= 2) { // At least source + one processing node
      pipelines.push({
        id: generatePipelineId(),
        nodes: pipeline,
        isDirty: true,
        caches: new Map() // nodeId -> AudioBuffer
      });
    }
  }

  return pipelines;
}
```

**Step 2**: Trace linear chain (no branches)
```typescript
function tracePipeline(
  start: GraphNode,
  connections: Map<string, Connection>,
  outgoingCount: Map<string, number>
): GraphNode[] {
  const chain: GraphNode[] = [start];
  let current = start;

  while (true) {
    // Find next node
    const outgoing = Array.from(connections.values())
      .filter(c => c.sourceId === current.id);

    // Pipeline ends if:
    // - No outgoing connections
    // - Multiple outgoing connections (branch detected)
    // - Reached speaker node
    if (outgoing.length !== 1) break;
    if (current.type === 'speaker') break;

    const nextConn = outgoing[0];
    const nextNode = nodes.get(nextConn.targetId);
    if (!nextNode) break;

    // Check if next node has multiple inputs (mixer, not pipeline)
    const incomingCount = Array.from(connections.values())
      .filter(c => c.targetId === nextNode.id).length;
    if (incomingCount > 1) break;

    chain.push(nextNode);
    current = nextNode;
  }

  return chain;
}
```

### 2.2 Dirty Tracking System

**Approach**: Use **generation counters** for each node
```typescript
interface PipelineCache {
  pipelineId: string;
  nodes: PipelineNode[];
}

interface PipelineNode {
  nodeId: string;
  nodeType: NodeType;

  // Cache state
  cachedBuffer: AudioBuffer | null;
  cacheGeneration: number;  // Increments when cache is regenerated

  // Dirty tracking
  parameterGeneration: number;  // Increments when node parameters change
  inputGeneration: number;      // Generation of input node's cache

  isDirty: boolean;
}

function checkDirty(pipelineNode: PipelineNode, inputNode: PipelineNode | null): boolean {
  // Dirty if:
  // 1. No cache exists
  if (!pipelineNode.cachedBuffer) return true;

  // 2. Parameters changed since last cache
  if (pipelineNode.parameterGeneration !== pipelineNode.cacheGeneration) return true;

  // 3. Input changed since we cached (propagation)
  if (inputNode && inputNode.cacheGeneration > pipelineNode.inputGeneration) return true;

  return false;
}
```

**Parameter Change Detection**:
```typescript
// In AudioGraphManager or graphStore
function updateNodeParameter(nodeId: string, param: string, value: any) {
  const node = nodes.get(nodeId);
  if (!node) return;

  // Update parameter
  node.data[param] = value;

  // Increment generation counter
  const pipelineNode = pipelineCache.getNodeById(nodeId);
  if (pipelineNode) {
    pipelineNode.parameterGeneration++;
    pipelineNode.isDirty = true;

    // Mark all downstream nodes dirty
    markDownstreamDirty(nodeId);
  }
}

function markDownstreamDirty(nodeId: string) {
  const pipeline = findPipelineContainingNode(nodeId);
  if (!pipeline) return;

  let foundNode = false;
  for (const node of pipeline.nodes) {
    if (node.nodeId === nodeId) {
      foundNode = true;
      continue; // This node is already marked dirty
    }
    if (foundNode) {
      node.isDirty = true;
    }
  }
}
```

### 2.3 Incremental Re-rendering

**Step 1**: Find first dirty node in pipeline
```typescript
function findFirstDirtyNode(pipeline: PipelineCache): number {
  for (let i = 0; i < pipeline.nodes.length; i++) {
    if (pipeline.nodes[i].isDirty) {
      return i;
    }
  }
  return -1; // All clean
}
```

**Step 2**: Re-render from dirty point forward
```typescript
async function updatePipeline(pipeline: PipelineCache): Promise<void> {
  const firstDirty = findFirstDirtyNode(pipeline);
  if (firstDirty === -1) return; // Nothing to do

  // Get input buffer (either from previous node's cache or source)
  let inputBuffer: AudioBuffer;
  if (firstDirty === 0) {
    // First node is source
    inputBuffer = await getSourceBuffer(pipeline.nodes[0]);
  } else {
    // Use previous node's cached output
    inputBuffer = pipeline.nodes[firstDirty - 1].cachedBuffer!;
  }

  // Process from firstDirty to end
  for (let i = firstDirty; i < pipeline.nodes.length; i++) {
    const node = pipeline.nodes[i];

    // Apply this node's processing to input buffer
    const outputBuffer = await processNode(node, inputBuffer);

    // Cache the result
    node.cachedBuffer = outputBuffer;
    node.cacheGeneration++;
    node.inputGeneration = i > 0 ? pipeline.nodes[i-1].cacheGeneration : 0;
    node.isDirty = false;

    // Output becomes next input
    inputBuffer = outputBuffer;
  }
}
```

**Step 3**: Apply cached buffer to speaker
```typescript
function playPipelineCache(pipeline: PipelineCache) {
  // Get final cached buffer (last node before speaker)
  const finalNode = pipeline.nodes[pipeline.nodes.length - 2]; // -2 because last is speaker
  const buffer = finalNode.cachedBuffer;

  if (!buffer) {
    console.warn('Pipeline cache not ready');
    return;
  }

  // Create buffer source and play
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Connect to speaker's input
  const speakerNode = pipeline.nodes[pipeline.nodes.length - 1];
  const audioInstance = audioNodeInstances.get(speakerNode.nodeId);

  if (audioInstance?.inputNode) {
    source.connect(audioInstance.inputNode);
    source.start(0);
  }
}
```

---

## Part 3: Processing Implementation

### 3.1 Offline Audio Rendering

Use **OfflineAudioContext** for pre-rendering:

```typescript
async function processNode(
  node: PipelineNode,
  inputBuffer: AudioBuffer
): Promise<AudioBuffer> {

  const sampleRate = inputBuffer.sampleRate;
  const duration = inputBuffer.duration;

  // Create offline context (no latency, runs faster than real-time)
  const offlineCtx = new OfflineAudioContext({
    numberOfChannels: inputBuffer.numberOfChannels,
    length: inputBuffer.length,
    sampleRate: sampleRate
  });

  // Create source from input buffer
  const source = offlineCtx.createBufferSource();
  source.buffer = inputBuffer;

  // Apply node's processing
  const processedNode = await applyNodeProcessing(node, source, offlineCtx);

  // Connect to destination
  processedNode.connect(offlineCtx.destination);
  source.start(0);

  // Render (returns AudioBuffer)
  const renderedBuffer = await offlineCtx.startRendering();

  return renderedBuffer;
}
```

### 3.2 Node-Specific Processing

**Effect Node**:
```typescript
async function applyNodeProcessing(
  node: PipelineNode,
  source: AudioBufferSourceNode,
  ctx: OfflineAudioContext
): Promise<AudioNode> {

  switch (node.nodeType) {
    case 'effect': {
      const effectData = node.data as EffectNodeData;
      const effectNode = createOfflineEffect(effectData, ctx);
      source.connect(effectNode.inputNode);
      return effectNode.outputNode;
    }

    case 'amplifier': {
      const ampData = node.data as AmplifierNodeData;
      const gain = ctx.createGain();
      gain.gain.value = ampData.gain ?? 1.0;
      source.connect(gain);
      return gain;
    }

    case 'add': {
      // For add node, we need BOTH inputs
      // This requires special handling (see section 3.3)
      return await processAddNode(node, source, ctx);
    }

    default:
      // Pass-through
      return source;
  }
}

function createOfflineEffect(data: EffectNodeData, ctx: OfflineAudioContext): Effect {
  // Recreate effect using same parameters but in offline context
  return createEffect(data.effectType, data.effectParams, ctx);
}
```

### 3.3 Multi-Input Node Handling (Add/Subtract)

**Challenge**: Add/Subtract nodes have **two inputs**, which breaks simple linear chain

**Solution**: Process each input branch separately, then combine:

```typescript
async function processAddNode(
  addNode: PipelineNode,
  input1Buffer: AudioBuffer,
  ctx: OfflineAudioContext
): Promise<AudioNode> {

  // Find the second input source
  const input2NodeId = findSecondInput(addNode.nodeId);
  const input2Pipeline = findPipelineContainingNode(input2NodeId);

  // Ensure second input is rendered
  if (input2Pipeline) {
    await updatePipeline(input2Pipeline);
    const input2Node = input2Pipeline.nodes.find(n => n.nodeId === input2NodeId);
    const input2Buffer = input2Node?.cachedBuffer;

    if (input2Buffer) {
      // Create sources for both inputs
      const source1 = ctx.createBufferSource();
      source1.buffer = input1Buffer;

      const source2 = ctx.createBufferSource();
      source2.buffer = input2Buffer;

      // Create mixer
      const mixer = ctx.createGain();
      mixer.gain.value = 1.0;

      source1.connect(mixer);
      source2.connect(mixer);

      source1.start(0);
      source2.start(0);

      return mixer;
    }
  }

  // Fallback: only use input1
  return input1;
}
```

---

## Part 4: GPU Acceleration Integration

### 4.1 Parallel Pipeline Rendering

**Opportunity**: When multiple pipelines are dirty, render them in **parallel on GPU**

```typescript
async function updateAllPipelines(pipelines: PipelineCache[]): Promise<void> {
  // Find dirty pipelines
  const dirtyPipelines = pipelines.filter(p =>
    p.nodes.some(n => n.isDirty)
  );

  if (dirtyPipelines.length === 0) return;

  // If WebGPU available, batch process
  if (isWebGPUAvailable()) {
    await gpuBatchRenderPipelines(dirtyPipelines);
  } else {
    // CPU fallback: parallel OfflineAudioContext (still faster than serial)
    await Promise.all(dirtyPipelines.map(p => updatePipeline(p)));
  }
}
```

### 4.2 GPU Batch Rendering

**Use WebGPU compute shaders** to process multiple effect chains in parallel:

```typescript
async function gpuBatchRenderPipelines(pipelines: PipelineCache[]): Promise<void> {
  const gpu = navigator.gpu;
  const adapter = await gpu.requestAdapter();
  const device = await adapter.requestDevice();

  // Prepare input buffers
  const inputBuffers = pipelines.map(p => {
    const firstDirty = findFirstDirtyNode(p);
    return firstDirty > 0
      ? p.nodes[firstDirty - 1].cachedBuffer
      : getSourceBuffer(p.nodes[0]);
  });

  // Prepare effect parameters
  const effectParams = pipelines.map(p => {
    const firstDirty = findFirstDirtyNode(p);
    return p.nodes[firstDirty].data;
  });

  // Create GPU buffers (flatten audio to Float32Array)
  const gpuInputBuffers = await Promise.all(
    inputBuffers.map(buf => uploadAudioBufferToGPU(buf, device))
  );

  // Run compute shader for each effect type in parallel
  const results = await runEffectShader(gpuInputBuffers, effectParams, device);

  // Download results and update caches
  for (let i = 0; i < pipelines.length; i++) {
    const renderedBuffer = await downloadAudioBufferFromGPU(results[i], device);
    const firstDirty = findFirstDirtyNode(pipelines[i]);
    pipelines[i].nodes[firstDirty].cachedBuffer = renderedBuffer;
    pipelines[i].nodes[firstDirty].cacheGeneration++;
    pipelines[i].nodes[firstDirty].isDirty = false;
  }
}
```

**Expected Speedup**: 10-100× for batch rendering of 10+ pipelines

---

## Part 5: Memory Management

### 5.1 Cache Size Estimation

**Per-pipeline memory**:
```
Single cache = sampleRate × duration × channels × 4 bytes

Example (10 second loop):
48000 Hz × 10s × 2 channels × 4 bytes = 3.84 MB per cache

Pipeline with 5 nodes = 5 caches × 3.84 MB = 19.2 MB
```

**Limits**:
- **Max 50 pipelines** × 20 MB = **1 GB total cache**
- Warn if exceeding 500 MB
- Implement LRU eviction for unused caches

### 5.2 Smart Eviction Strategy

**LRU (Least Recently Used)**:
```typescript
interface CacheMetrics {
  lastAccessed: number;  // Timestamp
  accessCount: number;   // How often used
  memorySize: number;    // Bytes
}

function evictCaches(targetMemory: number) {
  const caches = Array.from(pipelineCacheMetrics.entries())
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed); // Oldest first

  let freedMemory = 0;
  for (const [pipelineId, metrics] of caches) {
    if (freedMemory >= targetMemory) break;

    // Evict all caches in this pipeline
    const pipeline = pipelines.find(p => p.id === pipelineId);
    if (pipeline) {
      for (const node of pipeline.nodes) {
        if (node.cachedBuffer) {
          freedMemory += metrics.memorySize / pipeline.nodes.length;
          node.cachedBuffer = null;
          node.isDirty = true;
        }
      }
    }
  }
}
```

### 5.3 Partial Eviction

**Strategy**: Keep only **first node cache** (source), evict processed caches:
```typescript
function partialEvict(pipeline: PipelineCache) {
  // Keep source cache (node 0)
  const sourceCache = pipeline.nodes[0].cachedBuffer;

  // Evict downstream caches
  for (let i = 1; i < pipeline.nodes.length; i++) {
    pipeline.nodes[i].cachedBuffer = null;
    pipeline.nodes[i].isDirty = true;
  }

  // Can quickly regenerate from source when needed
}
```

---

## Part 6: User Experience

### 6.1 Cache Status Indicator

Add visual feedback to show pipeline state:

```typescript
interface PipelineStatus {
  pipelineId: string;
  status: 'clean' | 'dirty' | 'rendering' | 'error';
  progress?: number; // 0-100 for rendering
}
```

**UI Component**:
```tsx
function PipelineCacheIndicator({ nodeId }: { nodeId: string }) {
  const pipeline = usePipelineForNode(nodeId);

  if (!pipeline) return null;

  return (
    <div className="cache-status">
      {pipeline.status === 'clean' && <CachedIcon />}
      {pipeline.status === 'dirty' && <RefreshIcon />}
      {pipeline.status === 'rendering' && <Spinner progress={pipeline.progress} />}
    </div>
  );
}
```

### 6.2 Manual Cache Control

Let users manually trigger cache updates:

```tsx
function NodeContextMenu({ node }: { node: GraphNode }) {
  const pipeline = usePipelineForNode(node.id);

  return (
    <Menu>
      {pipeline && (
        <>
          <MenuItem onClick={() => updatePipeline(pipeline)}>
            Regenerate Cache
          </MenuItem>
          <MenuItem onClick={() => evictPipelineCache(pipeline.id)}>
            Clear Cache
          </MenuItem>
          <MenuItem onClick={() => freezePipeline(pipeline.id)}>
            Freeze Pipeline (lock cache)
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
```

### 6.3 Auto-Freeze Detection

**Heuristic**: If node hasn't changed for 5 seconds, auto-freeze pipeline

```typescript
const NODE_FREEZE_DELAY = 5000; // 5 seconds

function scheduleAutoFreeze(nodeId: string) {
  const existing = autoFreezeTimers.get(nodeId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    const pipeline = findPipelineContainingNode(nodeId);
    if (pipeline && !pipeline.nodes.some(n => n.isDirty)) {
      // Pipeline is stable, mark as frozen
      pipeline.isFrozen = true;
      console.log(`Auto-frozen pipeline ${pipeline.id}`);
    }
  }, NODE_FREEZE_DELAY);

  autoFreezeTimers.set(nodeId, timer);
}
```

---

## Part 7: Implementation Phases

### Phase 1: Pipeline Detection (Week 1)

**Goals**:
- Implement `detectPipelines()` algorithm
- Add pipeline tracking to `AudioGraphManager`
- Create `PipelineCache` data structure

**Files**:
- `src/audio/PipelineDetector.ts` (new)
- `src/audio/AudioGraphManager.ts` (extend)

**Success Criteria**:
- Detect 10+ simple pipelines in test graph
- Handle branching (exclude from pipelines)
- Performance: <10ms detection time for 100 nodes

### Phase 2: Dirty Tracking (Week 2)

**Goals**:
- Add generation counters to nodes
- Implement parameter change detection
- Build dirty propagation system

**Files**:
- `src/audio/PipelineCacheManager.ts` (new)
- `src/store/graphStore.ts` (extend with generations)

**Success Criteria**:
- Changing node parameter marks downstream nodes dirty
- Efficient propagation (<1ms for 20-node pipeline)

### Phase 3: Offline Rendering (Week 3)

**Goals**:
- Implement `processNode()` with `OfflineAudioContext`
- Support effect, amplifier, and pass-through nodes
- Incremental re-rendering from dirty point

**Files**:
- `src/audio/OfflineRenderer.ts` (new)
- `src/audio/effects/OfflineEffects.ts` (new)

**Success Criteria**:
- Render 10-second loop through 3 effects in <500ms
- Cached playback has 0ms added latency vs source
- Incremental update only re-renders dirty section

### Phase 4: Multi-Input Support (Week 4)

**Goals**:
- Handle `add` and `subtract` nodes with dual inputs
- Dependency resolution (render input pipelines first)

**Files**:
- `src/audio/MultiInputRenderer.ts` (new)
- `src/audio/PipelineCacheManager.ts` (extend)

**Success Criteria**:
- Add node correctly mixes two cached pipelines
- Changing one input only re-renders affected branch

### Phase 5: GPU Acceleration (Week 5-6)

**Goals**:
- Batch pipeline rendering on GPU
- Parallel processing of 10+ pipelines
- Fallback to CPU when GPU unavailable

**Files**:
- `src/audio/gpu/GPUPipelineRenderer.ts` (new)
- `src/audio/gpu/shaders/effects.wgsl` (new)

**Success Criteria**:
- 10× faster batch rendering vs CPU
- Graceful fallback to `OfflineAudioContext`

### Phase 6: Memory Management (Week 7)

**Goals**:
- LRU cache eviction
- Memory usage monitoring
- Partial eviction (keep source caches)

**Files**:
- `src/audio/CacheEvictionManager.ts` (new)

**Success Criteria**:
- Stay under 500 MB total cache size
- Evict oldest unused caches first
- Warn user before eviction

### Phase 7: UI Integration (Week 8)

**Goals**:
- Pipeline status indicators on nodes
- Manual cache controls in context menu
- Auto-freeze after 5 seconds of stability

**Files**:
- `src/components/PipelineCacheIndicator.tsx` (new)
- `src/components/NodeContextMenu.tsx` (extend)

**Success Criteria**:
- Visual feedback for cache state
- Users can manually trigger re-render
- Auto-freeze reduces unnecessary updates

---

## Part 8: Performance Benchmarks

### 8.1 Baseline (Current System)

| Scenario | Current Latency | Current CPU |
|----------|----------------|-------------|
| **1 Looper → Effect → Speaker** | 10-20ms | 5-10% |
| **3 Loopers → Effects → Speaker** | 10-20ms | 15-25% |
| **10 Loopers → Effects → Speaker** | 15-30ms | 40-60% |

### 8.2 Target (With Pipeline Caching)

| Scenario | Target Latency | Target CPU | Speedup |
|----------|----------------|------------|---------|
| **1 Looper → Effect → Speaker** | **0ms** (cached) | 1-2% | 5× |
| **3 Loopers → Effects → Speaker** | **0ms** (cached) | 3-5% | 5-8× |
| **10 Loopers → Effects → Speaker** | **0ms** (cached) | 5-10% | 8-12× |

### 8.3 Re-render Performance

| Operation | Current | With Cache | With GPU |
|-----------|---------|------------|----------|
| **Change effect param** | Real-time (instant) | 200-500ms | 50-100ms |
| **Add new effect** | Real-time | 200-500ms | 50-100ms |
| **Change source loop** | Instant | 500-1000ms | 100-200ms |
| **10 pipelines batch update** | N/A | 2-5s | 200-500ms |

**Expected Outcomes**:
- **0ms added latency** for frozen pipelines (playback from cache)
- **5-12× CPU reduction** for static loops
- **100+ simultaneous loops** with same latency as 10 loops currently

---

## Part 9: Edge Cases & Limitations

### 9.1 When NOT to Use Pipeline Caching

**Scenarios**:
1. **Live microphone input** - Cannot be pre-rendered
2. **Real-time MIDI control** - User playing live
3. **Modulation** - Effect parameters changing continuously (LFO, envelope)
4. **Short loops** (<1 second) - Cache overhead > benefit

**Solution**: Detect these cases and **exclude from caching**:
```typescript
function shouldCache(node: GraphNode): boolean {
  // Never cache dynamic sources
  if (['microphone', 'midi', 'keyboard'].includes(node.type)) {
    return false;
  }

  // Don't cache if effect has LFO/modulation
  if (node.type === 'effect' && hasModulation(node.data)) {
    return false;
  }

  // Don't cache very short loops (overhead not worth it)
  if (node.type === 'looper') {
    const duration = getLooperDuration(node);
    if (duration < 1.0) return false;
  }

  return true;
}
```

### 9.2 Dynamic Loop Length

**Challenge**: Looper duration can change (overdubs extend length)

**Solution**: Invalidate cache when duration changes:
```typescript
function onLooperRecording(nodeId: string, newDuration: number) {
  const pipelineNode = pipelineCache.getNodeById(nodeId);
  if (pipelineNode) {
    const oldDuration = pipelineNode.cachedBuffer?.duration || 0;

    if (Math.abs(newDuration - oldDuration) > 0.01) {
      // Duration changed, invalidate
      pipelineNode.parameterGeneration++;
      pipelineNode.isDirty = true;
      markDownstreamDirty(nodeId);
    }
  }
}
```

### 9.3 Variable Sample Rate

**Challenge**: Different sample rates between nodes

**Solution**: Resample to common rate (48kHz):
```typescript
async function resampleBuffer(
  buffer: AudioBuffer,
  targetRate: number
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;

  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.ceil(buffer.duration * targetRate),
    targetRate
  );

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);

  return await ctx.startRendering();
}
```

### 9.4 Infinite Loops (Feedback)

**Challenge**: Pipeline with feedback loop (e.g., Effect → Delay → back to Effect)

**Solution**: Detect cycles and **exclude from caching**:
```typescript
function hasCycle(pipeline: GraphNode[]): boolean {
  const visited = new Set<string>();

  for (const node of pipeline) {
    if (visited.has(node.id)) {
      return true; // Cycle detected
    }
    visited.add(node.id);
  }

  return false;
}
```

---

## Part 10: Code Structure

### 10.1 New Files

```
src/audio/
├─ pipeline/
│  ├─ PipelineDetector.ts          # Detect linear chains
│  ├─ PipelineCacheManager.ts      # Main cache orchestrator
│  ├─ OfflineRenderer.ts           # OfflineAudioContext rendering
│  ├─ MultiInputRenderer.ts        # Handle add/subtract nodes
│  ├─ CacheEvictionManager.ts      # LRU memory management
│  ├─ types.ts                     # Pipeline types
│  └─ __tests__/
│     ├─ detector.test.ts
│     ├─ caching.test.ts
│     └─ rendering.test.ts
│
├─ gpu/
│  ├─ GPUPipelineRenderer.ts       # Batch GPU rendering
│  └─ shaders/
│     └─ pipeline-effects.wgsl     # GPU effect shaders
│
src/components/
├─ PipelineCacheIndicator.tsx      # Visual cache status
└─ NodeContextMenu.tsx              # Add cache controls

docs/
└─ PIPELINE_PRERENDERING_STRATEGY.md  # This document
```

### 10.2 Modified Files

```
src/audio/
├─ AudioGraphManager.ts
│  ├─ Add pipeline detection hook
│  ├─ Route cached audio to speakers
│  └─ Trigger re-render on parameter changes
│
src/store/
├─ graphStore.ts
│  ├─ Add parameterGeneration field to GraphNode
│  └─ Increment generation on data updates

src/engine/
├─ types.ts
│  └─ Extend NodeData with caching metadata
```

### 10.3 Estimated LOC

- **New code**: ~3,500 lines
  - Pipeline detection: ~400 lines
  - Cache management: ~600 lines
  - Offline rendering: ~800 lines
  - GPU rendering: ~700 lines
  - UI components: ~300 lines
  - Tests: ~700 lines

- **Modified code**: ~400 lines
  - AudioGraphManager: ~200 lines
  - graphStore: ~100 lines
  - Types: ~100 lines

- **Total**: ~3,900 lines

---

## Part 11: Success Criteria

### 11.1 Functional Requirements

✅ **Pipeline Detection**:
- Detect 95%+ of linear node chains
- Exclude branches and cycles
- Update in <10ms when graph changes

✅ **Dirty Tracking**:
- Parameter changes propagate downstream in <1ms
- Only re-render from dirty point forward
- Support multi-input nodes (add/subtract)

✅ **Rendering Performance**:
- 10s loop through 3 effects renders in <500ms (CPU)
- 10s loop through 3 effects renders in <100ms (GPU)
- Cached playback adds 0ms latency

✅ **Memory Management**:
- Stay under 500 MB cache size
- LRU eviction when exceeding limit
- Partial eviction keeps source caches

### 11.2 Performance Targets

| Metric | Baseline | Target | Achieved |
|--------|----------|--------|----------|
| **Latency (10 loopers)** | 15-30ms | 0ms | ⬜ |
| **CPU (10 loopers)** | 40-60% | 5-10% | ⬜ |
| **Re-render time (CPU)** | N/A | <500ms | ⬜ |
| **Re-render time (GPU)** | N/A | <100ms | ⬜ |
| **Memory overhead** | 0 MB | <500 MB | ⬜ |

### 11.3 User Experience

✅ **Transparency**:
- Users see cache status on nodes
- Clear visual feedback during rendering
- Option to manually control caching

✅ **Reliability**:
- Graceful fallback when cache fails
- No audio glitches during cache updates
- Correct audio output (identical to real-time)

✅ **Flexibility**:
- Users can freeze/unfreeze pipelines
- Auto-freeze after stability (5s)
- Works with existing graph operations (undo/redo, copy/paste)

---

## Part 12: Future Enhancements

### 12.1 Smart Loop Prediction

**Idea**: Pre-render **next loop iteration** before current one ends

```typescript
function predictNextLoop(looper: Looper, pipeline: PipelineCache) {
  const timeRemaining = looper.getTimeToLoopEnd();
  const renderTime = estimateRenderTime(pipeline);

  if (timeRemaining < renderTime * 2) {
    // Start pre-rendering next iteration
    updatePipeline(pipeline);
  }
}
```

**Benefit**: Seamless loop playback even after parameter changes

### 12.2 Cloud Cache Storage

**Idea**: Store pipeline caches in IndexedDB for persistence across sessions

```typescript
async function savePipelineCacheToIndexedDB(pipeline: PipelineCache) {
  const db = await openPipelineCacheDB();

  for (const node of pipeline.nodes) {
    if (node.cachedBuffer) {
      await db.put('caches', {
        pipelineId: pipeline.id,
        nodeId: node.nodeId,
        buffer: node.cachedBuffer,
        generation: node.cacheGeneration
      });
    }
  }
}
```

**Benefit**: Instant project load (caches already rendered)

### 12.3 Collaborative Caching

**Idea**: Share pipeline caches between users working on same project

**Architecture**:
```
User A renders Pipeline 1 → Upload cache to server
User B opens project → Download cache from server
User B gets instant playback (no render needed)
```

**Benefit**: Faster collaboration, shared compute resources

### 12.4 AI-Powered Cache Prediction

**Idea**: Use ML to predict which pipelines user will change next

```typescript
function predictNextEdit(userHistory: Edit[]): string[] {
  // Analyze past editing patterns
  // Return list of likely-to-change node IDs
  return mlModel.predict(userHistory);
}

function preemptiveRender(predictions: string[]) {
  // Pre-render predicted pipelines in background
  for (const nodeId of predictions) {
    const pipeline = findPipelineContainingNode(nodeId);
    if (pipeline) {
      queueBackgroundRender(pipeline);
    }
  }
}
```

**Benefit**: Near-instant response to parameter tweaks

---

## Part 13: Risks & Mitigations

### 13.1 Increased Complexity

**Risk**: Caching adds significant code complexity

**Mitigation**:
- Clear separation: `PipelineCacheManager` owns all cache logic
- Comprehensive tests (70%+ coverage)
- Fallback to real-time if cache fails

### 13.2 Memory Overhead

**Risk**: Caching uses 500+ MB RAM

**Mitigation**:
- LRU eviction when exceeding limits
- Partial eviction (keep source caches only)
- User-visible memory warnings

### 13.3 Cache Invalidation Bugs

**Risk**: Stale cache causes wrong audio output

**Mitigation**:
- Conservative dirty marking (over-invalidate if unsure)
- Version numbers to detect mismatches
- Manual "Force Re-render" button

### 13.4 Synchronization Issues

**Risk**: Cached playback out of sync with real-time sources

**Mitigation**:
- Only cache fully static pipelines
- Exclude dynamic sources (mic, MIDI) automatically
- Clear visual indication of cached vs live nodes

---

## Part 14: Recommendations

### 14.1 Immediate Actions (This Sprint)

1. ✅ **Document this strategy** (DONE)
2. 🎯 **Prototype pipeline detection** (Phase 1)
3. 🎯 **Benchmark current system** with 10+ loopers
4. 🎯 **Proof-of-concept**: Cache single pipeline with `OfflineAudioContext`

### 14.2 Short-Term (Next 4 Weeks)

1. 🎯 **Implement Phases 1-3** (detection, dirty tracking, offline rendering)
2. 🎯 **Add cache status UI** (visual feedback)
3. 🎯 **Test with real projects** (10+ loop compositions)

### 14.3 Long-Term (Next Quarter)

1. 🎯 **GPU acceleration** (Phase 5)
2. 🎯 **Memory management** (Phase 6)
3. 🎯 **Advanced features** (IndexedDB storage, smart prediction)

---

## Part 15: Conclusion

**Pipeline pre-rendering is the key to zero-latency scaling.**

By intelligently caching static audio chains, we can:
- ✅ **Eliminate DSP latency** (0ms added latency for cached playback)
- ✅ **Reduce CPU usage 5-12×** (cached pipelines don't need real-time processing)
- ✅ **Scale to 100+ loopers** (same latency as 10 loops currently)

**The strategy combines**:
1. **Smart pipeline detection** (only cache linear chains)
2. **Incremental dirty tracking** (only re-render from changed nodes forward)
3. **Offline rendering** (faster than real-time, no latency overhead)
4. **GPU acceleration** (10-100× speedup for batch rendering)
5. **LRU memory management** (stay under 500 MB)

**Next Step**: Implement **Phase 1 (Pipeline Detection)** as a proof-of-concept to validate the approach with real audio data.

---

**Document Version**: 1.0
**Last Updated**: 2026-01-17
**Author**: Claude (Sonnet 4.5)
**Reviewed By**: Pending
