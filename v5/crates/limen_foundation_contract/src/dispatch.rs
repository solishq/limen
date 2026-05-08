//! Substrate dispatch loop and public entry point (M6).
//!
//! v1.3 §1.3 fixed order: Refusal → Authority → Governance → Cascade.
//! Composition rule: committed iff all four return non-blocking verdicts.
//! Static-type dispatch — four hardcoded operations, no runtime registry.
//!
//! P0 amendments:
//!   - Lifecycle guard gating: dispatch requires `Ready` state.
//!   - Audit-before-success fusion: `CommitDecision::Commit` is never returned
//!     without a durable chain entry written via `ChainCommitSink`.
//!   - F-03 fix: actual `VerdictSet` from dispatch loop is threaded through
//!     to the commit sink — no hardcoded `Accept/Authorized/Permitted/Intact`.
//!
//! Authority: M6 precondition v2.0 founder ratification.

use crate::capabilities::{FoundationReadCapability, ChainReadContext};
use crate::chain::ChainEntry;
use crate::envelope::{TransactionRuntimeContext, CommitEnvelope, OperationScopedFields};
use crate::lifecycle::{LifecycleGuard, LifecycleError};
use crate::proposed::ProposedTransitionEnvelope;
use crate::verdict::*;
use crate::substrate_authority;
use crate::operations::refusal::RefusalEvaluation;
use crate::operations::authority::AuthorityAndCommitEvaluation;
use crate::operations::governance::GovernanceEvaluation;
use crate::operations::cascade::CascadeIntegrityEvaluation;
use limen_types::*;

/// Error type for commit transaction failures.
///
/// Unifies lifecycle errors and chain commit sink errors into a single
/// error type returned by the fused `run_commit_transaction`.
#[derive(Debug)]
pub enum CommitTransactionError {
    /// Substrate is not in `Ready` state.
    LifecycleNotReady(LifecycleError),
    /// The chain commit sink failed to persist the entry.
    ChainCommitFailed(String),
}

impl std::fmt::Display for CommitTransactionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LifecycleNotReady(e) => write!(f, "lifecycle: {}", e),
            Self::ChainCommitFailed(e) => write!(f, "chain commit: {}", e),
        }
    }
}

impl From<LifecycleError> for CommitTransactionError {
    fn from(e: LifecycleError) -> Self {
        Self::LifecycleNotReady(e)
    }
}

/// Trait for durable chain entry persistence.
///
/// Defined in `limen_foundation_contract` so the dispatch loop can write
/// chain entries without depending on `limen_chain`. Implemented by
/// `limen_chain::storage::SqliteChainStorage` (or any other backend).
///
/// This trait enables the audit-before-success invariant: `CommitDecision::Commit`
/// is never returned to a caller without the corresponding chain entry
/// already durably written.
pub trait ChainCommitSink {
    /// Persist a chain entry. Returns the written entry on success.
    ///
    /// The implementor MUST ensure durability before returning `Ok`.
    /// The `verdicts` parameter carries the actual `VerdictSet` from the
    /// dispatch loop (F-03 fix: no fabricated verdicts).
    fn commit_entry(
        &self,
        proposed: ProposedTransitionEnvelope,
        decision: CommitDecision,
        verdicts: VerdictSet,
        tenant_scope: TenantScope,
        commit_envelope: CommitEnvelope,
    ) -> Result<ChainEntry, String>;
}

/// Internal dispatch outcome that carries both the decision and the
/// full verdict set from all four operations.
pub(crate) struct DispatchOutcome {
    decision: CommitDecision,
    verdicts: VerdictSet,
}

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
///
/// Returns a `DispatchOutcome` carrying both the `CommitDecision` and the
/// actual `VerdictSet` from the dispatch loop (F-03 fix).
pub(crate) fn execute_dispatch_loop<'ctx, 'tx>(
    tx_ctx: &'tx TransactionRuntimeContext,
    cap: &FoundationReadCapability<'ctx>,
    proposed: &ProposedTransitionEnvelope,
    clock: SubstrateInstant,
    execution_context: ExecutionContext,
    freshness: FreshnessMarker,
    invocation_base: &mut u64,
) -> DispatchOutcome {
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
    if let RefusalVerdict::Refuse(ref r) = refusal {
        return DispatchOutcome {
            decision: CommitDecision::Refused(r.clone()),
            verdicts: VerdictSet {
                refusal: refusal.clone(),
                authority: AuthorityVerdict::Authorized,     // not reached
                governance: GovernanceVerdict::Permitted,     // not reached
                cascade: CascadeVerdict::Intact,              // not reached
            },
        };
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
        AuthorityVerdict::RouteVia(ref p) => p.clone(),
        AuthorityVerdict::Unauthorized(ref r) => {
            return DispatchOutcome {
                decision: CommitDecision::Refused(r.clone().into()),
                verdicts: VerdictSet {
                    refusal: refusal.clone(),
                    authority: authority.clone(),
                    governance: GovernanceVerdict::Permitted,  // not reached
                    cascade: CascadeVerdict::Intact,           // not reached
                },
            };
        }
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
    if let GovernanceVerdict::Blocked(_, ref r) = governance {
        return DispatchOutcome {
            decision: CommitDecision::Refused(r.clone().into()),
            verdicts: VerdictSet {
                refusal: refusal.clone(),
                authority: authority.clone(),
                governance: governance.clone(),
                cascade: CascadeVerdict::Intact,               // not reached
            },
        };
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
    if let CascadeVerdict::Broken(ref l) = cascade {
        return DispatchOutcome {
            decision: CommitDecision::Refused(l.clone().into()),
            verdicts: VerdictSet {
                refusal,
                authority,
                governance,
                cascade,
            },
        };
    }

    // All four non-blocking → Commit with actual verdicts
    DispatchOutcome {
        decision: CommitDecision::Commit { path: commit_path },
        verdicts: VerdictSet {
            refusal,
            authority,
            governance,
            cascade,
        },
    }
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
        let _outcome = execute_dispatch_loop(
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

    /// F-03 fix: verify that dispatch loop returns actual verdicts, not fabricated ones.
    #[test]
    fn test_dispatch_returns_actual_verdict_set() {
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

        let mut base: u64 = 0;
        let outcome = execute_dispatch_loop(
            &tx_ctx, &cap, &proposed,
            SubstrateInstant(1000), ExecutionContext::Profile1, freshness,
            &mut base,
        );

        // Verify the verdicts are the actual results from the operations
        assert_eq!(outcome.verdicts.refusal, RefusalVerdict::Accept);
        assert_eq!(outcome.verdicts.authority, AuthorityVerdict::Authorized);
        assert_eq!(outcome.verdicts.governance, GovernanceVerdict::Permitted);
        assert_eq!(outcome.verdicts.cascade, CascadeVerdict::Intact);
        assert!(matches!(outcome.decision, CommitDecision::Commit { .. }));
    }
}

/// Execute a substrate commit transaction with lifecycle gating and
/// mandatory audit-before-success fusion.
///
/// Public entry point. Checks lifecycle state before dispatch.
/// The `commit_sink` is **mandatory** (NF-01 fix): every `Commit` decision
/// produces a durable chain entry BEFORE the caller sees the decision.
/// There is no code path where `CommitDecision::Commit` can be returned
/// without a persisted chain entry.
///
/// The `VerdictSet` threaded to the commit sink is the actual set from
/// the dispatch loop (F-03 fix: no fabricated verdicts).
///
/// Returns `Err` if:
///   - The lifecycle guard is not in `Ready` state
///   - The chain commit sink fails to persist the entry
pub fn run_commit_transaction_gated(
    lifecycle: &LifecycleGuard,
    reader: &dyn ChainReadContext,
    commit_sink: &dyn ChainCommitSink,
    tenant_scope: TenantScope,
    request_boundary: RequestBoundary,
    actor_identity: ActorIdentity,
    trace_identity: TraceIdentity,
    proposed: &ProposedTransitionEnvelope,
    clock: SubstrateInstant,
    execution_context: ExecutionContext,
    mut invocation_base: u64,
) -> Result<CommitDecision, CommitTransactionError> {
    // P0-1: Lifecycle guard — reject if not Ready
    lifecycle.require_ready()?;

    let cap = substrate_authority::mint_capability(reader, tenant_scope.clone());
    let tx_ctx = substrate_authority::mint_transaction_context(
        request_boundary.clone(),
        actor_identity.clone(),
        tenant_scope.clone(),
        trace_identity.clone(),
    );
    let freshness = cap.freshness_marker();

    let outcome = execute_dispatch_loop(
        &tx_ctx, &cap, proposed,
        clock, execution_context, freshness,
        &mut invocation_base,
    );

    // P0-2: Audit-before-success fusion (NF-01: commit_sink is mandatory)
    // If decision is Commit, write the chain entry INSIDE this function.
    // The caller never sees Commit without a durable entry.
    if let CommitDecision::Commit { .. } = &outcome.decision {
        let commit_envelope = CommitEnvelope {
            request_boundary,
            actor_identity,
            tenant_scope: tenant_scope.clone(),
            trace_identity,
            committed_at: clock,
        };
        commit_sink.commit_entry(
            proposed.clone(),
            outcome.decision.clone(),
            outcome.verdicts,
            tenant_scope,
            commit_envelope,
        ).map_err(CommitTransactionError::ChainCommitFailed)?;
    }

    Ok(outcome.decision)
    // cap and tx_ctx drop here — cannot escape
}

/// Execute a substrate commit transaction (legacy entry point).
///
/// **DEPRECATED (NF-02)**: Does NOT enforce lifecycle gating or
/// audit-before-success fusion. Use `run_commit_transaction_gated` instead.
/// Restricted to `pub(crate)` — external crates cannot call this function.
#[deprecated(note = "NF-02: use run_commit_transaction_gated with lifecycle + commit_sink")]
#[allow(dead_code)] // Retained as deprecated reference — will be removed in v5.1
pub(crate) fn run_commit_transaction(
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

    let outcome = execute_dispatch_loop(
        &tx_ctx, &cap, proposed,
        clock, execution_context, freshness,
        &mut invocation_base,
    );
    outcome.decision
    // cap and tx_ctx drop here — cannot escape
}
