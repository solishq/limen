// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! FoundationOperation trait — the three-input-class signature (v1.3 §1.1).

use limen_types::OperationType;
use crate::capabilities::FoundationReadCapability;
use crate::envelope::SubstrateRuntimeEnvelope;
use crate::proposed::ProposedTransitionEnvelope;

/// The foundation operation trait. Every foundation operation has the same
/// three-input-class signature, structurally enforced by the type system.
///
/// No fourth parameter. No out-of-band channel. No global state read.
/// Module isolation (v1.3 §0.4) prevents foundation operation crates from
/// importing projection or AI modules even at the implementation-body level.
///
/// The trait is NOT sealed at the trait level (v1.3 §0.3). Sealing is at
/// operation REGISTRATION in `limen_substrate_runtime::FoundationOpsRegistry`.
pub trait FoundationOperation {
    type Verdict;
    const TYPE: OperationType;

    fn evaluate<'ctx, 'tx>(
        chain_read: &FoundationReadCapability<'ctx>,
        runtime: &SubstrateRuntimeEnvelope<'tx>,
        proposed: &ProposedTransitionEnvelope,
    ) -> Self::Verdict;
}
