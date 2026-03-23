/**
 * Forward-only migration v16: Learning System Technique Storage
 * S ref: S29.2 (technique schema), I-07 (agent isolation), FM-10 (tenant isolation)
 *
 * Phase: 4E-2a (Certification — Learning System TechniqueStore)
 *
 * Adds:
 *   - learning_techniques table (core technique storage)
 *   - Indexes for tenant+agent lookup and status filtering
 *   - Tenant immutability trigger (same pattern as Phase 4B)
 *
 * Schema derives from Technique interface in learning_types.ts:
 *   id, tenant_id, agent_id, type, content, source_memory_ids (JSON),
 *   confidence, success_rate, application_count, last_applied,
 *   last_updated, status, created_at
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v16: Learning Techniques Table ───

const MIGRATION_016_SQL = `
-- Migration 016: Learning System Technique Storage
-- S ref: S29.2 (technique schema), I-07 (agent isolation), FM-10 (tenant isolation)
-- Phase: 4E-2a
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- Core technique table
-- Each row is a learned technique scoped to tenant × agent.
-- source_memory_ids stored as JSON array for provenance chain.
-- ────────────────────────────────────────────────────────────

CREATE TABLE learning_techniques (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  agent_id        TEXT    NOT NULL,
  type            TEXT    NOT NULL CHECK (type IN ('prompt_fragment', 'decision_rule', 'rag_pattern')),
  content         TEXT    NOT NULL,
  source_memory_ids TEXT  NOT NULL,  -- JSON array of memory IDs (provenance chain, S29.3 Step 4)
  confidence      REAL    NOT NULL,
  success_rate    REAL    NOT NULL DEFAULT 0.0,
  application_count INTEGER NOT NULL DEFAULT 0,
  last_applied    TEXT,              -- ISO timestamp, NULL if never applied
  last_updated    TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'retired')),
  created_at      TEXT    NOT NULL
);

-- ────────────────────────────────────────────────────────────
-- Indexes
-- Primary access pattern: tenant + agent (all queries scoped by both)
-- Secondary: status filtering for getByAgent with status filter
-- ────────────────────────────────────────────────────────────

CREATE INDEX idx_lt_tenant_agent ON learning_techniques(tenant_id, agent_id);
CREATE INDEX idx_lt_tenant_agent_status ON learning_techniques(tenant_id, agent_id, status);

-- ────────────────────────────────────────────────────────────
-- Tenant immutability trigger (same pattern as Phase 4B)
-- Prevents tenant_id from being changed after INSERT.
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER learning_techniques_tenant_immutable
  BEFORE UPDATE OF tenant_id ON learning_techniques
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on learning_techniques');
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
 * Get Phase 4E-2a (Learning TechniqueStore) migration.
 * Version 16 continues from Phase 4D-4's version 15.
 */
export function getPhase4E2aTechniquesMigration(): MigrationEntry[] {
  return [
    buildEntry(16, 'learning_techniques', MIGRATION_016_SQL),
  ];
}
