/**
 * Forward-only migration v15: GDPR Audit Trail Tombstone Support
 * S ref: I-06 (audit immutability), I-02 (user data ownership), GDPR Art. 17
 *
 * Phase: 4D-4 (Certification — Data Integrity & Contract Completion)
 * Finding: CF-035
 *
 * Adds:
 *   - core_audit_tombstone_active flag table (same pattern as core_audit_archive_active)
 *   - Drops and recreates the UPDATE trigger to check the tombstone flag
 *
 * The tombstone flag permits UPDATE on core_audit_log ONLY during a GDPR
 * tombstone operation. Outside of tombstoning, UPDATE remains prohibited (I-06).
 *
 * Design rationale: Separate flag table from archive (not reusing core_audit_archive_active)
 * because archive (DELETE) and tombstone (UPDATE) are semantically distinct operations
 * with different security implications.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v15: Audit Tombstone Support (CF-035) ───

const MIGRATION_015_SQL = `
-- Migration 015: GDPR Audit Trail Tombstone Support
-- S ref: I-06 (audit immutability — tombstone bypass), I-02 (data ownership), GDPR Art. 17
-- Finding: CF-035 (GDPR tombstones for audit trail)
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- Flag table for tombstone bypass
-- When a row exists, UPDATE is permitted on core_audit_log.
-- Flag is set and cleared within a single transaction during tombstone().
-- ────────────────────────────────────────────────────────────

CREATE TABLE core_audit_tombstone_active (
  id INTEGER PRIMARY KEY CHECK (id = 1)
);

-- ────────────────────────────────────────────────────────────
-- Replace UPDATE trigger to check tombstone flag
-- Original trigger (migration 001) unconditionally blocks UPDATE.
-- New trigger allows UPDATE when tombstone operation is in progress.
-- ────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS core_audit_log_no_update;

CREATE TRIGGER core_audit_log_no_update
  BEFORE UPDATE ON core_audit_log
  WHEN NOT EXISTS (SELECT 1 FROM core_audit_tombstone_active WHERE id = 1)
  BEGIN
    SELECT RAISE(ABORT, 'I-06: Audit entries are append-only. UPDATE is prohibited.');
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
 * Get Phase 4D-4 (GDPR Tombstone) migration.
 * Version 15 continues from Phase 4D-2's version 14.
 * CF-035: Adds tombstone bypass flag and modifies UPDATE trigger.
 */
export function getPhase4D4TombstoneMigrations(): MigrationEntry[] {
  return [
    buildEntry(15, 'audit_tombstone_support', MIGRATION_015_SQL),
  ];
}
