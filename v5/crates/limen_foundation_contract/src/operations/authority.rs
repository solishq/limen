//! AuthorityAndCommitEvaluation — Property 5 + Property 2 (v1.3 §1.2).
//!
//! Structural contract: evaluates whether the proposer's claimed authority
//! is sufficient for the proposed transition, using chain-sourced authority state.

use limen_types::OperationType;
use crate::capabilities::FoundationReadCapability;
use crate::envelope::SubstrateRuntimeEnvelope;
use crate::proposed::ProposedTransitionEnvelope;
use crate::operation::FoundationOperation;
use crate::verdict::{AuthorityVerdict, AuthorizationFailure};

/// Authority and commit path evaluation (Property 5 + Property 2).
pub struct AuthorityAndCommitEvaluation;

impl FoundationOperation for AuthorityAndCommitEvaluation {
    type Verdict = AuthorityVerdict;
    const TYPE: OperationType = OperationType::Authority;

    fn evaluate<'ctx, 'tx>(
        chain_read: &FoundationReadCapability<'ctx>,
        runtime: &SubstrateRuntimeEnvelope<'tx>,
        proposed: &ProposedTransitionEnvelope,
    ) -> Self::Verdict {
        // Structural contract: read authority state from chain for the proposer's actor.
        // authority_states read for structural validation; domain-level authority rules
        // will use this in future milestone. M5 verifies the read path works.
        let actor = limen_types::Actor(proposed.proposer_identity.0.clone());
        let _authority_states = match chain_read.read_authority_state(&actor) {
            Ok(states) => states,
            Err(_) => {
                return AuthorityVerdict::Unauthorized(AuthorizationFailure {
                    reason: "authority state unreadable from chain".into(),
                });
            }
        };

        // Structural contract: verify the actor identity in the proposed envelope
        // matches the substrate-resolved actor in the runtime envelope.
        // The runtime envelope's actor is substrate-authenticated (v1.3 §3.2);
        // the proposed envelope's proposer is a claim.
        let authenticated_actor = &runtime.transaction().actor_identity().0;
        let claimed_proposer = &proposed.proposer_identity.0;
        if authenticated_actor != claimed_proposer {
            return AuthorityVerdict::Unauthorized(AuthorizationFailure {
                reason: format!(
                    "proposer identity mismatch: authenticated={}, claimed={}",
                    authenticated_actor, claimed_proposer
                ),
            });
        }

        // Structural contract: no domain-specific authority rules.
        // Default commit path. Product-level authority policies are downstream.
        AuthorityVerdict::Authorized
    }
}
