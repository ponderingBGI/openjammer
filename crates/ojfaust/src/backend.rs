//! Backend dispatch for [`crate::FaustCompiler::compile`].
//!
//! Backend selection:
//!
//! * feature OFF (default): the [`cli`] **Path B** backend — shells the `faust`
//!   binary to compile `.wasm` + read the `-json` metadata. When `faust` is not
//!   on `PATH` it returns [`FaustError::Unavailable`] so the crate still builds
//!   + behaves with no toolchain at all.
//! * feature ON: the [`native`] backend — the in-process libfaust JIT (Path A),
//!   not yet implemented. It returns [`FaustError::Unavailable`] until wired;
//!   see `README.md` for the install prerequisites.
//!
//! # FOUNDER-GATED BOUNDARY (D4)
//!
//! Path B produces the `.wasm` + manifest metadata NOW. It does NOT execute the
//! wasm — running it on the audio thread is the founder-gated wasmtime RT host /
//! AudioWorklet step (see `docs/code-node-abi.md`). This crate only *authors +
//! validates*; nothing here touches the realtime path.

use crate::{CompiledFaust, CompilerConfig, FaustError};

#[cfg(not(feature = "libfaust"))]
pub(crate) fn compile(cfg: &CompilerConfig, dsp_source: &str) -> Result<CompiledFaust, FaustError> {
    cli::compile(cfg, dsp_source)
}

#[cfg(feature = "libfaust")]
pub(crate) fn compile(cfg: &CompilerConfig, dsp_source: &str) -> Result<CompiledFaust, FaustError> {
    native::compile(cfg, dsp_source)
}

// ---------------------------------------------------------------------------
// CLI Path B (default): shell `faust`, compile to wasm, parse `-json` metadata.
// ---------------------------------------------------------------------------
#[cfg(not(feature = "libfaust"))]
mod cli {
    use super::*;
    use crate::FaustParam;
    use std::path::PathBuf;
    use std::process::Command;

    /// Honour an explicit `OJFAUST_FAUST_BIN` override before falling back to the
    /// bare `faust` name on `PATH`. Returns `None` only when neither is callable,
    /// which the caller maps to [`FaustError::Unavailable`].
    fn find_faust() -> Option<PathBuf> {
        if let Ok(explicit) = std::env::var("OJFAUST_FAUST_BIN") {
            let p = PathBuf::from(&explicit);
            if p.exists() {
                return Some(p);
            }
        }
        // A cheap `--version` probe; if it runs, `faust` is callable.
        let ok = Command::new("faust")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        ok.then(|| PathBuf::from("faust"))
    }

    /// Path B: `faust -lang wasm` -> `.wasm` bytes, `faust -json` -> metadata.
    ///
    /// Error model (per the M6 brief):
    /// * `faust` missing -> [`FaustError::Unavailable`] (terminal).
    /// * `faust` rejected the source -> [`FaustError::Compile`] carrying stderr
    ///   (RECOVERABLE — fed back to the author in the repair loop).
    pub(super) fn compile(
        cfg: &CompilerConfig,
        dsp_source: &str,
    ) -> Result<CompiledFaust, FaustError> {
        let Some(faust) = find_faust() else {
            return Err(FaustError::Unavailable);
        };

        // A throwaway working directory holds the source + the two artifacts.
        let dir = TempDir::create().map_err(|e| FaustError::Compile {
            message: format!("could not create faust work dir: {e}"),
        })?;
        let src_path = dir.path().join("oj_node.dsp");
        let wasm_path = dir.path().join("oj_node.wasm");
        std::fs::write(&src_path, dsp_source).map_err(|e| FaustError::Compile {
            message: format!("could not write faust source: {e}"),
        })?;

        // 1) Compile to wasm. `faust -lang wasm -o out.wasm in.dsp`.
        let mut wasm_cmd = Command::new(&faust);
        wasm_cmd
            .arg("-lang")
            .arg("wasm")
            .args(&cfg.extra_args)
            .arg("-o")
            .arg(&wasm_path)
            .arg(&src_path);
        let wasm_out = wasm_cmd.output().map_err(|e| FaustError::Compile {
            message: format!("faust failed to run: {e}"),
        })?;
        if !wasm_out.status.success() {
            return Err(FaustError::Compile {
                message: stderr_message(&wasm_out.stderr),
            });
        }
        let wasm = std::fs::read(&wasm_path).map_err(|e| FaustError::Compile {
            message: format!("faust reported success but no wasm was produced: {e}"),
        })?;

        // 2) Emit the JSON metadata. `faust -json` writes `<src>.json` alongside
        //    the source. (We pass `-o` to keep all output inside the temp dir.)
        let json_path = dir.path().join("oj_node.dsp.json");
        let mut json_cmd = Command::new(&faust);
        json_cmd
            .arg("-json")
            .arg("-lang")
            .arg("wasm")
            .arg("-o")
            .arg(dir.path().join("oj_node_meta.wasm"))
            .arg(&src_path);
        let json_out = json_cmd.output().map_err(|e| FaustError::Compile {
            message: format!("faust -json failed to run: {e}"),
        })?;
        if !json_out.status.success() {
            return Err(FaustError::Compile {
                message: stderr_message(&json_out.stderr),
            });
        }
        let json_text = std::fs::read_to_string(&json_path).map_err(|e| FaustError::Compile {
            message: format!("faust -json produced no metadata file: {e}"),
        })?;

        let meta = parse_faust_json(&json_text)?;
        Ok(CompiledFaust {
            name: meta.name,
            n_in: meta.n_in,
            n_out: meta.n_out,
            source: dsp_source.to_string(),
            params: meta.params,
            wasm: Some(wasm),
        })
    }

    /// stderr -> a non-empty diagnostic string (fallback if faust said nothing).
    fn stderr_message(stderr: &[u8]) -> String {
        let s = String::from_utf8_lossy(stderr).trim().to_string();
        if s.is_empty() {
            "faust rejected the source (no diagnostic)".to_string()
        } else {
            s
        }
    }

    /// The fields we lift out of the `faust -json` tree.
    #[derive(Debug)]
    pub(super) struct FaustMeta {
        pub name: String,
        pub n_in: u8,
        pub n_out: u8,
        pub params: Vec<FaustParam>,
    }

    /// Parse the `faust -json` document into [`FaustMeta`].
    ///
    /// The JSON shape is `{ "name", "inputs", "outputs", "ui": [ { "items": [...]
    /// } ] }`. We walk the `ui` tree collecting every leaf that carries an
    /// addressable value (`hslider`/`vslider`/`nentry`/`button`/`checkbox`),
    /// assigning each a sequential `id` in declaration order — the SAME order the
    /// `.wasm` `oj_param(idx, val)` ABI uses (see the ABI doc).
    ///
    /// Pure + total: split out from the process plumbing so it is unit-testable
    /// against a sample JSON document with no `faust` binary present.
    pub(super) fn parse_faust_json(json_text: &str) -> Result<FaustMeta, FaustError> {
        let v: serde_json::Value = match serde_json::from_str(json_text) {
            Ok(v) => v,
            Err(first_err) => {
                let sanitized = escape_invalid_json_backslashes(json_text);
                serde_json::from_str(&sanitized).map_err(|second_err| FaustError::Compile {
                    message: format!(
                        "could not parse faust -json metadata: {first_err}; after escaping invalid backslashes: {second_err}"
                    ),
                })?
            }
        };

        let name = v
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("ojfaust")
            .to_string();
        let n_in = v.get("inputs").and_then(json_u8).unwrap_or(0);
        let n_out = v.get("outputs").and_then(json_u8).unwrap_or(0);

        let mut params = Vec::new();
        let mut next_id: u16 = 0;
        if let Some(ui) = v.get("ui").and_then(|u| u.as_array()) {
            for group in ui {
                collect_params(group, &mut params, &mut next_id);
            }
        }

        Ok(FaustMeta {
            name,
            n_in,
            n_out,
            params,
        })
    }

    /// Faust on Windows can emit JSON with unescaped backslashes in diagnostic
    /// path fields such as `"C:\Program Files\Faust"`. Those fields are not
    /// semantically needed here, but they make strict JSON parsing fail before
    /// we can read the name/port/UI metadata. Preserve valid JSON escapes and
    /// escape only invalid backslashes inside strings.
    fn escape_invalid_json_backslashes(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars();
        let mut in_string = false;

        while let Some(ch) = chars.next() {
            match ch {
                '"' => {
                    in_string = !in_string;
                    out.push(ch);
                }
                '\\' if in_string => match chars.next() {
                    Some(next)
                        if matches!(next, '"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't' | 'u') =>
                    {
                        out.push('\\');
                        out.push(next);
                    }
                    Some(next) => {
                        out.push('\\');
                        out.push('\\');
                        out.push(next);
                    }
                    None => out.push('\\'),
                },
                _ => out.push(ch),
            }
        }

        out
    }

    /// Coerce a JSON number-or-string (faust emits port counts as either) to u8.
    fn json_u8(v: &serde_json::Value) -> Option<u8> {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
            .map(|n| n.min(255) as u8)
    }

    /// Coerce a JSON number-or-string to f32 (faust ranges are emitted as
    /// strings in some versions, numbers in others).
    fn json_f32(v: Option<&serde_json::Value>) -> Option<f32> {
        let v = v?;
        v.as_f64()
            .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
            .map(|n| n as f32)
    }

    /// The Faust UI leaf types that expose an addressable numeric parameter.
    fn is_param_type(ty: &str) -> bool {
        matches!(ty, "hslider" | "vslider" | "nentry" | "button" | "checkbox")
    }

    /// Recursively walk a UI node, pushing one [`FaustParam`] per addressable
    /// leaf (in declaration order) and recursing into group `items`.
    fn collect_params(node: &serde_json::Value, out: &mut Vec<FaustParam>, next_id: &mut u16) {
        let ty = node.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if is_param_type(ty) {
            // button/checkbox are 0..1 toggles with no explicit min/max.
            let (min, max, default) = if ty == "button" || ty == "checkbox" {
                (0.0, 1.0, 0.0)
            } else {
                (
                    json_f32(node.get("min")).unwrap_or(0.0),
                    json_f32(node.get("max")).unwrap_or(1.0),
                    json_f32(node.get("init")).unwrap_or(0.0),
                )
            };
            let label = node
                .get("label")
                .and_then(|l| l.as_str())
                .unwrap_or("param")
                .to_string();
            out.push(FaustParam {
                id: *next_id,
                name: label,
                min,
                max,
                default,
            });
            *next_id = next_id.saturating_add(1);
        }
        if let Some(items) = node.get("items").and_then(|i| i.as_array()) {
            for child in items {
                collect_params(child, out, next_id);
            }
        }
    }

    /// A throwaway temp directory, removed on drop. Keeps each compile's source +
    /// artifacts isolated (and concurrent compiles from colliding).
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn create() -> std::io::Result<Self> {
            use std::time::{SystemTime, UNIX_EPOCH};
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path =
                std::env::temp_dir().join(format!("ojfaust-{}-{}", std::process::id(), nanos));
            std::fs::create_dir_all(&path)?;
            Ok(Self { path })
        }

        fn path(&self) -> &std::path::Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    // -----------------------------------------------------------------------
    // Tests for the PURE JSON parser (no `faust` binary needed).
    // -----------------------------------------------------------------------
    #[cfg(test)]
    mod tests {
        use super::*;

        const SAMPLE: &str = r#"{
            "name": "tremolo",
            "inputs": 1,
            "outputs": 1,
            "ui": [
                {
                    "type": "vgroup",
                    "label": "tremolo",
                    "items": [
                        { "type": "hslider", "label": "rate",  "init": "4",   "min": "0.1", "max": "20" },
                        { "type": "hslider", "label": "depth", "init": "0.5", "min": "0",   "max": "1" }
                    ]
                }
            ]
        }"#;

        #[test]
        fn parses_name_and_port_counts() {
            let meta = parse_faust_json(SAMPLE).expect("valid json");
            assert_eq!(meta.name, "tremolo");
            assert_eq!(meta.n_in, 1);
            assert_eq!(meta.n_out, 1);
        }

        #[test]
        fn parses_params_in_declaration_order_with_sequential_ids() {
            let meta = parse_faust_json(SAMPLE).expect("valid json");
            assert_eq!(meta.params.len(), 2);
            assert_eq!(meta.params[0].id, 0);
            assert_eq!(meta.params[0].name, "rate");
            assert_eq!(meta.params[0].default, 4.0);
            assert_eq!(meta.params[0].min, 0.1);
            assert_eq!(meta.params[0].max, 20.0);
            assert_eq!(meta.params[1].id, 1);
            assert_eq!(meta.params[1].name, "depth");
        }

        #[test]
        fn handles_numeric_or_string_port_counts() {
            let json = r#"{ "name": "x", "inputs": "2", "outputs": 3, "ui": [] }"#;
            let meta = parse_faust_json(json).expect("valid json");
            assert_eq!(meta.n_in, 2);
            assert_eq!(meta.n_out, 3);
        }

        #[test]
        fn tolerates_faust_windows_paths_with_unescaped_backslashes() {
            let json = "{\n  \"name\": \"x\",\n  \"inputs\": 0,\n  \"outputs\": 1,\n  \"library_list\": [\"C:\\Program Files\\Faust\\share\\faust/stdfaust.lib\"],\n  \"ui\": []\n}";
            let meta = parse_faust_json(json).expect("faust Windows metadata should parse");
            assert_eq!(meta.name, "x");
            assert_eq!(meta.n_out, 1);
        }

        #[test]
        fn button_and_checkbox_become_0_1_toggles() {
            let json = r#"{
                "name": "g", "inputs": 0, "outputs": 1,
                "ui": [ { "type": "hgroup", "items": [
                    { "type": "button", "label": "gate" },
                    { "type": "checkbox", "label": "bypass" }
                ] } ]
            }"#;
            let meta = parse_faust_json(json).expect("valid json");
            assert_eq!(meta.params.len(), 2);
            assert_eq!((meta.params[0].min, meta.params[0].max), (0.0, 1.0));
            assert_eq!(meta.params[1].name, "bypass");
        }

        #[test]
        fn malformed_json_is_a_recoverable_compile_error() {
            let err = parse_faust_json("{ not json").unwrap_err();
            assert!(matches!(err, FaustError::Compile { .. }));
        }
    }
}

// ---------------------------------------------------------------------------
// Native backend (feature = "libfaust").  SCAFFOLD ONLY — cannot be verified
// in this environment because libfaust is not installed.
// ---------------------------------------------------------------------------
#[cfg(feature = "libfaust")]
mod native {
    use super::*;

    /// Real in-process Faust compilation (Path A — libfaust C API JIT).
    /// **TODO**: implement the bindgen binding; see `README.md`. Until then this
    /// reports a terminal unavailable backend so `--features libfaust` builds and
    /// tests stay deterministic without masquerading as a working JIT.
    pub(super) fn compile(
        cfg: &CompilerConfig,
        dsp_source: &str,
    ) -> Result<CompiledFaust, FaustError> {
        // PATH A — libfaust C API via bindgen (in-process JIT). Add `libc` (dep)
        // + `bindgen` (build-dep) + a `build.rs` linking `faust` and binding
        // `<faust/dsp/llvm-dsp-c.h>` (`createCDSPFactoryFromString`,
        // `createCDSPInstance`, `getNumInputs/OutputsCDSPInstance`,
        // `getCDSPFactoryError`). Lowest latency; stash the JIT factory on
        // `CompiledFaust` (wasm: None) and wrap as an `ojcore::DspInstance`.
        let _ = (cfg, dsp_source);
        Err(FaustError::Unavailable)
    }
}
