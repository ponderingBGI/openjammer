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
# TypeScript declarations are deliberately EMITTED (no `--no-typescript`).
#
# The worklet and the browser exporter import this glue as normal modules, so
# `ojcore_wasm.d.ts` is what turns a call to a MISSING engine export into a real
# `tsc` error instead of a silent `any`. That guard did not exist while the
# imports carried `@ts-expect-error`, which is exactly how `drain_transport`
# stayed non-existent — and the browser transport stayed dead — unnoticed.
# Commit the .d.ts alongside the .js and the .wasm.
wasm-bindgen "$WASM_IN" \
  --target web \
  --out-dir "$OUT" \
  --out-name ojcore_wasm

# wasm-bindgen stamps `/* eslint-disable */` on every file it emits. On the .js
# that directive is USED (the generated glue trips real rules); on the .d.ts files
# it is not, and eslint reports an "Unused eslint-disable directive" warning for
# each committed declaration file. Strip it from the declarations only, so the
# committed artefact lands lint-clean without anyone having to special-case
# generated output in eslint.config.js.
for dts in "$OUT/ojcore_wasm.d.ts" "$OUT/ojcore_wasm_bg.wasm.d.ts"; do
  [ -f "$dts" ] || continue
  grep -v '^/\* eslint-disable \*/$' "$dts" > "$dts.tmp" && mv "$dts.tmp" "$dts"
done

echo "[build-wasm] done: $OUT/ojcore_wasm.js + ojcore_wasm.d.ts + ojcore_wasm_bg.wasm"
