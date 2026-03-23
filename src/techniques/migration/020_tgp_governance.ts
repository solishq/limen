/**
 * Forward-only migration v29: TGP (Technique Governance Protocol) Schema Extensions
 * Spec ref: TGP v1.0 Design Source §5-§9, Architecture Freeze CF-12/CF-13
 *
 * Phase: 1 (TGP)
 *
 * Changes to learning_techniques (table rebuild — SQLite cannot ALTER CHECK/NOT NULL):
 *   - status CHECK: adds 'candidate' state [CF-12, §5.1]
 *   - success_rate: NOT NULL → nullable [AMB-05, DC-TGP-905]
 *   - default status: 'active' → 'candidate' [PSD-1]
 *   - New columns: provenance_kind, quarantined_at, promoted_at,
 *     promotion_decision_id, transfer_source_technique_id, retired_at, retired_reason
 *
 * New tables:
 *   - technique_evaluations [§6.2, PSD-2]
 *   - technique_promotion_decisions [§6.3, CF-13]
 *
 * Triggers:
 *   - TGP-I1: content, type, source_memory_ids, provenance_kind immutable
 *   - TGP-I2: no backward to candidate, retired terminal, no candidate→suspended
 *   - DC-TGP-211: promotion fields immutable once set
 *   - Evaluation/decision immutability (no UPDATE, no DELETE)
 *
 * Invariants enforced:
 *   TGP-I1: Immutable technique definition (trigger-enforced)
 *   TGP-I2: Forward-only lifecycle (trigger-enforced)
 *   TGP-I4: CF-13 audit sufficiency (schema-enforced NOT NULL on CF-13 fields)
 *   TGP-I5: Quarantine promotion block (quarantined_at column)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_029_SQL = `
-- Migration 029: TGP (Technique Governance Protocol) Schema Extensions
-- Spec ref: TGP v1.0 Design Source, Architecture Freeze CF-12/CF-13
-- Phase: 1 (TGP)

-- ============================================================================
-- Step 1: Rebuild learning_techniques with TGP extensions
-- SQLite cannot ALTER CHECK constraints or change NOT NULL → nullable.
-- Table rebuild required. [DC-TGP-905]
-- ============================================================================

-- Drop triggers that reference the old table
DROP TRIGGER IF EXISTS learning_techniques_tenant_immutable;

-- Rename old table
ALTER TABLE learning_techniques RENAME TO _learning_techniques_v32;

-- Create new table with TGP extensions
CREATE TABLE learning_techniques (
  id                           TEXT    PRIMARY KEY,
  tenant_id                    TEXT    NOT NULL,
  agent_id                     TEXT    NOT NULL,
  type                         TEXT    NOT NULL CHECK (type IN ('prompt_fragment', 'decision_rule', 'rag_pattern')),
  content                      TEXT    NOT NULL,
  source_memory_ids            TEXT    NOT NULL,
  confidence                   REAL    NOT NULL,
  success_rate                 REAL,
  application_count            INTEGER NOT NULL DEFAULT 0,
  last_applied                 TEXT,
  last_updated                 TEXT    NOT NULL,
  status                       TEXT    NOT NULL DEFAULT 'candidate'
                               CHECK (status IN ('candidate', 'active', 'suspended', 'retired')),
  created_at                   TEXT    NOT NULL,
  provenance_kind              TEXT    DEFAULT 'local_extraction'
                               CHECK (provenance_kind IN ('local_extraction', 'cross_agent_transfer', 'template_seed')),
  quarantined_at               TEXT,
  promoted_at                  TEXT,
  promotion_decision_id        TEXT,
  transfer_source_technique_id TEXT,
  retired_at                   TEXT,
  retired_reason               TEXT    CHECK (retired_reason IS NULL OR retired_reason IN (
                                 'low_success_rate', 'low_confidence', 'stale', 'human_flagged',
                                 'candidate_expiry', 'quarantine_permanent'))
);

-- Copy v3.2 data (existing techniques are active with local_extraction provenance)
INSERT INTO learning_techniques (
  id, tenant_id, agent_id, type, content, source_memory_ids,
  confidence, success_rate, application_count, last_applied,
  last_updated, status, created_at,
  provenance_kind
)
SELECT
  id, tenant_id, agent_id, type, content, source_memory_ids,
  confidence, success_rate, application_count, last_applied,
  last_updated, status, created_at,
  'local_extraction'
FROM _learning_techniques_v32;

-- Drop backup
DROP TABLE _learning_techniques_v32;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_lt_tenant_agent ON learning_techniques(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_lt_tenant_agent_status ON learning_techniques(tenant_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_lt_tenant_status ON learning_techniques(tenant_id, status);

-- ============================================================================
-- Step 2: Triggers for TGP invariants on learning_techniques
-- ============================================================================

-- Tenant immutability (restored from v3.2 migration 016)
CREATE TRIGGER IF NOT EXISTS learning_techniques_tenant_immutable
  BEFORE UPDATE OF tenant_id ON learning_techniques
  WHEN OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT OLD.tenant_id
  BEGIN
    SELECT RAISE(ABORT, 'I-MUT: tenant_id is immutable after INSERT on learning_techniques');
  END;

-- TGP-I1: Content immutability (content, type, source_memory_ids, provenance_kind)
CREATE TRIGGER IF NOT EXISTS tgp_content_immutable
  BEFORE UPDATE ON learning_techniques
  WHEN NEW.content IS NOT OLD.content
    OR NEW.type IS NOT OLD.type
    OR NEW.source_memory_ids IS NOT OLD.source_memory_ids
    OR (OLD.provenance_kind IS NOT NULL AND NEW.provenance_kind IS NOT OLD.provenance_kind)
  BEGIN
    SELECT RAISE(ABORT, 'TGP-I1: content, type, source_memory_ids, provenance_kind are immutable');
  END;

-- TGP-I2: No backward transition to candidate
CREATE TRIGGER IF NOT EXISTS tgp_no_backward_to_candidate
  BEFORE UPDATE OF status ON learning_techniques
  WHEN NEW.status = 'candidate' AND OLD.status != 'candidate'
  BEGIN
    SELECT RAISE(ABORT, 'TGP-I2: backward transition to candidate is prohibited');
  END;

-- TGP-I2: Retired is terminal
CREATE TRIGGER IF NOT EXISTS tgp_retired_terminal
  BEFORE UPDATE OF status ON learning_techniques
  WHEN OLD.status = 'retired' AND NEW.status != 'retired'
  BEGIN
    SELECT RAISE(ABORT, 'TGP-I2: retired is a terminal state');
  END;

-- TGP-I2: Candidate cannot skip to suspended
CREATE TRIGGER IF NOT EXISTS tgp_candidate_no_suspended
  BEFORE UPDATE OF status ON learning_techniques
  WHEN OLD.status = 'candidate' AND NEW.status = 'suspended'
  BEGIN
    SELECT RAISE(ABORT, 'TGP-I2: candidate cannot transition directly to suspended');
  END;

-- DC-TGP-211: Promotion fields immutable once set
CREATE TRIGGER IF NOT EXISTS tgp_promotion_fields_immutable
  BEFORE UPDATE ON learning_techniques
  WHEN OLD.promoted_at IS NOT NULL
    AND (NEW.promoted_at IS NOT OLD.promoted_at
      OR NEW.promotion_decision_id IS NOT OLD.promotion_decision_id)
  BEGIN
    SELECT RAISE(ABORT, 'TGP: promotion fields (promoted_at, promotion_decision_id) are immutable after set');
  END;

-- ============================================================================
-- Step 3: Technique Evaluations table [§6.2, PSD-2]
-- ============================================================================

CREATE TABLE IF NOT EXISTS technique_evaluations (
  id                    TEXT    PRIMARY KEY,
  technique_id          TEXT    NOT NULL,
  agent_id              TEXT    NOT NULL,
  tenant_id             TEXT    NOT NULL,
  evaluator_agent_id    TEXT    NOT NULL,
  mission_id            TEXT,
  evaluation_source     TEXT    NOT NULL CHECK (evaluation_source IN ('runtime', 'template', 'transfer_history', 'manual')),
  baseline_performance  TEXT    NOT NULL,
  technique_performance TEXT    NOT NULL,
  comparison_result     TEXT    NOT NULL,
  confidence_score      REAL,
  evaluation_method     TEXT    NOT NULL CHECK (evaluation_method IN ('shadow_execution', 'dedicated_task', 'retrospective', 'human_review', 'template_provided')),
  created_at            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_te_tenant_technique ON technique_evaluations(tenant_id, technique_id);
CREATE INDEX IF NOT EXISTS idx_te_tenant ON technique_evaluations(tenant_id);

-- Evaluations are immutable after creation
CREATE TRIGGER IF NOT EXISTS tgp_evaluation_immutable
  BEFORE UPDATE ON technique_evaluations
  BEGIN
    SELECT RAISE(ABORT, 'TGP: technique_evaluations records are immutable after creation');
  END;

-- Evaluations cannot be deleted
CREATE TRIGGER IF NOT EXISTS tgp_evaluation_no_delete
  BEFORE DELETE ON technique_evaluations
  BEGIN
    SELECT RAISE(ABORT, 'TGP: technique_evaluations cannot be deleted');
  END;

-- ============================================================================
-- Step 4: Technique Promotion Decisions table [§6.3, CF-13]
-- ============================================================================

CREATE TABLE IF NOT EXISTS technique_promotion_decisions (
  id                        TEXT    PRIMARY KEY,
  technique_id              TEXT    NOT NULL,
  agent_id                  TEXT    NOT NULL,
  tenant_id                 TEXT    NOT NULL,
  decided_by                TEXT    NOT NULL,
  evaluation_lineage        TEXT    NOT NULL,
  confidence_threshold      REAL,
  decision_rule             TEXT    NOT NULL,
  activation_basis          TEXT    NOT NULL,
  policy_version            TEXT    NOT NULL,
  evaluation_schema_version TEXT    NOT NULL,
  threshold_config_version  TEXT    NOT NULL,
  result                    TEXT    NOT NULL CHECK (result IN ('promoted', 'rejected')),
  rejection_reason          TEXT,
  decided_at                TEXT    NOT NULL,
  activated_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_tpd_tenant_technique ON technique_promotion_decisions(tenant_id, technique_id);
CREATE INDEX IF NOT EXISTS idx_tpd_tenant ON technique_promotion_decisions(tenant_id);

-- Promotion decisions are immutable after creation
CREATE TRIGGER IF NOT EXISTS tgp_decision_immutable
  BEFORE UPDATE ON technique_promotion_decisions
  BEGIN
    SELECT RAISE(ABORT, 'TGP: technique_promotion_decisions records are immutable after creation');
  END;

-- Promotion decisions cannot be deleted
CREATE TRIGGER IF NOT EXISTS tgp_decision_no_delete
  BEFORE DELETE ON technique_promotion_decisions
  BEGIN
    SELECT RAISE(ABORT, 'TGP: technique_promotion_decisions cannot be deleted');
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

/**
 * Get TGP (Technique Governance Protocol) migration.
 * Version 29 continues from CCP's version 28.
 */
export function getTgpGovernanceMigration(): MigrationEntry[] {
  return [
    buildEntry(29, 'tgp_governance', MIGRATION_029_SQL),
  ];
}
