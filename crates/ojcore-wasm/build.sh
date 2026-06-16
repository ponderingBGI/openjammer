#!/usr/bin/env bash
# Build the ojcore-wasm AudioWorklet host for wasm32.
#
# This is deliberately an explicit, standalone command rather than a shared
# cargo config: `-Z build-std` / a global `[build] target` would break the
# STABLE native builds of the rest of the workspace. See README.md.
#
# Prereqs: nightly toolchain, the wasm32-unknown-unknown target, and rust-src
# (for -Z build-std). Pass extra args through, e.g. `build.sh --release`.
set -euo pipefail

# Resolve the workspace root from this script's location so it runs from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cargo +nightly build \
  --manifest-path "$ROOT/Cargo.toml" \
  -p ojcore-wasm \
  --target wasm32-unknown-unknown \
  -Z build-std=std,panic_abort \
  "$@"

echo "built: target/wasm32-unknown-unknown/{debug,release}/ojcore_wasm.wasm"
