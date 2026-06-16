# ojcore-wasm

The **wasm32 AudioWorklet host** for OpenJammer. A thin
[`wasm-bindgen`](https://crates.io/crates/wasm-bindgen) shell wrapping
`ojcore`'s **no_std** compile/exec core, plus the `ojcore-midiring`
`SharedArrayBuffer` rings for the UI->engine command path and the
worker->worklet MIDI path.

`ojcore` is depended on with `default-features = false`: the std-only host
plumbing (`rtrb` command queue, `basedrop` deferred drop, `arc-swap` graph
swap) is **not** available on `wasm32`, so this crate drives the bare no_std
`compile` / `Engine` / `process_block` surface and supplies its own rings.

## Build

This crate is **not** built by the default native `cargo build --workspace`
(that link step targets the host and would not produce a usable `.wasm`). Build
it explicitly for `wasm32-unknown-unknown` with `build-std` (the no_std core +
alloc require the standard library to be rebuilt for the target):

```sh
cargo +nightly build -p ojcore-wasm \
  --target wasm32-unknown-unknown \
  -Z build-std=std,panic_abort
```

Prerequisites (already installed in CI):

- the `nightly` toolchain,
- the `wasm32-unknown-unknown` target (`rustup +nightly target add wasm32-unknown-unknown`),
- the `rust-src` component (`rustup +nightly component add rust-src`) — needed by `-Z build-std`.

The artifact lands at
`target/wasm32-unknown-unknown/debug/ojcore_wasm.wasm` (add `--release` for the
optimized build). Run `wasm-bindgen` over it to emit the JS glue + the
ES-module-friendly `.wasm` the AudioWorklet imports.

`crates/ojcore-wasm/build.sh` wraps the command above.

### Why this is NOT in a shared cargo config

`-Z build-std` and a global default `[build] target = "wasm32-…"` would break
**stable native** builds of the rest of the workspace (the native crates use
`std`-only deps and must keep compiling on stable). So the wasm build lives in
this explicit, documented command — never in the root config. Only
target-scoped `[target.wasm32-unknown-unknown]` keys would be allowed in
`.cargo/config.toml`, and none are currently required.

## JS surface

All entry points run on the single AudioWorklet processor thread.

| export | purpose |
| --- | --- |
| `init(sample_rate, block_size)` | Allocate the host once: registry + an empty (silent) `Engine` + the command/MIDI rings + the output buffer. Everything that allocates happens here, off the render path. |
| `load_graph(bytes) -> bool` | Compile + install a serialized `OjGraph` (the same serde **JSON** the rest of the protocol uses). Runs off the render path; returns `false` (leaving the live program untouched) on a malformed payload or compile error. |
| `process(nframes)` | Called every render quantum: drains the command ring into `RtCommand`s applied to the engine, then renders `nframes` into the output buffer. **No allocation, no locks.** |
| `output_ptr()` / `block_size()` / `sample_rate()` | Read the mono master output: `block_size` f32s at `output_ptr` after each `process`. |
| `cmd_ring_ptr()` / `cmd_ring_len()` | Base + byte length of the UI->engine command ring in wasm linear memory. |
| `midi_ring_ptr()` / `midi_ring_len()` | Base + byte length of the worker->worklet MIDI ring. |
| `ring_write_offset()` / `ring_read_offset()` / `ring_capacity_offset()` / `ring_data_offset()` | Frozen `#[repr(C)]` header offsets (identical for both rings) so JS can build `Int32Array` / `Uint8Array` SAB views over the atomics and the data region. |
| `encode_command_setparam(node, param, value) -> Vec<u8>` | Convenience encoder for the JSON command frame a producer `push`es into the command ring (off the render path). |
| `node_count()` | Coarse liveness probe (`0` not init, `1` bootstrap silence, `>1` real graph). |

### Building SAB views in JS

1. Get the wasm `Memory` and `cmd_ring_ptr()`/`midi_ring_ptr()`.
2. Lay typed-array views over the ring's region using the `*_offset` getters:
   `write`/`read`/`capacity` are `u32` atomics (`Int32Array` for `Atomics.*`),
   and the data region begins at `ring_data_offset()` (`Uint8Array`).
3. Push **length-prefixed** frames per the `ojcore-midiring` wire format
   (a 4-byte LE length, then the payload). Command frames are serde-JSON
   `RtCommand` bytes.

### Commands honoured

`drain_commands` decodes each JSON frame to an `RtCommand` and applies it via
`ojcore`'s no_std public surface:

- `SetParam` — resolve slot, `set_param` on the instance;
- `Bypass` — toggle the slot's bypass flag;
- `NoteOn` / `NoteOff` — resolved only (no instance note sink yet, matching
  native `Engine::apply`);
- `TransportPlay` / `TransportPause` / `Seek` — dropped here: the engine's
  transport clock is only settable through the **std-gated** `Engine::apply`,
  which `wasm32` does not enable. The worklet's transport is driven host-side
  until `ojcore` exposes a no_std transport setter.
