/**
 * Migration v23: Governance supervisor decisions and suspension records.
 * Truth Model: Deliverable 5 (Supervisor Decision Model)
 *
 * Phase: 0A (Foundation)
 *
 * Tables: gov_supervisor_decisions, gov_suspension_records
 *
 * BC-060: SupervisorDecision entity — immutable once created.
 * BC-062: SuspensionRecord with state machine (active → resolved/expired/revoked).
 * BC-065: At most one active suspension per target (enforced at application layer).
 * INV-X05: Suspension is never a lifecycle state — orthogonal to entity states.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_023_SQL = `
-- Migration 023: Governance supervisor decisions and suspension records
-- Truth Model: Deliverable 5

-- gov_supervisor_decisions: Immutable decision records (BC-060)
CREATE TABLE gov_supervisor_decisions (
  decision_id         TEXT    PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  correlation_id      TEXT    NOT NULL,
  supervisor_type     TEXT    NOT NULL,
  outcome             TEXT    NOT NULL,
  rationale           TEXT,
  conditions          TEXT,
  suspension_record_id TEXT,
  schema_version      TEXT    NOT NULL,
  created_at          TEXT    NOT NULL
);

CREATE INDEX idx_gov_decisions_tenant ON gov_supervisor_decisions (tenant_id);
CREATE INDEX idx_gov_decisions_correlation ON gov_supervisor_decisions (correlation_id);
CREATE INDEX idx_gov_decisions_suspension ON gov_supervisor_decisions (suspension_record_id)
  WHERE suspension_record_id IS NOT NULL;

-- Decisions are immutable — no UPDATE.
CREATE TRIGGER gov_supervisor_decisions_no_update
  BEFORE UPDATE ON gov_supervisor_decisions
  BEGIN
    SELECT RAISE(ABORT, 'BC-060: Supervisor decisions are immutable. UPDATE is prohibited.');
  END;

-- gov_suspension_records: Suspension lifecycle (BC-062)
CREATE TABLE gov_suspension_records (
  suspension_record_id    TEXT    PRIMARY KEY,
  tenant_id               TEXT    NOT NULL,
  target_type             TEXT    NOT NULL,
  target_id               TEXT    NOT NULL,
  state                   TEXT    NOT NULL CHECK (state IN ('active', 'resolved', 'expired', 'revoked')),
  reason                  TEXT    NOT NULL,
  schema_version          TEXT    NOT NULL,
  created_at              TEXT    NOT NULL,
  resolved_at             TEXT,
  resolution_decision_id  TEXT    REFERENCES gov_supervisor_decisions(decision_id)
);

CREATE INDEX idx_gov_suspensions_tenant ON gov_suspension_records (tenant_id);
CREATE INDEX idx_gov_suspensions_target ON gov_suspension_records (target_type, target_id);
CREATE INDEX idx_gov_suspensions_active ON gov_suspension_records (target_type, target_id, state)
  WHERE state = 'active';
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getGovernanceSupervisorMigrations(): MigrationEntry[] {
  return [buildEntry(23, 'governance_supervisor', MIGRATION_023_SQL)];
}
