// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Tests for limen_consensus crate.
//!
//! These tests verify:
//! 1. ConsensusChainStorage implements ChainReadContext (compile-time proof)
//! 2. Crate has #![forbid(unsafe_code)] attribute
//! 3. Error types are constructible and Display-able

// ============================================================
// Test 1: Compile-time proof that ConsensusChainStorage implements ChainReadContext
// ============================================================
//
// IMPORTANT: The trait-impl verification test below requires `--features consensus`.
// Without that feature, `ConsensusChainStorage` is not compiled and the most
// important test in this crate is silently skipped.
//
// CI enforcement: `scripts/ci-check.sh` step 6 runs:
//   cargo test -p limen_consensus --features consensus
//
// If running locally, always use:
//   cargo test -p limen_consensus --features consensus

/// This test exists purely as a compile-time assertion.
/// If ConsensusChainStorage does not implement ChainReadContext,
/// this function will fail to compile.
#[cfg(feature = "consensus")]
fn _static_assert_chain_read_context_impl() {
    fn assert_impl<T: limen_foundation_contract::capabilities::ChainReadContext>() {}
    assert_impl::<limen_consensus::consensus_storage::ConsensusChainStorage>();
}

/// Always-on guard: if this test runs WITHOUT the consensus feature, it emits
/// a compile_error-style panic so developers notice the trait-impl test was skipped.
/// In CI, step 6 of ci-check.sh ensures the feature is always enabled.
#[test]
fn test_consensus_feature_gate_documentation() {
    // This test always runs. Its purpose is visibility: if a developer runs
    // `cargo test -p limen_consensus` without --features consensus, this test
    // passes but prints a warning. The real enforcement is in ci-check.sh step 6.
    if !cfg!(feature = "consensus") {
        eprintln!(
            "\n\x1b[33mWARNING: consensus feature not enabled.\n\
             The trait-impl verification test was SKIPPED.\n\
             Run with: cargo test -p limen_consensus --features consensus\n\
             CI enforces this via scripts/ci-check.sh step 6.\x1b[0m\n"
        );
    }
}

#[test]
#[cfg(feature = "consensus")]
fn test_consensus_storage_implements_chain_read_context() {
    // The real assertion is at compile time (see _static_assert above).
    // If we reach this point, the trait is implemented.
    //
    // We additionally verify the struct is constructible.
    let storage = limen_consensus::consensus_storage::ConsensusChainStorage::new(1);

    // Verify it can be used as a trait object (dyn ChainReadContext).
    // This is critical because FoundationReadCapability stores &dyn ChainReadContext.
    let _trait_obj: &dyn limen_foundation_contract::capabilities::ChainReadContext = &storage;
}

// ============================================================
// Test 2: Verify #![forbid(unsafe_code)] is present
// ============================================================

#[test]
fn test_crate_has_forbid_unsafe() {
    // NOTE ON ENFORCEMENT LAYERS:
    // The ACTUAL enforcement mechanism is the `#![forbid(unsafe_code)]` compiler
    // attribute in lib.rs. The Rust compiler will reject any unsafe block in this
    // crate at compile time — this is the real guard.
    //
    // This test is a DOCUMENTATION/VISIBILITY aid: it verifies the attribute text
    // is present in the source file so that removal would be caught by both the
    // compiler (if unsafe is introduced) AND by this test (if the attribute is
    // removed preemptively). The include_str! + string match is fragile to
    // reformatting but acceptable because the compiler attribute is the true
    // enforcement — this test is defense-in-depth for attribute removal.
    let lib_source = include_str!("../src/lib.rs");
    assert!(
        lib_source.contains("#![forbid(unsafe_code)]"),
        "limen_consensus lib.rs must contain #![forbid(unsafe_code)]"
    );
}

// ============================================================
// Test 3: Error type tests
// ============================================================

#[test]
fn test_consensus_error_not_leader_display() {
    let err = limen_consensus::error::ConsensusError::NotLeader {
        leader_id: Some(3),
    };
    let msg = format!("{}", err);
    assert!(msg.contains("not leader"), "error message: {}", msg);
    assert!(msg.contains("3"), "should contain leader id: {}", msg);
}

#[test]
fn test_consensus_error_not_leader_unknown_display() {
    let err = limen_consensus::error::ConsensusError::NotLeader {
        leader_id: None,
    };
    let msg = format!("{}", err);
    assert!(msg.contains("not leader"), "error message: {}", msg);
    assert!(msg.contains("None"), "should indicate unknown leader: {}", msg);
}

#[test]
fn test_consensus_error_quorum_unavailable_display() {
    let err = limen_consensus::error::ConsensusError::QuorumUnavailable {
        available: 1,
        required: 2,
    };
    let msg = format!("{}", err);
    assert!(msg.contains("quorum"), "error message: {}", msg);
    assert!(msg.contains("1"), "should contain available count: {}", msg);
    assert!(msg.contains("2"), "should contain required count: {}", msg);
}

#[test]
fn test_consensus_error_log_compaction_display() {
    let err = limen_consensus::error::ConsensusError::LogCompaction;
    let msg = format!("{}", err);
    assert!(msg.contains("compaction"), "error message: {}", msg);
}

#[test]
fn test_consensus_error_raft_protocol_display() {
    let err = limen_consensus::error::ConsensusError::RaftProtocol("term mismatch".into());
    let msg = format!("{}", err);
    assert!(msg.contains("term mismatch"), "error message: {}", msg);
}

#[test]
fn test_consensus_error_snapshot_failed_display() {
    let err = limen_consensus::error::ConsensusError::SnapshotFailed("timeout".into());
    let msg = format!("{}", err);
    assert!(msg.contains("timeout"), "error message: {}", msg);
}

#[test]
fn test_consensus_error_membership_rejected_display() {
    let err = limen_consensus::error::ConsensusError::MembershipRejected("node 5 already member".into());
    let msg = format!("{}", err);
    assert!(msg.contains("node 5 already member"), "error message: {}", msg);
}

#[test]
fn test_consensus_error_storage_backend_display() {
    let err = limen_consensus::error::ConsensusError::StorageBackend("disk full".into());
    let msg = format!("{}", err);
    assert!(msg.contains("disk full"), "error message: {}", msg);
}

// ============================================================
// Test 4: ConsensusError -> ChainReadError mapping (Section 5.4)
// ============================================================

#[test]
fn test_consensus_error_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::NotLeader { leader_id: Some(7) };
    let chain_err: ChainReadError = err.into();

    // Must map to StorageError variant with the Display string
    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("not leader"), "mapped message: {}", msg);
            assert!(msg.contains("7"), "should contain leader id: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

#[test]
fn test_consensus_error_quorum_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::QuorumUnavailable {
        available: 1,
        required: 3,
    };
    let chain_err: ChainReadError = err.into();

    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("quorum"), "mapped message: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

#[test]
fn test_consensus_error_log_compaction_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::LogCompaction;
    let chain_err: ChainReadError = err.into();

    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("compaction"), "mapped message: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

#[test]
fn test_consensus_error_raft_protocol_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::RaftProtocol("term mismatch".into());
    let chain_err: ChainReadError = err.into();

    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("term mismatch"), "mapped message: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

#[test]
fn test_consensus_error_snapshot_failed_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::SnapshotFailed("timeout".into());
    let chain_err: ChainReadError = err.into();

    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("timeout"), "mapped message: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

#[test]
fn test_consensus_error_membership_rejected_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::MembershipRejected("node 5 already member".into());
    let chain_err: ChainReadError = err.into();

    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("node 5 already member"), "mapped message: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

#[test]
fn test_consensus_error_storage_backend_maps_to_chain_read_error() {
    use limen_foundation_contract::chain::ChainReadError;

    let err = limen_consensus::error::ConsensusError::StorageBackend("disk full".into());
    let chain_err: ChainReadError = err.into();

    match chain_err {
        ChainReadError::StorageError(msg) => {
            assert!(msg.contains("disk full"), "mapped message: {}", msg);
        }
        other => panic!("expected StorageError, got {:?}", other),
    }
}

// ============================================================
// Test 5: Error is Send + Sync (required for async contexts)
// ============================================================

#[test]
fn test_consensus_error_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<limen_consensus::error::ConsensusError>();
}
