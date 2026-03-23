/**
 * Migration v35: Replay & Pipeline — Replay Snapshots + LLM Log Immutability + Recovery Index.
 * Spec ref: I-25 (Deterministic Replay), I-18 (Mission Persistence/Recovery), I-28 (Pipeline Determinism)
 *
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * Schema changes:
 *   - New table: core_replay_snapshots (append-only, mission state snapshots for replay verification)
 *   - Append-only triggers on core_replay_snapshots (no UPDATE, no DELETE)
 *   - Immutability trigger on core_llm_request_log (completed/failed entries immutable)
 *   - Partial index on core_missions for non-terminal recovery queries
 *
 * Invariants enforced:
 *   I-25: State snapshots enable deterministic replay verification via hash comparison
 *   I-18: Partial index accelerates recovery of non-terminal missions after restart
 *   I-28: Pipeline structure unchanged — this migration supports pipeline determinism verification
 *
 * Triggers:
 *   trg_replay_snapshots_no_update: Append-only on replay snapshots
 *   trg_replay_snapshots_no_delete: No delete on replay snapshots
 *   trg_llm_log_immutable: Completed/failed LLM log entries cannot be modified
 *
 * Indexes:
 *   idx_replay_snapshots_mission: Mission lookup for snapshot queries
 *   idx_replay_snapshots_tenant: Tenant isolation for replay queries
 *   idx_core_missions_non_terminal: Partial index for recovery (non-terminal states only)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_035_SQL = `
-- Migration 035: Replay & Pipeline — Replay Snapshots + LLM Log Immutability + Recovery Index
-- Sprint 4: Replay & Pipeline
-- Spec ref: I-25, I-18, I-28

-- ============================================================================
-- I-25: Replay snapshot table for state comparison
-- Append-only: snapshots capture mission state at lifecycle points.
-- Hash comparison enables deterministic replay verification.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_replay_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  mission_id TEXT NOT NULL REFERENCES core_missions(id),
  tenant_id TEXT,
  snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('mission_start', 'checkpoint', 'mission_end')),
  state_hash TEXT NOT NULL,
  state_detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_replay_snapshots_mission ON core_replay_snapshots(mission_id);
CREATE INDEX idx_replay_snapshots_tenant ON core_replay_snapshots(tenant_id);

-- Append-only trigger (no UPDATE)
CREATE TRIGGER trg_replay_snapshots_no_update
BEFORE UPDATE ON core_replay_snapshots
BEGIN
  SELECT RAISE(ABORT, 'core_replay_snapshots is append-only: UPDATE prohibited');
END;

-- Append-only trigger (no DELETE)
CREATE TRIGGER trg_replay_snapshots_no_delete
BEFORE DELETE ON core_replay_snapshots
BEGIN
  SELECT RAISE(ABORT, 'core_replay_snapshots is append-only: DELETE prohibited');
END;

-- ============================================================================
-- I-25: Append-only protection on completed LLM log entries
-- CRITICAL security finding: core_llm_request_log had no immutability triggers.
-- Once an LLM request reaches completed or failed status, its recorded data
-- (prompt, response, tokens) must be immutable for replay integrity.
-- ============================================================================

CREATE TRIGGER trg_llm_log_immutable
BEFORE UPDATE ON core_llm_request_log
WHEN OLD.status IN ('completed', 'failed')
  AND (
    NEW.status != OLD.status
    OR NEW.response_body IS NOT OLD.response_body
    OR NEW.request_body IS NOT OLD.request_body
    OR NEW.prompt_hash IS NOT OLD.prompt_hash
    OR NEW.input_tokens IS NOT OLD.input_tokens
    OR NEW.output_tokens IS NOT OLD.output_tokens
  )
BEGIN
  SELECT RAISE(ABORT, 'core_llm_request_log: completed/failed entries are immutable');
END;

-- F-S4-002 FIX: DELETE trigger on core_llm_request_log.
-- Without this, an attacker can destroy replay evidence via DELETE.
CREATE TRIGGER trg_llm_log_no_delete
BEFORE DELETE ON core_llm_request_log
BEGIN
  SELECT RAISE(ABORT, 'core_llm_request_log is append-only: DELETE prohibited');
END;

-- ============================================================================
-- I-18: Partial index for non-terminal mission recovery queries.
-- On engine restart, only non-terminal missions need recovery evaluation.
-- This partial index avoids scanning the (potentially large) set of completed/failed missions.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_core_missions_non_terminal
ON core_missions(state)
WHERE state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED');
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getReplayPipelineMigrations(): MigrationEntry[] {
  return [buildEntry(35, 'replay_pipeline', MIGRATION_035_SQL)];
}
