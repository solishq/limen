// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
#![forbid(unsafe_code)]
//! # limen_foundation_contract
//!
//! The foundation contract for Limen v5. Owns all types, mint authority,
//! and foundation operations. Depends only on `limen_types` (v1.3 §0.2).
//!
//! M5.1 amendment: operations co-located from limen_foundation_ops for
//! structural same-crate authority enforcement.

pub mod capabilities;
pub mod chain;
pub mod envelope;
pub mod lifecycle;
pub mod operation;
pub mod operations;
pub mod proposed;
pub mod verdict;
pub(crate) mod substrate_authority;
pub mod dispatch;
