/**
 * Forward-only migration definitions for Phase 1.
 * S ref: C-05 (forward-only migrations), C-09 (namespace prefixes)
 *
 * Phase: 1 (Kernel)
 * Creates all 20 tables defined in the Synthesized SDD Section 5.
 *
 * Migration version 1: Core foundation (audit, encryption, vault, config, processing, task archive)
 * Migration version 2: RBAC (policies, roles, role assignments)
 * Migration version 3: Retention (retention policies, retention runs)
 * Migration version 4: Events (obs_events, subscriptions, webhook deliveries)
 * Migration version 5: HITL (approval queue, batch reviews)
 * Migration version 6: Metering (interaction accounting, rate limits)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../interfaces/index.js';

// ─── Migration SQL ───

const MIGRATION_001_SQL = `
-- Migration 001: Core foundation tables
-- S ref: I-03, I-06, I-11, §3.5, §3.6, FM-08, I-02, §25.1

-- core_audit_log: Append-only hash-chained audit trail
-- S ref: I-03, I-06, §3.5, FM-08
CREATE TABLE core_audit_log (
  seq_no        INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT    NOT NULL UNIQUE,
  tenant_id     TEXT,
  timestamp     TEXT    NOT NULL,
  actor_type    TEXT    NOT NULL CHECK (actor_type IN ('system','user','agent','scheduler')),
  actor_id      TEXT    NOT NULL,
  operation     TEXT    NOT NULL,
  resource_type TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  detail        TEXT,
  previous_hash TEXT    NOT NULL,
  current_hash  TEXT    NOT NULL
);

CREATE INDEX idx_core_audit_log_tenant ON core_audit_log (tenant_id, timestamp);
CREATE INDEX idx_core_audit_log_resource ON core_audit_log (resource_type, resource_id);
CREATE INDEX idx_core_audit_log_actor ON core_audit_log (actor_id, timestamp);
CREATE INDEX idx_core_audit_log_operation ON core_audit_log (operation, timestamp);

-- Triggers to enforce append-only (I-06, FM-08)
-- UPDATE trigger: prevent modification of audit entries
CREATE TRIGGER core_audit_log_no_update
  BEFORE UPDATE ON core_audit_log
  BEGIN
    SELECT RAISE(ABORT, 'I-06: Audit entries are append-only. UPDATE is prohibited.');
  END;

-- Flag table for archival bypass (SEC-004: trigger must allow legitimate archive operations)
-- When a row exists in this table, DELETE is permitted on core_audit_log.
-- S ref: I-06 (retention = archival to sealed file, not arbitrary deletion)
CREATE TABLE core_audit_archive_active (
  id INTEGER PRIMARY KEY CHECK (id = 1)
);

-- DELETE trigger: prevent deletion UNLESS archival is in progress (flag table check)
CREATE TRIGGER core_audit_log_no_delete
  BEFORE DELETE ON core_audit_log
  WHEN NOT EXISTS (SELECT 1 FROM core_audit_archive_active WHERE id = 1)
  BEGIN
    SELECT RAISE(ABORT, 'I-06: Audit entries are append-only. DELETE is prohibited. Use archive() for retention.');
  END;

-- core_audit_archive_segments: Track archived audit segments
-- S ref: I-06 (archival to sealed file)
CREATE TABLE core_audit_archive_segments (
  id            TEXT    PRIMARY KEY,
  file_path     TEXT    NOT NULL,
  first_seq_no  INTEGER NOT NULL,
  last_seq_no   INTEGER NOT NULL,
  final_hash    TEXT    NOT NULL,
  entry_count   INTEGER NOT NULL,
  archived_at   TEXT    NOT NULL
);

-- core_encryption_keys: PBKDF2 key derivation metadata
-- S ref: I-11, FM-10
CREATE TABLE core_encryption_keys (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT,
  purpose     TEXT    NOT NULL,
  salt        TEXT    NOT NULL,
  iterations  INTEGER NOT NULL DEFAULT 600000,
  algorithm   TEXT    NOT NULL DEFAULT 'aes-256-gcm',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rotated_at  TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, purpose)
);

CREATE INDEX idx_core_encryption_keys_tenant ON core_encryption_keys (tenant_id, purpose) WHERE active = 1;

-- core_vault: AES-256-GCM encrypted secrets
-- S ref: I-11, IP-1
CREATE TABLE core_vault (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT,
  key_name    TEXT    NOT NULL,
  ciphertext  TEXT    NOT NULL,
  iv          TEXT    NOT NULL,
  auth_tag    TEXT    NOT NULL,
  algorithm   TEXT    NOT NULL DEFAULT 'aes-256-gcm',
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, key_name)
);

-- core_config: Engine configuration persistence
-- S ref: §3.6, §49
CREATE TABLE core_config (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT    NOT NULL
);

-- core_processing_records: GDPR compliance
-- S ref: I-02, §35
CREATE TABLE core_processing_records (
  id            TEXT    PRIMARY KEY,
  tenant_id     TEXT,
  operation     TEXT    NOT NULL CHECK (operation IN ('purge','export','modify','delete_selective','archive')),
  data_type     TEXT    NOT NULL,
  subject_id    TEXT    NOT NULL,
  requested_by  TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  detail        TEXT,
  records_affected INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT
);

CREATE INDEX idx_core_processing_records_tenant ON core_processing_records (tenant_id, created_at);

-- core_task_archive: Completed/failed task records
-- S ref: §25.1
CREATE TABLE core_task_archive (
  task_id         TEXT    PRIMARY KEY,
  mission_id      TEXT    NOT NULL,
  tenant_id       TEXT,
  final_status    TEXT    NOT NULL CHECK (final_status IN ('COMPLETED','FAILED','CANCELLED')),
  execution_mode  TEXT    NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  worker_id       TEXT,
  started_at      TEXT,
  completed_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  error_details   TEXT,
  archived_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_core_task_archive_mission ON core_task_archive (mission_id);
CREATE INDEX idx_core_task_archive_tenant ON core_task_archive (tenant_id, archived_at);
`;

const MIGRATION_002_SQL = `
-- Migration 002: RBAC tables
-- S ref: §34, I-13, §13

-- core_policies: Policy storage
-- S ref: §13, §34, §35
CREATE TABLE core_policies (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT,
  type        TEXT    NOT NULL CHECK (type IN ('rbac','retention','safety','budget','capability')),
  scope       TEXT    NOT NULL CHECK (scope IN ('global','tenant','agent','mission')),
  scope_id    TEXT,
  rules       TEXT    NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_core_policies_type_scope ON core_policies (type, scope, tenant_id) WHERE active = 1;
CREATE INDEX idx_core_policies_scope_id ON core_policies (scope_id) WHERE scope_id IS NOT NULL;

-- core_roles: Role definitions
-- S ref: §34, I-13
CREATE TABLE core_roles (
  id          TEXT    PRIMARY KEY,
  tenant_id   TEXT,
  name        TEXT    NOT NULL,
  permissions TEXT    NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_core_roles_tenant ON core_roles (tenant_id);

-- core_role_assignments: Principal-to-role mapping
-- S ref: §34, I-13, DL-3
CREATE TABLE core_role_assignments (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  principal_type  TEXT    NOT NULL CHECK (principal_type IN ('user', 'agent')),
  principal_id    TEXT    NOT NULL,
  role_id         TEXT    NOT NULL REFERENCES core_roles(id),
  granted_by      TEXT    NOT NULL,
  granted_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at      TEXT,
  UNIQUE(tenant_id, principal_type, principal_id, role_id)
);

CREATE INDEX idx_core_role_assignments_principal ON core_role_assignments (principal_type, principal_id);
`;

const MIGRATION_003_SQL = `
-- Migration 003: Retention tables
-- S ref: §35, I-06, I-10

-- core_retention_policies: Configurable per-type retention
-- S ref: §35
CREATE TABLE core_retention_policies (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  data_type       TEXT    NOT NULL CHECK (data_type IN ('memories','audit','sessions','artifacts','techniques','events')),
  retention_days  INTEGER NOT NULL,
  action          TEXT    NOT NULL DEFAULT 'archive' CHECK (action IN ('archive','delete','soft_delete')),
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, data_type)
);

-- core_retention_runs: Retention execution tracking
-- S ref: §35
CREATE TABLE core_retention_runs (
  id              TEXT    PRIMARY KEY,
  started_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at    TEXT,
  policies_applied TEXT   NOT NULL,
  records_archived INTEGER NOT NULL DEFAULT 0,
  records_deleted  INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  error_details   TEXT
);
`;

const MIGRATION_004_SQL = `
-- Migration 004: Event bus tables
-- S ref: §10, RDD-4, IP-6

-- obs_events: Event persistence
-- S ref: §10, RDD-4
CREATE TABLE obs_events (
  id            TEXT    PRIMARY KEY,
  tenant_id     TEXT,
  type          TEXT    NOT NULL,
  scope         TEXT    NOT NULL CHECK (scope IN ('system','mission','task')),
  mission_id    TEXT,
  payload       TEXT    NOT NULL,
  timestamp     INTEGER NOT NULL,
  propagation   TEXT    NOT NULL CHECK (propagation IN ('up','down','local')),
  delivered     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_obs_events_type ON obs_events (type, timestamp);
CREATE INDEX idx_obs_events_mission ON obs_events (mission_id, timestamp) WHERE mission_id IS NOT NULL;
CREATE INDEX idx_obs_events_tenant ON obs_events (tenant_id, timestamp);
CREATE INDEX idx_obs_events_undelivered ON obs_events (delivered) WHERE delivered = 0;

-- obs_event_subscriptions: Subscriber registry
-- S ref: RDD-4, IP-6
CREATE TABLE obs_event_subscriptions (
  id              TEXT    PRIMARY KEY,
  event_pattern   TEXT    NOT NULL,
  subscriber_type TEXT    NOT NULL CHECK (subscriber_type IN ('internal','webhook')),
  handler_config  TEXT    NOT NULL,
  tenant_id       TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_obs_event_subs_pattern ON obs_event_subscriptions (event_pattern) WHERE active = 1;

-- obs_webhook_deliveries: At-least-once webhook delivery tracking
-- S ref: IP-6
CREATE TABLE obs_webhook_deliveries (
  id                TEXT    PRIMARY KEY,
  subscription_id   TEXT    NOT NULL REFERENCES obs_event_subscriptions(id),
  event_id          TEXT    NOT NULL REFERENCES obs_events(id),
  idempotency_key   TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL CHECK (status IN ('pending','delivered','failed','exhausted')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  last_attempt_at   TEXT,
  next_retry_at     TEXT,
  response_status   INTEGER,
  error_message     TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_obs_webhook_pending ON obs_webhook_deliveries (status, next_retry_at)
  WHERE status IN ('pending', 'failed');
`;

const MIGRATION_005_SQL = `
-- Migration 005: HITL tables
-- S ref: §31.1, §31.4, §31.5, §34

-- hitl_approval_queue: Pending human review
-- S ref: §31.1, §34
CREATE TABLE hitl_approval_queue (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  session_id      TEXT    NOT NULL,
  agent_id        TEXT    NOT NULL,
  mission_id      TEXT,
  content_type    TEXT    NOT NULL CHECK (content_type IN ('response','artifact','mission_result')),
  content         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','edited','rejected')),
  submitted_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at     TEXT,
  reviewed_by     TEXT,
  edit_content    TEXT,
  rejection_reason TEXT
);

CREATE INDEX idx_hitl_approval_queue_status ON hitl_approval_queue (status) WHERE status = 'pending';
CREATE INDEX idx_hitl_approval_queue_tenant ON hitl_approval_queue (tenant_id) WHERE tenant_id IS NOT NULL;

-- hitl_batch_reviews: Batch review quality scoring
-- S ref: §31.4, §31.5
CREATE TABLE hitl_batch_reviews (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  interaction_id  TEXT    NOT NULL,
  reviewer_id     TEXT    NOT NULL,
  scores          TEXT    NOT NULL,
  feedback        TEXT,
  reviewed_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

const MIGRATION_006_SQL = `
-- Migration 006: Metering tables
-- S ref: §25.6, §11, §36

-- meter_interaction_accounting: Unified resource accounting
-- S ref: §25.6, §11, §33
CREATE TABLE meter_interaction_accounting (
  id                  TEXT    PRIMARY KEY,
  tenant_id           TEXT,
  mission_id          TEXT    NOT NULL,
  task_id             TEXT    NOT NULL,
  agent_id            TEXT    NOT NULL,
  provider_id         TEXT,
  model_id            TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  engine_counted      INTEGER NOT NULL DEFAULT 0,
  provider_reported   INTEGER NOT NULL DEFAULT 0,
  effective_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL    NOT NULL DEFAULT 0.0,
  wall_clock_ms       INTEGER NOT NULL DEFAULT 0,
  capabilities_used   TEXT,
  artifacts_count     INTEGER NOT NULL DEFAULT 0,
  artifacts_bytes     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_meter_accounting_mission ON meter_interaction_accounting (mission_id);
CREATE INDEX idx_meter_accounting_tenant ON meter_interaction_accounting (tenant_id, created_at);
CREATE INDEX idx_meter_accounting_agent ON meter_interaction_accounting (agent_id, created_at);

-- meter_rate_limits: Token-bucket rate limiting state
-- S ref: §36
CREATE TABLE meter_rate_limits (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  agent_id        TEXT,
  bucket_type     TEXT    NOT NULL CHECK (bucket_type IN ('api_calls','emit_event','propose_rejections')),
  max_tokens      REAL    NOT NULL,
  refill_rate     REAL    NOT NULL,
  current_tokens  REAL    NOT NULL,
  last_refill_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, agent_id, bucket_type)
);

CREATE INDEX idx_meter_rate_limits_lookup ON meter_rate_limits (tenant_id, agent_id, bucket_type);
`;

// ─── Build Migration Entries ───

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

/**
 * Get all Phase 1 migrations.
 * S ref: C-05 (forward-only), C-09 (namespace prefixes on all tables)
 */
export function getPhase1Migrations(): MigrationEntry[] {
  return [
    buildEntry(1, 'core_foundation', MIGRATION_001_SQL),
    buildEntry(2, 'rbac_tables', MIGRATION_002_SQL),
    buildEntry(3, 'retention_tables', MIGRATION_003_SQL),
    buildEntry(4, 'event_bus_tables', MIGRATION_004_SQL),
    buildEntry(5, 'hitl_tables', MIGRATION_005_SQL),
    buildEntry(6, 'metering_tables', MIGRATION_006_SQL),
  ];
}
