/**
 * Migration v42: Security Hardening.
 * Phase 9: Security Hardening.
 *
 * Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 6)
 *
 * Schema changes:
 *   1. ALTER TABLE claim_assertions ADD COLUMN pii_detected INTEGER NOT NULL DEFAULT 0
 *   2. ALTER TABLE claim_assertions ADD COLUMN pii_categories TEXT DEFAULT NULL
 *   3. ALTER TABLE claim_assertions ADD COLUMN content_scan_result TEXT DEFAULT NULL
 *   4. CREATE TABLE security_consent (consent tracking)
 *   5. CREATE INDEX idx_security_consent_subject
 *   6. CREATE TRIGGER security_consent_tenant_immutable
 *
 * Additive only. No drops. No column modifications.
 * Existing claims get pii_detected=0 (correct — not scanned).
 *
 * Invariants: I-P9-05 (backward compatibility), I-P9-24 (tenant isolation)
 * DCs: DC-P9-601 (additive only), DC-P9-602 (pre-Phase-9 claims unaffected)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_042_SQL = `
-- Migration 042: Security Hardening
-- Phase 9: PII detection, consent tracking, poisoning defense
-- Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 6)

-- ============================================================================
-- 1. Add PII detection flag to claim_assertions.
-- INTEGER NOT NULL DEFAULT 0. 0 = not detected/not scanned, 1 = PII detected.
-- I-P9-05: Existing claims default to 0.
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN pii_detected INTEGER NOT NULL DEFAULT 0;

-- ============================================================================
-- 2. Add PII categories column to claim_assertions.
-- TEXT, nullable. JSON array of PiiCategory strings when PII found.
-- NULL = not scanned or no PII found.
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN pii_categories TEXT DEFAULT NULL;

-- ============================================================================
-- 3. Add content scan result column to claim_assertions.
-- TEXT, nullable. JSON blob: ContentScanResult (PII + injection scan).
-- NULL = scan not performed (backward compat for pre-Phase-9 claims).
-- ============================================================================

ALTER TABLE claim_assertions ADD COLUMN content_scan_result TEXT DEFAULT NULL;

-- ============================================================================
-- 4. Create consent tracking table.
-- I-P9-20: id, dataSubjectId, basis, scope, grantedAt immutable after creation.
-- I-P9-21: Terminal states (revoked, expired) cannot transition to active.
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_consent (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT,
  data_subject_id TEXT NOT NULL,
  basis           TEXT NOT NULL CHECK (basis IN ('explicit_consent', 'contract_performance', 'legal_obligation', 'legitimate_interest')),
  scope           TEXT NOT NULL,
  granted_at      TEXT NOT NULL,
  expires_at      TEXT,
  revoked_at      TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
);

-- ============================================================================
-- 5. Index for consent lookups by data subject.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_security_consent_subject
  ON security_consent(data_subject_id, scope, status);

-- ============================================================================
-- 6. Tenant isolation trigger for consent table.
-- I-P9-24: tenant_id is immutable after creation.
-- Pattern matches 004_tenant_isolation.ts.
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS security_consent_tenant_immutable
  BEFORE UPDATE OF tenant_id ON security_consent
  WHEN OLD.tenant_id IS NOT NEW.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'tenant_id is immutable on security_consent');
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

export function getSecurityHardeningMigrations(): MigrationEntry[] {
  return [buildEntry(42, 'security_hardening', MIGRATION_042_SQL)];
}
