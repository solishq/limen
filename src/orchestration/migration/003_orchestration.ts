/**
 * Forward-only migrations for Phase 3 (Orchestration Layer).
 * S ref: C-05 (forward-only migrations), C-09 (namespace prefixes)
 *
 * Phase: 3 (Orchestration)
 * Migration versions: 8-12 (Phase 2 uses version 7)
 *
 * Creates: 15 tables across 5 migrations:
 *   v8: core_missions, core_mission_goals
 *   v9: core_tasks, core_task_dependencies, core_task_graphs
 *   v10: core_artifacts, core_artifact_dependencies
 *   v11: core_resources, core_checkpoints
 *   v12: core_conversations, core_conversation_turns, core_mission_results,
 *        core_compaction_log, core_tree_counts, core_events_log
 *
 * Implements: S6, S7, S8, S10, S11, S23, S24, S26, I-19, I-20, I-21, I-23, I-24, I-27
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v8: Mission Foundation (S6, I-24) ───

const MIGRATION_008_SQL = `
-- Migration 008: Mission Foundation
-- S ref: S6 (Mission), I-24 (Goal Anchoring), FM-19 (Delegation Cycle)
-- Invariants: I-18 (persistence), I-22 (capability immutability), I-24 (goal anchoring)
-- Constraints: C-05 (forward-only), C-09 (core_ prefix)

CREATE TABLE core_missions (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT,
  parent_id         TEXT REFERENCES core_missions(id),
  agent_id          TEXT NOT NULL,
  objective         TEXT NOT NULL,
  success_criteria  TEXT NOT NULL,
  scope_boundaries  TEXT NOT NULL,
  capabilities      TEXT NOT NULL,
  state             TEXT NOT NULL DEFAULT 'CREATED'
    CHECK(state IN ('CREATED','PLANNING','EXECUTING','REVIEWING',
                    'COMPLETED','PAUSED','FAILED','CANCELLED','DEGRADED','BLOCKED')),
  plan_version      INTEGER NOT NULL DEFAULT 0,
  delegation_chain  TEXT NOT NULL DEFAULT '[]',
  constraints_json  TEXT NOT NULL,
  depth             INTEGER NOT NULL DEFAULT 0,
  compacted         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT,
  CONSTRAINT chk_depth CHECK(depth >= 0)
);

CREATE INDEX idx_missions_tenant ON core_missions(tenant_id);
CREATE INDEX idx_missions_parent ON core_missions(parent_id);
CREATE INDEX idx_missions_agent ON core_missions(agent_id);
CREATE INDEX idx_missions_state ON core_missions(state);
CREATE INDEX idx_missions_tenant_state ON core_missions(tenant_id, state);
CREATE INDEX idx_missions_working_set ON core_missions(state, compacted)
  WHERE compacted = 0 AND state NOT IN ('COMPLETED','FAILED','CANCELLED');

CREATE TABLE core_mission_goals (
  mission_id        TEXT PRIMARY KEY NOT NULL REFERENCES core_missions(id),
  objective         TEXT NOT NULL,
  success_criteria  TEXT NOT NULL,
  scope_boundaries  TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
`;

// ─── Migration v9: Task Graph (S7, S16) ───

const MIGRATION_009_SQL = `
-- Migration 009: Task Graph
-- S ref: S7 (Task), S16 (propose_task_graph), I-20 (limits)
-- Invariants: I-20 (task limits)

CREATE TABLE core_tasks (
  id                  TEXT PRIMARY KEY NOT NULL,
  mission_id          TEXT NOT NULL REFERENCES core_missions(id),
  tenant_id           TEXT,
  graph_id            TEXT NOT NULL,
  description         TEXT NOT NULL,
  execution_mode      TEXT NOT NULL CHECK(execution_mode IN ('deterministic','stochastic','hybrid')),
  estimated_tokens    INTEGER NOT NULL DEFAULT 0,
  capabilities_required TEXT NOT NULL DEFAULT '[]',
  state               TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(state IN ('PENDING','SCHEDULED','RUNNING','COMPLETED','FAILED','CANCELLED','BLOCKED')),
  assigned_agent      TEXT,
  checkpoint          BLOB,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  max_retries         INTEGER NOT NULL DEFAULT 2,
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 30000,
  last_heartbeat_at   TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  completed_at        TEXT
);

CREATE INDEX idx_tasks_mission ON core_tasks(mission_id);
CREATE INDEX idx_tasks_tenant ON core_tasks(tenant_id);
CREATE INDEX idx_tasks_state ON core_tasks(state);
CREATE INDEX idx_tasks_graph ON core_tasks(graph_id);
CREATE INDEX idx_tasks_mission_state ON core_tasks(mission_id, state);

CREATE TABLE core_task_dependencies (
  graph_id    TEXT NOT NULL,
  from_task   TEXT NOT NULL,
  to_task     TEXT NOT NULL,
  PRIMARY KEY (graph_id, from_task, to_task),
  CONSTRAINT chk_no_self_dep CHECK(from_task != to_task)
);

CREATE INDEX idx_taskdeps_to ON core_task_dependencies(to_task);
CREATE INDEX idx_taskdeps_graph ON core_task_dependencies(graph_id);

CREATE TABLE core_task_graphs (
  id                    TEXT PRIMARY KEY NOT NULL,
  mission_id            TEXT NOT NULL REFERENCES core_missions(id),
  version               INTEGER NOT NULL,
  objective_alignment   TEXT NOT NULL,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL
);

CREATE INDEX idx_task_graphs_mission ON core_task_graphs(mission_id);
CREATE INDEX idx_task_graphs_active ON core_task_graphs(mission_id, is_active)
  WHERE is_active = 1;
`;

// ─── Migration v10: Artifact Workspace (S8, I-19, I-23) ───

const MIGRATION_010_SQL = `
-- Migration 010: Artifact Workspace
-- S ref: S8 (Artifact), I-19 (immutability), I-23 (dependency tracking)
-- Invariants: I-19 (write-once), I-23 (dependency edges)

CREATE TABLE core_artifacts (
  id                  TEXT NOT NULL,
  version             INTEGER NOT NULL,
  mission_id          TEXT NOT NULL REFERENCES core_missions(id),
  tenant_id           TEXT,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL CHECK(type IN ('report','data','code','analysis','image','raw')),
  format              TEXT NOT NULL CHECK(format IN ('markdown','json','csv','python','sql','html')),
  content             BLOB NOT NULL,
  lifecycle_state     TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(lifecycle_state IN ('ACTIVE','SUMMARIZED','ARCHIVED','DELETED')),
  source_task_id      TEXT NOT NULL,
  parent_artifact_id  TEXT,
  relevance_decay     INTEGER NOT NULL DEFAULT 0,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE INDEX idx_artifacts_mission ON core_artifacts(mission_id);
CREATE INDEX idx_artifacts_tenant ON core_artifacts(tenant_id);
CREATE INDEX idx_artifacts_lifecycle ON core_artifacts(lifecycle_state);
CREATE INDEX idx_artifacts_mission_lifecycle ON core_artifacts(mission_id, lifecycle_state);
CREATE INDEX idx_artifacts_source_task ON core_artifacts(source_task_id);

CREATE TABLE core_artifact_dependencies (
  reading_mission_id  TEXT NOT NULL,
  artifact_id         TEXT NOT NULL,
  artifact_version    INTEGER NOT NULL,
  is_cross_mission    INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (reading_mission_id, artifact_id, artifact_version)
);

CREATE INDEX idx_artdeps_artifact ON core_artifact_dependencies(artifact_id);
`;

// ─── Migration v11: Resources and Checkpoints (S11, S24) ───

const MIGRATION_011_SQL = `
-- Migration 011: Resources and Checkpoints
-- S ref: S11 (Resource/Budget), S24 (Checkpoints)
-- Invariants: I-20 (budget never negative via CHECK)

CREATE TABLE core_resources (
  mission_id          TEXT PRIMARY KEY NOT NULL REFERENCES core_missions(id),
  tenant_id           TEXT,
  token_allocated     INTEGER NOT NULL,
  token_consumed      INTEGER NOT NULL DEFAULT 0,
  token_remaining     INTEGER NOT NULL,
  deadline            TEXT NOT NULL,
  time_elapsed_ms     INTEGER NOT NULL DEFAULT 0,
  compute_max_seconds INTEGER NOT NULL DEFAULT 0,
  compute_consumed_seconds INTEGER NOT NULL DEFAULT 0,
  storage_max_bytes   INTEGER NOT NULL DEFAULT 0,
  storage_consumed_bytes INTEGER NOT NULL DEFAULT 0,
  human_attention_max INTEGER NOT NULL DEFAULT 0,
  human_attention_consumed INTEGER NOT NULL DEFAULT 0,
  llm_call_max        INTEGER NOT NULL DEFAULT 0,
  llm_call_consumed   INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL,
  CONSTRAINT chk_token_remaining CHECK(token_remaining >= 0),
  CONSTRAINT chk_compute_remaining CHECK(compute_consumed_seconds <= compute_max_seconds OR compute_max_seconds = 0),
  CONSTRAINT chk_storage_remaining CHECK(storage_consumed_bytes <= storage_max_bytes OR storage_max_bytes = 0)
);

CREATE INDEX idx_resources_tenant ON core_resources(tenant_id);

CREATE TABLE core_checkpoints (
  id              TEXT PRIMARY KEY NOT NULL,
  mission_id      TEXT NOT NULL REFERENCES core_missions(id),
  tenant_id       TEXT,
  trigger_type    TEXT NOT NULL CHECK(trigger_type IN (
    'BUDGET_THRESHOLD','TASK_COMPLETED','TASK_FAILED',
    'CHILD_MISSION_COMPLETED','HEARTBEAT_MISSED',
    'HUMAN_INPUT_RECEIVED','PERIODIC'
  )),
  trigger_detail  TEXT,
  state           TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(state IN ('PENDING','RESPONDED','EXPIRED')),
  assessment      TEXT,
  confidence      REAL,
  proposed_action TEXT CHECK(proposed_action IN ('continue','replan','escalate','abort') OR proposed_action IS NULL),
  plan_revision   TEXT,
  escalation_reason TEXT,
  system_action   TEXT CHECK(system_action IN ('continue','replan_accepted','replan_rejected','escalated','aborted') OR system_action IS NULL),
  system_reason   TEXT,
  timeout_at      TEXT NOT NULL,
  responded_at    TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_checkpoints_mission ON core_checkpoints(mission_id);
CREATE INDEX idx_checkpoints_state ON core_checkpoints(state);
`;

// ─── Migration v12: Conversations, Results, Compaction (S26, S23, I-21) ───

const MIGRATION_012_SQL = `
-- Migration 012: Conversations, Results, Compaction, Tree Counts, Events
-- S ref: S26 (Conversation), S23 (Results), I-21 (Compaction), I-20 (Tree Counts), S10 (Events)
-- Invariants: I-21 (bounded cognition), I-27 (conversation integrity), I-20 (tree size)

CREATE TABLE core_conversations (
  id                      TEXT PRIMARY KEY NOT NULL,
  session_id              TEXT NOT NULL,
  tenant_id               TEXT,
  agent_id                TEXT NOT NULL,
  parent_conversation_id  TEXT REFERENCES core_conversations(id),
  fork_at_turn            INTEGER,
  total_turns             INTEGER NOT NULL DEFAULT 0,
  total_tokens            INTEGER NOT NULL DEFAULT 0,
  summarized_up_to        INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX idx_conversations_session ON core_conversations(session_id);
CREATE INDEX idx_conversations_tenant ON core_conversations(tenant_id);
CREATE INDEX idx_conversations_parent ON core_conversations(parent_conversation_id);

CREATE TABLE core_conversation_turns (
  id                  TEXT PRIMARY KEY NOT NULL,
  conversation_id     TEXT NOT NULL REFERENCES core_conversations(id),
  turn_number         INTEGER NOT NULL,
  role                TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content             TEXT NOT NULL,
  token_count         INTEGER NOT NULL DEFAULT 0,
  model_used          TEXT,
  is_summary          INTEGER NOT NULL DEFAULT 0,
  is_learning_source  INTEGER NOT NULL DEFAULT 0,
  participant_id      TEXT,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE(conversation_id, turn_number)
);

CREATE INDEX idx_turns_conversation ON core_conversation_turns(conversation_id);
CREATE INDEX idx_turns_conversation_number ON core_conversation_turns(conversation_id, turn_number);

CREATE TABLE core_mission_results (
  mission_id      TEXT PRIMARY KEY NOT NULL REFERENCES core_missions(id),
  tenant_id       TEXT,
  summary         TEXT NOT NULL,
  confidence      REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
  artifact_ids    TEXT NOT NULL,
  unresolved_questions TEXT NOT NULL DEFAULT '[]',
  followup_recommendations TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL
);

CREATE TABLE core_compaction_log (
  id                  TEXT PRIMARY KEY NOT NULL,
  mission_id          TEXT NOT NULL REFERENCES core_missions(id),
  summary_artifact_id TEXT NOT NULL,
  missions_compacted  TEXT NOT NULL,
  artifacts_archived  INTEGER NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_compaction_mission ON core_compaction_log(mission_id);

CREATE TABLE core_tree_counts (
  root_mission_id TEXT PRIMARY KEY NOT NULL,
  total_count     INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_count_positive CHECK(total_count >= 1)
);

CREATE TABLE core_events_log (
  id              TEXT PRIMARY KEY NOT NULL,
  tenant_id       TEXT,
  type            TEXT NOT NULL,
  scope           TEXT NOT NULL CHECK(scope IN ('system','mission','task')),
  mission_id      TEXT,
  payload_json    TEXT NOT NULL,
  propagation     TEXT NOT NULL CHECK(propagation IN ('up','down','local')),
  emitted_by      TEXT NOT NULL,
  timestamp_ms    INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_events_mission ON core_events_log(mission_id);
CREATE INDEX idx_events_type ON core_events_log(type);
CREATE INDEX idx_events_tenant ON core_events_log(tenant_id);
CREATE INDEX idx_events_timestamp ON core_events_log(timestamp_ms);
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
 * Get Phase 3 (Orchestration) migrations.
 * S ref: C-05 (forward-only), C-09 (namespace prefixes on all tables)
 *
 * Versions 8-12 continue from Phase 2's version 7.
 * Creates 15 new tables across 5 migrations.
 */
export function getPhase3Migrations(): MigrationEntry[] {
  return [
    buildEntry(8, 'orchestration_missions', MIGRATION_008_SQL),
    buildEntry(9, 'orchestration_tasks', MIGRATION_009_SQL),
    buildEntry(10, 'orchestration_artifacts', MIGRATION_010_SQL),
    buildEntry(11, 'orchestration_resources', MIGRATION_011_SQL),
    buildEntry(12, 'orchestration_runtime', MIGRATION_012_SQL),
  ];
}
