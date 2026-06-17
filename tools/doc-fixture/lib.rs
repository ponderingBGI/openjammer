//! Negative fixture for the docs-as-requirement gate (plan §4.4).
//!
//! Under `#![deny(missing_docs)]`, the undocumented public item below makes
//! `cargo check`/`cargo doc` FAIL. CI runs this crate and asserts the failure,
//! so the missing_docs enforcement can never silently regress. Do NOT document
//! `Undocumented` — its missing doc is the whole point.
#![deny(missing_docs)]

pub struct Undocumented;
