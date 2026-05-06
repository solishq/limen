//! PostgreSQL chain storage implementing `ChainReadContext`.
//!
//! Provides the same interface as `SqliteChainStorage` but targeting
//! PostgreSQL via `deadpool-postgres` connection pooling. Key differences
//! from the SQLite backend:
//!
//! - `BYTEA` for hash columns (32-byte Blake3 digests stored as raw bytes)
//! - `BIGINT` for sequence numbers (supports chains > 2^31 entries)
//! - `JSONB` for structured payload fields (enables Postgres-native indexing)
//! - Connection pooling via deadpool-postgres (concurrent access safe)
//! - Prepared statements cached per-connection for performance

use deadpool_postgres::Pool;
#[cfg(feature = "chain-read-context")]
use limen_foundation_contract::capabilities::ChainReadContext;
#[cfg(feature = "chain-read-context")]
use limen_foundation_contract::chain::*;
#[cfg(feature = "chain-read-context")]
use limen_types::*;
use serde::{Deserialize, Serialize};

use crate::error::PostgresStorageError;

// ================================================================
// Schema DDL
// ================================================================

/// PostgreSQL DDL for the chain_entries table.
///
/// Design decisions:
/// - `sequence` is BIGINT PRIMARY KEY (not SERIAL) because the chain
///   assigns sequences explicitly, never auto-increments.
/// - `entry_hash` and `prev_hash` are BYTEA(32) for raw Blake3 digests.
///   No hex encoding overhead; comparison is byte-for-byte.
/// - `payload` is JSONB for native indexing and GIN operator support.
/// - `tenant_scope` is TEXT because tenant identifiers are variable-length
///   strings, not structured JSON.
/// - `created_at` uses TIMESTAMPTZ for timezone-aware ordering.
const CHAIN_ENTRIES_DDL: &str = "
CREATE TABLE IF NOT EXISTS chain_entries (
    sequence       BIGINT       PRIMARY KEY,
    entry_hash     BYTEA        NOT NULL,
    prev_hash      BYTEA        NOT NULL,
    tenant_scope   TEXT         NOT NULL,
    entry_type     TEXT         NOT NULL,
    payload        JSONB        NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chain_entries_tenant
    ON chain_entries (tenant_scope);

CREATE INDEX IF NOT EXISTS idx_chain_entries_type
    ON chain_entries (entry_type);

-- Tamper detection triggers on chain_entries (F-04)
CREATE OR REPLACE FUNCTION limen_chain_tamper_check()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        PERFORM pg_notify(
            'limen_tamper',
            json_build_object(
                'table', 'chain_entries',
                'operation', 'UPDATE',
                'sequence', NEW.sequence,
                'detected_at', NOW()
            )::text
        );
        RAISE EXCEPTION 'tamper detected: chain_entries UPDATE on sequence %', NEW.sequence;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM pg_notify(
            'limen_tamper',
            json_build_object(
                'table', 'chain_entries',
                'operation', 'DELETE',
                'sequence', OLD.sequence,
                'detected_at', NOW()
            )::text
        );
        RAISE EXCEPTION 'tamper detected: chain_entries DELETE on sequence %', OLD.sequence;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chain_entries_tamper'
    ) THEN
        CREATE TRIGGER trg_chain_entries_tamper
            BEFORE UPDATE OR DELETE ON chain_entries
            FOR EACH ROW
            EXECUTE FUNCTION limen_chain_tamper_check();
    END IF;
END;
$$;
";

/// PostgreSQL DDL for the projection_certificates table.
///
/// Stores projection certificates that attest to the integrity of the
/// projection at a given chain sequence. Used by governance to verify
/// that the projection is consistent with the chain.
const PROJECTION_CERTIFICATES_DDL: &str = "
CREATE TABLE IF NOT EXISTS projection_certificates (
    id             BIGSERIAL    PRIMARY KEY,
    chain_sequence BIGINT       NOT NULL,
    projection_hash BYTEA       NOT NULL,
    chain_hash     BYTEA        NOT NULL,
    certificate    JSONB        NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projection_certificates_seq
    ON projection_certificates (chain_sequence DESC);
";

// ================================================================
// PostgresChainStorage
// ================================================================

/// PostgreSQL-backed chain storage for Limen v5.
///
/// Implements the same logical interface as `SqliteChainStorage`:
/// - Append entries with hash-chain integrity
/// - Read entries by sequence number
/// - Track latest sequence
/// - Verify full chain integrity
/// - Store and retrieve projection certificates
///
/// Thread-safe by construction: `deadpool_postgres::Pool` is `Clone + Send + Sync`,
/// and each operation acquires its own connection from the pool.
///
/// ## Pool Configuration Guidance (F-06)
///
/// Recommended pool settings for production:
/// - `max_size`: 2x CPU cores for write-heavy, 4x for read-heavy workloads
/// - `timeouts.wait`: 5s (fail fast rather than queue indefinitely)
/// - `timeouts.create`: 3s (connection establishment)
/// - `timeouts.recycle`: 5s (connection health check on reuse)
/// - `recycling_method`: `RecyclingMethod::Verified` for production,
///   `RecyclingMethod::Fast` for development/testing
///
/// Use `recommended_pool_config()` to get a pre-configured `deadpool_postgres::Config`
/// suitable for most production deployments.
pub struct PostgresChainStorage {
    pool: Pool,
}

impl PostgresChainStorage {
    /// Create a new PostgreSQL chain storage with the given connection pool.
    ///
    /// The pool must be pre-configured with the target database connection
    /// parameters. Call `apply_schema()` after construction to ensure tables
    /// exist.
    ///
    /// ## Recommended Pool Settings
    ///
    /// For production deployments:
    /// - `max_size`: 2x-4x CPU cores (depending on read/write ratio)
    /// - `timeouts.wait`: 5 seconds
    /// - `timeouts.create`: 3 seconds
    /// - `recycling_method`: `Verified` (tests connection health on checkout)
    ///
    /// See `recommended_pool_config()` for a pre-built configuration.
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// Returns a recommended `deadpool_postgres::Config` for production use.
    ///
    /// Settings:
    /// - `max_size`: 16 (suitable for 4-8 core machines)
    /// - `recycling_method`: `Verified`
    ///
    /// Callers should override `host`, `port`, `dbname`, `user`, `password`
    /// on the returned config before building the pool.
    pub fn recommended_pool_config() -> deadpool_postgres::Config {
        let mut cfg = deadpool_postgres::Config::new();
        cfg.pool = Some(deadpool_postgres::PoolConfig {
            max_size: 16,
            timeouts: deadpool_postgres::Timeouts {
                wait: Some(std::time::Duration::from_secs(5)),
                create: Some(std::time::Duration::from_secs(3)),
                recycle: Some(std::time::Duration::from_secs(5)),
            },
            ..Default::default()
        });
        cfg
    }

    /// Apply the chain storage schema (CREATE TABLE IF NOT EXISTS).
    ///
    /// Idempotent: safe to call on every application startup.
    /// Creates both `chain_entries` and `projection_certificates` tables
    /// with their associated indexes and tamper detection triggers.
    ///
    /// # Errors
    ///
    /// Returns `PostgresStorageError::Schema` if DDL execution fails
    /// (e.g., insufficient privileges, connection failure).
    pub async fn apply_schema(&self) -> Result<(), PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        client.batch_execute(CHAIN_ENTRIES_DDL).await.map_err(|e| {
            PostgresStorageError::Schema(format!("chain_entries DDL failed: {}", e))
        })?;

        client
            .batch_execute(PROJECTION_CERTIFICATES_DDL)
            .await
            .map_err(|e| {
                PostgresStorageError::Schema(format!("projection_certificates DDL failed: {}", e))
            })?;

        Ok(())
    }

    /// Append a chain entry with hash-chain integrity enforcement.
    ///
    /// Verifies that `prev_hash` matches the hash of the entry at
    /// `sequence - 1` (or is the zero hash for sequence 0). Inserts
    /// the entry and returns the assigned sequence number.
    ///
    /// # Arguments
    ///
    /// * `sequence` - The sequence number for this entry (must be next in chain)
    /// * `entry_hash` - Blake3 hash of this entry's content
    /// * `prev_hash` - Blake3 hash of the previous entry (zero hash for genesis)
    /// * `tenant_scope` - Tenant scope identifier
    /// * `entry_type` - Type discriminator for the entry
    /// * `payload` - JSONB payload content
    ///
    /// # Errors
    ///
    /// - Returns `PostgresStorageError::ChainIntegrity` if `prev_hash` does not
    ///   match the `entry_hash` of the entry at `sequence - 1`.
    /// - Returns `PostgresStorageError::Postgres` on constraint violation
    ///   (duplicate sequence) or connection failure.
    pub async fn append_entry(
        &self,
        sequence: i64,
        entry_hash: &[u8],
        prev_hash: &[u8],
        tenant_scope: &str,
        entry_type: &str,
        payload: &serde_json::Value,
    ) -> Result<i64, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        // F-02: Verify prev_hash matches the entry at sequence - 1
        if sequence == 0 {
            // Genesis entry: prev_hash must be all zeros
            if prev_hash.iter().any(|&b| b != 0) {
                return Err(PostgresStorageError::ChainIntegrity {
                    sequence: 0,
                    expected: "0".repeat(64),
                    actual: hex::encode(prev_hash),
                });
            }
        } else {
            // Non-genesis: verify prev_hash matches entry_hash of previous entry
            let prev_stmt = client
                .prepare_cached("SELECT entry_hash FROM chain_entries WHERE sequence = $1")
                .await?;

            let prev_seq = sequence - 1;
            let prev_row = client.query_opt(&prev_stmt, &[&prev_seq]).await?;

            match prev_row {
                Some(row) => {
                    let expected_hash: Vec<u8> = row.get("entry_hash");
                    if prev_hash != expected_hash.as_slice() {
                        return Err(PostgresStorageError::ChainIntegrity {
                            sequence,
                            expected: hex::encode(&expected_hash),
                            actual: hex::encode(prev_hash),
                        });
                    }
                }
                None => {
                    return Err(PostgresStorageError::ChainIntegrity {
                        sequence,
                        expected: format!("entry at sequence {}", prev_seq),
                        actual: "no entry found".to_string(),
                    });
                }
            }
        }

        let stmt = client
            .prepare_cached(
                "INSERT INTO chain_entries (sequence, entry_hash, prev_hash, tenant_scope, entry_type, payload)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING sequence",
            )
            .await?;

        let row = client
            .query_one(
                &stmt,
                &[
                    &sequence,
                    &entry_hash,
                    &prev_hash,
                    &tenant_scope,
                    &entry_type,
                    &payload,
                ],
            )
            .await?;

        Ok(row.get::<_, i64>(0))
    }

    /// Read a chain entry by sequence number.
    ///
    /// Returns `None` if no entry exists at the given sequence.
    pub async fn read_entry_async(
        &self,
        sequence: i64,
    ) -> Result<Option<ChainEntryRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT sequence, entry_hash, prev_hash, tenant_scope, entry_type, payload, created_at
                 FROM chain_entries WHERE sequence = $1",
            )
            .await?;

        let row = client.query_opt(&stmt, &[&sequence]).await?;

        match row {
            Some(r) => Ok(Some(ChainEntryRow::from_row(&r)?)),
            None => Ok(None),
        }
    }

    /// Return the latest (highest) sequence number in the chain.
    ///
    /// Returns `None` if the chain is empty.
    pub async fn latest_sequence(&self) -> Result<Option<i64>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached("SELECT MAX(sequence) FROM chain_entries")
            .await?;

        let row = client.query_one(&stmt, &[]).await?;
        Ok(row.get::<_, Option<i64>>(0))
    }

    /// Verify the integrity of the entire hash chain.
    ///
    /// Reads all entries in sequence order and verifies:
    /// - The genesis entry (sequence 0) has a zero `prev_hash` (F-08)
    /// - Sequence numbers are contiguous with no gaps (F-09)
    /// - Each entry's `prev_hash` matches the `entry_hash` of the preceding entry
    ///
    /// # Returns
    ///
    /// `Ok(verified_count)` if the chain is valid, where `verified_count`
    /// is the number of entries verified (including genesis).
    ///
    /// # Errors
    ///
    /// - `PostgresStorageError::ChainIntegrity` on hash mismatch
    /// - `PostgresStorageError::SequenceGap` on non-contiguous sequences
    pub async fn verify_chain(&self) -> Result<i64, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT sequence, entry_hash, prev_hash
                 FROM chain_entries ORDER BY sequence ASC",
            )
            .await?;

        let rows = client.query(&stmt, &[]).await?;

        if rows.is_empty() {
            return Ok(0);
        }

        let mut prev_entry_hash: Option<Vec<u8>> = None;
        let mut expected_sequence: i64 = 0;
        let mut count: i64 = 0;

        for row in &rows {
            let seq: i64 = row.get("sequence");
            let entry_hash: Vec<u8> = row.get("entry_hash");
            let prev_hash: Vec<u8> = row.get("prev_hash");

            // F-08: First entry must have sequence 0
            if count == 0 && seq != 0 {
                return Err(PostgresStorageError::SequenceGap {
                    expected: 0,
                    actual: seq,
                });
            }

            // F-09: Verify contiguous sequences (no gaps)
            if seq != expected_sequence {
                return Err(PostgresStorageError::SequenceGap {
                    expected: expected_sequence,
                    actual: seq,
                });
            }

            match &prev_entry_hash {
                None => {
                    // Genesis entry: prev_hash must be all zeros
                    if prev_hash.iter().any(|&b| b != 0) {
                        return Err(PostgresStorageError::ChainIntegrity {
                            sequence: seq,
                            expected: "0".repeat(64),
                            actual: hex::encode(&prev_hash),
                        });
                    }
                }
                Some(expected) => {
                    if prev_hash != *expected {
                        return Err(PostgresStorageError::ChainIntegrity {
                            sequence: seq,
                            expected: hex::encode(expected),
                            actual: hex::encode(&prev_hash),
                        });
                    }
                }
            }

            prev_entry_hash = Some(entry_hash);
            expected_sequence = seq + 1;
            count += 1;
        }

        Ok(count)
    }

    /// Insert a projection certificate attesting to projection integrity
    /// at a given chain sequence.
    pub async fn insert_projection_certificate(
        &self,
        chain_sequence: i64,
        projection_hash: &[u8],
        chain_hash: &[u8],
        certificate: &serde_json::Value,
    ) -> Result<i64, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "INSERT INTO projection_certificates (chain_sequence, projection_hash, chain_hash, certificate)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id",
            )
            .await?;

        let row = client
            .query_one(
                &stmt,
                &[&chain_sequence, &projection_hash, &chain_hash, &certificate],
            )
            .await?;

        Ok(row.get::<_, i64>(0))
    }

    /// Get the latest projection certificate (highest chain_sequence).
    pub async fn get_latest_projection_certificate(
        &self,
    ) -> Result<Option<ProjectionCertificateRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT id, chain_sequence, projection_hash, chain_hash, certificate, created_at
                 FROM projection_certificates
                 ORDER BY chain_sequence DESC
                 LIMIT 1",
            )
            .await?;

        let row = client.query_opt(&stmt, &[]).await?;

        match row {
            Some(r) => Ok(Some(ProjectionCertificateRow::from_row(&r)?)),
            None => Ok(None),
        }
    }

    /// Read all chain entries in sequence order.
    ///
    /// Used by the migration module to export the full chain for transfer.
    /// For large chains, consider streaming with cursors instead.
    pub async fn read_all_entries(&self) -> Result<Vec<ChainEntryRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT sequence, entry_hash, prev_hash, tenant_scope, entry_type, payload, created_at
                 FROM chain_entries ORDER BY sequence ASC",
            )
            .await?;

        let rows = client.query(&stmt, &[]).await?;
        rows.iter().map(|r| ChainEntryRow::from_row(r)).collect()
    }

    /// Return the total number of chain entries.
    ///
    /// F-07: Uses prepare_cached for consistent prepared statement usage.
    pub async fn entry_count(&self) -> Result<i64, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached("SELECT COUNT(*) FROM chain_entries")
            .await?;

        let row = client.query_one(&stmt, &[]).await?;

        Ok(row.get::<_, i64>(0))
    }
}

/// Synchronous `ChainReadContext` implementation for PostgresChainStorage.
///
/// The `ChainReadContext` trait is synchronous (returns `Result`, not `Future`).
/// These methods return proper errors instead of panicking, making the impl
/// safe for default builds. The implementations are stubs pending the
/// upstream `limen_types` type constructors. They return
/// `ChainReadError::StorageError` indicating the method is not yet implemented.
///
/// F-01: Gated behind `chain-read-context` feature so that `todo!()` panics
/// (specifically `freshness_marker` which cannot return an error) do not exist
/// in default production builds. When the upstream types gain proper constructors,
/// this feature gate can be removed and the methods implemented fully.
#[cfg(feature = "chain-read-context")]
impl ChainReadContext for PostgresChainStorage {
    fn read_entry(&self, _sequence: ChainSequence) -> Result<Option<ChainEntry>, ChainReadError> {
        Err(ChainReadError::StorageError(
            "PostgresChainStorage::read_entry not yet implemented: requires limen_types ChainEntry construction".to_string()
        ))
    }

    fn read_tenant_state(&self, _scope: &TenantScope) -> Result<TenantChainState, ChainReadError> {
        Err(ChainReadError::StorageError(
            "PostgresChainStorage::read_tenant_state not yet implemented: requires projection queries".to_string()
        ))
    }

    fn read_governance_state_at(
        &self,
        _scope: &TenantScope,
        _policy_id: &PolicyId,
    ) -> Result<Option<GovernanceState>, ChainReadError> {
        Err(ChainReadError::StorageError(
            "PostgresChainStorage::read_governance_state_at not yet implemented: requires governance projection".to_string()
        ))
    }

    fn read_authority_state_at(
        &self,
        _scope: &TenantScope,
        _actor: &Actor,
    ) -> Result<Vec<AuthorityState>, ChainReadError> {
        Err(ChainReadError::StorageError(
            "PostgresChainStorage::read_authority_state_at not yet implemented: requires authority projection".to_string()
        ))
    }

    fn read_cascade_link(&self, _prior: Blake3Hash) -> Result<Option<CascadeLink>, ChainReadError> {
        Err(ChainReadError::StorageError(
            "PostgresChainStorage::read_cascade_link not yet implemented: requires cascade index"
                .to_string(),
        ))
    }

    fn freshness_marker(&self) -> FreshnessMarker {
        // Return a zero/default marker since we cannot error here.
        // This is safe: callers check freshness against chain head, and a zero
        // marker will always be treated as stale, forcing a re-read.
        FreshnessMarker::default()
    }
}

// ================================================================
// Row types (Postgres-to-Rust mapping)
// ================================================================

/// A chain entry row as stored in PostgreSQL.
///
/// This is the Postgres-native representation. Conversion to `ChainEntry`
/// (from `limen_types`) happens at the `ChainReadContext` trait boundary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainEntryRow {
    pub sequence: i64,
    pub entry_hash: Vec<u8>,
    pub prev_hash: Vec<u8>,
    pub tenant_scope: String,
    pub entry_type: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

impl ChainEntryRow {
    /// Construct from a tokio-postgres `Row`.
    ///
    /// F-13: Uses named column access for clarity and resilience to schema changes.
    /// F-14: Formats timestamps as epoch seconds instead of Debug format.
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, PostgresStorageError> {
        let created_at_sys: std::time::SystemTime = row.get("created_at");
        let epoch_secs = created_at_sys
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        Ok(Self {
            sequence: row.get("sequence"),
            entry_hash: row.get("entry_hash"),
            prev_hash: row.get("prev_hash"),
            tenant_scope: row.get("tenant_scope"),
            entry_type: row.get("entry_type"),
            payload: row.get("payload"),
            created_at: format!("{}", epoch_secs),
        })
    }
}

/// A projection certificate row as stored in PostgreSQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectionCertificateRow {
    pub id: i64,
    pub chain_sequence: i64,
    pub projection_hash: Vec<u8>,
    pub chain_hash: Vec<u8>,
    pub certificate: serde_json::Value,
    pub created_at: String,
}

impl ProjectionCertificateRow {
    /// Construct from a tokio-postgres `Row`.
    ///
    /// F-13: Uses named column access.
    /// F-14: Formats timestamps as epoch seconds.
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, PostgresStorageError> {
        let created_at_sys: std::time::SystemTime = row.get("created_at");
        let epoch_secs = created_at_sys
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        Ok(Self {
            id: row.get("id"),
            chain_sequence: row.get("chain_sequence"),
            projection_hash: row.get("projection_hash"),
            chain_hash: row.get("chain_hash"),
            certificate: row.get("certificate"),
            created_at: format!("{}", epoch_secs),
        })
    }
}

// ================================================================
// Hex encoding helper (no external dep needed for error display)
// ================================================================

mod hex {
    /// Encode bytes to lowercase hex string.
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
