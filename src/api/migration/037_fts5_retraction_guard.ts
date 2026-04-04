/**
 * Migration v46: FTS5 retraction zombie fix.
 * Phase 5: Data integrity — prevent retracted claims from haunting the search index.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md, CLAUDE.md DC-1 (Data integrity)
 *
 * Problem: The AFTER UPDATE trigger (claims_fts_au) from migration 037 re-inserts
 * claims into the FTS5 index whenever subject IS NOT NULL. But retraction only sets
 * status='retracted' without NULLing subject. Result: retracted claims remain
 * searchable — "zombie" entries in the search index.
 *
 * Fix: Drop and recreate the AFTER UPDATE trigger with a guard that:
 *   1. Only re-inserts when NEW.status = 'active' AND NEW.subject IS NOT NULL
 *   2. When status changes to 'retracted', the old entry is deleted (first half
 *      of trigger) but never re-inserted (guard blocks second half)
 *
 * Invariants: I-P2-03 (retracted exclusion), I-P2-04 (tombstone removal)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_046_SQL = `
-- Migration 046: FTS5 retraction zombie fix
-- Phase 5: Fix claims_fts_au trigger to exclude retracted claims from search index.
-- Spec ref: I-P2-03 (retracted exclusion), I-P2-04 (tombstone removal)

-- Drop the old AFTER UPDATE trigger that re-inserts retracted claims
DROP TRIGGER IF EXISTS claims_fts_au;

-- Recreate with status guard: only re-insert when active AND not tombstoned
CREATE TRIGGER IF NOT EXISTS claims_fts_au
  AFTER UPDATE ON claim_assertions
BEGIN
  -- Remove old entry (always — whether retracted, tombstoned, or content changed)
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
  -- Re-insert ONLY if active and not tombstoned (subject NULL = tombstoned)
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, id)
  SELECT NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id
  WHERE NEW.subject IS NOT NULL AND NEW.status = 'active';
END;

-- Purge existing retracted claims from the FTS5 index.
-- These are the zombies that accumulated before this fix.
-- For each retracted claim, issue a 'delete' command to FTS5.
INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, id)
SELECT 'delete', ca.rowid, ca.subject, ca.predicate, ca.object_value, ca.tenant_id, ca.status, ca.id
FROM claim_assertions ca
WHERE ca.status = 'retracted' AND ca.subject IS NOT NULL;
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getFts5RetractionGuardMigrations(): MigrationEntry[] {
  return [buildEntry(46, 'fts5_retraction_guard', MIGRATION_046_SQL)];
}
