/**
 * OpenJammer - Segment Detection Engine
 *
 * Detects and classifies segments in the audio graph for compilation.
 * A segment is a contiguous chain of nodes that can be compiled together.
 *
 * Segment boundaries occur at:
 * - Dynamic sources (microphone, live MIDI)
 * - Branch points (one node feeds multiple destinations)
 * - Merge points (multiple sources feed one node)
 * - State-changing nodes (looper in record mode)
 */

import type { GraphNode, Connection, NodeType } from '../../engine/types';
import type {
  Segment,
  SegmentType,
  SegmentationResult,
  SegmentationWarning,
  DependencyGraph,
  DependencyEdge,
} from './types';
import {
  DYNAMIC_SOURCE_TYPES,
  STATEFUL_NODE_TYPES,
  STATIC_SOURCE_TYPES,
  PROCESSING_NODE_TYPES,
  MERGE_NODE_TYPES,
  OUTPUT_NODE_TYPES,
  INSTRUMENT_NODE_TYPES,
} from './types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique segment ID
 */
function generateSegmentId(): string {
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Classify a node's segment type based on its NodeType
 */
export function classifyNodeType(nodeType: NodeType): SegmentType {
  if (DYNAMIC_SOURCE_TYPES.includes(nodeType)) {
    return 'DYNAMIC';
  }
  if (STATEFUL_NODE_TYPES.includes(nodeType)) {
    return 'STATEFUL';
  }
  if (MERGE_NODE_TYPES.includes(nodeType)) {
    return 'MERGE';
  }
  if (OUTPUT_NODE_TYPES.includes(nodeType)) {
    return 'OUTPUT';
  }
  // Processing nodes and static sources are STATIC
  return 'STATIC';
}

/**
 * Check if a node is a source (no audio inputs expected)
 */
export function isSourceNode(nodeType: NodeType): boolean {
  return (
    DYNAMIC_SOURCE_TYPES.includes(nodeType) ||
    STATIC_SOURCE_TYPES.includes(nodeType) ||
    STATEFUL_NODE_TYPES.includes(nodeType) ||
    INSTRUMENT_NODE_TYPES.includes(nodeType)
  );
}

/**
 * Check if a node is a terminal (no audio outputs expected)
 */
export function isTerminalNode(nodeType: NodeType): boolean {
  return OUTPUT_NODE_TYPES.includes(nodeType);
}

/**
 * Check if a node can be fused with adjacent processing nodes
 */
export function canFuseNode(nodeType: NodeType): boolean {
  return PROCESSING_NODE_TYPES.includes(nodeType);
}

// ============================================================================
// Graph Analysis
// ============================================================================

interface GraphAnalysis {
  /** Map of nodeId → outgoing connections */
  outgoingConnections: Map<string, Connection[]>;

  /** Map of nodeId → incoming connections */
  incomingConnections: Map<string, Connection[]>;

  /** Count of outgoing audio connections per node */
  outgoingAudioCount: Map<string, number>;

  /** Count of incoming audio connections per node */
  incomingAudioCount: Map<string, number>;

  /** Nodes with no incoming audio connections (potential segment starts) */
  sourceNodeIds: Set<string>;

  /** Nodes with no outgoing audio connections (potential segment ends) */
  terminalNodeIds: Set<string>;

  /** Nodes that are branch points (multiple outgoing audio connections) */
  branchNodeIds: Set<string>;

  /** Nodes that are merge points (multiple incoming audio connections) */
  mergeNodeIds: Set<string>;
}

/**
 * Analyze the graph structure for segmentation
 */
function analyzeGraph(
  nodes: Map<string, GraphNode>,
  connections: Map<string, Connection>
): GraphAnalysis {
  const outgoingConnections = new Map<string, Connection[]>();
  const incomingConnections = new Map<string, Connection[]>();
  const outgoingAudioCount = new Map<string, number>();
  const incomingAudioCount = new Map<string, number>();

  // Initialize maps for all nodes
  for (const nodeId of nodes.keys()) {
    outgoingConnections.set(nodeId, []);
    incomingConnections.set(nodeId, []);
    outgoingAudioCount.set(nodeId, 0);
    incomingAudioCount.set(nodeId, 0);
  }

  // Process all connections
  for (const conn of connections.values()) {
    // Skip non-audio connections for segmentation purposes
    if (conn.type !== 'audio') continue;

    // Add to outgoing
    const outgoing = outgoingConnections.get(conn.sourceNodeId);
    if (outgoing) {
      outgoing.push(conn);
      outgoingAudioCount.set(
        conn.sourceNodeId,
        (outgoingAudioCount.get(conn.sourceNodeId) ?? 0) + 1
      );
    }

    // Add to incoming
    const incoming = incomingConnections.get(conn.targetNodeId);
    if (incoming) {
      incoming.push(conn);
      incomingAudioCount.set(
        conn.targetNodeId,
        (incomingAudioCount.get(conn.targetNodeId) ?? 0) + 1
      );
    }
  }

  // Identify special nodes
  const sourceNodeIds = new Set<string>();
  const terminalNodeIds = new Set<string>();
  const branchNodeIds = new Set<string>();
  const mergeNodeIds = new Set<string>();

  for (const [nodeId, node] of nodes) {
    const outCount = outgoingAudioCount.get(nodeId) ?? 0;
    const inCount = incomingAudioCount.get(nodeId) ?? 0;

    // Source: no incoming audio OR is a source type
    if (inCount === 0 || isSourceNode(node.type)) {
      sourceNodeIds.add(nodeId);
    }

    // Terminal: no outgoing audio OR is terminal type
    if (outCount === 0 || isTerminalNode(node.type)) {
      terminalNodeIds.add(nodeId);
    }

    // Branch: multiple outgoing
    if (outCount > 1) {
      branchNodeIds.add(nodeId);
    }

    // Merge: multiple incoming
    if (inCount > 1) {
      mergeNodeIds.add(nodeId);
    }
  }

  return {
    outgoingConnections,
    incomingConnections,
    outgoingAudioCount,
    incomingAudioCount,
    sourceNodeIds,
    terminalNodeIds,
    branchNodeIds,
    mergeNodeIds,
  };
}

// ============================================================================
// Segment Detection
// ============================================================================

/**
 * Trace a linear segment from a starting node
 * Stops at branch points, merge points, or terminals
 */
function traceSegment(
  startNodeId: string,
  nodes: Map<string, GraphNode>,
  analysis: GraphAnalysis,
  assignedNodes: Set<string>
): string[] {
  const chain: string[] = [];
  let currentId: string | null = startNodeId;

  while (currentId !== null) {
    // Skip if already assigned to another segment
    if (assignedNodes.has(currentId)) {
      break;
    }

    const node = nodes.get(currentId);
    if (!node) break;

    chain.push(currentId);
    assignedNodes.add(currentId);

    // Stop conditions:
    // 1. Terminal node (speaker, etc.)
    if (isTerminalNode(node.type)) {
      break;
    }

    // 2. Branch point (multiple outputs)
    if (analysis.branchNodeIds.has(currentId)) {
      break;
    }

    // 3. Find next node
    const outgoing = analysis.outgoingConnections.get(currentId) ?? [];
    if (outgoing.length !== 1) {
      // No outgoing or multiple outgoing (branch) - stop here
      break;
    }

    const nextId = outgoing[0].targetNodeId;
    const nextNode = nodes.get(nextId);
    if (!nextNode) break;

    // 4. Next node is a merge point - stop BEFORE it
    if (analysis.mergeNodeIds.has(nextId)) {
      break;
    }

    // 5. Next node is already assigned
    if (assignedNodes.has(nextId)) {
      break;
    }

    // Continue to next node
    currentId = nextId;
  }

  return chain;
}

/**
 * Determine the segment type based on its nodes
 */
function determineSegmentType(
  nodeIds: string[],
  nodes: Map<string, GraphNode>,
  analysis: GraphAnalysis
): SegmentType {
  if (nodeIds.length === 0) {
    return 'STATIC';
  }

  const firstNode = nodes.get(nodeIds[0]);
  const lastNode = nodes.get(nodeIds[nodeIds.length - 1]);

  if (!firstNode || !lastNode) {
    return 'STATIC';
  }

  // Check first node for source classification
  if (DYNAMIC_SOURCE_TYPES.includes(firstNode.type)) {
    return 'DYNAMIC';
  }

  if (STATEFUL_NODE_TYPES.includes(firstNode.type)) {
    return 'STATEFUL';
  }

  // Check if this is a merge segment
  if (analysis.mergeNodeIds.has(nodeIds[0])) {
    return 'MERGE';
  }

  // Check if this ends at an output
  if (OUTPUT_NODE_TYPES.includes(lastNode.type)) {
    // If it's ONLY a speaker, it's OUTPUT type
    if (nodeIds.length === 1) {
      return 'OUTPUT';
    }
  }

  // Default to STATIC (can be fully compiled)
  return 'STATIC';
}

/**
 * Detect all segments in a graph
 */
export function detectSegments(
  nodes: Map<string, GraphNode>,
  connections: Map<string, Connection>
): SegmentationResult {
  const analysis = analyzeGraph(nodes, connections);
  const segments: Segment[] = [];
  const warnings: SegmentationWarning[] = [];
  const assignedNodes = new Set<string>();

  // Phase 1: Start segments from source nodes
  for (const sourceId of analysis.sourceNodeIds) {
    if (assignedNodes.has(sourceId)) continue;

    const chain = traceSegment(sourceId, nodes, analysis, assignedNodes);
    if (chain.length > 0) {
      const segmentType = determineSegmentType(chain, nodes, analysis);
      segments.push({
        id: generateSegmentId(),
        type: segmentType,
        nodeIds: chain,
        dependsOn: [],
        dependedBy: [],
        isCompiled: false,
        version: 0,
        nodeVersions: new Map(),
      });
    }
  }

  // Phase 2: Handle merge nodes (they start new segments)
  for (const mergeId of analysis.mergeNodeIds) {
    if (assignedNodes.has(mergeId)) continue;

    const chain = traceSegment(mergeId, nodes, analysis, assignedNodes);
    if (chain.length > 0) {
      const segmentType = determineSegmentType(chain, nodes, analysis);
      segments.push({
        id: generateSegmentId(),
        type: segmentType,
        nodeIds: chain,
        dependsOn: [],
        dependedBy: [],
        isCompiled: false,
        version: 0,
        nodeVersions: new Map(),
      });
    }
  }

  // Phase 3: Handle any remaining unassigned nodes
  // (could be from branches we haven't followed yet)
  for (const nodeId of nodes.keys()) {
    if (assignedNodes.has(nodeId)) continue;

    const node = nodes.get(nodeId)!;

    // Skip internal/visual nodes
    if (
      node.type.includes('visual') ||
      node.type === 'canvas-input' ||
      node.type === 'canvas-output' ||
      node.type === 'container'
    ) {
      assignedNodes.add(nodeId);
      continue;
    }

    const chain = traceSegment(nodeId, nodes, analysis, assignedNodes);
    if (chain.length > 0) {
      const segmentType = determineSegmentType(chain, nodes, analysis);
      segments.push({
        id: generateSegmentId(),
        type: segmentType,
        nodeIds: chain,
        dependsOn: [],
        dependedBy: [],
        isCompiled: false,
        version: 0,
        nodeVersions: new Map(),
      });
    }
  }

  // Phase 4: Build dependencies between segments
  const nodeToSegment = new Map<string, string>();
  for (const segment of segments) {
    for (const nodeId of segment.nodeIds) {
      nodeToSegment.set(nodeId, segment.id);
    }
  }

  const edges: DependencyEdge[] = [];

  for (const conn of connections.values()) {
    if (conn.type !== 'audio') continue;

    const sourceSegmentId = nodeToSegment.get(conn.sourceNodeId);
    const targetSegmentId = nodeToSegment.get(conn.targetNodeId);

    // If connection crosses segment boundary, create dependency
    if (
      sourceSegmentId &&
      targetSegmentId &&
      sourceSegmentId !== targetSegmentId
    ) {
      edges.push({
        from: sourceSegmentId,
        to: targetSegmentId,
        connectionId: conn.id,
      });

      // Update segment dependency lists
      const sourceSegment = segments.find((s) => s.id === sourceSegmentId);
      const targetSegment = segments.find((s) => s.id === targetSegmentId);

      if (sourceSegment && !sourceSegment.dependedBy.includes(targetSegmentId)) {
        sourceSegment.dependedBy.push(targetSegmentId);
      }
      if (targetSegment && !targetSegment.dependsOn.includes(sourceSegmentId)) {
        targetSegment.dependsOn.push(sourceSegmentId);
      }
    }
  }

  // Identify unassigned nodes
  const unassignedNodeIds: string[] = [];
  for (const nodeId of nodes.keys()) {
    if (!assignedNodes.has(nodeId)) {
      const node = nodes.get(nodeId)!;
      // Don't warn about internal/visual nodes
      if (
        !node.type.includes('visual') &&
        node.type !== 'canvas-input' &&
        node.type !== 'canvas-output' &&
        node.type !== 'container'
      ) {
        unassignedNodeIds.push(nodeId);
        warnings.push({
          type: 'orphan_node',
          message: `Node ${nodeId} (${node.type}) could not be assigned to a segment`,
          nodeIds: [nodeId],
        });
      }
    }
  }

  // Build dependency graph
  const segmentMap = new Map<string, Segment>();
  for (const segment of segments) {
    segmentMap.set(segment.id, segment);
  }

  const dependencyGraph: DependencyGraph = {
    segments: segmentMap,
    edges,
    executionPlan: null, // Computed separately
  };

  return {
    segments,
    dependencyGraph,
    unassignedNodeIds,
    warnings,
  };
}

// ============================================================================
// Cycle Detection
// ============================================================================

/**
 * Detect cycles in the segment dependency graph
 * Uses Kahn's algorithm (topological sort)
 */
export function detectCycles(segments: Segment[]): string[][] {
  const cycles: string[][] = [];

  // Build in-degree map
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const segment of segments) {
    inDegree.set(segment.id, segment.dependsOn.length);
    adjacency.set(segment.id, [...segment.dependedBy]);
  }

  // Find all nodes with in-degree 0
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  // Process queue
  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If not all nodes were sorted, there's a cycle
  if (sorted.length < segments.length) {
    // Find nodes not in sorted list (they're in cycles)
    const sortedSet = new Set(sorted);
    const cycleNodes = segments
      .filter((s) => !sortedSet.has(s.id))
      .map((s) => s.id);

    if (cycleNodes.length > 0) {
      cycles.push(cycleNodes);
    }
  }

  return cycles;
}

// ============================================================================
// Incremental Update
// ============================================================================

/**
 * Check if a segment needs recompilation based on node versions
 */
export function isSegmentDirty(
  segment: Segment,
  currentNodeVersions: Map<string, number>
): boolean {
  for (const nodeId of segment.nodeIds) {
    const compiledVersion = segment.nodeVersions.get(nodeId) ?? -1;
    const currentVersion = currentNodeVersions.get(nodeId) ?? 0;

    if (currentVersion > compiledVersion) {
      return true;
    }
  }
  return false;
}

/**
 * Find segments affected by a node change
 */
export function findAffectedSegments(
  nodeId: string,
  segments: Segment[]
): Segment[] {
  const affected: Segment[] = [];
  const affectedIds = new Set<string>();

  // Find segment containing the changed node
  for (const segment of segments) {
    if (segment.nodeIds.includes(nodeId)) {
      affected.push(segment);
      affectedIds.add(segment.id);

      // Also mark all downstream segments as affected
      const queue = [...segment.dependedBy];
      while (queue.length > 0) {
        const depId = queue.shift()!;
        if (affectedIds.has(depId)) continue;

        const depSegment = segments.find((s) => s.id === depId);
        if (depSegment) {
          affected.push(depSegment);
          affectedIds.add(depId);
          queue.push(...depSegment.dependedBy);
        }
      }
      break;
    }
  }

  return affected;
}

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Generate a debug summary of segmentation result
 */
export function debugSegmentationResult(result: SegmentationResult): string {
  const lines: string[] = ['=== Segmentation Result ==='];

  lines.push(`\nTotal segments: ${result.segments.length}`);

  for (const segment of result.segments) {
    lines.push(`\n[${segment.type}] ${segment.id}`);
    lines.push(`  Nodes: ${segment.nodeIds.join(' → ')}`);
    if (segment.dependsOn.length > 0) {
      lines.push(`  Depends on: ${segment.dependsOn.join(', ')}`);
    }
    if (segment.dependedBy.length > 0) {
      lines.push(`  Depended by: ${segment.dependedBy.join(', ')}`);
    }
  }

  if (result.unassignedNodeIds.length > 0) {
    lines.push(`\nUnassigned nodes: ${result.unassignedNodeIds.join(', ')}`);
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarnings:');
    for (const warning of result.warnings) {
      lines.push(`  [${warning.type}] ${warning.message}`);
    }
  }

  return lines.join('\n');
}
