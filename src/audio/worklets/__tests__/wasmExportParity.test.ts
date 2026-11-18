/**
 * UX-1A / D1 — the shipped wasm binary must export everything the worklet calls.
 *
 * ## Why this test exists
 *
 * `src/audio/wasm/pkg/` is a COMMITTED build artefact: the generated glue and the
 * `.wasm` binary are checked in so a fresh clone can build the app without the
 * Rust toolchain. That is a good trade, and it has one failure mode — the
 * artefact silently going stale against `crates/`.
 *
 * It did. The shipped binary was 17 `ojcore` commits behind, and the worklet
 * papered over the drift with soft probes:
 *
 * ```ts
 * const drain = Reflect.get(wasm, 'drain_transport');
 * if (typeof drain === 'function') { ... }          // always false
 * ```
 *
 * The result was not a loud failure but an invisible one: the browser tier had
 * NO transport return path at all, so `arrangementStore`'s 1500 ms timeout fired
 * on every single Play and told the player "the audio engine did not acknowledge
 * the transport command" — while the engine was rolling fine. The same pattern
 * silently swallowed every `load_tempo_map` / `load_timeline`, so a song's notes
 * never reached the browser engine either.
 *
 * The probes are gone. This test is what replaces them: instead of degrading
 * quietly at runtime, a stale artefact fails CI here, naming the missing export
 * and telling you to re-run the build script.
 *
 * It reads the artefact as DATA (never imports/instantiates it), so it is cheap
 * and runs in the default jsdom suite.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest's root is the repo root (see vitest.config.ts), so repo-relative paths
// resolve without depending on how `import.meta.url` is rewritten by the
// jsdom transform.
const repoPath = (p: string) => resolve(process.cwd(), p);

const GLUE = repoPath('src/audio/wasm/pkg/ojcore_wasm.js');
const BINARY = repoPath('src/audio/wasm/pkg/ojcore_wasm_bg.wasm');
const PROCESSOR = repoPath('src/audio/worklets/ojcore-processor.ts');
const EXPORTER = repoPath('src/components/Export/browserExport.ts');

const REBUILD = 'Re-run `bash src/audio/wasm/build-wasm.sh --release` and commit src/audio/wasm/pkg/.';

/** The `export function <name>(` list of the wasm-bindgen `--target web` glue. */
function glueExports(): Set<string> {
    const src = readFileSync(GLUE, 'utf8');
    const out = new Set<string>();
    for (const m of src.matchAll(/^export function ([A-Za-z_$][\w$]*)\s*\(/gm)) out.add(m[1]);
    return out;
}

/**
 * The names in the `.wasm` module's export section (section id 7).
 *
 * A hand-rolled 40-line reader rather than a dependency: the binary preamble is
 * `magic(4) version(4)` then a flat list of `id:u8 size:varu32 payload`, and each
 * export is `nameLen:varu32 name kind:u8 index:varu32`.
 */
function binaryExports(): Set<string> {
    const buf = readFileSync(BINARY);
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    let at = 8;
    const varu32 = (): number => {
        let result = 0;
        let shift = 0;
        for (;;) {
            const byte = buf[at++];
            result |= (byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) return result >>> 0;
            shift += 7;
        }
    };
    const names = new Set<string>();
    while (at < buf.length) {
        const id = buf[at++];
        const size = varu32();
        const end = at + size;
        if (id === 7) {
            const count = varu32();
            for (let i = 0; i < count; i++) {
                const len = varu32();
                names.add(buf.toString('utf8', at, at + len));
                at += len;
                at++; // kind
                varu32(); // index
            }
        }
        at = end;
    }
    return names;
}

/** Every `wasm.<name>(` the given TypeScript source calls on the glue namespace. */
function callsInto(file: string): Set<string> {
    const src = readFileSync(file, 'utf8');
    const out = new Set<string>();
    for (const m of src.matchAll(/\bwasm\.([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[1]);
    return out;
}

describe('the committed wasm artefact matches what the worklet calls', () => {
    const exported = glueExports();

    it('the generated glue exports every function the AudioWorklet processor calls', () => {
        const used = [...callsInto(PROCESSOR)].sort();
        expect(used.length).toBeGreaterThan(5); // the scrape actually found call sites
        const missing = used.filter((name) => !exported.has(name));
        expect(missing, `ojcore-processor.ts calls exports the shipped glue does not have. ${REBUILD}`)
            .toEqual([]);
    });

    it('the generated glue exports every function the browser exporter calls', () => {
        const missing = [...callsInto(EXPORTER)].sort().filter((name) => !exported.has(name));
        expect(missing, `browserExport.ts calls exports the shipped glue does not have. ${REBUILD}`)
            .toEqual([]);
    });

    it('pins the return-path contract, so deleting a call site cannot hide a stale build', () => {
        // The four engine->UI return paths plus the two timeline loaders. Each of
        // these going missing is invisible at runtime and stage-breaking in effect,
        // which is exactly why they are named here and not merely inferred.
        const required = [
            'drain_transport', // transport ack: without it, Play never confirms
            'drain_meters',
            'drain_looper',
            'drain_looper_edges',
            'drain_events', // the fault pipe
            'has_pending_events',
            'load_tempo_map', // without it, the song has no tempo
            'load_timeline', // without it, the song has no notes
        ];
        const missing = required.filter((name) => !exported.has(name));
        expect(missing, `the wasm return-path contract is incomplete. ${REBUILD}`).toEqual([]);
    });

    it('the shipped .wasm binary really exports what the glue forwards to', () => {
        // The glue and the binary are emitted together, but they are two files and
        // can be committed apart. This is the half that proves the BINARY is fresh.
        const binary = binaryExports();
        const missing = [...exported].sort().filter((name) => !binary.has(name));
        expect(
            missing,
            `ojcore_wasm.js forwards to symbols ojcore_wasm_bg.wasm does not export — ` +
                `the two halves of the artefact are out of sync. ${REBUILD}`,
        ).toEqual([]);
    });
});
