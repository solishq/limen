// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
#![forbid(unsafe_code)]
//! PostgreSQL storage backends for Limen v5 substrate.
//!
//! This crate provides Profile 2+ PostgreSQL implementations of the chain
//! and projection storage interfaces defined in `limen_foundation_contract`
//! and `limen_chain`/`limen_projection`. It serves as the production-grade
//! alternative to SQLite for deployments requiring:
//!
//! - Connection pooling and concurrent access (deadpool-postgres)
//! - Native JSONB indexing for projection queries
//! - BYTEA storage for cryptographic hashes (no hex encoding overhead)
//! - BIGINT sequences for chains exceeding 2^31 entries
//! - Horizontal read scaling via Postgres replicas
//!
//! ## Crate Structure
//!
//! | Module               | Purpose                                              |
//! |----------------------|------------------------------------------------------|
//! | `error`              | `PostgresStorageError` enum with `thiserror` derives |
//! | `chain_storage`      | `PostgresChainStorage` — chain append/read/verify    |
//! | `projection_storage` | `PostgresProjectionStorage` — 5-table projection     |
//! | `migrate`            | SQLite-to-Postgres migration with integrity verify   |
//!
//! ## Feature Flags
//!
//! - `postgres-tests`: Enables integration tests requiring a live PostgreSQL
//!   instance. Tests are `#[ignore]` by default; enable with
//!   `cargo test -p limen_postgres --features postgres-tests -- --ignored`.

pub mod error;
pub mod chain_storage;
pub mod projection_storage;
pub mod migrate;
