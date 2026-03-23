/**
 * Forward-only migration v20: Learning System Transfer Requests
 * S ref: S29.8 (cross-agent transfer protocol), I-07 (agent isolation), DEC-4E-002
 *
 * Phase: 4E-2e (Certification — Learning System Convergence Subsystems)
 *
 * Adds:
 *   - learning_transfer_requests table (transfer lifecycle tracking)
 *   - Index for tenant + status (pending request queries)
 *   - Tenant immutability trigger (same pattern as Phase 4B)
 *
 * Schema derives from TransferRequest interface in learning_types.ts:
 *   id, tenant_id, source_agent_id, target_agent_id, technique_id,
 *   status, created_at, resolved_at
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v20: Learning Transfer Requests Table ───

const MIGRATION_020_SQL = `
-- Migration 020: Learning System Transfer Requests
-- S ref: S29.8 (cross-agent transfer), DEC-4E-002 (cross-tenant blocked)
-- Phase: 4E-2e
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- Transfer requests track cross-agent technique transfers.
-- Single tenant_id field — cross-tenant structurally impossible (DEC-4E-002).
-- No FK to learning_techniques — request survives technique lifecycle.
-- ────────────────────────────────────────────────────────────

CREATE TABLE learning_transfer_requests (
  id                TEXT    PRIMARY KEY,
  tenant_id         TEXT    NOT NULL,
  source_agent_id   TEXT    NOT NULL,
  target_agent_id   TEXT    NOT NULL,
  technique_id      TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at        TEXT    NOT NULL,
  resolved_at       TEXT
);

-- ────────────────────────────────────────────────────────────
-- Indexes
-- Primary access pattern: pending requests by tenant
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_ltr_tenant_status ON learning_transfer_requests(tenant_id, status);

-- ────────────────────────────────────────────────────────────
-- Tenant immutability trigger (same pattern as Phase 4B)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER learning_transfer_requests_tenant_immutable
  BEFORE UPDATE OF tenant_id ON learning_transfer_requests
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on learning_transfer_requests');
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
 * Get Phase 4E-2e (Learning CrossAgentTransfer) migration.
 * Version 20 continues from Phase 4E-2e's quarantine migration v19.
 */
export function getPhase4E2eTransferMigration(): MigrationEntry[] {
  return [
    buildEntry(20, 'learning_transfer_requests', MIGRATION_020_SQL),
  ];
}
