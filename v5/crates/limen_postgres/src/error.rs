//! Error types for PostgreSQL storage operations.
//!
//! All errors map to `ChainReadError::StorageError` at the trait boundary,
//! following the same pattern as `limen_consensus::error::ConsensusError`.

use limen_foundation_contract::chain::ChainReadError;

/// Errors from PostgreSQL storage operations.
///
/// Each variant preserves the specific failure context (connection pool
/// exhaustion vs. query error vs. schema mismatch) while mapping uniformly
/// to `ChainReadError::StorageError` at the `ChainReadContext` trait boundary.
#[derive(Debug, thiserror::Error)]
pub enum PostgresStorageError {
    /// Underlying tokio-postgres driver error.
    #[error("postgres error: {0}")]
    Postgres(#[from] tokio_postgres::Error),

    /// Connection pool error (exhaustion, timeout, configuration).
    #[error("pool error: {0}")]
    Pool(String),

    /// Schema creation or migration DDL error.
    #[error("schema error: {0}")]
    Schema(String),

    /// Data migration error (SQLite-to-Postgres transfer).
    #[error("migration error: {0}")]
    Migration(String),

    /// Chain integrity verification failure.
    #[error(
        "chain integrity error: expected hash {expected}, got {actual} at sequence {sequence}"
    )]
    ChainIntegrity {
        sequence: i64,
        expected: String,
        actual: String,
    },

    /// Serialization/deserialization error for JSONB fields.
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Row not found when one was expected.
    #[error("not found: {0}")]
    NotFound(String),

    /// Sequence gap detected during chain verification.
    #[error("sequence gap: expected sequence {expected}, got {actual}")]
    SequenceGap { expected: i64, actual: i64 },
}

/// Maps PostgreSQL storage errors to the `ChainReadContext` trait error type.
///
/// All variants map to `ChainReadError::StorageError` with the Display
/// representation, following the consensus crate's boundary mapping pattern.
impl From<PostgresStorageError> for ChainReadError {
    fn from(err: PostgresStorageError) -> Self {
        ChainReadError::StorageError(err.to_string())
    }
}

impl From<serde_json::Error> for PostgresStorageError {
    fn from(err: serde_json::Error) -> Self {
        PostgresStorageError::Serialization(err.to_string())
    }
}
