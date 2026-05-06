//! Substrate dispatch loop and public entry point (M6).
//!
//! v1.3 §1.3 fixed order: Refusal → Authority → Governance → Cascade.
//! Composition rule: committed iff all four return non-blocking verdicts.
//! Static-type dispatch — four hardcoded operations, no runtime registry.
//!
//! Authority: M6 precondition v2.0 founder ratification.

use crate::capabilities::{FoundationReadCapability, ChainReadContext};
use crate::envelope::{TransactionRuntimeContext, OperationScopedFields};
use crate::proposed::ProposedTransitionEnvelope;
use crate::verdict::*;
use crate::substrate_authority;
use crate::operations::refusal::RefusalEvaluation;
use crate::operations::authority::AuthorityAndCommitEvaluation;
use crate::operations::governance::GovernanceEvaluation;
use crate::operations::cascade::CascadeIntegrityEvaluation;
use limen_types::*;

/// Execute the v1.3 §1.3 dispatch loop.
/// Static-type dispatch: four hardcoded operations in fixed order.
/// `pub(crate)` — only callable within `limen_foundation_contract`.
///
/// v1.3 §1.3 verbatim: "Order is: Refusal → Authority → Governance → Cascade.
/// Order is fixed (not configurable) so that early refusal short-circuits
/// later evaluation, and authority evaluation produces the commit path
/// that subsequent operations need."
///
/// Composition: "A proposed transition is committed if and only if all four
/// verdict-producing operations return non-blocking verdicts."
pub(crate) fn execute_dispatch_loop<'ctx, 'tx>(
    tx_ctx: &'tx TransactionRuntimeContext,
    cap: &FoundationReadCapability<'ctx>,
    proposed: &ProposedTransitionEnvelope,
    clock: SubstrateInstant,
    execution_context: ExecutionContext,
    freshness: FreshnessMarker,
    invocation_base: &mut u64,
) -> CommitDecision {
    // --- Operation 1: Refusal (Property 3) ---
    *invocation_base += 1;
    let refusal_fields = OperationScopedFields {
        substrate_clock: clock,
        invocation_identity: InvocationId(*invocation_base),
        operation_type: OperationType::Refusal,
        execution_context,
        chain_read_freshness: freshness,
    };
    let refusal = substrate_authority::dispatch_operation::<RefusalEvaluation>(
        tx_ctx, cap, proposed, refusal_fields,
    );
    if let RefusalVerdict::Refuse(r) = refusal {
        return CommitDecision::Refused(r);
    }

    // --- Operation 2: Authority + Commit Path (Property 5 + 2) ---
    *invocation_base += 1;
    let auth_fields = OperationScopedFields {
        substrate_clock: clock,
        invocation_identity: InvocationId(*invocation_base),
        operation_type: OperationType::Authority,
        execution_context,
        chain_read_freshness: freshness,
    };
    let authority = substrate_authority::dispatch_operation::<AuthorityAndCommitEvaluation>(
        tx_ctx, cap, proposed, auth_fields,
    );
    let commit_path = match authority {
        AuthorityVerdict::Authorized => CommitPath::Default,
        AuthorityVerdict::RouteVia(p) => p,
        AuthorityVerdict::Unauthorized(r) => return CommitDecision::Refused(r.into()),
    };

    // --- Operation 3: Governance (Property 6) ---
    *invocation_base += 1;
    let gov_fields = OperationScopedFields {
        substrate_clock: clock,
        invocation_identity: InvocationId(*invocation_base),
        operation_type: OperationType::Governance,
        execution_context,
        chain_read_freshness: freshness,
    };
    let governance = substrate_authority::dispatch_operation::<GovernanceEvaluation>(
        tx_ctx, cap, proposed, gov_fields,
    );
    if let GovernanceVerdict::Blocked(_, r) = governance {
        return CommitDecision::Refused(r.into());
    }

    // --- Operation 4: Cascade Integrity (Property 8) ---
    *invocation_base += 1;
    let cascade_fields = OperationScopedFields {
        substrate_clock: clock,
        invocation_identity: InvocationId(*invocation_base),
        operation_type: OperationType::Cascade,
        execution_context,
        chain_read_freshness: freshness,
    };
    let cascade = substrate_authority::dispatch_operation::<CascadeIntegrityEvaluation>(
        tx_ctx, cap, proposed, cascade_fields,
    );
    if let CascadeVerdict::Broken(l) = cascade {
        return CommitDecision::Refused(l.into());
    }

    // All four non-blocking → Commit
    CommitDecision::Commit { path: commit_path }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capabilities::ChainReadContext;
    use crate::chain::*;

    struct TestReader;
    impl ChainReadContext for TestReader {
        fn read_entry(&self, _: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> { Ok(None) }
        fn read_tenant_state(&self, _: &TenantScope) -> Result<TenantChainState, ChainReadError> {
            Ok(TenantChainState { tenant_scope: TenantScope("t".into()), next_tenant_sequence: ChainSequence(0), last_hash: None })
        }
        fn read_governance_state_at(&self, _: &TenantScope, _: &PolicyId) -> Result<Option<GovernanceState>, ChainReadError> { Ok(None) }
        fn read_authority_state_at(&self, _: &TenantScope, _: &Actor) -> Result<Vec<AuthorityState>, ChainReadError> { Ok(vec![]) }
        fn read_cascade_link(&self, _: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> { Ok(None) }
        fn freshness_marker(&self) -> FreshnessMarker { FreshnessMarker { local_sequence: ChainSequence(0) } }
    }

    /// F-001 fix: dispatch-level test proving per-operation OperationScopedFields independence.
    /// The invocation_base counter must advance by exactly 4 (one per operation).
    /// Each operation receives a DIFFERENT InvocationId because the loop increments the counter.
    #[test]
    fn test_dispatch_per_operation_field_independence() {
        let reader = TestReader;
        let cap = crate::substrate_authority::mint_capability(&reader, TenantScope("t".into()));
        let tx_ctx = crate::substrate_authority::mint_transaction_context(
            RequestBoundary(1), ActorIdentity("actor".into()),
            TenantScope("t".into()), TraceIdentity(1),
        );
        let proposed = ProposedTransitionEnvelope::new(
            crate::proposed::ProposedTransition { payload: b"test".to_vec(), transition_type: "test".into() },
            ProposerIdentity("actor".into()), ProposerTimestamp(1000),
            RequestedTenantScope("t".into()), SchemaVersion(1),
        );
        let freshness = cap.freshness_marker();

        let mut invocation_counter: u64 = 100; // start at 100 to make increment visible
        let _decision = execute_dispatch_loop(
            &tx_ctx, &cap, &proposed,
            SubstrateInstant(1000), ExecutionContext::Profile1, freshness,
            &mut invocation_counter,
        );

        // Four operations → counter must have advanced by exactly 4
        assert_eq!(invocation_counter, 104,
            "invocation counter must advance by 4 (one per operation). \
             Got {}. If all 4 share the same InvocationId, the counter \
             was not incremented per operation.", invocation_counter);
    }
}

/// Execute a substrate commit transaction.
///
/// Public entry point. Accepts data inputs only. Returns `CommitDecision` only.
/// No callbacks, closures, operation parameters, or dispatcher trait objects.
///
/// Internally: mints capability + context, dispatches four operations in
/// v1.3 fixed order, composes verdict, returns result. All authority
/// exercised inside this function via `pub(crate)` same-crate paths.
/// Capability and context drop at function exit — cannot escape.
pub fn run_commit_transaction(
    reader: &dyn ChainReadContext,
    tenant_scope: TenantScope,
    request_boundary: RequestBoundary,
    actor_identity: ActorIdentity,
    trace_identity: TraceIdentity,
    proposed: &ProposedTransitionEnvelope,
    clock: SubstrateInstant,
    execution_context: ExecutionContext,
    mut invocation_base: u64,
) -> CommitDecision {
    let cap = substrate_authority::mint_capability(reader, tenant_scope.clone());
    let tx_ctx = substrate_authority::mint_transaction_context(
        request_boundary, actor_identity, tenant_scope, trace_identity,
    );
    let freshness = cap.freshness_marker();

    execute_dispatch_loop(
        &tx_ctx, &cap, proposed,
        clock, execution_context, freshness,
        &mut invocation_base,
    )
    // cap and tx_ctx drop here — cannot escape
}
