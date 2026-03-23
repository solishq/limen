/**
 * Forward-only migration v19: Learning System Quarantine Entries
 * S ref: S29.7 (quarantine cascade), FM-01 (memory poisoning defense), I-03 (audit)
 *
 * Phase: 4E-2e (Certification — Learning System Convergence Subsystems)
 *
 * Adds:
 *   - learning_quarantine_entries table (quarantine tracking)
 *   - Index for tenant + resolution status (getPending queries)
 *   - Tenant immutability trigger (same pattern as Phase 4B)
 *
 * Schema derives from QuarantineEntry interface in learning_types.ts:
 *   id, technique_id, agent_id, tenant_id, reason,
 *   quarantined_at, resolved_at, resolution
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v19: Learning Quarantine Entries Table ───

const MIGRATION_019_SQL = `
-- Migration 019: Learning System Quarantine Entries
-- S ref: S29.7 (quarantine cascade), FM-01 (memory poisoning defense)
-- Phase: 4E-2e
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- Quarantine entries track technique suspensions from FM-01.
-- Resolution requires human authority (HITL review).
-- No FK to learning_techniques — entries survive technique lifecycle.
-- ────────────────────────────────────────────────────────────

CREATE TABLE learning_quarantine_entries (
  id              TEXT    PRIMARY KEY,
  technique_id    TEXT    NOT NULL,
  agent_id        TEXT    NOT NULL,
  tenant_id       TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  quarantined_at  TEXT    NOT NULL,
  resolved_at     TEXT,
  resolution      TEXT    CHECK (resolution IS NULL OR resolution IN ('reactivated', 'permanently_retired')),
  created_at      TEXT    NOT NULL
);

-- ────────────────────────────────────────────────────────────
-- Indexes
-- Primary access pattern: getPending queries tenant + unresolved
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_lqe_tenant_pending ON learning_quarantine_entries(tenant_id, resolved_at);

-- ────────────────────────────────────────────────────────────
-- Tenant immutability trigger (same pattern as Phase 4B)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER learning_quarantine_entries_tenant_immutable
  BEFORE UPDATE OF tenant_id ON learning_quarantine_entries
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on learning_quarantine_entries');
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
 * Get Phase 4E-2e (Learning QuarantineManager) migration.
 * Version 19 continues from Phase 4E-2d's version 18.
 */
export function getPhase4E2eQuarantineMigration(): MigrationEntry[] {
  return [
    buildEntry(19, 'learning_quarantine_entries', MIGRATION_019_SQL),
  ];
}
