/**
 * Unit tests for Pipeline Compilation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GraphNode, Connection } from '../../../engine/types';
import type { Segment, GainParams, CompiledOperation } from '../types';
import {
  extractOperation,
  fuseOperationList,
  canFuse,
  fuseOperations,
  isIdentityOperation,
  generateDistortionCurve,
  calculateBiquadCoefficients,
} from '../OperationFuser';
import { PipelineCompiler, debugCompiledProgram } from '../Compiler';

// ============================================================================
// Test Helpers
// ============================================================================

function createNode(
  id: string,
  type: GraphNode['type'],
  data: Record<string, unknown> = {}
): GraphNode {
  return {
    id,
    type,
    category: 'effects',
    position: { x: 0, y: 0 },
    data,
    ports: [],
    parentId: null,
    childIds: [],
  };
}

function createAmplifierNode(id: string, gain: number): GraphNode {
  return createNode(id, 'amplifier', { gain });
}

function createEffectNode(
  id: string,
  effectType: string,
  params: Record<string, unknown> = {}
): GraphNode {
  return createNode(id, 'effect', { effectType, params });
}

function createSegment(nodeIds: string[]): Segment {
  return {
    id: 'test-segment',
    type: 'STATIC',
    nodeIds,
    dependsOn: [],
    dependedBy: [],
    isCompiled: false,
    version: 0,
    nodeVersions: new Map(),
  };
}

// ============================================================================
// Operation Extraction Tests
// ============================================================================

describe('Operation Extraction', () => {
  describe('extractOperation', () => {
    it('should extract gain from amplifier node', () => {
      const node = createAmplifierNode('amp1', 0.5);
      const op = extractOperation(node);

      expect(op).not.toBeNull();
      expect(op?.type).toBe('gain');
      expect((op?.params as GainParams).value).toBe(0.5);
    });

    it('should extract waveshaper from distortion effect', () => {
      const node = createEffectNode('dist1', 'distortion', { amount: 0.7 });
      const op = extractOperation(node);

      expect(op).not.toBeNull();
      expect(op?.type).toBe('waveshaper');
    });

    it('should extract convolution from reverb effect', () => {
      const node = createEffectNode('rev1', 'reverb', { irId: 'hall' });
      const op = extractOperation(node);

      expect(op).not.toBeNull();
      expect(op?.type).toBe('convolution');
    });

    it('should extract delay parameters', () => {
      const node = createEffectNode('delay1', 'delay', {
        time: 0.5,
        feedback: 0.4,
        wet: 0.3,
      });
      const op = extractOperation(node);

      expect(op).not.toBeNull();
      expect(op?.type).toBe('delay');
    });

    it('should return null for non-processing nodes', () => {
      const node = createNode('looper1', 'looper', {});
      const op = extractOperation(node);

      expect(op).toBeNull();
    });
  });
});

// ============================================================================
// Operation Fusion Tests
// ============================================================================

describe('Operation Fusion', () => {
  describe('canFuse', () => {
    it('should return true for two gain operations', () => {
      const op1 = { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' };
      const op2 = { type: 'gain' as const, params: { value: 2.0 }, sourceNodeId: 'b' };

      expect(canFuse(op1, op2)).toBe(true);
    });

    it('should return false for gain and waveshaper', () => {
      const op1 = { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' };
      const op2 = {
        type: 'waveshaper' as const,
        params: { curve: new Float32Array(100), oversample: 'none' as const },
        sourceNodeId: 'b',
      };

      expect(canFuse(op1, op2)).toBe(false);
    });
  });

  describe('fuseOperations', () => {
    it('should multiply gain values', () => {
      const op1 = { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' };
      const op2 = { type: 'gain' as const, params: { value: 2.0 }, sourceNodeId: 'b' };

      const fused = fuseOperations(op1, op2);

      expect(fused.type).toBe('gain');
      expect((fused.params as GainParams).value).toBe(1.0);
    });

    it('should handle three gains correctly', () => {
      const op1 = { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' };
      const op2 = { type: 'gain' as const, params: { value: 1.5 }, sourceNodeId: 'b' };
      const op3 = { type: 'gain' as const, params: { value: 0.8 }, sourceNodeId: 'c' };

      const fused1 = fuseOperations(op1, op2);
      const fused2 = fuseOperations(fused1, op3);

      // 0.5 * 1.5 * 0.8 = 0.6
      expect((fused2.params as GainParams).value).toBeCloseTo(0.6, 5);
    });
  });

  describe('isIdentityOperation', () => {
    it('should identify gain of 1.0 as identity', () => {
      const op = { type: 'gain' as const, params: { value: 1.0 }, sourceNodeId: 'a' };
      expect(isIdentityOperation(op)).toBe(true);
    });

    it('should identify gain close to 1.0 as identity', () => {
      const op = { type: 'gain' as const, params: { value: 1.00001 }, sourceNodeId: 'a' };
      expect(isIdentityOperation(op)).toBe(true);
    });

    it('should not identify gain of 0.5 as identity', () => {
      const op = { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' };
      expect(isIdentityOperation(op)).toBe(false);
    });

    it('should identify passthrough as identity', () => {
      const op = { type: 'passthrough' as const, params: {}, sourceNodeId: 'a' };
      expect(isIdentityOperation(op)).toBe(true);
    });
  });

  describe('fuseOperationList', () => {
    it('should fuse multiple consecutive gains', () => {
      const ops = [
        { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' },
        { type: 'gain' as const, params: { value: 2.0 }, sourceNodeId: 'b' },
        { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'c' },
      ];

      const fused = fuseOperationList(ops);

      // 0.5 * 2.0 * 0.5 = 0.5
      expect(fused.length).toBe(1);
      expect(fused[0].type).toBe('gain');
      expect((fused[0].params as GainParams).value).toBeCloseTo(0.5, 5);
    });

    it('should remove identity gains', () => {
      const ops = [
        { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' },
        { type: 'gain' as const, params: { value: 2.0 }, sourceNodeId: 'b' },
      ];

      const fused = fuseOperationList(ops);

      // 0.5 * 2.0 = 1.0 (identity, should be removed)
      expect(fused.length).toBe(0);
    });

    it('should preserve non-fuseable operations', () => {
      const ops = [
        { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' },
        {
          type: 'waveshaper' as const,
          params: { curve: new Float32Array(100), oversample: 'none' as const },
          sourceNodeId: 'b',
        },
        { type: 'gain' as const, params: { value: 2.0 }, sourceNodeId: 'c' },
      ];

      const fused = fuseOperationList(ops);

      // Gains can't fuse across waveshaper
      expect(fused.length).toBe(3);
      expect(fused[0].type).toBe('gain');
      expect(fused[1].type).toBe('waveshaper');
      expect(fused[2].type).toBe('gain');
    });

    it('should remove passthroughs', () => {
      const ops: CompiledOperation[] = [
        { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'a' },
        { type: 'passthrough' as const, params: {}, sourceNodeId: 'b' },
        { type: 'gain' as const, params: { value: 0.5 }, sourceNodeId: 'c' },
      ];

      const fused = fuseOperationList(ops);

      // Passthroughs are removed, gains fuse
      // 0.5 * 0.5 = 0.25
      expect(fused.length).toBe(1);
      expect((fused[0].params as GainParams).value).toBeCloseTo(0.25, 5);
    });
  });
});

// ============================================================================
// Distortion Curve Tests
// ============================================================================

describe('Distortion Curve Generation', () => {
  it('should generate linear curve for amount 0', () => {
    const curve = generateDistortionCurve(0, 1000);

    // At 0 distortion, output should equal input (linear)
    const midpoint = Math.floor(curve.length / 2);
    expect(curve[midpoint]).toBeCloseTo(0, 2);
  });

  it('should generate curved output for high amount', () => {
    const curve = generateDistortionCurve(1.0, 1000);

    // At high distortion, values should be compressed
    // Check that extreme values are limited
    const max = Math.max(...Array.from(curve));
    const min = Math.min(...Array.from(curve));

    expect(max).toBeLessThanOrEqual(2);
    expect(min).toBeGreaterThanOrEqual(-2);
  });

  it('should generate symmetric curve', () => {
    const curve = generateDistortionCurve(0.5, 1000);

    // Curve should be antisymmetric: f(-x) = -f(x)
    const n = curve.length;
    for (let i = 0; i < 10; i++) {
      const left = curve[i];
      const right = curve[n - 1 - i];
      expect(left).toBeCloseTo(-right, 1);
    }
  });
});

// ============================================================================
// Biquad Coefficient Tests
// ============================================================================

describe('Biquad Coefficient Calculation', () => {
  it('should calculate lowpass coefficients', () => {
    const coeffs = calculateBiquadCoefficients('lowpass', 1000, 1.0, 0, 48000);

    // Coefficients should be finite numbers
    expect(Number.isFinite(coeffs.b0)).toBe(true);
    expect(Number.isFinite(coeffs.b1)).toBe(true);
    expect(Number.isFinite(coeffs.b2)).toBe(true);
    expect(Number.isFinite(coeffs.a1)).toBe(true);
    expect(Number.isFinite(coeffs.a2)).toBe(true);
  });

  it('should calculate highpass coefficients', () => {
    const coeffs = calculateBiquadCoefficients('highpass', 1000, 1.0, 0, 48000);

    expect(Number.isFinite(coeffs.b0)).toBe(true);
    expect(Number.isFinite(coeffs.a1)).toBe(true);
  });

  it('should handle different sample rates', () => {
    const coeffs44 = calculateBiquadCoefficients('lowpass', 1000, 1.0, 0, 44100);
    const coeffs48 = calculateBiquadCoefficients('lowpass', 1000, 1.0, 0, 48000);

    // Coefficients should differ for different sample rates
    expect(coeffs44.b0).not.toBeCloseTo(coeffs48.b0, 5);
  });
});

// ============================================================================
// Compiler Tests
// ============================================================================

describe('PipelineCompiler', () => {
  let nodes: Map<string, GraphNode>;
  let connections: Map<string, Connection>;
  let compiler: PipelineCompiler;

  beforeEach(() => {
    nodes = new Map();
    connections = new Map();
    compiler = new PipelineCompiler(nodes, connections);
  });

  describe('compile', () => {
    it('should compile a simple gain chain', () => {
      nodes.set('amp1', createAmplifierNode('amp1', 0.5));
      nodes.set('amp2', createAmplifierNode('amp2', 2.0));

      const segment = createSegment(['amp1', 'amp2']);
      const program = compiler.compile(segment);

      // Should fuse to identity (removed) or single gain
      expect(program.operations.length).toBeLessThanOrEqual(1);
      expect(program.segmentId).toBe('test-segment');
    });

    it('should compile distortion effect', () => {
      nodes.set('dist1', createEffectNode('dist1', 'distortion', { amount: 0.5 }));

      const segment = createSegment(['dist1']);
      const program = compiler.compile(segment);

      expect(program.operations.length).toBe(1);
      expect(program.operations[0].type).toBe('waveshaper');
      expect(program.lookupTables.size).toBe(1);
    });

    it('should compile mixed chain', () => {
      nodes.set('amp1', createAmplifierNode('amp1', 0.5));
      nodes.set('dist1', createEffectNode('dist1', 'distortion', { amount: 0.5 }));
      nodes.set('amp2', createAmplifierNode('amp2', 2.0));

      const segment = createSegment(['amp1', 'dist1', 'amp2']);
      const program = compiler.compile(segment);

      // Gain before distortion, distortion, gain after
      expect(program.operations.length).toBe(3);
    });

    it('should track node versions', () => {
      nodes.set('amp1', createAmplifierNode('amp1', 0.5));

      const segment = createSegment(['amp1']);
      compiler.compile(segment);

      expect(segment.nodeVersions.size).toBe(1);
      expect(segment.nodeVersions.has('amp1')).toBe(true);
    });
  });

  describe('hotPatch', () => {
    it('should hot-patch gain value', () => {
      nodes.set('amp1', createAmplifierNode('amp1', 0.5));

      const segment = createSegment(['amp1']);
      const program = compiler.compile(segment);

      const success = compiler.hotPatch(program, 'amp1', 'gain', 0.8);

      expect(success).toBe(true);
      expect((program.operations[0].params as GainParams).value).toBe(0.8);
    });

    it('should hot-patch delay time', () => {
      nodes.set('delay1', createEffectNode('delay1', 'delay', {
        time: 0.3,
        feedback: 0.5,
        wet: 0.5,
      }));

      const segment = createSegment(['delay1']);
      const program = compiler.compile(segment);

      const success = compiler.hotPatch(program, 'delay1', 'time', 0.5);

      expect(success).toBe(true);
    });

    it('should return false for non-patchable params', () => {
      nodes.set('dist1', createEffectNode('dist1', 'distortion', { amount: 0.5 }));

      const segment = createSegment(['dist1']);
      const program = compiler.compile(segment);

      // Distortion amount requires new curve, can't hot-patch
      const success = compiler.hotPatch(program, 'dist1', 'amount', 0.8);

      expect(success).toBe(false);
    });
  });

  describe('event emission', () => {
    it('should emit compilation_start and compilation_complete events', () => {
      nodes.set('amp1', createAmplifierNode('amp1', 0.5));

      const events: string[] = [];
      compiler.on((event) => events.push(event.type));

      const segment = createSegment(['amp1']);
      compiler.compile(segment);

      expect(events).toContain('compilation_start');
      expect(events).toContain('compilation_complete');
    });

    it('should emit parameter_patched event on hot-patch', () => {
      nodes.set('amp1', createAmplifierNode('amp1', 0.5));

      const events: string[] = [];
      compiler.on((event) => events.push(event.type));

      const segment = createSegment(['amp1']);
      const program = compiler.compile(segment);
      compiler.hotPatch(program, 'amp1', 'gain', 0.8);

      expect(events).toContain('parameter_patched');
    });
  });
});

// ============================================================================
// Debug Output Tests
// ============================================================================

describe('Debug Output', () => {
  it('should generate readable program debug output', () => {
    const nodes = new Map<string, GraphNode>();
    nodes.set('amp1', createAmplifierNode('amp1', 0.5));
    nodes.set('dist1', createEffectNode('dist1', 'distortion', { amount: 0.5 }));

    const compiler = new PipelineCompiler(nodes, new Map());
    const segment = createSegment(['amp1', 'dist1']);
    const program = compiler.compile(segment);

    const debug = debugCompiledProgram(program);

    expect(debug).toContain('Compiled Program');
    expect(debug).toContain('Operations');
    expect(debug).toContain('Gain');
    expect(debug).toContain('Waveshaper');
  });
});
