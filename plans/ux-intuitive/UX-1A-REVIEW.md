# UX-1A — adversarial review gate

Reviewer lane, 2026-09-02. Everything below was re-run on this box from the shared
worktree; the lane's report was treated as a set of claims, not as evidence. Scratch,
scripts and raw logs: `.scratch/ux-1a-gate/`. Dev/preview server on **5246 only**, killed
at the end.

## Verdict: **SHIP-AFTER-FIXES**

The lane's core work is sound and, in the important places, better than the report claims.
`Engine::transport_frame` really is a single assembler; the wasm artefact really was
rebuilt from source (I reproduced it **byte-identically**); the denormal taxonomy split is
correct and the kernel floors are hard zeros, not DC offsets; the two `engine-real` tests
are genuinely green against the real engine with no probe. The playhead moves at every
100 ms sample across 3 s of real playback, and the meters prove a Paper Sketch song's notes
now actually reach the browser engine.

But **"speak only when the frame changes" leaves a user-reachable dead command**, and I
reproduced it deterministically: pressing **Home** on a song already parked at bar 1 emits
a `Seek` the engine consumes and never answers, and 1500 ms later the player is told *"The
audio engine did not acknowledge the transport command."* That is the exact sentence this
lane exists to delete. The lane's own report flags this as Risk #2 and says "I could not
construct that through the UI" — it is one keystroke, on a default binding
(`arrangement.home`, `ArrangementSurface.tsx:195`).

**8 findings** (1 major, 2 moderate, 5 minor). F1 must land before merge. F2 and F4 are
one-line honesty fixes on comments that currently overstate the guard. The rest are
follow-ups.

---

## Findings

| id | sev | file:line | what | exact fix |
|---|---|---|---|---|
| **F1** | **S2 major** | `crates/ojcore-wasm/src/lib.rs:793` | A transport command that does not change the frame is **never acknowledged**. `Home` while parked at bar 1 (`seek(0)` onto sample 0, motion already Stopped) produces a byte-identical frame, `drain_transport` stays silent, `armPendingTransportTimeout` fires and the UI shows *"The audio engine did not acknowledge the transport command."* Reproduced 2/2 (`.scratch/ux-1a-gate/review.spec.ts` R2: **0** transport frames during the no-op seek, banner present). Also reachable via `End` at the song end and via a ruler scrub that returns to its start tick (`RulerStack.tsx:243`). | Acknowledge on **command**, not only on **change**. In `crates/ojcore/src/exec.rs` add `transport_epoch: u64` to `Engine`, bump it in `apply_rt` (`exec.rs:669`) for `TransportPlay \| TransportPause \| TransportStop \| Seek \| TransportSet`, and expose `pub fn transport_epoch(&self) -> u64`. In `Host` (`ojcore-wasm/src/lib.rs:201`) memoise `last_transport: Option<(u64, EngineFrame)>` and speak when **either** the epoch or the frame differs. ~8 lines, both files already in the lane's diff, no new type, no wire change. |
| **F2** | **S3 moderate** | `src/audio/worklets/ojcore-processor.ts:63,65,522`; `src/audio/wasm/build-wasm.sh:52` | The code comments and the report both claim a missing engine export is now "a build-time error" / "a build-time/type error". **It is not.** The glue is imported behind `@ts-expect-error` and `build-wasm.sh` passes `--no-typescript`, so there is no `.d.ts` and `wasm` is typed `any`; `bunx tsc --noEmit` cannot see a missing export. Worse, `wasm.drain_transport()` at `:522` sits **outside** the surrounding `try`, inside `process()` — so a stale artefact now throws on the audio render thread, which per the AudioWorklet spec permanently disables the processor (silence forever) rather than degrading. The real guard is the new vitest parity test, which is good. | Make the claim true: drop `--no-typescript` from `build-wasm.sh`, commit the generated `ojcore_wasm.d.ts`, and delete the two `@ts-expect-error` lines — then `bun run build` (`tsc -b`) is the gate. Until then, reword both comments to say "a red `wasmExportParity` test", not "a build-time error". |
| **F3** | **S3 moderate** | `crates/ojcore-wasm/src/lib.rs:793` + `src/store/arrangementStore.ts:914-919` | "Speak only on change" silently converted the transport return path from a **self-healing heartbeat** to **at-most-once** delivery. Each of the four early `return`s in `receiveTransportFrame` now discards the *only* frame that state will ever produce; under the old design a frame the store rejected was re-offered ~94×/s. Not exploited beyond F1 today, but it makes those guards load-bearing in a way their author did not intend, and the report does not mention the property change. | The F1 epoch fix restores an on-demand re-statement and removes most of the sharp edge. Additionally flag to the store owner that a dropped frame is now terminal, so any new guard there must be provably correct rather than merely conservative. |
| **F4** | **S4 minor** | `crates/ojcore-wasm/src/lib.rs:775` | Doc says `drain_transport` is "Called by the worklet at the ~10 Hz looper/meter cadence". It is called every **4 render quanta** ≈ 10 ms ≈ **~94×/s** at 48 kHz/128 — measured 328 frames in 3.49 s of playback. The comment understates the render-thread allocation rate ~10×, in the one comment that is arguing about render-thread cost. | Replace "~10 Hz" with "every ~10 ms (~94×/s at 48 kHz/128)". |
| **F5** | **S4 minor** | `crates/ojcore/src/resilience.rs:74` vs `crates/ojcore-dsp/src/guards.rs:35` | Two independent `DENORMAL_FLOOR = 1.0e-30` constants now have to agree or the false fault card returns: the kernel floor must be ≥ the `sanitize` floor. `ojcore` already depends on `ojcore-dsp` (`Cargo.toml:18`). This is the "extend the pillar, never fork it" value in miniature. | `use ojcore_dsp::guards::DENORMAL_FLOOR;` in `resilience.rs` and delete the private const. |
| **F6** | **S4 minor** | `crates/ojcore/tests/denormal_tail.rs:127-132` | The subnormal assertion is **vacuous**: it inspects the master buffer *after* `sanitize` has already flushed denormals in that same block, so it can never fail. Nothing in the suite proves `DelayLine`'s internal buffer avoids the subnormal band — the one thing the new floor is for. (The test is still non-vacuous overall: `!budget.any_flagged()` is the real discriminator.) | Add a kernel-level test in `ojcore-dsp`: drive one impulse through `DelayLine` at feedback 0.34 for 70 laps and assert no buffer word lands in `(0.0, 1e-30)`. Or delete the master-buffer assertion so it does not read as proof. |
| **F7** | **S4 minor** | `crates/ojcore/tests/transport_frame_parity.rs:44` | The test pins the two **encodings**, not the two **call sites**: it takes one frame and encodes it both ways. If someone re-derives the position inside `publish_levels` again (exactly the drift the lane just removed), the test still passes. The report's "add a field or change a unit on one side and that test fails" is true for the encoders only. | Add a case that attaches a real meter ring, calls `process_block`, pops the ring, decodes the `Transport` frame and compares it to `transport_frame_now()`. That pins the native producer, not just the codec. |
| **F8** | **S4 minor, unmentioned** | `crates/ojcore/src/exec.rs:577` | `publish_levels` now emits `encode_beat(bar, u32::from(beat), phase)` where `beat` was narrowed to `u16` by `transport_frame`. The `Beat` return frame previously carried the full `u32` from `MetricPosition`. Harmless for any real meter (beat-within-bar), but it is a silent semantic narrowing the report does not mention. | Either widen `EngineFrame::Transport::beat` to `u32`, or state the saturation in `transport_frame`'s doc. |

**Observations, not findings** (no action asked):

- `crates/ojcore-wasm/src/lib.rs:1832` — `drain_transport_speaks_once_then_only_on_change`
  mutates the global `static mut HOST` and restores it with `unsafe { HOST = None }`. It is
  the only test that touches `HOST`, so it is safe today; a second one would be UB under
  `cargo test`'s shared process, and a panic mid-test leaves `HOST` live.
- `src/store/arrangementStore.ts:920` — now that the path is alive, `receiveTransportFrame`
  runs ~94×/s during playback and each call does `buildTempoMap(arrangement)` plus a
  ten-key zustand `set`. Cheap in practice (R1's readout is smooth) but it is load nobody
  has ever paid before. Store owner's call.
- `e2e/journeys/J7-collab.spec.ts:26` hard-codes `http://localhost:4173` for its peer
  context, so the shared suite cannot be run on any other port. Not this lane's file.
- **Pre-existing, confirmed not the lane's:** `cargo clippy --workspace --exclude oj-tauri
  --all-targets -- -D warnings` fails at `crates/ojcore-native/src/bounce.rs:579`
  (`unused variable: 'parent'`). `git diff crates/ojcore-native/` is empty — it is on HEAD.
  It is **Windows-only**: `parent` is consumed by `File::open(parent)` under
  `#[cfg(not(windows))]`, so Linux CI is green and the merge gate is not actually red.
  One-line fix: put `#[cfg(not(windows))]` on the `let parent: PathBuf = …;` statement.

---

## Claims verified, with evidence

### 1. One frame, not a fork — **VERIFIED**

- `Engine::transport_frame` (`exec.rs:393`) is the sole assembler of the eight fields;
  `transport_frame_now` (`:411`) is a thin wrapper over the engine's own tempo snapshot.
- Native's `publish_levels` (`exec.rs:535-581`) now **destructures that frame** into
  `return_frame::encode_beat` / `encode_transport` instead of re-deriving `pos`. Read the
  diff: the old `self.transport.position_at(...)` block inside `publish_levels` is gone.
- `ojcore-wasm::drain_transport` (`:777`) `serde_json`-encodes the same enum.
- **No new parallel type.** `git diff --stat crates/ojproto/` is **empty**;
  `EngineFrame::Transport` (`ojproto/src/lib.rs:551`) is untouched, and
  `return_frame::{encode_transport, decode}` already existed on HEAD (`meter.rs:218,243`).
- `transport_frame_parity.rs` does take **one** live snapshot and decode it from **both**
  encodings (`serde_json::from_slice` vs `return_frame::decode`), asserting
  `via_json == via_ring == frame`. It is not two calls of the same function. Its limit is
  F7.
- `cargo nextest run -p ojcore` → **162 tests run: 162 passed**, including all three
  `transport_frame_parity` cases. Matches the report exactly.

### 2. Real-time safety — see the dedicated paragraph below. **Report is honest.**

### 3. "Speak only when the frame changes" — **playhead VERIFIED, ack INCOMPLETE (F1)**

`.scratch/ux-1a-gate/review.spec.ts` R1, real engine, Paper Sketch, no probe. Thirty
consecutive readouts sampled 100 ms apart during 3 s of playback — **every one differs from
the last, monotone**:

```
["1.1.172","1.1.315","1.1.458","1.1.616","1.1.759","1.1.903","1.2.100","1.2.272",
 "1.2.444","1.2.588","1.2.745","1.2.903","1.3.87","1.3.259","1.3.388","1.3.531",
 "1.3.760","1.3.947","1.4.173","1.4.359","1.4.503","1.4.632","1.4.790","1.4.933",
 "2.1.116","2.1.274","2.1.417","2.1.561","2.1.704","2.1.862"]
stalls: []          message counts: {"ready":1,"graph-ack":3,"meters":375,"transport":329}
rolling frames: 328   sample 512 -> 167936   (= 3.49 s, so ~94 frames/s — full cadence)
```

Follow-playhead is driven by `currentTick()`, which needs `transportMotion === 1` and a
fresh `transportFrameAtMs` — both satisfied at 94 Hz, and the readout above is that value
rendered; the `Follow the playhead` toggle is pressed by default in every run I captured.

**Seek-while-stopped ack: FAILS (F1).** R2 control (`Home` after stopping at `1.2.377`) is
acknowledged and returns to `1.1` with a clean body. The second `Home`, with the transport
already parked at sample 0:

```
R2 transport frames during the no-op seek: 0
R2 acknowledge text present: true
R2 body excerpt: … The audio engine did not acknowledge the transport command.
                   The last confirmed position was preserved. …
```

The `loop_on` field is part of the compared frame, so a loop toggle changes it and is
acknowledged by construction; `setLoopEnabled` (`arrangementStore.ts`) does not arm a
pending timeout at all, so it cannot time out either. Loop-wrap moves `sample` backwards,
which changes the frame — safe by construction, but see "not verifiable" below.

### 4. D2 denormal split — **VERIFIED**

- `SanitizeReport { non_finite, denormal, clamped }` (`resilience.rs:41`); the branch shape
  is byte-for-byte equivalent to HEAD's (`!is_finite` → `denormal` → `>4.0` → `<-4.0`),
  still alloc-free. All four call sites read `.non_finite` only: `exec.rs:1386`,
  `exec.rs:1667`, `ojhost/src/node.rs:166,321`.
- `master_dirty` (`exec.rs:1403-1408`) is the only thing that raises
  `budget.non_finite[master_out]` and emits `FaultKind::NonFinite`, so `denormal_tail.rs`'s
  `!engine.budget().any_flagged()` really is the discriminator that was red on HEAD.
- **The report's 19.20 s red run checks out arithmetically.** At feedback 0.34 and 0.3 s
  delay time, reaching 1e-30 needs `30 / log10(1/0.34) ≈ 64` laps ≈ **19.2 s**. That is not
  a number you get by accident.
- **The floor is a hard zero, not a DC offset.** `flush_denormal` (`guards.rs:72`) is
  `if libm::fabsf(x) < 1.0e-30 { 0.0 } else { x }` — one compare, one select, no bias.
  1e-30 is ≈ -600 dBFS, i.e. ~450 dB below a 24-bit converter's noise floor, so it is
  inaudible by construction on a reverb/allpass tail *and* on the master limiter, which is
  the distinction the brief asked for. NaN/Inf fall through untouched because
  `fabsf(NaN) < FLOOR` and `fabsf(inf) < FLOOR` are both false — verified by
  `flush_denormal_passes_garbage_through_to_be_reported`.
- Applied to every recirculating state: `Biquad::z1/z2` (state only — the output `y` is
  not floored, which is correct), `DelayLine` feedback write, `OnePole::tick`,
  `KarplusString::tick`, and the sampler voice one-pole L/R.
- The lane's sweep claim holds: `Convolver` is a non-recursive FIR (`ojcore-dsp:298`), the
  reverb node is `ConvolutionNode` over that `Convolver` (`effects.rs:638-660`) with no
  comb/allpass anywhere, and `effects.rs` reuses these same kernels — so `DelayLine` was
  the only feedback path in the built-ins.
- `cargo test -p ojcore -p ojcore-dsp -p ojcore-wasm -p ojinstrument -p ojhost` → **exit 0,
  0 failures**, including `denormal_tail` (3) and the golden renders.
- `cargo fmt --all -- --check` → clean.

### 5. wasm rebuild honesty — **VERIFIED, and stronger than claimed**

- `src/audio/wasm/build-wasm.sh` exists, is executable, documents its prereqs, and is now
  documented in `docs/ARCHITECTURE.md` ("The committed wasm artefact — when it MUST be
  rebuilt"), including the honest note that CI's `wasm32 build` step only proves the crate
  compiles.
- Export count: HEAD's glue has **30** `export function`s and **zero** of
  `drain_transport` / `load_tempo_map` / `load_timeline`; the new glue has **33**, adding
  exactly those three. The glue diff is those three functions plus doc-comment reflow —
  nothing else.
- **I rebuilt it myself** with the pinned toolchain (`wasm-bindgen 0.2.125`, matching
  `crates/ojcore-wasm/Cargo.toml:27`) into `.scratch/ux-1a-gate/pkg/`:

```
26bf336a400491a321eee3441aeb8010  .scratch/ux-1a-gate/pkg/ojcore_wasm_bg.wasm
26bf336a400491a321eee3441aeb8010  src/audio/wasm/pkg/ojcore_wasm_bg.wasm
26bf336a400491a321eee3441aeb8010  dist/assets/ojcore_wasm_bg-CEUiZFnx.wasm
95328c4d55377cdb37aa617751770c2c  .scratch/ux-1a-gate/pkg/ojcore_wasm.js
95328c4d55377cdb37aa617751770c2c  src/audio/wasm/pkg/ojcore_wasm.js
```

  **Byte-identical**, and the *shipped production bundle* is the same bytes too. 394 343 B,
  matching the report.
- `wasmExportParity.test.ts` compares against the **processor source**, not a hard-coded
  list: `callsInto(PROCESSOR)` scrapes every `wasm.<name>(` by regex, and a separate third
  test adds a deliberate hard-coded list of the eight return-path/loader exports as a
  belt-and-braces check against a deleted call site. A fourth test parses the `.wasm`
  export section itself so the two halves of the artefact cannot be committed apart. It
  would be red on HEAD's binary (all three names absent from HEAD's glue, verified via
  `git show HEAD:…`). **4 tests, 4 passed.**

### 6. `callOptionalLoader` removal — **VERIFIED, including by render**

- `callLoader` (`ojcore-processor.ts:227`) is two direct calls; the `Reflect.get` probe is
  gone. `load_tempo_map` / `load_timeline` are `#[wasm_bindgen]` exports in the crate and
  now in the shipped glue, so the probe really had been discarding every tempo map and
  every timeline.
- **A Paper Sketch song sounds its notes in the browser.** R1's meter tap during real
  playback: `max peak 0.2796` across six bound nodes
  (`{n1:0.2796, n4:0.1452, n5:0.1267, n8:0.1267, n9:0.0896, n7:0.0896}`). Non-zero meters
  on bound tracks is the render proof the brief asked for.
- `OjcoreWasmExecutor.ts` genuinely needed no change: `case 'transport'` at `:328` and
  `subscribeTransport` at `:857` already existed, and the file is not in `git status`.

### 7. e2e — **engine-real 2/2 green; shared suite green modulo other lanes**

`bunx playwright test e2e/engine-real.spec.ts` on a lane-local config (port 5246,
`.scratch/ux-1a-gate/playwright.config.ts` — a copy of the shared config with only the port
changed):

```
ok 1 [chromium] › Play on a bound song rolls the transport and moves the playhead (3.4s)
ok 2 [chromium] › one key on the starter rig does not fault the engine for 40 seconds (43.8s)
2 passed (2.8m)
```

Whole shared suite, same config: **80 passed, 5 skipped, 20 failed (8.0m)**. None of the 20
is attributable to UX-1A:

- **15 × `visual-baselines.spec.ts`** — pixel-diff misses (`6286 pixels, ratio 0.01`)
  against snapshots another lane created this session (the spec is modified and
  `e2e/visual-baselines.spec.ts-snapshots/` is untracked). Redesign lane's.
- **1 × `J7-collab`** — `net::ERR_CONNECTION_REFUSED at http://localhost:4173/`: the spec
  hard-codes 4173 for its peer context (`J7-collab.spec.ts:26`), so it cannot run on my
  port. A config artefact of the port isolation, not a product failure.
- **4 × `J1-first-song`, `T35`, `X6`, `X8`** — CPU-contention flake; I was running the full
  vitest suite concurrently. **All four pass when re-run serially** against the same build:
  `J1 … ok (18.6s) — 1 passed`, `T35/X6/X8 — 3 passed`. I additionally instrumented J1's
  Play step three more times with a frame tap
  (`.scratch/ux-1a-gate/j1diag.spec.ts`): 3/3 green, `motion histogram {m0:2, m1:~365}`,
  pill reaches `Stop`, no banner — the probe's synthetic frames and the engine's real ones
  interleave cleanly (probe steps 960, engine steps 512).

Worth noting for the coordinator: the 1500 ms acknowledgement budget is now *real* for the
first time. Under enough load it can genuinely expire and show the banner. That is strictly
better than HEAD (where it expired 100% of the time), but it is a live flake surface.

### 8. Gates

| gate | result |
|---|---|
| `cargo fmt --all -- --check` | clean |
| `cargo test -p ojcore -p ojcore-dsp -p ojcore-wasm -p ojinstrument -p ojhost` | exit 0, 0 failed |
| `cargo nextest run -p ojcore` (RT no-alloc gate) | **162 run, 162 passed** |
| `cargo clippy --workspace --exclude oj-tauri --all-targets -- -D warnings` | **FAILS** — `bounce.rs:579`, pre-existing on HEAD, Windows-only (see Observations) |
| `bunx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `bun run lint` | exit 0 |
| `bun run build` (`tsc -b && vite build`) | succeeded — the e2e webServer built and served it |
| `bun run test:run` | **3 failed / 3186 passed (3189)** — all 3 are other lanes': `CommandBar.test.tsx` ×2 ("Tab from search sends the typed prompt to AI", "host lazy-loads ask-ai events") against the in-flight `src/ai/tools.ts`, and `environmentWritesOffHistory.test.tsx` (`MIDIIntegration`), an untracked new test from another lane. None touches `crates/**`, `src/audio/**` or `docs/ARCHITECTURE.md`. |
| `wasmExportParity.test.ts` | 4 passed |

Note: the lane's report listed a *different* three vitest failures (`agentToolsDoc`,
`typeFloor` ×2). Both sets are other lanes'; the tree moved between the runs, exactly as
the lane warned.

---

## Claims I could NOT verify

- **The native tier.** Like the lane, I ran no `bun native`. `transport_frame_parity.rs`
  pins the ring encoding and `publish_levels` provably destructures the shared frame, but
  no native binary was launched. `cargo build --workspace` still dies in `oj-tauri`'s
  `build.rs` on this box.
- **Loop-wrap, measured.** I did not drive a loop region through a wrap. It is safe by
  construction (a wrap moves `sample` backwards, so the frame differs and
  `drain_transport` speaks; no monotonicity guard exists in `receiveTransportFrame` to
  reject it), and `T10 — Loop brace creation` and `timeline-preview` are green — but I did
  not watch a playhead wrap with the real engine.
- **Real ears.** Nothing listened. Whether the delay tail's audible decay is unchanged is
  reasoned from the floor being 1e-30 (≈ -600 dBFS), not heard. Per the covenant this needs
  a human with audio playing before it is called done.
- **Firefox / WebKit.** Chromium only; `OJ_E2E_ALL_BROWSERS` unset.
- **The 3507 → 86 headline.** I measured 329 transport messages in ~5.5 s of a
  mostly-playing session (~94/s while rolling). The lane's 86 is presumably a
  mostly-parked session; both are consistent with "the memo saves everything while parked
  and nothing while rolling", but I could not reproduce the exact pair.
- **That a stale artefact now kills the worklet** (F2's second half). Derived from the
  AudioWorklet spec (an exception in `process()` disables the processor) and from
  `wasm.drain_transport()` sitting outside the `try` at `:522`; not empirically induced,
  because doing so would have meant editing a product file.

---

## The real-time-safety truth, in one paragraph

`drain_transport()` runs on the **audio rendering thread**: it is called from
`OjcoreProcessor.process()` (`ojcore-processor.ts:522`), inside the `looperTick >= 4`
block, i.e. every four render quanta — ~10 ms, **~94×/s** at 48 kHz/128 (measured: 328
frames in 3.49 s), not the "~10 Hz" the Rust doc claims (F4). When it speaks it allocates:
`serde_json::to_vec` is a Rust heap allocation, the generated glue then does
`getArrayU8FromWasm0(...).slice()` (a second copy into a fresh JS `Uint8Array`), and the
worklet adds `new TextDecoder()`, a `JSON.parse` and a structured-clone `postMessage` —
roughly five allocations per frame, all on the render thread. **The lane did not invent
this**: `drain_looper` returns a `Vec<f32>` unconditionally in the same tick,
`drain_looper_edges` a `Vec<u8>`, `drain_meters` a `Vec<f32>` whenever metering is on, and
`drain_events` a `Vec<u8>` whenever a fault is pending — the wasm audio callback has been
allocating at this cadence for as long as the browser tier has existed. Net effect of the
change: while **parked** it is strictly better (one frame at boot instead of ~94/s of
identical JSON); while **rolling** it adds ~94 allocating drains/s that were not there
before, because the old `Reflect.get` probe never fired — so the honest summary is "the
lane matched an existing hole and moved the idle cost to zero", not "the lane made the
audio thread allocate". Crucially, **no CI gate covers any of this**: the required no-alloc
gate is `cargo nextest run -p ojcore`, and its `assert_no_alloc` scopes in
`crates/ojcore/tests/engine.rs:269,292,323,763,887` wrap `Engine::process_block` on the
**native** target with **no meter ring attached**, so neither `ojcore-wasm`, nor
`publish_levels` (and therefore nor the new `Engine::transport_frame`), nor the worklet's
JS drains are inside any gate — `transport_frame` is alloc-free by inspection
(`position_at` is pure arithmetic; `tempo_snapshot` is an `Arc` refcount bump) but nothing
proves it mechanically. This is a **pre-existing hole**, not a regression: the wasm
allocator is dlmalloc inside linear memory, so there is no syscall or OS lock and no
priority inversion of the kind a native `malloc` on the RT thread would cause, but a
`memory.grow` on the render thread is still a dropout waiting to happen. The lane's own
suggested follow-up — move these drains onto a pre-allocated SAB ring like native's — is
the right one, and someone should also extend the no-alloc gate to cover `publish_levels`
with a ring attached.
