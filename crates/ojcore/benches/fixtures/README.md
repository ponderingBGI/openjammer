# Engine macro-benchmark fixtures

These deterministic arrangements are the exact browser fixtures consumed by
the Rust Ring 1 benchmarks. Regenerate them from the repository root with:

```sh
bun scripts/demo/export-fixture.ts first-light --out crates/ojcore/benches/fixtures/first-light.json
bun scripts/demo/export-fixture.ts hundred-tracks --out crates/ojcore/benches/fixtures/hundred-tracks.json
```

`hundred-tracks` uses its fixed default seed (`990807`): 100 tracks, 2,000
clips, and 40,000 MIDI notes. Do not hand-edit either JSON artifact.
