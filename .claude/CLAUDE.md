# OpenJammer — for Claude Code

You are working on an **instrument**, not an app. People play OpenJammer live, in front
of an audience, with no second take. Two beliefs decide what good work looks like here,
and they are not negotiable:

- **Perception is the medium.** Latency is felt in the fingers and a glitch breaks the
  spell. The audio path blocks for nothing; editing never drops a sample; `<5ms` native
  is the threshold below which the software disappears and only the music is left.
- **A minimal core, made infinite by everyone.** `ojcore` stays tiny and perfect;
  everything else is a plugin the community owns. When in doubt, it is a plugin. Every
  line you add to the core must earn its place.

Work *inside* this philosophy, not next to it. The bar is high because the medium is
unforgiving — that is exactly what makes it worth doing.

For any UI work, two docs are load-bearing: [PRODUCT.md](../PRODUCT.md) (who plays this
and why — register, users, anti-references, the design principles, the
*instrument-not-a-dashboard* line) and [DESIGN.md](../DESIGN.md) (the visual system —
"The Living Sketchbook": hand-drawn Caveat, warm dot-grid paper, hard blur-free shadows,
audio-blue/control-grey ports). They are the brief the impeccable design skill works from;
honor them or change them deliberately.

The full working covenant — the two beliefs, the nine code values, and the practical
playbook (bun-only, the real-time-safety rules, the plugin boundary, port colors, the
testing bar) — follows:

@../.agent/workflows/agents.md
