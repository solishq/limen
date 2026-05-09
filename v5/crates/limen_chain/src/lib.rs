// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! # limen_chain
//!
//! SQLite-backed chain storage and commit path for Limen v5.
//! Implements `ChainReadContext` trait from `limen_foundation_contract`.
//!
//! Type ownership: chain domain types (`ChainEntry`, `CommittedEntry`, etc.)
//! live in `limen_foundation_contract` per v1.3 §0.7. This crate defines only
//! storage representation: SQLite schema, `SqliteTransactionReadContext<'tx>`,
//! `SqliteChainStorage`, and storage-layer helpers.
//!
//! MUST NOT depend on: limen_projection, limen_foundation_ops (v1.3 §0.2).

pub mod schema;
pub mod storage;
pub mod read_context;
pub mod commit;
pub mod verify;
mod canonical_temp;
