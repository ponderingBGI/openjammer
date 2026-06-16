/**
 * @openjammer/oj-protocol
 *
 * HAND-WRITTEN TypeScript mirror of the `ojproto` Rust crate — the single
 * UI<->engine wire contract. This is deliberately NOT codegen and NOT ts-rs:
 * it is maintained by hand and kept honest by the Rust guard test
 * `crates/ojproto/tests/wire_shapes.rs`, which serializes representative values
 * with `serde_json` and asserts the EXACT JSON shape documented here. If serde's
 * output ever drifts from these types, that test fails CI.
 *
 * ── How serde's JSON maps to these types (verified by running the Rust side) ──
 *
 *  • Newtype structs over an integer (`NodeIdx(pub u32)`, `AssetId(pub u32)`)
 *    serialize TRANSPARENTLY as a bare number, never as `{ "0": n }`. So on the
 *    wire `NodeIdx` and `AssetId` are just `number`.
 *        NodeIdx(3)  ==>  3
 *        AssetId(7)  ==>  7
 *
 *  • C-like enums (`PrimitiveKind`, `ConnectionType`) serialize as a bare string
 *    equal to the Rust variant identifier VERBATIM (serde default casing, no
 *    `rename_all`):
 *        PrimitiveKind::KarplusString  ==>  "KarplusString"
 *        ConnectionType::Audio         ==>  "Audio"
 *
 *  • Data/unit enums (`RtCommand`, `EngineFrame`) use serde's DEFAULT
 *    **externally tagged** representation:
 *        - a UNIT variant    -> a bare string:        "TransportPlay"
 *        - a STRUCT variant   -> a single-key object:  { "SetParam": { ...fields } }
 *      (serde always wraps even single-field struct variants, e.g.
 *       `RtCommand::Seek { samples }` -> `{ "Seek": { "samples": 9000 } }`.)
 *    The discriminated unions below encode exactly this: a union member is
 *    either the literal string of a unit variant, or an object with one key
 *    naming the variant whose value is the fields object.
 *
 *  • Plain structs serialize as objects with their snake_case Rust field names
 *    (the source already uses snake_case fields; serde does not rename), in
 *    field declaration order. Field order does not affect TS structural typing
 *    but IS pinned by the Rust test.
 *
 *  • `f32`/`u8`/`u16`/`u32`/`u64` all become JS `number`. (u64 `Seek.samples`
 *    is well within Number.MAX_SAFE_INTEGER for any realistic sample count.)
 */

/** Bumped on any breaking change to the IR / protocol shapes. Mirrors
 *  `ojproto::SCHEMA_VERSION` (a `u16`). */
export const SCHEMA_VERSION = 1 as const;

/** Stable per-graph node index. Rust: `NodeIdx(pub u32)` — wire form: bare number. */
export type NodeIdx = number;

/** Handle to an off-RT-thread asset. Rust: `AssetId(pub u32)` — wire form: bare number. */
export type AssetId = number;

/**
 * The closed primitive instruction set the RT kernel matches on.
 * Rust: `enum PrimitiveKind { ... }` — wire form: bare variant-name string.
 * This union lists EVERY variant, spelled exactly as serde emits it.
 */
export type PrimitiveKind =
  // generators / instruments
  | "Osc"
  | "Sampler"
  | "Sf2"
  | "KarplusString"
  // processors
  | "Gain"
  | "Biquad"
  | "Waveshaper"
  | "Delay"
  | "Convolution"
  // host-bridged / extension
  | "FaustHost"
  | "WasmHost"
  | "PluginHost"
  // routing / io
  | "Add"
  | "MicIn"
  | "SpeakerOut"
  | "GraphIn"
  | "GraphOut"
  | "Passthrough"
  // stateful (U-STATEFUL)
  | "Looper"
  | "Recorder";

/** Edge signal kind. Rust: `enum ConnectionType { Audio, Control }` — bare string. */
export type ConnectionType = "Audio" | "Control";

/** A single numeric parameter on a node, addressed by `(NodeIdx, id)`.
 *  Rust: `struct Param { id: u16, value: f32 }`. */
export interface Param {
  id: number;
  value: number;
}

/** Binds an asset to a node input slot. Rust: `struct AssetRef { slot: u16, asset: AssetId }`. */
export interface AssetRef {
  slot: number;
  asset: AssetId;
}

/** A node in the compiled graph. Rust: `struct IrNode { ... }`. */
export interface IrNode {
  id: NodeIdx;
  manifest_id: string;
  kind: PrimitiveKind;
  params: Param[];
  assets: AssetRef[];
  n_in: number;
  n_out: number;
}

/** A directed connection between two node ports. Rust: `struct IrEdge { ... }`. */
export interface IrEdge {
  from_node: NodeIdx;
  from_port: number;
  to_node: NodeIdx;
  to_port: number;
  kind: ConnectionType;
}

/**
 * The whole compiled program pushed from the control plane to the engine.
 * Rust: `struct OjGraph { ... }`. `schedule` is precomputed topological waves:
 * an array of waves, each wave an array of `NodeIdx` (i.e. `number[][]`).
 */
export interface OjGraph {
  ir_version: number;
  sample_rate: number;
  block_size: number;
  nodes: IrNode[];
  edges: IrEdge[];
  schedule: NodeIdx[][];
}

/**
 * Fixed-size, heap-free commands for the wait-free UI->RT queue.
 * Rust: `enum RtCommand { ... }`, EXTERNALLY tagged.
 *
 * Wire examples (verified):
 *   { "SetParam": { "node": 3, "param": 5, "value": 0.25 } }
 *   { "NoteOn":   { "node": 3, "note": 60, "vel": 100 } }
 *   { "NoteOff":  { "node": 3, "note": 60 } }
 *   { "Bypass":   { "node": 3, "on": true } }
 *   "TransportPlay"
 *   "TransportPause"
 *   { "Seek": { "samples": 9000 } }
 *   { "Looper": { "node": 3, "action": 5 } }
 */
export type RtCommand =
  | { SetParam: { node: NodeIdx; param: number; value: number } }
  | { NoteOn: { node: NodeIdx; note: number; vel: number } }
  | { NoteOff: { node: NodeIdx; note: number } }
  | { Bypass: { node: NodeIdx; on: boolean } }
  | "TransportPlay"
  | "TransportPause"
  | { Seek: { samples: number } }
  | { Looper: { node: NodeIdx; action: LooperAction } };

/**
 * Looper transport actions carried by `RtCommand.Looper.action` (a bare `u8` on
 * the wire). Mirrors Rust's `ojproto::looper_action` consts — kept as a numeric
 * union so the JSON shape stays `{ "Looper": { "node": n, "action": k } }`.
 *   ARM = 0, RECORD = 1, PLAY = 2, STOP = 3, CLEAR = 4, OVERDUB = 5
 */
export type LooperAction = 0 | 1 | 2 | 3 | 4 | 5;

/** Named `LooperAction` values, mirroring Rust's `ojproto::looper_action`. */
export const LooperAction = {
  ARM: 0,
  RECORD: 1,
  PLAY: 2,
  STOP: 3,
  CLEAR: 4,
  OVERDUB: 5,
} as const satisfies Record<string, LooperAction>;

/**
 * Hot parameter patch: a hand-packed 7-byte frame on the highest-rate UI->RT
 * path. Rust: `struct ParamPatch { node: u16, param: u8, value: f32 }` with
 * `to_bytes() -> [u8; 7]` / `from_bytes([u8; 7])`.
 *
 * NOTE: `ParamPatch` does NOT derive serde in Rust — it crosses the seam as the
 * packed 7-byte little-endian frame, not JSON. This struct type and the byte
 * codec below mirror that binary layout, so the guard test does not (and need
 * not) assert a JSON shape for it.
 *
 *   byte 0..2  node  (u16, little-endian)
 *   byte 2     param (u8)
 *   byte 3..7  value (f32, little-endian IEEE-754)
 */
export interface ParamPatch {
  node: number;
  param: number;
  value: number;
}

/** Number of bytes in a packed `ParamPatch` frame. Mirrors `ParamPatch::BYTES`. */
export const PARAM_PATCH_BYTES = 7 as const;

/** Pack a `ParamPatch` into its 7-byte little-endian frame (mirrors `to_bytes`). */
export function paramPatchToBytes(p: ParamPatch): Uint8Array {
  const buf = new Uint8Array(PARAM_PATCH_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint16(0, p.node, /* littleEndian */ true);
  view.setUint8(2, p.param);
  view.setFloat32(3, p.value, /* littleEndian */ true);
  return buf;
}

/** Unpack a 7-byte little-endian frame into a `ParamPatch` (mirrors `from_bytes`). */
export function paramPatchFromBytes(bytes: Uint8Array): ParamPatch {
  if (bytes.length !== PARAM_PATCH_BYTES) {
    throw new RangeError(
      `ParamPatch frame must be ${PARAM_PATCH_BYTES} bytes, got ${bytes.length}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    node: view.getUint16(0, true),
    param: view.getUint8(2),
    value: view.getFloat32(3, true),
  };
}

/**
 * Engine -> UI frames (control-rate only, JSON). Rust: `enum EngineFrame { ... }`,
 * EXTERNALLY tagged. Every variant here is a struct variant, so each is a
 * single-key object.
 *
 * Wire examples (verified):
 *   { "EngineState": { "running": true, "sample_rate": 48000, "block_size": 128, "xruns": 2 } }
 *   { "Meter":  { "node": 3, "rms": 0.1, "peak": 0.9 } }
 *   { "IrAck":  { "ir_version": 1, "ok": true } }
 *   { "Beat":   { "bar": 2, "beat": 3, "phase": 0.5 } }
 *   { "Error":  { "code": 42, "message": "boom" } }
 */
export type EngineFrame =
  | {
      EngineState: {
        running: boolean;
        sample_rate: number;
        block_size: number;
        xruns: number;
      };
    }
  | { Meter: { node: NodeIdx; rms: number; peak: number } }
  | { IrAck: { ir_version: number; ok: boolean } }
  | { Beat: { bar: number; beat: number; phase: number } }
  | { Error: { code: number; message: string } };

/**
 * Log severity, lowest→highest. Rust: `enum Severity` — bare variant string,
 * exactly like `PrimitiveKind`. Verified shapes: "Trace" | "Debug" | ...
 */
export type Severity = "Trace" | "Debug" | "Info" | "Warn" | "Error";

/** Which side of the dual-target seam emitted the event. Rust: `enum Source` — bare string. */
export type Source = "Engine" | "Wasm" | "Ui" | "Native";

/** RT fault taxonomy. Rust: `enum FaultKind` — bare string. */
export type FaultKind = "NonFinite" | "OverBudget" | "AutoBypassed";

/**
 * The closed, versioned event taxonomy (control-rate). Rust: `enum EventKind`,
 * EXTERNALLY tagged — unit variants are bare strings, data variants single-key
 * objects. `Message` is the only `String`-carrying variant.
 *
 * Wire examples (pinned by wire_shapes.rs):
 *   "Lifecycle"
 *   "GraphSwap"
 *   { "Xrun": { "dropped": 3 } }
 *   { "NodeFault": { "node": 3, "fault": "NonFinite" } }
 *   "RingFull"
 *   "Asset"
 *   "Plugin"
 *   "Midi"
 *   "Collab"
 *   { "Message": { "code": 42, "text": "boom" } }
 */
export type EventKind =
  | "Lifecycle"
  | "GraphSwap"
  | { Xrun: { dropped: number } }
  | { NodeFault: { node: NodeIdx; fault: FaultKind } }
  | "RingFull"
  | "Asset"
  | "Plugin"
  | "Midi"
  | "Collab"
  | { Message: { code: number; text: string } };

/**
 * A single control-rate structured event — the off-RT decoded record every L1/
 * L3/L4 consumer reads.
 *
 * FORWARD-DECLARED — NOT yet wire-verified. The Rust `struct Event { v, seq,
 * severity, kind, source, ts_us, corr_id }` and its `wire_shapes.rs` byte-parity
 * test land in the Phase-2 transport/decode wave (see docs/plans/02 + 09); the
 * schema wave deliberately deferred the envelope. Until that Rust struct exists
 * this is the app-side contract and MUST be kept in sync by hand — the parity
 * gate will enforce it the moment the Rust side is added.
 *
 * Expected wire shape (plain struct → object, snake_case fields, declaration order):
 *   { "v": 1, "seq": 12, "severity": "Warn",
 *     "kind": { "NodeFault": { "node": 3, "fault": "OverBudget" } },
 *     "source": "Engine", "ts_us": 123456, "corr_id": 0 }
 */
export interface Event {
  /** Schema version. Mirrors `ojproto::SCHEMA_VERSION` (a `u16`). */
  v: number;
  /** Monotonic per-source sequence number (`u32`). */
  seq: number;
  /** Severity. */
  severity: Severity;
  /** The event taxonomy payload. */
  kind: EventKind;
  /** Which side emitted it. */
  source: Source;
  /** Engine-stamped timestamp in microseconds (`u64`). */
  ts_us: number;
  /** Correlation id for click-to-correlate; `0` = none (`u64`). */
  corr_id: number;
}

/**
 * RT-safe `Copy` subset of `EventKind` that rides the ByteRing. Rust:
 * `enum RtEvent`, EXTERNALLY tagged. Heap-free; mirrors only the three
 * RT-emittable variants.
 *
 * Wire examples (pinned by wire_shapes.rs):
 *   { "Xrun": { "dropped": 5 } }
 *   { "NodeFault": { "node": 3, "fault": "OverBudget" } }
 *   "RingFull"
 */
export type RtEvent =
  | { Xrun: { dropped: number } }
  | { NodeFault: { node: NodeIdx; fault: FaultKind } }
  | "RingFull";
