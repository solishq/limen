/**
 * Migration v30: WMP (Working Memory Protocol) tables.
 * Spec ref: WMP v1.0 Design Source §5-§10, §15
 *
 * Phase: 1 (WMP)
 * Tables: working_memory_entries, wmp_boundary_events, wmp_snapshot_contents, wmp_mutation_counters
 *
 * Invariants enforced:
 *   WMP-I1: Scope isolation via task_id on all tables
 *   WMP-I5: Deterministic mutation order via mutation_position (monotonic per task)
 *   WMP-I6: Mandatory boundary capture — immutable event/content records
 *   WMP-I7: Terminal atomicity — snapshot + transition + discard as one operation
 *
 * Design choices:
 *   - Physical DELETE on entries (AL-WMP-07: ephemeral, not governance-constitutional)
 *   - No tombstone columns (DC-WMP-210)
 *   - Boundary events and snapshot contents are INSERT-only (I-06 audit retention)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_030_SQL = `
-- Migration 030: WMP (Working Memory Protocol) tables
-- Phase 1: Working Memory Protocol Implementation
-- Spec ref: WMP v1.0 Design Source §5-§10

-- ============================================================================
-- Table: working_memory_entries — §5.2, WMP-I1, WMP-I3
-- Live namespace for task-scoped working memory.
-- Physical DELETE on discard (AL-WMP-07 — ephemeral, not tombstone family).
-- No per-mutation audit (WMP-I3 — I-03 exception).
-- ============================================================================

CREATE TABLE IF NOT EXISTS working_memory_entries (
  task_id           TEXT    NOT NULL,
  key               TEXT    NOT NULL,
  value             TEXT    NOT NULL,
  size_bytes        INTEGER NOT NULL,
  mutation_position INTEGER NOT NULL,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (task_id, key)
);

-- Index: task-scoped lookups and capacity queries
CREATE INDEX IF NOT EXISTS idx_wmp_entries_task
  ON working_memory_entries(task_id);

-- ============================================================================
-- Table: wmp_boundary_events — §6.2, WMP-I6
-- Boundary event record — always created at every applicable boundary.
-- Never deduplicated. Immutable. No UPDATE, no DELETE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wmp_boundary_events (
  event_id            TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL,
  mission_id          TEXT NOT NULL,
  trigger             TEXT NOT NULL CHECK (trigger IN ('checkpoint', 'task_terminal', 'mission_transition', 'pre_irreversible_emission', 'suspension')),
  snapshot_content_id TEXT NOT NULL,
  linked_emission_id  TEXT,
  timestamp           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Index: task-scoped boundary event listing
CREATE INDEX IF NOT EXISTS idx_wmp_boundary_events_task
  ON wmp_boundary_events(task_id);

-- Immutability: boundary events cannot be modified or deleted (I-06)
CREATE TRIGGER IF NOT EXISTS trg_wmp_boundary_events_immutable_update
  BEFORE UPDATE ON wmp_boundary_events
BEGIN
  SELECT RAISE(ABORT, 'WMP-I6: Boundary events are immutable — no UPDATE permitted');
END;

CREATE TRIGGER IF NOT EXISTS trg_wmp_boundary_events_immutable_delete
  BEFORE DELETE ON wmp_boundary_events
BEGIN
  SELECT RAISE(ABORT, 'WMP-I6: Boundary events are immutable — no DELETE permitted');
END;

-- ============================================================================
-- Table: wmp_snapshot_contents — §6.2, WMP-I6
-- Snapshot content record — captures logical WMP namespace state.
-- May be deduplicated when content unchanged (DERIVED-7).
-- Immutable. No UPDATE, no DELETE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wmp_snapshot_contents (
  content_id               TEXT PRIMARY KEY,
  task_id                  TEXT    NOT NULL,
  namespace_state          TEXT    NOT NULL CHECK (namespace_state IN ('never_initialized', 'initialized_empty', 'initialized_with_entries')),
  entries_json             TEXT,
  total_entries            INTEGER NOT NULL DEFAULT 0,
  total_size_bytes         INTEGER NOT NULL DEFAULT 0,
  highest_mutation_position INTEGER
);

-- Index: deduplication lookup (task + namespace state + mutation position)
CREATE INDEX IF NOT EXISTS idx_wmp_snapshot_contents_dedup
  ON wmp_snapshot_contents(task_id, namespace_state, highest_mutation_position);

-- Immutability: snapshot contents cannot be modified or deleted (I-06)
CREATE TRIGGER IF NOT EXISTS trg_wmp_snapshot_contents_immutable_update
  BEFORE UPDATE ON wmp_snapshot_contents
BEGIN
  SELECT RAISE(ABORT, 'WMP-I6: Snapshot contents are immutable — no UPDATE permitted');
END;

CREATE TRIGGER IF NOT EXISTS trg_wmp_snapshot_contents_immutable_delete
  BEFORE DELETE ON wmp_snapshot_contents
BEGIN
  SELECT RAISE(ABORT, 'WMP-I6: Snapshot contents are immutable — no DELETE permitted');
END;

-- ============================================================================
-- Table: wmp_mutation_counters — WMP-I5, DERIVED-1
-- Task-local monotonic mutation counter.
-- Tracks the latest assigned mutation-order position per task.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wmp_mutation_counters (
  task_id   TEXT    PRIMARY KEY,
  counter   INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0
);
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getWmpMigrations(): MigrationEntry[] {
  return [
    buildEntry(30, 'wmp_working_memory', MIGRATION_030_SQL),
  ];
}
