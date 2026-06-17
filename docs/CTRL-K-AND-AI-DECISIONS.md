# Ctrl+K + AI - Decision Record (research trail)

> Companion to `CTRL-K-AND-AI-PLAN.md`. Raw output of the multi-agent research workflow:
> the architecture spine, each decision's judged winner + adversarial verdict, and the
> cross-decision coherence critique. Kept for traceability of how each decision was reached.
>
> **Superseded (chat redesign):** the **Approve/Reject** transaction described throughout is
> retired — agent edits now apply live and are undone with plain **Ctrl+Z** (untrusted-
> generator safety = reversibility + the OS/Pi sandbox). See the amendment banner atop
> `CTRL-K-AND-AI-PLAN.md`.

## Architecture spine (winner)

DECISION: Ship the **HYBRID spine, anchored on a single `EngineCapabilities` descriptor exposed by the active Executor**, with native-Tauri as the flagship and browser-PWA as an honest, progressively-degrading subset. The agent runs as a Rust-owned Pi RPC subprocess on desktop (protocol fixed per the Pi brief; sandbox stays in env_clear+allowlist+keychain-injected key); the browser gets `agent:'remote-proxy'` only if OpenJammer operates one, else a truthful `agent:'none'`. Code nodes converge on ONE artifact: AI authors Faust source, always lowered through `faust -lang wasm` to a content-addressed `.wasm` that runs unchanged in the browser worklet and native wasmtime — native libfaust JIT (`faustHost`) is an optimization, never a requirement. Auth is keychain+loopback-PKCE on desktop, paste-key-proxied in browser, defaulting to Zen BYO-key with the data-training disclosure; no Claude-subscription button anywhere. Every consumer reads `getCapabilities()` — never `isTauri()` directly.

WHY IT BEATS THE OTHERS: Native-first is correct about *where the agent must live* (Pi is Node/native, libfaust+wasmtime+keychain+loopback are structurally native-only) but it **sacrifices the browser's AI value prop entirely and scatters the gating** — it concedes the zero-install surface instead of designing for graceful degradation. Browser-first is seductive for reach but makes a **server a hard product dependency**: it must operate a proxy + Faust build farm, hold or broker user keys server-side, route private graph/prompt data through OpenJammer's infrastructure, and lose offline + <5ms + zero-egress — the very things serious live performers need, and it weakens pi-persistent-intelligence's "learns me" story by exiling memory server-side. Hybrid takes native-first's correct execution model (Rust-owned subprocess, keychain, the ToS-safe Zen/Codex/API-key auth ladder) and grafts browser-first's best idea — the *same* `AgentBackend` contract behind a swappable backend and the single-`.wasm` parity artifact — while making the browser AI path **optional, not load-bearing**. The capability descriptor is the unifier all three designs converged toward; making it the *one seam* (mirroring the existing `OJ_EXECUTOR` executor swap) means Pi protocol drift, RT-wasm safety, and proxy cost are each isolated to one place. ToS reality (no subscription OAuth since 2026-01-09), the no-host-pre-execute reality of Pi RPC (Approve/Reject reimplemented via replayed graph tools or `extension_ui_request:confirm`), and RT-no-alloc all survive unchanged.

THE CAPABILITY MATRIX:

| | Desktop (Tauri) | Browser (PWA) |
|---|---|---|
| **AI agent** | Full: Pi RPC subprocess, Rust sandbox, Tab→Pi, builds whole connected workflows | `remote-proxy` if OJ operates one (optional, second-class); else honest `agent:'none'` ("requires desktop") |
| **Code nodes** | Author + run: Faust→wasm (`wasmHost`) AND optional libfaust JIT (`faustHost`); wasmtime pooling+epoch+quarantine | Run only: same content-addressed `.wasm` in AudioWorklet; authoring needs cloud build endpoint (optional) |
| **Auth** | Keychain at-rest + loopback PKCE (Codex `localhost:1455`); key injected as sole env var into Pi; Zen/BYO/API-key/Codex | Paste-key proxied server-side; Zen BYO with data-training notice; no keychain, no loopback |
| **Learning** | pi-persistent-intelligence (`~/.pi/agent/pi-memory`, HOME forwarded, stable per-project `localPath`) + local frecency | Local frecency ranking only (IndexedDB); Pi memory only if proxy persists per-user |

Note: command palette, frecency, right-click, unified registry, and manual graph editing are pure-frontend and ship **identically to both**.

CONSTRAINTS TO PROPAGATE (every D1..D6 MUST respect):
1. **One capability seam.** All platform branching reads `Executor.getCapabilities() → EngineCapabilities`; no consumer calls `isTauri()`/`getInvoke()` directly. AiPanel's gate becomes `caps.agent !== 'none'`.
2. **One code-node artifact.** AI authors Faust source; always lower via `faust -lang wasm` to ONE content-addressed `.wasm` hosted by `WasmHost`. `faustHost`/libfaust JIT is an optimization, never required for a node to exist or round-trip.
3. **RT invariants are absolute.** No alloc/lock/block in the audio callback: wasmtime pooling allocator + pre-grown linear memory (no `memory.grow`/WASI on RT), epoch watchdog → Bypass-on-trip (never panic), off-RT quarantine warm-up + NaN/denormal scrub, live swap at block boundary. `assert_no_alloc` CI guard stays.
4. **Untrusted-generator + transactional/reversible stays.** Nothing auto-executes; tool calls apply optimistically with undo closures and gate Approve/Reject (`agentSessionStore`). Since Pi RPC has no host pre-execute, reimplement Approve via host-replayed graph tools or `extension_ui_request:confirm`.
5. **Sandbox + secret boundary intact (native).** Pi stays a stripped-env subprocess (env_clear+allowlist); the long-lived secret lives in OS keychain and is injected only as the single `OPENJAMMER_AI_KEY_VAR` env var — never persisted to OpenJammer's disk. Forward HOME/USERPROFILE so `~/.pi` auth+memory survive.
6. **ToS-safe auth ladder.** Default = Zen BYO-key (non-dismissible data-training notice) + Codex OAuth + Anthropic API key (labeled "billed per token, not Pro/Max"). **Never** ship/default a Claude Pro/Max subscription-OAuth button. Browser auth never exposes keys to provider page JS (CORS + leakage) — proxy only.
7. **Open node identity end-to-end.** Carry a dynamic `pluginId: string` alongside the closed `NodeType`; route registered unknown ids to `AutoParamPanel` (fed manifest `ParamDecl[]`); persist + content-address the `.wasm` and re-resolve on load — retiring the `'effect'`+`faustSource` shoehorn in `tools.ts`.

## Architecture spine (adversarial verdict)

I have the two load-bearing files confirmed. The `ai.rs` confirms the exact protocol bugs the brief flagged (line 163: `{"type":"run","prompt":...}` — wrong; `parse_pi_line` matches `tool_call` not `tool_execution_start`; completion synthesized host-side, not from `agent_end`). The `Executor` interface confirms there is **no `getCapabilities()` method yet** — the constraint's central seam does not exist. Now I have enough to attack.

---

TOP RISKS (ranked)

**1. The capability seam the whole spine rests on does not exist yet — and constraint #1 understates the blast radius.** `Executor.ts` has no `getCapabilities()`; nothing returns `EngineCapabilities`. The brief asserts "every consumer reads `getCapabilities()`" as if it's a refactor, but the codebase routes platform differences through `OJ_EXECUTOR` selection + direct `isTauri()` checks (AiPanel's gate, `OjcoreNativeExecutor`'s `window.__TAURI__`). Making ONE seam load-bearing means a single wrong/missing field silently disables AI or code-nodes on a whole platform with no compile-time guard (it's a runtime descriptor). REQUIRED: define `EngineCapabilities` as a discriminated union consumed through an exhaustive switch so a missing capability is a type error, not a silent `'none'`; add it to the `Executor` interface in this PR, not "later."

**2. `ai.rs` is wrong against real Pi today — the spine inherits a broken transport.** Confirmed: line 163 sends `{"type":"run"}` (Pi has no `run`; needs `prompt`/`message`); `parse_pi_line` keys on `tool_call`/`result`/`done` and will degrade every real `tool_execution_start`/`agent_end` to `thought`. So **zero tool calls reach the graph today** — the entire untrusted-generator/Approve-Reject machinery is unexercised against a live Pi. The spine treats this as a known fix, but until it lands, every downstream claim (builds whole workflows, reversible) is unverified. REQUIRED: land the protocol fix + one real end-to-end Pi run in CI behind a feature flag BEFORE building code-nodes on top.

**3. FATAL-adjacent: Approve/Reject is architecturally impossible as designed over Pi RPC.** Pi executes tools *inside itself*; there is no host pre-execute. The spine's own constraint #4 admits this and offers two escapes — but both are unbuilt and one is incoherent. "Host-replayed graph tools that are no-ops in Pi's sandbox" means Pi's `add_node` does nothing real, Pi believes it succeeded, and continues reasoning against a graph state that doesn't exist — so multi-step workflow building (the founder's headline feature) reasons against a phantom graph and produces garbage connections. `extension_ui_request:confirm` gating is the only correct path, and it's per-tool-call modal — which kills "blazingly fast." REQUIRED: pick `extension_ui_request:confirm` via a first-party `pi-openjammer-graph` package whose tools return the REAL post-mutation graph state to Pi (so reasoning stays grounded), and batch-approve at turn boundaries, not per call.

**4. RT-wasm "quarantine warm-up" cannot prove safety for stateful DSP.** Running N silent blocks proves nothing for a reverb/delay whose pathology (NaN, runaway feedback, denormal storm) only manifests after specific input or minutes of state accumulation. Epoch watchdog → Bypass is correct for CPU runaway but a node that emits finite-but-wrong output (DC offset, full-scale noise) passes every gate and reaches the master bus. REQUIRED: keep the output NaN/denormal scrub AND a per-node hard limiter/DC-block on authored-node output as a permanent RT guard, not just warm-up.

**5. Faust→wasm as the SINGLE artifact understates native latency regression.** Forcing native through wasmtime (even pooling+AOT) when libfaust JIT exists trades the <5ms flagship promise for parity convenience. wasmtime call overhead + linear-memory marshalling per block is real on a 64-sample buffer. The spine demotes `faustHost` to "optimization," but for a *live-performance* tool that's the wrong default. REQUIRED: native MUST prefer `faustHost` when libfaust is present; wasm is the portability fallback, not the native default.

NO single fatal flaw kills the spine — it survives. The hybrid + capability seam is the right shape.

RESIDUAL RISKS TO CARRY: (a) `set_model` reliance (no persisted default confirmed) means a Pi version bump to RPC command names breaks model selection silently; (b) keychain + loopback-PKCE is ~zero shared code with browser paste-key — "one auth ladder" is two implementations wearing one label; (c) pi-persistent-intelligence needs a STABLE cwd, but `ai.rs`'s throwaway worktree (line 117) destroys per-project recall — `HOME` forwarding alone is insufficient; the worktree must hold a stable per-project memory `localPath`.

---

## Unified action/command model (Ctrl+K superset of right-click, one set of components)

### Winning decision

DECISION
Build **Direction A's lean Action registry** (`Command` → `Action` with `targets`, `enabled(ctx)`, `surfaces`, and `run(ctx)`), grafting **three named ideas from Direction B**: (1) B's centralized `buildContext()` factory in a new `src/store/actionContext.ts` as the single place that reads `Executor.getCapabilities()`; (2) B's `EngineCapabilities`-as-discriminated-union consumed via exhaustive switch so a missing capability is a *type* error (SPINE adversarial risk #1); (3) B's optional `nodeToolbar` surface deferred to a later phase, not built now. We do **not** adopt B's `menus[]` placement array or `when`-DSL framing — `surfaces?: ('palette'|'menu')[]` defaulting to `['palette']` plus a unit test gives the same structural superset guarantee at a fraction of the abstraction tax.

WHY IT WINS
Both directions are the same skeleton (one registry, ctx-aware `run`, capability-gated `enabled`, right-click as a filtered projection). The only real divergence is *weight*. B's `menus: MenuPlacement[]` with per-surface `order`/`category` and a formal resolver is justified only if action count reaches the thousands or contributors need declarative menu placement — neither is true (the palette brief confirms hundreds of items, cmdk fine to ~2–3k). A's additive-`surfaces` flag enforces the founder's "adding to one adds to both" rule *structurally* (you can only opt *into* the menu, never out of the palette) with one boolean test — identical guarantee, far less surface for new contributors and AI/plugin authors to learn. Direction A is the best compromise: it ships the unification milestone fastest while B's two genuinely load-bearing ideas (the typed capability seam and the single context factory) are grafted in to satisfy SPINE #1 and the adversarial verdict.

CONCRETE DESIGN

`src/engine/capabilities.ts` (new): `type EngineCapabilities = { agent: 'pi-subprocess'|'remote-proxy'|'none'; codeNodes: 'author-and-run'|'run-only'|'none'; auth: 'keychain-loopback'|'paste-proxy'|'none' }`. Add `getCapabilities(): EngineCapabilities` to `Executor` interface (`src/audio/executor/Executor.ts`); native/wasm executors return their matrix row. Consumers switch exhaustively.

`src/store/commandRegistry.ts`: replace `Command` with `Action { id; title; group; keywords?; targets: readonly TargetKind[]; surfaces?: ('palette'|'menu')[]; enabled?(ctx): boolean; run(ctx: ActionCtx): void }`. `TargetKind = 'global'|'canvasPoint'|'selection'|'node'|'port'|'connection'`. Keep singleton + `subscribe`. Add `queryActions(ctx, {surface, query})`: filter `targets ∩ ctx.targetKinds`, drop `enabled===false`, keep `surfaces.includes(surface)`, substring-match (frecency later). Keep `Command` as deprecated alias adapting `run:()=>void`→`run:(_ctx)=>void`, `targets:['global']`, `surfaces:['palette']` — existing registrants compile untouched.

`src/store/actionContext.ts` (new, from B): `buildPaletteCtx()`, `buildMenuCtx(hit)` — the *only* readers of `getCapabilities()` and `graphStore` selection state (`selectedNodeIds`/`selectedConnectionIds`, already at lines 161–162). `run(ctx)` re-reads `graphStore.getState()` by id for mutations (snapshot is display/`enabled` only — fixes A's staleness risk).

`useCommandSources.ts`: node-add gains `targets:['global','canvasPoint','selection']`, `surfaces:['palette','menu']`, `run(ctx)=>addNode(type, ctx.point ?? viewportCenter, ctx.node?.id ?? currentViewNodeId)`. App actions stay `surfaces:['palette']`.

`ContextMenu.tsx`: stop importing `menuCategories`; take `ctx` prop; render `queryActions(ctx,{surface:'menu'})` grouped by `action.group` with its own CSS. Add optional `path?: string[]` to `Action` later if deep submenus are missed (deferred — accept flat-to-one-level now).

`CommandBar.tsx`: feed `groupCommands` from `queryActions(paletteCtx,{surface:'palette',query:search})`. AI is an action `targets:['global','selection']`, `enabled: ctx=>ctx.caps.agent!=='none'` (SPINE #1/#6); Tab fast-path untouched.

`tools.ts author_dsp_node`: registers an `Action` with `targets:['global','canvasPoint','selection']` → AI nodes appear in both surfaces for free; untrusted-generator/reversible flow via `agentSessionStore` unchanged.

INVARIANTS: pure control-plane — no audio thread, no buffers cross (RT-no-alloc/control-rate-IPC untouched). Platform branching lives *only* in `ctx.caps`. Browser ships identically; `enabled` self-disables AI/authoring when `caps.agent==='none'`/`codeNodes==='run-only'`. Superset enforced by additive `surfaces` + `every(a => a.surfaces.includes('palette'))` test.

PHASED PLAN
1. Land `EngineCapabilities` union + `getCapabilities()` on `Executor` (both executors) + exhaustive-switch consumers. **Ship.**
2. `Action` type + `queryActions` + `Command` alias + superset unit test; CommandBar reads `queryActions` (zero UX change). **Ship.**
3. `actionContext.ts`; migrate `useCommandSources`; rewrite `ContextMenu` as `queryActions(surface:'menu')` projection — **the unification milestone.** **Ship.**
4. Add `node`/`connection`/`port` target actions (delete, disconnect, author-variant-via-AI); AI/Faust contributions. **Ship.**
5. Layer frecency/aliases on `queryActions` ordering; optional `path[]` submenus + `nodeToolbar` surface (from B) if warranted.

OPEN RISKS
- **Capability descriptor is runtime, not compile-time, at the seam boundary** — the union+switch catches *handling* gaps but a wrong field value (executor returns `'none'` when AI is live) silently disables a platform. Mitigate: integration test asserting native row = full, browser row = degraded.
- **`run(ctx)` migration tail** — every legacy zero-arg `run` is context-blind until ported; alias defers but doesn't eliminate. Track which actions still ignore `ctx`.
- **Flattened menu hierarchy** — dropping `menuCategories` nesting for `group`-bucketing may regress the friendly right-click UX for new users; verify with a real menu screenshot before declaring Phase 3 done; add `path[]` if nesting is missed.
- **Phase-1 dependency** — Action work (P2+) hard-depends on the SPINE capability seam landing first; if `getCapabilities()` slips, gate AI actions on a temporary `caps` stub, never `isTauri()`.

### Adversarial verdict

I now have full verification of every consumer and registrant. CommandBar uses cmdk's internal filtering (not `queryActions`), and both registrants (`useCommandSources`, `agentSessionStore`) construct `Command` objects with zero-arg `run: () => void`. I have enough to deliver the adversarial verdict.

---

CONFIRMED-OR-NOT: **CONFIRMED with required amendments** — the design is structurally sound and the cheapest path to the unification milestone, but two amendments are load-bearing and one claimed "free" property is false.

TOP RISKS (ranked)

**1. The `Command`→`Action` "deprecated alias" does NOT make existing registrants compile untouched — `searchCommands`/`getCommands` return types change.** Both registrants (`useCommandSources.ts`, `agentSessionStore.ts` line 104) build object literals typed `Command` with `run: () => void`. If `Action.run` becomes `run(ctx) => void`, a zero-arg literal still assigns (fewer params is contravariantly fine), so *those* compile. But `CommandBar.tsx` line 105 calls `command.run()` with no args — that breaks the moment the registry's snapshot type is `Action[]` and `run` requires a ctx, unless the alias's `run` is genuinely `(ctx?) => void`. The design says "adapting `run:()=>void`→`run:(_ctx)=>void`" — that adaptation must happen at *registration* (wrap each legacy command), not just at the type level, or `CommandBar`'s call site is unsound. REQUIRED: in `register()`, when a legacy `Command` arrives, normalize it to an `Action` with `run: (ctx) => legacy.run()`, `targets: ['global']`, `surfaces: ['palette']`. Don't rely on structural typing alone.

**2. CommandBar does not use `queryActions` today — it uses cmdk's internal filtering (`shouldFilter` default true, `value=` strings).** The design's Phase 2 says "CommandBar reads `queryActions` (zero UX change)." That is NOT zero-change: switching to a pre-ranked `queryActions` feed requires `shouldFilter={false}` (per the palette brief) AND removing the `value=` fuzzy strings, or you get double-filtering (cmdk re-filters your already-filtered list, silently dropping rows whose `value` doesn't substring-match). REQUIRED: Phase 2 must flip `shouldFilter={false}` and own ordering in the same change, or explicitly keep cmdk filtering and have `queryActions` only do target/surface gating (not query matching) until frecency lands. Pick one; "zero UX change" while introducing `queryActions` query-matching is contradictory.

**3. `enabled(ctx)` for the AI action reads `ctx.caps.agent`, but the capability seam (SPINE Phase 1) is an unbuilt hard dependency — and `Executor` has no `getCapabilities()` today (verified).** The open-risks section admits this but the mitigation ("temporary `caps` stub, never `isTauri()`") is the right call and must be enforced: `actionContext.ts` must import a `getCapabilities()` that exists, even if Phase-1 ships it returning a hardcoded native row. Otherwise Phase 3 (the unification milestone) can't land without Phase 1, and the temptation to gate AiPanel on `isTauri()` (current behavior) re-enters. REQUIRED: land a stub `getCapabilities()` on `Executor` in Phase 1 returning the discriminated union; never merge Action work that reads `caps` before it.

**4. Flattened menu hierarchy is a real UX regression for the "less tech-savvy" right-click audience.** `ContextMenu.tsx` renders nested `menuCategories` with category headers + submenus (lines 90-123). Switching to flat `group`-bucketing from `queryActions(surface:'menu')` drops the founder's curated nesting that the right-click menu exists *for*. The design defers `path[]` — acceptable only if verified. REQUIRED (already in plan, enforce it): screenshot-diff the menu before declaring Phase 3 done; if nesting is missed, `path[]` is not optional.

FATAL flaw: **None.** The skeleton survives. The additive-`surfaces` flag genuinely enforces the superset rule with one test, and dropping B's `menus[]`/`when`-DSL is the correct weight call for hundreds of items.

REQUIRED AMENDMENTS (concrete, minimal)
1. Normalize legacy `Command`→`Action` *inside `register()`* (wrap `run`, inject `targets:['global']`, `surfaces:['palette']`) — not type-alias-only. Fixes `CommandBar.tsx:105` call-site soundness.
2. In Phase 2, decide filtering ownership explicitly: either `shouldFilter={false}` + own ranking, OR `queryActions` does gating-only and cmdk keeps query-matching. Do not claim "zero UX change" while moving query matching.
3. Phase 1 must add `getCapabilities(): EngineCapabilities` to the `Executor` interface (both executors) returning the discriminated union — even stubbed — so `actionContext.ts` never falls back to `isTauri()`.
4. Keep the menu screenshot-diff gate on Phase 3; treat `path[]` submenus as required-if-regressed, not deferred-by-default.

Residual (carry, don't block): `agentSessionStore`'s `ai.dsp.*` command (line 104) must also flow through the normalization in amendment 1, or AI-authored nodes won't carry `targets`/`surfaces` and won't appear in right-click as the design claims ("AI nodes appear in both surfaces for free" is only true once `author_dsp_node` registers an `Action`, not a legacy `Command`).

Files grounding this: `src/store/commandRegistry.ts` (Command type, lines 29-40; search return types 119-143), `src/components/CommandBar/CommandBar.tsx` (cmdk filtering + `command.run()` at 105), `src/components/CommandBar/useCommandSources.ts` (legacy registrants), `src/store/agentSessionStore.ts` (line 104 AI command registrant), `src/audio/executor/Executor.ts` (no `getCapabilities()` — confirmed), `src/components/Canvas/ContextMenu.tsx` (nested `menuCategories` render, lines 90-123).

---

## Raycast-grade palette UX + preference learning + blazingly-fast

### Winning decision

Both files confirm the codebase reality: no ranking, cmdk-owns-filtering, and a single global `run()` with no context. I have everything needed to rule.

# 1) DECISION

Build **Direction A's local-frecency store as the load-bearing learning system, with Direction B's capability-gated Pi-memory bridge bolted on as an optional, additive, native-only enrichment layer.** Concretely: ship one new on-device Zustand store `src/store/paletteLearningStore.ts` (frecency + context-keyed boosts + prefix-win learning, lazy 5-day half-life decay, `persist` to WebView localStorage) plus a tiny `src/store/paletteScore.ts` fzf-style scorer; flip `CommandBar` to `shouldFilter={false}` and drive ordering from our own ladder (fuzzy + frecency + prefix-win + context). This ships **identically to native and browser** and is the entire "learns me" payoff for v1. Direction B's `pi-memory` projection becomes a strictly **additive seed boost** gated behind `caps.learning === 'pi-memory'`, landing only in a later phase, never on the keystroke path, never able to clobber live local scores. Local frecency is the floor the palette never degrades below.

# 2) WHY IT WINS (vs. the alternative)

Direction B as primary makes the headline "blazingly fast / learns me" feature **depend on the most fragile, unbuilt parts of the spine**: the broken `ai.rs` transport, the throwaway-worktree recall bug, governance latency (L1 needs human ratification, so "learns me" is *not* instant), and Pi-version-coupled `memory_search` names. That violates the spine's own constraint that palette/frecency "ship identically to both" platforms — B's deep value is native+Pi-only. It also couples a pure-frontend UX win to the untrusted-generator/RPC machinery for no latency benefit (ranking must be sync and O(1) regardless).

Direction A as primary is correct on every axis the spine cares about: zero RT involvement, zero control-rate IPC, zero `ai.rs` dependency, deterministic and resettable, private/offline, and platform-identical. Its only real sacrifice is *semantic* cross-session taste — which the spine **already assigns to pi-persistent-intelligence for the agent**, not the palette. So we graft exactly that one idea from B (the `caps.learning` seam and additive memory seeding) without inheriting its fragility: the palette gets smart on day one from local usage; if Pi memory exists, it *enriches* ordering, but its absence or breakage is invisible to the user.

# 3) CONCRETE DESIGN

**New: `src/store/paletteLearningStore.ts`** (Zustand + `persist`):
```ts
interface LearningState {
  frecency: Record<string, number>;               // commandId -> decayed score
  ctxFrecency: Record<string, number>;            // `${contextKey}\u0000${commandId}`
  prefixWins: Record<string, string>;             // queryPrefix(≤3) -> commandId
  lastUsed: Record<string, number>;
  seedBoosts: Record<string, number>;             // from Pi memory; additive, capped
  recordPick(commandId: string, ctx: PaletteContext, query: string): void;
  scoreFor(commandId: string, ctx: PaletteContext, query: string): number; // sync O(1)
  resetCommand(commandId: string): void;          // "Reset Ranking" action
  applySeedBoosts(seeds: Record<string, number>): void; // additive merge, never replace
}
```
Decay folded lazily at read: `raw * 0.5^((now-anchor)/HALF_LIFE)` with `HALF_LIFE = 5 days`; `recordPick` folds decay then `+= 1` (capped per event). `contextKey` = `sel:<nodeType>` / `canvas:empty` from `useGraphStore` selection + `useCanvasNavigationStore.currentViewNodeId`, read at open-time (no new IPC). Use a stable `frecencyKey` (slug) so AI-authored node ids surviving re-registration don't orphan scores — added as optional field to `Command` in `commandRegistry.ts`.

**New: `src/store/paletteScore.ts`** — fzf subsequence scorer (word-boundary + prefix bonus), replacing `commandRegistry.searchCommands`'s substring filter.

**Edit `commandRegistry.ts`** — add optional `frecencyKey?: string` to `Command`; keep `searchCommands` for non-UI callers but route it through `paletteScore`.

**Edit `CommandBar.tsx`** — set `<Command shouldFilter={false}>`; per keystroke compute memoized pre-ranked array (`fuzzy + scoreFor`), prefix-win hard-boost (`prefixWins[q.slice(0,3)]`), sort desc, cap ~50 rows; empty query sorts by `ctxFrecency || frecency` (top-picks on open). `runCommand` calls `recordPick` before `command.run()`. Zero-result → AI fallback rendered first, auto-highlighted, query pre-filled (gated `caps.agent !== 'none'` once `getCapabilities()` lands; until then existing `backend.available()`).

**Capability seam (additive, later phase):** add `learning: 'pi-memory' | 'local-only'` to `EngineCapabilities` on `Executor.getCapabilities()` as a discriminated member (compile-time exhaustiveness). Native+Pi → a control-rate post-turn/start-of-session read of `~/.pi/agent/pi-memory/rendered/` (or `memory_search` over RPC) maps node-affinity rules to `applySeedBoosts` — **additive, capped, never overwriting live scores.**

**Invariants preserved:** RT/no-alloc untouched (UI-thread JSON only, never reaches the audio callback or `push_graph`); control-rate IPC untouched (no per-keystroke IPC; memory read is coarse and cached); untrusted-generator/transactional unchanged (`recordPick` fires on explicit user selection only; seed boosts are read-only projections of *governed* Pi patches); Ctrl+K ⊇ right-click preserved (frecency lives on the shared registry/score layer, inherited free when ContextMenu migrates).

# 4) PHASED PLAN

- **P1:** `paletteLearningStore.ts` + `persist` + unit tests (decay math, prefix-win override, per-event cap). No UI change. Add `frecencyKey` to `Command`.
- **P2 (core ship):** `paletteScore.ts`; flip `CommandBar` to `shouldFilter={false}` + pre-ranked list; `recordPick` on run. This is the standalone "feels smart" win — no Pi, both platforms.
- **P3:** context-keyed boosts + empty-query top-picks; seed a small curated cold-start prior (Sampler→Filter, Osc→Gain) so day-1 ordering isn't bland.
- **P4:** AI-as-first-fallback on zero results; "Reset Ranking" + "why this rank" in the per-item action panel.
- **P5 (optional, native-only, after `ai.rs` protocol fix + stable per-project `localPath`):** `caps.learning` seam + Pi-memory → `applySeedBoosts` projection. Strictly additive; palette never degrades below P2's local floor.
- **P6 (optional):** aliases/hotkeys on the learning record (exact-alias = top of ladder).

# 5) OPEN RISKS TO CARRY INTO VERIFICATION

1. **Cold-start blandness** — mitigated by P3's curated prior; verify day-1 ordering is sensible with empty stores.
2. **Stale AI-node ids orphaning frecency** — `frecencyKey` MUST land with P2 or the founder's headline AI nodes leak learning every session; cover with a test asserting score survives re-registration under a new id.
3. **`shouldFilter={false}` regressions** — we now own a11y value strings + empty state; needs a render test asserting prefix-win ordering and zero-result AI fallback.
4. **localStorage quota/corruption** — wrap `persist` with version + `migrate` + try/catch reset so a bad blob never bricks the palette.
5. **Seed-boost clobber (P5)** — verify boosts are additive and capped, never replacing live local scores; needs "Reset Ranking" + explainability to keep ranking trustworthy once non-local signal enters.
6. **P5 ordering dependency** — Pi-memory projection must NOT ship before `ai.rs`'s `prompt`/`tool_execution_start`/`agent_end` fix and the stable per-project `localPath`; otherwise recall is amnesiac and the projection seeds nothing. Keep local frecency as the unconditional floor.

### Adversarial verdict

Confirmed: `Executor.ts` has zero `getCapabilities`/`EngineCapabilities` references. The capability seam does not exist. AiPanel gates on `backend.available()`, not `caps.agent`. This matches the decision's own admission that P5 is deferred until the seam lands. My adversarial verdict follows.

---

CONFIRMED-OR-NOT: **CONFIRMED** — local-frecency-as-floor with Pi-memory as an optional additive enrichment is the right shape; it respects every RT/IPC/ToS/untrusted-generator invariant and is the only direction that ships identically to both platforms. But four amendments are mandatory or the headline "learns me / blazingly fast" claim is false on day one.

TOP RISKS (ranked)

1. **`frecencyKey` orphaning is worse than stated — and the design under-specifies it.** Confirmed in `agentSessionStore.ts:103` AI-authored commands are `ai.dsp.${slug(name)}` and in `useCommandSources.ts:71` static nodes are `node.add.${type}`. The slug is the *only* stability anchor; if Pi renames a node across sessions ("warm reverb" → "warm verb"), the id changes and all learning leaks — exactly the founder's headline AI nodes. The decision adds `frecencyKey` to `Command` but never says who *sets* it for AI nodes. AMENDMENT: `frecencyKey` for authored nodes must derive from a content hash of `faustSource` (the `.wasm` content-address from the SPINE), NOT the name — so learning follows the *kernel*, not the label. For static nodes `frecencyKey = node.add.${type}` is fine.

2. **`shouldFilter={false}` silently breaks the existing Tab→AI + "Ask AI" item.** `CommandBar.tsx:148-158` renders the AI item via a `Command.Item` whose visibility depends on cmdk's filter. Flipping to `shouldFilter={false}` means YOU now own whether that item renders, its highlight order, and the zero-result auto-highlight. The decision mentions "AI fallback rendered first, auto-highlighted" but the current code puts AI at the *top group* unconditionally — re-implementing ordering risks losing the existing Tab handoff (`onKeyDown` Tab at line 137 is independent and survives, but the *clickable* item ordering does not). AMENDMENT: P2's render test must assert (a) Tab still enters AI mode, (b) the AI item is present and highlighted on zero local results, (c) prefix-win ordering.

3. **Per-event `+= 1` cap with 5-day half-life can be gamed into a stuck #1.** A user who adds Gain 40× in one session pins it above context-appropriate suggestions for ~2 weeks. Raycast's frecency uses recency *buckets*, not unbounded sums. AMENDMENT: cap per-command per-day contribution (fold-then-saturate), so a single-session spree can't dominate fortnight-scale ordering. Cheap, deterministic, prevents the "why is Gain always first" trust erosion.

4. **localStorage in the WebView is shared native+browser but wiped by Tauri WebView resets/updates.** The decision picks `persist` to localStorage as the single store for both platforms — fine for browser, but on native the spine already has `~/.pi` + keychain; a WebView data-clear on Tauri update silently resets "learns me." AMENDMENT (minor): document localStorage as best-effort on native and acceptable to lose; do NOT mirror to Pi memory to "fix" it (that re-introduces the fragility you correctly rejected). P4's "Reset Ranking" makes loss recoverable-by-design.

FATAL flaw: **None.** The decision survives. The seam (`caps.learning`) being absent today is correctly deferred to P5 and is not load-bearing for P1–P4.

REQUIRED AMENDMENTS (concrete, minimal)
- A1: AI-node `frecencyKey` = `wasm`/`faustSource` content hash, not slug(name). Land WITH P2. Add the test the decision already names (score survives re-registration under a new id) but key it on content, not id.
- A2: P2 render test must cover Tab→AI survival + zero-result AI highlight + prefix-win order (not just "prefix-win ordering").
- A3: Per-day per-command saturation cap on `recordPick`, not just per-event.
- A4: `persist` wrapper already specified (version+migrate+try/catch) — additionally treat native localStorage loss as acceptable; never back it with Pi memory.

Residual: P5 must not ship before `ai.rs`'s `prompt`/`tool_execution_start`/`agent_end` fix AND a stable per-project `localPath` (the throwaway-worktree at `ai.rs:117` destroys recall) — the decision states this; hold the line. Local frecency stays the unconditional floor.

---

## AI agent capability & orchestration (build whole working workflows, reuse-first, then code)

### Winning decision

# 1) DECISION

Ship **Direction A's rich introspection/batch tool surface as the foundation, with Direction B's `WorkflowPlan` grafted on as a single optional `emit_plan` apply-tool layered on top of those same primitives.** Concretely: extend the closed v1 catalogue with three pure read tools (`get_graph`, `list_node_types`, `find_nodes`), one atomic mutation tool (`batch_apply`), and `author_code_node` (Faust→content-addressed `.wasm`, retiring the `'effect'`+`faustSource` shoehorn). Add a `ToolResult.data` channel so reads feed real post-state back to Pi. Then add B's `validate_plan` read tool plus an `emit_plan` tool whose args *are* a `WorkflowPlan` that the host **validates, then compiles down to a single `batch_apply` frame** via `planToToolCalls`. The agent loop is: **introspect (`get_graph`/`list_node_types`/`find_nodes`) → optionally `validate_plan` → emit either a `batch_apply` or an `emit_plan` → one Approve/Reject.** Reuse-first is structural: the agent can only build from what `list_node_types` returns; `author_code_node` is the explicit, capability-gated fallback.

# 2) WHY IT WINS

Direction A is the correct *substrate* — its read tools are the non-negotiable fix for adversarial risk #3 (phantom-graph reasoning): the agent must see ground-truth state, and reads must return `data` to Pi. A's `batch_apply` already delivers "whole connected chain in one Approve," and its incrementalism (read tools ship first, zero risk) matches the spine's "land protocol fix + one E2E run before building on top." But pure-A sacrifices a *queryable validation gate* and lets a stubborn model emit broken wiring it only discovers via `addConnection` returning null mid-stream. Direction B's `validate_plan` + the "reaches a SpeakerOut" reachability check is the single best idea it has — it is what operationalizes the founder's "actually produces sound" requirement and gives a clean compile-repair signal (mirroring ojfaust's `RepairBudget`). Pure-B, however, front-loads a whole new validator+DSL+package and trades away step-by-step transcript drama and partial inspection for a big-bang apply. The graft keeps B's *validation and reachability* as a read tool and its *plan schema* as one optional apply path, while reusing A's `batch_apply` as the universal atomic-transaction primitive both paths compile into — so there is exactly **one** transaction/undo mechanism, not two. We pay B's validator cost only as a pure, testable function gating `emit_plan`, not as the mandatory write path.

# 3) CONCRETE DESIGN

**`src/ai/types.ts`** — extend `AgentToolName`/`AgentToolCall` with `get_graph`, `list_node_types`, `find_nodes`, `batch_apply`, `author_code_node`, `validate_plan`, `emit_plan`. Add `data?: unknown` to `AppliedToolResult`; add `AgentEvent` variant `{kind:'tool-result'; toolCallId; data}`. Add `WorkflowPlan`/`PlanError` (from B's `plan.ts`).

**`src/ai/plan.ts`** (new) — `WorkflowPlan` schema (symbolic `ref`s, wires by **port name**), `planToToolCalls(plan, idMap): AgentToolCall[]` lowering a plan to the existing add/connect/updateData primitives.

**`src/ai/planValidator.ts`** (new, pure) — `validatePlan(plan, store, registry): PlanError[]`: resolve refs, check type/pluginId exists, resolve port names against `manifestFor(type).ports`, run `canConnect` (registry.ts:836), Tarjan cycle check (excluding looper feedback kind), and the **SpeakerOut-reachability** "produces sound" assertion.

**`src/ai/tools.ts`** — `applyToolCall` gains the reads (`undo:NO_OP`, populate `data`), `batch_apply` (maps each sub-call, collects sub-undos, composite reverse-undo, **fail-closed**: revert partial batch on any sub-failure), `author_code_node`, and `emit_plan` → `validatePlan`; if clean, `batch_apply(planToToolCalls(...))`; if errors, return `ok:false` with `PlanError[]` as the repair signal. Generate `TOOL_CATALOGUE` descriptions from `allManifests()` so docs never drift.

**`src/ai/graphAdapter.ts`** — add read-only `listNodes()`, `findNodes(pred)`, `listNodeTypes()`; stays the only reach into graph state.

**`src/store/agentSessionStore.ts`** — `batch_apply`/`emit_plan` slot in as one `appliedResults[]` entry; existing `revertApplied()` covers reject unchanged. Relay `tool-result.data` back to Pi.

**`src-tauri/src/ai.rs`** — land the Pi-protocol fixes: send `{"type":"prompt","message":...}`; map `tool_execution_start`(`toolName`/`args`)→`tool-call`, `tool_execution_end`←host `tool-result` (so Pi reasons grounded), `agent_end`→`result`; `set_model` for Zen default after spawn. First-party `pi-openjammer-graph` package `registerTool`s all seven verbs.

**Native vs browser** — All reads + `batch_apply` + `emit_plan`/`validate_plan` are pure frontend, identical on both. Only `author_code_node` is gated through `Executor.getCapabilities().codeNodeAuthoring` (never `isTauri()`): native lowers Faust→`.wasm`; browser omits the tool from the catalogue unless a cloud build endpoint exists (agent reuses-only). AiPanel gate becomes `caps.agent !== 'none'`.

**Invariants** — Every mutation still flows through the five graphStore verbs; `batch_apply` is one undo frame; reads are side-effect-free; nothing auto-executes; Approve/Reject unchanged. No audio buffers cross (control-rate IPC); authored `.wasm` follows off-RT quarantine + Bypass-on-trip + NaN/denormal scrub. Ctrl+K stays superset (authored nodes register palette commands).

# 4) PHASED PLAN

1. **`ai.rs` protocol fix + `get_graph`/`list_node_types` (read-only) + one CI E2E Pi run.** Unblocks everything; zero mutation risk.
2. **`find_nodes` + `batch_apply`** (atomic, fail-closed) + `tool-result` data feedback; migrate `agentSessionStore` to grouped entries.
3. **`plan.ts` + `planValidator.ts` + `validate_plan`/`emit_plan`** (compiles to `batch_apply`); unit-test validator with the fake store; bounded repair loop (`follow_up` errors).
4. **`author_code_node`** (Faust→wasm) once open `pluginId` identity lands; capability-gate it.
5. **Generated capabilities doc + plan→Quicklink stamps + frecency reuse hints.**

# 5) OPEN RISKS

- **Tool-result feedback is new plumbing** — if `ai.rs` mis-maps `tool_execution_end`, the agent reasons blind. The CI E2E gate (phase 1) must verify a real round-trip before phase 2.
- **`batch_apply` partial-failure atomicity** — a mid-batch invalid wire must revert the whole frame; verify with a deliberately-broken batch test.
- **Validator vs runtime drift** — `canConnect` is any-to-any, so `validate_plan` catches missing-port/cycle/no-speaker but not *musically* wrong wiring; the reachability check is the only semantic guard.
- **Dynamic ports** (bundle expansion) aren't in static `PortDecl` — plans can only target declared ports; keep raw `add_connection` as the escape hatch.
- **Repair non-termination** — bound it (budget) → fail to `error` event.
- **Atomicity vs transcript drama** — `emit_plan` pops N nodes at once; consider B's ghost-node preview pre-Approve so users aren't surprised.

### Adversarial verdict

CONFIRMED-OR-NOT: Confirmed — the graft is the right shape, but two design claims are wrong as written and will produce broken or unverifiable behavior if shipped as-is.

TOP RISKS (ranked)

1. **`batch_apply` "fail-closed revert" silently breaks Pi's grounded reasoning — the very thing reads were added to fix.** The design feeds real post-state back to Pi via `tool-result.data`, but if `batch_apply` reverts on sub-failure, Pi receives `ok:false` for an *atomic* frame while having already emitted (in its own context) N successful-looking sub-steps. Pi cannot tell *which* wire failed from one composite error unless the result enumerates per-sub-call outcomes. REQUIRED: `batch_apply`'s failure `data` must return the per-sub-call status array + the resolved graph snapshot, not a scalar `ok:false`, or repair reasons blind.

2. **The `emit_plan` → `validatePlan` → `batch_apply` path duplicates validation that `batch_apply` itself must already do, and they can disagree.** `validatePlan` runs `canConnect` + reachability against a *predicted* idMap; `batch_apply` runs the real `addConnection` (which mutates, expands bundles, may return null). If the validator passes but `addConnection` returns null at runtime (dynamic-port/bundle cases the design itself flags as out-of-scope for static `PortDecl`), `emit_plan` reverts after passing validation — a confusing double-gate. REQUIRED: `emit_plan` must treat `validatePlan` as advisory pre-flight only; the authoritative gate is `batch_apply`'s runtime result, and a validator-pass/runtime-fail divergence must be surfaced explicitly as a repair signal, not swallowed.

3. **One Approve per turn collides with `extension_ui_request:confirm` from the spine decision.** This decision says "one Approve/Reject"; the spine's adversarial fix #3 mandates `extension_ui_request:confirm` gating because Pi has no host pre-execute. These are two different approval mechanisms. If tools run *inside* Pi's `pi-openjammer-graph` package, the host-side `agentSessionStore` Approve/Reject never sees them as pre-execute — it sees already-applied frames. REQUIRED: state explicitly that `batch_apply`/`emit_plan` are the Pi-package tools, they apply optimistically host-side on `tool_execution_start`, and the single Approve maps to *turn boundary* (`agent_end`/`turn_end`), not per-tool — reconciling with constraint #4's "host-replayed graph tools."

4. **`author_code_node` is phased last (phase 4) but the founder's headline includes "create a crazy effect node using code."** Reuse-first is correct, but shipping 1–3 without any code-node path means early demos can't show the differentiator. Acceptable, but flag: phase 4 must not slip, and `author_code_node` depends on open `pluginId` (constraint #7) landing first — that's a cross-decision blocker, not internal.

FATAL flaw: None. Survives.

REQUIRED AMENDMENTS (minimal)
- `batch_apply` result `data` = per-sub-call status array + post-state snapshot (risk 1).
- `emit_plan`: `validatePlan` is advisory; `batch_apply` runtime result is authoritative; surface validator/runtime divergence (risk 2).
- Pin approval semantics: optimistic apply on `tool_execution_start`, one Approve at `turn_end`/`agent_end`; `validate_plan` is the only true pre-execute read (risk 3).
- Keep raw `add_connection`/`add_node` in the catalogue as the dynamic-port escape hatch (design already notes this — make it explicit that `emit_plan` cannot express bundle expansion).

---

## Code-node execution model (brand-new nodes authored in code; native+browser)

### Winning decision

DECISION

Build Direction B's **one-WASM-contract / one-WasmHost** model as the spine, grafting Direction A's **Faust-as-primary-language + `compile_repair` loop** as the source frontend. Concretely: every AI-authored code node is lowered to a single content-addressed `.wasm` exporting a fixed import-free C-ABI DSP contract (`oj_init`/`oj_process`/`oj_param`/`oj_manifest_ptr`), hosted by the existing `WasmHost` and loaded identically by the browser worklet (`ojcore-wasm`) and native wasmtime (pooling + AOT + epoch). Faust is the default authoring language (best LLM ergonomics, existing bounded `compile_repair_with` repair signal), always lowered via `faust -lang wasm`; raw Rust/AssemblyScript→wasm is the secondary escape hatch satisfying the same contract. Native MAY prefer libfaust JIT (`FaustHost`) as a pure latency optimization, but a node's existence, identity, and round-trip NEVER depend on it.

WHY IT WINS

Direction A makes the artifact platform-dependent: native JIT + browser `.wasm` are two artifacts that must be golden-render reconciled forever — a permanent parity tax that silently breaks the "same node, two platforms" promise (SPINE #2). Direction B's single artifact eliminates that fork by construction; the `.wasm` IS the contract, and `faustHost` becomes a swappable accelerator behind the same identity, not a second source of truth. B also gives a non-Faust escape hatch (raw wasm satisfying `oj_*`) that A sacrifices — important because the founder explicitly wants "crazy effect nodes authored in code," not only DSP-idiomatic Faust. The cost B concedes — lowest native latency as default, and toolchain-free authoring — is recovered by grafting A's two best ideas: Faust as the primary author language (so we get concise LLM ergonomics + the repair loop, not hostile raw-wasm prompting) and the libfaust-JIT optimization where present. The adversarial verdict's amendment #5 (native MUST prefer `faustHost` when libfaust exists) is honored as an optimization layer, not an architectural dependency.

CONCRETE DESIGN

WASM contract (the "carefully crafted docs" deliverable): exports `oj_init(sr,maxBlock)`, `oj_process(inPtr,outPtr,n)`, `oj_param(idx,val)`, `oj_manifest_ptr()→u32` (offset of embedded JSON `{ports, params:ParamDecl[]}`); imports NONE (no WASI on RT instance); single pre-grown linear memory, never grows at runtime.

Rust:
- `crates/ojfaust/src/backend.rs`: implement Path B — shell `faust -lang wasm` + `faust -json`; stderr→`FaustError::Compile{message}` (recoverable, feeds `compile_repair_with`) vs missing binary→`Unavailable`. Embed the manifest blob in the `.wasm`.
- `crates/ojcore-wasm/src/lib.rs`: extend the content-addressed asset store (FNV) to hold authored DSP `.wasm`, keyed identically native/browser. Add native wasmtime `DspInstance` factory: `Engine` with `InstanceAllocationStrategy::Pooling`, `Module::deserialize` of AOT `.cwasm` compiled off-RT, `static_memory_maximum_size` capped + pre-grown, `epoch_interruption` on. RT callback calls only `oj_process`.
- `crates/ojcore/src/manifest.rs`: no schema change (`id` open, `WasmHost`/`Wasm` exist); register authored manifest exactly as `scan_plugins` registers `host.plugin` ids.
- `src-tauri/src/lib.rs`: add `author_wasm_node(source, lang) → {manifestId, manifestJson, wasmHash, diagnostic?}` — lower off-RT, AOT-compile, run quarantine warm-up, store content-addressed, return manifest.

Frontend (SPINE #7 open identity):
- `src/engine/types.ts`: carry `pluginId?: string` on the node alongside closed `NodeType`.
- `src/engine/registry.ts` + `serialization.ts`: `isPluginId` accepts any *registered* dynamic id; stop dropping registered ids on `importWorkflow`; re-resolve `.wasm` by content hash like a sample asset.
- `src/components/params/AutoParamPanel.tsx`: feed manifest `ParamDecl[]` from the embedded blob — zero bespoke React (`ui:'auto'`).
- `src/ai/tools.ts` + `types.ts`: retire the `'effect'`+`faustSource` shoehorn in `applyAuthorDspNode`; `author_dsp_node` calls `author_wasm_node`, adds a first-class node with the real `pluginId`; `undo` removes node + unregisters manifest.
- `src/audio/executor/Executor.ts`: add `getCapabilities().codeNodes ∈ {'author+run' | 'run-only' | 'none'}`; AiPanel/authoring gate reads this, never `isTauri()` (SPINE #1).

Native: wasmtime pooling+AOT+epoch preserves `<5ms` (per-block cost = one `oj_process` over pre-mmap'd memory); `faustHost` JIT optional accelerator. Browser: same `.wasm` runs allocation-free in AudioWorklet; authoring is `run-only` unless OJ operates a cloud build endpoint.

Invariants: RT no-alloc via pooling + pre-grown memory + zero imports (#3); control-rate IPC carries only content-hash + params, bytes load off-RT; untrusted-generator/reversible preserved — nothing auto-runs, live swap at block boundary returns old program dropped off-RT, Reject runs recorded undo (#4). PERMANENT (not warm-up-only) per-node output guards in the host wrapper: NaN/denormal scrub AND hard limiter/DC-block; epoch trip → `Bypass` slot flag (silence, never panic) — honoring adversarial #4.

PHASED PLAN

1. **Contract + browser run-only:** define `oj_*` ABI + embedded manifest; hand-author one `.wasm`; load in `ojcore-wasm` worklet; open frontend `pluginId` + `AutoParamPanel` + `getCapabilities().codeNodes`. Proves first-class identity end-to-end, zero toolchain risk.
2. **Faust→wasm authoring (native):** implement `backend.rs` Path B + `compile_repair_with`; `author_wasm_node`; retire `'effect'` shoehorn; one real Faust→wasm→sound in CI.
3. **Native wasmtime RT host:** pooling+AOT+epoch + quarantine + permanent output guards; A/B golden-render vs browser.
4. **libfaust JIT optimization (`--features libfaust`)** preferred on native when present; raw Rust/AS author path; serialization/content-address hardening; optional cloud build for browser authoring.

OPEN RISKS

- Native wasmtime per-block latency on 64-sample buffers vs libfaust JIT — measure in Phase 3; if it misses `<5ms`, JIT-when-present (Phase 4) becomes effectively mandatory on native, weakening "one artifact is enough."
- JIT/wasm behavioral fork once `faustHost` is enabled — golden-render A/B is the only guard; must be CI-gated.
- Quarantine cannot prove stateful-DSP safety (reverb/delay pathology emerges after minutes) — permanent limiter/DC-block/scrub is load-bearing, not optional.
- Embedded-manifest trust: the `.wasm` declares its own ports/params; a malformed blob must fail closed (reject node) not corrupt the registry.
- Browser authoring depends on a cloud build endpoint OJ may never operate — capability descriptor must report `run-only` honestly or users hit a dead "author" affordance.

### Adversarial verdict

Confirmed. `serialization.ts:95` filters on `isPluginId` (drops unknown ids), `registry.ts:825` returns `MISSING_DEFINITION` for anything not in the closed set — the blocker the design correctly targets. The Rust side is open (`manifest.rs:9`: "manifests can register at runtime without ever touching the RT match arms"). The design's reading of the codebase is accurate.

---

**CONFIRMED-OR-NOT:** CONFIRMED — the one-WASM-contract / Faust-frontend / open-`pluginId` spine is architecturally sound and codebase-grounded; it survives adversarial attack with the amendments below.

**TOP RISKS (ranked)**

1. **Embedded-manifest trust = a code-execution-adjacent registry-poisoning vector.** The `.wasm` declares its own ports/params via `oj_manifest_ptr()`. An AI-authored (untrusted-generator) blob can emit a manifest with a duplicate/colliding `pluginId`, malformed `ParamDecl[]`, or port counts that disagree with `oj_process`'s actual I/O. The design says "fail closed" but doesn't say *who validates*. If the frontend trusts the embedded JSON, a bad blob silently shadows a built-in id or feeds `AutoParamPanel` garbage. The manifest is attacker-controlled data crossing the trust boundary.

2. **Native latency is the real load-bearing risk, not "open."** The design demotes `faustHost` to "optimization" but Open Risk #1 admits wasmtime-on-64-samples may miss `<5ms`. For a *live-performance* flagship, if Phase 3 measurement fails, libfaust JIT becomes *mandatory* on native — collapsing "one artifact is enough" into "two artifacts after all" (exactly Direction A's parity tax the design claimed to avoid). This isn't an open risk; it's an unfalsified core assumption gating the whole "single artifact" thesis.

3. **Phasing ships a dead "author" affordance.** Phase 1 opens `pluginId` + `AutoParamPanel` + `getCapabilities().codeNodes`, but `author_wasm_node` doesn't land until Phase 2. Between phases, `tools.ts::author_dsp_node` is either still shoehorning `'effect'` or pointing at an unbuilt command — a half-open identity seam where serialization round-trips registered-but-unauthored ids.

4. **`compile_repair` is unexercised against a real backend.** `backend.rs` is a scaffold (`faust -lang wasm` is a comment). The repair loop is proven only via `compile_repair_with` test doubles. "Existing repair signal" is real as control-flow, vacuous as a Faust integration until Phase 2 lands one real compile in CI.

**FATAL flaw:** None. The spine holds.

**REQUIRED AMENDMENTS (concrete, minimal)**

1. **Validate the embedded manifest host-side, fail closed, before registry insertion.** In `author_wasm_node` (Rust, off-RT): reject if `pluginId` collides with any built-in `KNOWN_PLUGIN_IDS` or existing registered id; schema-validate the blob against `schemas/oj-plugin-v1.json`; assert declared port counts match the `.wasm`'s actual `oj_process` arity by probing the instantiated module. Namespace all authored ids `ai.wasm.<hash>` so collision with built-ins is structurally impossible. A failed validation returns `diagnostic` and registers *nothing*.

2. **Make the native-latency check a Phase-2 gate, not a Phase-3 open risk.** Benchmark `oj_process` over a 64-sample block on the native wasmtime host *before* retiring the `'effect'` shoehorn. If it misses budget, the spine's default flips to "native prefers `faustHost` JIT, wasm is fallback" — and the docs/capability descriptor must say so honestly rather than promising single-artifact parity it can't hit at `<5ms`.

3. **Collapse Phase 1 authoring into run-only honestly.** Phase 1 must ship `getCapabilities().codeNodes='run-only'` on *every* surface (native included) until Phase 2 lands `author_wasm_node`. Do not expose an "Author via AI" action until the backend exists. Keep the `'effect'` shoehorn untouched until Phase 2 atomically replaces it — no half-open seam.

4. **Permanent per-node output guard is non-negotiable and must be in the host wrapper, not the kernel.** NaN/denormal scrub + hard limiter + DC-block live in the *host* `oj_process` wrapper (both wasmtime and worklet), so an untrusted kernel cannot disable them. CI-assert they fire on a deliberately-pathological test `.wasm`.

Files grounding this verdict: `src/engine/serialization.ts:95`, `src/engine/registry.ts:825`, `crates/ojfaust/src/backend.rs` (scaffold, `faust -lang wasm` commented at :99), `crates/ojcore/src/manifest.rs:9` (open runtime registration), `src-tauri/src/lib.rs:64` (`host.plugin` dynamic-id precedent).

---

## Pi integration depth & the native Pi experience (packages + persistent intelligence)

### Winning decision

DECISION

Build **subprocess-rpc-plus** (Direction A): keep Pi as a Rust-owned `pi --mode rpc` subprocess, but (1) fix `ai.rs` to the real Pi wire protocol, (2) replace the throwaway worktree with a **stable per-project agent workspace**, (3) ship a first-party bundled package `pi-openjammer-graph` whose six graph tools execute inside Pi but call back to the host and **return the real post-mutation graph state**, gated by `extension_ui_request:confirm` batched at turn boundaries, and (4) install `pi-persistent-intelligence` into that workspace with a project-local `localPath`. Graft Direction B's two best ideas: the **`getCapabilities()` capability seam** (`agent: 'subprocess-rpc' | 'remote-proxy' | 'none'`) lands first as a typed discriminated union, and the **host-round-trip-returns-real-state** tool contract (B's central insight) becomes how A's package tools stay grounded. Defer the Node sidecar.

WHY IT WINS

Both directions converge on the same correct move — graph tools must return the real graph state so Pi never reasons against a phantom graph — and both keep Rust owning env_clear+allowlist+keychain. The deciding tradeoff is **shipping cost and attack surface**. Direction B requires bundling a 40–90 MB Node runtime per platform, makes OpenJammer own Pi's version + Node CVEs, and runs Pi's `bash`/`write`/`edit` built-ins *in-process* — forcing an `excludeTools` allowlist that **removes the very package-authoring capability** the founder wants ("create Pi packages/plugins for Pi itself"). A keeps the subprocess boundary as the cheap blast-radius container, lets Pi keep its full toolset (so it can genuinely install/author packages), and adds zero new toolchain to CI. B's in-process Approve/Reject elegance is unnecessary: A reproduces grounded reasoning via the round-trip return, and the existing `agentSessionStore` undo/Approve machinery is untouched. We lose B's transport-agnostic reuse-for-remote-proxy bonus — but the capability seam already reserves `'remote-proxy'`, so that door stays open.

CONCRETE DESIGN

Files to change:
- `src-tauri/src/ai.rs` — transport fix: send `{"type":"prompt","message":prompt}` (not `run`); keep stdin open for run lifetime (steer/abort); `parse_pi_line` recognizes `tool_execution_start`(`toolName`/`args`/`toolCallId`)→`tool-call`, `message_update.assistantMessageEvent.text_delta`→`thought`, `agent_end`→`result`, `extension_ui_request`→new `kind:"ui-request"`, fold `tool_execution_end`; after spawn send `{"type":"set_model","provider":"opencode-zen","modelId":…}`; keep HOME/USERPROFILE forwarded. Replace `Worktree` with `AgentWorkspace` under `~/.openjammer/agent/<projectId>/` (reused, not disposable), with a `mode:'scratch'|'project'` toggle.
- `src/audio/executor/Executor.ts` — add `getCapabilities(): EngineCapabilities` (discriminated union, exhaustive switch per SPINE #1); native returns `agent:'subprocess-rpc'`, browser `agent:'none'`.
- `src/ai/types.ts` — add `ui-request` AgentEvent + `uiRequestId`/`method`; keep the six `AgentToolName`s as the package mirror.
- `src/ai/PiAgentBackend.ts` — handle `ui-request` line; reply `extension_ui_response`.
- `src/ai/tools.ts` — `applyToolCall` is the host-side apply the package calls back into; returns real node id/post-state.
- `src/store/agentSessionStore.ts` — turn-boundary approve; undo machinery reused as-is.
- `src/components/CommandBar/AiPanel.tsx` — gate becomes `caps.agent !== 'none'` (not `isTauri()`).
- NEW `pi-openjammer-graph/` (bundled resource): `export default function(pi){…}` registering six `registerTool`s (typebox params mirroring `*Args`) whose `execute` emits the call, awaits host apply, returns real post-state; plus `oj_install_package`/`oj_list_packages` commands.

Native: full path. Browser: `caps.agent='none'`, AiPanel keeps its honest "AI requires the desktop app"; package/memory don't exist. Invariants: RT no-alloc untouched (control-plane JSON only); untrusted-generator/reversible intact (Pi only emits; `applyToolCall`+undo behind Approve); secret boundary intact (keychain→single env var; workspace holds Pi's `~/.pi`, never OJ secrets); Ctrl+K superset unchanged.

PHASED PLAN

1. **Capability seam first** — `getCapabilities()` + exhaustive `EngineCapabilities` union; migrate AiPanel off `isTauri()`. (SPINE #1, prerequisite.)
2. **Protocol fix + CI e2e** behind a feature flag: `prompt`/`tool_execution_start`/`agent_end`/`set_model`, one real Pi run reaching the graph. (SPINE #2 — gates everything below.)
3. **Stable workspace** + scratch toggle; verify HOME forwarding keeps `~/.pi` auth/memory.
4. **`pi-openjammer-graph`**: six tools returning real post-state; `confirm` batched at turn boundary; reconcile with `agentSessionStore`.
5. **`pi-persistent-intelligence`** install + project-local `localPath`; emit explicit corrections as capture-eligible.
6. **Package install/create host actions** + Pi-style agent docs (six tools + Faust authoring).

OPEN RISKS

- **Pi version drift** silently breaks `set_model`/event names (runtime descriptor, no compile guard) — pin Pi version, keep CI e2e from phase 2, keep degrade-to-thought fallback.
- **Turn-boundary confirm batching** wrong → modal storms killing "blazingly fast"; must confirm per-turn, not per-call.
- **Stable workspace = larger attack surface** than disposable — a malicious persisted tool call survives runs; keep env_clear, treat workspace as Pi-owned, never store OJ secrets there.
- **Memory `localPath` isolation regression** leaks one project's taste into another — verify per-project dir.
- **Round-trip latency** (Pi `execute`→host apply→return) adds per-tool-call cost; ensure it stays off the RT/audio path (it does — control plane only).

### Adversarial verdict

CONFIRMED-OR-NOT: Confirmed — subprocess-rpc-plus survives; it is the right shape. Amendments below are mandatory, not optional.

TOP RISKS (ranked)

1. **The package-tool round-trip is itself an `extension_ui_request` storm, and confirm-batching is under-specified to the point of being unbuildable as written.** Each of the six tools executing inside Pi must (a) call back to host, (b) await `applyToolCall`, (c) return real post-state. But "batched at turn boundaries" collides with how Pi reasons: Pi calls `add_node`, *needs the returned node id* to call `add_connection` in the SAME turn. So you cannot defer apply to the turn boundary — apply must happen per-call (to return a real id), while *Approve* is deferred. That means the graph is already mutated live before the user approves (exactly today's optimistic-apply model), and "confirm" is NOT `extension_ui_request:confirm` per tool — it is the existing `agentSessionStore` Approve/Reject at turn end. **The design conflates two confirm mechanisms.** REQUIRED: drop `extension_ui_request:confirm` for graph tools entirely; apply optimistically per-call via the host round-trip (returning real ids), keep undo closures, and Approve/Reject once at `agent_end`. Reserve `extension_ui_request` only for genuinely interactive Pi prompts (auth, destructive non-graph ops).

2. **Stable workspace + full Pi toolset + env-injected key = a persisted-RCE locker.** A keeps Pi's `bash`/`write`/`edit` (correctly, for package authoring) AND makes the cwd stable AND injects the provider key as env. A prior run (or a prompt-injected one via a malicious sample/preset name reaching Pi) can write a script into the stable workspace that re-runs next launch, and read the injected key from its own env. Disposable-worktree's one virtue was blast-radius reset. REQUIRED: (a) the stable workspace holds ONLY `~/.pi` (auth/memory) and the project memory `localPath` — NOT a Pi-writable scratch/cwd; give Pi a *disposable* cwd each run while pointing HOME at the stable dir, so memory persists but executable droppings don't. (b) Keep the key out of `~/.pi/auth.json` on the stable disk (the brief already says keychain→env only — enforce it; `auth.json` persistence would defeat the boundary).

3. **No compile-time guard that `parse_pi_line`'s event mapping matches the Pi version actually spawned.** Phase 2's CI e2e is the only thing standing between "works" and silent degrade-to-thought on a Pi bump. That is a runtime contract with a test, not a guard. REQUIRED: at spawn, send `get_commands`/`get_available_models` and assert the expected command/event vocabulary; on mismatch, surface a typed `agent:'none'`-with-reason rather than silently degrading every tool call to a thought.

FATAL flaw: none.

REQUIRED AMENDMENTS (concrete, minimal)
- Reconcile the two confirm models: graph tools apply per-call (real-id round-trip) + Approve once at `agent_end`; `extension_ui_request` reserved for non-graph interactive prompts. Fix this in the DECISION text and in `agentSessionStore`/`pi-openjammer-graph` design.
- Split workspace: stable HOME (auth+memory only) + disposable per-run cwd. Update `ai.rs` `AgentWorkspace` to this two-dir shape, not a single reused dir.
- Add a spawn-time capability handshake (`get_commands`) feeding a reasoned `agent:'none'` on drift; don't rely on CI alone.
- Keep `set_model` but treat failure as fatal-to-AI (typed error), not silent — same handshake path.

One caveat on scope: the founder's "create Pi packages/plugins for Pi itself" headline now structurally depends on giving Pi a writable cwd — amendment #2's disposable cwd is fine for authoring *within a run*, but persisting an authored package requires an explicit host-mediated "save package" action (copy out of the disposable cwd into a user location), not Pi writing to a durable path itself. Make that the only durable-write path.

---

## Pi auth & first-Tab onboarding (Zen default; all Pi options; native + browser)

### Winning decision

Verified. The three load-bearing facts hold: `ai_run` sends `{"type":"run","prompt":...}` (line 163) which Pi has no command for; `parse_pi_line` keys on `tool_call`/`result`/`done` (lines 206/225) and would degrade real `tool_execution_start`/`agent_end` to thought; `Executor` has no `getCapabilities()`; `AiPanel` gates on `backend.available()` (line 42). Both directions correctly diagnose this. Here is my ruling.

---

# 1) DECISION

Build **Direction B (openjammer-managed-auth) as the spine, grafting Direction A's `ai_auth_status` reconciliation probe as a mandatory pre-flight.** OpenJammer owns a first-class, keyboard-navigable provider chooser that runs Codex loopback-PKCE itself, stores long-lived secrets in the **OS keychain** (`tauri-plugin-keyring`), and injects the resolved key as the single allowlisted env var into the throwaway Pi subprocess at spawn — keeping `env_clear`+allowlist intact and nothing on OpenJammer's disk. Default = opencode Zen BYO-key (paste + live `/v1/models` validation + non-dismissible data-training notice). No Claude Pro/Max button anywhere. Crucially, before every run and on chooser open, we call a new `ai_auth_status` that reads `~/.pi/agent/auth.json` so OpenJammer **detects and defers to** any credentials Pi already owns (Pi's resolution order is `auth.json` > env) instead of silently fighting them. The Pi RPC protocol bugs in `ai.rs` are fixed in the same lane as a hard prerequisite.

# 2) WHY IT WINS

Direction A (delegate-to-pi-login) minimizes OpenJammer's secret-handling code, but it **sacrifices the founder's headline requirement**: "a window to authenticate that feels seamless and native… a few clicks or keyboard navigation." A's auth UX is Pi's terminal-flavored interactive `/login` driven as a one-shot child — exactly the brittle, version-fragile, non-native experience the vision rejects. A also concedes the keychain (secrets sit in Pi's `auth.json`) and inherits Pi-version coupling on three axes (`auth.json` shape, `/login` prompt parsing, provider names). Direction B costs more code and makes OpenJammer the secret custodian + disclosure-bearer, but it delivers the native WebView chooser, the strongest at-rest posture (OS keychain, not a `0600` dotfile), and a ToS-clean ladder OpenJammer controls directly. The decisive graft: A's single best idea is the **`auth_status` reconciliation probe** — without it, B's fatal failure mode (Direction B's own risk: "Pi resolves `auth.json` > env… silently wins over OJ's injected key") goes undetected. Importing that probe converts B's worst liability into a handled case, and B keeps the native UX A can never offer.

# 3) CONCRETE DESIGN

**New Rust `src-tauri/src/auth.rs`:**
- `auth_status() -> AuthState { keychainProvider, piAuthJsonProviders: Vec<String>, activeProvider, modelId, configured, conflict: bool }` — reads OS keychain AND parses `~/.pi/agent/auth.json` keys (HOME-forwarded path); sets `conflict` when both define the active provider so the chooser can warn "Pi already has credentials for X; using those."
- `auth_begin_oauth(provider) -> { authorizeUrl, state }` — PKCE S256, 32-byte verifier; ephemeral loopback via `tauri-plugin-oauth`, redirect `http://localhost:1455/auth/callback`, client `app_EMoamEEZ73f0CkXaXp7hrann`, scopes `openid profile email offline_access` (Codex).
- `auth_store_key/get_key/clear(provider)` — `tauri-plugin-keyring` (Windows Credential Manager / macOS Keychain / libsecret). Not Stronghold.
- `auth_validate_key(provider, key) -> bool` — server-side `GET https://opencode.ai/zen/v1/models` (avoids browser CORS).

**Change `src-tauri/src/ai.rs`:**
- `ai_run` drops the `provider_key` JS param; at spawn calls `auth_get_key` for the active provider, but **only injects it when `auth_status().conflict == false`** (defer to Pi's `auth.json` otherwise), mapping to `OPENCODE_ZEN_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` via `OPENJAMMER_AI_KEY_VAR`.
- **Fix line 163:** `{"type":"prompt","message":prompt}`. **Fix `parse_pi_line`:** recognize `tool_execution_start`(`toolName`/`args`)→`tool-call`, `agent_end`→`result`, `message_update.assistantMessageEvent.text_delta`→`thought`. After spawn send `{"type":"set_model","provider","modelId"}` (no persisted default confirmed); probe `get_available_models` first and fail loud if the model is absent.

**Capability seam `src/audio/executor/Executor.ts`:** add `getCapabilities(): EngineCapabilities`, a **discriminated union consumed via exhaustive switch** (compile error on missing field, per verdict risk #1): `{ agent: 'pi-subprocess'|'remote-proxy'|'none'; auth: 'keychain-loopback'|'paste-proxy'|'none'; codeNodeAuthoring: boolean }`. Native returns `pi-subprocess`/`keychain-loopback`; wasm returns `none`/`none`.

**Frontend:** new `src/components/CommandBar/AuthChooser.tsx` (cmdk list — arrow/Tab nav, Enter→system browser→auto-return); `src/auth/authStore.ts` (Zustand wrapping the Tauri commands + persisted *provider+model only*, never key). **AiPanel gate becomes** `caps.agent !== 'none' && authStore.configured`; first Tab with `!configured` routes to `AuthChooser`. Register "Configure AI provider" as a palette command (Ctrl+K superset preserved; right-click need not expose it). Add it to `src-tauri/src/lib.rs` `invoke_handler`.

**Native vs browser:** Native = full flow. Browser = `agent:'none'`/`auth:'none'`; AiPanel keeps the honest DesktopOnly message; no keychain, no loopback, no paste (proxy out of scope).

**Invariants:** RT no-alloc untouched (auth is control-plane Tauri IPC). Untrusted-generator/transactional unchanged (auth only resolves *who pays*; tool calls still apply-with-undo→Approve/Reject). Secret boundary *strengthened* (keychain at-rest; stripped-env injection stays the sole path into Pi; nothing on OJ disk). HOME/USERPROFILE stay forwarded so `~/.pi` survives.

# 4) PHASED PLAN

1. **Seam + protocol (unblocks everything).** Add `getCapabilities()`/`EngineCapabilities` union + exhaustive switch; rewire AiPanel gate. Fix `ai_run` (`prompt`/`tool_execution_start`/`agent_end`/`set_model`). Land **one real Pi e2e in CI behind a feature flag** before building on top (verdict risk #2).
2. **`auth_status` reconciliation probe** + keychain store; chooser renders read-only (shows what keychain AND `auth.json` already have; surfaces `conflict`).
3. **Zen paste-key** + live `/v1/models` validation + `opencode.ai/auth` browser launch + non-dismissible data-training notice (default, zero OAuth, lowest risk).
4. **Codex loopback PKCE** (`tauri-plugin-oauth`, `localhost:1455`).
5. **Anthropic API key + BYO**; Claude-OAuth only behind an Advanced screen with ToS warning, never defaulted.

# 5) OPEN RISKS TO CARRY

- **Two auth implementations, one label:** keychain+loopback (native) vs future browser paste-proxy share ~zero code — verify both independently.
- **`set_model` drift:** a Pi RPC rename silently breaks model selection — the `get_available_models` pre-probe + fail-loud is the only guard; assert it in the e2e.
- **`auth.json` > env reconciliation:** the `conflict` flag is now load-bearing; test the case where a user ran `pi /login` separately so OJ correctly defers rather than injecting a dead key.
- **Codex preamble:** OpenAI requires the Codex system-prompt preamble for validation — confirm Pi emits it, else Codex-billed calls fail.
- **Throwaway worktree vs pi-persistent-intelligence (Spine residual c):** HOME forwarding keeps `auth.json`/memory readable, but the disposable cwd still kills per-project recall — out of scope here, flag for the memory lane (needs a stable per-project `localPath`).
- **Token refresh latency:** Codex refresh must run off the spawn hot path so first-Tab stays fast.
- **Keychain unavailability** (headless Linux/locked keyring): chooser must degrade to a clear error, not a silent `configured=false`.

### Adversarial verdict

CONFIRMED-OR-NOT: Confirmed — the decision survives; Direction-B-as-spine with the `ai_auth_status` reconciliation graft is the right call, but it ships with three under-specified seams that will silently fail in production.

TOP RISKS (ranked)

1. **The `conflict`-gated injection is a footgun that defeats the keychain default.** The design only injects OJ's key when `auth_status().conflict == false`. But "conflict" is defined as *both* keychain AND `auth.json` defining the *active* provider. Consider the common case: user pastes a Zen key into OJ's chooser (keychain), but previously ran `pi /login` for Codex (`auth.json` has `opencode`? no — has `openai`). Active provider = Zen. No conflict detected → OJ injects Zen key. Fine. But now switch active to Codex: `auth.json` has Codex creds, keychain doesn't → no conflict, OJ injects nothing → Pi uses `auth.json`. Also fine. The *real* trap: `auth.json` `key` fields support `$VAR`/`!shellcmd` indirection. A `auth.json` entry can *name* a provider while its key resolves to empty/stale. OJ sees the provider key present → declares conflict → defers → Pi resolves to a dead key → run fails with an opaque Pi error, and OJ deliberately withheld the working keychain key. **The probe must validate, not just detect presence.**

2. **`set_model` + `get_available_models` pre-probe adds latency to the founder's "blazingly fast" first Tab.** Every run now does: spawn → `get_available_models` round-trip → `set_model` round-trip → `prompt`. On a cold Pi subprocess in a throwaway worktree that's easily 1–3s before the first token. The verdict's own residual risk (token refresh off hot path) compounds this. First-Tab perception is the headline UX bar.

3. **Browser is `auth:'none'`/`agent:'none'` — but that means the entire auth lane is desktop-only, leaving the PWA's AI value prop at zero with no graceful path even where a key exists.** Consistent with the spine, but it hard-concedes that the "seamless native auth window" the founder wants literally cannot exist for web users. Acceptable, but must be stated as a product limit, not a bug.

FATAL flaw: None.

REQUIRED AMENDMENTS (concrete, minimal)
- **A1 (fixes #1):** Redefine `conflict` resolution by *outcome*, not presence. `auth_status` must resolve each provider's `auth.json` key (expand `$VAR`/`!shellcmd`, check non-empty/non-expired) and only set `conflict=true` when Pi would resolve a *working* key. When `auth.json`'s key is unresolvable, prefer the keychain key and inject. Add an e2e case: `auth.json` names provider with empty `$VAR`.
- **A2 (fixes #2):** Cache `get_available_models` per (provider, Pi-version) and skip the pre-probe on warm cache; send `set_model` optimistically and only fall back to the probe on a `set_model` error `response`. Keep one persistent Pi subprocess across Tabs rather than per-run spawn, so model selection is paid once.
- **A3 (fixes #3):** Make `EngineCapabilities.auth` include `'paste-proxy'` in the union *now* (even if browser returns `'none'` today) so the exhaustive switch already has the arm — prevents a future web-auth addition from being a breaking seam change.
- **A4:** Assert in the CI e2e that Pi emits the Codex system-prompt preamble (residual risk), else Codex billing silently fails.

Files: `src-tauri/src/auth.rs` (new), `src-tauri/src/ai.rs` (protocol + injection gate), `src/audio/executor/Executor.ts` (union arms).

---

## Cross-decision coherence + completeness critique

I have what I need. The CRDT bridge diffs `graphStore.version` after every verb — which AI tool calls and `batch_apply` mutate directly, with serious interaction implications. I have enough verified ground truth to write the synthesis.

---

# COHERENCE & COMPLETENESS REVIEW (all decisions + spine)

## 1) CONTRADICTIONS / INTEGRATION GAPS

**G1 — Two irreconcilable approval models survive across decisions.** The Pi-integration decision's adversarial fix says: *drop `extension_ui_request:confirm` for graph tools; apply optimistically per-call (host round-trip returns real ids), Approve once at `agent_end`.* But the SPINE constraint #4 and the AI-orchestration verdict still reference `extension_ui_request:confirm` gating. **Reconcile (authoritative):** graph tools (the six + `batch_apply`/`emit_plan`) apply optimistically host-side on `tool_execution_start` via `applyToolCall`, return real post-state to Pi, record undo closures; the single Approve/Reject fires at `agent_end`/`turn_end` through existing `agentSessionStore`. `extension_ui_request` is reserved ONLY for non-graph interactive prompts (auth, destructive ops). Write this once in `agentSessionStore` and delete the per-call-confirm language from the other lanes.

**G2 — CRDT collab is entirely unaccounted for, and it will double-apply or desync AI edits.** `src/collab/graphStoreBridge.ts` diffs `graphStore.version` after every verb and commits to the CRDT. AI tool calls and `batch_apply` mutate through those same verbs — so in a live collab session, each optimistic AI mutation broadcasts to peers *before* Approve, and a **Reject's `revertApplied()` undo closures also broadcast**, but peers have no notion of OpenJammer's Approve/Reject transaction. A rejected workflow leaves peers with phantom nodes. **Reconcile:** wrap the entire agent run in the bridge's `applyingRemote`-style guard so optimistic AI mutations are NOT diffed to peers until Approve; on Approve, emit one CRDT commit for the whole frame; on Reject, emit nothing. This makes `batch_apply`'s single-undo-frame and the CRDT's single-commit align. Must be a named deliverable — no decision mentions `collab/`.

**G3 — `frecencyKey` content-hash (palette A1) depends on the `.wasm` content-address (code-node spine), which lands in code-node Phase 2/4 — but palette P2 wants `frecencyKey` "WITH P2."** Sequencing collision. **Reconcile:** palette P2 ships `frecencyKey = node.add.${type}` for static nodes immediately; AI-node content-hash keying is deferred to land *with* `author_wasm_node` (code-node Phase 2), not palette P2. Until then AI nodes key on `ai.dsp.${slug}` and accept learning-leak — explicitly a known gap, not silently shipped.

**G4 — `EngineCapabilities` field set is defined differently in four lanes.** Action lane: `{agent, codeNodes, auth}`. Code-node lane: `codeNodes ∈ {'author+run'|'run-only'|'none'}`. Auth lane: `{agent, auth, codeNodeAuthoring: boolean}`. Learning lane adds `learning`. **Reconcile:** ONE canonical union in `src/engine/capabilities.ts`: `{ agent: 'pi-subprocess'|'remote-proxy'|'none'; codeNodes: 'author-and-run'|'run-only'|'none'; auth: 'keychain-loopback'|'paste-proxy'|'none'; learning: 'pi-memory'|'local-only' }`. Drop the redundant `codeNodeAuthoring` boolean (subsumed by `codeNodes`). All four lanes import this one type or they will drift.

**G5 — `Command`→`Action` normalization (action lane A1) must wrap `agentSessionStore`'s `ai.dsp.*` registrant (line ~104) AND `useCommandSources`, or AI nodes never appear in right-click.** This is stated in the action lane's residual but is a cross-lane dependency with the AI lane's `author_code_node`. **Reconcile:** normalization lives in `commandRegistry.register()` itself (wrap legacy `run`, inject `targets:['global']`, `surfaces:['palette']`); then `author_code_node`/`author_dsp_node` must register a real `Action` with `targets:['global','canvasPoint','selection']` to get both surfaces. One registration path, enforced by the superset unit test.

## 2) SEQUENCING (build order, what unblocks what)

**Phase 0 — the seam (unblocks ALL).** `src/engine/capabilities.ts` (G4 canonical union) + `getCapabilities()` on `Executor` and both executors (native = full row, browser = degraded), consumed via exhaustive switch. Migrate AiPanel gate `backend.available()` → `caps.agent !== 'none'`. *Everything reads this; nothing else can correctly branch first.*

**Phase 1 — Pi transport truth (unblocks all AI claims).** Fix `ai.rs`: `{"type":"prompt"}`, `tool_execution_start`→`tool-call`, `agent_end`→`result`, `set_model`. Spawn-time `get_commands` handshake → reasoned `agent:'none'` on drift. **One real Pi E2E in CI behind a feature flag.** Until this lands, *zero tool calls reach the graph* — every downstream "builds workflows / reversible" claim is unverified.

**Phase 2 — Action registry + local frecency (pure frontend, no Pi/Rust dep).** `Action` type + `queryActions` + `register()` normalization (G5) + superset test; `shouldFilter={false}` + `paletteLearningStore`/`paletteScore` in the same change (the verdict's "no zero-UX-change" amendment). Ships identically to both platforms.

**Phase 3 — Read tools + grounded reasoning.** `get_graph`/`list_node_types`/`find_nodes` + `ToolResult.data` round-trip; verify via the Phase-1 E2E. Then `batch_apply` (fail-closed, per-sub-call status array per AI verdict). **Wrap in collab guard (G2).**

**Phase 4 — Unification milestone.** `actionContext.ts` + rewrite `ContextMenu` as `queryActions(surface:'menu')` projection; screenshot-diff gate for menu nesting regression.

**Phase 5 — Open node identity.** `pluginId` on node; `isPluginId` accepts registered dynamic ids; `serialization` stops dropping them + content-address re-resolve. **Blocks `author_code_node`.**

**Phase 6 — Code-node authoring.** `author_wasm_node` (Faust→wasm), **native 64-sample latency benchmark as a Phase-6 gate** (not open risk), retire `'effect'` shoehorn atomically, host-side manifest validation (fail-closed, namespace `ai.wasm.<hash>`). Until here, `codeNodes='run-only'` on every surface honestly.

**Phase 7 — Auth chooser, pi-persistent-intelligence, packages, plan/validator, frecency Pi-memory seed** (all optional/native, gated on Phases 0–1).

## 3) WHAT IS MISSING

- **CRDT/collab interplay (G2)** — biggest omission; no decision touches `src/collab/`.
- **`'effect'`+`faustSource` migration path** — existing saved workflows with shoehorned nodes need a load-time upgrade to first-class `pluginId`; otherwise Phase 5/6 orphans them. No decision specifies the migration.
- **NodeType-union opening without breaking serialization** — `serialization.ts:95` drops non-`isPluginId` types; the `WORKFLOW_VERSION` major check (line 80–85) means opening identity may need a version bump + migrate. Unspecified.
- **Security review** — untrusted authored `.wasm` + Pi with full toolset + stable HOME + injected key + prompt-injection via sample/preset names reaching Pi. No lane owns the combined threat model.
- **Testing strategy** — extend `src/ai/__tests__` (real Pi E2E, batch atomicity, tool-result round-trip), `agentSessionStore` (collab-guarded reject), `collab/__tests__/convergence` (AI-edit convergence), wasm parity golden-render, Rust `ai::`/`auth::` tests, pathological-`.wasm` guard-fires test.
- **Offline/PWA honesty, agent run telemetry/observability, accessibility of AuthChooser + palette (`shouldFilter={false}` a11y value strings), failure/empty/cancel states** (abort mid-stream, Pi crash, keychain unavailable) — none owned.
- **The "carefully crafted agent docs" deliverable** — the founder's explicit requirement; generate `TOOL_CATALOGUE` from `allManifests()` so docs never drift. No lane commits to shipping it.

## 4) FIVE HIGHEST-LEVERAGE THINGS FIRST

1. **`src/engine/capabilities.ts` as the ONE canonical union (G4) + `getCapabilities()` on `Executor`.** Every other decision branches on it; divergent field sets across four lanes is the #1 integration risk. Land it stubbed before any consumer.
2. **Fix `ai.rs` + one real Pi E2E in CI.** Until tool calls actually reach the graph, every AI claim is fiction. This is the single unfalsified assumption gating the whole product.
3. **Resolve the approval model once (G1)** in `agentSessionStore`: optimistic-per-call apply + real-id round-trip + single Approve at `agent_end`. Delete contradictory `extension_ui_request:confirm` language elsewhere.
4. **Guard AI mutations against the CRDT bridge (G2)** before any `batch_apply` ships — a rejected AI workflow must not desync peers. This is invisible in every current decision and will corrupt live sessions.
5. **`commandRegistry.register()` normalization (G5)** so legacy commands + AI-authored nodes become real `Action`s — the structural precondition for the unification milestone and "adding to one adds to both."

Files grounding this review: `src/audio/executor/Executor.ts` (no `getCapabilities`), `src/collab/graphStoreBridge.ts` (version-diff broadcasts every verb), `src/engine/serialization.ts:80-95` (major-version gate + `isPluginId` drop), `src/engine/registry.ts:825` (`MISSING_DEFINITION`), `src/engine/types.ts:135,191,231` (closed `NodeType`/`KNOWN_PLUGIN_IDS`/`isPluginId`), `src/components/CommandBar/AiPanel.tsx:42` (`backend.available()` gate).
