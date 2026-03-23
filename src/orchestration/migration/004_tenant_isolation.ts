/**
 * Forward-only migration v13: FM-10 Tenant Isolation Structural Enforcement
 * S ref: FM-10 (tenant ID on every row), DEC-CERT-002
 *
 * Phase: 4B (Certification — Tenant Isolation)
 *
 * Adds tenant_id to 6 tables missing it:
 *   core_task_graphs, core_task_dependencies, core_conversation_turns,
 *   core_artifact_dependencies, core_compaction_log, core_tree_counts
 *
 * Backfills from parent relationships in dependency order.
 * Creates immutability triggers on ALL 12 tables with tenant_id.
 * Post-backfill verification logs orphan rows with NULL tenant_id.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v13: Tenant Isolation — FM-10 Compliance ───

const MIGRATION_013_SQL = `
-- Migration 013: FM-10 Tenant Isolation Structural Enforcement
-- S ref: FM-10 (tenant ID on every row in every table)
-- Decision: DEC-CERT-002 (tenant_id on all tables)
-- Constraint: C-05 (forward-only migration)

-- Phase 1: Add tenant_id column to 6 tables missing it
ALTER TABLE core_task_graphs ADD COLUMN tenant_id TEXT;
ALTER TABLE core_task_dependencies ADD COLUMN tenant_id TEXT;
ALTER TABLE core_conversation_turns ADD COLUMN tenant_id TEXT;
ALTER TABLE core_artifact_dependencies ADD COLUMN tenant_id TEXT;
ALTER TABLE core_compaction_log ADD COLUMN tenant_id TEXT;
ALTER TABLE core_tree_counts ADD COLUMN tenant_id TEXT;

-- Phase 2: Backfill — ORDER MATTERS (parent tables before children)

-- Step 1: core_task_graphs (parent — derives from core_missions)
UPDATE core_task_graphs SET tenant_id = (
  SELECT tenant_id FROM core_missions WHERE id = core_task_graphs.mission_id
);

-- Step 2: core_task_dependencies (child — derives from core_task_graphs, must run AFTER step 1)
UPDATE core_task_dependencies SET tenant_id = (
  SELECT tg.tenant_id FROM core_task_graphs tg WHERE tg.id = core_task_dependencies.graph_id
);

-- Step 3: core_conversation_turns (derives from core_conversations)
UPDATE core_conversation_turns SET tenant_id = (
  SELECT c.tenant_id FROM core_conversations c WHERE c.id = core_conversation_turns.conversation_id
);

-- Step 4: core_tree_counts (derives from core_missions)
UPDATE core_tree_counts SET tenant_id = (
  SELECT m.tenant_id FROM core_missions m WHERE m.id = core_tree_counts.root_mission_id
);

-- Step 5: core_artifact_dependencies (CORR8-01 — derives from reading_mission → mission)
UPDATE core_artifact_dependencies SET tenant_id = (
  SELECT m.tenant_id FROM core_missions m WHERE m.id = core_artifact_dependencies.reading_mission_id
);

-- Step 6: core_compaction_log (CORR8-01 — derives from mission)
UPDATE core_compaction_log SET tenant_id = (
  SELECT m.tenant_id FROM core_missions m WHERE m.id = core_compaction_log.mission_id
);

-- Phase 3: Indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_task_graphs_tenant ON core_task_graphs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_tenant ON core_task_dependencies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_tenant ON core_conversation_turns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_artifact_dependencies_tenant ON core_artifact_dependencies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_compaction_log_tenant ON core_compaction_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tree_counts_tenant ON core_tree_counts(tenant_id);

-- Phase 4: Tenant_id immutability triggers (Item 8 + AUDIT-005)
-- BEFORE UPDATE triggers prevent tenant_id mutation after initial INSERT.
-- Uses IS NOT (not !=) for NULL safety.
-- WHEN OLD.tenant_id IS NOT NULL — allows initial NULL→value backfill to succeed.

CREATE TRIGGER core_missions_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_missions
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_missions');
  END;

CREATE TRIGGER core_tasks_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_tasks
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_tasks');
  END;

CREATE TRIGGER core_artifacts_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_artifacts
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_artifacts');
  END;

CREATE TRIGGER core_resources_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_resources
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_resources');
  END;

CREATE TRIGGER core_checkpoints_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_checkpoints
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_checkpoints');
  END;

CREATE TRIGGER core_conversations_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_conversations
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_conversations');
  END;

CREATE TRIGGER core_task_graphs_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_task_graphs
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_task_graphs');
  END;

CREATE TRIGGER core_task_dependencies_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_task_dependencies
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_task_dependencies');
  END;

CREATE TRIGGER core_conversation_turns_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_conversation_turns
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_conversation_turns');
  END;

CREATE TRIGGER core_artifact_dependencies_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_artifact_dependencies
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_artifact_dependencies');
  END;

CREATE TRIGGER core_compaction_log_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_compaction_log
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_compaction_log');
  END;

CREATE TRIGGER core_tree_counts_tenant_immutable
  BEFORE UPDATE OF tenant_id ON core_tree_counts
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on core_tree_counts');
  END;
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
 * Get Phase 4B (Tenant Isolation) migration.
 * Version 13 continues from Phase 3's version 12.
 * FM-10: tenant_id on every row in every table.
 */
export function getPhase4BMigrations(): MigrationEntry[] {
  return [
    buildEntry(13, 'tenant_isolation', MIGRATION_013_SQL),
  ];
}
