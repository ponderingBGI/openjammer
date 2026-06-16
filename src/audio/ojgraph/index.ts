/**
 * OjGraph emitter barrel (U17).
 *
 * Re-exports the pure {@link emitOjGraph} lowering from graphStore state to the
 * `ojproto` `OjGraph` IR the native / wasm engines compile.
 */

export { emitOjGraph, emitWithIndex, SYNTHETIC_MASTER_ID } from './emit';
export type { EmitOptions, EmitResult, NodeIdxMap } from './emit';
export { remapForBackend, ENGINE_IDS } from './backendMap';
export type { EngineBackend } from './backendMap';
export { resolveKeyboardNotes } from './noteRouting';
export type { ResolvedNote } from './noteRouting';
