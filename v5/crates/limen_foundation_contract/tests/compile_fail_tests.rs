// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Compile-fail tests for the foundation contract (v1.3 §12.2).
//!
//! These tests verify that the type system structurally prevents:
//! - Application code from constructing FoundationReadCapability
//! - Conversion between FoundationReadCapability and ProjectionReadCapability
//! - Foundation operations accepting a fourth parameter
//! - Application code from constructing SubstrateRuntimeEnvelope
//! - Application code from constructing TransactionRuntimeContext

#[test]
fn compile_fail_tests() {
    let t = trybuild::TestCases::new();
    t.compile_fail("tests/compile_fail/*.rs");
}
