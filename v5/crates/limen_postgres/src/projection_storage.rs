// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
//! PostgreSQL projection storage for Limen v5.
//!
//! Provides the same 5-table projection schema as the SQLite backend:
//!
//! | Table                    | Purpose                                          |
//! |--------------------------|--------------------------------------------------|
//! | `projection_metadata`    | Projection state: last applied sequence, digest  |
//! | `committed_transitions`  | Materialized governance state transitions         |
//! | `governance_state_at`    | Point-in-time governance state snapshots          |
//! | `authority_state_at`     | Point-in-time authority state snapshots           |
//! | `refusal_records`        | Governance refusal audit log                     |
//!
//! ## Postgres-Specific Design
//!
//! - `JSONB` for structured state fields (enables GIN indexing)
//! - `BIGINT` for sequence references (matching chain_entries)
//! - `BYTEA` for digest/hash fields
//! - Tamper detection via `pg_notify` trigger instead of SQLite trigger

use deadpool_postgres::Pool;
use serde::{Deserialize, Serialize};

use crate::error::PostgresStorageError;

// ================================================================
// Schema DDL
// ================================================================

/// DDL for all 5 projection tables plus tamper detection trigger.
const PROJECTION_DDL: &str = "
-- Table 1: Projection metadata (singleton per tenant)
CREATE TABLE IF NOT EXISTS projection_metadata (
    tenant_scope       TEXT        PRIMARY KEY,
    last_applied_seq   BIGINT      NOT NULL DEFAULT 0,
    projection_digest  BYTEA       NOT NULL DEFAULT E'\\\\x00',
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table 2: Committed state transitions
CREATE TABLE IF NOT EXISTS committed_transitions (
    id                 BIGSERIAL   PRIMARY KEY,
    tenant_scope       TEXT        NOT NULL,
    chain_sequence     BIGINT      NOT NULL,
    from_state         TEXT        NOT NULL,
    to_state           TEXT        NOT NULL,
    transition_type    TEXT        NOT NULL,
    payload            JSONB       NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_committed_transitions_tenant_seq
    ON committed_transitions (tenant_scope, chain_sequence);

-- Table 3: Governance state at a point in time
CREATE TABLE IF NOT EXISTS governance_state_at (
    id                 BIGSERIAL   PRIMARY KEY,
    tenant_scope       TEXT        NOT NULL,
    policy_id          TEXT        NOT NULL,
    chain_sequence     BIGINT      NOT NULL,
    state              JSONB       NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_scope, policy_id, chain_sequence)
);

CREATE INDEX IF NOT EXISTS idx_governance_state_tenant_policy
    ON governance_state_at (tenant_scope, policy_id, chain_sequence DESC);

-- Table 4: Authority state at a point in time
CREATE TABLE IF NOT EXISTS authority_state_at (
    id                 BIGSERIAL   PRIMARY KEY,
    tenant_scope       TEXT        NOT NULL,
    actor_id           TEXT        NOT NULL,
    chain_sequence     BIGINT      NOT NULL,
    authorities        JSONB       NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_scope, actor_id, chain_sequence)
);

CREATE INDEX IF NOT EXISTS idx_authority_state_tenant_actor
    ON authority_state_at (tenant_scope, actor_id, chain_sequence DESC);

-- Table 5: Refusal records (audit log)
CREATE TABLE IF NOT EXISTS refusal_records (
    id                 BIGSERIAL   PRIMARY KEY,
    tenant_scope       TEXT        NOT NULL,
    chain_sequence     BIGINT      NOT NULL,
    refusal_reason     TEXT        NOT NULL,
    context            JSONB       NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refusal_records_tenant
    ON refusal_records (tenant_scope, chain_sequence);

-- Tamper detection trigger on projection_metadata
-- Notifies 'limen_tamper' channel when projection_digest is updated
-- with a non-monotonic sequence (last_applied_seq decreased).
CREATE OR REPLACE FUNCTION limen_projection_tamper_check()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.last_applied_seq < OLD.last_applied_seq THEN
        PERFORM pg_notify(
            'limen_tamper',
            json_build_object(
                'tenant_scope', NEW.tenant_scope,
                'old_seq', OLD.last_applied_seq,
                'new_seq', NEW.last_applied_seq,
                'detected_at', NOW()
            )::text
        );
        RAISE EXCEPTION 'tamper detected: sequence regression from % to % for tenant %',
            OLD.last_applied_seq, NEW.last_applied_seq, NEW.tenant_scope;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_projection_tamper_check'
    ) THEN
        CREATE TRIGGER trg_projection_tamper_check
            BEFORE UPDATE ON projection_metadata
            FOR EACH ROW
            EXECUTE FUNCTION limen_projection_tamper_check();
    END IF;
END;
$$;

-- F-04: Tamper detection triggers on all projection tables (INSERT/UPDATE/DELETE)
-- Blocks unauthorized UPDATE and DELETE on append-only audit tables.
CREATE OR REPLACE FUNCTION limen_projection_audit_tamper()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        PERFORM pg_notify(
            'limen_tamper',
            json_build_object(
                'table', TG_TABLE_NAME,
                'operation', 'UPDATE',
                'detected_at', NOW()
            )::text
        );
        RAISE EXCEPTION 'tamper detected: UPDATE on append-only table %', TG_TABLE_NAME;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM pg_notify(
            'limen_tamper',
            json_build_object(
                'table', TG_TABLE_NAME,
                'operation', 'DELETE',
                'detected_at', NOW()
            )::text
        );
        RAISE EXCEPTION 'tamper detected: DELETE on append-only table %', TG_TABLE_NAME;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    -- committed_transitions: block UPDATE/DELETE
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_committed_transitions_tamper'
    ) THEN
        CREATE TRIGGER trg_committed_transitions_tamper
            BEFORE UPDATE OR DELETE ON committed_transitions
            FOR EACH ROW
            EXECUTE FUNCTION limen_projection_audit_tamper();
    END IF;

    -- refusal_records: block UPDATE/DELETE
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_refusal_records_tamper'
    ) THEN
        CREATE TRIGGER trg_refusal_records_tamper
            BEFORE UPDATE OR DELETE ON refusal_records
            FOR EACH ROW
            EXECUTE FUNCTION limen_projection_audit_tamper();
    END IF;

    -- governance_state_at: block DELETE (UPDATE allowed for upsert semantics)
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_governance_state_delete_tamper'
    ) THEN
        CREATE TRIGGER trg_governance_state_delete_tamper
            BEFORE DELETE ON governance_state_at
            FOR EACH ROW
            EXECUTE FUNCTION limen_projection_audit_tamper();
    END IF;

    -- authority_state_at: block DELETE (UPDATE allowed for upsert semantics)
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_authority_state_delete_tamper'
    ) THEN
        CREATE TRIGGER trg_authority_state_delete_tamper
            BEFORE DELETE ON authority_state_at
            FOR EACH ROW
            EXECUTE FUNCTION limen_projection_audit_tamper();
    END IF;
END;
$$;
";

// ================================================================
// PostgresProjectionStorage
// ================================================================

/// PostgreSQL-backed projection storage for Limen v5.
///
/// Manages the 5 projection tables that materialize chain state into
/// queryable forms. The projection is a read-optimized view of the chain:
/// governance states, authority states, transitions, and refusals.
///
/// Thread-safe: each operation acquires its own pooled connection.
pub struct PostgresProjectionStorage {
    pool: Pool,
}

impl PostgresProjectionStorage {
    /// Create a new projection storage with the given connection pool.
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// Apply the projection schema (all 5 tables + tamper trigger).
    ///
    /// Idempotent: safe to call on every startup. Uses IF NOT EXISTS
    /// for all DDL statements.
    pub async fn apply_schema(&self) -> Result<(), PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        client
            .batch_execute(PROJECTION_DDL)
            .await
            .map_err(|e| PostgresStorageError::Schema(format!("projection DDL failed: {}", e)))?;

        Ok(())
    }

    // ================================================================
    // Projection metadata CRUD
    // ================================================================

    /// Get or initialize projection metadata for a tenant.
    pub async fn get_metadata(
        &self,
        tenant_scope: &str,
    ) -> Result<Option<ProjectionMetadataRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT tenant_scope, last_applied_seq, projection_digest, updated_at
                 FROM projection_metadata WHERE tenant_scope = $1",
            )
            .await?;

        let row = client.query_opt(&stmt, &[&tenant_scope]).await?;
        match row {
            Some(r) => {
                let updated_at_sys: std::time::SystemTime = r.get("updated_at");
                let epoch_secs = updated_at_sys
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                Ok(Some(ProjectionMetadataRow {
                    tenant_scope: r.get("tenant_scope"),
                    last_applied_seq: r.get("last_applied_seq"),
                    projection_digest: r.get("projection_digest"),
                    updated_at: format!("{}", epoch_secs),
                }))
            }
            None => Ok(None),
        }
    }

    /// Upsert projection metadata. Advances the sequence and updates the digest.
    ///
    /// The tamper detection trigger will reject any attempt to decrease
    /// `last_applied_seq` (sequence regression).
    pub async fn upsert_metadata(
        &self,
        tenant_scope: &str,
        last_applied_seq: i64,
        projection_digest: &[u8],
    ) -> Result<(), PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "INSERT INTO projection_metadata (tenant_scope, last_applied_seq, projection_digest, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (tenant_scope) DO UPDATE
                 SET last_applied_seq = $2, projection_digest = $3, updated_at = NOW()",
            )
            .await?;

        client
            .execute(
                &stmt,
                &[&tenant_scope, &last_applied_seq, &projection_digest],
            )
            .await?;

        Ok(())
    }

    // ================================================================
    // Committed transitions
    // ================================================================

    /// Record a committed state transition.
    pub async fn insert_transition(
        &self,
        tenant_scope: &str,
        chain_sequence: i64,
        from_state: &str,
        to_state: &str,
        transition_type: &str,
        payload: &serde_json::Value,
    ) -> Result<i64, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "INSERT INTO committed_transitions
                 (tenant_scope, chain_sequence, from_state, to_state, transition_type, payload)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id",
            )
            .await?;

        let row = client
            .query_one(
                &stmt,
                &[
                    &tenant_scope,
                    &chain_sequence,
                    &from_state,
                    &to_state,
                    &transition_type,
                    &payload,
                ],
            )
            .await?;

        Ok(row.get::<_, i64>(0))
    }

    /// Read transitions for a tenant, optionally after a given sequence.
    pub async fn read_transitions(
        &self,
        tenant_scope: &str,
        after_sequence: Option<i64>,
    ) -> Result<Vec<CommittedTransitionRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let after = after_sequence.unwrap_or(-1);

        let stmt = client
            .prepare_cached(
                "SELECT id, tenant_scope, chain_sequence, from_state, to_state,
                        transition_type, payload, created_at
                 FROM committed_transitions
                 WHERE tenant_scope = $1 AND chain_sequence > $2
                 ORDER BY chain_sequence ASC",
            )
            .await?;

        let rows = client.query(&stmt, &[&tenant_scope, &after]).await?;
        rows.iter()
            .map(|r| CommittedTransitionRow::from_row(r))
            .collect()
    }

    // ================================================================
    // Governance state snapshots
    // ================================================================

    /// Insert or update a governance state snapshot at a chain sequence.
    pub async fn upsert_governance_state(
        &self,
        tenant_scope: &str,
        policy_id: &str,
        chain_sequence: i64,
        state: &serde_json::Value,
    ) -> Result<(), PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "INSERT INTO governance_state_at
                 (tenant_scope, policy_id, chain_sequence, state)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (tenant_scope, policy_id, chain_sequence) DO UPDATE
                 SET state = $4",
            )
            .await?;

        client
            .execute(&stmt, &[&tenant_scope, &policy_id, &chain_sequence, &state])
            .await?;

        Ok(())
    }

    /// Read the latest governance state for a tenant/policy pair.
    pub async fn read_latest_governance_state(
        &self,
        tenant_scope: &str,
        policy_id: &str,
    ) -> Result<Option<GovernanceStateRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT id, tenant_scope, policy_id, chain_sequence, state, created_at
                 FROM governance_state_at
                 WHERE tenant_scope = $1 AND policy_id = $2
                 ORDER BY chain_sequence DESC
                 LIMIT 1",
            )
            .await?;

        let row = client
            .query_opt(&stmt, &[&tenant_scope, &policy_id])
            .await?;
        match row {
            Some(r) => Ok(Some(GovernanceStateRow::from_row(&r)?)),
            None => Ok(None),
        }
    }

    // ================================================================
    // Authority state snapshots
    // ================================================================

    /// Insert or update an authority state snapshot at a chain sequence.
    pub async fn upsert_authority_state(
        &self,
        tenant_scope: &str,
        actor_id: &str,
        chain_sequence: i64,
        authorities: &serde_json::Value,
    ) -> Result<(), PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "INSERT INTO authority_state_at
                 (tenant_scope, actor_id, chain_sequence, authorities)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (tenant_scope, actor_id, chain_sequence) DO UPDATE
                 SET authorities = $4",
            )
            .await?;

        client
            .execute(
                &stmt,
                &[&tenant_scope, &actor_id, &chain_sequence, &authorities],
            )
            .await?;

        Ok(())
    }

    /// Read the latest authority state for a tenant/actor pair.
    pub async fn read_latest_authority_state(
        &self,
        tenant_scope: &str,
        actor_id: &str,
    ) -> Result<Option<AuthorityStateRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT id, tenant_scope, actor_id, chain_sequence, authorities, created_at
                 FROM authority_state_at
                 WHERE tenant_scope = $1 AND actor_id = $2
                 ORDER BY chain_sequence DESC
                 LIMIT 1",
            )
            .await?;

        let row = client.query_opt(&stmt, &[&tenant_scope, &actor_id]).await?;
        match row {
            Some(r) => Ok(Some(AuthorityStateRow::from_row(&r)?)),
            None => Ok(None),
        }
    }

    /// Read all authority state entries for a tenant/actor pair.
    pub async fn read_all_authority_states(
        &self,
        tenant_scope: &str,
        actor_id: &str,
    ) -> Result<Vec<AuthorityStateRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT id, tenant_scope, actor_id, chain_sequence, authorities, created_at
                 FROM authority_state_at
                 WHERE tenant_scope = $1 AND actor_id = $2
                 ORDER BY chain_sequence ASC",
            )
            .await?;

        let rows = client.query(&stmt, &[&tenant_scope, &actor_id]).await?;
        rows.iter()
            .map(|r| AuthorityStateRow::from_row(r))
            .collect()
    }

    // ================================================================
    // Refusal records
    // ================================================================

    /// Record a governance refusal.
    pub async fn insert_refusal(
        &self,
        tenant_scope: &str,
        chain_sequence: i64,
        refusal_reason: &str,
        context: &serde_json::Value,
    ) -> Result<i64, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "INSERT INTO refusal_records
                 (tenant_scope, chain_sequence, refusal_reason, context)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id",
            )
            .await?;

        let row = client
            .query_one(
                &stmt,
                &[&tenant_scope, &chain_sequence, &refusal_reason, &context],
            )
            .await?;

        Ok(row.get::<_, i64>(0))
    }

    /// Read refusal records for a tenant.
    pub async fn read_refusals(
        &self,
        tenant_scope: &str,
    ) -> Result<Vec<RefusalRecordRow>, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let stmt = client
            .prepare_cached(
                "SELECT id, tenant_scope, chain_sequence, refusal_reason, context, created_at
                 FROM refusal_records
                 WHERE tenant_scope = $1
                 ORDER BY chain_sequence ASC",
            )
            .await?;

        let rows = client.query(&stmt, &[&tenant_scope]).await?;
        rows.iter().map(|r| RefusalRecordRow::from_row(r)).collect()
    }

    // ================================================================
    // Bulk operations (for migration)
    // ================================================================

    /// Count total rows across all projection tables for a tenant.
    pub async fn row_count(
        &self,
        tenant_scope: &str,
    ) -> Result<ProjectionRowCounts, PostgresStorageError> {
        let client =
            self.pool.get().await.map_err(|e| {
                PostgresStorageError::Pool(format!("failed to get connection: {}", e))
            })?;

        let meta: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM projection_metadata WHERE tenant_scope = $1",
                &[&tenant_scope],
            )
            .await?
            .get(0);

        let transitions: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM committed_transitions WHERE tenant_scope = $1",
                &[&tenant_scope],
            )
            .await?
            .get(0);

        let governance: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM governance_state_at WHERE tenant_scope = $1",
                &[&tenant_scope],
            )
            .await?
            .get(0);

        let authority: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM authority_state_at WHERE tenant_scope = $1",
                &[&tenant_scope],
            )
            .await?
            .get(0);

        let refusals: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM refusal_records WHERE tenant_scope = $1",
                &[&tenant_scope],
            )
            .await?
            .get(0);

        Ok(ProjectionRowCounts {
            metadata: meta,
            transitions,
            governance,
            authority,
            refusals,
        })
    }
}

// ================================================================
// Row types
// ================================================================

/// Projection metadata row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectionMetadataRow {
    pub tenant_scope: String,
    pub last_applied_seq: i64,
    pub projection_digest: Vec<u8>,
    pub updated_at: String,
}

/// Committed transition row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommittedTransitionRow {
    pub id: i64,
    pub tenant_scope: String,
    pub chain_sequence: i64,
    pub from_state: String,
    pub to_state: String,
    pub transition_type: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

impl CommittedTransitionRow {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, PostgresStorageError> {
        let created_at_sys: std::time::SystemTime = row.get("created_at");
        let epoch_secs = created_at_sys
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok(Self {
            id: row.get("id"),
            tenant_scope: row.get("tenant_scope"),
            chain_sequence: row.get("chain_sequence"),
            from_state: row.get("from_state"),
            to_state: row.get("to_state"),
            transition_type: row.get("transition_type"),
            payload: row.get("payload"),
            created_at: format!("{}", epoch_secs),
        })
    }
}

/// Governance state snapshot row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceStateRow {
    pub id: i64,
    pub tenant_scope: String,
    pub policy_id: String,
    pub chain_sequence: i64,
    pub state: serde_json::Value,
    pub created_at: String,
}

impl GovernanceStateRow {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, PostgresStorageError> {
        let created_at_sys: std::time::SystemTime = row.get("created_at");
        let epoch_secs = created_at_sys
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok(Self {
            id: row.get("id"),
            tenant_scope: row.get("tenant_scope"),
            policy_id: row.get("policy_id"),
            chain_sequence: row.get("chain_sequence"),
            state: row.get("state"),
            created_at: format!("{}", epoch_secs),
        })
    }
}

/// Authority state snapshot row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorityStateRow {
    pub id: i64,
    pub tenant_scope: String,
    pub actor_id: String,
    pub chain_sequence: i64,
    pub authorities: serde_json::Value,
    pub created_at: String,
}

impl AuthorityStateRow {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, PostgresStorageError> {
        let created_at_sys: std::time::SystemTime = row.get("created_at");
        let epoch_secs = created_at_sys
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok(Self {
            id: row.get("id"),
            tenant_scope: row.get("tenant_scope"),
            actor_id: row.get("actor_id"),
            chain_sequence: row.get("chain_sequence"),
            authorities: row.get("authorities"),
            created_at: format!("{}", epoch_secs),
        })
    }
}

/// Refusal record row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefusalRecordRow {
    pub id: i64,
    pub tenant_scope: String,
    pub chain_sequence: i64,
    pub refusal_reason: String,
    pub context: serde_json::Value,
    pub created_at: String,
}

impl RefusalRecordRow {
    fn from_row(row: &tokio_postgres::Row) -> Result<Self, PostgresStorageError> {
        let created_at_sys: std::time::SystemTime = row.get("created_at");
        let epoch_secs = created_at_sys
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok(Self {
            id: row.get("id"),
            tenant_scope: row.get("tenant_scope"),
            chain_sequence: row.get("chain_sequence"),
            refusal_reason: row.get("refusal_reason"),
            context: row.get("context"),
            created_at: format!("{}", epoch_secs),
        })
    }
}

/// Row counts across all projection tables for a tenant.
#[derive(Debug, Clone)]
pub struct ProjectionRowCounts {
    pub metadata: i64,
    pub transitions: i64,
    pub governance: i64,
    pub authority: i64,
    pub refusals: i64,
}

impl ProjectionRowCounts {
    /// Total rows across all tables.
    pub fn total(&self) -> i64 {
        self.metadata + self.transitions + self.governance + self.authority + self.refusals
    }
}
