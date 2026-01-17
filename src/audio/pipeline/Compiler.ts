/**
 * OpenJammer - Pipeline Compiler
 *
 * Compiles segments into optimized CompiledProgram structures.
 * The compiler:
 * 1. Extracts operations from each node in the segment
 * 2. Fuses compatible operations (gains, filters)
 * 3. Builds the final CompiledProgram with lookup tables
 * 4. Supports hot-patching for parameter updates
 */

import type { GraphNode, Connection } from '../../engine/types';
import type {
  Segment,
  CompiledProgram,
  CompiledOperation,
  GainParams,
  BiquadCascadeParams,
  WaveshaperParams,
  ConvolutionParams,
  DelayParams,
  PipelineEvent,
  PipelineEventHandler,
} from './types';
import {
  extractOperation,
  fuseOperationList,
  generateDistortionCurve,
  debugOperation,
} from './OperationFuser';

// ============================================================================
// Program ID Generation
// ============================================================================

let programCounter = 0;

function generateProgramId(): string {
  return `prog_${Date.now()}_${++programCounter}`;
}

// ============================================================================
// Compiler Class
// ============================================================================

export class PipelineCompiler {
  private nodes: Map<string, GraphNode>;
  private connections: Map<string, Connection>;
  private eventHandlers: PipelineEventHandler[] = [];

  /** Cached lookup tables (waveshaper curves) */
  private lookupTableCache: Map<string, Float32Array> = new Map();

  /** Node versions at last compilation (for dirty tracking) */
  private nodeVersions: Map<string, number> = new Map();

  constructor(
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
  ) {
    this.nodes = nodes;
    this.connections = connections;
  }

  /**
   * Update the graph references
   */
  updateGraph(
    nodes: Map<string, GraphNode>,
    connections: Map<string, Connection>
  ): void {
    this.nodes = nodes;
    this.connections = connections;
  }

  /**
   * Subscribe to compiler events
   */
  on(handler: PipelineEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index >= 0) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  private emit(event: PipelineEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Error in pipeline event handler:', e);
      }
    }
  }

  /**
   * Compile a segment into a CompiledProgram
   */
  compile(segment: Segment): CompiledProgram {
    this.emit({ type: 'compilation_start', segmentId: segment.id });

    try {
      // Step 1: Extract operations from all nodes
      const rawOperations: CompiledOperation[] = [];
      const nodeVersions = new Map<string, number>();

      for (const nodeId of segment.nodeIds) {
        const node = this.nodes.get(nodeId);
        if (!node) continue;

        // Track node version for dirty checking
        const version = this.getNodeVersion(node);
        nodeVersions.set(nodeId, version);

        // Extract operation (if any)
        const operation = extractOperation(node);
        if (operation) {
          rawOperations.push(operation);
        }
      }

      // Step 2: Fuse operations
      const fusedOperations = fuseOperationList(rawOperations);

      // Step 3: Build lookup tables
      const lookupTables = new Map<string, Float32Array>();
      const impulseResponseIds: string[] = [];

      for (const op of fusedOperations) {
        if (op.type === 'waveshaper') {
          const params = op.params as WaveshaperParams;
          const cacheKey = this.getCurveCacheKey(params);

          // Check cache first
          let curve = this.lookupTableCache.get(cacheKey);
          if (!curve) {
            curve = params.curve;
            this.lookupTableCache.set(cacheKey, curve);
          }

          lookupTables.set(op.sourceNodeId, curve);
        }

        if (op.type === 'convolution') {
          const params = op.params as ConvolutionParams;
          impulseResponseIds.push(params.impulseResponseId);
        }
      }

      // Step 4: Build node-to-operation index
      const nodeToOperationIndex = new Map<string, number>();
      for (let i = 0; i < fusedOperations.length; i++) {
        const op = fusedOperations[i];
        // Handle fused operations (multiple source nodes)
        if (op.sourceNodeId.startsWith('fused:')) {
          const nodeIds = op.sourceNodeId.slice(6).split('+');
          for (const nodeId of nodeIds) {
            nodeToOperationIndex.set(nodeId, i);
          }
        } else {
          nodeToOperationIndex.set(op.sourceNodeId, i);
        }
      }

      // Step 5: Calculate execution hints
      const canRunParallel = this.canRunParallel(fusedOperations);
      const estimatedCostPerSample = this.estimateCost(fusedOperations);

      // Build final program
      const program: CompiledProgram = {
        id: generateProgramId(),
        segmentId: segment.id,
        version: segment.version + 1,
        operations: fusedOperations,
        lookupTables,
        impulseResponseIds,
        nodeToOperationIndex,
        canRunParallel,
        estimatedCostPerSample,
      };

      // Update segment's node versions
      segment.nodeVersions = nodeVersions;
      segment.isCompiled = true;
      segment.version = program.version;

      this.emit({
        type: 'compilation_complete',
        segmentId: segment.id,
        program,
      });

      return program;
    } catch (error) {
      this.emit({
        type: 'compilation_error',
        segmentId: segment.id,
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * Hot-patch a parameter in an existing program
   * Returns true if patching succeeded, false if recompilation needed
   */
  hotPatch(
    program: CompiledProgram,
    nodeId: string,
    param: string,
    value: unknown
  ): boolean {
    const opIndex = program.nodeToOperationIndex.get(nodeId);
    if (opIndex === undefined) {
      // Node not in this program, or was fused away
      return false;
    }

    const op = program.operations[opIndex];
    if (!op) return false;

    // Try to patch based on operation type
    switch (op.type) {
      case 'gain': {
        if (param === 'gain' || param === 'value') {
          (op.params as GainParams).value = value as number;
          this.emit({
            type: 'parameter_patched',
            segmentId: program.segmentId,
            nodeId,
            param,
          });
          return true;
        }
        break;
      }

      case 'delay': {
        const delayParams = op.params as DelayParams;
        if (param === 'time' || param === 'delayTime') {
          delayParams.delayTime = value as number;
          this.emit({
            type: 'parameter_patched',
            segmentId: program.segmentId,
            nodeId,
            param,
          });
          return true;
        }
        if (param === 'feedback') {
          delayParams.feedback = value as number;
          this.emit({
            type: 'parameter_patched',
            segmentId: program.segmentId,
            nodeId,
            param,
          });
          return true;
        }
        if (param === 'wet') {
          delayParams.wet = value as number;
          this.emit({
            type: 'parameter_patched',
            segmentId: program.segmentId,
            nodeId,
            param,
          });
          return true;
        }
        break;
      }

      case 'biquad_cascade': {
        // Filter parameters require coefficient recalculation
        // Could be optimized, but for now return false to trigger recompile
        return false;
      }

      case 'waveshaper': {
        // Distortion amount requires new curve
        // Could cache curves for common amounts
        return false;
      }

      case 'convolution': {
        // Changing IR requires reload
        return false;
      }
    }

    return false;
  }

  /**
   * Get a version number for a node (for dirty tracking)
   */
  private getNodeVersion(node: GraphNode): number {
    // Use a hash of the node's data as version
    // In a real implementation, nodes would have explicit version numbers
    const dataStr = JSON.stringify(node.data);
    let hash = 0;
    for (let i = 0; i < dataStr.length; i++) {
      const char = dataStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Generate cache key for waveshaper curve
   */
  private getCurveCacheKey(params: WaveshaperParams): string {
    // Use first few values of curve as key
    const samples = Array.from(params.curve.slice(0, 10));
    return `curve:${samples.join(',')}`;
  }

  /**
   * Check if operations can run in parallel across channels
   */
  private canRunParallel(operations: CompiledOperation[]): boolean {
    // Most operations are channel-independent
    // Only operations with cross-channel effects can't run parallel
    for (const op of operations) {
      if (op.type === 'convolution') {
        // Convolution with stereo IR has cross-channel dependencies
        // For simplicity, assume it can still run parallel per-channel
      }
    }
    return true;
  }

  /**
   * Estimate CPU cost per sample for load balancing
   */
  private estimateCost(operations: CompiledOperation[]): number {
    let cost = 0;

    for (const op of operations) {
      switch (op.type) {
        case 'gain':
          cost += 1; // Single multiply
          break;
        case 'biquad_cascade': {
          const params = op.params as BiquadCascadeParams;
          cost += params.filters.length * 5; // 5 multiplies per biquad stage
          break;
        }
        case 'waveshaper':
          cost += 3; // Lookup + interpolation
          break;
        case 'convolution':
          cost += 100; // FFT-based convolution is expensive
          break;
        case 'delay':
          cost += 5; // Buffer access + feedback
          break;
        case 'passthrough':
          cost += 0;
          break;
      }
    }

    return cost;
  }
}

// ============================================================================
// Batch Compilation
// ============================================================================

/**
 * Compile multiple segments in parallel
 */
export async function batchCompile(
  segments: Segment[],
  nodes: Map<string, GraphNode>,
  connections: Map<string, Connection>
): Promise<Map<string, CompiledProgram>> {
  const compiler = new PipelineCompiler(nodes, connections);
  const results = new Map<string, CompiledProgram>();

  // For now, compile sequentially
  // TODO: Use Web Workers for true parallelism
  for (const segment of segments) {
    try {
      const program = compiler.compile(segment);
      results.set(segment.id, program);
    } catch (error) {
      console.error(`Failed to compile segment ${segment.id}:`, error);
    }
  }

  return results;
}

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Generate debug output for a compiled program
 */
export function debugCompiledProgram(program: CompiledProgram): string {
  const lines: string[] = ['=== Compiled Program ==='];

  lines.push(`ID: ${program.id}`);
  lines.push(`Segment: ${program.segmentId}`);
  lines.push(`Version: ${program.version}`);
  lines.push(`Operations: ${program.operations.length}`);
  lines.push(`Can run parallel: ${program.canRunParallel}`);
  lines.push(`Estimated cost/sample: ${program.estimatedCostPerSample}`);

  lines.push('\nOperations:');
  for (let i = 0; i < program.operations.length; i++) {
    const op = program.operations[i];
    lines.push(`  ${i}: ${debugOperation(op)}`);
  }

  if (program.lookupTables.size > 0) {
    lines.push(`\nLookup tables: ${program.lookupTables.size}`);
  }

  if (program.impulseResponseIds.length > 0) {
    lines.push(`\nImpulse responses: ${program.impulseResponseIds.join(', ')}`);
  }

  return lines.join('\n');
}
