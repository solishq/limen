// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! GovernanceEvaluation — Property 6: Governance before commit (v1.3 §1.2).
//!
//! Structural contract: evaluates whether governance constraints permit
//! the proposed transition, using chain-sourced governance state.
//!
//! M5 scope: structural shell. Chain governance state is not yet populated
//! (M3 ChainReadContext returns None). When governance entries exist in the
//! chain (future milestone), this operation will read and evaluate them.
//! For M5, returns Permitted (no constraints to violate in empty chain).

use limen_types::OperationType;
use crate::capabilities::FoundationReadCapability;
use crate::envelope::SubstrateRuntimeEnvelope;
use crate::proposed::ProposedTransitionEnvelope;
use crate::operation::FoundationOperation;
use crate::verdict::GovernanceVerdict;

/// Governance evaluation (Property 6).
pub struct GovernanceEvaluation;

impl FoundationOperation for GovernanceEvaluation {
    type Verdict = GovernanceVerdict;
    const TYPE: OperationType = OperationType::Governance;

    fn evaluate<'ctx, 'tx>(
        _chain_read: &FoundationReadCapability<'ctx>,  // Required by trait; unused in M5 structural shell (v1.3 §1.1)
        _runtime: &SubstrateRuntimeEnvelope<'tx>,       // Required by trait; unused in M5 structural shell
        _proposed: &ProposedTransitionEnvelope,
    ) -> Self::Verdict {
        // M5 structural contract: no governance state exists in chain yet.
        // Returns Permitted because an empty chain has no constraints to violate.
        // NOT "governance is disabled" — governance entries will be evaluated
        // when populated (future milestone with concrete governance rules).
        GovernanceVerdict::Permitted
    }
}
