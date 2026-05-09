// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Migration v48: Agent Lifecycle Management Tables
 *
 * LM-2, LM-3, LM-4, LM-6: Creates 4 tables for the Agent Lifecycle subsystem.
 *
 * Schema changes:
 *   1. CREATE TABLE lm_agents (agent registration records)
 *   2. CREATE TABLE lm_capabilities (capability registry per agent)
 *   3. CREATE TABLE lm_capability_history (audit trail for capability changes)
 *   4. CREATE TABLE lm_agent_consents (consent records per agent)
 *
 * Additive only. No ALTER, no DROP. Forward-only (AD-12).
 * Idempotent: IF NOT EXISTS on all tables. Running twice is safe (LM-16.05).
 *
 * Invariants:
 *   - LM-13.01: AgentId is PRIMARY KEY (identity immutability)
 *   - LM-13.02: UNIQUE(name, framework, tenant_id) enforces uniqueness
 *   - LM-10.06: state CHECK constraint limits to valid values
 *   - LM-5.01: trust_level CHECK constraint limits to 5-level model
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_048_SQL = `
-- Migration 048: Agent Lifecycle Management
-- LM-3, LM-4, LM-6: 4 tables for lifecycle subsystem

-- lm_agents: Agent registration records (LM-3.09 through LM-3.25)
CREATE TABLE IF NOT EXISTS lm_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  framework TEXT NOT NULL,
  version TEXT NOT NULL,
  tenant_id TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'suspended', 'decommissioned')),
  trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK (trust_level IN ('untrusted', 'low', 'medium', 'high', 'verified')),
  owner TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  registered_at TEXT NOT NULL,
  last_active_at TEXT,
  decommissioned_at TEXT,
  decommission_reason TEXT
);

-- LM-13.02: Unique constraint on name+framework+tenant (using COALESCE for NULL tenants)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_agents_unique_name ON lm_agents(name, framework, COALESCE(tenant_id, '__NULL__'));

-- Index for common query patterns
CREATE INDEX IF NOT EXISTS idx_lm_agents_state ON lm_agents(state);
CREATE INDEX IF NOT EXISTS idx_lm_agents_framework ON lm_agents(framework);
CREATE INDEX IF NOT EXISTS idx_lm_agents_tenant ON lm_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lm_agents_trust ON lm_agents(trust_level);
CREATE INDEX IF NOT EXISTS idx_lm_agents_owner ON lm_agents(owner);

-- lm_capabilities: Capability registry per agent (LM-4.03 through LM-4.05)
CREATE TABLE IF NOT EXISTS lm_capabilities (
  agent_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'denied', 'pending')),
  granted_at TEXT,
  reason TEXT,
  decided_by TEXT,
  PRIMARY KEY (agent_id, capability)
);

-- lm_capability_history: Audit trail for capability changes (LM-4.16 through LM-4.20)
CREATE TABLE IF NOT EXISTS lm_capability_history (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked', 'requested', 'denied')),
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lm_cap_history_agent ON lm_capability_history(agent_id);
CREATE INDEX IF NOT EXISTS idx_lm_cap_history_ts ON lm_capability_history(timestamp);

-- lm_agent_consents: Consent records per agent (LM-6.01 through LM-6.08)
CREATE TABLE IF NOT EXISTS lm_agent_consents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  data_subject TEXT NOT NULL,
  purpose TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  tenant_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_lm_consents_agent ON lm_agent_consents(agent_id);
CREATE INDEX IF NOT EXISTS idx_lm_consents_status ON lm_agent_consents(status);
CREATE INDEX IF NOT EXISTS idx_lm_consents_subject ON lm_agent_consents(data_subject);
`;

export function getAgentLifecycleMigrations(): MigrationEntry[] {
  return [
    {
      version: 48,
      name: 'agent_lifecycle',
      sql: MIGRATION_048_SQL,
      checksum: createHash('sha256').update(MIGRATION_048_SQL).digest('hex'),
    },
  ];
}
