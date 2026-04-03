/**
 * Migration v44: Vector Search.
 * Phase 11: Embedding metadata, pending queue, vec0 virtual table.
 *
 * Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   1. CREATE TABLE embedding_metadata (always, even without sqlite-vec)
 *   2. CREATE TABLE embedding_pending (always, even without sqlite-vec)
 *   3. Indexes on model_id and created_at
 *   4. Tenant isolation triggers
 *   5. CREATE VIRTUAL TABLE claim_embeddings USING vec0(...) -- CONDITIONAL
 *
 * The vec0 virtual table is created ONLY if sqlite-vec is loaded.
 * Embedding_metadata and embedding_pending are always created.
 *
 * Additive only. No drops. No column modifications.
 *
 * Invariants: I-P11-01 (core independence), I-P11-12 (pending queue atomicity)
 * DCs: DC-P11-601 (additive only), DC-P11-602 (conditional vec0)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';

const MIGRATION_044_SQL = `
-- Migration 044: Vector Search
-- Phase 11: Embedding metadata, pending queue
-- Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 6)

-- ============================================================================
-- 1. Embedding metadata table (always created, even without sqlite-vec).
-- 1:1 with claims that have been embedded.
-- I-P11-13: model_id recorded for staleness detection.
-- ============================================================================

CREATE TABLE IF NOT EXISTS embedding_metadata (
  claim_id    TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  model_id    TEXT NOT NULL,
  dimensions  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  FOREIGN KEY (claim_id) REFERENCES claim_assertions(id)
);

-- ============================================================================
-- 2. Pending embeddings queue.
-- Claims that need embedding generation.
-- I-P11-12: INSERT here is in same transaction as claim INSERT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS embedding_pending (
  claim_id    TEXT PRIMARY KEY NOT NULL,
  tenant_id   TEXT,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  FOREIGN KEY (claim_id) REFERENCES claim_assertions(id)
);

-- ============================================================================
-- 3. Indexes.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_embedding_meta_model ON embedding_metadata(model_id);
CREATE INDEX IF NOT EXISTS idx_embedding_pending_created ON embedding_pending(created_at);

-- ============================================================================
-- 4. Tenant isolation triggers.
-- Pattern matches existing triggers (004_tenant_isolation.ts).
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS embedding_metadata_tenant_immutable
  BEFORE UPDATE OF tenant_id ON embedding_metadata
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on embedding_metadata');
  END;

CREATE TRIGGER IF NOT EXISTS embedding_pending_tenant_immutable
  BEFORE UPDATE OF tenant_id ON embedding_pending
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on embedding_pending');
  END;
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getVectorSearchMigrations(): MigrationEntry[] {
  return [buildEntry(44, 'vector_search', MIGRATION_044_SQL)];
}

/**
 * Create the vec0 virtual table for claim embeddings.
 * MUST be called AFTER migrations AND AFTER sqlite-vec is loaded.
 * Only called when sqlite-vec is available.
 *
 * DC-P11-602: Conditional creation.
 * I-P11-11: Dimensions set at table creation time.
 */
export function createVec0Table(conn: DatabaseConnection, dimensions: number): void {
  conn.run(
    `CREATE VIRTUAL TABLE IF NOT EXISTS claim_embeddings USING vec0(
      claim_id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    )`,
  );
}
