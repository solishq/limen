/**
 * Forward-only migration v17: Learning Outcome Tracking
 * S ref: S29.5 (effectiveness tracking), I-07 (agent isolation), FM-10 (tenant isolation)
 *
 * Phase: 4E-2d (Certification — EffectivenessTracker + RetirementEvaluator)
 *
 * Adds:
 *   - learning_outcomes table (per-technique outcome records)
 *   - Indexes for technique+tenant lookup and rolling window query
 *   - Tenant immutability trigger (same pattern as Phase 4B)
 *
 * Schema derives from EffectivenessTracker.recordOutcome interface:
 *   Stores outcome classification per technique per interaction.
 *   No FOREIGN KEY to learning_techniques — audit history survives
 *   technique retirement (same rationale as learning_applications).
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v17: Learning Outcomes Table ───

const MIGRATION_017_SQL = `
-- Migration 017: Learning Outcome Tracking
-- S ref: S29.5 (effectiveness tracking), I-07 (agent isolation), FM-10 (tenant isolation)
-- Phase: 4E-2d
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- Outcome tracking table
-- Each row records a single outcome observation for a technique.
-- Used by EffectivenessTracker.getSuccessRate for rolling window.
-- No FK to learning_techniques: audit history survives retirement.
-- ────────────────────────────────────────────────────────────

CREATE TABLE learning_outcomes (
  id              TEXT    PRIMARY KEY,
  technique_id    TEXT    NOT NULL,
  tenant_id       TEXT    NOT NULL,
  outcome         TEXT    NOT NULL CHECK (outcome IN ('positive', 'neutral', 'negative')),
  created_at      TEXT    NOT NULL
);

-- ────────────────────────────────────────────────────────────
-- Indexes
-- Primary: technique + tenant lookup (all queries scoped by both)
-- Secondary: rolling window query (ORDER BY created_at DESC LIMIT 50)
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_lo_technique_tenant ON learning_outcomes(technique_id, tenant_id);
CREATE INDEX idx_lo_technique_tenant_time ON learning_outcomes(technique_id, tenant_id, created_at DESC);

-- ────────────────────────────────────────────────────────────
-- Tenant immutability trigger (same pattern as Phase 4B)
-- Prevents tenant_id from being changed after INSERT.
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER learning_outcomes_tenant_immutable
  BEFORE UPDATE OF tenant_id ON learning_outcomes
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on learning_outcomes');
  END;
`;

// ─── Build Migration Entry ───

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

/**
 * Get Phase 4E-2d (Learning Outcomes) migration.
 * Version 17 continues from Phase 4E-2a's version 16.
 */
export function getPhase4E2dOutcomesMigration(): MigrationEntry[] {
  return [
    buildEntry(17, 'learning_outcomes', MIGRATION_017_SQL),
  ];
}
