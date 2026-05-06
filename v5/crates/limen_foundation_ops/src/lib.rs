#![forbid(unsafe_code)]
//! # limen_foundation_ops — Re-export shell (M5.1 amendment)
//!
//! Operations have been co-located into `limen_foundation_contract::operations`
//! per M5.1 amendment (Option E — structural same-crate authority enforcement).
//!
//! This crate re-exports for backward compatibility with existing test imports.

pub mod refusal {
    pub use limen_foundation_contract::operations::refusal::RefusalEvaluation;
}
pub mod authority {
    pub use limen_foundation_contract::operations::authority::AuthorityAndCommitEvaluation;
}
pub mod governance {
    pub use limen_foundation_contract::operations::governance::GovernanceEvaluation;
}
pub mod cascade {
    pub use limen_foundation_contract::operations::cascade::CascadeIntegrityEvaluation;
}
