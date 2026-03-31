/**
 * Migration v38: FTS5 CJK Trigram Index.
 * Phase 2: CJK content search support + Latin substring matching.
 *
 * Spec ref: LIMEN_DEFINITIVE_SPEC_ADDENDUM.md C.9
 *
 * Schema changes:
 *   - Creates `claims_fts_cjk` FTS5 virtual table (trigram tokenizer)
 *   - Creates AFTER INSERT/UPDATE/DELETE triggers to keep in sync
 *   - Rebuilds index from existing claims
 *
 * Tokenizer: trigram -- indexes all object_value content as character trigrams.
 * Primary use: CJK content that unicode61 cannot tokenize meaningfully.
 * Secondary use: Substring matching for ALL content (Latin, CJK, mixed).
 *
 * Design Source Decision 3 (Approach C): All-claims trigram secondary index.
 * Indexes object_value only (subject/predicate are structured, not CJK).
 *
 * Invariants: I-P2-01 (sync correctness), I-P2-08 (CJK searchability),
 *             I-P2-11 (substring via trigram)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_038_SQL = `
-- Migration 038: FTS5 CJK Trigram Index
-- Phase 2: CJK content search support.
-- Spec ref: LIMEN_DEFINITIVE_SPEC_ADDENDUM.md C.9

-- ============================================================================
-- Table: claims_fts_cjk -- FTS5 trigram index for CJK/substring search
-- ============================================================================

CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts_cjk USING fts5(
  object_value,
  tenant_id UNINDEXED,
  status UNINDEXED,
  id UNINDEXED,
  content='claim_assertions',
  content_rowid='rowid',
  tokenize='trigram'
);

-- ============================================================================
-- Sync Triggers
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS claims_fts_cjk_ai
  AFTER INSERT ON claim_assertions
  WHEN NEW.object_value IS NOT NULL
BEGIN
  INSERT INTO claims_fts_cjk(rowid, object_value, tenant_id, status, id)
  VALUES (NEW.rowid, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS claims_fts_cjk_ad
  AFTER DELETE ON claim_assertions
BEGIN
  INSERT INTO claims_fts_cjk(claims_fts_cjk, rowid, object_value, tenant_id, status, id)
  VALUES ('delete', OLD.rowid, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS claims_fts_cjk_au
  AFTER UPDATE ON claim_assertions
BEGIN
  INSERT INTO claims_fts_cjk(claims_fts_cjk, rowid, object_value, tenant_id, status, id)
  VALUES ('delete', OLD.rowid, OLD.object_value, OLD.tenant_id, OLD.status, OLD.id);
  INSERT INTO claims_fts_cjk(rowid, object_value, tenant_id, status, id)
  SELECT NEW.rowid, NEW.object_value, NEW.tenant_id, NEW.status, NEW.id
  WHERE NEW.object_value IS NOT NULL;
END;

-- ============================================================================
-- Rebuild
-- ============================================================================

INSERT INTO claims_fts_cjk(claims_fts_cjk) VALUES('rebuild');
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getFts5CjkMigrations(): MigrationEntry[] {
  return [buildEntry(38, 'fts5_cjk', MIGRATION_038_SQL)];
}
