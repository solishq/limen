/**
 * Forward-only migration for Phase 2 (Execution Substrate).
 * S ref: C-05 (forward-only migrations), C-09 (namespace prefixes)
 *
 * Phase: 2 (Execution Substrate)
 * Migration version: 7 (Phase 1 uses versions 1-6)
 *
 * Creates: core_task_queue, core_worker_registry, core_provider_health, core_llm_request_log
 * Alters: core_task_archive (add agent_id, error_code, error_message, error_detail, created_at)
 *         meter_interaction_accounting (add interaction_type, provider_input_tokens,
 *           provider_output_tokens, effective_input_tokens, effective_output_tokens)
 *
 * Implements: §25.1, §25.2, §25.4, §25.5, §25.6, §25.7, I-05, I-12, I-25
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration SQL ───

const MIGRATION_007_SQL = `
-- Migration 007: Execution Substrate tables
-- S ref: §25.1 (Task Scheduler), §25.2 (Worker Runtime), §25.4 (LLM Gateway),
--        §25.5 (Heartbeat Protocol), §25.6 (Resource Accounting), §25.7 (Edge Cases)
-- Invariants: I-05 (transactional consistency), I-12 (tool sandboxing), I-25 (deterministic replay)
-- Constraints: C-05 (forward-only), C-09 (namespace prefixes)

-- ══════════════════════════════════════════════════════════════
-- NEW TABLE: core_task_queue
-- §25.1: SQLite-backed priority queue with polling, heartbeat columns
-- Defends: FM-20 (heartbeat columns for hung worker detection)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE core_task_queue (
  task_id               TEXT    PRIMARY KEY,
  mission_id            TEXT    NOT NULL,
  tenant_id             TEXT,
  agent_id              TEXT    NOT NULL,
  priority              INTEGER NOT NULL DEFAULT 100,
  status                TEXT    NOT NULL DEFAULT 'PENDING'
                        CHECK(status IN ('PENDING', 'SCHEDULED', 'RUNNING')),
  execution_mode        TEXT    NOT NULL DEFAULT 'deterministic'
                        CHECK(execution_mode IN ('deterministic', 'stochastic', 'hybrid')),
  scheduled_at          TEXT,
  started_at            TEXT,
  worker_id             TEXT,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  max_retries           INTEGER NOT NULL DEFAULT 2,
  timeout_ms            INTEGER NOT NULL DEFAULT 300000,
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 30000,
  last_heartbeat_at     TEXT,
  missed_heartbeats     INTEGER NOT NULL DEFAULT 0,
  estimated_tokens      INTEGER,
  capabilities_required TEXT    NOT NULL DEFAULT '[]',
  payload               TEXT    NOT NULL DEFAULT '{}',
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_core_task_queue_status_priority
  ON core_task_queue(status, priority);
CREATE INDEX idx_core_task_queue_mission_id
  ON core_task_queue(mission_id);
CREATE INDEX idx_core_task_queue_worker_id
  ON core_task_queue(worker_id);

-- ══════════════════════════════════════════════════════════════
-- NEW TABLE: core_worker_registry
-- §25.2: Worker thread pool state, I-12 resourceLimits columns
-- DL-7: Separate columns for resourceLimits (queryable without JSON parsing)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE core_worker_registry (
  worker_id               TEXT    PRIMARY KEY,
  thread_id               INTEGER,
  status                  TEXT    NOT NULL DEFAULT 'IDLE'
                          CHECK(status IN ('IDLE', 'ALLOCATED', 'RUNNING')),
  current_task_id         TEXT,
  max_old_generation_mb   INTEGER NOT NULL,
  max_young_generation_mb INTEGER NOT NULL,
  code_range_size_mb      INTEGER NOT NULL,
  allocated_at            TEXT,
  task_count              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_core_worker_registry_status
  ON core_worker_registry(status);

-- ══════════════════════════════════════════════════════════════
-- NEW TABLE: core_provider_health
-- §25.4, DL-1: SQLite-persisted circuit breaker state (I-05)
-- FPD-6: Four-state provider health (healthy/degraded/cooldown/unavailable)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE core_provider_health (
  provider_id           TEXT    PRIMARY KEY,
  status                TEXT    NOT NULL DEFAULT 'healthy'
                        CHECK(status IN ('healthy', 'degraded', 'cooldown', 'unavailable')),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_n     INTEGER NOT NULL DEFAULT 5,
  error_threshold       REAL    NOT NULL DEFAULT 0.30,
  cooldown_until        TEXT,
  cooldown_duration_ms  INTEGER NOT NULL DEFAULT 60000,
  total_requests        INTEGER NOT NULL DEFAULT 0,
  total_failures        INTEGER NOT NULL DEFAULT 0,
  error_rate_5min       REAL    NOT NULL DEFAULT 0.0,
  avg_latency_ms        REAL    NOT NULL DEFAULT 0.0,
  last_success_at       TEXT,
  last_failure_at       TEXT,
  last_error_message    TEXT,
  last_request_at       TEXT,
  model_id              TEXT,
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ══════════════════════════════════════════════════════════════
-- NEW TABLE: core_llm_request_log
-- I-25: Deterministic replay via prompt_hash indexed lookup
-- FPD-3: Dedicated table (audit trail not designed for content queries)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE core_llm_request_log (
  request_id              TEXT    PRIMARY KEY,
  task_id                 TEXT    NOT NULL,
  mission_id              TEXT    NOT NULL,
  tenant_id               TEXT,
  provider_id             TEXT    NOT NULL,
  model_id                TEXT    NOT NULL,
  prompt_hash             TEXT    NOT NULL,
  request_body            TEXT    NOT NULL,
  response_body           TEXT,
  input_tokens            INTEGER,
  output_tokens           INTEGER,
  provider_input_tokens   INTEGER,
  provider_output_tokens  INTEGER,
  cost_microdollars       INTEGER,
  latency_ms              INTEGER,
  status                  TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending', 'completed', 'failed', 'timeout')),
  error_message           TEXT,
  created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_core_llm_request_log_prompt_hash
  ON core_llm_request_log(prompt_hash);
CREATE INDEX idx_core_llm_request_log_task_id
  ON core_llm_request_log(task_id);
CREATE INDEX idx_core_llm_request_log_mission_id
  ON core_llm_request_log(mission_id);

-- ══════════════════════════════════════════════════════════════
-- ALTER: core_task_archive
-- Phase 1 (migration 001) created this table. Phase 2 adds columns
-- needed for §25.7 archive with structured error storage (DL-8/D-21).
-- ══════════════════════════════════════════════════════════════
ALTER TABLE core_task_archive ADD COLUMN agent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE core_task_archive ADD COLUMN error_code TEXT;
ALTER TABLE core_task_archive ADD COLUMN error_message TEXT;
ALTER TABLE core_task_archive ADD COLUMN error_detail TEXT;
ALTER TABLE core_task_archive ADD COLUMN created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ══════════════════════════════════════════════════════════════
-- ALTER: meter_interaction_accounting
-- Phase 1 (migration 006) created this table. Phase 2 adds columns
-- for §25.6 interaction type classification and max(engine, provider)
-- effective token tracking per §11 (D-26).
-- ══════════════════════════════════════════════════════════════
ALTER TABLE meter_interaction_accounting ADD COLUMN interaction_type TEXT NOT NULL DEFAULT 'llm'
  CHECK(interaction_type IN ('llm', 'capability', 'embedding'));
ALTER TABLE meter_interaction_accounting ADD COLUMN provider_input_tokens INTEGER;
ALTER TABLE meter_interaction_accounting ADD COLUMN provider_output_tokens INTEGER;
ALTER TABLE meter_interaction_accounting ADD COLUMN effective_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meter_interaction_accounting ADD COLUMN effective_output_tokens INTEGER NOT NULL DEFAULT 0;
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
 * Get Phase 2 (Execution Substrate) migration.
 * S ref: C-05 (forward-only), C-09 (namespace prefixes on all tables)
 *
 * Version 7 continues from Phase 1's versions 1-6.
 * Creates 4 new tables, alters 2 existing tables.
 */
export function getPhase2Migrations(): MigrationEntry[] {
  return [
    buildEntry(7, 'substrate_tables', MIGRATION_007_SQL),
  ];
}
