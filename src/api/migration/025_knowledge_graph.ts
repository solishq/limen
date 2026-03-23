/**
 * Migration v34: Knowledge Graph — Artifact Cascading + Goal Drift Detection.
 * Spec ref: I-23 (Artifact Dependency Cascade), I-24 (Goal Anchoring / Drift Detection)
 *
 * Phase: Sprint 3 (Knowledge Graph)
 *
 * Schema changes:
 *   - ALTER core_artifacts: Add staleness_flag column (FRESH/STALE)
 *   - Partial index for stale artifact queries
 *   - New table: core_drift_assessments (append-only)
 *
 * Invariants enforced:
 *   I-23: STALE flag propagates via BFS through dependency graph on archive
 *   I-24: Drift assessments recorded at checkpoints, immutable once stored
 *   I-19: staleness_flag is column-specific UPDATE — does not touch content or type
 *
 * Triggers:
 *   trg_drift_assessments_no_update: Append-only on drift assessments
 *   trg_drift_assessments_no_delete: No delete on drift assessments
 *
 * Indexes:
 *   idx_artifacts_stale: Partial index for stale artifact queries (WHERE staleness_flag = 'STALE')
 *   idx_drift_assessments_mission: Mission lookup
 *   idx_drift_assessments_checkpoint: Checkpoint lookup
 *   idx_drift_assessments_tenant: Tenant isolation
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_034_SQL = `
-- Migration 034: Knowledge Graph — Artifact Cascading + Goal Drift Detection
-- Sprint 3: Knowledge Graph
-- Spec ref: I-23, I-24, I-19

-- ============================================================================
-- ALTER core_artifacts: Add staleness_flag column
-- Default 'FRESH'. I-19 safe — existing triggers only protect content/type columns.
-- Column-specific UPDATE (SET staleness_flag = 'STALE') does not fire content/type triggers.
-- ============================================================================

ALTER TABLE core_artifacts ADD COLUMN staleness_flag TEXT NOT NULL DEFAULT 'FRESH'
  CHECK(staleness_flag IN ('FRESH', 'STALE'));

-- Partial index for stale artifact queries (most artifacts are FRESH)
CREATE INDEX IF NOT EXISTS idx_artifacts_stale
  ON core_artifacts(mission_id, staleness_flag)
  WHERE staleness_flag = 'STALE';

-- ============================================================================
-- Table: core_drift_assessments — I-24 (Goal Drift Detection) — append-only
-- Records semantic drift assessments at checkpoints.
-- Each assessment compares checkpoint text against mission's goal anchor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_drift_assessments (
  id TEXT PRIMARY KEY NOT NULL,
  checkpoint_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  tenant_id TEXT,
  drift_score REAL NOT NULL,
  similarity_score REAL NOT NULL,
  original_objective TEXT NOT NULL,
  current_assessment TEXT NOT NULL,
  action_taken TEXT NOT NULL CHECK(action_taken IN ('none','flagged','escalated')),
  escalation_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (checkpoint_id) REFERENCES core_checkpoints(id),
  FOREIGN KEY (mission_id) REFERENCES core_missions(id)
);

CREATE INDEX IF NOT EXISTS idx_drift_assessments_mission ON core_drift_assessments(mission_id);
CREATE INDEX IF NOT EXISTS idx_drift_assessments_checkpoint ON core_drift_assessments(checkpoint_id);
CREATE INDEX IF NOT EXISTS idx_drift_assessments_tenant ON core_drift_assessments(tenant_id);

-- Append-only triggers for drift assessments
CREATE TRIGGER IF NOT EXISTS trg_drift_assessments_no_update
BEFORE UPDATE ON core_drift_assessments
BEGIN
  SELECT RAISE(ABORT, 'DRIFT_ASSESSMENT_IMMUTABLE: drift assessment records are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_drift_assessments_no_delete
BEFORE DELETE ON core_drift_assessments
BEGIN
  SELECT RAISE(ABORT, 'DRIFT_ASSESSMENT_NO_DELETE: drift assessment records cannot be deleted');
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

export function getKnowledgeGraphMigrations(): MigrationEntry[] {
  return [buildEntry(34, 'knowledge_graph', MIGRATION_034_SQL)];
}
