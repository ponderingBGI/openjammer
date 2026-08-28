# OpenJammer documentation

Reference guides for understanding, running, and extending OpenJammer. Start with the
[project README](../README.md) for setup, then read the philosophy — it explains *why*
everything else is the way it is.

## Start here

- [agents.md](../agents.md): the working covenant and the
  one doc to read first — the two beliefs (perception is the medium; a minimal core made
  infinite by everyone), the nine code values, and the day-to-day playbook. Loaded every session.
- [PRODUCT.md](../PRODUCT.md): who plays OpenJammer and why — register, users,
  anti-references, the design principles, and the Live Performance Rule. The strategic brief.
- [DESIGN.md](../DESIGN.md): the visual system — "The Living Sketchbook" (hand-drawn
  Caveat, warm dot-grid paper, hard blur-free shadows, audio-blue/control-grey ports).

## Architecture & extension

- [ARCHITECTURE.md](ARCHITECTURE.md): the North star, the `ojcore` crate map, and the
  build/run/test/CI commands.
- [timeline.md](timeline.md): the on-canvas DAW — the `Song` node, the shared
  `Arrangement` a human and an agent co-author through reversible verbs, how it plays and
  persists, and the honest roadmap of what's still ahead.
- [agent-tools.md](agent-tools.md): the Ctrl+K AI agent's tool surface and the
  reuse-first, untrusted-generator workflow.
- [creating-nodes.md](creating-nodes.md) and
  [creating-resizable-nodes.md](creating-resizable-nodes.md): author a new node.
- [node-standards.md](node-standards.md): the conventions every node follows.
- [code-node-abi.md](code-node-abi.md): the `.wasm` ABI for code nodes.
- [plugins-hosting.md](plugins-hosting.md): supported third-party formats, the
  published reliability contract, quarantine/Bench behavior, and the verified OSS matrix.
- [TESTING.md](TESTING.md): the test lanes and how to run them.

## Decision records

The Ctrl+K / AI design history lives in
[CTRL-K-AND-AI-DECISIONS.md](CTRL-K-AND-AI-DECISIONS.md) and
[CTRL-K-AND-AI-PLAN.md](CTRL-K-AND-AI-PLAN.md). The latency and pipeline strategy notes
(`GPU_LATENCY_STRATEGY.md`, `PIPELINE_PRERENDERING_STRATEGY.md`,
`UNIFIED_PIPELINE_OPTIMIZATION_PLAN.md`) record how we chase the `<5ms` target.

---

Working guidance for contributors and the AI agent lives at
[agents.md](../agents.md) — the values made into a
daily practice. [.claude/CLAUDE.md](../.claude/CLAUDE.md) is the same covenant for
Claude Code.
