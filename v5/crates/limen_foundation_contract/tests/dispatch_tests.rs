//! M6 Dispatch Tests — operation order, composition, fresh fields, end-to-end.
//!
//! NF-02 amendment: all tests use `run_commit_transaction_gated` with a proper
//! `LifecycleGuard` (transitioned to `Ready`) and a `ChainCommitSink`.
//! The legacy `run_commit_transaction` is `pub(crate)` and cannot be called
//! from external tests.

use std::cell::RefCell;
use limen_types::*;
use limen_foundation_contract::capabilities::ChainReadContext;
use limen_foundation_contract::chain::*;
use limen_foundation_contract::dispatch::{
    run_commit_transaction_gated, ChainCommitSink, CommitTransactionError,
};
use limen_foundation_contract::envelope::CommitEnvelope;
use limen_foundation_contract::lifecycle::{LifecycleGuard, LifecycleState};
use limen_foundation_contract::proposed::*;
use limen_foundation_contract::verdict::*;

// ============================================================
// Mock chain reader
// ============================================================

struct TestChainReader;
impl ChainReadContext for TestChainReader {
    fn read_entry(&self, _: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> { Ok(None) }
    fn read_tenant_state(&self, _: &TenantScope) -> Result<TenantChainState, ChainReadError> {
        Ok(TenantChainState { tenant_scope: TenantScope("test".into()), next_tenant_sequence: ChainSequence(0), last_hash: None })
    }
    fn read_governance_state_at(&self, _: &TenantScope, _: &PolicyId) -> Result<Option<GovernanceState>, ChainReadError> { Ok(None) }
    fn read_authority_state_at(&self, _: &TenantScope, _: &Actor) -> Result<Vec<AuthorityState>, ChainReadError> { Ok(vec![]) }
    fn read_cascade_link(&self, _: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> { Ok(None) }
    fn freshness_marker(&self) -> FreshnessMarker { FreshnessMarker { local_sequence: ChainSequence(0) } }
}

// ============================================================
// Mock chain commit sink — records what was committed
// ============================================================

/// Records the last committed entry for test assertions.
struct RecordingSink {
    last_committed: RefCell<Option<(ProposedTransitionEnvelope, CommitDecision, VerdictSet)>>,
}

impl RecordingSink {
    fn new() -> Self {
        Self { last_committed: RefCell::new(None) }
    }

    /// Retrieve the last committed verdict set (panics if nothing was committed).
    fn last_verdicts(&self) -> VerdictSet {
        self.last_committed.borrow().as_ref().expect("nothing committed").2.clone()
    }
}

impl ChainCommitSink for RecordingSink {
    fn commit_entry(
        &self,
        proposed: ProposedTransitionEnvelope,
        decision: CommitDecision,
        verdicts: VerdictSet,
        _tenant_scope: TenantScope,
        _commit_envelope: CommitEnvelope,
    ) -> Result<ChainEntry, String> {
        *self.last_committed.borrow_mut() = Some((proposed.clone(), decision.clone(), verdicts.clone()));
        // Return a minimal ChainEntry — the caller only checks the decision.
        Ok(ChainEntry::Committed(CommittedEntry {
            global_sequence: ChainSequence(0),
            tenant_sequence: ChainSequence(0),
            content_hash: Blake3Hash([0; 32]),
            previous_hash: None,
            tenant_scope: TenantScope("test".into()),
            canonical_at: SubstrateInstant(0),
            transition: CommittedTransition {
                proposed,
                verdicts,
                commit_path: match decision {
                    CommitDecision::Commit { path } => path,
                    _ => CommitPath::Default,
                },
                canonical_at: SubstrateInstant(0),
            },
            commit_envelope: CommitEnvelope {
                request_boundary: RequestBoundary(0),
                actor_identity: ActorIdentity("test".into()),
                tenant_scope: TenantScope("test".into()),
                trace_identity: TraceIdentity(0),
                committed_at: SubstrateInstant(0),
            },
        }))
    }
}

/// A commit sink that always fails — for testing ChainCommitFailed error path.
struct FailingSink;

impl ChainCommitSink for FailingSink {
    fn commit_entry(
        &self,
        _proposed: ProposedTransitionEnvelope,
        _decision: CommitDecision,
        _verdicts: VerdictSet,
        _tenant_scope: TenantScope,
        _commit_envelope: CommitEnvelope,
    ) -> Result<ChainEntry, String> {
        Err("injected sink failure".to_string())
    }
}

// ============================================================
// Helpers
// ============================================================

fn test_proposed(payload: &[u8]) -> ProposedTransitionEnvelope {
    ProposedTransitionEnvelope::new(
        ProposedTransition { payload: payload.to_vec(), transition_type: "test".into() },
        ProposerIdentity("actor".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    )
}

/// Create a `LifecycleGuard` transitioned to `Ready`.
fn ready_lifecycle() -> LifecycleGuard {
    let guard = LifecycleGuard::new();
    guard.transition(LifecycleState::Initializing).unwrap();
    guard.transition(LifecycleState::Ready).unwrap();
    guard
}

// ============================================================
// End-to-end: all-pass -> Commit
// ============================================================

#[test]
fn test_all_pass_produces_commit() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    let decision = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b"valid-payload"),
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    ).unwrap();
    match decision {
        CommitDecision::Commit { .. } => {} // expected
        CommitDecision::Refused(r) => panic!("expected Commit, got Refused: {:?}", r),
    }
}

// ============================================================
// Refusal short-circuit: empty payload -> Refused
// ============================================================

#[test]
fn test_refusal_short_circuits_on_empty_payload() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    let decision = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b""), // empty payload -> RefusalEvaluation refuses
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    ).unwrap();
    match decision {
        CommitDecision::Refused(r) => {
            assert_eq!(r.category, RefusalCategory::Evidence);
        }
        CommitDecision::Commit { .. } => panic!("expected Refused for empty payload"),
    }
}

// ============================================================
// Authority short-circuit: identity mismatch -> Refused
// ============================================================

#[test]
fn test_authority_short_circuits_on_identity_mismatch() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    // ProposedTransitionEnvelope claims "fake-actor" but authenticated as "real-actor"
    let proposed = ProposedTransitionEnvelope::new(
        ProposedTransition { payload: b"payload".to_vec(), transition_type: "test".into() },
        ProposerIdentity("fake-actor".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    );
    let decision = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("real-actor".into()), // authenticated identity
        TraceIdentity(1),
        &proposed,
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    ).unwrap();
    match decision {
        CommitDecision::Refused(r) => {
            assert_eq!(r.category, RefusalCategory::Authority);
        }
        CommitDecision::Commit { .. } => panic!("expected Refused for identity mismatch"),
    }
}

// ============================================================
// Determinism: same inputs -> same decision
// ============================================================

#[test]
fn test_determinism() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    let proposed = test_proposed(b"determinism-test");
    let d1 = run_commit_transaction_gated(
        &lifecycle, &reader, &sink, TenantScope("t".into()), RequestBoundary(1),
        ActorIdentity("a".into()), TraceIdentity(1),
        &proposed, SubstrateInstant(100), ExecutionContext::Profile1, 0,
    ).unwrap();
    let d2 = run_commit_transaction_gated(
        &lifecycle, &reader, &sink, TenantScope("t".into()), RequestBoundary(1),
        ActorIdentity("a".into()), TraceIdentity(1),
        &proposed, SubstrateInstant(100), ExecutionContext::Profile1, 0,
    ).unwrap();
    assert_eq!(d1, d2);
}

// ============================================================
// Data-only entry point: returns CommitDecision, no authority escapes
// ============================================================

#[test]
fn test_entry_point_returns_commit_decision_only() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    let result: CommitDecision = run_commit_transaction_gated(
        &lifecycle, &reader, &sink, TenantScope("t".into()), RequestBoundary(1),
        ActorIdentity("a".into()), TraceIdentity(1),
        &test_proposed(b"payload"), SubstrateInstant(100), ExecutionContext::Profile1, 0,
    ).unwrap();
    // The return type is CommitDecision — cannot be a capability, envelope, or context.
    let _ = result;
}

// ============================================================
// NF-03: Integration tests for run_commit_transaction_gated
// ============================================================

/// NF-03-1: Calling gated when lifecycle is NOT Ready returns error.
#[test]
fn test_gated_rejects_when_lifecycle_not_ready() {
    let reader = TestChainReader;
    let lifecycle = LifecycleGuard::new(); // Uninitialized — NOT Ready
    let sink = RecordingSink::new();
    let result = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b"payload"),
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    );
    assert!(result.is_err(), "must reject when lifecycle is not Ready");
    assert!(
        matches!(result.unwrap_err(), CommitTransactionError::LifecycleNotReady(_)),
        "error must be LifecycleNotReady"
    );
}

/// NF-03-2: Calling with Ready lifecycle + valid input produces a chain entry
/// (verified by reading the recording sink).
#[test]
fn test_gated_commit_produces_chain_entry_via_sink() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    let decision = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b"sink-test-payload"),
        SubstrateInstant(2000),
        ExecutionContext::Profile1,
        0,
    ).unwrap();

    assert!(matches!(decision, CommitDecision::Commit { .. }));

    // Verify the sink received the commit — the entry was written.
    let committed = sink.last_committed.borrow();
    assert!(committed.is_some(), "sink must have received a commit_entry call");
}

/// NF-03-3: Calling with a failing ChainCommitSink returns ChainCommitFailed.
#[test]
fn test_gated_returns_chain_commit_failed_on_sink_error() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = FailingSink;
    let result = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b"will-fail"),
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    );
    assert!(result.is_err(), "must return error when sink fails");
    match result.unwrap_err() {
        CommitTransactionError::ChainCommitFailed(msg) => {
            assert!(msg.contains("injected sink failure"),
                "error message should contain the sink's error: got {}", msg);
        }
        other => panic!("expected ChainCommitFailed, got {:?}", other),
    }
}

/// NF-03-4: The VerdictSet in the committed entry contains REAL verdicts,
/// not fabricated ones.
#[test]
fn test_gated_commit_carries_real_verdicts() {
    let reader = TestChainReader;
    let lifecycle = ready_lifecycle();
    let sink = RecordingSink::new();
    let _ = run_commit_transaction_gated(
        &lifecycle,
        &reader,
        &sink,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b"verdict-test"),
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    ).unwrap();

    let verdicts = sink.last_verdicts();
    // With default test data, all four operations pass. Verify these are
    // the actual operation results, not hardcoded placeholders.
    assert_eq!(verdicts.refusal, RefusalVerdict::Accept,
        "refusal verdict must be the actual Accept from RefusalEvaluation");
    assert_eq!(verdicts.authority, AuthorityVerdict::Authorized,
        "authority verdict must be the actual Authorized from AuthorityAndCommitEvaluation");
    assert_eq!(verdicts.governance, GovernanceVerdict::Permitted,
        "governance verdict must be the actual Permitted from GovernanceEvaluation");
    assert_eq!(verdicts.cascade, CascadeVerdict::Intact,
        "cascade verdict must be the actual Intact from CascadeIntegrityEvaluation");
}
