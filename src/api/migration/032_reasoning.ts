/**
 * Migration v41: Reasoning Column.
 * Phase 5: Reasoning.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (5.1), PHASE-5-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   1. ALTER TABLE claim_assertions ADD COLUMN reasoning TEXT DEFAULT NULL
 *   2. Recreate CCP-I1 immutability trigger to include reasoning in protected columns.
 *      SQLite does not support ALTER TRIGGER, so we DROP and CREATE.
 *
 * Additive only. No drops (except trigger recreation). No column modifications.
 * Existing claims get reasoning=NULL (correct -- they had no reasoning at creation).
 *
 * Invariants: I-P5-01 (reasoning immutability), I-P5-10 (additive migration)
 * DCs: DC-P5-108 (additive only), DC-P5-601 (trigger recreation fidelity)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_041_SQL = `
-- Migration 041: Reasoning Column
-- Phase 5: Claims carry their reasoning.
-- Spec ref: LIMEN_BUILD_PHASES.md (5.1)

-- ============================================================================
-- 1. Add optional reasoning column to claim_assertions.
-- TEXT, nullable. Set at creation, immutable (CCP-I1 extended).
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN reasoning TEXT DEFAULT NULL;

-- ============================================================================
-- 2. Extend CCP-I1 immutability trigger to protect reasoning column.
-- SQLite does not support ALTER TRIGGER, so we drop and recreate.
-- The WHEN clause EXACTLY matches the original trigger from 019_ccp_claims.ts
-- with the addition of: NEW.reasoning IS NOT OLD.reasoning
-- ============================================================================

DROP TRIGGER IF EXISTS claim_assertions_content_immutable;

CREATE TRIGGER claim_assertions_content_immutable
  BEFORE UPDATE ON claim_assertions
  WHEN NEW.purged_at IS NULL
    AND OLD.purged_at IS NULL
    AND (
      NEW.subject IS NOT OLD.subject OR
      NEW.predicate IS NOT OLD.predicate OR
      NEW.object_type IS NOT OLD.object_type OR
      NEW.object_value IS NOT OLD.object_value OR
      NEW.confidence IS NOT OLD.confidence OR
      NEW.valid_at IS NOT OLD.valid_at OR
      NEW.source_agent_id IS NOT OLD.source_agent_id OR
      NEW.source_mission_id IS NOT OLD.source_mission_id OR
      NEW.source_task_id IS NOT OLD.source_task_id OR
      NEW.grounding_mode IS NOT OLD.grounding_mode OR
      NEW.runtime_witness IS NOT OLD.runtime_witness OR
      NEW.reasoning IS NOT OLD.reasoning
    )
  BEGIN
    SELECT RAISE(ABORT, 'CCP-I1: Claim content fields are immutable after creation.');
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

export function getReasoningMigrations(): MigrationEntry[] {
  return [buildEntry(41, 'reasoning_column', MIGRATION_041_SQL)];
}
