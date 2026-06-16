# OpenJammer — Ctrl+K Command Palette + Pi AI Agent: Implementation Plan

> **Document of record.** This is the definitive, executable plan for the unified Ctrl+K
> command palette and the Pi AI agent. It is grounded in the real codebase (file/line refs
> are accurate as of this writing). Every engineer working this lane should treat the
> "Decisions at a glance" table and the **ROADMAP** as binding, and read the relevant
> per-area section before touching code.

## North star

OpenJammer is a node-based live-performance music tool ("ComfyUI for audio"). The user does
**everything** from one **Ctrl+K** palette — a Raycast-grade, blazingly-fast, learns-me command
bar that is a strict **superset** of the friendly right-click menu (adding a feature to one adds
it to both, because they are built from the **same action registry**). Pressing **Tab** in that
bar hands the typed query to a **full Pi coding-agent** that can build a whole connected,
sound-producing workflow the user can immediately play, **prefers reusing** existing nodes and
stitching them together (press **E** to enter the result and rewire it himself), but can also author
a brand-new **"crazy effect node" in code** (the founder's words) — all behind a transactional
**Approve/Reject** gate, with nothing auto-executing. The agent delivers the **native Pi experience**:
it learns the user via the [`pi-persistent-intelligence`](https://pi.dev/packages/pi-persistent-intelligence)
package, and can install **and author** Pi packages/plugins for Pi itself. We ship a **HYBRID spine**
anchored on one `EngineCapabilities` descriptor: native Tauri is the flagship (Rust-owned Pi RPC
subprocess, OS-keychain auth, libfaust/wasmtime), the browser PWA is an honest
progressively-degrading subset. Auth defaults to ToS-safe paths (opencode **Zen** BYO-key, Codex
OAuth, Anthropic API key) — **never** a Claude Pro/Max subscription button.

> **Founder vision coverage map.** Unification rule + Ctrl+K superset → **D1**. Learns the user →
> **D2** (palette frecency) + **D5** (Pi persistent intelligence). Tab → full Pi agent → **D5** + the
> CommandBar Tab fast-path. Build a whole working/sound-producing workflow → **D3**. Reuse-first then
> code nodes (incl. "press E to enter") → **D3** + **Cross-cutting §1**. Crazy effect node in code →
> **D4**. Native Pi experience + install/author packages + persistent intelligence → **D5**. ALL auth
> options + Zen default + ToS stance → **D6**. Seamless native first-Tab onboarding → **D6**.
> Carefully-crafted agent docs (Pi-style) → **Cross-cutting §3**.

---

## Decisions at a glance

| Area | Chosen approach | Decided **X** over **Y** because **Z** |
|---|---|---|
| **Spine** | HYBRID, anchored on one `EngineCapabilities` descriptor returned by the active `Executor`; native flagship + browser honest subset. | Hybrid over native-first/browser-first because native-first scatters platform gating and concedes the browser AI value prop, while browser-first makes an operated server (proxy + Faust build farm + key custody) a hard product dependency and kills offline/<5ms/zero-egress. |
| **D1 — Unified action model** | Lean `Action` registry (`targets`, `enabled(ctx)`, `surfaces`, `run(ctx)`); right-click = a filtered projection. Graft B's typed capability union + central `buildContext()`; defer `menus[]`/`when`-DSL and `nodeToolbar`. | Additive-`surfaces` flag over B's `menus[]` placement DSL because for hundreds of items a single boolean + a superset unit test gives the same "adding to one adds to both" guarantee at a fraction of the abstraction tax. |
| **D2 — Raycast UX + learning** | Local-frecency store as the load-bearing "learns me" floor (frecency + context-key + prefix-win, 5-day half-life, persisted); Pi-memory as an **optional, additive, native-only** seed boost gated by `caps.learning`. | Local-first over Pi-memory-first because the headline "fast/learns me" must ship identically to both platforms, be sync/O(1)/offline/private/resettable, and not couple a pure-frontend UX win to the fragile `ai.rs`/throwaway-worktree/governance-latency machinery. |
| **D3 — AI agent orchestration** | Rich introspection + atomic `batch_apply` substrate; `emit_plan`/`validate_plan` grafted as one optional plan path that **compiles into** `batch_apply`; reads return real post-state to Pi. | Read-tools+`batch_apply` substrate over plan-DSL-first because the reads are the non-negotiable fix for phantom-graph reasoning and `batch_apply` is the single transaction/undo primitive both paths share — we pay the validator cost only as a pure pre-flight gate, not the mandatory write path. |
| **D4 — Code-node execution** | One WASM contract (`oj_*` C-ABI) hosted by `WasmHost`, identical native (wasmtime pooling+AOT+epoch) and browser (AudioWorklet); AI authors **Faust** lowered via `faust -lang wasm`; libfaust JIT is a native latency optimization only. | One-artifact-WasmHost over Faust-native-JIT-as-primary because two artifacts (native JIT + browser wasm) are a permanent golden-render parity tax; the single `.wasm` runs unchanged on both, and Faust-as-source keeps LLM ergonomics + the existing repair loop. |
| **D5 — Pi integration depth** | `subprocess-rpc-plus`: keep Rust-owned `pi --mode rpc`, fix the wire protocol, **split stable HOME + disposable per-run cwd**, ship a first-party `pi-openjammer-graph` package whose tools round-trip real post-state, install `pi-persistent-intelligence` with a project-local `localPath`. | Subprocess over the Node SDK/embed because the subprocess keeps the sandbox in Rust (env_clear+allowlist+keychain) and lets Pi keep its full toolset (so it can genuinely install/author Pi packages), avoiding a 40-90 MB bundled Node runtime + Pi/Node CVE ownership. |
| **D6 — Auth & onboarding** | OpenJammer-managed auth: native keyboard chooser, OS keychain at-rest, loopback-PKCE for Codex, Zen BYO-key default with data-training notice; **plus** a mandatory `ai_auth_status` reconciliation probe that defers to credentials Pi already owns. | Managed-auth over delegate-to-`pi /login` because `/login` is terminal-flavored + version-fragile + not exposed over RPC and concedes the keychain; managing it gives the native keyboard window the founder wants and the strongest at-rest posture, with the `auth_status` probe importing delegate's one good idea (don't fight Pi's `auth.json`). |

---

## Architecture spine — the capability matrix

**One seam.** All platform branching reads `Executor.getCapabilities() → EngineCapabilities`.
**No consumer calls `isTauri()` / `getInvoke()` / `backend.available()` directly** after this lands.
`EngineCapabilities` is a discriminated union consumed via **exhaustive switch**, so a missing
arm is a *type error* (not a silent `'none'`).

```ts
// src/engine/capabilities.ts  (NEW — the ONE canonical union; every lane imports this)
export interface EngineCapabilities {
  agent:     'pi-subprocess' | 'remote-proxy' | 'none';
  codeNodes: 'author-and-run' | 'run-only'   | 'none';
  auth:      'keychain-loopback' | 'paste-proxy' | 'none';
  learning:  'pi-memory' | 'local-only';
}
```

> **G4 (coherence): there is exactly ONE field set.** The redundant `codeNodeAuthoring: boolean`
> proposed in some lanes is dropped (subsumed by `codeNodes`). Do not redefine this type per-lane.

| | Desktop (Tauri) | Browser (PWA) |
|---|---|---|
| **`agent`** | `'pi-subprocess'` — Pi RPC subprocess, Rust sandbox, Tab→Pi, builds whole connected workflows | `'none'` (honest "AI requires the desktop app"); `'remote-proxy'` only if OJ ever operates one |
| **`codeNodes`** | `'author-and-run'` — Faust→wasm (`WasmHost`) + optional libfaust JIT; wasmtime pooling+epoch+quarantine | `'run-only'` — same content-addressed `.wasm` in the AudioWorklet; authoring needs a cloud build endpoint |
| **`auth`** | `'keychain-loopback'` — OS keychain at-rest + loopback PKCE (Codex `localhost:1455`); Zen/BYO/API-key/Codex | `'paste-proxy'` (future) / `'none'` today — no keychain, no loopback |
| **`learning`** | `'pi-memory'` (if Pi installed + configured) layered over local frecency | `'local-only'` (IndexedDB/localStorage frecency) |

**Ships identically to both platforms (pure frontend, capability-agnostic):** the command palette,
frecency ranking, right-click menu, the unified `Action` registry, and all manual graph editing.

**Where the seam is wired:** `Executor` (`src/audio/executor/Executor.ts`) gains
`getCapabilities(): EngineCapabilities`; `OjcoreNativeExecutor` returns the desktop row,
`OjcoreWasmExecutor` returns the browser row. `AiPanel`'s gate becomes `caps.agent !== 'none'`
(today it is `backend.available()` at `AiPanel.tsx:42`).

### Invariants every area must preserve

1. **One capability seam.** Read `getCapabilities()`; never `isTauri()`.
2. **One code-node artifact.** AI authors Faust → always lower via `faust -lang wasm` to one
   content-addressed `.wasm`; libfaust JIT is an optimization, never required for a node to exist/round-trip.
3. **RT invariants are absolute.** No alloc/lock/block in the audio callback: wasmtime pooling
   allocator + pre-grown linear memory (no `memory.grow`/WASI on RT), epoch watchdog → **Bypass**-on-trip
   (never panic), off-RT quarantine warm-up, **permanent** NaN/denormal scrub + hard limiter + DC-block in
   the host wrapper. `assert_no_alloc` CI guard stays.
4. **Untrusted-generator + transactional/reversible.** Nothing auto-executes; tool calls apply
   optimistically with undo closures and gate Approve/Reject (`agentSessionStore`).
5. **Sandbox + secret boundary (native).** Pi stays a stripped-env subprocess (env_clear+allowlist);
   the long-lived secret lives in the OS keychain and is injected only as the single
   `OPENJAMMER_AI_KEY_VAR` env var — never persisted to OJ's disk. Forward HOME/USERPROFILE so `~/.pi`
   auth+memory survive.
6. **ToS-safe auth ladder.** Default = Zen BYO-key (non-dismissible data-training notice) + Codex OAuth +
   Anthropic API key (labeled "billed per token, not Pro/Max"). **Never** ship/default a Claude Pro/Max
   subscription-OAuth button.
7. **Open node identity end-to-end.** Carry a dynamic `pluginId: string` alongside the closed `NodeType`;
   route registered unknown ids to `AutoParamPanel` (fed manifest `ParamDecl[]`); persist + content-address
   the `.wasm` and re-resolve on load — retiring the `'effect'`+`faustSource` shoehorn in `tools.ts`.

### Two cross-cutting reconciliations (authoritative)

**G1 — ONE approval model.** Graph tools (the six v1 verbs + `batch_apply`/`emit_plan`) **apply
optimistically host-side on `tool_execution_start`** via `applyToolCall`, **return real post-state to
Pi** (so Pi reasons grounded — it needs the real node id to wire the next connection in the same turn),
and record undo closures. The **single Approve/Reject fires once at `agent_end`/`turn_end`** through the
existing `agentSessionStore`. `extension_ui_request:confirm` is **reserved only** for genuinely
interactive non-graph prompts (auth, destructive ops). Delete per-call-confirm language elsewhere.

**G2 — CRDT/collab guard (no decision-lane owned this; it is a named deliverable here).**
`src/collab/graphStoreBridge.ts` subscribes to `graphStore.version` and diffs *every verb* into the CRDT
(`graphStoreBridge.ts:84-89`). AI tool calls mutate through those same verbs, so in a live collab session
each optimistic AI verb would broadcast to peers **before Approve**, and a Reject's undo closures would
broadcast too — leaving peers with phantom nodes. **Fix:** wrap the entire agent run in the bridge's
`applyingRemote`-style guard so optimistic AI mutations are NOT diffed to peers until Approve; on **Approve**
emit **one** CRDT commit for the whole frame; on **Reject** emit nothing. This makes `batch_apply`'s
single-undo-frame and the CRDT's single-commit align. See **D3** for the exact hook.

---

## D1 — Unified action model (Ctrl+K ⊇ right-click, one registry)

**Goal.** Make right-click a *filtered projection* of the same registry the palette reads, so adding an
action to one surface adds it to both. Generalize today's purely-global `Command.run()` (no targeting,
`commandRegistry.ts:29-40`) to a context-aware `Action`.

### Files & types

- **`src/engine/capabilities.ts`** (NEW) — the canonical `EngineCapabilities` union (above).
- **`src/audio/executor/Executor.ts`** — add `getCapabilities(): EngineCapabilities` to the interface
  (currently absent — confirmed); both executors implement their matrix row.
- **`src/store/commandRegistry.ts`** — evolve `Command` → `Action`:

  ```ts
  export type TargetKind =
    | 'global' | 'canvasPoint' | 'selection' | 'node' | 'port' | 'connection';
  export type Surface = 'palette' | 'menu';

  export interface Action {
    id: string;
    title: string;
    group: string;
    keywords?: string[];
    /** Stable key for frecency that survives re-registration (see D2/G3). */
    frecencyKey?: string;
    targets: readonly TargetKind[];
    /** Defaults to ['palette']. Opt INTO 'menu'; you can never opt OUT of 'palette'. */
    surfaces?: readonly Surface[];
    enabled?(ctx: ActionCtx): boolean;
    run(ctx: ActionCtx): void;
  }
  ```

  - Keep the singleton + `subscribe`/`getCommands`. Add **`queryActions(ctx, { surface, query })`**:
    filter `targets ∩ ctx.targetKinds`, drop `enabled === false`, keep `surfaces.includes(surface)`,
    then match (substring now, fuzzy via D2's `paletteScore` later).
  - **AMENDMENT (D1-A1) — normalize legacy in `register()`, not just at the type level.** When a
    zero-arg `Command` is registered, wrap it: `run: (ctx) => legacy.run()`, `targets: ['global']`,
    `surfaces: ['palette']`, `frecencyKey: legacy.id`. This is mandatory because `CommandBar.tsx:105`
    calls `command.run()` with no args; structural typing alone leaves that call site unsound.

- **`src/store/actionContext.ts`** (NEW — the single reader of `getCapabilities()` + selection state):
  `buildPaletteCtx()` and `buildMenuCtx(hit)` produce `ActionCtx { caps, point?, targetKinds, selectedIds,
  node?, portRef?, connectionId? }`. `run(ctx)` **re-reads** `graphStore.getState()` by id for mutations
  (the snapshot is for display/`enabled` only — fixes staleness).
- **`src/components/CommandBar/useCommandSources.ts`** — node-add actions gain
  `targets: ['global','canvasPoint','selection']`, `surfaces: ['palette','menu']`,
  `run(ctx) => addNode(type, ctx.point ?? viewportCenter, ctx.node?.id ?? currentViewNodeId)`,
  `frecencyKey: 'node.add.${type}'`. App actions stay `surfaces: ['palette']`.
- **`src/components/Canvas/ContextMenu.tsx`** — stop importing `menuCategories`; take a `ctx` prop;
  render `queryActions(ctx, { surface: 'menu' })` grouped by `action.group` with its own CSS.
- **`src/components/CommandBar/CommandBar.tsx`** — feed groups from `queryActions(paletteCtx, …)`. **This
  is the same change that flips `shouldFilter={false}` and takes over ordering (see D2) — do not introduce
  `queryActions` query-matching while cmdk still filters, or rows double-filter and silently drop.** AI is an
  `Action` (`targets: ['global','selection']`, `enabled: ctx => ctx.caps.agent !== 'none'`); the Tab
  fast-path (`onKeyDown` at `CommandBar.tsx:137`) and the dedicated AI item (today the hardcoded
  `Command.Item` at `CommandBar.tsx:148-158`) stay — once we own ordering, that item's presence + highlight
  on zero results is ours to assert (D2-A2).
- **`src/ai/tools.ts`** (`author_dsp_node`/`author_code_node`) — register a real `Action` with
  `targets: ['global','canvasPoint','selection']` so AI nodes appear in **both** surfaces for free.
- **`src/store/agentSessionStore.ts`** — its `ai.dsp.*` registrant (`agentSessionStore.ts:103`, today an
  `ai.dsp.${slug(name)}` legacy `Command`) MUST flow through the same `register()` normalization (D1-A1) or
  AI nodes won't carry `targets`/`surfaces`.

### Native + browser

Pure control-plane; identical on both. Platform differences live only in `ctx.caps`. Browser
self-disables AI/authoring actions via `enabled` (`caps.agent === 'none'`, `caps.codeNodes !== 'author-and-run'`).

### Invariants

No audio thread, no buffers cross (RT-no-alloc/control-rate-IPC untouched). Superset enforced **structurally**
by additive `surfaces` plus a unit test: `every(a => (a.surfaces ?? ['palette']).includes('palette'))`.

### Verification gate

- Unit test: superset invariant; `register()` normalization wraps a legacy `Command` into a runnable `Action`.
- **Menu screenshot-diff before declaring the unification milestone done.** If the friendly nested
  `menuCategories` hierarchy (today `ContextMenu.tsx:90-123`) regresses to flat `group` buckets and the
  "less tech-savvy" UX suffers, add an optional `path?: string[]` to `Action` — **required-if-regressed,
  not deferred-by-default.**

---

## D2 — Raycast UX + preference learning ("blazingly fast / learns me")

**Goal.** Sub-50ms open, sub-16ms keystroke, deterministic learnable ordering — shipped **identically to
both platforms** with zero Pi dependency. Pi-memory enriches but never gates.

### Files & types

- **`src/store/paletteLearningStore.ts`** (NEW — Zustand + `persist`):

  ```ts
  interface LearningState {
    frecency: Record<string, number>;                 // frecencyKey -> decayed score
    ctxFrecency: Record<string, number>;              // `${contextKey} ${frecencyKey}`
    prefixWins: Record<string, string>;               // queryPrefix(<=3) -> frecencyKey
    lastUsed: Record<string, number>;
    seedBoosts: Record<string, number>;               // from Pi memory; additive, capped
    recordPick(key: string, ctx: PaletteContext, query: string): void;
    scoreFor(key: string, ctx: PaletteContext, query: string): number; // sync, O(1)
    resetCommand(key: string): void;                  // "Reset Ranking"
    applySeedBoosts(seeds: Record<string, number>): void; // additive merge, never replace
  }
  ```

  - **Decay folded lazily at read:** `raw * 0.5^((now - anchor) / HALF_LIFE)`, `HALF_LIFE = 5 days`.
    `recordPick` folds decay then `+= 1`.
  - **AMENDMENT (D2-A3) — per-day-per-command saturation cap,** not just per-event, so a single-session
    spree (e.g. adding Gain 40×) can't pin a command to #1 for a fortnight.
  - `contextKey` = `sel:<nodeType>` / `canvas:empty`, read at open-time from `useGraphStore` selection +
    `useCanvasNavigationStore.currentViewNodeId` (no new IPC).
  - **AMENDMENT (D2-A4) — `persist` wrapper:** version + `migrate` + try/catch reset so a corrupt blob never
    bricks the palette. Treat native WebView localStorage loss (Tauri update/data-clear) as **acceptable**;
    do **not** back it with Pi memory (that reintroduces the fragility we rejected). "Reset Ranking" (P4)
    makes loss recoverable-by-design.

- **`src/store/paletteScore.ts`** (NEW) — fzf-style subsequence scorer (word-boundary + prefix bonus),
  replacing the substring filter in `commandRegistry.searchCommands` (`commandRegistry.ts:135-143`).
- **`src/components/CommandBar/CommandBar.tsx`** — set `<Command shouldFilter={false}>` and own ordering:
  per keystroke compute a memoized pre-ranked array (`fuzzy + scoreFor`), hard-boost `prefixWins[q.slice(0,3)]`,
  sort desc, cap ~50 rows. Empty query sorts by `ctxFrecency || frecency` (top-picks on open). `runCommand`
  calls `recordPick` before `run(ctx)`.

### `frecencyKey` (G3 + D2-A1) — who sets it, and the sequencing rule

- **Static nodes:** `frecencyKey = 'node.add.${type}'`. Lands **with D2's CommandBar change.**
- **AI-authored nodes:** `frecencyKey` MUST derive from the **content hash of the kernel** (the `.wasm`
  content-address from D4 / `faustSource` hash), **NOT** `slug(name)` — so learning follows the kernel even
  if Pi renames "warm reverb" → "warm verb" across sessions. Because the content-address lands with
  `author_wasm_node` (D4, Milestone M5), AI-node content-keying is **deferred to land with D4**; until then
  AI nodes key on `ai.dsp.${slug}` and accept learning-leak as an **explicitly known gap**, not silently shipped.

### Pi-memory seed (optional, native-only, last)

When `caps.learning === 'pi-memory'`, a coarse, cached, control-rate read of `~/.pi/agent/pi-memory/rendered/`
(or `memory_search` over RPC) maps node-affinity rules to `applySeedBoosts` — **additive, capped, never
overwriting live local scores.** Must NOT ship before the `ai.rs` protocol fix + a stable per-project memory
`localPath` (D5). Local frecency is the **unconditional floor**.

### Verification gate

- Unit: decay math; prefix-win override; **per-day saturation cap**; score survives re-registration under a
  new id when keyed on content (D2-A1).
- **Render test (D2-A2):** with `shouldFilter={false}` assert (a) **Tab still enters AI mode**, (b) the AI
  item is present + auto-highlighted on **zero local results**, (c) prefix-win ordering. ("Switching to
  `queryActions`/own-ranking is NOT zero-UX-change" — flip `shouldFilter={false}` and own ordering in the
  *same* change; don't double-filter with cmdk's internal scorer.)

---

## D3 — AI agent orchestration (build whole working workflows, reuse-first, then code)

**Goal.** The agent introspects ground-truth graph state, builds a whole connected sound-producing workflow
in **one Approve**, prefers reusing existing nodes, and can author a code node as the explicit fallback.

### Tool surface (extends the closed v1 union in `src/ai/types.ts:36-107`)

Add to `AgentToolName` / `AgentToolCall`:

- **Reads (side-effect-free, `undo: NO_OP`, populate `data`):** `get_graph`, `list_node_types`, `find_nodes`.
- **Atomic mutation:** `batch_apply` — applies an array of sub-calls, collects sub-undos into one composite
  reverse-undo; **fail-closed** (revert the whole frame on any sub-failure).
- **Authoring:** `author_code_node` (Faust → content-addressed `.wasm`; retires the `'effect'`+`faustSource`
  shoehorn — see D4). Capability-gated via `caps.codeNodes === 'author-and-run'`.
- **Plan path (optional):** `validate_plan` (pure read), `emit_plan` (args *are* a `WorkflowPlan`).

Also: add `data?: unknown` to `AppliedToolResult` and an `AgentEvent` variant
`{ kind: 'tool-result'; toolCallId; data }`.

### New files

- **`src/ai/plan.ts`** — `WorkflowPlan` (symbolic `ref`s, wires by **port name**) +
  `planToToolCalls(plan, idMap): AgentToolCall[]` lowering a plan to add/connect/updateData primitives.
- **`src/ai/planValidator.ts`** (pure) — `validatePlan(plan, store, registry): PlanError[]`: resolve refs,
  check type/`pluginId` exists, resolve port names against `manifestFor(type).ports`, run `canConnect`
  (`registry.ts`), Tarjan cycle check (excluding looper feedback kind), and the **SpeakerOut-reachability**
  "produces sound" assertion.

### Changed files

- **`src/ai/tools.ts`** — `applyToolCall` gains the reads (populate `data`), `batch_apply`, `author_code_node`,
  and `emit_plan` (→ `validatePlan` advisory → `batch_apply(planToToolCalls(...))`). Generate
  `TOOL_CATALOGUE` descriptions from `allManifests()` so the agent docs never drift.
- **`src/ai/graphAdapter.ts`** — add read-only `listNodes()`, `findNodes(pred)`, `listNodeTypes()`;
  stays the only reach into graph state.
- **`src/store/agentSessionStore.ts`** — `batch_apply`/`emit_plan` slot in as **one** `appliedResults[]`
  entry; existing `revertApplied()` covers Reject unchanged. Relay `tool-result.data` back to Pi.
- **`src-tauri/src/ai.rs`** — land the protocol fixes (see D5).

### AMENDMENTS (must honor — these change behavior, not just naming)

- **D3-A1 — `batch_apply` failure must enumerate per-sub-call status + post-state snapshot,** not a scalar
  `ok:false`. If a fail-closed revert returns only a composite error, Pi cannot tell *which* wire failed and
  repairs blind — defeating the reason reads exist.
- **D3-A2 — `validate_plan` is advisory pre-flight only; `batch_apply`'s runtime result is authoritative.**
  A validator-pass/runtime-fail divergence (e.g. dynamic-port/bundle-expansion cases `validatePlan` can't see)
  must be **surfaced explicitly as a repair signal**, never swallowed.
- **D3-A3 — approval semantics (reconciles with G1):** `batch_apply`/`emit_plan` are the **Pi-package tools**;
  they **apply optimistically host-side on `tool_execution_start`** (returning real ids so Pi reasons grounded),
  and the **single Approve maps to the turn boundary (`agent_end`/`turn_end`)**, NOT per-tool, and NOT via
  `extension_ui_request:confirm`. `validate_plan` is the only true pre-execute read.
- **D3-A4 — keep raw `add_node`/`add_connection` in the catalogue as the dynamic-port escape hatch.**
  `emit_plan` cannot express bundle expansion (dynamic ports aren't in static `PortDecl`).
- **G2 hook — wrap the whole agent run in the collab guard.** On run start, set the bridge's
  `applyingRemote`-style guard so optimistic AI verbs don't diff to peers; on **Approve**, lift the guard and
  emit one CRDT commit for the frame; on **Reject**, run undos under the guard and emit nothing.

### Native + browser

All reads + `batch_apply` + `emit_plan`/`validate_plan` are pure frontend, identical on both. Only
`author_code_node` is gated on `caps.codeNodes` (native lowers Faust→`.wasm`; browser omits the tool from the
catalogue unless a cloud build endpoint exists → agent reuses-only). `AiPanel` gate becomes `caps.agent !== 'none'`.

### Invariants

Every mutation flows through the five graphStore verbs; `batch_apply` is one undo frame; reads are
side-effect-free; nothing auto-executes; Approve/Reject unchanged. No audio buffers cross (control-rate IPC);
authored `.wasm` follows D4's off-RT quarantine + Bypass-on-trip + permanent output guards. Ctrl+K stays
superset (authored nodes register palette/menu `Action`s).

---

## D4 — Code-node execution model (brand-new nodes authored in code; native + browser)

**Goal.** A first-class authored node, the **same `.wasm` artifact** native + browser, RT-safe, reversible,
authored from Faust with a non-Faust escape hatch.

### The WASM contract (the "carefully crafted docs" deliverable — ship as `docs/code-node-abi.md`)

`.wasm` exports `oj_init(sr, maxBlock)`, `oj_process(inPtr, outPtr, n)`, `oj_param(idx, val)`,
`oj_manifest_ptr() → u32` (offset of an embedded JSON `{ ports, params: ParamDecl[] }`). **Imports NONE**
(no WASI on the RT instance). Single **pre-grown** linear memory; never grows at runtime.

### Rust

- **`crates/ojfaust/src/backend.rs`** — implement Path B: shell `faust -lang wasm` + `faust -json`;
  stderr → `FaustError::Compile{message}` (recoverable, feeds the bounded `compile_repair_with` loop) vs
  missing binary → `Unavailable`. Embed the manifest blob in the `.wasm`. (Today this is a scaffold;
  `compile_faust` in `ai.rs:414-427` returns `Ok(None)` without libfaust.)
- **`crates/ojcore-wasm/src/lib.rs`** — extend the content-addressed asset store (FNV) to hold authored DSP
  `.wasm`, keyed identically native/browser. Add a native wasmtime `DspInstance` factory: `Engine` with
  `InstanceAllocationStrategy::Pooling`, `Module::deserialize` of an AOT `.cwasm` compiled off-RT,
  `static_memory_maximum_size` capped + pre-grown, `epoch_interruption` on. RT callback calls only `oj_process`.
- **`crates/ojcore/src/manifest.rs`** — no schema change (`id` open, `WasmHost`/`Wasm` exist); register the
  authored manifest exactly as `scan_plugins` registers `host.plugin` ids.
- **`src-tauri/src/lib.rs`** — add `author_wasm_node(source, lang) → { manifestId, manifestJson, wasmHash,
  diagnostic? }`: lower off-RT, AOT-compile, run quarantine warm-up, store content-addressed, return manifest.

### Frontend (open identity — see Cross-cutting §1)

- **`src/engine/types.ts`** — carry `pluginId?: string` on the node alongside the closed `NodeType`.
- **`src/engine/registry.ts` + `serialization.ts`** — `isPluginId` accepts any *registered* dynamic id;
  stop dropping registered ids on `importWorkflow` (`serialization.ts:95` currently filters them out);
  re-resolve `.wasm` by content hash like a sample asset.
- **`src/components/params/AutoParamPanel.tsx`** — feed manifest `ParamDecl[]` from the embedded blob —
  zero bespoke React (`ui:'auto'`).
- **`src/ai/tools.ts` + `types.ts`** — retire the `'effect'`+`faustSource` shoehorn; `author_code_node`
  calls `author_wasm_node`, adds a first-class node with the real `pluginId`; `undo` removes node +
  unregisters manifest.

### AMENDMENTS (must honor)

- **D4-A1 — validate the embedded manifest host-side, fail closed, before registry insertion.** In
  `author_wasm_node` (Rust, off-RT): reject if `pluginId` collides with any built-in `KNOWN_PLUGIN_IDS` or
  existing registered id; schema-validate the blob against `schemas/oj-plugin-v1.json`; assert declared port
  counts match the `.wasm`'s actual `oj_process` arity by probing the instantiated module. **Namespace all
  authored ids `ai.wasm.<hash>`** so collision with built-ins is structurally impossible. A failed validation
  returns `diagnostic` and registers **nothing**. (The embedded manifest is attacker-controlled data crossing
  the trust boundary — see Security model.)
- **D4-A2 — native 64-sample latency is a GATE, not an open risk.** Benchmark `oj_process` over a 64-sample
  block on the native wasmtime host **before** retiring the `'effect'` shoehorn. If it misses the `<5ms`
  budget, the default flips to "native prefers `faustHost` JIT, wasm is fallback," and the capability
  descriptor + docs must say so honestly.
- **D4-A3 — no half-open seam.** Until `author_wasm_node` lands, `getCapabilities().codeNodes = 'run-only'`
  on **every** surface (native included), do **not** expose an "Author via AI" action, and keep the
  `'effect'` shoehorn untouched until D4 atomically replaces it.
- **D4-A4 — permanent per-node output guard in the HOST wrapper (not the kernel):** NaN/denormal scrub +
  hard limiter + DC-block live in both the wasmtime and worklet `oj_process` wrappers, so an untrusted kernel
  cannot disable them. CI-assert they fire on a deliberately-pathological test `.wasm`.

### Native + browser

Native: wasmtime pooling+AOT+epoch preserves `<5ms` (per-block = one `oj_process` over pre-mmap'd memory);
libfaust JIT optional accelerator. Browser: the **same** `.wasm` runs allocation-free in the AudioWorklet;
authoring is `run-only` unless OJ operates a cloud build endpoint.

### Invariants

RT no-alloc via pooling + pre-grown memory + zero imports; control-rate IPC carries only content-hash +
params, bytes load off-RT; live swap at block boundary returns the old program dropped off-RT; Reject runs the
recorded undo; epoch trip → `Bypass` slot flag (silence, never panic).

---

## D5 — Pi integration depth (the native Pi experience: packages + persistent intelligence)

**Goal.** A correct, grounded, persistent Pi experience that can install/author Pi packages, learn the user,
and survive across sessions — while keeping the sandbox in Rust.

### Protocol fixes (`src-tauri/src/ai.rs` — these are wrong against real Pi **today**)

Confirmed in the current file:
- **`ai.rs:163`** sends `{"type":"run","prompt":...}` — Pi has no `run`. **Fix:** `{"type":"prompt","message":prompt}`,
  and keep stdin open for the run lifetime (steer/abort).
- **`parse_pi_line` (`ai.rs:204-232`)** keys on `tool_call`/`result`/`done` — real Pi emits
  `tool_execution_start` (`toolName`/`args`/`toolCallId`) and `agent_end`, so **every real tool call currently
  degrades to `thought`** and zero tool calls reach the graph. **Fix the mapping:**
  - `tool_execution_start` (`toolName`/`args`) → `tool-call`
  - `message_update.assistantMessageEvent.text_delta` → `thought`
  - `agent_end` → `result`; fold `tool_execution_end`
  - `extension_ui_request` → a new `kind:"ui-request"`
- After spawn, send `{"type":"set_model","provider":"opencode-zen","modelId":…}` (no persisted default is
  confirmed; set it per spawn). **Treat `set_model` failure as fatal-to-AI (typed error), not silent.**

### Workspace split (replaces the throwaway worktree)

`ai.rs:116-117` creates a throwaway worktree that drops on run end, destroying per-project recall. **Replace
`Worktree` with a two-dir `AgentWorkspace`:**
- **Stable HOME** (forwarded) holding ONLY `~/.pi` (auth + memory) and the project memory `localPath`
  (`~/.openjammer/agent/<projectId>/`). **Never** write OJ secrets here; **never** persist the provider key to
  `~/.pi/agent/auth.json` on disk — keychain→env only.
- **Disposable per-run cwd** so memory persists but executable droppings don't survive a run (preserves the
  blast-radius reset the throwaway worktree gave). This is the only way to keep Pi's full toolset (for package
  authoring) without a persisted-RCE locker.

### First-party package `pi-openjammer-graph/` (bundled resource)

`export default function(pi) {…}` registering the graph verbs via `pi.registerTool({ name, parameters:
Type.Object(...), async execute(...) })` whose `execute` **calls back to the host, awaits `applyToolCall`,
and returns the real post-mutation graph state** (so Pi reasons grounded — G1/D3-A3). Plus
`oj_install_package` / `oj_list_packages` commands so the agent can install/author Pi packages.

### Persistent intelligence

Install `pi-persistent-intelligence` into the stable HOME with a **project-local `localPath`** (`.pi/settings.json
→ {"pi-persistent-intelligence":{"localPath":".pi/pi-memory"}}`) for per-project isolation. Have the graph
package emit explicit corrections/workflow rules (capture-eligible). Approved patches become durable playbooks
injected next session.

### AMENDMENTS (must honor)

- **D5-A1 — reconcile the two confirm models (this is G1).** Graph tools apply per-call (real-id round-trip)
  + Approve once at `agent_end`; `extension_ui_request` reserved for non-graph interactive prompts. Pi *needs*
  the returned node id mid-turn to wire the next connection, so apply CANNOT be deferred to the turn boundary —
  only **Approve** is.
- **D5-A2 — split workspace** (stable HOME + disposable per-run cwd), not a single reused dir (persisted-RCE risk).
- **D5-A3 — spawn-time capability handshake.** Send `get_commands` (and cache `get_available_models` per
  (provider, Pi-version)); on vocabulary mismatch, surface a **reasoned `agent:'none'`-with-reason**, never
  silently degrade every tool call to `thought`. Don't rely on the CI e2e alone.
- **Durable package writes:** "create Pi packages for Pi itself" needs a writable cwd, but persisting an
  authored package must be an explicit **host-mediated "save package" action** (copy out of the disposable cwd
  into a user location) — Pi never writes to a durable path itself. This is the **only** durable-write path.

### Files

`src-tauri/src/ai.rs` (protocol + workspace), `src/audio/executor/Executor.ts` (`getCapabilities`),
`src/ai/types.ts` (`ui-request` event), `src/ai/PiAgentBackend.ts` (handle `ui-request`, reply
`extension_ui_response`), `src/ai/tools.ts` (host-side apply the package calls into),
`src/store/agentSessionStore.ts` (turn-boundary Approve; G2 guard), `pi-openjammer-graph/` (NEW bundled),
`src/components/CommandBar/AiPanel.tsx` (gate → `caps.agent !== 'none'`).

---

## D6 — Auth & first-Tab onboarding (Zen default; all Pi options; native + browser)

**Goal.** A native, keyboard-navigable provider chooser; OS-keychain at-rest; Zen BYO-key default with a
data-training disclosure; ToS-safe ladder; defer to credentials Pi already owns.

### New Rust `src-tauri/src/auth.rs`

- `auth_status() -> AuthState { keychainProvider, piAuthJsonProviders, activeProvider, modelId, configured,
  conflict }` — reads the OS keychain AND parses `~/.pi/agent/auth.json` (HOME-forwarded).
  - **AMENDMENT (D6-A1) — define `conflict` by OUTCOME, not presence.** Resolve each `auth.json` key
    (expand `$VAR`/`!shellcmd`, check non-empty/non-expired) and set `conflict=true` only when Pi would resolve
    a **working** key. When `auth.json`'s key is unresolvable, **prefer the keychain key and inject it**
    (otherwise OJ withholds a working key and the run fails with an opaque Pi error). E2e the empty-`$VAR` case.
- `auth_begin_oauth(provider) -> { authorizeUrl, state }` — PKCE S256, 32-byte verifier; ephemeral loopback
  via `tauri-plugin-oauth`, redirect `http://localhost:1455/auth/callback`, client
  `app_EMoamEEZ73f0CkXaXp7hrann`, scopes `openid profile email offline_access` (Codex).
- `auth_store_key/get_key/clear(provider)` — `tauri-plugin-keyring` (Windows Credential Manager / macOS
  Keychain / libsecret). **Not Stronghold** (deprecated, removal in Tauri v3).
- `auth_validate_key(provider, key) -> bool` — server-side `GET https://opencode.ai/zen/v1/models` (avoids
  browser CORS).

### `src-tauri/src/ai.rs`

Drop the `provider_key` JS param (`ai.rs:107`); at spawn call `auth_get_key` for the active provider and
**inject only when `auth_status().conflict == false`** (defer to Pi's `auth.json` otherwise), mapping to
`OPENCODE_ZEN_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` via `OPENJAMMER_AI_KEY_VAR`.

### Frontend

- **`src/components/CommandBar/AuthChooser.tsx`** (NEW) — a cmdk list (arrow/Tab nav, Enter → system browser →
  auto-return). Default highlight = Zen.
- **`src/auth/authStore.ts`** (NEW) — Zustand wrapping the Tauri commands; persists **provider + model only,
  never the key.**
- `AiPanel` gate becomes `caps.agent !== 'none' && authStore.configured`; first Tab with `!configured` routes to
  `AuthChooser`. Register "Configure AI provider" as a palette `Action` (Ctrl+K superset; right-click need not
  expose it). Add `auth_*` to `src-tauri/src/lib.rs` `invoke_handler`.

### The Zen-default first-Tab flow + ToS stance

1. **First Tab, unconfigured →** `AuthChooser`, keyboard-navigable, **default highlight = opencode Zen**.
2. **Zen (default):** "Get your free key" opens `https://opencode.ai/auth` in the system browser; a paste
   field live-validates against `/v1/models`; key stored in keychain. A **non-dismissible inline data-training
   notice** sits next to any free Zen model ("During its free period, collected data may be used to improve the
   model — do not submit personal or confidential data") and **again on first run** — required honest disclosure.
3. **Codex OAuth:** loopback PKCE (`localhost:1455`) — the clean subscription path (sanctioned in third-party
   agents since Jan 2026).
4. **Anthropic API key:** labeled "API key — billed per token, **not** your Pro/Max plan."
5. **Claude Pro/Max subscription OAuth:** **NOT shipped/defaulted.** Anthropic prohibits OAuth tokens from
   Free/Pro/Max accounts in third-party tools (server-side block since 2026-01-09; clarified 2026-02-20, naming
   opencode and Pi). If exposed at all, gate behind an Advanced screen with a ToS warning — never marketed,
   never default.

### AMENDMENTS (must honor)

- **D6-A2 — keep first-Tab fast.** Cache `get_available_models` per (provider, Pi-version) and skip the
  pre-probe on warm cache; send `set_model` optimistically and fall back to the probe only on a `set_model`
  error. Keep **one persistent Pi subprocess across Tabs** (not per-run spawn) so model selection is paid once
  and the first token isn't gated on a cold 1-3s handshake.
- **D6-A3 — add `'paste-proxy'` to `EngineCapabilities.auth` NOW** (even though browser returns `'none'` today)
  so a future web-auth addition isn't a breaking seam change to the exhaustive switch.
- **D6-A4 — CI-assert Pi emits the Codex system-prompt preamble** ("You are Codex, based on GPT-5…"), else
  Codex-billed calls silently fail validation.

### Native + browser

Native = full flow. Browser = `auth:'none'` / `agent:'none'`; `AiPanel` keeps the honest DesktopOnly message.
No keychain, no loopback, no paste today (proxy out of scope). **Product limit, not a bug:** the seamless native
auth window cannot exist for web users — state it plainly.

### Invariants

Auth is control-plane Tauri IPC (RT untouched). Auth resolves only *who pays*; tool calls still
apply-with-undo → Approve/Reject. Secret boundary **strengthened** (keychain at-rest; stripped-env injection the
sole path into Pi; nothing on OJ disk). HOME/USERPROFILE stay forwarded so `~/.pi` survives.

---

## Cross-cutting concerns

### 1) Opening the `NodeType` union + migrating existing AI nodes

The Rust side is already open (`manifest.rs`: `id` arbitrary string, `scan_plugins` registers dynamic
`host.plugin` ids). The blocker is the **frontend**: `NodeType` is a closed 33-member union (`types.ts:135-168`),
`KNOWN_PLUGIN_IDS` validates at boundaries (`types.ts:191-225`), `isPluginId` is the gate (`types.ts:231-234`),
and `serialization.ts:95` **drops** any node whose `type` is not a known plugin id.

**Plan:**
- Carry a dynamic `pluginId?: string` **alongside** the closed `NodeType` (do not relax `NodeType` to `string`;
  keep the closed set as the validated known-subset). Registered dynamic ids (namespaced `ai.wasm.<hash>`)
  become valid identities.
- `isPluginId` accepts any *currently-registered* id; `serialization.ts` stops dropping registered ids and
  re-resolves the `.wasm` by content hash like a sample asset (reuse the FNV content-address pattern).
- **`canEnter` is false for code nodes** (opaque leaf kernel) — the "press E to enter and rewire" story belongs
  to the *preferred* reuse path (AI stitches existing nodes into an enterable subgraph). Code nodes are the
  escape hatch you can only edit-source, not enter.

**Migration of existing `'effect'`+`faustSource` saved workflows (a real gap no decision-lane owned):**
- `WORKFLOW_VERSION` does a **major-version** compatibility check (`serialization.ts:80-87`). Opening identity
  needs a **version bump + a load-time `migrate`**: on import, detect nodes of type `'effect'` carrying
  `data.faustSource` / `data.aiDsp`, re-lower the Faust source through `author_wasm_node` to a content-addressed
  `.wasm`, and rewrite them to first-class `pluginId = ai.wasm.<hash>` nodes. Without this, M5/M6 orphans every
  previously-authored node. Cover with a round-trip test loading a fixture of the old shape.

### 2) Security model (code nodes + Pi)

The combined threat surface — untrusted AI-authored `.wasm` + Pi with a full toolset + stable HOME + an
env-injected provider key + prompt-injection reaching Pi via sample/preset names — is owned **here** (no lane
owned the combination):

- **Authored `.wasm` (untrusted kernel):** validated module (wasmtime type-checked, memory-bounded) →
  **host-side manifest validation, fail-closed, namespaced `ai.wasm.<hash>`** (D4-A1) → off-RT quarantine
  warm-up → RT containment (pooling, pre-grown memory, **zero imports / no WASI**, epoch watchdog →
  Bypass-on-trip) → **permanent host-wrapper output guard** (NaN/denormal scrub + hard limiter + DC-block,
  D4-A4). Nothing reaches the master bus unguarded; nothing auto-installs into a *live* program without Approve.
- **Pi subprocess:** env_clear + allowlist (`stripped_env`, `ai.rs:253-276`); **disposable per-run cwd** so a
  prompt-injected `write`/`bash` dropping cannot persist (D5-A2); stable HOME holds only `~/.pi` auth+memory;
  the provider key is **keychain → single env var**, never on OJ disk and never in `auth.json` on disk; durable
  package writes only via the host-mediated "save package" action.
- **Prompt injection:** treat any graph/sample/preset string that reaches Pi as untrusted; tool calls remain
  declarative + reversible + Approve-gated, so injection at worst proposes a workflow the user rejects.

### 3) The first-party Pi package + the carefully-crafted agent docs

- **`pi-openjammer-graph`** (bundled): registers all graph verbs as Pi tools whose `execute` round-trips real
  post-state (D5); `oj_install_package` / `oj_list_packages` host actions.
- **Agent docs (founder's explicit requirement — "carefully crafted documentation like Pi's own"):**
  ship `docs/agent-tools.md` + `docs/code-node-abi.md`, **generated** with `TOOL_CATALOGUE` derived from
  `allManifests()` so the catalogue never drifts from reality. Model them on Pi's own coding-agent docs
  (`github.com/earendil-works/pi/.../packages/coding-agent/docs/{index,quickstart,providers}.md`): a
  Pi-style quickstart covering the seven new orchestration tools (`get_graph`, `list_node_types`,
  `find_nodes`, `batch_apply`, `author_code_node`, `validate_plan`, `emit_plan` — layered over the six v1
  graph verbs) + the reuse-first workflow pattern + Faust authoring + the `oj_*` ABI, shipped as part of
  the `pi-openjammer-graph` package so the agent reads them in-context.
  These docs are the "right building blocks" the agent needs to do almost anything; treat them as a
  first-class deliverable, gated in M3 (tools) and M6 (ABI), not an afterthought.

### 4) Testing strategy

- **`src/ai/__tests__`:** real-Pi e2e (CI, feature-flagged) proving `prompt`/`tool_execution_start`/`agent_end`
  + a tool call reaching the graph; `batch_apply` atomicity (deliberately-broken batch reverts the whole frame);
  `tool-result` round-trip (real id returned to Pi).
- **`src/store/__tests__/agentSessionStore.test.ts`:** turn-boundary Approve; **collab-guarded Reject** (no
  peer broadcast on reject).
- **`src/collab/__tests__/convergence.test.ts`:** AI-edit convergence — optimistic AI verbs do NOT diff to
  peers pre-Approve; one commit on Approve; none on Reject.
- **`commandRegistry` / D1:** superset invariant; legacy-`Command` normalization.
- **`paletteLearningStore` / D2:** decay; prefix-win; per-day saturation cap; content-keyed re-registration
  survival; `shouldFilter={false}` render test (Tab→AI survives, zero-result AI highlight, prefix-win order).
- **Rust:** `auth::` (keychain round-trip, `conflict`-by-outcome incl. empty-`$VAR`); `ai::` (protocol mapping
  for `tool_execution_start`/`agent_end`, `set_model` failure path, handshake-drift → reasoned `agent:'none'`).
- **wasm parity:** golden-render A/B native (wasmtime, and libfaust JIT when enabled) vs browser worklet for the
  same `.wasm`; **D4-A2 native 64-sample latency benchmark as a gate**; pathological-`.wasm` guard-fires test.
- **CI gate (D6-A4):** assert the Codex system-prompt preamble.

---

## ROADMAP — phased, sequenced, independently shippable

Honors the critic's sequencing: **the capability seam and the Pi transport truth come first; everything else
branches on them.** Each milestone has acceptance criteria; do not start a milestone before its predecessors'
gates are green.

### M0 — The capability seam (unblocks ALL)
- **Build:** `src/engine/capabilities.ts` (the one canonical `EngineCapabilities` union, G4);
  `getCapabilities()` on `Executor` and both executors (native = full row, browser = degraded);
  consumed via exhaustive switch. Migrate `AiPanel` gate `backend.available()` → `caps.agent !== 'none'`.
  Include `auth:'paste-proxy'` in the union now (D6-A3).
- **Accept:** an integration test asserts native row = full, browser row = degraded; a missing union arm is a
  compile error; no consumer calls `isTauri()`/`backend.available()` for AI/code-node/auth gating.

### M1 — Pi transport truth (unblocks every AI claim)
- **Build (`src-tauri/src/ai.rs`):** `{"type":"prompt","message":…}`; map `tool_execution_start`→`tool-call`,
  `agent_end`→`result`, `message_update…text_delta`→`thought`, `extension_ui_request`→`ui-request`; `set_model`
  after spawn (failure = typed fatal-to-AI); spawn-time `get_commands` handshake → reasoned `agent:'none'`
  (D5-A3). One real Pi e2e in CI behind a feature flag.
- **Accept:** the e2e shows a real Pi tool call reaching the graph through `applyToolCall`; a forced
  protocol-vocabulary mismatch yields a reasoned `agent:'none'`, not silent thought-degradation.

### M2 — Action registry + local frecency (pure frontend; both platforms)
- **Build:** `Action` type + `queryActions` + `register()` normalization (D1-A1) + superset test;
  `paletteLearningStore` + `paletteScore`; flip `CommandBar` to `shouldFilter={false}` + own pre-ranked list +
  `recordPick` in the **same** change (D2 amendments). `frecencyKey='node.add.${type}'` for static nodes (G3).
- **Accept:** D2 render test green (Tab→AI, zero-result AI highlight, prefix-win order); superset unit test
  green; palette open <50ms, keystroke <16ms on a hundreds-item set.

### M3 — Read tools + grounded reasoning + atomic batch
- **Build:** `get_graph`/`list_node_types`/`find_nodes` + `ToolResult.data` round-trip (verified via M1 e2e);
  `batch_apply` (fail-closed, **per-sub-call status array + post-state snapshot**, D3-A1); migrate
  `agentSessionStore` to grouped entries; **wrap the run in the collab guard (G2)**; pin approval semantics
  (optimistic per-call apply + one Approve at `agent_end`, D3-A3/G1).
- **Accept:** batch-atomicity test (broken batch reverts whole frame, returns per-sub-call status);
  collab convergence test (no peer broadcast pre-Approve / on Reject; one commit on Approve); the agent builds a
  keyboard→looper→speaker chain in one Approve that produces sound.

### M4 — Unification milestone (right-click = projection)
- **Build:** `src/store/actionContext.ts`; migrate `useCommandSources`; rewrite `ContextMenu` as
  `queryActions(ctx, { surface:'menu' })`.
- **Accept:** menu **screenshot-diff** vs the current nested `menuCategories` (D1 gate) — if nesting regressed,
  `path[]` submenus land before sign-off; AI-authored nodes appear in both surfaces.

### M5 — Open node identity end-to-end
- **Build:** `pluginId` on the node; `isPluginId` accepts registered dynamic ids; `serialization` stops dropping
  them + content-address re-resolve; **load-time `migrate` for existing `'effect'`+`faustSource` nodes** +
  version bump (Cross-cutting §1).
- **Accept:** a registered dynamic node round-trips save/load with identity intact; an old `'effect'`+`faustSource`
  fixture migrates to a first-class `pluginId` node; no orphaning.

### M6 — Code-node authoring (Faust → wasm)
- **Build:** `crates/ojfaust/src/backend.rs` Path B (`faust -lang wasm`) + `compile_repair_with`; native wasmtime
  RT host (pooling+AOT+epoch); `author_wasm_node` with **host-side manifest validation, fail-closed,
  `ai.wasm.<hash>` namespace** (D4-A1); permanent host-wrapper output guards (D4-A4); retire the `'effect'`
  shoehorn **atomically**; `author_code_node` tool; flip `codeNodes` to `'author-and-run'` (D4-A3); AI-node
  `frecencyKey` keyed on content hash (D2-A1/G3).
- **Accept:** **native 64-sample latency benchmark passes `<5ms` (gate, D4-A2)** — else default flips to
  faustHost-primary and docs say so; one real Faust→wasm→sound in CI; golden-render A/B native vs browser;
  pathological-`.wasm` guard-fires test green.

### M7 — Auth chooser, persistent intelligence, packages, plan/validator, Pi-memory seed (optional, native)
- **Build:** `auth.rs` (keychain + loopback PKCE + Zen validate; `conflict`-by-outcome, D6-A1);
  `AuthChooser.tsx` + `authStore.ts`; persistent Pi subprocess across Tabs + warm-cache model selection (D6-A2);
  the workspace split (stable HOME + disposable cwd, D5-A2); `pi-openjammer-graph` package + `oj_install/list`
  + host-mediated "save package"; `pi-persistent-intelligence` with project-local `localPath`; `plan.ts` +
  `planValidator.ts` + `validate_plan`/`emit_plan` (advisory, D3-A2); generated agent docs; `caps.learning`
  Pi-memory → `applySeedBoosts` (additive/capped floor, D2 P5).
- **Accept:** first-Tab onboarding picks Zen by default with the data-training notice; the empty-`$VAR`
  `conflict` e2e defers correctly; Codex preamble CI assert green (D6-A4); first token after Tab on a warm
  subprocess feels instant; Pi-memory seed never lowers the local frecency floor.

---

## Risks & open questions

**Carried risks (mitigated, watch in verification):**
- **Capability descriptor is runtime, not compile-time, at the value boundary.** The union+exhaustive switch
  catches *handling* gaps, but an executor returning the wrong *value* (e.g. `agent:'none'` when AI is live)
  silently disables a platform. Mitigate with the M0 integration test (native=full, browser=degraded).
- **Pi version drift.** `set_model`/event names are a runtime contract. Pin a Pi version; keep the M1 e2e and
  the spawn-time `get_commands` handshake (D5-A3); a bump that renames commands surfaces as reasoned
  `agent:'none'`, never silent degradation.
- **Two auth implementations, one label.** keychain+loopback (native) vs future paste-proxy (browser) share
  ~zero code — verify independently; the `'paste-proxy'` arm exists in the union now to avoid a breaking change.
- **`auth.json` > env reconciliation** is load-bearing; the `conflict`-by-outcome rule (D6-A1) is the only guard
  against withholding a working keychain key — e2e the empty-`$VAR`/expired-token cases.
- **Native wasm latency** (D4-A2 gate): if `oj_process` over 64 samples misses `<5ms`, "one artifact is enough"
  weakens on native — faustHost JIT becomes effectively required there. The gate forces an honest descriptor.
- **Quarantine cannot prove stateful-DSP safety** (reverb/delay pathology emerges after minutes) — the permanent
  host-wrapper limiter/DC-block/scrub (D4-A4) is load-bearing, not warm-up-only.
- **localStorage loss on native** (Tauri update/data-clear) silently resets "learns me" — accepted as best-effort;
  "Reset Ranking" makes it recoverable; never backed by Pi memory.
- **Flattened menu hierarchy** could regress the friendly right-click UX — gated by the M4 screenshot-diff;
  `path[]` is required-if-regressed.

**Open questions (decide before the dependent milestone):**
- **Does OpenJammer operate a browser AI proxy / Faust cloud-build endpoint?** If never, the browser stays
  `agent:'none'` + `codeNodes:'run-only'` permanently — state it as a product limit. (Affects M0 browser row,
  M6 browser authoring.)
- **Which Zen model is the configured default**, and how do we track free-model rotation (Big Pickle, MiMo,
  etc.) so a removed model doesn't break first-Tab? (Affects M7; the `get_available_models` warm cache must
  fall back gracefully.)
- **Per-project `projectId` derivation** for the stable memory `localPath` — file path hash? explicit project
  id? Must be stable across moves to avoid leaking one project's taste into another. (Affects M7.)
- **Repair-loop budget** for `compile_repair_with` and `validate_plan`→`batch_apply` divergence — what bound,
  and how is non-termination surfaced (an `error` event)? (Affects M3/M6.)
- **Ghost-node preview before Approve** — `emit_plan` pops N nodes at once; do we render a pre-Approve preview so
  the user isn't surprised by an atomic frame? (Affects M3 UX polish.)
