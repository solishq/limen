// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_COORDINATION_GOVERNANCE.md §11
/**
 * Migration v51: Coordination Governance Tables
 *
 * CO-11.1, CO-11.7, CO-11.14, CO-11.17: Creates 5 tables for coordination subsystem.
 *
 * Schema changes:
 *   1. CREATE TABLE coordination_a2a_rules (A2A governance rules)
 *   2. CREATE TABLE coordination_session_forks (session fork records)
 *   3. CREATE TABLE coordination_sync_peers (sync peer registrations)
 *   4. CREATE TABLE coordination_sync_events (hash-chained sync event log)
 *   5. CREATE TABLE coordination_state_snapshots (deterministic replay snapshots)
 *
 * Additive only. No ALTER, no DROP. Forward-only (AD-12).
 * Idempotent: IF NOT EXISTS on all tables. Running twice is safe.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_051_SQL = `
-- Migration 051: Coordination Governance Tables
-- CO-11: 5 tables for A2A rules, session forks, sync peers, sync events, state snapshots

-- coordination_a2a_rules: A2A governance rule storage (CO-11.1)
-- CO-12.1: tenant_id for tenant isolation
-- CO-4.8: priority for evaluation ordering (lower = higher priority)
-- CO-11.2: enabled flag for soft-delete (retain for audit)
CREATE TABLE IF NOT EXISTS coordination_a2a_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  target_agent TEXT NOT NULL,
  skill TEXT NOT NULL DEFAULT '*',
  action TEXT NOT NULL CHECK (action IN ('allow', 'deny', 'mask', 'rate_limit')),
  conditions TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

-- Index for priority-ordered evaluation (CO-12.11)
CREATE INDEX IF NOT EXISTS idx_coordination_a2a_rules_priority
  ON coordination_a2a_rules(tenant_id, enabled, priority, created_at);

-- Index for filter queries (CO-4.27)
CREATE INDEX IF NOT EXISTS idx_coordination_a2a_rules_filter
  ON coordination_a2a_rules(tenant_id, source_agent, target_agent, skill);


-- coordination_session_forks: Session fork lifecycle records (CO-11.7)
-- CO-5.17: Max forks per session enforced at application layer
-- CO-5.19: Max fork depth enforced at application layer
CREATE TABLE IF NOT EXISTS coordination_session_forks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  parent_session_id TEXT NOT NULL,
  forked_session_id TEXT NOT NULL,
  fork_point INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'merged', 'discarded')),
  label TEXT,
  claims_since_fork INTEGER NOT NULL DEFAULT 0,
  working_memory_namespace TEXT NOT NULL,
  created_at TEXT NOT NULL,
  merged_at TEXT,
  discarded_at TEXT,
  depth INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  max_duration_ms INTEGER NOT NULL DEFAULT 3600000
);

-- Index for listing forks by parent session (CO-11.7)
CREATE INDEX IF NOT EXISTS idx_coordination_forks_parent
  ON coordination_session_forks(tenant_id, parent_session_id, state);

-- Index for agent-wide fork limit check (CO-5.18)
CREATE INDEX IF NOT EXISTS idx_coordination_forks_agent
  ON coordination_session_forks(tenant_id, created_by, state);


-- coordination_sync_peers: Peer registrations for distributed sync (CO-11.11)
-- CO-6.14: status tracks peer lifecycle
-- CO-6.32: failed_attempts tracks consecutive sync failures
CREATE TABLE IF NOT EXISTS coordination_sync_peers (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  max_batch_size INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unreachable', 'deregistered', 'suspended')),
  last_seen_at TEXT NOT NULL,
  last_synced_at TEXT,
  watermark_physical INTEGER,
  watermark_logical INTEGER,
  watermark_node_id TEXT,
  pending_outbound INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

-- Index for active peer lookup
CREATE INDEX IF NOT EXISTS idx_coordination_peers_tenant_status
  ON coordination_sync_peers(tenant_id, status);


-- coordination_sync_events: Hash-chained append-only sync event log (CO-11.14)
-- CO-12.5: hash includes previous_hash for tamper-evidence
-- CO-6.2: HLC ordering via physical_ts, logical_ts, node_id
CREATE TABLE IF NOT EXISTS coordination_sync_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('claim_created', 'claim_retracted', 'relationship_created', 'governance_update')),
  physical_ts INTEGER NOT NULL,
  logical_ts INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL
);

-- Index for HLC-ordered queries (CO-6.2)
CREATE INDEX IF NOT EXISTS idx_coordination_sync_events_hlc
  ON coordination_sync_events(tenant_id, physical_ts, logical_ts, node_id);

-- Index for hash chain verification
CREATE INDEX IF NOT EXISTS idx_coordination_sync_events_hash
  ON coordination_sync_events(tenant_id, hash);


-- coordination_state_snapshots: Deterministic replay snapshots (CO-11.17)
-- CO-7.5: state_hash is SHA-256 of combined table hashes
-- CO-7.6: table_hashes stored as JSON
CREATE TABLE IF NOT EXISTS coordination_state_snapshots (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('mission_start', 'checkpoint', 'mission_end', 'manual')),
  timestamp TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  table_hashes TEXT NOT NULL,
  metadata TEXT NOT NULL
);

-- Index for mission-scoped snapshot lookup (CO-11.17)
CREATE INDEX IF NOT EXISTS idx_coordination_snapshots_mission
  ON coordination_state_snapshots(tenant_id, mission_id, timestamp);
`;

/**
 * Return migration entries for coordination governance tables.
 * Forward-only (AD-12). Idempotent via IF NOT EXISTS.
 */
export function getCoordinationGovernanceMigrations(): MigrationEntry[] {
  const checksum = createHash('sha256').update(MIGRATION_051_SQL).digest('hex');
  return [
    {
      version: 51,
      name: 'coordination_governance_tables',
      sql: MIGRATION_051_SQL,
      checksum,
    },
  ];
}
