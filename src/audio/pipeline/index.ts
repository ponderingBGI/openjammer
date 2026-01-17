/**
 * OpenJammer - Pipeline Compilation System
 *
 * This module provides the core pipeline compilation infrastructure for
 * optimizing audio processing graphs.
 *
 * Key concepts:
 * - Segments: Contiguous chains of nodes that can be compiled together
 * - Compilation: Fusing operations into optimized programs
 * - Execution Plans: Parallel execution scheduling based on dependencies
 */

// Types
export * from './types';

// Segment Detection
export {
  detectSegments,
  classifyNodeType,
  isSourceNode,
  isTerminalNode,
  canFuseNode,
  detectCycles,
  isSegmentDirty,
  findAffectedSegments,
  debugSegmentationResult,
} from './SegmentDetector';

// Dependency Graph & Execution Planning
export {
  buildExecutionPlan,
  updateExecutionPlan,
  getUpstreamSegments,
  getDownstreamSegments,
  findCriticalPath,
  calculateSegmentDepths,
  getParallelSegments,
  estimateExecutionTime,
  optimizeExecutionPlan,
  validateExecutionPlan,
  debugExecutionPlan,
  toDotGraph,
} from './DependencyGraph';
