//! Property-based codec tests (Track A P0a — the proptest on-ramp).
//!
//! `ParamPatch` is the hand-packed 7-byte frame on the HIGHEST-rate UI->RT path,
//! so its byte codec must be lossless for every possible input — exactly the kind
//! of total, all-inputs property a single example test cannot prove. This is the
//! first proptest in the workspace; the same `proptest` dependency + strategy
//! style will drive the OjGraph/`compile()` generators (acyclic-order validity,
//! cycle rejection, never-panics) that the deterministic-simulation harness reuses.

use ojproto::ParamPatch;
use proptest::array::uniform7;
use proptest::prelude::*;

proptest! {
    /// A constructed `ParamPatch` survives a `to_bytes` -> `from_bytes` round-trip
    /// exactly, for ALL fields — including NaN/denormal `value` payloads, compared
    /// by bit pattern (NaN != NaN under `==`, but the bytes must still be exact).
    #[test]
    fn parampatch_struct_roundtrip(node: u16, param: u8, bits in any::<u32>()) {
        let value = f32::from_bits(bits);
        let p = ParamPatch { node, param, value };
        let back = ParamPatch::from_bytes(p.to_bytes());
        prop_assert_eq!(back.node, p.node);
        prop_assert_eq!(back.param, p.param);
        prop_assert_eq!(back.value.to_bits(), value.to_bits());
    }

    /// Symmetrically, ANY 7 bytes decode and re-encode to the identical 7 bytes —
    /// the frame has no padding or unused bits that could silently drop data.
    #[test]
    fn parampatch_bytes_roundtrip(bytes in uniform7(any::<u8>())) {
        prop_assert_eq!(ParamPatch::from_bytes(bytes).to_bytes(), bytes);
    }
}
