//! ProposedTransitionEnvelope and related types (v1.3 §4.1).

use std::marker::PhantomData;
use serde::{Serialize, Deserialize};
use limen_types::*;

/// The proposed transition envelope — third input class (v1.3 §4.1).
/// Serializable for chain entry persistence (refusals preserve the proposal).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposedTransitionEnvelope {
    pub transition: ProposedTransition,
    pub external_witnesses: Vec<ExternalWitness>,
    pub proposer_identity: ProposerIdentity,
    pub proposed_at: ProposerTimestamp,
    pub requested_tenant_scope: RequestedTenantScope,
    pub schema_version: SchemaVersion,
    #[serde(skip)]
    _seal: PhantomData<*const ()>,
}

impl ProposedTransitionEnvelope {
    pub fn new(
        transition: ProposedTransition,
        proposer_identity: ProposerIdentity,
        proposed_at: ProposerTimestamp,
        requested_tenant_scope: RequestedTenantScope,
        schema_version: SchemaVersion,
    ) -> Self {
        Self {
            transition, external_witnesses: Vec::new(), proposer_identity,
            proposed_at, requested_tenant_scope, schema_version, _seal: PhantomData,
        }
    }

    pub fn with_witness(mut self, witness: ExternalWitness) -> Self {
        self.external_witnesses.push(witness);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposedTransition {
    pub payload: Vec<u8>,
    pub transition_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalWitness {
    pub source: ExternalWitnessSource,
    pub content: WitnessContent,
    pub received_at: SubstrateInstant,
    pub source_attested_at: Option<ProposerTimestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExternalWitnessSource {
    Human,
    Llm { provider: String, model_id: String },
    ThirdParty { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WitnessContent(pub Vec<u8>);
