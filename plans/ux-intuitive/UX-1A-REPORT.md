# UX-1A — the engine/worklet seam: transport acknowledgement + the denormal fault

Builder lane, 2026-09-02. Fixes UX-INV **Q2 Cause 1** (D1) and **Q1** (D2), plus the
coordinator's **D3** (a probe-free e2e anchor). Everything below was run on this box;
outputs are quoted verbatim.

**Scope kept.** Edits are confined to `crates/**`, `src/audio/worklets/**`,
`src/audio/wasm/pkg/**`, `docs/ARCHITECTURE.md` and new tests. `OjcoreNativeExecutor.ts`,
`faultPipe.ts`, `voiceLoadError.ts`, `src/store/**` and `src/components/**` were read but
**not** written. No `git add/commit/stash/checkout/reset` — except `git checkout -- Cargo.lock`,
used only to undo cargo's unrelated re-resolution of `toml_write` (the one write allowed).
`OjcoreWasmExecutor.ts` turned out to need no change at all: it already handled
`{type:'transport'}` (`:329`) and `subscribeTransport` (`:857`). The only thing missing was
an engine that ever spoke.

---

## D1 — the browser tier can now acknowledge a transport command

### The frame contract, and why this is not a fork

The temptation was to invent a browser transport message. Instead there is now exactly **one
assembler** of `EngineFrame::Transport`, in the shared core, and the two tiers differ only in
how they *encode* it:

- **`crates/ojcore/src/exec.rs:393` — `Engine::transport_frame(&mut self, map)`** — the single
  place the frame's eight fields are built from a `position_at` read plus the transport FSM.
  Alloc-free; advances the incremental `MetricCursor`, so the per-block native call stays O(1).
- **`crates/ojcore/src/exec.rs:411` — `Engine::transport_frame_now()`** — the same, against the
  engine's own tempo snapshot, for a caller with no map in hand.
- **`exec.rs:~530` — `publish_levels`** (native) was rewritten to *destructure that frame* into
  `meter::return_frame::encode_transport` rather than re-derive the fields. It used to compute
  `pos` itself; now it cannot drift.
- **`crates/ojcore-wasm/src/lib.rs:777` — `drain_transport()`** — `serde_json::to_vec` of the
  same enum, which serialises externally-tagged as `{"Transport":{…}}` — precisely what
  `ojcore-processor.ts` already parsed.

Pinned by **`crates/ojcore/tests/transport_frame_parity.rs`**: it takes one live snapshot,
encodes it *both* ways, and asserts `decode(ring_bytes) == from_json(json_bytes) == frame`. Add
a field or change a unit on one side and that test fails.

### The dead soft probes are gone

`src/audio/worklets/ojcore-processor.ts:522` now calls `wasm.drain_transport()` **directly**.
The `Reflect.get(wasm, 'drain_transport')` guard is deleted.

The same smell was one line away and equally fatal, so it went too: `callOptionalLoader`
(`Reflect.get` over `load_tempo_map` / `load_timeline`) is now `callLoader`
(`ojcore-processor.ts:227`), a direct call. Those two exports *did* exist in the crate — only
the stale committed glue lacked them — so the probe had been silently discarding **every tempo
map and every timeline**. A song's notes never reached the browser engine, with nothing logged.

### The artefact was 17 commits stale; it is rebuilt

`bash src/audio/wasm/build-wasm.sh --release` (nightly + `-Z build-std` + `wasm-bindgen 0.2.125`,
matching the crate pin). `src/audio/wasm/pkg/`: **30 → 33 exports**, binary **304 507 → 394 343 bytes**.

### The guard against it going stale again

**`src/audio/worklets/__tests__/wasmExportParity.test.ts`** (new, 4 tests, default vitest suite).
It reads the artefact as data and cross-checks four ways: the glue's export list vs. every
`wasm.<name>(` in the processor; vs. `browserExport.ts`; vs. a hard-coded list of the eight
return-path/loader exports (so deleting a call site cannot hide a stale build); and the glue's
exports vs. the `.wasm` binary's own **export section**, parsed inline, so the two halves of the
artefact cannot be committed apart.

Proven non-vacuous — run against HEAD's artefact it names all three missing exports:

```
× the generated glue exports every function the AudioWorklet processor calls
× pins the return-path contract, so deleting a call site cannot hide a stale build
AssertionError: ojcore-processor.ts calls exports the shipped glue does not have.
Re-run `bash src/audio/wasm/build-wasm.sh --release` and commit src/audio/wasm/pkg/.
+   "drain_transport",
+   "load_tempo_map",
+   "load_timeline",
```

`docs/ARCHITECTURE.md` gains **"The committed wasm artefact — when it MUST be rebuilt"**: the
trigger list, the prereqs, the guard, and the note that CI's `wasm32 build` step only proves the
crate *compiles* — it never regenerates or diffs the artefact.

### One extra change, forced by evidence: the engine speaks only when it has news

`drain_transport` returns empty when the frame is byte-identical to the last one drained
(`crates/ojcore-wasm/src/lib.rs:793`, state at `:201`, `:338`). This is **not** cosmetic — I
added it after the e2e suite caught a real problem (below), and it is right on its own terms:

- A parked transport produced an identical frame every 10 ms. Re-sending it meant a `Vec` **plus
  a JSON serialisation on the render thread**, ~94×/s, to say nothing happened. That is an
  allocation on the audio path for no information (code-values #6/#9). Measured effect on an
  idle-then-play Paper Sketch session: **3507 → 86** transport messages, meters unchanged.
- A parked engine was also broadcasting authoritative "I am Stopped" ~94×/s, which races every
  optimistic UI state during the ~40 ms it takes the audio thread to drain a `TransportPlay`.

Nothing the UI waits on is lost: Play, Pause, Seek, a loop toggle and the playhead moving all
change the frame. Rolling advances `sample` every drain, so playback still reports at full
cadence. `load_graph` deliberately does **not** clear the memo (documented at `:201`): the
transport is not owned by the program — `Engine::install` carries the playhead across a swap —
so a graph push must not manufacture a redundant `Stopped` frame.

---

## D2 — a denormal flush is no longer reported as `NonFinite`

Fixed at both levels the brief asked for.

### (a) The taxonomy: `sanitize` stops conflating three things

`crates/ojcore/src/resilience.rs:41` adds **`SanitizeReport { non_finite, denormal, clamped }`**;
`:71` `sanitize` returns it instead of one `bool`. Same branch shape, still alloc-free.
**Only `non_finite` is garbage**; the denormal flush and the ±4 headroom clamp are housekeeping
the engine performs on healthy signal and are now silent (they remain on the struct for
diagnostics, per "collect diagnostics quietly").

Call sites read `.non_finite`: `exec.rs:1338` (master out), `exec.rs:1616` (`sanitize_node`),
`ojhost/src/node.rs:166,321`.

### (b) The floors: stop *creating* denormals

New **`ojcore_dsp::guards::flush_denormal`** (`crates/ojcore-dsp/src/guards.rs:72`).

The important design point: it is deliberately **not** the existing
`scrub_denormals_and_nan`. A kernel-level floor must not swallow a real `NaN` — garbage has to
survive the kernel and reach the node boundary so it is *reported*. `fabsf(NaN) < FLOOR` and
`fabsf(inf) < FLOOR` are both false, so non-finite values fall through untouched by
construction. One compare + select per state word.

Applied to every recirculating kernel that had no floor:

| Site | State |
|---|---|
| `ojcore-dsp/src/lib.rs:185,186` | `Biquad` `z1`/`z2` |
| `ojcore-dsp/src/lib.rs:279` | `DelayLine` feedback write (the Q1 culprit) |
| `ojcore-dsp/src/lib.rs:421` | `OnePole::tick` (gain/pan/width/level smoothers) |
| `ojcore-dsp/src/lib.rs:547` | `KarplusString::tick` ring-down |
| `ojinstrument/src/sampler.rs:273,277` | the voice one-pole, L and R (the other Q1 culprit) |

I swept the rest: `Convolver` is a non-recursive FIR; `Adsr` already floors at
`SILENCE = 1e-4`; `Osc` is a phase accumulator. Reverb is `ConvolutionNode` (IR-based, no
feedback comb/allpass exists), and `effects.rs` reuses these same `ojcore-dsp` kernels, so
flooring them covers every built-in effect and the compiler's `delay_bank`.

### Proof it was actually broken, and is actually fixed

`crates/ojcore/tests/denormal_tail.rs` (new) runs the jam rig's real chain —
`GraphIn → Delay(time 0.3, feedback 0.34, mix 0.28) → SpeakerOut`, the exact values from
`src/rigs/presets.ts` — for one impulse then 30 s of blocks.

Reverted to HEAD's semantics locally (one-bool `sanitize`, no delay floor), it fails at
**t = 19.20 s**, matching UX-INV's ~18 s prediction:

```
test thirty_seconds_of_delay_tail_raises_no_fault_and_leaves_no_subnormals ... FAILED
panicked at crates\ojcore\tests\denormal_tail.rs:125:9:
a decaying delay tail raised an engine fault at block 7199 (t = 19.20s).
A tail is healthy audio; only NaN/Inf may be reported.
```

With the fix: `3 passed` — including `a_real_nan_still_faults` and `an_inf_still_faults`, which
are the other half of the brief (the fault channel must not be silenced).

---

## D3 — the suite's one real-engine anchor

`e2e/engine-real.spec.ts` (new, default `chromium` project, so the shared suite runs it).
It installs **no** `installEngineProbe` — everything it asserts must come from the real
`ojcore-wasm` build.

The shared `playwright.config.ts` does **not** pass an autoplay flag (journeys rely on a real
click gesture), so the spec takes `--autoplay-policy=no-user-gesture-required` in its own
`test.use({ launchOptions })`. `support.ts` and every existing spec were left untouched.

1. **`Play on a bound song rolls the transport and moves the playhead`** — `openPaperSketch`,
   Play, pill must read `Stop` within the same 1500 ms `armPendingTransportTimeout` window; the
   playhead must differ across two samples 500 ms apart; no "did not acknowledge" text anywhere;
   Stop freezes it (sampled after the `DeclickToStop` fade settles); the second Stop returns to
   the parked tick.
2. **`one key on the starter rig does not fault the engine for 40 seconds`** — the real first
   run answering "Jam some keys", one held key for 200 ms, 40 s of observation, then zero
   `.node-plugin-error-badge`, no "sending noise we can't play", no "Sound degraded".

**Both are red on HEAD's artefact.** Test 2 reproduces FH-1's report word for word:

```
1) Play on a bound song rolls the transport and moves the playhead
   Expected: "Stop"   Received: "Play"   Timeout: 1500ms

2) one key on the starter rig does not fault the engine for 40 seconds
   Expected pattern: not /sending noise we can't play/i
   Received string: "… ◐ Sound degraded … Effect is sending noise we can't play.
   We're replacing those blocks with silence, so you may hear gaps. It's still in
   the chain. Bypass it Details Effect bypassed — audio continues."
```

Green on mine:

```
ok 1 › Play on a bound song rolls the transport and moves the playhead (2.9s)
ok 2 › one key on the starter rig does not fault the engine for 40 seconds (44.2s)
2 passed (1.4m)
```

**The probe stays legitimate for the T-list.** It exists to drive deterministic ticks, which is
the right tool for specs about timeline *editing* — they should not be at the mercy of a real
audio clock on a loaded CI box. What was wrong was that it was the suite's *only* transport
voice. Now there is one anchor that the engine itself has to satisfy.

### What D3 caught — and why the memo above exists

Running the probe-based specs against the first version of my fix: **47 passed / 3 failed**,
against **50 passed / 0 failed** on HEAD. A real regression, not flake. I diagnosed it with a
throwaway spec that logged every transport frame reaching the executor:

```
DIAG motion histogram: {"0":4,"1":361}
DIAG first 25: [{m:1,s:0},{m:0,s:0},{m:0,s:0},{m:0,s:0},{m:0,s:0},{m:1,s:256},{m:1,s:768},
                {m:1,s:9600},{m:1,s:1280},…]      // s:9600 steps are the probe's; s:256 the engine's
DIAG isPlaying: false   DIAG pill: Play
```

The probe emits its synthetic `motion:1` in a microtask after `TransportPlay`, which clears
`transportPending` **before the engine has drained the command**. The engine's four honest
`motion:0` frames then land with `pending === null`, and
`arrangementStore.ts:870` (`isPlaying: … frame.motion === 0 ? false : …`) latches
`isPlaying: false` — after which `arrangementStore.ts:855`
(`if (!pending && !state.isPlaying) return;`) swallows every later `motion:1`. Deadlock.

The "speak only on change" memo removes the idle `Stopped` stream entirely, so the race has
nothing to fire. Result, run twice back to back across `timeline-preview`, `timeline-tlist`,
`arrangement-editing`, `plugins`, `pwa-smoke` and `engine-real`: **61 passed** then **67 passed,
0 failed**.

Note that `arrangementStore.ts:870` is arguably still sharp — an engine that is authoritatively
Stopped *should* win, but a frame describing the instant before a command was drained is not
evidence of that. I did not touch it (not my file, and the engine no longer emits such a frame).
Flagging it for the store's owner rather than fixing it silently.

---

## Verification — every command, with output

### Rust engine gate

```
$ cargo fmt --all -- --check
FMT CLEAN

$ cargo test --workspace --exclude oj-tauri
48 × "test result: ok"   (exit 0)
  ojcore                123 passed        ojcore-dsp     26 passed
  ojcore::denormal_tail   3 passed        ojcore-wasm    18 passed
  ojcore::transport_frame_parity 3 passed ojhost         27 passed
  ojcore::engine         23 passed        ojinstrument    8 passed
  ojcore-native          92 passed, 2 ignored

$ cargo nextest run -p ojcore            # the RT no-alloc gate (assert_no_alloc)
Summary [1.674s] 162 tests run: 162 passed, 0 skipped

$ cargo clippy -p ojcore -p ojcore-dsp -p ojcore-wasm -p ojinstrument -p ojhost --all-targets -- -D warnings
Finished (clean)

$ cargo build -p ojcore --no-default-features        # no_std core
Finished
$ cargo +nightly build -p ojcore-wasm --target wasm32-unknown-unknown -Z build-std=std,panic_abort
Finished
```

`cargo clippy --workspace --exclude oj-tauri` additionally reports **one pre-existing** warning,
`unused variable: 'parent'` at `crates/ojcore-native/src/bounce.rs:579`. It is **not mine** —
`git diff crates/ojcore-native/` is empty; it is on HEAD (commit `f0bfbd2`). Left alone as out of
scope; someone should clear it, because it fails the `-D warnings` merge gate.

### The wasm rebuild

```
$ bash src/audio/wasm/build-wasm.sh --release
Finished `release` profile [optimized] target(s)
[build-wasm] wasm-bindgen --target web -> …/src/audio/wasm/pkg …
[build-wasm] done: ojcore_wasm.js + ojcore_wasm_bg.wasm
```

The **production bundle** (not just the checked-in file) was confirmed to carry them, by parsing
`dist/assets/ojcore_wasm_bg-*.wasm`'s export section:

```
SHIPPED wasm exports: 40
   drain_transport PRESENT      load_tempo_map PRESENT      load_timeline PRESENT
   drain_meters PRESENT         drain_looper PRESENT        drain_looper_edges PRESENT
   drain_events PRESENT         has_pending_events PRESENT
```

### Web gate

```
$ bunx tsc --noEmit -p tsconfig.app.json      → clean (exit 0)
$ bun run lint                                 → clean (exit 0)
$ bun run build                                → ✓ built in 8.26s
$ bunx vitest run src/audio src/components/Export
  Test Files  25 passed (25)     Tests  357 passed (357)
$ bun run test:run
  Test Files  2 failed | 246 passed (248)      Tests  3 failed | 3176 passed (3179)
```

The 3 failures are **another lane's in-flight work, not mine** (see "Working conditions" below):
`src/ai/__tests__/agentToolsDoc.test.ts` (drift against `src/ai/tools.ts`, modified by that lane)
and two `typeFloor.test.ts` cases against `src/components/Arrangement/ArrangementSurface.css` and
`src/components/Shell/Topbar.css`. None of the three touches anything in my diff — my changed set
is entirely `crates/`, `src/audio/`, `docs/ARCHITECTURE.md` and new tests.

### The UX-INV repros, re-run against my build

Frozen production build served on **port 5246** (`vite preview --strictPort`), headless Chromium
with `--autoplay-policy=no-user-gesture-required`, Playwright driven under **node**. Scripts in
`.scratch/ux-1a/`.

**Q1 / D2 — `v1-fault-accept.mjs`** (jam rig, one key held, 40 s):

```
  t+2s … t+40s: 0 event batches, 0 carrying NodeFault     (all 20 samples)
  PASS  zero NodeFault events from the engine — 0 batches
  PASS  zero NonFinite reports — 0
  PASS  no .node-plugin-error-badge on any node — 0
  PASS  no plugin-fault card copy in the UI
  PASS  the pill never says "Sound degraded"
BODY TEXT: … | ● | Sound live | 132 ms round trip | …
=== ALL PASS ===
```

**Headed, on this box's real WASAPI device** (`v1-fault-accept-headed.mjs`) — identical, `Sound
live`, `116 ms round trip`, `=== ALL PASS ===`.

**Q2 / D1 — `v2-transport-accept.mjs`** (Paper Sketch, fully bound):

```
before Play: pill="Play" playhead="Playhead at 1.1"
  PASS  pill reaches "Stop" within 1500ms — 146ms
  PASS  playhead advances over 500ms — "Playhead at 1.1.25" -> "Playhead at 1.1.756"
  PASS  no "engine did not acknowledge" message
  PASS  Stop freezes the playhead — "Playhead at 1.2.230" == "Playhead at 1.2.230"
  PASS  second-Stop is armed (pill offers the return) — pill="Return to where playback started"
  PASS  second Stop returns to the start — "Playhead at 1.2.230" -> "Playhead at 1.1"
  PASS  pill returns to "Play" — pill="Play"
worklet -> main message counts: {"transport":86,"meters":3564,"events":0,"looper":0,"other":7}
  PASS  transport frames arrive — 86       PASS  meter frames still drain — 3564
=== ALL PASS ===
```

For contrast, UX-INV's own `q2-transport.mjs B` re-run against my build reports
`TRANSPORT frames ever received: 301` (it was **0**), and the
"engine did not acknowledge" sentence is gone from the UI.

**Shared frame plumbing — `v3-looper-frames.mjs`** (I touched the block the looper and meter
drains live in), adding a Looper through the real Ctrl+K palette:

```
a Looper node is on the canvas: true
worklet -> main after 3s with a Looper present: {"meters":284,"looper":284}
  PASS  looper snapshot frames still drain — 284
  PASS  meter frames still drain — 284
=== ALL PASS ===
```

### e2e

```
$ bunx playwright test timeline-preview timeline-tlist engine-real arrangement-editing \
      plugins pwa-smoke --project=chromium
  5 skipped
  67 passed          (and a prior run of the first four: 61 passed, 0 failed)
```

---

## What I could NOT verify

- **The native tier.** Everything above is `ojcore-wasm` + `cargo test`. `bun native` was not
  run. The D2 change is in shared code, so native gets it for free, and
  `transport_frame_parity.rs` pins the native ring encoding — but no native binary was launched.
  `cargo build --workspace` fails on this box inside `oj-tauri`'s `build.rs`
  (`resource path 'binaries' doesn't exist` — the Pi sidecar is not built here), which is why
  every Rust command above uses `--exclude oj-tauri`, exactly as CI does.
- **Real ears.** The 40 s run was headed on a real device, but nothing *listened*. I cannot say
  whether the delay tail was audible before, whether the floors changed the tail's audible decay
  (they act ~300 dB below full scale, so they should be inaudible by construction), or whether
  the master soft-limiter was masking anything. Per the covenant, feel needs a human with audio
  playing.
- **Whether the ±4 clamp branch ever fires in this rig** — UX-INV attributed Q1 to the denormal
  branch by elimination; my fix makes both branches silent, so the distinction no longer matters
  for the symptom, but I did not instrument which one fired.
- **Firefox / WebKit.** `OJ_E2E_ALL_BROWSERS` was not set; chromium only.
- **The wasm `assert_no_alloc` story.** The RT no-alloc gate runs on `ojcore` natively.
  `drain_transport` allocates a `Vec` when it speaks, in the worklet's `process()` — the same
  pre-existing pattern as `drain_meters` / `drain_looper` / `drain_events`. My change strictly
  *reduces* that (3507 → 86 allocations per idle-then-play session); it does not eliminate the
  category. Worth a follow-up: move these drains to a pre-allocated SAB ring like native's.

## Risks

1. **"Speak only on change" is a cadence divergence between tiers.** Native pushes a transport
   frame every block (gated on metering); wasm now pushes on change (ungated). The *frame* is
   identical and pinned by a test — but if a future consumer assumes a heartbeat rather than an
   edge, the browser tier will look silent. Documented at the call site; called out here because
   it is the one place I deliberately let the tiers differ.
2. **A command that changes nothing gets no acknowledgement.** e.g. Stop sent to an
   already-parked-at-the-same-sample transport would leave `transportPending` armed until the
   1500 ms timeout. I could not construct that through the UI (Stop is only reachable while
   rolling, and the second Stop is a `Seek`, which moves the sample), and both e2e runs plus the
   acceptance script exercise the full Play/Stop/Stop cycle — but it is the sharp edge of the
   memo.
3. **The floors change DSP state, so golden renders could in principle move.** They do not:
   `ojinstrument`'s `golden_render.rs` (20 tests) and `ojcore`'s `sim_oracles`
   (`same_seed_is_byte_identical`) are green. The floors only fire below 1e-30.
4. **`SanitizeReport` is a breaking signature change** for anything calling `ojcore::sanitize`.
   All four in-tree call sites are updated; an out-of-tree caller would get a compile error,
   which is the right failure mode.

## Working conditions worth flagging to the coordinator

Another lane is **actively writing this shared worktree while I ran**. I watched
`portVocabulary.test.tsx` change mtime *during* a test run, and `bunx tsc -b` fail repeatedly on
transient half-finished edits in `AppMenuBar.tsx`, `ContextMenu.tsx`, `NodeCanvas.tsx` and
`src/song/verbs.ts` (I polled until clean before each gate). The full vitest suite reported a
different failure set on each of three consecutive runs, with the collected test count changing
between them (2935 → 3102 → 3179). Treat any single full-suite result from this worktree,
including mine, as a snapshot of a moving tree.

---

# Fix round — answering `UX-1A-REVIEW.md`

Gate verdict was **SHIP-AFTER-FIXES**, 8 findings. All 8 addressed, plus the
coordinator's three extras (the Windows clippy break, the cadence/doc-truth items,
and the `browserExport.ts` build break the typed glue caused). The review was right
about the one that mattered: **F1 was a real, one-keystroke, user-reachable bug and
my original report waved it away as "I could not construct that through the UI".**
It is `Home`, on a default binding. That was a bad call and the gate caught it.

## F1 (S2, major) — a command that changes nothing is now acknowledged

**Root cause of my miss:** I built the memo around *state* ("has the transport
moved?") when the question the UI is actually asking is *delivery* ("did you hear
me?"). Those differ exactly when a command is a no-op — and a no-op command is
still a command.

**Fix — acknowledge on COMMAND, not only on change:**

- `crates/ojcore/src/exec.rs:52` — new `transport_epoch: u64` on `Engine`, with the
  reasoning in its field doc.
- `crates/ojcore/src/exec.rs:~700` — `apply_rt` bumps it in **one** place for
  `TransportPlay | TransportPause | Seek | TransportSet`, before the match body.
- `crates/ojcore/src/exec.rs:~438` — `pub fn transport_epoch(&self) -> u64`.
- `crates/ojcore-wasm/src/lib.rs:201` — `Host::last_transport` is now
  `Option<(u64, EngineFrame)>`.
- `crates/ojcore-wasm/src/lib.rs:~800` — `drain_transport` speaks when **either**
  the epoch or the frame differs. Compared by reference via `matches!`, never by
  cloning: `EngineFrame` carries a `String` in its `Error` variant, so a clone to
  compare would be a heap allocation on the render thread.

**Evidence — the gate's own case, red then green.** New e2e case
`a transport command that changes nothing is still acknowledged`
(`e2e/engine-real.spec.ts:108`): Paper Sketch, parked at `1.1`, press `Home` twice,
wait 2 s (past the 1500 ms budget). With the epoch check disabled it reproduces the
gate's finding verbatim:

```
x  a transport command that changes nothing is still acknowledged (9.1s)
   Error: expect(locator).not.toContainText(expected) failed
   Expected pattern: not /did not acknowledge/i
   ... Tab canvas The audio engine did not acknowledge the transport command.
       The last confirmed position was preserved. ...
```

With it restored: `3 passed`. Frame-level confirmation
(`.scratch/ux-1a/v4-cadence.mjs`) — the no-op seek now emits exactly one frame and
no banner:

```
=== F1: Home while already parked at bar 1 ===
playhead before/after: 1.1 -> 1.1
frames emitted by the NO-OP seek: [{"m":0,"s":0}]
  PASS  the no-op Seek is acknowledged with a frame — 1 frame(s)
  PASS  no "did not acknowledge" banner
  PASS  no "last confirmed position" banner
```

**Rust tests** (`crates/ojcore/tests/transport_frame_parity.rs`):
`a_repeated_identical_seek_advances_the_epoch_every_time` (two identical
`Seek{0}`s advance the epoch twice while the frame stays byte-identical) and
`the_epoch_tracks_transport_verbs_only` (a `SetParam` does not advance it).
`crates/ojcore-wasm`'s `drain_transport_speaks_on_change_or_on_command_never_otherwise`
covers the same through the real export.

This also answers **F3**: an on-demand re-statement exists again, so a frame the
store rejects is no longer necessarily the last one that state will ever see.

## F2 (S3) — the "build-time error" claim is now TRUE, not reworded

The review was right that the claim was false. It is now true, in the strong form:

- `src/audio/wasm/build-wasm.sh` — dropped `--no-typescript`; the script now emits
  and the repo commits `ojcore_wasm.d.ts` (16 045 B) and `ojcore_wasm_bg.wasm.d.ts`.
- `src/audio/worklets/ojcore-processor.ts:63-64` — both `@ts-expect-error`
  directives deleted; the glue is imported **with** its declarations.
- `src/components/Export/browserExport.ts:7` — the third directive, which the typed
  glue made an unused-directive error (TS2578) and which broke `bun run build` for
  the UX-1C lane. Removed under the coordinator's explicit authorisation; that one
  import comment is the only change in that file.

**Proof the guard is real** — deleting `drain_transport` from the committed `.d.ts`:

```
$ bunx tsc --noEmit -p tsconfig.app.json
src/audio/worklets/ojcore-processor.ts(551,45): error TS2339: Property
'drain_transport' does not exist on type 'typeof import(".../ojcore_wasm")'.
```

A missing engine export is now caught **twice** — by `tsc`, and by
`wasmExportParity.test.ts` against the shipped `.wasm`'s own export section. The
declarations catch a *missing* export; the parity test additionally catches the two
halves of the artefact being committed out of sync with each other, which types
cannot see. Both comments and `docs/ARCHITECTURE.md` now say exactly this.

**F2's second half — degrade, never die.** `wasm.drain_transport()` is now inside
the surrounding `try` (`ojcore-processor.ts:~547`), not merely the decode. An
exception out of `process()` permanently disables an AudioWorkletProcessor, so a
stale artefact would have cost the player *all their sound* rather than their
playhead readout. It now costs the readout, reports once via a new
`transportDrainFailed` latch (`:180`) so a per-quantum failure cannot storm the
main thread, and the audio keeps flowing. A held note beats a glitch.

Side effect handled: wasm-bindgen stamps `/* eslint-disable */` on the generated
`.d.ts` too, where it is unused — two eslint warnings. `build-wasm.sh` now strips
that one line from the declarations only, so the committed artefact is lint-clean
with no special-casing in `eslint.config.js` (not my file). `bun run lint` is
silent.

## F3 (S3) — at-most-once delivery

Largely dissolved by F1 (a command always re-states). Flagged explicitly for the
store owner, as the review asked: **`receiveTransportFrame`'s four early `return`s
are now load-bearing.** Under the old always-on heartbeat a rejected frame was
re-offered ~94×/s; today a frame the store drops for a state reason is gone unless
a later command or a real change produces another. Any new guard added there must
be provably correct rather than merely conservative. `src/store/**` is not mine and
I did not touch it.

## F4 (S4) — cadence doc truth

`~10 Hz` → `every 4 render quanta — every ~10 ms, i.e. ~94x/s at 48 kHz / 128` in
`crates/ojcore-wasm/src/lib.rs:776` and in the worklet's own block comment
(`ojcore-processor.ts:519`), which also now points at the new ARCHITECTURE.md gap
section.

## F5 (S4) — one denormal floor, not two

`crates/ojcore/src/resilience.rs:30` now does
`use ojcore_dsp::guards::DENORMAL_FLOOR;` and the private const is deleted. The two
had to agree or the false fault card returns; they are now the same number, with a
comment saying why. (`ojcore` already depended on `ojcore-dsp`.)

## F6 (S4) — the vacuous assertion is gone; the real one exists

The review was correct that the master-buffer subnormal check could never fail —
`sanitize` flushes that buffer in the same block. Removed from
`crates/ojcore/tests/denormal_tail.rs`, and the module doc now says *why* it is
absent so nobody re-adds it thinking it proves something.

Replaced with kernel-level tests that inspect the state the floor actually protects
(`crates/ojcore-dsp/src/lib.rs`):
`delay_feedback_state_never_parks_in_the_subnormal_band` (one impulse, 0.34
feedback, 70 laps — past the ~64 it takes 1.0 to reach 1e-30 — then every word of
`DelayLine::buf` is checked, plus a counter-assertion that the tail really did
decay so the test cannot pass on a line that never got quiet) and
`one_pole_settles_to_exact_zero_not_a_subnormal`.

Both proven non-vacuous by removing the floors:

```
test tests::delay_feedback_state_never_parks_in_the_subnormal_band ... FAILED
test tests::one_pole_settles_to_exact_zero_not_a_subnormal ... FAILED
```

## F7 (S4) — the native PRODUCER is pinned, not just the codec

New `the_frame_the_native_ring_publishes_is_the_shared_assembler_s_frame`
(`transport_frame_parity.rs`): attaches a real `MeterRing`, runs 12 real
`process_block`s while rolling, pops what the engine actually published, and
asserts it equals `transport_frame_now()`. Re-deriving the position inside
`publish_levels` — the exact drift this work removed — now fails here.

## F8 (S4) — the silent `u32 → u16` beat narrowing

Fixed rather than merely documented, and **without a wire change**.
`transport_frame` is split so `publish_levels` takes the position read **once** and
keeps `pos.beat` at full `u32` for `encode_beat`, while
`transport_frame_at(&pos)` builds the one canonical transport frame from that same
read (`exec.rs:~393` and `~560`). The `Beat` frame therefore carries `u32` again, as
it did before this lane. The remaining `u16` saturation inside
`EngineFrame::Transport` is now stated in `transport_frame_at`'s doc. `ojproto` is
still untouched — `git diff --stat crates/ojproto/` is empty.

## Coordinator extras

**Windows clippy (`crates/ojcore-native/src/bounce.rs`).** `sync_parent` is now
split by platform rather than `#[cfg]`-ing statements inside one body — on Windows
every local in it was genuinely unused, and the naive one-line fix just moved the
warning to `path` and the `PathBuf` import. `cargo clippy --workspace --exclude
oj-tauri --all-targets -- -D warnings` now **passes** (it failed on HEAD).

**Doc truth / named follow-up.** `docs/ARCHITECTURE.md` gains
**"Known gap: the wasm return path allocates on the render thread"**: all five
drains allocate in the render callback by the pre-existing design of that path;
`assert_no_alloc` covers neither `ojcore-wasm` nor `publish_levels` (its scopes wrap
native `process_block` with no ring attached), so `transport_frame` is alloc-free by
inspection only. Filed as **`OJ-RT-WASM-RING`** — move the drains onto a
pre-allocated SAB ring like native's and extend the no-alloc gate to
`publish_levels` with a ring attached. **Not fixed here**, as instructed.

## Fix-round verification

| gate | result |
|---|---|
| `cargo fmt --all -- --check` | clean |
| `cargo test --workspace --exclude oj-tauri` | **exit 0**, 0 failed |
| `cargo nextest run -p ojcore` (RT no-alloc gate) | **165 run, 165 passed** (was 162; +3 new) |
| `cargo clippy --workspace --exclude oj-tauri --all-targets -- -D warnings` | **passes** — was RED on HEAD |
| `cargo build -p ojcore --no-default-features` | ok |
| `cargo +nightly build -p ojcore-wasm --target wasm32-unknown-unknown -Z build-std` | ok |
| `bunx tsc --noEmit -p tsconfig.app.json` | clean |
| `bun run lint` | clean, **0 warnings** |
| `bun run build` | `✓ built in 4.06s` |
| `bun run test:run` | **249 files / 3190 tests, 0 failed** — the tree finally settled; the other lanes' in-flight failures both reports saw are gone |
| `bunx vitest run src/audio src/components/Export` | 25 files / 357 passed |
| `e2e/engine-real.spec.ts` ×2 | **3 passed** both times |
| `engine-real + timeline-preview + timeline-tlist + arrangement-editing` | **62 passed**, 5 skipped, 0 failed |

**30-sample playhead cadence, re-run after the epoch change** — every 100 ms sample
distinct and monotone, no stalls:

```
["1.1.426","1.1.555","1.1.713","1.1.856","1.2.39","1.2.211","1.2.369","1.2.513",
 "1.2.642","1.2.799","1.2.943","1.3.140","1.3.284","1.3.427","1.3.570","1.3.714",
 "1.3.871","1.4.40","1.4.198","1.4.342","1.4.485","1.4.628","1.4.786","1.4.929",
 "2.1.113","2.1.270","2.1.414","2.1.557","2.1.700","2.1.858"]
stalls: []
  PASS  every 100 ms sample advances (no stall) — 30 samples
worklet -> main totals: {"ready":1,"graph-ack":5,"sample-stored":1,"meters":3956,"transport":349}
  PASS  meters still drain — 3956
```

Final artefact (rebuilt with the pinned `wasm-bindgen 0.2.125`):

```
102f56bbc608d06b6b98c6d4a51aa683  src/audio/wasm/pkg/ojcore_wasm_bg.wasm   394 432 B
296a42dda56cf38ad5608827404f6260  src/audio/wasm/pkg/ojcore_wasm.js         22 642 B
558c0e31e6a33cd1c7454d7d83650382  src/audio/wasm/pkg/ojcore_wasm.d.ts       16 045 B
4fbe6f88ff466038fca3ee2ecd9f4e59  src/audio/wasm/pkg/ojcore_wasm_bg.wasm.d.ts 2 000 B
```

## Still not verified after the fix round

Unchanged from the first report, and the review agreed on every one: **the native
tier** (no `bun native`; `cargo build --workspace` still dies in `oj-tauri`'s
`build.rs` on this box), **real ears** (the 40 s run was headed on a real WASAPI
device, but nothing listened — the floor is 1e-30 ≈ -600 dBFS so inaudibility is
reasoned, not heard), **loop-wrap measured end to end**, and **Firefox/WebKit**
(`OJ_E2E_ALL_BROWSERS` unset).

One new item: I did **not** empirically induce the stale-artefact worklet crash that
F2's `try` now contains — doing so means shipping a deliberately broken binary. The
`try` placement and the AudioWorklet spec's "an exception in `process()` disables the
processor" are the argument; the one-shot `transportDrainFailed` latch is reviewed by
inspection.

## Risks, revised

The original Risk #2 — "a command that changes nothing gets no acknowledgement" — is
**closed** by F1; it was not a hypothetical, it was `Home`. Remaining:

1. **Cadence divergence between tiers** (unchanged): native publishes every block
   gated on metering, wasm publishes on epoch-or-change ungated. The frame is
   identical and now pinned by two tests including the native producer. A consumer
   assuming a heartbeat rather than an edge would still be surprised.
2. **F3's at-most-once property** — flagged above for the store owner.
3. **The 1500 ms budget is real for the first time.** As the review notes, under
   heavy load it can genuinely expire and show the banner. Strictly better than HEAD
   (where it expired 100% of the time), but it is a live flake surface, and the
   engine now has a `transport_epoch` that would make a retry cheap if it becomes a
   problem.
