/**
 * Migration v45: Cognitive Engine.
 * Phase 12: Importance cache, connection suggestions, narrative snapshots, consolidation log.
 *
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   1. CREATE TABLE claim_importance (importance score cache)
 *   2. CREATE TABLE connection_suggestions (auto-connection pending suggestions)
 *   3. CREATE TABLE narrative_snapshots (mission-scoped cognitive state)
 *   4. CREATE TABLE consolidation_log (audit trail for all cognitive operations)
 *   5. Indexes for performance
 *   6. Tenant isolation triggers (immutable tenant_id)
 *
 * Additive only. No drops. No column modifications.
 *
 * Invariants: I-P12-05 (self-healing audit), I-P12-13 (merge logging),
 *             I-P12-30 (suggestion lifecycle), DC-P12-601 (additive migration)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_045_SQL = `
-- Migration 045: Cognitive Engine
-- Phase 12: Importance cache, connection suggestions, narrative snapshots, consolidation log
-- Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 6)

-- ============================================================================
-- 1. Importance score cache.
-- Stores precomputed 5-factor importance scores for claims.
-- Updated by computeBatchImportance() or on-demand.
-- I-P12-20: Composite formula cached here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_importance (
  claim_id                TEXT PRIMARY KEY NOT NULL,
  tenant_id               TEXT,
  importance_score        REAL NOT NULL,
  access_frequency_score  REAL NOT NULL,
  recency_score           REAL NOT NULL,
  connection_density_score REAL NOT NULL,
  confidence_score        REAL NOT NULL,
  governance_weight       REAL NOT NULL,
  computed_at             TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claim_assertions(id)
);

-- ============================================================================
-- 2. Connection suggestions.
-- Stores auto-connection and conflict resolution suggestions.
-- I-P12-30: All suggestions start as 'pending'.
-- I-P12-31: Only acceptSuggestion() creates the actual relationship.
-- ============================================================================

CREATE TABLE IF NOT EXISTS connection_suggestions (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT,
  from_claim_id   TEXT NOT NULL,
  to_claim_id     TEXT NOT NULL,
  suggested_type  TEXT NOT NULL CHECK (suggested_type IN ('supports','derived_from')),
  similarity      REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','rejected','expired')),
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  FOREIGN KEY (from_claim_id) REFERENCES claim_assertions(id),
  FOREIGN KEY (to_claim_id) REFERENCES claim_assertions(id)
);

-- ============================================================================
-- 3. Narrative snapshots.
-- Stores mission-scoped or global cognitive state snapshots.
-- I-P12-40: mission_id NULL = global scope.
-- ============================================================================

CREATE TABLE IF NOT EXISTS narrative_snapshots (
  id                  TEXT PRIMARY KEY NOT NULL,
  tenant_id           TEXT,
  mission_id          TEXT,
  snapshot_type       TEXT NOT NULL CHECK (snapshot_type IN ('mission','session','manual')),
  subjects_explored   INTEGER NOT NULL,
  decisions_made      INTEGER NOT NULL,
  conflicts_resolved  INTEGER NOT NULL,
  claims_added        INTEGER NOT NULL,
  claims_retracted    INTEGER NOT NULL,
  momentum            TEXT NOT NULL CHECK (momentum IN ('growing','stable','declining')),
  threads             TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

-- ============================================================================
-- 4. Consolidation log.
-- Audit trail for all cognitive operations: merge, archive, resolve, self_heal.
-- I-P12-05: Every auto-retraction logged here.
-- I-P12-13: Every merge logged here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS consolidation_log (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT,
  operation         TEXT NOT NULL CHECK (operation IN ('merge','archive','resolve','self_heal')),
  source_claim_ids  TEXT NOT NULL,
  target_claim_id   TEXT,
  reason            TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- ============================================================================
-- 5. Indexes.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_importance_score ON claim_importance(tenant_id, importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON connection_suggestions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_narrative_mission ON narrative_snapshots(tenant_id, mission_id);
CREATE INDEX IF NOT EXISTS idx_consolidation_op ON consolidation_log(tenant_id, operation);

-- ============================================================================
-- 6. Tenant isolation triggers.
-- Pattern matches existing triggers (004_tenant_isolation.ts).
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS claim_importance_tenant_immutable
  BEFORE UPDATE OF tenant_id ON claim_importance
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on claim_importance');
  END;

CREATE TRIGGER IF NOT EXISTS connection_suggestions_tenant_immutable
  BEFORE UPDATE OF tenant_id ON connection_suggestions
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on connection_suggestions');
  END;

CREATE TRIGGER IF NOT EXISTS narrative_snapshots_tenant_immutable
  BEFORE UPDATE OF tenant_id ON narrative_snapshots
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on narrative_snapshots');
  END;

CREATE TRIGGER IF NOT EXISTS consolidation_log_tenant_immutable
  BEFORE UPDATE OF tenant_id ON consolidation_log
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on consolidation_log');
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

export function getCognitiveEngineMigrations(): MigrationEntry[] {
  return [buildEntry(45, 'cognitive_engine', MIGRATION_045_SQL)];
}
