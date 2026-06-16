# ojfaust

Host-side **Faust** DSP compilation for OpenJammer: turn Faust source text into a
loadable DSP node (a `.wasm` module + a real manifest of ports/params), driven by
an **agentic compile -> error -> repair loop**.

The default build (feature `libfaust` **off**) needs **no native library**: it
shells the `faust` BINARY (**Path B**, `crates/ojfaust/src/backend.rs`) to compile
to `.wasm` and read the `-json` metadata. When `faust` is not on `PATH`, compiling
returns `FaustError::Unavailable` so the crate still builds + behaves everywhere
(CI has no faust installed). The optional `libfaust` feature swaps in the
in-process JIT (Path A), which is a TODO-marked scaffold.

```
cargo build  -p ojfaust                                  # builds anywhere (CLI Path B)
cargo clippy -p ojfaust --all-targets -- -D warnings     # clean
cargo test   -p ojfaust                                  # parser + repair-loop tests;
                                                         # real-compile tests skip if no faust
```

## What you get with the feature OFF (default = CLI Path B)

| Item | Behaviour |
| --- | --- |
| `FaustCompiler::compile(&self, dsp_source: &str) -> Result<CompiledFaust, FaustError>` | `faust` on `PATH` → compiles to `.wasm` + parses name/ports/params; else `Err(FaustError::Unavailable)` |
| `CompiledFaust { name, n_in, n_out, source, params, wasm }` | carries the wasm bytes + the parsed `FaustParam[]` (id/name/min/max/default) |
| `compile_repair(compiler, source, budget, author)` | full control flow; a `Compile` diagnostic feeds the author closure; `Unavailable` bails immediately |
| `compile_repair_with(compile_once, source, budget, author)` | backend-agnostic core, unit-testable with a fake compiler (retry / budget / give-up / terminal logic, no backend) |

The `.wasm` ABI the host runs is documented in `docs/code-node-abi.md`. NOTE: the
RT execution host (wasmtime / AudioWorklet) is **founder-gated** — ojfaust authors
+ validates the artifact now; nothing here runs the wasm on the audio thread.

`FaustError` separates the **recoverable** `Compile { message }` (hand the
diagnostic back to the author and retry) from the **terminal** `Unavailable`
(no backend — retrying is pointless) and `RepairExhausted { attempts, last }`
(budget spent).

## Enabling the real backend (`--features libfaust`)

The feature currently compiles a **TODO-marked scaffold** in
`src/backend.rs::native` that `unimplemented!()`s on call, so it cannot
masquerade as working. To make it real you must (a) install the native
dependency and (b) implement one of the two paths below.

### What to install

`libfaust` ships the headers + shared library and (optionally) the `faust` CLI.

* **Debian/Ubuntu** — the dev package (`libfaust-dev`) is **not** in the default
  archives; only the runtime `libfaust2t64` and `libfaust-static` are. So build
  Faust from source to get headers + the `faust` binary:

  ```bash
  git clone https://github.com/grame-cncm/faust
  cd faust && make && sudo make install     # installs libfaust + faust CLI + headers
  ```

  (Requires an LLVM dev toolchain for the JIT backend: `sudo apt install llvm-dev`.)

* **macOS** — `brew install faust` (provides the `faust` CLI and `libfaust`).

* **Verify**: `faust --version` and `pkg-config --libs faust` (or check
  `/usr/local/include/faust/dsp/llvm-dsp-c.h` exists).

### Then pick a backend path (both produce the same `CompiledFaust` shape)

* **Path A — libfaust C API via `bindgen` (in-process JIT).** Add
  `libc` (dep) + `bindgen` (build-dep) and a `build.rs` that links `faust`
  and binds `<faust/dsp/llvm-dsp-c.h>`
  (`createCDSPFactoryFromString`, `createCDSPInstance`,
  `getNumInputs/OutputsCDSPInstance`, `getCDSPFactoryError`). Lowest latency;
  the JIT factory handle is stashed on `CompiledFaust` and wrapped as an
  `ojcore::DspInstance`.

* **Path B — `faust` CLI ahead-of-time.** No `bindgen`/`build.rs`; shell out:
  `faust -lang rust` (or `-lang wasm` for the `WasmHost` node), capture stderr
  as the `Compile` diagnostic, read `faust -json` for port counts, then
  compile/load the artifact. No `libfaust` link required.

The exact FFI sketches for both paths are inlined as comments in
`src/backend.rs`.

## How U20 (AI DSP-node authoring) uses this

U20 lets a user describe a sound; an LLM writes Faust, and this crate is the
compile/repair half of that loop:

```rust
use ojfaust::{FaustCompiler, RepairBudget, Repair, compile_repair};

let compiler = FaustCompiler::new();
let compiled = compile_repair(
    &compiler,
    &llm_first_draft,                 // LLM's initial Faust source
    RepairBudget { max_attempts: 4 }, // bounded so the loop can't spin
    |failing_src, err| {
        // The error-feedback closure: re-prompt the LLM with the source +
        // the compiler diagnostic and ask for a corrected revision.
        match ask_llm_to_fix(failing_src, &err.to_string()) {
            Some(fixed) => Repair::Revised(fixed),
            None => Repair::GiveUp,
        }
    },
)?;
```

Keeping the model behind the `author` closure means **ojfaust has no LLM
dependency** — U20 supplies the model call, ojfaust supplies the deterministic
compile/feedback/budget control flow. On success the `CompiledFaust` is
registered through `ojcore`'s `PluginLoader`/`PluginRegistry` (lowering to
`PrimitiveKind::FaustHost`, or `WasmHost` for the Path B wasm output) so the new
node behaves like any other OpenJammer plugin node in the graph.

## Lane / status

`crates/ojfaust/**` only. Intentionally a **verifiable scaffold**, not a working
JIT: the default build + clippy are green; the `libfaust` path is documented and
TODO-marked pending a native toolchain.
