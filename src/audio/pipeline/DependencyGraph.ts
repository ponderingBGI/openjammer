/**
 * OpenJammer - Dependency Graph and Execution Planning
 *
 * Builds execution plans from segment dependencies to enable parallel execution.
 * Segments with no dependencies can run in parallel (same wave).
 * Segments depending on earlier waves must wait.
 */

import type {
  Segment,
  DependencyGraph,
  DependencyEdge,
  ExecutionPlan,
} from './types';

// ============================================================================
// Execution Plan Builder
// ============================================================================

/**
 * Build an execution plan from a dependency graph
 * Uses topological sorting to determine execution order
 *
 * @param segments - All segments to schedule
 * @returns ExecutionPlan with segments grouped into parallel waves
 */
export function buildExecutionPlan(segments: Segment[]): ExecutionPlan {
  if (segments.length === 0) {
    return {
      waves: [],
      totalSegments: 0,
      maxParallelism: 0,
    };
  }

  // Build in-degree map (count of dependencies)
  const inDegree = new Map<string, number>();
  const segmentMap = new Map<string, Segment>();

  for (const segment of segments) {
    inDegree.set(segment.id, segment.dependsOn.length);
    segmentMap.set(segment.id, segment);
  }

  const waves: string[][] = [];
  const scheduled = new Set<string>();

  // Keep building waves until all segments are scheduled
  while (scheduled.size < segments.length) {
    const wave: string[] = [];

    // Find all segments with in-degree 0 (no unscheduled dependencies)
    for (const segment of segments) {
      if (scheduled.has(segment.id)) continue;

      // Check if all dependencies are scheduled
      const allDepsScheduled = segment.dependsOn.every((depId) =>
        scheduled.has(depId)
      );

      if (allDepsScheduled) {
        wave.push(segment.id);
      }
    }

    // If no segments can be scheduled, we have a cycle
    if (wave.length === 0) {
      // Find remaining unscheduled segments
      const remaining = segments
        .filter((s) => !scheduled.has(s.id))
        .map((s) => s.id);

      console.warn(
        'Cycle detected in segment dependencies. Forcing remaining segments:',
        remaining
      );

      // Force schedule one to break the cycle
      if (remaining.length > 0) {
        wave.push(remaining[0]);
      } else {
        break; // Safety: prevent infinite loop
      }
    }

    // Add wave to plan
    waves.push(wave);

    // Mark segments as scheduled
    for (const segmentId of wave) {
      scheduled.add(segmentId);
    }
  }

  // Calculate max parallelism (largest wave)
  const maxParallelism = Math.max(...waves.map((w) => w.length), 0);

  return {
    waves,
    totalSegments: segments.length,
    maxParallelism,
  };
}

/**
 * Update execution plan after segment changes
 * More efficient than full rebuild for small changes
 */
export function updateExecutionPlan(
  existingPlan: ExecutionPlan,
  changedSegmentIds: string[],
  segments: Segment[]
): ExecutionPlan {
  // For now, just rebuild the entire plan
  // TODO: Implement incremental update for better performance
  return buildExecutionPlan(segments);
}

// ============================================================================
// Dependency Analysis
// ============================================================================

/**
 * Get all segments that must complete before a given segment
 * (transitive dependencies)
 */
export function getUpstreamSegments(
  segmentId: string,
  segments: Segment[]
): string[] {
  const upstream: string[] = [];
  const visited = new Set<string>();
  const segmentMap = new Map(segments.map((s) => [s.id, s]));

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const segment = segmentMap.get(id);
    if (!segment) return;

    for (const depId of segment.dependsOn) {
      upstream.push(depId);
      visit(depId);
    }
  }

  visit(segmentId);
  return upstream;
}

/**
 * Get all segments that depend on a given segment
 * (transitive dependents)
 */
export function getDownstreamSegments(
  segmentId: string,
  segments: Segment[]
): string[] {
  const downstream: string[] = [];
  const visited = new Set<string>();
  const segmentMap = new Map(segments.map((s) => [s.id, s]));

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const segment = segmentMap.get(id);
    if (!segment) return;

    for (const depId of segment.dependedBy) {
      downstream.push(depId);
      visit(depId);
    }
  }

  visit(segmentId);
  return downstream;
}

/**
 * Find the critical path through the dependency graph
 * (longest chain of dependencies)
 */
export function findCriticalPath(segments: Segment[]): string[] {
  if (segments.length === 0) return [];

  const segmentMap = new Map(segments.map((s) => [s.id, s]));

  // Find segments with no dependencies (starting points)
  const startSegments = segments.filter((s) => s.dependsOn.length === 0);

  if (startSegments.length === 0) {
    // All segments have dependencies - likely a cycle
    return [];
  }

  // DFS to find longest path
  const memo = new Map<string, string[]>();

  function longestPathFrom(segmentId: string): string[] {
    if (memo.has(segmentId)) {
      return memo.get(segmentId)!;
    }

    const segment = segmentMap.get(segmentId);
    if (!segment) {
      return [segmentId];
    }

    let longestChild: string[] = [];

    for (const depId of segment.dependedBy) {
      const childPath = longestPathFrom(depId);
      if (childPath.length > longestChild.length) {
        longestChild = childPath;
      }
    }

    const result = [segmentId, ...longestChild];
    memo.set(segmentId, result);
    return result;
  }

  // Find longest path from any start segment
  let criticalPath: string[] = [];

  for (const start of startSegments) {
    const path = longestPathFrom(start.id);
    if (path.length > criticalPath.length) {
      criticalPath = path;
    }
  }

  return criticalPath;
}

/**
 * Calculate the depth of each segment in the dependency graph
 * (minimum waves from any source)
 */
export function calculateSegmentDepths(
  segments: Segment[]
): Map<string, number> {
  const depths = new Map<string, number>();
  const segmentMap = new Map(segments.map((s) => [s.id, s]));

  // Initialize sources with depth 0
  for (const segment of segments) {
    if (segment.dependsOn.length === 0) {
      depths.set(segment.id, 0);
    }
  }

  // Propagate depths using BFS
  const queue = segments.filter((s) => s.dependsOn.length === 0).map((s) => s.id);
  const visited = new Set(queue);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDepth = depths.get(currentId) ?? 0;

    const segment = segmentMap.get(currentId);
    if (!segment) continue;

    for (const depId of segment.dependedBy) {
      const existingDepth = depths.get(depId);
      const newDepth = currentDepth + 1;

      // Take the maximum depth (from all dependencies)
      if (existingDepth === undefined || newDepth > existingDepth) {
        depths.set(depId, newDepth);
      }

      if (!visited.has(depId)) {
        visited.add(depId);
        queue.push(depId);
      }
    }
  }

  return depths;
}

// ============================================================================
// Parallel Execution Helpers
// ============================================================================

/**
 * Get segments that can execute in parallel with a given segment
 * (same wave, no dependencies between them)
 */
export function getParallelSegments(
  segmentId: string,
  plan: ExecutionPlan
): string[] {
  for (const wave of plan.waves) {
    if (wave.includes(segmentId)) {
      return wave.filter((id) => id !== segmentId);
    }
  }
  return [];
}

/**
 * Estimate total execution time given segment costs
 * Assumes perfect parallelism within waves
 */
export function estimateExecutionTime(
  plan: ExecutionPlan,
  segmentCosts: Map<string, number>
): number {
  let totalTime = 0;

  for (const wave of plan.waves) {
    // Wave time is the maximum cost in the wave (parallel execution)
    let maxCost = 0;
    for (const segmentId of wave) {
      const cost = segmentCosts.get(segmentId) ?? 0;
      if (cost > maxCost) {
        maxCost = cost;
      }
    }
    totalTime += maxCost;
  }

  return totalTime;
}

/**
 * Balance wave assignments to minimize total execution time
 * (move segments to earlier waves if dependencies allow)
 */
export function optimizeExecutionPlan(
  plan: ExecutionPlan,
  segments: Segment[],
  segmentCosts: Map<string, number>
): ExecutionPlan {
  // For now, return the original plan
  // TODO: Implement load balancing optimization

  // Potential optimizations:
  // 1. Move cheap segments to waves with expensive segments
  // 2. Split large waves to stay within worker count
  // 3. Merge adjacent waves if parallelism allows

  return plan;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that an execution plan is correct
 */
export function validateExecutionPlan(
  plan: ExecutionPlan,
  segments: Segment[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const segmentMap = new Map(segments.map((s) => [s.id, s]));
  const scheduledBefore = new Set<string>();

  // Check each wave
  for (let waveIndex = 0; waveIndex < plan.waves.length; waveIndex++) {
    const wave = plan.waves[waveIndex];

    for (const segmentId of wave) {
      const segment = segmentMap.get(segmentId);

      if (!segment) {
        errors.push(`Wave ${waveIndex}: Unknown segment ${segmentId}`);
        continue;
      }

      // Check all dependencies are in earlier waves
      for (const depId of segment.dependsOn) {
        if (!scheduledBefore.has(depId)) {
          errors.push(
            `Wave ${waveIndex}: Segment ${segmentId} depends on ${depId} which is not in an earlier wave`
          );
        }
      }
    }

    // Mark this wave's segments as scheduled
    for (const segmentId of wave) {
      scheduledBefore.add(segmentId);
    }
  }

  // Check all segments are scheduled
  for (const segment of segments) {
    if (!scheduledBefore.has(segment.id)) {
      errors.push(`Segment ${segment.id} is not scheduled in any wave`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Generate a debug visualization of the execution plan
 */
export function debugExecutionPlan(
  plan: ExecutionPlan,
  segments: Segment[]
): string {
  const segmentMap = new Map(segments.map((s) => [s.id, s]));
  const lines: string[] = ['=== Execution Plan ==='];

  lines.push(`Total segments: ${plan.totalSegments}`);
  lines.push(`Max parallelism: ${plan.maxParallelism}`);
  lines.push(`Total waves: ${plan.waves.length}`);

  for (let i = 0; i < plan.waves.length; i++) {
    const wave = plan.waves[i];
    lines.push(`\nWave ${i} (${wave.length} segments):`);

    for (const segmentId of wave) {
      const segment = segmentMap.get(segmentId);
      if (segment) {
        const shortId = segmentId.slice(0, 12);
        lines.push(`  [${segment.type}] ${shortId}... (${segment.nodeIds.length} nodes)`);
      } else {
        lines.push(`  [?] ${segmentId} (not found)`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate a DOT graph representation for visualization
 */
export function toDotGraph(segments: Segment[]): string {
  const lines: string[] = ['digraph ExecutionGraph {'];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box];');

  // Add nodes
  for (const segment of segments) {
    const shortId = segment.id.slice(4, 12); // Remove 'seg_' prefix
    const label = `${segment.type}\\n${shortId}\\n(${segment.nodeIds.length} nodes)`;
    const color = getSegmentColor(segment.type);
    lines.push(`  "${segment.id}" [label="${label}", fillcolor="${color}", style=filled];`);
  }

  // Add edges
  for (const segment of segments) {
    for (const depId of segment.dependedBy) {
      lines.push(`  "${segment.id}" -> "${depId}";`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function getSegmentColor(type: string): string {
  switch (type) {
    case 'DYNAMIC':
      return '#ffcccc'; // Light red
    case 'STATEFUL':
      return '#ffffcc'; // Light yellow
    case 'STATIC':
      return '#ccffcc'; // Light green
    case 'MERGE':
      return '#ccccff'; // Light blue
    case 'OUTPUT':
      return '#ffccff'; // Light purple
    default:
      return '#cccccc'; // Light gray
  }
}
