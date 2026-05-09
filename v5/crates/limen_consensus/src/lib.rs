// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! Limen v5 Profile 3: Consensus-replicated chain storage.
//!
//! Implements `ChainReadContext` from `limen_foundation_contract` for
//! multi-node Raft-based chain replication.
//!
//! ## Feature Flags
//!
//! - `consensus`: Enables `ConsensusChainStorage` struct and its
//!   `ChainReadContext` implementation. All methods are `todo!()` stubs
//!   at this stage. This feature is NOT in `default` -- the stubs are
//!   never linked into production binaries unless explicitly opted in.
//!
//! - `openraft`: Enables the concrete openraft dependency. Without this,
//!   only error types and the consensus storage stub exist.

#![forbid(unsafe_code)]

pub mod error;

#[cfg(feature = "consensus")]
pub mod consensus_storage;
