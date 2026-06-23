# Debugging a silent or wrong-sounding node

Your on-demand playbook for the SEE hand. Read it when a player says something is
silent, quiet, or wrong — don't recite it, follow it, then OFFER the fix.

## The order

1. **Locate.** `find_nodes` / `get_graph` — name the exact node the player means;
   confirm its type and current data. Never guess which node they mean.
2. **Reachability.** Is there a path from this node to a `speaker`? A node with no
   route to a speaker is the #1 cause of silence and needs zero engine data —
   `get_graph` shows every connection. Fix the missing cable first.
3. **Probe the signal.** `get_signal({nodeId})` reads the live output peak. ~0 with
   a correct path means the node itself is producing silence (a stuck or
   mis-parametered plugin), not a wiring fault. A single read can land between
   transients — if it's ~0 once, probe again.
4. **Read diagnostics.** `get_diagnostics({nodeId})` gives identity, ports, the
   params as last pushed, a `degraded` flag, and the logs that mention the node.
5. **Scan the logs.** `get_logs` for xruns, node faults, and asset/plugin errors
   near the moment it broke. Evidence over guesses.

## What the readings mean

- **degraded: true** — the plugin failed to load and the node fell back to a
  passthrough stub (a missing or incompatible plugin); the project stayed open.
  The fix is re-resolving the plugin, not rewiring. Say so plainly.
- **get_signal ~0, path OK, not degraded** — the node runs but outputs silence:
  check a muted or zeroed gain, an envelope that never opens, a param at a dead value.
- **get_signal ~0, no path to a speaker** — pure wiring: add the missing connection.
- **a NodeFault in get_logs** — the engine caught a fault on that node (NonFinite,
  OverBudget, Crashed) and may have auto-bypassed it. Name the fault.

## The rule

Diagnose and **offer** — never silently rewire a live set. Explain what you found in
a line or two, propose the one reversible edit, and let the player say go. Every edit
is one Ctrl+Z for them, so a fix is safe — but their attention mid-take is not yours
to take.
