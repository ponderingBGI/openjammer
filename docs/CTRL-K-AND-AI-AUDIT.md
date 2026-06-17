# Ctrl+K + Pi Agent — M0–M7 Completion Audit

> Read-only audit (9 parallel agents) of the shipped implementation vs the
> `docs/CTRL-K-AND-AI-PLAN.md` acceptance criteria. Generated 2026-06-17.
> Every claim is grounded in a `file:line` reference the agents actually read.

## 1. Status Overview

| Milestone | Status | Gate | Confidence |
|---|---|---|---|
| M0 — Capability seam | complete | passes | high |
| M1 — Pi transport truth | partial | exists-untested | high |
| M2 — Action registry + local frecency | complete | passes | high |
| M3 — Read tools + grounded reasoning + atomic batch | partial | exists-untested | high |
| M4 — Unification (right-click = projection) | complete | exists-untested | high |
| M5 — Open node identity end-to-end | complete | passes | high |
| M6 — Code-node authoring (Faust → wasm) | partial | external-blocked | high |
| M7 — Auth chooser, persistent intelligence, packages, plan/validator | partial | exists-untested | high |

---

## 2. Per-Milestone Findings

### M0 — Capability seam — `complete` / passes
The `EngineCapabilities` seam is a single closed record (`src/engine/capabilities.ts:29-65`) with desktop/browser rows, consumed by AI/auth/learning gates and integration-tested (`capabilities.test.ts:39-45`). It is real and load-bearing.

**Gaps**
- Exhaustive-switch + `assertNever` compile-error guarantee exists for ONLY the agent axis (`capabilities.ts:105-116`). auth/learning/codeNodes are read via `!== 'none'` / `=== 'pi-memory'` booleans (`authStore.ts:113`, `paletteLearningSeed.ts:48`, `AiPanel.tsx:52`), so adding a variant to those three would not break the build anywhere.
- `codeNodes` axis has NO runtime consumer — it is carried in the record, the two rows, and tests, but never read to gate behavior.
- `'paste-proxy'` exists in the auth union as required but is reserved/unwired.

### M1 — Pi transport truth — `partial` / exists-untested
The real Pi RPC wire protocol is implemented and fully Rust-unit-tested for every event mapping (`src-tauri/src/ai.rs:327-512`, tests `1133-1223`), with a spawn-time `get_commands` handshake and fatal-error semantics. The frontend mirrors the five event kinds 1:1 (`PiAgentBackend.ts:39-82`). What is missing is the explicitly-named acceptance gate.

**Gaps**
- No real-Pi e2e exists — no test file, no CI job, no feature flag. The tool-call→graph path is proven only with Pi MOCKED on the frontend (`backend.test.ts:48-72`).
- Handshake mismatch surfaces a per-run terminal `error` (`PI_HANDSHAKE_HELP`, `ai.rs:615-617`), NOT the D5-A3 capability-level "reasoned agent:none" — `getCapabilities().agent` stays a static constant (`OjcoreNativeExecutor.ts:148-150`). Intent met; named mechanism not.
- `src-tauri/README.md:110-116` is stale: still documents the OLD protocol.

### M2 — Action registry + local frecency — `complete` / passes
A real `Action` type with a D1-A1 legacy-normalize path, a 5-day-half-life frecency store with per-day cap and corrupt-blob reset, and a genuine fzf subsequence scorer all exist and are well-tested (`commandRegistry.ts`, `paletteLearningStore.ts`, `paletteScore.ts`). All three D2-A2 palette assertions pass.

**Gaps**
- Performance budget unverified: "palette open <50ms, keystroke <16ms on a hundreds-item set" has NO automated benchmark.
- No test asserts the static-node `frecencyKey` equals `'node.add.${type}'` at the `useCommandSources` level (correct by construction).

**Bug** — Double-filter (see Bugs §3 #4).

### M3 — Read tools + grounded reasoning + atomic batch — `partial` / exists-untested
The frontend substrate is real and strongly tested: read tools backed by the live store adapter (`tools.ts:483-514`), fail-closed `batch_apply` with per-sub-call status, post-state snapshot and revert-in-reverse (`tools.ts:533-593`), and a production-wired G2 collab guard emitting exactly one CRDT commit (`graphStoreBridge.ts:137-162`, convergence tests `337-423`). The live-Pi round-trip and the sound-producing demo are gated/absent.

**Gaps**
- Real `ToolResult.data` round-trip to a live Pi is NOT wired: `pi-openjammer-graph/index.ts:50-56` `forward()` throws; backend is one-way (`ai.rs:399-438`); store only RENDERS relayed events ("M7 owns the real relay", `agentSessionStore.ts:373-385`).
- Named real-Pi e2e absent (external-blocked: no provider key in CI).
- "agent builds keyboard→looper→speaker in one Approve that produces sound" has no automated coverage.

### M4 — Unification (right-click = projection) — `complete` / exists-untested
The right-click `ContextMenu` is a real filtered projection of the same Action registry the palette reads (`ContextMenu.tsx:24-25,105-109`), nested-category UX preserved via `path[]`, AI nodes on both surfaces, DOM byte-faithful to the prior menu. Render tests cover projection, palette-only exclusion, MIDI special case (`ContextMenu.test.tsx:84-160`).

**Gaps**
- The named "menu screenshot-diff" gate has NO automated artifact (no playwright/percy in repo). Manual visual check; the `path[]` structural fallback IS implemented, so intent met but not runnable.

### M5 — Open node identity end-to-end — `complete` / passes
`pluginId?` round-trips alongside the closed `type` through serialize/import with a real version bump (`serialization.ts:30,58-60,126-132`), legacy DSP nodes migrate at load (`migrateLegacyDspNode:204-226`), dynamic defs self-heal (`selfHealDynamicPlugin:238-255`), and the AI authoring path stamps identity (`agentSessionStore.ts:197-207`). Round-trip, migrate, no-orphan all test-covered.

**Gaps**
- Naming-vs-criterion mismatch (not a defect): dynamic acceptance lives in the new `isRegisteredPluginId` (`registry.ts:824`), not `isPluginId`. Cleaner design.
- Migration is a pure-JS re-key on `shortHash(faustSource)`, not a content-address of compiled wasm (correct for M5; wasm re-lowering is M6).

### M6 — Code-node authoring (Faust → wasm) — `partial` / external-blocked
The authoring half is real and tested up to the wasm bytes: ojfaust Path B shells `faust` (`backend.rs:69-140`), `compile_repair_with` repair loop (`lib.rs:265-312`), fail-closed `author_wasm_node` with host-side manifest validation (`ai.rs:989-1064`), permanent host output guards (`guards.rs`). The native execution half does not exist.

**Gaps**
- Native wasmtime RT host is ABSENT: no `wasmtime`/`cranelift`/`wasmi` in any Cargo.toml; `PrimitiveKind::WasmHost` (`ojproto:51`) is wire-serialized but NEVER lowered in `crates/ojcore/src/compile.rs`. No pooling/AOT/epoch/quarantine.
- Authored wasm bytes are DISCARDED (`ai.rs:1056-1063`): returns only `wasm_hash`, never stores bytes.
- The `'effect'`+`faustSource` shoehorn is NOT atomically retired (`agentSessionStore.ts:197`, `dynamicRegistry.ts:132`).
- The <5ms benchmark, Faust→wasm→SOUND CI test, golden-render A/B, pathological-wasm guard-fire test cannot exist without the RT host (external-blocked: libfaust + hardware + execution host).

**Bugs** — see §3 #1 and #2.

### M7 — Auth chooser, persistent intelligence, packages, plan/validator — `partial` / exists-untested
The pure/logic layer is real and tested: D6-A1 conflict-by-outcome incl. empty-`$VAR` (`auth.rs:114-178`), RFC7636 PKCE S256 (`auth.rs:193-274`), a compliant non-dismissible AuthChooser with Zen default, key never persisted (`authStore.ts:227-230`), and the plan/planValidator/emit_plan advisory stack with the Pi-memory seed floor invariant. The persistent-runtime and live-package halves are missing.

**Gaps**
- Persistent Pi subprocess across Tabs + warm model selection (D6-A2) NOT implemented; `ai_run` spawns per-run (`ai.rs:178-189`).
- Workspace split (stable HOME + disposable per-run cwd, D5-A2) NOT implemented; still the throwaway worktree (`ai.rs:619-679`).
- `pi-persistent-intelligence` install only in docs; `fetchSeedBoosts()` is a stub returning `{}` (`paletteLearningSeed.ts:31-34`).
- `pi-openjammer-graph` live wiring: `forward()` throws; `oj_install/list_packages` + host-mediated "save package" absent (docs only).
- Live keychain/loopback-PKCE/HTTP-validate bodies remain founder-gated stubs (`auth.rs:352-406`).

**Bugs** — see §3 #3 and #5.

---

## 3. Consolidated Bugs (deduped, severity-ordered)

| # | Sev | Location | Bug |
|---|---|---|---|
| 1 | High | `capabilities.ts:74` | `codeNodes='author-and-run'` but no wasm can run on the audio thread (no wasmtime host; `WasmHost` never lowered). Wrong value at the capability boundary (PLAN.md:726-728 risk; violates D4-A3). Authored nodes register as `ai.wasm.<hash>`/WasmHost but are silently inaudible unless they fall back to the legacy `effect` path. |
| 2 | High | `ai.rs:1056-1063` | `author_wasm_node` returns `wasmHash` but discards the wasm bytes — an `ai.wasm.<hash>` node can never be content-resolved/executed later, even once an RT host exists. |
| 3 | Medium | `ai.rs:201-213` | When `conflict=true`, `key_for_env=None` defers to Pi's `auth.json`; but `auth_get_key` is a founder-gated stub and keychain is unwired, so a user with both a pasted key and a resolvable `auth.json` key has the only usable (param) key dropped. Untested e2e. |
| 4 | Medium | `CommandBar.tsx:196-208` + `commandRegistry.ts:328-334` | Double-filter: `queryActions` substring-prefilters before the `paletteScore` subsequence scorer, so pure-subsequence queries (`'adlp'→'Add Looper'`) are dropped — silently defeating the fzf promise. |
| 5 | Low | `plan.ts:130,141-147` | Plan params applied twice (`add_node.initialData` then a separate `update_node_data`). Intentional for undo symmetry; duplicated work. |

---

## 4. Prioritized Completion Plan

Ordered to unblock the most downstream work first (the native RT host gates M3/M6 sound and several e2e gates).

1. **Implement the native wasmtime RT host** — `wasmtime` dep; pooling allocator, AOT `.cwasm`, `epoch_interruption` Bypass-on-trip, off-RT quarantine warm-up. `[needs-rebuild]` — large; keystone for M6 + the M3 sound demo.
2. **Lower `PrimitiveKind::WasmHost`** in `crates/ojcore/src/compile.rs` to an executable instance through `ojcore-dsp::OutputGuard`. `[needs-rebuild]` — medium; depends on #1.
3. **Persist authored wasm bytes** in a content-addressed store, re-resolve by `ai.wasm.<hash>` on load (fixes bug #2). `[verifiable-here]` — medium.
4. **Atomically retire the `'effect'`+`faustSource` shoehorn** and correct `codeNodes` to an honest value until execution lands (fixes bug #1). `[verifiable-here]` — small-to-medium; pairs with #2.
5. **Wire the live-Pi round-trip**: implement `pi-openjammer-graph` `forward()` against a host RPC bridge + a stdin write-back path in `ai.rs`. `[needs-rebuild]` — large; satisfies M3 round-trip.
6. **M7 workspace split + persistent Pi subprocess** (stable HOME + disposable cwd; warm subprocess across Tabs) replacing the throwaway worktree. `[needs-rebuild]` — large.
7. **`pi-persistent-intelligence` install + project-local `localPath`**, replace the `fetchSeedBoosts()` stub with real recall. `[needs-rebuild]` — medium; depends on #6.
8. **`oj_install_package`/`oj_list_packages` + host-mediated "save package"**. `[needs-rebuild]` — medium.
9. **Fix the M2 double-filter** (bug #4): drop the substring prefilter or make `queryActions` subsequence-aware; add a pure-subsequence palette test. `[verifiable-here]` — small.
10. **Real-Pi e2e scaffold + feature-flagged CI job** (prompt/`tool_execution_start`/`agent_end`, tool call reaching graph, data returned, forced vocabulary-mismatch). `[external-blocked: live-Pi, CI-key]`; scaffold is `[verifiable-here]`.
11. **Codex system-prompt preamble CI assert (D6-A4)**. `[verifiable-here]` — small.
12. **Wire `agent` capability downgrade to reasoned `'none'`** on handshake mismatch (D5-A3 literal). `[verifiable-here]` — small.
13. **Gated benchmarks/golden tests**: native 64-sample <5ms, Faust→wasm→SOUND, golden-render A/B, pathological-wasm guard-fire. `[external-blocked: libfaust, hardware]`; depend on #1/#2.
14. **M2 perf benchmark** (palette open <50ms, keystroke <16ms). `[verifiable-here]` — small.
15. **Menu screenshot-diff artifact** for M4's named visual gate. `[verifiable-here]` — small-to-medium.
16. **Close the remaining capability axes with `assertNever` switches** (auth/learning/codeNodes); wire or remove the unwired `codeNodes` consumer + `'paste-proxy'`. `[verifiable-here]` — small.
17. **Wire `compile_repair_with` into `author_wasm_node`**. `[verifiable-here]` — small.
18. **Doc reconciliation**: update `src-tauri/README.md:110-116`; fix stale transport docstrings. `[verifiable-here]` — trivial.
19. **Decide on the M5 degenerate-file caveat + plan param double-apply** (bug #5). `[verifiable-here]` — trivial.

---

## 5. Bottom Line

**Genuinely DONE:** the entire frontend/logic substrate. M0 (capability seam), M2 (action registry + frecency + fzf), M4 (right-click as a registry projection), and M5 (open node identity round-trip + migrate + no-orphan) are real, consumed, and test-passing. The Pi wire protocol (M1), the read/atomic-batch/collab-guard substrate (M3), the Faust→wasm authoring chain up to bytes (M6), and the auth-chooser/PKCE/plan-validator/seed-floor logic (M7) are all real and unit-tested.

**What "fully complete" still requires** is everything that touches a live runtime: there is no native wasmtime host (so authored DSP cannot make sound and `codeNodes='author-and-run'` is a false capability), no live-Pi round-trip (the package `forward()` throws and the backend is one-way), no persistent subprocess / workspace split / project-local memory, no live package install, and no real-Pi e2e or gated audio/perf/screenshot benchmarks in CI.

The work is an honest, well-tested skeleton with the hard execution layer (native wasm RT + live-Pi relay + persistence) deliberately deferred — plus a small set of real, fixable bugs (the capability-boundary lie at `capabilities.ts:74`, discarded authored bytes at `ai.rs:1056-1063`, the conflict key-withhold, and the palette double-filter).
