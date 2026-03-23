/**
 * Forward-only migration v18: Learning System Application Log
 * S ref: S29.4 (application recording), I-03 (audit), I-07 (agent isolation)
 *
 * Phase: 4E-2c (Certification — Learning System TechniqueApplicator)
 *
 * Adds:
 *   - learning_applications table (application recording log)
 *   - Indexes for technique-level and tenant-level lookup
 *   - Tenant immutability trigger
 *
 * Design decisions:
 *   R-07: NO foreign key to learning_techniques. Application records are an
 *   append-only audit log. Techniques may be retired and eventually tombstoned
 *   (GDPR, I-03) while application history is preserved. Phantom technique IDs
 *   are acceptable — the log records what was attempted, not what currently exists.
 *   Contract test #18 exercises this with phantom IDs ('t-1', 't-2').
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v18: Learning Applications Table ───

const MIGRATION_018_SQL = `
-- Migration 018: Learning System Application Log
-- S ref: S29.4 (application recording), I-03 (audit), R-07 (no FK)
-- Phase: 4E-2c
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- Application log table
-- Append-only record of technique applications per interaction.
-- No FK to learning_techniques (R-07) — techniques may be
-- tombstoned while application history is preserved for audit.
-- ────────────────────────────────────────────────────────────

CREATE TABLE learning_applications (
  id              TEXT    PRIMARY KEY,
  technique_id    TEXT    NOT NULL,
  interaction_id  TEXT    NOT NULL,
  tenant_id       TEXT    NOT NULL,
  timestamp       TEXT    NOT NULL,
  applied         INTEGER NOT NULL DEFAULT 1  -- 1=applied, 0=skipped due to context limits (S29.4)
);

-- ────────────────────────────────────────────────────────────
-- Indexes
-- Primary: technique-level aggregation for effectiveness tracking
-- Secondary: tenant-scoped queries for tenant isolation
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_la_technique ON learning_applications(technique_id);
CREATE INDEX idx_la_tenant_technique ON learning_applications(tenant_id, technique_id);

-- ────────────────────────────────────────────────────────────
-- Tenant immutability trigger (same pattern as Phase 4B, 4E-2a)
-- Prevents tenant_id from being changed after INSERT.
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER learning_applications_tenant_immutable
  BEFORE UPDATE OF tenant_id ON learning_applications
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on learning_applications');
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
 * Get Phase 4E-2c (Learning Applications) migration.
 * Version 18 continues from Phase 4E-2d's version 17 (learning_outcomes).
 */
export function getPhase4E2cApplicationsMigration(): MigrationEntry[] {
  return [
    buildEntry(18, 'learning_applications', MIGRATION_018_SQL),
  ];
}
