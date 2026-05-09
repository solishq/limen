// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
#![forbid(unsafe_code)]
//! # limen_types
//!
//! Shared primitive types for the Limen v5 substrate.
//! Every type here is referenced by `limen_foundation_contract` and potentially
//! by other crates. This crate has no substrate-specific dependencies.
//! Authoritative type ownership per Document 27 v1.3 Section 0.7.

use serde::{Deserialize, Serialize};

/// 32-byte BLAKE3 cryptographic hash output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct Blake3Hash(pub [u8; 32]);

/// Monotonic sequence integer for chain ordering.
/// Used for both `global_sequence` and `tenant_sequence`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ChainSequence(pub u64);

impl ChainSequence {
    pub fn genesis() -> Self {
        Self(0)
    }

    pub fn next(self) -> Self {
        Self(self.0 + 1)
    }
}

/// Tenant identifier. Structurally enforced per Property 5.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct TenantScope(pub String);

/// Proposer's claimed tenant target. Request, not authority.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RequestedTenantScope(pub String);

/// Substrate-issued monotonic clock value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct SubstrateInstant(pub u64);

/// Proposer's claimed time. Treated as claim, not fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProposerTimestamp(pub u64);

/// Identifier for actors in authority and proposer contexts.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct Actor(pub String);

/// Governance policy identifier.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
pub struct PolicyId(pub String);

/// Unique per foundation operation invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct InvocationId(pub u64);

/// Schema version integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SchemaVersion(pub u32);

/// Authenticated proposer identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProposerIdentity(pub String);

/// Authenticated principal.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ActorIdentity(pub String);

/// Request entry-point identifier.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RequestBoundary(pub u64);

/// Observability correlation identifier.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TraceIdentity(pub u64);

/// Foundation operation type discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OperationType {
    Refusal,
    Authority,
    Governance,
    Cascade,
}

/// Deployment profile discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExecutionContext {
    Profile1,
    Profile2,
    Profile3,
    Profile4b,
    Profile5PerTenant,
}

/// Substrate-attested freshness marker.
/// At Profile 1/2: local sequence. At Profile 3+: includes consensus read-index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FreshnessMarker {
    pub local_sequence: ChainSequence,
    // Profile 3+ will add: pub read_index: Option<ReadIndex>,
}
