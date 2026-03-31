/**
 * Migration v37: FTS5 Full-Text Search Index.
 * Phase 2: Make knowledge findable.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (2.1, 2.2), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md C.9
 *
 * Schema changes:
 *   - Creates `claims_fts` FTS5 virtual table (external content mode over claim_assertions)
 *   - Creates AFTER INSERT/UPDATE/DELETE triggers to keep FTS5 in sync
 *   - Rebuilds index from existing claims
 *
 * Tokenizer: unicode61 with tokenchars ".:_-" to preserve URN/predicate structure.
 * NOTE (PA Amendment 1): This means "preference.food" is a SINGLE token.
 * A search for "food" alone will NOT match via this table.
 * Latin substring searches fall back to the trigram table (029_fts5_cjk.ts).
 *
 * External content mode: content='claim_assertions', content_rowid='rowid'.
 * Zero data duplication -- FTS5 stores only the inverted index.
 *
 * Invariants: I-P2-01 (sync correctness), I-P2-02 (tenant isolation via UNINDEXED),
 *             I-P2-04 (tombstone removal)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_037_SQL = `
-- Migration 037: FTS5 Full-Text Search Index
-- Phase 2: Make knowledge findable.
-- Spec ref: LIMEN_BUILD_PHASES.md (2.1, 2.2), ADDENDUM C.9

-- ============================================================================
-- Table: claims_fts -- FTS5 external content index over claim_assertions
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(
  subject,
  predicate,
  object_value,
  tenant_id UNINDEXED,
  status UNINDEXED,
  id UNINDEXED,
  content='claim_assertions',
  content_rowid='rowid',
  tokenize="unicode61 tokenchars '.:_-'"
);

-- ============================================================================
-- Sync Triggers: Keep FTS5 index synchronized with claim_assertions
-- ============================================================================

-- AFTER INSERT: Index new claims (guard against NULL subject for safety)
CREATE TRIGGER IF NOT EXISTS claims_fts_ai
  AFTER INSERT ON claim_assertions
  WHEN NEW.subject IS NOT NULL
BEGIN
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, id)
  VALUES (NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id);
END;

-- AFTER DELETE: Remove from index
CREATE TRIGGER IF NOT EXISTS claims_fts_ad
  AFTER DELETE ON claim_assertions
BEGIN
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
END;

-- AFTER UPDATE: Remove old entry, conditionally re-insert new entry
-- Handles: status changes (active->retracted), tombstone (content NULLed), archive flag
CREATE TRIGGER IF NOT EXISTS claims_fts_au
  AFTER UPDATE ON claim_assertions
BEGIN
  -- Remove old entry
  INSERT INTO claims_fts(claims_fts, rowid, subject, predicate, object_value, tenant_id, status, id)
  VALUES ('delete', OLD.rowid, OLD.subject, OLD.predicate, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
  -- Re-insert only if not tombstoned (subject NULL = tombstoned)
  INSERT INTO claims_fts(rowid, subject, predicate, object_value, tenant_id, status, id)
  SELECT NEW.rowid, NEW.subject, NEW.predicate, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id
  WHERE NEW.subject IS NOT NULL;
END;

-- ============================================================================
-- Rebuild: Index existing claims (forward migration for pre-Phase-2 databases)
-- ============================================================================

INSERT INTO claims_fts(claims_fts) VALUES('rebuild');
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getFts5SearchMigrations(): MigrationEntry[] {
  return [buildEntry(37, 'fts5_search', MIGRATION_037_SQL)];
}
