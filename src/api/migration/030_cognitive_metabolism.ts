/**
 * Migration v39: Cognitive Metabolism Columns.
 * Phase 3: Beliefs that breathe.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (3.4, 3.7)
 * Design Source: docs/sprints/PHASE-3-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   - ALTER TABLE claim_assertions ADD COLUMN last_accessed_at TEXT DEFAULT NULL
 *   - ALTER TABLE claim_assertions ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0
 *   - ALTER TABLE claim_assertions ADD COLUMN stability REAL NOT NULL DEFAULT 90.0
 *   - CREATE INDEX idx_claim_assertions_last_accessed (for Phase 5 health queries)
 *
 * Additive only. No drops. No column modifications. Existing data preserved.
 *
 * Invariants: I-P3-09 (additive), I-P3-10 (defaults)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_039_SQL = `
-- Migration 039: Cognitive Metabolism
-- Phase 3: Beliefs that breathe.
-- Spec ref: LIMEN_BUILD_PHASES.md (3.4, 3.7)

-- ============================================================================
-- ALTER TABLE: claim_assertions -- add cognitive metabolism columns
-- ============================================================================

-- Access tracking: when was this claim last accessed via recall/search?
ALTER TABLE claim_assertions ADD COLUMN last_accessed_at TEXT DEFAULT NULL;

-- Access tracking: how many times has this claim been accessed?
ALTER TABLE claim_assertions ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;

-- Decay: stability value in days (determines decay rate for this claim).
-- Set at creation time based on predicate pattern.
-- Default 90.0 days (finding category -- most common claim type).
ALTER TABLE claim_assertions ADD COLUMN stability REAL NOT NULL DEFAULT 90.0;

-- ============================================================================
-- Index: Support access-pattern queries (Phase 5 health report)
-- ============================================================================

-- Phase 5 health report needs: "stale domains" (domains with no recent access).
-- This index supports: SELECT ... WHERE last_accessed_at < ? GROUP BY predicate.
CREATE INDEX IF NOT EXISTS idx_claim_assertions_last_accessed
  ON claim_assertions(tenant_id, last_accessed_at);
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getCognitiveMetabolismMigrations(): MigrationEntry[] {
  return [buildEntry(39, 'cognitive_metabolism', MIGRATION_039_SQL)];
}
