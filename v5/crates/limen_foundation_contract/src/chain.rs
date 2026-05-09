// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Chain entry types owned by the foundation contract (v1.3 §6.1, §0.7).
//! Storage representation lives in `limen_chain`; type definitions live here.

use serde::{Serialize, Deserialize};
use limen_types::*;
use crate::envelope::CommitEnvelope;
use crate::proposed::ProposedTransitionEnvelope;
use crate::verdict::{CommitPath, RefusalVerdict, VerdictSet};

/// The chain entry — committed or refused. Both are hash-chained, both
/// advance the chain sequence (v1.3 §6.1).
#[derive(Debug, Clone)]
pub enum ChainEntry {
    Committed(CommittedEntry),
    Refusal(RefusalEntry),
}

impl ChainEntry {
    pub fn global_sequence(&self) -> ChainSequence {
        match self {
            Self::Committed(e) => e.global_sequence,
            Self::Refusal(e) => e.global_sequence,
        }
    }

    pub fn tenant_sequence(&self) -> ChainSequence {
        match self {
            Self::Committed(e) => e.tenant_sequence,
            Self::Refusal(e) => e.tenant_sequence,
        }
    }

    pub fn content_hash(&self) -> Blake3Hash {
        match self {
            Self::Committed(e) => e.content_hash,
            Self::Refusal(e) => e.content_hash,
        }
    }

    pub fn previous_hash(&self) -> Option<Blake3Hash> {
        match self {
            Self::Committed(e) => e.previous_hash,
            Self::Refusal(e) => e.previous_hash,
        }
    }

    pub fn tenant_scope(&self) -> &TenantScope {
        match self {
            Self::Committed(e) => &e.tenant_scope,
            Self::Refusal(e) => &e.tenant_scope,
        }
    }

    pub fn entry_kind(&self) -> &str {
        match self {
            Self::Committed(_) => "Committed",
            Self::Refusal(_) => "Refusal",
        }
    }
}

/// Committed transition chain record (v1.3 §6.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommittedEntry {
    pub global_sequence: ChainSequence,
    pub tenant_sequence: ChainSequence,
    pub content_hash: Blake3Hash,
    pub previous_hash: Option<Blake3Hash>,
    pub tenant_scope: TenantScope,
    pub canonical_at: SubstrateInstant,
    pub transition: CommittedTransition,
    pub commit_envelope: CommitEnvelope,
}

/// Refused transition chain record (v1.3 §6.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefusalEntry {
    pub global_sequence: ChainSequence,
    pub tenant_sequence: ChainSequence,
    pub content_hash: Blake3Hash,
    pub previous_hash: Option<Blake3Hash>,
    pub tenant_scope: TenantScope,
    pub refused_at: SubstrateInstant,
    pub proposed: ProposedTransitionEnvelope,
    pub refusal_verdict: RefusalVerdict,
    pub governing_evidence: GoverningEvidence,
    pub refusal_envelope: CommitEnvelope,
}

/// The canonical transition payload of a CommittedEntry (v1.3 §6.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommittedTransition {
    pub proposed: ProposedTransitionEnvelope,
    pub verdicts: VerdictSet,
    pub commit_path: CommitPath,
    pub canonical_at: SubstrateInstant,
}

/// Governance/authority/cascade state at refusal time (v1.3 §6.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoverningEvidence {
    pub chain_state_at_evaluation: ChainStateSnapshot,
    pub governance_policy_id: Option<PolicyId>,
    pub authority_state: AuthorityStateSnapshot,
    pub cascade_check: CascadeCheckResult,
}

/// Snapshot of chain state at evaluation time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStateSnapshot {
    pub sequence: ChainSequence,
    pub head_hash: Blake3Hash,
}

/// Snapshot of authority state for governing evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityStateSnapshot {
    pub actor: Actor,
    pub authorities: Vec<AuthorityState>,
}

/// Per-policy governance state read by foundation operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceState {
    pub policy_id: PolicyId,
    pub active: bool,
    pub rules: Vec<String>,
}

/// Per-actor authority state read by foundation operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityState {
    pub actor: Actor,
    pub authority_class: String,
    pub granted: bool,
}

/// Cascade link between chain entries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeLink {
    pub source_hash: Blake3Hash,
    pub target_hash: Blake3Hash,
    pub relationship: String,
}

/// Result of cascade integrity check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CascadeCheckResult {
    Intact,
    Broken { missing: String },
}

/// Per-tenant chain head state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantChainState {
    pub tenant_scope: TenantScope,
    pub next_tenant_sequence: ChainSequence,
    pub last_hash: Option<Blake3Hash>,
}

/// Errors from chain read operations.
#[derive(Debug, Clone)]
pub enum ChainReadError {
    NotFound,
    StorageError(String),
    IntegrityViolation(String),
}

/// Errors from projection read operations.
#[derive(Debug, Clone)]
pub enum ProjectionReadError {
    Unavailable(String),
    StorageError(String),
}
