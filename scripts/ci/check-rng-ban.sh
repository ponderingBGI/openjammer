#!/usr/bin/env bash
# RNG-ban gate (Track A P0a) — the determinism analogue of the libm clippy ban.
#
# The deterministic-simulation harness (Track A) replays a whole fault run from a
# single seed. That only holds if NOTHING on the audio/DSP path pulls entropy from
# a global/thread RNG or the OS — every stochastic node MUST take a seeded,
# bit-stable generator instead. This gate forbids the global entropy sources in
# `ojcore` + `ojcore-dsp` BEFORE the first stochastic node lands, so a
# seed-irreproducible run can never sneak in. (Seeded PRNGs like the in-repo
# mulberry32 are fine and deliberately NOT matched.)
#
# FAIL (exit 1) if any banned pattern appears in the two RT/DSP crates' src.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"

# Global / OS entropy sources only. Seeded constructors (SmallRng::seed_from_u64,
# ChaCha8Rng::seed_from_u64, the mulberry32 helper) are intentionally allowed.
banned='thread_rng|rand::random|from_entropy|getrandom|SmallRng::from_os_rng|StdRng::from_os_rng'

targets=("$root/crates/ojcore/src" "$root/crates/ojcore-dsp/src")

hits=0
for dir in "${targets[@]}"; do
  [ -d "$dir" ] || continue
  if grep -rnE "$banned" "$dir" 2>/dev/null; then
    hits=1
  fi
done

if [ "$hits" != "0" ]; then
  echo "::error::Global/thread RNG is banned in ojcore / ojcore-dsp (breaks seed-reproducible DST)."
  echo "Use a seeded, bit-stable PRNG (e.g. seed_from_u64) threaded through the node instead."
  exit 1
fi

echo "RNG-ban gate: clean — no global/thread entropy in the RT/DSP core."
