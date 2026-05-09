// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! CascadeIntegrityEvaluation — Property 8: Provenance and cascade integrity (v1.3 §1.2).
//!
//! Structural contract: evaluates whether provenance and cascade relationships
//! for the proposed transition are intact, using chain-sourced cascade links.
//!
//! M5 scope: structural shell. Chain cascade links are not yet populated
//! (M3 ChainReadContext returns None). When cascade entries exist (future
//! milestone), this operation will traverse chain links and verify integrity.
//! For M5, returns Intact (no relationships to break in empty chain).

use limen_types::OperationType;
use crate::capabilities::FoundationReadCapability;
use crate::envelope::SubstrateRuntimeEnvelope;
use crate::proposed::ProposedTransitionEnvelope;
use crate::operation::FoundationOperation;
use crate::verdict::CascadeVerdict;

/// Cascade integrity evaluation (Property 8).
pub struct CascadeIntegrityEvaluation;

impl FoundationOperation for CascadeIntegrityEvaluation {
    type Verdict = CascadeVerdict;
    const TYPE: OperationType = OperationType::Cascade;

    fn evaluate<'ctx, 'tx>(
        _chain_read: &FoundationReadCapability<'ctx>,  // Required by trait; unused in M5 structural shell (v1.3 §1.1)
        _runtime: &SubstrateRuntimeEnvelope<'tx>,       // Required by trait; unused in M5 structural shell
        _proposed: &ProposedTransitionEnvelope,
    ) -> Self::Verdict {
        // M5 structural contract: no cascade links exist in chain yet.
        // Returns Intact because an empty chain has no relationships to break.
        // NOT "cascade checking is disabled" — cascade links will be traversed
        // when populated (future milestone with concrete cascade rules).
        CascadeVerdict::Intact
    }
}
