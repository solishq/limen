//! RefusalEvaluation — Property 3: Refusal at commit (v1.3 §1.2).
//!
//! Structural contract: evaluates whether a proposed transition should be
//! refused based on evidence, authority, governance, freshness, typing, or
//! operational integrity defects detectable from chain state.
//!
//! M5 scope: structural contract behavior. No invented domain policy.

use limen_types::OperationType;
use crate::capabilities::FoundationReadCapability;
use crate::envelope::SubstrateRuntimeEnvelope;
use crate::proposed::ProposedTransitionEnvelope;
use crate::operation::FoundationOperation;
use crate::verdict::{RefusalVerdict, RefusalReason, RefusalCategory};

/// Refusal evaluation operation (Property 3).
pub struct RefusalEvaluation;

impl FoundationOperation for RefusalEvaluation {
    type Verdict = RefusalVerdict;
    const TYPE: OperationType = OperationType::Refusal;

    fn evaluate<'ctx, 'tx>(
        chain_read: &FoundationReadCapability<'ctx>,
        _runtime: &SubstrateRuntimeEnvelope<'tx>,
        proposed: &ProposedTransitionEnvelope,
    ) -> Self::Verdict {
        // Structural contract: verify the proposed transition has non-empty payload.
        // This is a structural validity check, not domain policy.
        if proposed.transition.payload.is_empty() {
            return RefusalVerdict::Refuse(RefusalReason {
                category: RefusalCategory::Evidence,
                detail: "proposed transition has empty payload".into(),
            });
        }

        // Structural contract: verify chain state is readable (freshness check).
        // Read tenant state through the capability — proves chain is accessible.
        let _tenant_state = match chain_read.read_tenant_state() {
            Ok(state) => state,
            Err(_) => {
                return RefusalVerdict::Refuse(RefusalReason {
                    category: RefusalCategory::OperationalIntegrity,
                    detail: "chain state unreadable during refusal evaluation".into(),
                });
            }
        };

        // Structural contract: no domain-specific refusal rules.
        // Accept if structural checks pass.
        RefusalVerdict::Accept
    }
}
