//! Host-side Faust DSP compilation for OpenJammer.
//!
//! OpenJammer treats "everything as a plugin" ([`ojcore::PluginLoader`] /
//! [`ojcore::DspInstance`]). A *Faust* node is one such plugin whose DSP is
//! authored as [Faust] source — either by a human or, in U20, by the AI
//! DSP-node authoring flow. This crate is the off-RT-thread tooling that turns
//! that source text into something loadable, plus the **agentic compile-repair
//! loop** the AI flow drives: compile -> on error, feed the diagnostic back to
//! the author -> re-compile, until it builds or a retry budget is spent.
//!
//! [Faust]: https://faust.grame.fr/
//!
//! # Backends (default = CLI Path B)
//!
//! The DEFAULT build needs no native library. It shells the `faust` BINARY
//! ([`backend`] Path B) to compile source to `.wasm` and read the `-json`
//! metadata — pure `std::process` + a `serde_json` parse, no `build.rs`, no
//! `libfaust` link. When `faust` is NOT on `PATH`, [`FaustCompiler::compile`]
//! returns [`FaustError::Unavailable`] (terminal: the repair loop bails). The
//! off-by-default `libfaust` feature swaps in the in-process JIT backend.
//!
//! ```
//! use ojfaust::{FaustCompiler, FaustError};
//!
//! let c = FaustCompiler::new();
//! // With no `faust` binary on PATH, compilation is Unavailable; with one
//! // present the CLI Path B compiles. Either way the API shape + the agentic
//! // loop are identical — only the backend behind `compile` differs.
//! match c.compile("process = _;") {
//!     Ok(compiled) => assert_eq!(compiled.n_in, compiled.n_out), // `_` is 1->1
//!     Err(FaustError::Unavailable) => {}                         // no faust binary
//!     Err(other) => panic!("unexpected: {other}"),
//! }
//! ```
//!
//! The control-flow surface — [`FaustCompiler`], [`CompiledFaust`],
//! [`FaustError`], and [`compile_repair`] — is identical whichever backend is
//! active. See `README.md` for install details and how U20 wires this in.
#![forbid(unsafe_op_in_unsafe_fn)]

use std::error::Error;
use std::fmt;

mod backend;

/// Why a Faust compile attempt failed.
///
/// The agentic repair loop ([`compile_repair`]) distinguishes the *recoverable*
/// [`FaustError::Compile`] (the author can be asked to fix the source) from the
/// *terminal* [`FaustError::Unavailable`] (no backend — retrying is pointless).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FaustError {
    /// No Faust backend is compiled in (the `libfaust` feature is off) or the
    /// runtime toolchain it needs is missing. This is **terminal**: re-feeding
    /// source cannot help, so the repair loop bails out immediately.
    Unavailable,
    /// The Faust source did not compile. `message` carries the diagnostic
    /// verbatim from the backend; the repair loop hands this back to the author
    /// (human or AI) as the feedback used to produce a fixed revision.
    Compile {
        /// The raw compiler diagnostic, surfaced to the author for repair.
        message: String,
    },
    /// The repair loop exhausted its retry budget without a clean compile.
    /// `attempts` is how many compiles were tried; `last` is the final
    /// (recoverable) diagnostic that was still outstanding.
    RepairExhausted {
        /// Number of compile attempts made before giving up.
        attempts: u32,
        /// The last diagnostic seen, for surfacing to the user / logs.
        last: String,
    },
}

impl fmt::Display for FaustError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FaustError::Unavailable => f.write_str(
                "Faust backend unavailable: build ojfaust with `--features libfaust` \
                 (and install libfaust — see crate README)",
            ),
            FaustError::Compile { message } => {
                write!(f, "Faust compile error: {message}")
            }
            FaustError::RepairExhausted { attempts, last } => write!(
                f,
                "Faust repair loop exhausted after {attempts} attempt(s); last error: {last}"
            ),
        }
    }
}

impl Error for FaustError {}

/// One numeric parameter Faust reports in the `-json` UI tree.
///
/// Mirrors a single horizontal/vertical slider, numentry, or button: an `id`
/// (the index the host addresses it by at runtime), a display `name`, and the
/// `[min,max]` range plus `default`. M6 maps these straight onto the v1
/// `ParamDecl` so an AI-authored node's REAL params render in `AutoParamPanel`.
#[derive(Debug, Clone, PartialEq)]
pub struct FaustParam {
    /// Stable parameter index the host addresses (assigned in UI declaration
    /// order — the same order `oj_param(idx, val)` uses; see the ABI doc).
    pub id: u16,
    /// Human-readable label (the Faust UI element's name).
    pub name: String,
    /// Minimum value the parameter accepts.
    pub min: f32,
    /// Maximum value the parameter accepts.
    pub max: f32,
    /// The parameter's initial value.
    pub default: f32,
}

/// The product of a successful Faust compile.
///
/// In the default *stub* (no faust binary, `libfaust` off) this value is never
/// constructed (compilation errors with [`FaustError::Unavailable`]). The
/// default **Path B** CLI backend DOES construct it when `faust` is on `PATH`,
/// carrying everything the host needs to register + (later) run the node:
///
/// * a stable `name` (Faust's `declare name` or a caller default), used as the
///   manifest id segment;
/// * `n_in` / `n_out` port counts so the graph compiler can wire it;
/// * the parsed `params` (id/name/min/max/default) for the manifest +
///   `AutoParamPanel`;
/// * the compiled `wasm` bytes, when the backend produced them (`faust -lang
///   wasm`). This is `None` for backends that don't emit wasm (e.g. a future
///   libfaust JIT path) but always `Some` for the CLI Path B.
#[derive(Debug, Clone, PartialEq)]
pub struct CompiledFaust {
    /// Faust DSP name (from `declare name` or a caller-supplied default).
    pub name: String,
    /// Number of audio inputs Faust reports for `process`.
    pub n_in: u8,
    /// Number of audio outputs Faust reports for `process`.
    pub n_out: u8,
    /// The exact source that produced this artifact (kept for caching /
    /// reproducibility and so the AI flow can persist the *working* revision).
    pub source: String,
    /// The parsed numeric parameters (from the `faust -json` UI tree).
    pub params: Vec<FaustParam>,
    /// The compiled `.wasm` module bytes, when the backend emits wasm (the CLI
    /// Path B always does). `None` for non-wasm backends.
    pub wasm: Option<Vec<u8>>,
}

/// Compiles Faust source into a loadable [`CompiledFaust`].
///
/// This is the single dispatch point: [`compile`](FaustCompiler::compile)
/// forwards to whichever backend is compiled in. In the default scaffold that
/// is the stub, which returns [`FaustError::Unavailable`].
///
/// It is cheap to construct and holds the (future) backend configuration, so
/// callers can build one once and reuse it across many compiles — including the
/// repeated compiles inside [`compile_repair`].
#[derive(Debug, Default, Clone)]
pub struct FaustCompiler {
    /// Reserved for backend options (target/optimization/arch). Unused by the
    /// stub; carried so enabling the feature does not change the public shape.
    cfg: CompilerConfig,
}

/// Backend configuration knobs (currently inert in the scaffold).
#[derive(Debug, Clone, Default)]
pub struct CompilerConfig {
    /// Faust `-vec`/optimization-style hints, passed through to the backend.
    /// Left empty by default.
    pub extra_args: Vec<String>,
}

impl FaustCompiler {
    /// Creates a compiler with default configuration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a compiler with explicit backend [`CompilerConfig`].
    pub fn with_config(cfg: CompilerConfig) -> Self {
        Self { cfg }
    }

    /// Compiles a single Faust DSP source string.
    ///
    /// Backend selection (default build, `libfaust` OFF):
    /// * if the `faust` binary is on `PATH`, the **CLI Path B** compiles to
    ///   `.wasm` + parses the `-json` metadata (name/ports/params);
    /// * otherwise [`FaustError::Unavailable`] — no toolchain, so retrying is
    ///   futile and the repair loop bails immediately.
    ///
    /// With `libfaust` ON, dispatches to the native backend (see [`backend`]).
    ///
    /// This performs exactly one compile attempt; the iterative
    /// author-in-the-loop behaviour lives in [`compile_repair`].
    pub fn compile(&self, dsp_source: &str) -> Result<CompiledFaust, FaustError> {
        backend::compile(&self.cfg, dsp_source)
    }
}

/// Budget + policy for the agentic [`compile_repair`] loop.
#[derive(Debug, Clone, Copy)]
pub struct RepairBudget {
    /// Maximum number of compile attempts (including the first). Must be >= 1.
    pub max_attempts: u32,
}

impl Default for RepairBudget {
    fn default() -> Self {
        // The first compile + a few author-driven repairs is a sane default for
        // an LLM authoring loop without burning unbounded tokens.
        Self { max_attempts: 4 }
    }
}

/// What an author (human editor or, in U20, the LLM) decides to do with a
/// recoverable Faust diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Repair {
    /// A revised Faust source to try next.
    Revised(String),
    /// The author gives up (e.g. the LLM decides the request is infeasible).
    /// The loop then returns [`FaustError::RepairExhausted`] with the last
    /// diagnostic.
    GiveUp,
}

/// The agentic compile -> error-feedback -> repair loop.
///
/// This is the SHAPE U20's AI DSP-node authoring drives:
///
/// 1. compile the current source;
/// 2. on success, return the [`CompiledFaust`];
/// 3. on a *recoverable* [`FaustError::Compile`], hand the diagnostic to
///    `author` and retry with whatever it returns;
/// 4. on the *terminal* [`FaustError::Unavailable`], stop immediately
///    (retrying cannot help — there is no backend);
/// 5. when the [`RepairBudget`] is spent, return [`FaustError::RepairExhausted`].
///
/// `author` is the error-feedback closure. It receives the failing source and
/// the diagnostic and returns the next [`Repair`]. In production U20 passes a
/// closure that calls the LLM ("here is your Faust, here is the compiler error,
/// fix it"); tests / the CLI pass a trivial closure. Keeping the LLM behind a
/// closure keeps this crate free of any model dependency.
///
/// In the default scaffold the very first `compile` returns
/// [`FaustError::Unavailable`], so `author` is never invoked — but the loop's
/// control flow is fully present and unit-tested via an injectable compile
/// function (see [`compile_repair_with`]).
pub fn compile_repair(
    compiler: &FaustCompiler,
    initial_source: &str,
    budget: RepairBudget,
    author: impl FnMut(&str, &FaustError) -> Repair,
) -> Result<CompiledFaust, FaustError> {
    compile_repair_with(|src| compiler.compile(src), initial_source, budget, author)
}

/// Backend-agnostic core of [`compile_repair`], parameterized over the compile
/// step so the loop's control flow is testable without any Faust backend.
///
/// `compile_once` stands in for [`FaustCompiler::compile`]; tests inject a fake
/// that returns canned errors then a success, proving the retry/budget/terminal
/// logic independently of whether `libfaust` is linked.
pub fn compile_repair_with(
    mut compile_once: impl FnMut(&str) -> Result<CompiledFaust, FaustError>,
    initial_source: &str,
    budget: RepairBudget,
    mut author: impl FnMut(&str, &FaustError) -> Repair,
) -> Result<CompiledFaust, FaustError> {
    let max = budget.max_attempts.max(1);
    let mut source = initial_source.to_string();
    let mut attempts: u32 = 0;

    loop {
        attempts += 1;
        match compile_once(&source) {
            Ok(ok) => return Ok(ok),

            // Terminal: no backend / no toolchain. Re-feeding source is futile.
            Err(FaustError::Unavailable) => return Err(FaustError::Unavailable),

            // A nested RepairExhausted from a sub-compiler is also terminal.
            Err(e @ FaustError::RepairExhausted { .. }) => return Err(e),

            // Recoverable: ask the author to fix it, within budget.
            Err(FaustError::Compile { message }) => {
                if attempts >= max {
                    return Err(FaustError::RepairExhausted {
                        attempts,
                        last: message,
                    });
                }

                let err = FaustError::Compile { message };
                match author(&source, &err) {
                    Repair::Revised(next) => source = next,
                    Repair::GiveUp => {
                        // Recover the diagnostic to surface as `last`.
                        let FaustError::Compile { message } = err else {
                            unreachable!("err was constructed as Compile above")
                        };
                        return Err(FaustError::RepairExhausted {
                            attempts,
                            last: message,
                        });
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whether a real `faust` binary is callable in this environment. The
    /// CLI-path tests below SKIP gracefully when it is not, so CI without faust
    /// installed never hard-fails (the M6 brief's gating requirement).
    fn faust_on_path() -> bool {
        std::process::Command::new("faust")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[test]
    fn compile_is_unavailable_without_faust() {
        // Default CLI Path B: no `faust` binary -> terminal Unavailable. When
        // faust IS installed this case doesn't apply, so skip it.
        if faust_on_path() {
            return;
        }
        let c = FaustCompiler::new();
        assert_eq!(c.compile("process = _;"), Err(FaustError::Unavailable));
    }

    #[test]
    fn repair_bails_immediately_on_unavailable() {
        // With no faust binary the default backend is Unavailable -> author never
        // called. (Skip when faust is present: there the first compile succeeds.)
        if faust_on_path() {
            return;
        }
        let mut called = false;
        let res = compile_repair(
            &FaustCompiler::new(),
            "process = _;",
            RepairBudget::default(),
            |_src, _err| {
                called = true;
                Repair::GiveUp
            },
        );
        assert_eq!(res, Err(FaustError::Unavailable));
        assert!(
            !called,
            "author must not be consulted when backend is absent"
        );
    }

    #[test]
    fn real_faust_compiles_to_wasm_and_parses_params() {
        // GATED on a real faust binary: skip silently when absent so CI stays
        // green without the toolchain (M6 brief). When present, prove the CLI
        // Path B emits wasm bytes + parses the declared params from -json.
        if !faust_on_path() {
            return;
        }
        let src = "import(\"stdfaust.lib\");\n\
                   freq = hslider(\"freq\", 440, 20, 2000, 1);\n\
                   process = os.osc(freq);";
        let compiled = FaustCompiler::new()
            .compile(src)
            .expect("a valid faust program should compile with faust on PATH");
        assert_eq!(compiled.n_out, 1, "an oscillator has one output");
        let wasm = compiled.wasm.expect("CLI Path B must emit wasm bytes");
        // A real wasm module starts with the `\0asm` magic.
        assert!(wasm.starts_with(b"\0asm"), "not a wasm module");
        assert!(
            compiled.params.iter().any(|p| p.name == "freq"),
            "the declared `freq` slider should be parsed as a param"
        );
    }

    #[test]
    fn real_faust_rejects_broken_source_recoverably() {
        // GATED: a syntactically broken program yields a RECOVERABLE Compile
        // error (the diagnostic the repair loop feeds back), never Unavailable.
        if !faust_on_path() {
            return;
        }
        let err = FaustCompiler::new()
            .compile("process = this is not faust;")
            .unwrap_err();
        assert!(
            matches!(err, FaustError::Compile { .. }),
            "broken source must be a recoverable Compile error, got {err:?}"
        );
    }

    #[test]
    fn repair_loop_recovers_after_feedback() {
        // Inject a fake compiler: fail once, succeed once the author "fixes" it.
        let res = compile_repair_with(
            |src| {
                if src.contains("FIXED") {
                    Ok(CompiledFaust {
                        name: "ok".into(),
                        n_in: 1,
                        n_out: 1,
                        source: src.to_string(),
                        params: Vec::new(),
                        wasm: None,
                    })
                } else {
                    Err(FaustError::Compile {
                        message: "undefined symbol".into(),
                    })
                }
            },
            "broken",
            RepairBudget { max_attempts: 4 },
            |src, err| {
                assert!(matches!(err, FaustError::Compile { .. }));
                Repair::Revised(format!("{src} FIXED"))
            },
        );
        assert!(matches!(res, Ok(c) if c.name == "ok"));
    }

    #[test]
    fn repair_loop_respects_budget() {
        let mut attempts_seen = 0u32;
        let res = compile_repair_with(
            |_src| {
                Err(FaustError::Compile {
                    message: "still broken".into(),
                })
            },
            "broken",
            RepairBudget { max_attempts: 3 },
            |src, _err| {
                attempts_seen += 1;
                Repair::Revised(src.to_string())
            },
        );
        match res {
            Err(FaustError::RepairExhausted { attempts, last }) => {
                assert_eq!(attempts, 3);
                assert_eq!(last, "still broken");
            }
            other => panic!("expected RepairExhausted, got {other:?}"),
        }
        // author consulted on attempts 1 and 2 (not after the budget-final 3rd).
        assert_eq!(attempts_seen, 2);
    }

    #[test]
    fn repair_loop_honors_give_up() {
        let res = compile_repair_with(
            |_src| {
                Err(FaustError::Compile {
                    message: "nope".into(),
                })
            },
            "broken",
            RepairBudget { max_attempts: 10 },
            |_src, _err| Repair::GiveUp,
        );
        match res {
            Err(FaustError::RepairExhausted { attempts, last }) => {
                assert_eq!(attempts, 1);
                assert_eq!(last, "nope");
            }
            other => panic!("expected RepairExhausted, got {other:?}"),
        }
    }

    #[test]
    fn error_display_is_actionable() {
        let s = FaustError::Unavailable.to_string();
        assert!(
            s.contains("libfaust"),
            "should point at the feature/install"
        );
    }
}
