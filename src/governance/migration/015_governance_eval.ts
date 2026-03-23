/**
 * Migration v24: Governance eval cases.
 * Truth Model: Deliverable 8 (Eval Schema)
 *
 * Phase: 0A (Foundation)
 *
 * Tables: gov_eval_cases
 *
 * BC-090: EvalCase is immutable once created.
 * BC-091: Created atomically with result finalization.
 * BC-092: References MissionContractId (not a copy).
 * BC-093: Carries pinnedVersions for replay stability.
 * BC-094: EvalProvenance includes agent/capability/prompt metadata.
 * INV-X04: schemaVersion on every entity.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_024_SQL = `
-- Migration 024: Governance eval cases
-- Truth Model: Deliverable 8

-- gov_eval_cases: Immutable evaluation records (BC-090)
CREATE TABLE gov_eval_cases (
  eval_case_id            TEXT    PRIMARY KEY,
  tenant_id               TEXT    NOT NULL,
  attempt_id              TEXT    NOT NULL,
  contract_id             TEXT,
  dimensions              TEXT    NOT NULL,
  provenance              TEXT    NOT NULL,
  pinned_versions         TEXT    NOT NULL,
  contract_satisfaction   INTEGER,
  schema_version          TEXT    NOT NULL,
  created_at              TEXT    NOT NULL
);

CREATE INDEX idx_gov_eval_cases_tenant ON gov_eval_cases (tenant_id);
CREATE INDEX idx_gov_eval_cases_attempt ON gov_eval_cases (attempt_id);
CREATE INDEX idx_gov_eval_cases_contract ON gov_eval_cases (contract_id)
  WHERE contract_id IS NOT NULL;

-- BC-090: Eval cases are immutable — no UPDATE.
CREATE TRIGGER gov_eval_cases_no_update
  BEFORE UPDATE ON gov_eval_cases
  BEGIN
    SELECT RAISE(ABORT, 'BC-090: Eval cases are immutable. UPDATE is prohibited.');
  END;

-- BC-090: Eval cases are immutable — no DELETE.
CREATE TRIGGER gov_eval_cases_no_delete
  BEFORE DELETE ON gov_eval_cases
  BEGIN
    SELECT RAISE(ABORT, 'BC-090: Eval cases are immutable. DELETE is prohibited.');
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

export function getGovernanceEvalMigrations(): MigrationEntry[] {
  return [buildEntry(24, 'governance_eval', MIGRATION_024_SQL)];
}
