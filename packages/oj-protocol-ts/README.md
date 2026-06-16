# @openjammer/oj-protocol

A **hand-maintained** TypeScript mirror of the `ojproto` Rust crate — the single
UI&harr;engine wire contract for OpenJammer.

This is intentionally **not codegen** and **not `ts-rs`**. The types in
[`src/index.ts`](./src/index.ts) are written and updated by hand. They are kept
honest by a Rust guard test, **not** by a generator:

> [`crates/ojproto/tests/wire_shapes.rs`](../../crates/ojproto/tests/wire_shapes.rs)

That test serializes representative values of every wire type with `serde_json`
and asserts the **exact** JSON shape (field names, field order, and serde's
default **externally tagged** enum form) that this package documents. If a future
change to `crates/ojproto/src/lib.rs` alters the wire format, the test fails CI —
which is the signal to update `src/index.ts` in lockstep.

## What's mirrored

Every `ojproto` wire type, with `SCHEMA_VERSION = 1`:

- `NodeIdx`, `AssetId` — newtype `u32`s, on the wire just `number`.
- `PrimitiveKind`, `ConnectionType` — bare variant-name string unions.
- `Param`, `AssetRef`, `IrNode`, `IrEdge`, `OjGraph` — plain object interfaces.
- `RtCommand`, `EngineFrame` — discriminated unions matching serde's
  externally-tagged JSON (unit variant &rarr; bare string; struct variant &rarr;
  `{ "<Variant>": { ...fields } }`).
- `ParamPatch` — plus `paramPatchToBytes` / `paramPatchFromBytes`, mirroring the
  packed 7-byte little-endian binary frame (this type crosses the seam as bytes,
  **not** JSON, so it has no JSON shape assertion).

The exact serde&rarr;JSON mapping is documented in a comment block at the top of
`src/index.ts`.

## Verifying it

```sh
# Rust side: pins the wire format.
cargo test -p ojproto

# TypeScript side: the mirror must type-check.
bun install
bun run typecheck   # == tsc --noEmit
```

Both must be green. If you change a wire type in Rust, update both the Rust test
assertions and `src/index.ts`, then re-run both.

## License

AGPL-3.0-only.
