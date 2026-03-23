/**
 * Migration v33: Trust Progression + Safety Violations + Interactions.
 * Spec ref: I-09 (Trust is Earned), LEARNING-01 (Cross-Agent Learning),
 *           LEARNING-02 (Interaction Table)
 *
 * Phase: Sprint 2 (Trust & Learning)
 * Tables: core_trust_transitions, core_safety_violations, core_interactions
 *
 * Invariants enforced:
 *   I-09: Trust progression untrusted → probationary → trusted → admin (human only)
 *   I-09: Trust revocable on safety violation
 *   LEARNING-02: Interaction recording for learning pipeline
 *
 * Triggers:
 *   trg_trust_transitions_no_update: Append-only on trust transitions
 *   trg_trust_transitions_no_delete: No delete on trust transitions
 *   trg_safety_violations_no_update: Append-only on safety violations
 *   trg_safety_violations_no_delete: No delete on safety violations
 *   trg_interactions_content_immutable: User input/assistant output immutable
 *   trg_core_agents_trust_admin_guard_v2: Admin trust requires human actor record (5s window, F-S2-004)
 *
 * Replaces:
 *   trg_core_agents_trust_admin_guard (v32 blanket guard → v2 with transition record check)
 *
 * Indexes:
 *   idx_trust_transitions_agent: Agent + created_at for transition history
 *   idx_trust_transitions_tenant: Tenant + agent for scoped lookups
 *   idx_safety_violations_agent: Agent + created_at for violation history
 *   idx_safety_violations_tenant: Tenant + agent for scoped lookups
 *   idx_interactions_agent: Agent + created_at for interaction history
 *   idx_interactions_tenant: Tenant + agent for scoped lookups
 *   idx_interactions_learning: Partial index for learning pipeline (quality > 0.7 + positive)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_033_SQL = `
-- Migration 033: Trust Progression + Safety Violations + Interactions
-- Sprint 2: Trust & Learning
-- Spec ref: I-09, LEARNING-01, LEARNING-02

-- ============================================================================
-- Table: core_trust_transitions — I-09 (Trust is Earned) — append-only audit log
-- Records every trust level change with actor, reason, and criteria snapshot.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_trust_transitions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  agent_id TEXT NOT NULL,
  from_level TEXT NOT NULL CHECK(from_level IN ('untrusted','probationary','trusted','admin')),
  to_level TEXT NOT NULL CHECK(to_level IN ('untrusted','probationary','trusted','admin')),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('system','human','policy')),
  actor_id TEXT,
  reason TEXT NOT NULL,
  criteria_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES core_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_transitions_agent
  ON core_trust_transitions(agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_trust_transitions_tenant
  ON core_trust_transitions(tenant_id, agent_id);

-- Append-only: no updates allowed
CREATE TRIGGER IF NOT EXISTS trg_trust_transitions_no_update
BEFORE UPDATE ON core_trust_transitions
BEGIN
  SELECT RAISE(ABORT, 'TRUST_TRANSITION_IMMUTABLE: trust transition records are append-only');
END;

-- Append-only: no deletes allowed
CREATE TRIGGER IF NOT EXISTS trg_trust_transitions_no_delete
BEFORE DELETE ON core_trust_transitions
BEGIN
  SELECT RAISE(ABORT, 'TRUST_TRANSITION_NO_DELETE: trust transition records cannot be deleted');
END;

-- ============================================================================
-- Table: core_safety_violations — I-09 (Trust Revocation) — append-only
-- Records safety violations that may trigger automatic trust demotion.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_safety_violations (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  agent_id TEXT NOT NULL,
  violation_type TEXT NOT NULL CHECK(violation_type IN ('content_policy','prompt_injection','data_exfiltration','unauthorized_access','rate_abuse','safety_bypass','other')),
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  demotion_applied INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES core_agents(id)
);

CREATE INDEX IF NOT EXISTS idx_safety_violations_agent
  ON core_safety_violations(agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_safety_violations_tenant
  ON core_safety_violations(tenant_id, agent_id);

-- Append-only: no updates allowed
CREATE TRIGGER IF NOT EXISTS trg_safety_violations_no_update
BEFORE UPDATE ON core_safety_violations
BEGIN
  SELECT RAISE(ABORT, 'SAFETY_VIOLATION_IMMUTABLE: safety violation records are append-only');
END;

-- Append-only: no deletes allowed
CREATE TRIGGER IF NOT EXISTS trg_safety_violations_no_delete
BEFORE DELETE ON core_safety_violations
BEGIN
  SELECT RAISE(ABORT, 'SAFETY_VIOLATION_NO_DELETE: safety violation records cannot be deleted');
END;

-- ============================================================================
-- Table: core_interactions — LEARNING-02 (Interaction Table)
-- Learning pipeline input: records chat interactions for technique extraction.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core_interactions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT,
  agent_id TEXT,
  session_id TEXT,
  conversation_id TEXT,
  user_input TEXT NOT NULL,
  assistant_output TEXT NOT NULL,
  model_used TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  quality_score REAL,
  user_feedback TEXT CHECK(user_feedback IS NULL OR user_feedback IN ('positive','negative','correction')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_agent
  ON core_interactions(agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_interactions_tenant
  ON core_interactions(tenant_id, agent_id);

-- Partial index for learning pipeline: only quality interactions with positive feedback
CREATE INDEX IF NOT EXISTS idx_interactions_learning
  ON core_interactions(agent_id, quality_score, created_at)
  WHERE quality_score > 0.7 AND user_feedback = 'positive';

-- User input and assistant output are immutable (content integrity)
CREATE TRIGGER IF NOT EXISTS trg_interactions_content_immutable
BEFORE UPDATE OF user_input, assistant_output ON core_interactions
WHEN NEW.user_input != OLD.user_input OR NEW.assistant_output != OLD.assistant_output
BEGIN
  SELECT RAISE(ABORT, 'INTERACTION_CONTENT_IMMUTABLE: interaction content cannot be modified');
END;

-- ============================================================================
-- Admin Guard v2: Replace Sprint 1's blanket guard with transition-record-verified guard
-- Requires a human-actor transition record in core_trust_transitions within 5 seconds.
-- F-S2-004 FIX: Widened from 2s to 5s to account for clock skew between
-- SQLite's datetime('now') and the application's TimeProvider.nowISO().
-- This trigger is defense-in-depth — the application-level check is the primary guard.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_core_agents_trust_admin_guard;

CREATE TRIGGER IF NOT EXISTS trg_core_agents_trust_admin_guard_v2
BEFORE UPDATE OF trust_level ON core_agents
WHEN NEW.trust_level = 'admin' AND OLD.trust_level != 'admin'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM core_trust_transitions
      WHERE agent_id = OLD.id
        AND to_level = 'admin'
        AND actor_type = 'human'
        AND created_at > datetime('now', '-5 seconds')
    )
    THEN RAISE(ABORT, 'AGENT_TRUST_ESCALATION: admin trust requires human actor record in core_trust_transitions')
  END;
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

export function getTrustLearningMigrations(): MigrationEntry[] {
  return [buildEntry(33, 'trust_learning', MIGRATION_033_SQL)];
}
