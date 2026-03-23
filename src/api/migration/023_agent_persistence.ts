/**
 * Migration v32: Agent persistence + Capability results.
 * Spec ref: I-08 (Agent Identity Persistence), CCP-02 (Capability Results)
 *
 * Phase: Sprint 1 (Foundation Layer)
 * Tables: core_agents, core_capability_results
 *
 * Invariants enforced:
 *   I-08: Agent identity persists across engine restarts
 *   I-08: Agent version immutable once deployed
 *   I-08: Agent name immutable once registered
 *   I-08: Retired agents are terminal (cannot be modified)
 *   CCP-02: Capability results are append-only (no update, no delete)
 *
 * Triggers:
 *   trg_core_agents_version_immutable: Blocks version field mutation
 *   trg_core_agents_name_immutable: Blocks name field mutation
 *   trg_core_agents_id_immutable: Blocks id field mutation
 *   trg_core_agents_retired_terminal: Blocks mutation of retired agents
 *   trg_core_agents_trust_admin_guard: Blocks trust escalation to admin
 *   trg_capability_results_no_update: Blocks updates on capability results
 *   trg_capability_results_no_delete: Blocks deletes on capability results
 *
 * Indexes:
 *   idx_core_agents_tenant_name: Unique (tenant_id, name) for uniqueness enforcement
 *   idx_core_agents_tenant_status: Tenant-scoped status filtering
 *   idx_core_capability_results_tenant: Tenant-scoped mission lookup
 *   idx_core_capability_results_mission: Mission-task scoped lookup
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_032_SQL = `
-- Migration 032: Agent Persistence + Capability Results
-- Sprint 1: Foundation Layer
-- Spec ref: I-08 (Agent Identity Persistence), CCP-02 (Capability Results)

-- ============================================================================
-- Table: core_agents — I-08 (Agent Identity Persistence)
-- Persistent agent registry replacing ephemeral in-memory Map.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_agents (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  trust_level TEXT NOT NULL DEFAULT 'untrusted'
    CHECK(trust_level IN ('untrusted', 'probationary', 'trusted', 'admin')),
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK(status IN ('registered', 'active', 'paused', 'retired')),
  system_prompt TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  domains TEXT NOT NULL DEFAULT '[]',
  template TEXT,
  hitl INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_agents_tenant_name
  ON core_agents(COALESCE(tenant_id, '__NULL__'), name);

CREATE INDEX IF NOT EXISTS idx_core_agents_tenant_status
  ON core_agents(tenant_id, status);

-- Version immutability
CREATE TRIGGER IF NOT EXISTS trg_core_agents_version_immutable
BEFORE UPDATE OF version ON core_agents
WHEN NEW.version != OLD.version
BEGIN
  SELECT RAISE(ABORT, 'AGENT_VERSION_IMMUTABLE: agent version cannot be changed after creation');
END;

-- Name immutability
CREATE TRIGGER IF NOT EXISTS trg_core_agents_name_immutable
BEFORE UPDATE OF name ON core_agents
WHEN NEW.name != OLD.name
BEGIN
  SELECT RAISE(ABORT, 'AGENT_NAME_IMMUTABLE: agent name cannot be changed after creation');
END;

-- ID immutability
CREATE TRIGGER IF NOT EXISTS trg_core_agents_id_immutable
BEFORE UPDATE OF id ON core_agents
WHEN NEW.id != OLD.id
BEGIN
  SELECT RAISE(ABORT, 'AGENT_ID_IMMUTABLE: agent ID cannot be changed after creation');
END;

-- Retired agents are terminal — ALL mutations blocked (F-S1-001)
CREATE TRIGGER IF NOT EXISTS trg_core_agents_retired_terminal
BEFORE UPDATE ON core_agents
WHEN OLD.status = 'retired'
BEGIN
  SELECT RAISE(ABORT, 'AGENT_RETIRED_TERMINAL: retired agents cannot be modified');
END;

-- Trust escalation to admin blocked (until Sprint 2 trust progression)
CREATE TRIGGER IF NOT EXISTS trg_core_agents_trust_admin_guard
BEFORE UPDATE OF trust_level ON core_agents
WHEN NEW.trust_level = 'admin' AND OLD.trust_level != 'admin'
BEGIN
  SELECT RAISE(ABORT, 'AGENT_TRUST_ESCALATION: admin trust requires governance approval');
END;

-- ============================================================================
-- Table: core_capability_results — CCP-02 (Capability Result Persistence)
-- Append-only record of capability execution results for evidence chain.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_capability_results (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  mission_id TEXT NOT NULL,
  task_id TEXT,
  capability_type TEXT NOT NULL
    CHECK(capability_type IN ('web_search', 'web_fetch', 'code_execute', 'data_query', 'file_read', 'file_write', 'api_call')),
  parameters_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  result_size INTEGER NOT NULL,
  tokens_consumed INTEGER NOT NULL DEFAULT 0,
  time_consumed_ms INTEGER NOT NULL DEFAULT 0,
  compute_consumed INTEGER NOT NULL DEFAULT 0,
  storage_consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES core_missions(id)
);

CREATE INDEX IF NOT EXISTS idx_core_capability_results_tenant
  ON core_capability_results(tenant_id, mission_id);

CREATE INDEX IF NOT EXISTS idx_core_capability_results_mission
  ON core_capability_results(mission_id, task_id);

-- Immutability (append-only, no updates or deletes)
CREATE TRIGGER IF NOT EXISTS trg_capability_results_no_update
BEFORE UPDATE ON core_capability_results
BEGIN
  SELECT RAISE(ABORT, 'CAPABILITY_RESULT_IMMUTABLE: capability results are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_capability_results_no_delete
BEFORE DELETE ON core_capability_results
BEGIN
  SELECT RAISE(ABORT, 'CAPABILITY_RESULT_NO_DELETE: capability results cannot be deleted');
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

export function getAgentPersistenceMigrations(): MigrationEntry[] {
  return [buildEntry(32, 'agent_persistence_capability_results', MIGRATION_032_SQL)];
}
