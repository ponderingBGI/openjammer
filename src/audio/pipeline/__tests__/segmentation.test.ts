/**
 * Unit tests for Pipeline Segmentation
 */

import { describe, it, expect } from 'vitest';
import type { GraphNode, Connection } from '../../../engine/types';
import {
  detectSegments,
  classifyNodeType,
  isSourceNode,
  isTerminalNode,
  canFuseNode,
  detectCycles,
  isSegmentDirty,
  findAffectedSegments,
} from '../SegmentDetector';
import {
  buildExecutionPlan,
  getUpstreamSegments,
  findCriticalPath,
  validateExecutionPlan,
} from '../DependencyGraph';

// ============================================================================
// Test Helpers
// ============================================================================

function createNode(
  id: string,
  type: GraphNode['type'],
  category: GraphNode['category'] = 'effects'
): GraphNode {
  return {
    id,
    type,
    category,
    position: { x: 0, y: 0 },
    data: {},
    ports: [],
    parentId: null,
    childIds: [],
  };
}

function createConnection(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  type: Connection['type'] = 'audio'
): Connection {
  return {
    id,
    sourceNodeId,
    sourcePortId: 'output',
    targetNodeId,
    targetPortId: 'input',
    type,
  };
}

function createNodesMap(nodes: GraphNode[]): Map<string, GraphNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function createConnectionsMap(connections: Connection[]): Map<string, Connection> {
  return new Map(connections.map((c) => [c.id, c]));
}

// ============================================================================
// Node Classification Tests
// ============================================================================

describe('Node Classification', () => {
  describe('classifyNodeType', () => {
    it('should classify microphone as DYNAMIC', () => {
      expect(classifyNodeType('microphone')).toBe('DYNAMIC');
    });

    it('should classify midi as DYNAMIC', () => {
      expect(classifyNodeType('midi')).toBe('DYNAMIC');
    });

    it('should classify looper as STATEFUL', () => {
      expect(classifyNodeType('looper')).toBe('STATEFUL');
    });

    it('should classify effect as STATIC', () => {
      expect(classifyNodeType('effect')).toBe('STATIC');
    });

    it('should classify amplifier as STATIC', () => {
      expect(classifyNodeType('amplifier')).toBe('STATIC');
    });

    it('should classify add as MERGE', () => {
      expect(classifyNodeType('add')).toBe('MERGE');
    });

    it('should classify speaker as OUTPUT', () => {
      expect(classifyNodeType('speaker')).toBe('OUTPUT');
    });
  });

  describe('isSourceNode', () => {
    it('should return true for microphone', () => {
      expect(isSourceNode('microphone')).toBe(true);
    });

    it('should return true for looper', () => {
      expect(isSourceNode('looper')).toBe(true);
    });

    it('should return true for library', () => {
      expect(isSourceNode('library')).toBe(true);
    });

    it('should return false for effect', () => {
      expect(isSourceNode('effect')).toBe(false);
    });

    it('should return false for speaker', () => {
      expect(isSourceNode('speaker')).toBe(false);
    });
  });

  describe('isTerminalNode', () => {
    it('should return true for speaker', () => {
      expect(isTerminalNode('speaker')).toBe(true);
    });

    it('should return false for effect', () => {
      expect(isTerminalNode('effect')).toBe(false);
    });
  });

  describe('canFuseNode', () => {
    it('should return true for effect', () => {
      expect(canFuseNode('effect')).toBe(true);
    });

    it('should return true for amplifier', () => {
      expect(canFuseNode('amplifier')).toBe(true);
    });

    it('should return false for looper', () => {
      expect(canFuseNode('looper')).toBe(false);
    });
  });
});

// ============================================================================
// Segment Detection Tests
// ============================================================================

describe('Segment Detection', () => {
  describe('simple linear chain', () => {
    it('should detect a simple source → effect → speaker chain', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'effect1'),
        createConnection('c2', 'effect1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].nodeIds).toEqual(['looper1', 'effect1', 'speaker1']);
      expect(result.segments[0].type).toBe('STATEFUL');
      expect(result.warnings.length).toBe(0);
    });

    it('should detect multiple effect nodes in chain', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('effect2', 'effect', 'effects'),
        createNode('effect3', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'effect1'),
        createConnection('c2', 'effect1', 'effect2'),
        createConnection('c3', 'effect2', 'effect3'),
        createConnection('c4', 'effect3', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].nodeIds).toEqual([
        'looper1',
        'effect1',
        'effect2',
        'effect3',
        'speaker1',
      ]);
    });
  });

  describe('parallel pipelines', () => {
    it('should detect two independent pipelines', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
        createNode('looper2', 'looper', 'input'),
        createNode('effect2', 'effect', 'effects'),
        createNode('speaker2', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'effect1'),
        createConnection('c2', 'effect1', 'speaker1'),
        createConnection('c3', 'looper2', 'effect2'),
        createConnection('c4', 'effect2', 'speaker2'),
      ]);

      const result = detectSegments(nodes, connections);

      expect(result.segments.length).toBe(2);

      // Both segments should have no dependencies on each other
      for (const segment of result.segments) {
        expect(segment.dependsOn.length).toBe(0);
        expect(segment.dependedBy.length).toBe(0);
      }
    });
  });

  describe('branching', () => {
    it('should split at branch point', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
        createNode('speaker2', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'effect1'),
        createConnection('c2', 'effect1', 'speaker1'),
        createConnection('c3', 'effect1', 'speaker2'),
      ]);

      const result = detectSegments(nodes, connections);

      // Should have 3 segments:
      // 1. looper1 → effect1 (stops at branch)
      // 2. speaker1
      // 3. speaker2
      expect(result.segments.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('merge points', () => {
    it('should create separate segments for merge inputs', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('looper2', 'looper', 'input'),
        createNode('add1', 'add', 'routing'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'add1'),
        createConnection('c2', 'looper2', 'add1'),
        createConnection('c3', 'add1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);

      // Should have at least 3 segments:
      // 1. looper1 (stops before merge)
      // 2. looper2 (stops before merge)
      // 3. add1 → speaker1 (MERGE type)
      expect(result.segments.length).toBeGreaterThanOrEqual(3);

      // Find the merge segment
      const mergeSegment = result.segments.find((s) => s.type === 'MERGE');
      expect(mergeSegment).toBeDefined();
      expect(mergeSegment?.dependsOn.length).toBe(2);
    });
  });

  describe('dynamic sources', () => {
    it('should classify microphone pipeline as DYNAMIC', () => {
      const nodes = createNodesMap([
        createNode('mic1', 'microphone', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'mic1', 'effect1'),
        createConnection('c2', 'effect1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0].type).toBe('DYNAMIC');
    });
  });
});

// ============================================================================
// Dependency Graph Tests
// ============================================================================

describe('Dependency Graph', () => {
  describe('buildExecutionPlan', () => {
    it('should put independent segments in same wave', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('speaker1', 'speaker', 'output'),
        createNode('looper2', 'looper', 'input'),
        createNode('speaker2', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'speaker1'),
        createConnection('c2', 'looper2', 'speaker2'),
      ]);

      const result = detectSegments(nodes, connections);
      const plan = buildExecutionPlan(result.segments);

      // Two independent segments should be in the same wave
      expect(plan.waves.length).toBe(1);
      expect(plan.waves[0].length).toBe(2);
      expect(plan.maxParallelism).toBe(2);
    });

    it('should put dependent segments in sequential waves', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('looper2', 'looper', 'input'),
        createNode('add1', 'add', 'routing'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'add1'),
        createConnection('c2', 'looper2', 'add1'),
        createConnection('c3', 'add1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);
      const plan = buildExecutionPlan(result.segments);

      // Should have 2 waves:
      // Wave 0: looper1, looper2 (parallel)
      // Wave 1: add1 → speaker1 (depends on both)
      expect(plan.waves.length).toBe(2);

      const validation = validateExecutionPlan(plan, result.segments);
      expect(validation.valid).toBe(true);
    });
  });

  describe('findCriticalPath', () => {
    it('should find the longest dependency chain', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('effect2', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'effect1'),
        createConnection('c2', 'effect1', 'effect2'),
        createConnection('c3', 'effect2', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);
      const criticalPath = findCriticalPath(result.segments);

      // Single segment, so critical path is just that segment
      expect(criticalPath.length).toBe(1);
    });
  });

  describe('getUpstreamSegments', () => {
    it('should return all upstream dependencies', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('looper2', 'looper', 'input'),
        createNode('add1', 'add', 'routing'),
        createNode('effect1', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'add1'),
        createConnection('c2', 'looper2', 'add1'),
        createConnection('c3', 'add1', 'effect1'),
        createConnection('c4', 'effect1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);

      // Find the merge segment
      const mergeSegment = result.segments.find((s) => s.type === 'MERGE');
      expect(mergeSegment).toBeDefined();

      if (mergeSegment) {
        const upstream = getUpstreamSegments(mergeSegment.id, result.segments);
        // Should include both looper segments
        expect(upstream.length).toBe(2);
      }
    });
  });
});

// ============================================================================
// Cycle Detection Tests
// ============================================================================

describe('Cycle Detection', () => {
  it('should detect no cycles in valid graph', () => {
    const nodes = createNodesMap([
      createNode('looper1', 'looper', 'input'),
      createNode('effect1', 'effect', 'effects'),
      createNode('speaker1', 'speaker', 'output'),
    ]);

    const connections = createConnectionsMap([
      createConnection('c1', 'looper1', 'effect1'),
      createConnection('c2', 'effect1', 'speaker1'),
    ]);

    const result = detectSegments(nodes, connections);
    const cycles = detectCycles(result.segments);

    expect(cycles.length).toBe(0);
  });
});

// ============================================================================
// Dirty Tracking Tests
// ============================================================================

describe('Dirty Tracking', () => {
  describe('isSegmentDirty', () => {
    it('should return false when versions match', () => {
      const segment = {
        id: 'seg1',
        type: 'STATIC' as const,
        nodeIds: ['node1', 'node2'],
        dependsOn: [],
        dependedBy: [],
        isCompiled: true,
        version: 1,
        nodeVersions: new Map([
          ['node1', 5],
          ['node2', 3],
        ]),
      };

      const currentVersions = new Map([
        ['node1', 5],
        ['node2', 3],
      ]);

      expect(isSegmentDirty(segment, currentVersions)).toBe(false);
    });

    it('should return true when a node version increased', () => {
      const segment = {
        id: 'seg1',
        type: 'STATIC' as const,
        nodeIds: ['node1', 'node2'],
        dependsOn: [],
        dependedBy: [],
        isCompiled: true,
        version: 1,
        nodeVersions: new Map([
          ['node1', 5],
          ['node2', 3],
        ]),
      };

      const currentVersions = new Map([
        ['node1', 6], // Changed!
        ['node2', 3],
      ]);

      expect(isSegmentDirty(segment, currentVersions)).toBe(true);
    });
  });

  describe('findAffectedSegments', () => {
    it('should find segment containing changed node', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('effect1', 'effect', 'effects'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'effect1'),
        createConnection('c2', 'effect1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);
      const affected = findAffectedSegments('effect1', result.segments);

      expect(affected.length).toBe(1);
      expect(affected[0].nodeIds).toContain('effect1');
    });

    it('should include downstream segments', () => {
      const nodes = createNodesMap([
        createNode('looper1', 'looper', 'input'),
        createNode('looper2', 'looper', 'input'),
        createNode('add1', 'add', 'routing'),
        createNode('speaker1', 'speaker', 'output'),
      ]);

      const connections = createConnectionsMap([
        createConnection('c1', 'looper1', 'add1'),
        createConnection('c2', 'looper2', 'add1'),
        createConnection('c3', 'add1', 'speaker1'),
      ]);

      const result = detectSegments(nodes, connections);

      // Find looper1's segment
      const looper1Segment = result.segments.find((s) =>
        s.nodeIds.includes('looper1')
      );
      expect(looper1Segment).toBeDefined();

      // Changing looper1 should affect looper1's segment AND the merge segment
      const affected = findAffectedSegments('looper1', result.segments);
      expect(affected.length).toBeGreaterThanOrEqual(2);
    });
  });
});
