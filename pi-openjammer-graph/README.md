# pi-openjammer-graph (bundled Pi extension skeleton)

This folder is a **bundled Pi extension SKELETON** (deliverable of D5,
MILESTONE M7). It registers OpenJammer's graph verbs as Pi tools so a Pi agent
can build and edit the OpenJammer canvas natively — each tool's `execute`
**round-trips post-state** (returns the resulting graph summary so the model
reasons on the live graph it just changed).

## What ships here

- `index.ts` — `export default function(pi) { … }` registers the graph-verb tools
  (`add_node` / `remove_node` / `update_node_data` / `add_connection` /
  `remove_connection` / `get_graph` / `list_node_types` / `find_nodes` /
  `batch_apply` / `validate_plan` / `emit_plan` / `author_code_node`), mirroring
  `src/ai/tools.ts`'s `TOOL_CATALOGUE` and `docs/agent-tools.md`.

## Why it is OUT of the app build

This is a **Pi resource**, not OpenJammer app source. It is intentionally kept
outside `src/`, and excluded from the app's `tsc` / `vitest` / `eslint` gates
(see `eslint.config.js` `globalIgnores`, and the `tsconfig.app.json` /
`vitest.config.ts` `include: ['src/**']`). It is meant to be mounted into a Pi
worktree, not bundled into the webview.

## FOUNDER-GATED — what remains

The SKELETON compiles + documents the contract; the **live wiring is
founder-gated** and deliberately not attempted here, because it needs a real Pi
install and the OpenJammer host RPC bridge:

1. **Mount into the Pi worktree.** Install this package into the Pi extension
   directory of the throwaway worktree OpenJammer spawns (see
   `src-tauri/src/ai.rs`).
2. **Wire `forward(...)`.** Replace the stub in `index.ts` with the real host RPC
   bridge that hands each tool call to the app side (`applyToolCall` in
   `src/ai/tools.ts`) — which applies it through the SAME reversible store verb the
   UI uses, behind the user's Approve / Reject — and returns the post-state graph
   summary for the D5 round-trip.
3. **Persistent-intelligence install.** The persistent Pi subprocess (warm across
   Tabs, with a warm model cache) and the `pi-persistent-intelligence` package
   that seeds the local frecency floor (`caps.learning === 'pi-memory'`, via
   `paletteLearningStore.applySeedBoosts`) are the founder build's job. The seed
   SOURCE is a documented founder-gated stub today; the additive merge NEVER
   lowers a live local score.

See `docs/agent-tools.md` for the full tool surface + the reuse-first workflow,
and `docs/code-node-abi.md` for the code-node `.wasm` ABI.
