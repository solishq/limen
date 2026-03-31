/**
 * Migration v40: Conflict Detection Compound Index.
 * Phase 4: Quality & Safety.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (4.1), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md A.3
 * Design Source: docs/sprints/PHASE-4-DESIGN-SOURCE.md (Decision 2, Output 6)
 *
 * Schema changes:
 *   - CREATE INDEX idx_claims_conflict_detection ON claim_assertions(subject, predicate, status)
 *     WHERE status = 'active' -- partial index, excludes retracted claims
 *
 * Performance target: Structural conflict detection <2ms on 100K claims.
 * Additive only. No drops. No column modifications.
 *
 * Invariants: DC-P4-601 (idempotent migration), DC-P4-901 (performance budget)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_040_SQL = `
-- Migration 040: Conflict Detection Compound Index
-- Phase 4: Quality & Safety.
-- Spec ref: LIMEN_BUILD_PHASES.md (4.1)

-- ============================================================================
-- Index: Compound partial index for structural conflict detection
-- ============================================================================

-- Query pattern: SELECT id FROM claim_assertions
--   WHERE subject = ? AND predicate = ? AND status = 'active' AND object_value != ? AND id != ?
-- Budget: <2ms on 100K claims.
--
-- Partial index (WHERE status = 'active') excludes retracted claims,
-- reducing index size and scan range.
CREATE INDEX IF NOT EXISTS idx_claims_conflict_detection
  ON claim_assertions(subject, predicate, status)
  WHERE status = 'active';
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getConflictIndexMigrations(): MigrationEntry[] {
  return [buildEntry(40, 'conflict_detection_index', MIGRATION_040_SQL)];
}
