/**
 * Migration v21: Governance runs, attempts, and trace events.
 * Truth Model: Deliverable 2 (Run Identity), Deliverable 3 (Trace Events)
 *
 * Phase: 0A (Foundation)
 *
 * Tables: gov_runs, gov_attempts, obs_trace_events
 * Namespace: gov_ (governance), obs_ (observability)
 *
 * BC-010: Run entity with fork lineage.
 * BC-011: Attempt entity with typed failure/strategy.
 * BC-013: runSeq strictly monotonically increasing — UNIQUE(run_id, run_seq).
 * BC-022: TraceEvent typed shape, immutable once created.
 * INV-020: Trace events immutable — no update or delete triggers.
 * INV-021: (runId, runSeq) is unique.
 * INV-X04: Every entity carries schemaVersion.
 * INV-X12: Every entity carries origin.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_021_SQL = `
-- Migration 021: Governance runs, attempts, and trace events
-- Truth Model: Deliverables 2, 3

-- gov_runs: Constitutional execution envelope (BC-010)
CREATE TABLE gov_runs (
  run_id              TEXT    PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  mission_id          TEXT    NOT NULL,
  fork_of_run_id      TEXT,
  fork_from_event_ref TEXT,
  state               TEXT    NOT NULL CHECK (state IN ('active', 'completed', 'failed', 'abandoned')),
  started_at          TEXT    NOT NULL,
  completed_at        TEXT,
  schema_version      TEXT    NOT NULL,
  origin              TEXT    NOT NULL CHECK (origin IN ('runtime', 'migration-backfill'))
);

CREATE INDEX idx_gov_runs_tenant ON gov_runs (tenant_id);
CREATE INDEX idx_gov_runs_mission ON gov_runs (mission_id);
CREATE INDEX idx_gov_runs_fork ON gov_runs (fork_of_run_id) WHERE fork_of_run_id IS NOT NULL;

-- gov_attempts: Single execution try within a task (BC-011)
-- BC-019: Only one non-terminal attempt per task enforced at application layer.
CREATE TABLE gov_attempts (
  attempt_id          TEXT    PRIMARY KEY,
  task_id             TEXT    NOT NULL,
  mission_id          TEXT    NOT NULL,
  run_id              TEXT    NOT NULL REFERENCES gov_runs(run_id),
  prior_attempt_ref   TEXT,
  triggering_failure  TEXT,
  strategy_delta      TEXT,
  state               TEXT    NOT NULL CHECK (state IN ('started', 'executing', 'succeeded', 'failed', 'abandoned')),
  pinned_versions     TEXT    NOT NULL,
  schema_version      TEXT    NOT NULL,
  origin              TEXT    NOT NULL CHECK (origin IN ('runtime', 'migration-backfill')),
  created_at          TEXT    NOT NULL
);

CREATE INDEX idx_gov_attempts_task ON gov_attempts (task_id);
CREATE INDEX idx_gov_attempts_mission ON gov_attempts (mission_id);
CREATE INDEX idx_gov_attempts_run ON gov_attempts (run_id);
CREATE INDEX idx_gov_attempts_active ON gov_attempts (task_id, state)
  WHERE state IN ('started', 'executing');

-- obs_trace_events: Constitutional trace event log (BC-022)
-- INV-020: Immutable — triggers prevent UPDATE and DELETE.
-- INV-021: (run_id, run_seq) is unique.
CREATE TABLE obs_trace_events (
  trace_event_id      TEXT    PRIMARY KEY,
  run_id              TEXT    NOT NULL,
  run_seq             INTEGER NOT NULL,
  span_seq            INTEGER NOT NULL,
  parent_event_ref    TEXT,
  fork_of_run_id      TEXT,
  fork_from_event_ref TEXT,
  correlation_id      TEXT    NOT NULL,
  version             TEXT    NOT NULL,
  type                TEXT    NOT NULL,
  tenant_id           TEXT    NOT NULL,
  timestamp           TEXT    NOT NULL,
  payload             TEXT    NOT NULL,
  UNIQUE(run_id, run_seq)
);

CREATE INDEX idx_obs_trace_events_run ON obs_trace_events (run_id, run_seq);
CREATE INDEX idx_obs_trace_events_correlation ON obs_trace_events (correlation_id);
CREATE INDEX idx_obs_trace_events_type ON obs_trace_events (type, timestamp);
CREATE INDEX idx_obs_trace_events_tenant ON obs_trace_events (tenant_id, timestamp);

-- INV-020: Trace events are immutable — no UPDATE.
CREATE TRIGGER obs_trace_events_no_update
  BEFORE UPDATE ON obs_trace_events
  BEGIN
    SELECT RAISE(ABORT, 'INV-020: Trace events are immutable. UPDATE is prohibited.');
  END;

-- INV-020: Trace events are immutable — no DELETE.
CREATE TRIGGER obs_trace_events_no_delete
  BEFORE DELETE ON obs_trace_events
  BEGIN
    SELECT RAISE(ABORT, 'INV-020: Trace events are immutable. DELETE is prohibited.');
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

export function getGovernanceRunsTracesMigrations(): MigrationEntry[] {
  return [buildEntry(21, 'governance_runs_traces', MIGRATION_021_SQL)];
}
