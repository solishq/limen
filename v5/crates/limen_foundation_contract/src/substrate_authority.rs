// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Substrate production mint authority (M2.1 Option F).
//!
//! Co-located inside `limen_foundation_contract` so that `pub(crate)` constructors
//! for capabilities, envelopes, and contexts are reachable. This module is `pub(crate)`
//! — NOT exported to external crates.
//!
//! M2.1 scope: production mint authority only. No concrete M5 registry, no fixed
//! operation order, no commit composition, no full dispatch. Those are M6 scope.
//!
//! Authority: M2.1 Founder Design Ratification (Option F).

use crate::capabilities::{FoundationReadCapability, ChainReadContext};
use crate::envelope::{TransactionRuntimeContext, SubstrateRuntimeEnvelope, OperationScopedFields};
use limen_types::*;

/// Mint a production `FoundationReadCapability` bound to `'ctx`.
/// `pub(crate)` — only callable within `limen_foundation_contract`.
pub(crate) fn mint_capability<'ctx>(
    reader: &'ctx dyn ChainReadContext,
    scope: TenantScope,
) -> FoundationReadCapability<'ctx> {
    FoundationReadCapability::mint(reader, scope)
}

/// Construct a production `TransactionRuntimeContext`.
/// `pub(crate)` — only callable within `limen_foundation_contract`.
pub(crate) fn mint_transaction_context(
    request_boundary: RequestBoundary,
    actor_identity: ActorIdentity,
    tenant_scope: TenantScope,
    trace_identity: TraceIdentity,
) -> TransactionRuntimeContext {
    TransactionRuntimeContext::mint(request_boundary, actor_identity, tenant_scope, trace_identity)
}

/// Construct a production `SubstrateRuntimeEnvelope` with fresh `OperationScopedFields`.
/// `pub(crate)` — only callable within `limen_foundation_contract`.
pub(crate) fn mint_envelope<'tx>(
    tx_ctx: &'tx TransactionRuntimeContext,
    fields: OperationScopedFields,
) -> SubstrateRuntimeEnvelope<'tx> {
    SubstrateRuntimeEnvelope::mint(tx_ctx, fields)
}

/// Dispatch a single foundation operation through the ratified trait surface.
/// Mints a fresh `SubstrateRuntimeEnvelope` per invocation.
/// `pub(crate)` — only callable within `limen_foundation_contract`.
pub(crate) fn dispatch_operation<'ctx, 'tx, Op: crate::operation::FoundationOperation>(
    tx_ctx: &'tx TransactionRuntimeContext,
    chain_read: &FoundationReadCapability<'ctx>,
    proposed: &crate::proposed::ProposedTransitionEnvelope,
    fields: OperationScopedFields,
) -> Op::Verdict {
    let envelope = mint_envelope(tx_ctx, fields);
    Op::evaluate(chain_read, &envelope, proposed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capabilities::ChainReadContext;
    use crate::chain::*;
    use crate::operation::FoundationOperation;
    use crate::proposed::*;
    use crate::verdict::*;

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

    // In-crate dummy operation — no limen_foundation_ops import
    struct DummyOp;
    impl FoundationOperation for DummyOp {
        type Verdict = RefusalVerdict;
        const TYPE: OperationType = OperationType::Refusal;
        fn evaluate<'ctx, 'tx>(
            chain_read: &crate::capabilities::FoundationReadCapability<'ctx>,
            _runtime: &crate::envelope::SubstrateRuntimeEnvelope<'tx>,
            _proposed: &ProposedTransitionEnvelope,
        ) -> Self::Verdict {
            let _state = chain_read.read_tenant_state().unwrap();
            RefusalVerdict::Accept
        }
    }

    #[test]
    fn test_mint_capability_produces_valid_cap() {
        let reader = TestChainReader;
        let cap = mint_capability(&reader, TenantScope("test".into()));
        let state = cap.read_tenant_state().unwrap();
        assert_eq!(state.tenant_scope, TenantScope("test".into()));
    }

    #[test]
    fn test_mint_transaction_context() {
        let ctx = mint_transaction_context(
            RequestBoundary(1), ActorIdentity("actor".into()),
            TenantScope("tenant".into()), TraceIdentity(42),
        );
        assert_eq!(ctx.tenant_scope(), &TenantScope("tenant".into()));
    }

    #[test]
    fn test_mint_envelope_fresh_per_operation() {
        let ctx = mint_transaction_context(
            RequestBoundary(1), ActorIdentity("a".into()),
            TenantScope("t".into()), TraceIdentity(1),
        );
        let f1 = OperationScopedFields {
            substrate_clock: SubstrateInstant(100), invocation_identity: InvocationId(1),
            operation_type: OperationType::Refusal, execution_context: ExecutionContext::Profile1,
            chain_read_freshness: FreshnessMarker { local_sequence: ChainSequence(0) },
        };
        let f2 = OperationScopedFields {
            substrate_clock: SubstrateInstant(200), invocation_identity: InvocationId(2),
            operation_type: OperationType::Authority, execution_context: ExecutionContext::Profile1,
            chain_read_freshness: FreshnessMarker { local_sequence: ChainSequence(0) },
        };
        let e1 = mint_envelope(&ctx, f1);
        let e2 = mint_envelope(&ctx, f2);
        assert_ne!(e1.operation().invocation_identity, e2.operation().invocation_identity);
        assert_eq!(e1.transaction().tenant_scope(), e2.transaction().tenant_scope());
    }

    #[test]
    fn test_dispatch_dummy_operation_end_to_end() {
        let reader = TestChainReader;
        let cap = mint_capability(&reader, TenantScope("test".into()));
        let ctx = mint_transaction_context(
            RequestBoundary(1), ActorIdentity("actor".into()),
            TenantScope("test".into()), TraceIdentity(1),
        );
        let proposed = ProposedTransitionEnvelope::new(
            ProposedTransition { payload: b"test".to_vec(), transition_type: "test".into() },
            ProposerIdentity("actor".into()), ProposerTimestamp(1000),
            RequestedTenantScope("test".into()), SchemaVersion(1),
        );
        let fields = OperationScopedFields {
            substrate_clock: SubstrateInstant(1000), invocation_identity: InvocationId(1),
            operation_type: OperationType::Refusal, execution_context: ExecutionContext::Profile1,
            chain_read_freshness: FreshnessMarker { local_sequence: ChainSequence(0) },
        };
        let verdict = dispatch_operation::<DummyOp>(&ctx, &cap, &proposed, fields);
        assert_eq!(verdict, RefusalVerdict::Accept);
    }

    #[test]
    fn test_fields_no_carryover() {
        let f1 = OperationScopedFields {
            substrate_clock: SubstrateInstant(100), invocation_identity: InvocationId(1),
            operation_type: OperationType::Refusal, execution_context: ExecutionContext::Profile1,
            chain_read_freshness: FreshnessMarker { local_sequence: ChainSequence(5) },
        };
        let f2 = OperationScopedFields {
            substrate_clock: SubstrateInstant(200), invocation_identity: InvocationId(2),
            operation_type: OperationType::Governance, execution_context: ExecutionContext::Profile2,
            chain_read_freshness: FreshnessMarker { local_sequence: ChainSequence(10) },
        };
        assert_ne!(f1.invocation_identity, f2.invocation_identity);
        assert_ne!(f1.substrate_clock, f2.substrate_clock);
    }
}
