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
//! # This is a FEATURE-GATED SCAFFOLD
//!
//! Building Faust DSP at runtime requires `libfaust` (a sizeable native C++
//! library) which is **not** assumed to be present. So the real backend lives
//! behind the off-by-default [`libfaust`](#feature-libfaust) Cargo feature, and
//! the crate's *default* build is a clear, dependency-free stub:
//!
//! ```
//! use ojfaust::{FaustCompiler, FaustError};
//!
//! let c = FaustCompiler::new();
//! // Default build (feature `libfaust` OFF): compilation is unavailable, but
//! // the API shape and the agentic loop are fully exercised.
//! assert!(matches!(c.compile("process = _;"), Err(FaustError::Unavailable)));
//! ```
//!
//! The control-flow surface — [`FaustCompiler`], [`CompiledFaust`],
//! [`FaustError`], and [`compile_repair`] — is identical whether or not the
//! backend is compiled in. Enabling the feature only swaps the *backend* that
//! [`FaustCompiler::compile`] dispatches to. See `README.md` for exactly what to
//! install to turn the feature on and how U20 wires this in.
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

/// The product of a successful Faust compile.
///
/// In the default scaffold this value is **never constructed** (compilation
/// always errors), so it only needs to model the *shape* of the artifact the
/// real backend will return. The fields below are the minimum the rest of
/// OpenJammer needs to register the result as a node:
///
/// * a stable `name` (Faust's `process` definition / declared `name`), used as
///   the [`ojcore`] manifest id segment, and
/// * port counts so the graph compiler can wire it.
///
/// A working backend will extend this with the loadable artifact itself
/// (the JIT'd factory handle, or the path to an AOT-compiled `.so`/`.wasm`);
/// that field is intentionally absent here because its type depends on which
/// backend is chosen (see [`backend`] TODOs).
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
    /// * Default build (`libfaust` OFF): always `Err(`[`FaustError::Unavailable`]`)`.
    /// * `libfaust` ON: dispatches to the real backend (see [`backend`]).
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
    compile_repair_with(
        |src| compiler.compile(src),
        initial_source,
        budget,
        author,
    )
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

    #[test]
    fn stub_compile_is_unavailable() {
        let c = FaustCompiler::new();
        assert_eq!(c.compile("process = _;"), Err(FaustError::Unavailable));
    }

    #[test]
    fn repair_bails_immediately_on_unavailable() {
        // The real default backend: Unavailable -> author never called.
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
        assert!(!called, "author must not be consulted when backend is absent");
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
        assert!(s.contains("libfaust"), "should point at the feature/install");
    }
}
