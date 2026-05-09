// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! M5 Foundation Operations Tests — Interface-First Contract Testing
//! Structural contract behavior only. No domain policy.

use limen_types::*;
use limen_foundation_contract::capabilities::*;
use limen_foundation_contract::envelope::*;
use limen_foundation_contract::proposed::*;
use limen_foundation_contract::verdict::*;
use limen_foundation_contract::operation::FoundationOperation;
use limen_foundation_contract::chain::*;

use limen_foundation_ops::refusal::RefusalEvaluation;
use limen_foundation_ops::authority::AuthorityAndCommitEvaluation;
use limen_foundation_ops::governance::GovernanceEvaluation;
use limen_foundation_ops::cascade::CascadeIntegrityEvaluation;

// ============================================================
// Mock ChainReadContext for testing (lives in test, not in ops crate)
// ============================================================

struct MockChainReadContext;

impl ChainReadContext for MockChainReadContext {
    fn read_entry(&self, _seq: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> {
        Ok(None)
    }
    fn read_tenant_state(&self, _scope: &TenantScope) -> Result<TenantChainState, ChainReadError> {
        Ok(TenantChainState {
            tenant_scope: TenantScope("test".into()),
            next_tenant_sequence: ChainSequence(0),
            last_hash: None,
        })
    }
    fn read_governance_state_at(&self, _scope: &TenantScope, _pid: &PolicyId) -> Result<Option<GovernanceState>, ChainReadError> {
        Ok(None)
    }
    fn read_authority_state_at(&self, _scope: &TenantScope, _actor: &Actor) -> Result<Vec<AuthorityState>, ChainReadError> {
        Ok(vec![])
    }
    fn read_cascade_link(&self, _prior: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> {
        Ok(None)
    }
    fn freshness_marker(&self) -> FreshnessMarker {
        FreshnessMarker { local_sequence: ChainSequence(0) }
    }
}

// ============================================================
// Test helpers
// ============================================================

fn test_capability<'a>(ctx: &'a MockChainReadContext) -> FoundationReadCapability<'a> {
    FoundationReadCapability::test_mint(ctx, TenantScope("test".into()))
}

fn test_envelope(actor: &str) -> (TransactionRuntimeContext, ProposedTransitionEnvelope) {
    let tx = TransactionRuntimeContext::test_mint(
        RequestBoundary(1),
        ActorIdentity(actor.into()),
        TenantScope("test".into()),
        TraceIdentity(1),
    );
    let proposed = ProposedTransitionEnvelope::new(
        ProposedTransition { payload: b"test-payload".to_vec(), transition_type: "test".into() },
        ProposerIdentity(actor.into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    );
    (tx, proposed)
}

fn test_runtime_envelope<'tx>(tx: &'tx TransactionRuntimeContext) -> SubstrateRuntimeEnvelope<'tx> {
    SubstrateRuntimeEnvelope::test_mint(
        tx,
        OperationScopedFields {
            substrate_clock: SubstrateInstant(1000),
            invocation_identity: InvocationId(1),
            operation_type: OperationType::Refusal,
            execution_context: ExecutionContext::Profile1,
            chain_read_freshness: FreshnessMarker { local_sequence: ChainSequence(0) },
        },
    )
}

// ============================================================
// Signature conformance
// ============================================================

#[test]
fn test_refusal_implements_trait() {
    assert_eq!(RefusalEvaluation::TYPE, OperationType::Refusal);
}

#[test]
fn test_authority_implements_trait() {
    assert_eq!(AuthorityAndCommitEvaluation::TYPE, OperationType::Authority);
}

#[test]
fn test_governance_implements_trait() {
    assert_eq!(GovernanceEvaluation::TYPE, OperationType::Governance);
}

#[test]
fn test_cascade_implements_trait() {
    assert_eq!(CascadeIntegrityEvaluation::TYPE, OperationType::Cascade);
}

// ============================================================
// Refusal behavior
// ============================================================

#[test]
fn test_refusal_accepts_valid_input() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, proposed) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let verdict = RefusalEvaluation::evaluate(&cap, &env, &proposed);
    assert_eq!(verdict, RefusalVerdict::Accept);
}

#[test]
fn test_refusal_rejects_empty_payload() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, _) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let empty_proposed = ProposedTransitionEnvelope::new(
        ProposedTransition { payload: vec![], transition_type: "test".into() },
        ProposerIdentity("tester".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    );

    let verdict = RefusalEvaluation::evaluate(&cap, &env, &empty_proposed);
    match verdict {
        RefusalVerdict::Refuse(reason) => {
            assert_eq!(reason.category, RefusalCategory::Evidence);
        }
        RefusalVerdict::Accept => panic!("should refuse empty payload"),
    }
}

// ============================================================
// Authority behavior
// ============================================================

#[test]
fn test_authority_accepts_matching_identity() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, proposed) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let verdict = AuthorityAndCommitEvaluation::evaluate(&cap, &env, &proposed);
    assert_eq!(verdict, AuthorityVerdict::Authorized);
}

#[test]
fn test_authority_rejects_identity_mismatch() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    // Authenticated as "real-actor" but proposing as "fake-actor"
    let tx = TransactionRuntimeContext::test_mint(
        RequestBoundary(1),
        ActorIdentity("real-actor".into()),
        TenantScope("test".into()),
        TraceIdentity(1),
    );
    let env = test_runtime_envelope(&tx);

    let proposed = ProposedTransitionEnvelope::new(
        ProposedTransition { payload: b"payload".to_vec(), transition_type: "test".into() },
        ProposerIdentity("fake-actor".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    );

    let verdict = AuthorityAndCommitEvaluation::evaluate(&cap, &env, &proposed);
    match verdict {
        AuthorityVerdict::Unauthorized(f) => {
            assert!(f.reason.contains("mismatch"));
        }
        _ => panic!("should reject identity mismatch"),
    }
}

// ============================================================
// Governance behavior
// ============================================================

#[test]
fn test_governance_permits_when_no_policies() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, proposed) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let verdict = GovernanceEvaluation::evaluate(&cap, &env, &proposed);
    assert_eq!(verdict, GovernanceVerdict::Permitted);
}

// ============================================================
// Cascade behavior
// ============================================================

#[test]
fn test_cascade_intact_when_no_links() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, proposed) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let verdict = CascadeIntegrityEvaluation::evaluate(&cap, &env, &proposed);
    assert_eq!(verdict, CascadeVerdict::Intact);
}

// ============================================================
// Witness handling — witnesses remain proposed input, not authority
// ============================================================

#[test]
fn test_witness_does_not_replace_chain_reads() {
    // External witness content should not affect the refusal verdict.
    // The operation reads chain state through the capability, not witness content.
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, _) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let proposed_with_witness = ProposedTransitionEnvelope::new(
        ProposedTransition { payload: b"payload".to_vec(), transition_type: "test".into() },
        ProposerIdentity("tester".into()),
        ProposerTimestamp(1000),
        RequestedTenantScope("test".into()),
        SchemaVersion(1),
    ).with_witness(ExternalWitness {
        source: ExternalWitnessSource::Human,
        content: WitnessContent(b"I claim authority".to_vec()),
        received_at: SubstrateInstant(999),
        source_attested_at: None,
    });

    // Verdict should be same as without witness — witness is input, not authority
    let verdict = RefusalEvaluation::evaluate(&cap, &env, &proposed_with_witness);
    assert_eq!(verdict, RefusalVerdict::Accept);
}

// ============================================================
// Chain-unreadable refusal (OperationalIntegrity verdict)
// ============================================================

#[test]
fn test_refusal_on_chain_unreadable() {
    // Mock that returns errors for all reads
    struct FailingChainReadContext;
    impl ChainReadContext for FailingChainReadContext {
        fn read_entry(&self, _: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> {
            Err(ChainReadError::StorageError("test failure".into()))
        }
        fn read_tenant_state(&self, _: &TenantScope) -> Result<TenantChainState, ChainReadError> {
            Err(ChainReadError::StorageError("test failure".into()))
        }
        fn read_governance_state_at(&self, _: &TenantScope, _: &PolicyId) -> Result<Option<GovernanceState>, ChainReadError> {
            Err(ChainReadError::StorageError("test failure".into()))
        }
        fn read_authority_state_at(&self, _: &TenantScope, _: &Actor) -> Result<Vec<AuthorityState>, ChainReadError> {
            Err(ChainReadError::StorageError("test failure".into()))
        }
        fn read_cascade_link(&self, _: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> {
            Err(ChainReadError::StorageError("test failure".into()))
        }
        fn freshness_marker(&self) -> FreshnessMarker {
            FreshnessMarker { local_sequence: ChainSequence(0) }
        }
    }

    let ctx = FailingChainReadContext;
    let cap = FoundationReadCapability::test_mint(&ctx, TenantScope("test".into()));
    let (tx, proposed) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let verdict = RefusalEvaluation::evaluate(&cap, &env, &proposed);
    match verdict {
        RefusalVerdict::Refuse(reason) => {
            assert_eq!(reason.category, RefusalCategory::OperationalIntegrity);
        }
        RefusalVerdict::Accept => panic!("should refuse when chain is unreadable"),
    }
}

// ============================================================
// Determinism
// ============================================================

#[test]
fn test_same_inputs_same_verdict() {
    let ctx = MockChainReadContext;
    let cap = test_capability(&ctx);
    let (tx, proposed) = test_envelope("tester");
    let env = test_runtime_envelope(&tx);

    let v1 = RefusalEvaluation::evaluate(&cap, &env, &proposed);
    let v2 = RefusalEvaluation::evaluate(&cap, &env, &proposed);
    assert_eq!(v1, v2);
}
