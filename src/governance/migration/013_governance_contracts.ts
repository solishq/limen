/**
 * Migration v22: Governance mission contracts and constitutional mode.
 * Truth Model: Deliverable 4 (Mission Contract Schema)
 *
 * Phase: 0A (Foundation)
 *
 * Tables: gov_mission_contracts
 * Config: core_config entry for constitutional_mode per tenant
 *
 * BC-030: MissionContract entity with criteria array.
 * BC-031: Contract created before or atomically with mission.
 * BC-033: Contract immutable once created — no UPDATE.
 * BC-038: constitutionalMode stored in core_config, not gov_ tables.
 * INV-X04: schemaVersion on every entity.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_022_SQL = `
-- Migration 022: Governance mission contracts
-- Truth Model: Deliverable 4

-- gov_mission_contracts: Immutable mission contract (BC-030, BC-033)
CREATE TABLE gov_mission_contracts (
  contract_id     TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  mission_id      TEXT    NOT NULL,
  criteria        TEXT    NOT NULL,
  schema_version  TEXT    NOT NULL,
  created_at      TEXT    NOT NULL
);

CREATE INDEX idx_gov_mission_contracts_tenant ON gov_mission_contracts (tenant_id);
CREATE INDEX idx_gov_mission_contracts_mission ON gov_mission_contracts (mission_id);

-- BC-033: Contracts are immutable — no UPDATE.
CREATE TRIGGER gov_mission_contracts_no_update
  BEFORE UPDATE ON gov_mission_contracts
  BEGIN
    SELECT RAISE(ABORT, 'BC-033: Mission contracts are immutable. UPDATE is prohibited.');
  END;

-- BC-033: Contracts are immutable — no DELETE.
CREATE TRIGGER gov_mission_contracts_no_delete
  BEFORE DELETE ON gov_mission_contracts
  BEGIN
    SELECT RAISE(ABORT, 'BC-033: Mission contracts are immutable. DELETE is prohibited.');
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

export function getGovernanceContractsMigrations(): MigrationEntry[] {
  return [buildEntry(22, 'governance_contracts', MIGRATION_022_SQL)];
}
