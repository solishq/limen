/**
 * Migration v43: Governance Suite.
 * Phase 10: Classification, protected predicates, GDPR erasure.
 *
 * Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   1. ALTER TABLE claim_assertions ADD COLUMN classification TEXT NOT NULL DEFAULT 'unrestricted'
 *   2. ALTER TABLE claim_assertions ADD COLUMN classification_rule_id TEXT DEFAULT NULL
 *   3. CREATE TABLE governance_classification_rules
 *   4. CREATE TABLE governance_protected_predicates
 *   5. CREATE TABLE governance_erasure_certificates
 *   6. Indexes on pattern columns and data_subject_id
 *   7. Tenant isolation triggers
 *
 * Additive only. No drops. No column modifications.
 * Existing claims get classification='unrestricted' (correct — not classified yet).
 *
 * Invariants: I-P10-40 (backward compatibility), I-P10-41 (dormant RBAC preservation)
 * DCs: DC-P10-601 (additive only), DC-P10-602 (no RBAC activation)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_043_SQL = `
-- Migration 043: Governance Suite
-- Phase 10: Classification, protected predicates, GDPR erasure certificates
-- Spec ref: PHASE-10-DESIGN-SOURCE.md (Output 6)

-- ============================================================================
-- 1. Add classification level to claim_assertions.
-- TEXT NOT NULL DEFAULT 'unrestricted'. Pre-existing claims get 'unrestricted'.
-- I-P10-40: Existing claims retain data, classification = 'unrestricted'.
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN classification TEXT NOT NULL DEFAULT 'unrestricted';

-- ============================================================================
-- 2. Add classification rule reference to claim_assertions.
-- TEXT, nullable. NULL = default level (no rule matched).
-- I-P10-02: classification_rule_id is NULL when no rule matches.
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN classification_rule_id TEXT DEFAULT NULL;

-- ============================================================================
-- 3. Classification rules table.
-- Governance classification rules mapping predicate patterns to levels.
-- ============================================================================

CREATE TABLE IF NOT EXISTS governance_classification_rules (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT,
  predicate_pattern TEXT NOT NULL,
  level             TEXT NOT NULL CHECK (level IN ('unrestricted','internal','confidential','restricted','critical')),
  reason            TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- ============================================================================
-- 4. Protected predicate rules table.
-- Maps predicate patterns to required permissions for assert/retract.
-- ============================================================================

CREATE TABLE IF NOT EXISTS governance_protected_predicates (
  id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id             TEXT,
  predicate_pattern     TEXT NOT NULL,
  required_permission   TEXT NOT NULL,
  action                TEXT NOT NULL DEFAULT 'both' CHECK (action IN ('assert','retract','both')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- ============================================================================
-- 5. Erasure certificates table (permanent record of compliance actions).
-- ============================================================================

CREATE TABLE IF NOT EXISTS governance_erasure_certificates (
  id                        TEXT PRIMARY KEY NOT NULL,
  tenant_id                 TEXT,
  data_subject_id           TEXT NOT NULL,
  requested_at              TEXT NOT NULL,
  completed_at              TEXT NOT NULL,
  claims_tombstoned         INTEGER NOT NULL,
  audit_entries_tombstoned  INTEGER NOT NULL,
  relationships_cascaded    INTEGER NOT NULL,
  consent_records_revoked   INTEGER NOT NULL,
  chain_valid               INTEGER NOT NULL,
  chain_head_hash           TEXT NOT NULL,
  certificate_hash          TEXT NOT NULL,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- ============================================================================
-- 6. Indexes.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_gov_class_rules_pattern ON governance_classification_rules(predicate_pattern);
CREATE INDEX IF NOT EXISTS idx_gov_protected_pattern ON governance_protected_predicates(predicate_pattern);
CREATE INDEX IF NOT EXISTS idx_gov_erasure_subject ON governance_erasure_certificates(data_subject_id);

-- ============================================================================
-- 7. Tenant isolation triggers.
-- Pattern matches existing triggers (004_tenant_isolation.ts).
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS gov_class_rules_tenant_immutable
  BEFORE UPDATE OF tenant_id ON governance_classification_rules
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on governance_classification_rules');
  END;

CREATE TRIGGER IF NOT EXISTS gov_protected_pred_tenant_immutable
  BEFORE UPDATE OF tenant_id ON governance_protected_predicates
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on governance_protected_predicates');
  END;

CREATE TRIGGER IF NOT EXISTS gov_erasure_cert_tenant_immutable
  BEFORE UPDATE OF tenant_id ON governance_erasure_certificates
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on governance_erasure_certificates');
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

export function getGovernanceSuiteMigrations(): MigrationEntry[] {
  return [buildEntry(43, 'governance_suite', MIGRATION_043_SQL)];
}
