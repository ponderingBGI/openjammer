/**
 * OpenJammer - Pipeline Compilation Types
 *
 * Types for the compiled pipeline architecture that enables:
 * - Operation fusion (chain of gains → single multiply)
 * - Segment classification (DYNAMIC, STATIC, STATEFUL)
 * - Parallel execution through dependency tracking
 * - Hot parameter patching without recompilation
 */

import type { NodeType } from '../../engine/types';

// ============================================================================
// Segment Classification
// ============================================================================

/**
 * Segment types determine compilation and execution strategy
 */
export type SegmentType =
  | 'DYNAMIC'    // Live input (mic, MIDI) - cannot compile, passthrough
  | 'STATEFUL'   // Mode-dependent (looper) - compiled when playing, bypass when recording
  | 'STATIC'     // Fixed source + effects - fully compilable
  | 'MERGE'      // Multiple inputs (add/subtract) - compile post-merge ops
  | 'OUTPUT';    // Terminal nodes (speaker) - final routing

/**
 * A segment is a contiguous chain of nodes that can be compiled together
 */
export interface Segment {
  id: string;
  type: SegmentType;

  /** Ordered list of node IDs in this segment (source → destination) */
  nodeIds: string[];

  /** IDs of segments that must execute before this one */
  dependsOn: string[];

  /** IDs of segments that depend on this one */
  dependedBy: string[];

  /** Whether this segment has a compiled program ready */
  isCompiled: boolean;

  /** Version number - increments on each recompilation */
  version: number;

  /** Node versions at time of last compilation (for dirty tracking) */
  nodeVersions: Map<string, number>;
}

// ============================================================================
// Node Classification Helpers
// ============================================================================

/**
 * Nodes that produce real-time input (cannot be compiled)
 */
export const DYNAMIC_SOURCE_TYPES: NodeType[] = [
  'microphone',
  'midi',
  'minilab-3',
  'keyboard',
];

/**
 * Nodes that have mode-dependent behavior
 */
export const STATEFUL_NODE_TYPES: NodeType[] = [
  'looper',
  'recorder',
];

/**
 * Nodes that are pure audio sources (can be fully compiled)
 */
export const STATIC_SOURCE_TYPES: NodeType[] = [
  'library',
  'sampler',
];

/**
 * Nodes that process audio (candidates for fusion)
 */
export const PROCESSING_NODE_TYPES: NodeType[] = [
  'effect',
  'amplifier',
];

/**
 * Nodes that merge multiple inputs
 */
export const MERGE_NODE_TYPES: NodeType[] = [
  'add',
  'subtract',
];

/**
 * Terminal output nodes
 */
export const OUTPUT_NODE_TYPES: NodeType[] = [
  'speaker',
];

/**
 * Instrument nodes (triggered by control signals, output audio)
 */
export const INSTRUMENT_NODE_TYPES: NodeType[] = [
  'piano',
  'cello',
  'electricCello',
  'violin',
  'saxophone',
  'strings',
  'keys',
  'winds',
  'instrument',
  'sampler',
];

// ============================================================================
// Compiled Program Types
// ============================================================================

/**
 * Operation types that can be compiled into a program
 */
export type OperationType =
  | 'gain'
  | 'biquad_cascade'
  | 'waveshaper'
  | 'convolution'
  | 'delay'
  | 'passthrough';

/**
 * Parameters for each operation type
 */
export interface GainParams {
  value: number;
}

export interface BiquadFilterParams {
  type: BiquadFilterType;
  frequency: number;
  Q: number;
  gain: number;
}

export type BiquadFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch' | 'allpass';

export interface BiquadCascadeParams {
  filters: BiquadFilterParams[];
}

export interface WaveshaperParams {
  curve: Float32Array;
  oversample: 'none' | '2x' | '4x';
}

export interface ConvolutionParams {
  impulseResponseId: string;  // Reference to stored IR
  normalize: boolean;
}

export interface DelayParams {
  delayTime: number;    // In seconds
  feedback: number;     // 0-1
  wet: number;          // 0-1
}

export type OperationParams =
  | GainParams
  | BiquadCascadeParams
  | WaveshaperParams
  | ConvolutionParams
  | DelayParams
  | Record<string, never>;  // For passthrough

/**
 * A single compiled operation in the execution chain
 */
export interface CompiledOperation {
  type: OperationType;
  params: OperationParams;

  /** Original node ID this operation came from (for hot patching) */
  sourceNodeId: string;
}

/**
 * A compiled program representing a segment's audio processing
 */
export interface CompiledProgram {
  id: string;
  segmentId: string;
  version: number;

  /** Ordered operations to execute */
  operations: CompiledOperation[];

  /** Pre-computed lookup tables (waveshaper curves) */
  lookupTables: Map<string, Float32Array>;

  /** Pre-loaded impulse responses (convolution) */
  impulseResponseIds: string[];

  /** Map from nodeId to operation index (for hot patching) */
  nodeToOperationIndex: Map<string, number>;

  /** Execution hints */
  canRunParallel: boolean;        // No cross-channel dependencies
  estimatedCostPerSample: number; // For load balancing
}

// ============================================================================
// Dependency Graph Types
// ============================================================================

/**
 * Represents the execution order for segments
 */
export interface ExecutionPlan {
  /**
   * Segments grouped by execution wave
   * Wave 0: All independent segments (run in parallel)
   * Wave 1: Segments depending on Wave 0
   * Wave N: Segments depending on Wave N-1
   */
  waves: string[][];

  /** Total number of segments */
  totalSegments: number;

  /** Maximum parallelism available */
  maxParallelism: number;
}

/**
 * Edge in the segment dependency graph
 */
export interface DependencyEdge {
  from: string;  // Source segment ID
  to: string;    // Target segment ID
  connectionId: string;  // Original connection that created this dependency
}

/**
 * Full dependency graph for segments
 */
export interface DependencyGraph {
  /** All segments */
  segments: Map<string, Segment>;

  /** Directed edges (segment A must complete before segment B) */
  edges: DependencyEdge[];

  /** Computed execution plan */
  executionPlan: ExecutionPlan | null;
}

// ============================================================================
// Segmentation Result Types
// ============================================================================

/**
 * Result of analyzing a graph for segmentation
 */
export interface SegmentationResult {
  /** Detected segments */
  segments: Segment[];

  /** Dependency graph */
  dependencyGraph: DependencyGraph;

  /** Nodes that couldn't be segmented (orphans, invalid connections) */
  unassignedNodeIds: string[];

  /** Warnings during segmentation */
  warnings: SegmentationWarning[];
}

export interface SegmentationWarning {
  type: 'cycle_detected' | 'orphan_node' | 'invalid_connection' | 'unsupported_node';
  message: string;
  nodeIds?: string[];
  connectionIds?: string[];
}

// ============================================================================
// Runtime State Types
// ============================================================================

/**
 * Runtime state for a segment during execution
 */
export interface SegmentRuntime {
  segmentId: string;

  /** Current compiled program (null if not compiled) */
  program: CompiledProgram | null;

  /** Whether the segment needs recompilation */
  isDirty: boolean;

  /** Last execution time in milliseconds */
  lastExecutionTimeMs: number;

  /** Audio buffers for processing */
  inputBuffer: Float32Array | null;
  outputBuffer: Float32Array | null;
}

/**
 * Overall pipeline manager state
 */
export interface PipelineState {
  /** All segments */
  segments: Map<string, Segment>;

  /** Runtime state per segment */
  runtimes: Map<string, SegmentRuntime>;

  /** Current execution plan */
  executionPlan: ExecutionPlan | null;

  /** Global dirty flag (graph structure changed) */
  needsResegmentation: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the pipeline system
 */
export type PipelineEvent =
  | { type: 'segmentation_complete'; result: SegmentationResult }
  | { type: 'compilation_start'; segmentId: string }
  | { type: 'compilation_complete'; segmentId: string; program: CompiledProgram }
  | { type: 'compilation_error'; segmentId: string; error: Error }
  | { type: 'execution_start'; wave: number; segmentIds: string[] }
  | { type: 'execution_complete'; wave: number; durationMs: number }
  | { type: 'parameter_patched'; segmentId: string; nodeId: string; param: string };

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the pipeline system
 */
export interface PipelineConfig {
  /** Enable parallel execution across segments */
  enableParallelExecution: boolean;

  /** Maximum number of parallel workers */
  maxWorkers: number;

  /** Auto-recompile when parameters change */
  autoRecompile: boolean;

  /** Debounce time for recompilation (ms) */
  recompileDebounceMs: number;

  /** Enable operation fusion optimizations */
  enableOperationFusion: boolean;

  /** Log compilation and execution metrics */
  enableMetrics: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enableParallelExecution: true,
  maxWorkers: navigator?.hardwareConcurrency ?? 4,
  autoRecompile: true,
  recompileDebounceMs: 100,
  enableOperationFusion: true,
  enableMetrics: false,
};
