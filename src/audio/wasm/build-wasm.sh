#!/usr/bin/env bash
# Build the ojcore-wasm AudioWorklet host into a web-importable ES module (U17).
#
# Pipeline:
#   1. cargo +nightly build -p ojcore-wasm --target wasm32-unknown-unknown
#      -Z build-std=std,panic_abort        (the no_std core + alloc need build-std)
#   2. wasm-bindgen --target web           (emits ES-module JS glue + bindgen .wasm)
#
# Output lands HERE (src/audio/wasm/pkg/), so Vite bundles it like any other
# source module. The generated files are committed so a fresh checkout can build
# the app without the Rust toolchain; re-run this script after touching the crate.
#
# Prereqs (install once):
#   rustup toolchain install nightly
#   rustup +nightly target add wasm32-unknown-unknown
#   rustup +nightly component add rust-src
#   cargo install wasm-bindgen-cli --version 0.2.125   # MUST match crate pin
#
# Usage:  bash src/audio/wasm/build-wasm.sh [--release]
set -euo pipefail

PROFILE="debug"
CARGO_FLAGS=()
for arg in "$@"; do
  if [[ "$arg" == "--release" ]]; then
    PROFILE="release"
    CARGO_FLAGS+=("--release")
  else
    CARGO_FLAGS+=("$arg")
  fi
done

# Resolve workspace root from this script (src/audio/wasm -> repo root).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="$ROOT/src/audio/wasm/pkg"

echo "[build-wasm] cargo build ($PROFILE) for wasm32-unknown-unknown ..."
cargo +nightly build \
  --manifest-path "$ROOT/Cargo.toml" \
  -p ojcore-wasm \
  --target wasm32-unknown-unknown \
  -Z build-std=std,panic_abort \
  "${CARGO_FLAGS[@]}"

WASM_IN="$ROOT/target/wasm32-unknown-unknown/$PROFILE/ojcore_wasm.wasm"

echo "[build-wasm] wasm-bindgen --target web -> $OUT ..."
mkdir -p "$OUT"
wasm-bindgen "$WASM_IN" \
  --target web \
  --out-dir "$OUT" \
  --out-name ojcore_wasm \
  --no-typescript

echo "[build-wasm] done: $OUT/ojcore_wasm.js + ojcore_wasm_bg.wasm"
