// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Verdict types for foundation operations (v1.3 §1.2).

use serde::{Serialize, Deserialize};
use limen_types::PolicyId;

/// Refusal verdict — Property 3.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefusalVerdict {
    Accept,
    Refuse(RefusalReason),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RefusalReason {
    pub category: RefusalCategory,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefusalCategory {
    Evidence,
    Authority,
    Governance,
    Freshness,
    Typing,
    OperationalIntegrity,
}

/// Authority verdict — Property 5 + Property 2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthorityVerdict {
    Authorized,
    Unauthorized(AuthorizationFailure),
    RouteVia(CommitPath),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorizationFailure {
    pub reason: String,
}

/// Commit path designator from authority evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommitPath {
    Default,
    Named(String),
}

/// Governance verdict — Property 6.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GovernanceVerdict {
    Permitted,
    Blocked(PolicyId, GovernanceBlockReason),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GovernanceBlockReason {
    pub reason: String,
}

/// Cascade verdict — Property 8.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CascadeVerdict {
    Intact,
    Broken(CascadeBreak),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CascadeBreak {
    pub missing_link: String,
}

/// Combined verdict set for all four foundation operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerdictSet {
    pub refusal: RefusalVerdict,
    pub authority: AuthorityVerdict,
    pub governance: GovernanceVerdict,
    pub cascade: CascadeVerdict,
}

/// Commit decision — the output of `commit_decision` (v1.3 §1.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitDecision {
    Commit { path: CommitPath },
    Refused(RefusalReason),
}

impl From<AuthorizationFailure> for RefusalReason {
    fn from(f: AuthorizationFailure) -> Self {
        RefusalReason { category: RefusalCategory::Authority, detail: f.reason }
    }
}

impl From<GovernanceBlockReason> for RefusalReason {
    fn from(r: GovernanceBlockReason) -> Self {
        RefusalReason { category: RefusalCategory::Governance, detail: r.reason }
    }
}

impl From<CascadeBreak> for RefusalReason {
    fn from(b: CascadeBreak) -> Self {
        RefusalReason { category: RefusalCategory::OperationalIntegrity, detail: b.missing_link }
    }
}
