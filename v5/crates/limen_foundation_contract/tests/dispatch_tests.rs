//! M6 Dispatch Tests — operation order, composition, fresh fields, end-to-end.

use limen_types::*;
use limen_foundation_contract::capabilities::ChainReadContext;
use limen_foundation_contract::chain::*;
use limen_foundation_contract::proposed::*;
use limen_foundation_contract::verdict::*;
use limen_foundation_contract::dispatch::run_commit_transaction;

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

fn test_proposed(payload: &[u8]) -> ProposedTransitionEnvelope {
    ProposedTransitionEnvelope::new(
        ProposedTransition { payload: payload.to_vec(), transition_type: "test".into() },
        ProposerIdentity("actor".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    )
}

// ============================================================
// End-to-end: all-pass → Commit
// ============================================================

#[test]
fn test_all_pass_produces_commit() {
    let reader = TestChainReader;
    let decision = run_commit_transaction(
        &reader,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b"valid-payload"),
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    );
    match decision {
        CommitDecision::Commit { .. } => {} // expected
        CommitDecision::Refused(r) => panic!("expected Commit, got Refused: {:?}", r),
    }
}

// ============================================================
// Refusal short-circuit: empty payload → Refused
// ============================================================

#[test]
fn test_refusal_short_circuits_on_empty_payload() {
    let reader = TestChainReader;
    let decision = run_commit_transaction(
        &reader,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("actor".into()),
        TraceIdentity(1),
        &test_proposed(b""), // empty payload → RefusalEvaluation refuses
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    );
    match decision {
        CommitDecision::Refused(r) => {
            assert_eq!(r.category, RefusalCategory::Evidence);
        }
        CommitDecision::Commit { .. } => panic!("expected Refused for empty payload"),
    }
}

// ============================================================
// Authority short-circuit: identity mismatch → Refused
// ============================================================

#[test]
fn test_authority_short_circuits_on_identity_mismatch() {
    let reader = TestChainReader;
    // ProposedTransitionEnvelope claims "fake-actor" but authenticated as "real-actor"
    let proposed = ProposedTransitionEnvelope::new(
        ProposedTransition { payload: b"payload".to_vec(), transition_type: "test".into() },
        ProposerIdentity("fake-actor".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    );
    let decision = run_commit_transaction(
        &reader,
        TenantScope("test".into()),
        RequestBoundary(1),
        ActorIdentity("real-actor".into()), // authenticated identity
        TraceIdentity(1),
        &proposed,
        SubstrateInstant(1000),
        ExecutionContext::Profile1,
        0,
    );
    match decision {
        CommitDecision::Refused(r) => {
            assert_eq!(r.category, RefusalCategory::Authority);
        }
        CommitDecision::Commit { .. } => panic!("expected Refused for identity mismatch"),
    }
}

// ============================================================
// Determinism: same inputs → same decision
// ============================================================

#[test]
fn test_determinism() {
    let reader = TestChainReader;
    let proposed = test_proposed(b"determinism-test");
    let d1 = run_commit_transaction(
        &reader, TenantScope("t".into()), RequestBoundary(1),
        ActorIdentity("a".into()), TraceIdentity(1),
        &proposed, SubstrateInstant(100), ExecutionContext::Profile1, 0,
    );
    let d2 = run_commit_transaction(
        &reader, TenantScope("t".into()), RequestBoundary(1),
        ActorIdentity("a".into()), TraceIdentity(1),
        &proposed, SubstrateInstant(100), ExecutionContext::Profile1, 0,
    );
    assert_eq!(d1, d2);
}

// ============================================================
// Data-only entry point: returns CommitDecision, no authority escapes
// ============================================================

#[test]
fn test_entry_point_returns_commit_decision_only() {
    let reader = TestChainReader;
    let result: CommitDecision = run_commit_transaction(
        &reader, TenantScope("t".into()), RequestBoundary(1),
        ActorIdentity("a".into()), TraceIdentity(1),
        &test_proposed(b"payload"), SubstrateInstant(100), ExecutionContext::Profile1, 0,
    );
    // The return type is CommitDecision — cannot be a capability, envelope, or context.
    // This test proves the type signature at the call site.
    let _ = result;
}
