/**
 * OpenJammer - Operation Fusion Engine
 *
 * Fuses compatible operations to minimize processing overhead:
 * - Chain of gains → single multiply
 * - Cascaded filters → single biquad cascade
 * - Identity operations → removed
 *
 * Example: Gain(0.5) → Gain(1.5) → Gain(0.8) = FusedGain(0.6)
 */

import type { GraphNode, EffectNodeData, AmplifierNodeData } from '../../engine/types';
import type {
  CompiledOperation,
  OperationType,
  GainParams,
  BiquadCascadeParams,
  BiquadFilterParams,
  BiquadFilterType,
  WaveshaperParams,
  DelayParams,
  ConvolutionParams,
} from './types';

// ============================================================================
// Operation Extraction
// ============================================================================

/**
 * Extract the operation type from a node
 */
export function getOperationType(node: GraphNode): OperationType | null {
  switch (node.type) {
    case 'amplifier':
      return 'gain';

    case 'effect': {
      const effectData = node.data as EffectNodeData;
      switch (effectData.effectType) {
        case 'distortion':
          return 'waveshaper';
        case 'reverb':
          return 'convolution';
        case 'delay':
          return 'delay';
        case 'pitch':
          // Pitch shifting is complex, treat as passthrough for now
          return 'passthrough';
        default:
          return 'passthrough';
      }
    }

    default:
      return null;
  }
}

/**
 * Extract operation parameters from a node
 */
export function extractOperation(node: GraphNode): CompiledOperation | null {
  const opType = getOperationType(node);
  if (!opType) return null;

  switch (opType) {
    case 'gain': {
      const ampData = node.data as AmplifierNodeData;
      return {
        type: 'gain',
        params: { value: ampData.gain ?? 1.0 } as GainParams,
        sourceNodeId: node.id,
      };
    }

    case 'waveshaper': {
      const effectData = node.data as EffectNodeData;
      const amount = (effectData.params?.amount as number) ?? 0.5;
      return {
        type: 'waveshaper',
        params: {
          curve: generateDistortionCurve(amount),
          oversample: '2x',
        } as WaveshaperParams,
        sourceNodeId: node.id,
      };
    }

    case 'convolution': {
      const effectData = node.data as EffectNodeData;
      return {
        type: 'convolution',
        params: {
          impulseResponseId: String(effectData.params?.irId ?? 'default'),
          normalize: true,
        } as ConvolutionParams,
        sourceNodeId: node.id,
      };
    }

    case 'delay': {
      const effectData = node.data as EffectNodeData;
      return {
        type: 'delay',
        params: {
          delayTime: (effectData.params?.time as number) ?? 0.3,
          feedback: (effectData.params?.feedback as number) ?? 0.3,
          wet: (effectData.params?.wet as number) ?? 0.5,
        } as DelayParams,
        sourceNodeId: node.id,
      };
    }

    case 'passthrough':
      return {
        type: 'passthrough',
        params: {},
        sourceNodeId: node.id,
      };

    default:
      return null;
  }
}

// ============================================================================
// Distortion Curve Generation
// ============================================================================

/**
 * Generate a distortion waveshaper curve
 * Uses soft clipping algorithm for musical distortion
 */
export function generateDistortionCurve(
  amount: number,
  samples: number = 44100
): Float32Array {
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;

  // Clamp amount to valid range
  const k = Math.max(0, Math.min(1, amount)) * 100;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;

    if (k === 0) {
      // No distortion - linear
      curve[i] = x;
    } else {
      // Soft clipping using tanh-like curve
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
  }

  return curve;
}

// ============================================================================
// Fusion Logic
// ============================================================================

/**
 * Check if two operations can be fused together
 */
export function canFuse(op1: CompiledOperation, op2: CompiledOperation): boolean {
  // Same type operations
  if (op1.type === op2.type) {
    switch (op1.type) {
      case 'gain':
        // Gains always fuse (multiply)
        return true;

      case 'biquad_cascade':
        // Biquad cascades fuse (append filters)
        return true;

      case 'passthrough':
        // Passthroughs fuse (both become nothing)
        return true;

      default:
        return false;
    }
  }

  // Different type operations that can fuse
  // None currently, but could add:
  // - gain before/after biquad → apply gain to biquad coefficients

  return false;
}

/**
 * Fuse two compatible operations into one
 */
export function fuseOperations(
  op1: CompiledOperation,
  op2: CompiledOperation
): CompiledOperation {
  if (!canFuse(op1, op2)) {
    throw new Error(`Cannot fuse ${op1.type} with ${op2.type}`);
  }

  switch (op1.type) {
    case 'gain': {
      const params1 = op1.params as GainParams;
      const params2 = op2.params as GainParams;
      return {
        type: 'gain',
        params: {
          value: params1.value * params2.value,
        } as GainParams,
        sourceNodeId: `fused:${op1.sourceNodeId}+${op2.sourceNodeId}`,
      };
    }

    case 'biquad_cascade': {
      const params1 = op1.params as BiquadCascadeParams;
      const params2 = op2.params as BiquadCascadeParams;
      return {
        type: 'biquad_cascade',
        params: {
          filters: [...params1.filters, ...params2.filters],
        } as BiquadCascadeParams,
        sourceNodeId: `fused:${op1.sourceNodeId}+${op2.sourceNodeId}`,
      };
    }

    case 'passthrough':
      return {
        type: 'passthrough',
        params: {},
        sourceNodeId: `fused:${op1.sourceNodeId}+${op2.sourceNodeId}`,
      };

    default:
      throw new Error(`Fusion not implemented for ${op1.type}`);
  }
}

/**
 * Check if an operation is an identity (can be removed)
 */
export function isIdentityOperation(op: CompiledOperation): boolean {
  switch (op.type) {
    case 'gain': {
      const params = op.params as GainParams;
      // Gain of 1.0 is identity (within epsilon)
      return Math.abs(params.value - 1.0) < 0.0001;
    }

    case 'passthrough':
      return true;

    default:
      return false;
  }
}

// ============================================================================
// Main Fusion Algorithm
// ============================================================================

/**
 * Fuse a list of operations where possible
 *
 * Algorithm:
 * 1. Accumulate compatible operations
 * 2. Flush accumulated ops when incompatible op encountered
 * 3. Remove identity operations
 */
export function fuseOperationList(
  operations: CompiledOperation[]
): CompiledOperation[] {
  if (operations.length === 0) return [];

  const result: CompiledOperation[] = [];

  // Accumulators for fuseable operations
  let pendingGains: CompiledOperation[] = [];
  let pendingBiquads: CompiledOperation[] = [];

  function flushPending() {
    // Flush gains
    if (pendingGains.length > 0) {
      let fused = pendingGains[0];
      for (let i = 1; i < pendingGains.length; i++) {
        fused = fuseOperations(fused, pendingGains[i]);
      }
      // Only add if not identity
      if (!isIdentityOperation(fused)) {
        result.push(fused);
      }
      pendingGains = [];
    }

    // Flush biquads
    if (pendingBiquads.length > 0) {
      let fused = pendingBiquads[0];
      for (let i = 1; i < pendingBiquads.length; i++) {
        fused = fuseOperations(fused, pendingBiquads[i]);
      }
      result.push(fused);
      pendingBiquads = [];
    }
  }

  for (const op of operations) {
    switch (op.type) {
      case 'gain':
        // Accumulate gains
        pendingGains.push(op);
        break;

      case 'biquad_cascade':
        // Flush gains before biquads (order matters)
        if (pendingGains.length > 0) {
          flushPending();
        }
        pendingBiquads.push(op);
        break;

      case 'passthrough':
        // Skip passthroughs entirely
        break;

      case 'waveshaper':
      case 'convolution':
      case 'delay':
        // These can't be fused - flush pending and add directly
        flushPending();
        result.push(op);
        break;

      default:
        flushPending();
        result.push(op);
    }
  }

  // Final flush
  flushPending();

  return result;
}

// ============================================================================
// Filter Coefficient Calculation
// ============================================================================

/**
 * Calculate biquad filter coefficients
 * Based on Audio EQ Cookbook by Robert Bristow-Johnson
 */
export function calculateBiquadCoefficients(
  type: BiquadFilterType,
  frequency: number,
  Q: number,
  gain: number,
  sampleRate: number = 48000
): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const w0 = (2 * Math.PI * frequency) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);
  const A = Math.pow(10, gain / 40);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cosw0) / 2;
      b1 = 1 - cosw0;
      b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
      break;

    case 'highpass':
      b0 = (1 + cosw0) / 2;
      b1 = -(1 + cosw0);
      b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
      break;

    case 'bandpass':
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
      break;

    case 'notch':
      b0 = 1;
      b1 = -2 * cosw0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
      break;

    case 'peaking':
      b0 = 1 + alpha * A;
      b1 = -2 * cosw0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw0;
      a2 = 1 - alpha / A;
      break;

    case 'lowshelf': {
      const sqrtA = Math.sqrt(A);
      b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * sqrtA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * sqrtA * alpha);
      a0 = (A + 1) + (A - 1) * cosw0 + 2 * sqrtA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw0);
      a2 = (A + 1) + (A - 1) * cosw0 - 2 * sqrtA * alpha;
      break;
    }

    case 'highshelf': {
      const sqrtA = Math.sqrt(A);
      b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * sqrtA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * sqrtA * alpha);
      a0 = (A + 1) - (A - 1) * cosw0 + 2 * sqrtA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw0);
      a2 = (A + 1) - (A - 1) * cosw0 - 2 * sqrtA * alpha;
      break;
    }

    case 'allpass':
      b0 = 1 - alpha;
      b1 = -2 * cosw0;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
      break;
  }

  // Normalize by a0
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * Create a biquad operation from filter parameters
 */
export function createBiquadOperation(
  nodeId: string,
  filterParams: BiquadFilterParams
): CompiledOperation {
  return {
    type: 'biquad_cascade',
    params: {
      filters: [filterParams],
    } as BiquadCascadeParams,
    sourceNodeId: nodeId,
  };
}

// ============================================================================
// Debug Utilities
// ============================================================================

/**
 * Generate a debug string for an operation
 */
export function debugOperation(op: CompiledOperation): string {
  switch (op.type) {
    case 'gain': {
      const params = op.params as GainParams;
      return `Gain(${params.value.toFixed(3)})`;
    }
    case 'biquad_cascade': {
      const params = op.params as BiquadCascadeParams;
      const filterStrs = params.filters.map(
        (f) => `${f.type}@${f.frequency}Hz`
      );
      return `BiquadCascade(${filterStrs.join(' → ')})`;
    }
    case 'waveshaper':
      return `Waveshaper`;
    case 'convolution': {
      const params = op.params as ConvolutionParams;
      return `Convolution(${params.impulseResponseId})`;
    }
    case 'delay': {
      const params = op.params as DelayParams;
      return `Delay(${params.delayTime}s, fb=${params.feedback})`;
    }
    case 'passthrough':
      return `Passthrough`;
    default:
      return `Unknown(${op.type})`;
  }
}

/**
 * Generate debug output for a fusion result
 */
export function debugFusionResult(
  before: CompiledOperation[],
  after: CompiledOperation[]
): string {
  const lines: string[] = ['=== Fusion Result ==='];

  lines.push('\nBefore:');
  for (const op of before) {
    lines.push(`  ${debugOperation(op)}`);
  }

  lines.push('\nAfter:');
  for (const op of after) {
    lines.push(`  ${debugOperation(op)}`);
  }

  const reduction = before.length - after.length;
  const percentage = before.length > 0
    ? ((reduction / before.length) * 100).toFixed(1)
    : '0';

  lines.push(`\nReduction: ${before.length} → ${after.length} (${percentage}% fewer operations)`);

  return lines.join('\n');
}
