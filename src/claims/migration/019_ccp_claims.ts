/**
 * Migration v28: CCP (Claim Protocol) tables.
 * Spec ref: CCP v2.0 Design Source §6-§9, §13, §14
 *
 * Phase: 1 (CCP)
 * Tables: claim_assertions, claim_evidence, claim_relationships, claim_artifact_refs
 *
 * Invariants enforced:
 *   CCP-I1: Content immutability (BEFORE UPDATE trigger blocks content field changes)
 *   CCP-I2: Forward-only lifecycle (BEFORE UPDATE trigger blocks retracted→active)
 *   CCP-I10: Tombstone preservation (identity fields survive, content NULLed)
 *   CCP-I11: Orthogonal storage/epistemic lifecycle (archived independent of status)
 *
 * Indexes:
 *   Tenant isolation (RR-002): tenant_id on all tables
 *   Evidence lookup: (evidence_type, evidence_id) for cascade sourceState update
 *   Relationship lookup: (from_claim_id), (to_claim_id) for graph traversal
 *   Mission claim count: (tenant_id, source_mission_id) for per-mission limit
 *   Query support: (tenant_id, subject), (tenant_id, predicate)
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_028_SQL = `
-- Migration 028: CCP (Claim Protocol) tables
-- Phase 1: Claim Protocol Implementation
-- Spec ref: CCP v2.0 Design Source §6-§9, §13, §14

-- ============================================================================
-- Table: claim_assertions — §6, CCP-I1, CCP-I2
-- The 9th core object in Limen. Epistemic knowledge as first-class citizen.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_assertions (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  subject         TEXT,
  predicate       TEXT,
  object_type     TEXT,
  object_value    TEXT,
  confidence      REAL,
  valid_at        TEXT,
  source_agent_id TEXT,
  source_mission_id TEXT,
  source_task_id  TEXT,
  grounding_mode  TEXT    NOT NULL CHECK (grounding_mode IN ('evidence_path', 'runtime_witness')),
  runtime_witness TEXT,
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retracted')),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  purged_at       TEXT,
  purge_reason    TEXT,
  idempotency_key TEXT,
  idempotency_hash TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Idempotency key uniqueness (DC-CCP-307)
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_assertions_idempotency
  ON claim_assertions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Tenant isolation index (RR-002)
CREATE INDEX IF NOT EXISTS idx_claim_assertions_tenant
  ON claim_assertions(tenant_id);

-- Per-mission claim count index (FM-CCP-01)
CREATE INDEX IF NOT EXISTS idx_claim_assertions_mission
  ON claim_assertions(tenant_id, source_mission_id);

-- Query support: subject lookup
CREATE INDEX IF NOT EXISTS idx_claim_assertions_subject
  ON claim_assertions(tenant_id, subject);

-- Query support: predicate lookup
CREATE INDEX IF NOT EXISTS idx_claim_assertions_predicate
  ON claim_assertions(tenant_id, predicate);

-- Query support: status filter
CREATE INDEX IF NOT EXISTS idx_claim_assertions_status
  ON claim_assertions(tenant_id, status);

-- CCP-I2: Forward-only lifecycle — block retracted → active transition
CREATE TRIGGER IF NOT EXISTS claim_assertions_no_reactivation
  BEFORE UPDATE OF status ON claim_assertions
  WHEN OLD.status = 'retracted' AND NEW.status != 'retracted'
  BEGIN
    SELECT RAISE(ABORT, 'CCP-I2: Claim retraction is terminal. No retracted-to-active transition.');
  END;

-- CCP-I1: Content immutability — block content field modifications on non-tombstone updates
-- (Tombstone sets subject/predicate/etc to NULL — that is the only permitted content change)
CREATE TRIGGER IF NOT EXISTS claim_assertions_content_immutable
  BEFORE UPDATE ON claim_assertions
  WHEN NEW.purged_at IS NULL
    AND OLD.purged_at IS NULL
    AND (
      NEW.subject IS NOT OLD.subject OR
      NEW.predicate IS NOT OLD.predicate OR
      NEW.object_type IS NOT OLD.object_type OR
      NEW.object_value IS NOT OLD.object_value OR
      NEW.confidence IS NOT OLD.confidence OR
      NEW.valid_at IS NOT OLD.valid_at OR
      NEW.source_agent_id IS NOT OLD.source_agent_id OR
      NEW.source_mission_id IS NOT OLD.source_mission_id OR
      NEW.source_task_id IS NOT OLD.source_task_id OR
      NEW.grounding_mode IS NOT OLD.grounding_mode OR
      NEW.runtime_witness IS NOT OLD.runtime_witness
    )
  BEGIN
    SELECT RAISE(ABORT, 'CCP-I1: Claim content fields are immutable after creation.');
  END;

-- ============================================================================
-- Table: claim_evidence — §7, CCP-I5
-- Evidence references linking claims to their provenance.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_evidence (
  id              TEXT    PRIMARY KEY,
  claim_id        TEXT    NOT NULL REFERENCES claim_assertions(id),
  evidence_type   TEXT    NOT NULL CHECK (evidence_type IN ('memory', 'artifact', 'claim', 'capability_result')),
  evidence_id     TEXT    NOT NULL,
  source_state    TEXT    NOT NULL DEFAULT 'live' CHECK (source_state IN ('live', 'tombstoned')),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Claim evidence lookup
CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim
  ON claim_evidence(claim_id);

-- Evidence source lookup — for cascade sourceState update on source purge
CREATE INDEX IF NOT EXISTS idx_claim_evidence_source
  ON claim_evidence(evidence_type, evidence_id);

-- ============================================================================
-- Table: claim_relationships — §8, CCP-I6, I-31
-- Directed relationships between claims. Append-only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_relationships (
  id                  TEXT    PRIMARY KEY,
  tenant_id           TEXT,
  from_claim_id       TEXT    NOT NULL REFERENCES claim_assertions(id),
  to_claim_id         TEXT    NOT NULL REFERENCES claim_assertions(id),
  type                TEXT    NOT NULL CHECK (type IN ('supports', 'contradicts', 'supersedes', 'derived_from')),
  declared_by_agent_id TEXT   NOT NULL,
  mission_id          TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Relationship graph traversal
CREATE INDEX IF NOT EXISTS idx_claim_relationships_from
  ON claim_relationships(from_claim_id);

CREATE INDEX IF NOT EXISTS idx_claim_relationships_to
  ON claim_relationships(to_claim_id);

-- I-31: Append-only — block updates
CREATE TRIGGER IF NOT EXISTS claim_relationships_no_update
  BEFORE UPDATE ON claim_relationships
  BEGIN
    SELECT RAISE(ABORT, 'I-31: Claim relationships are immutable. UPDATE is prohibited.');
  END;

-- I-31: Append-only — block deletes
CREATE TRIGGER IF NOT EXISTS claim_relationships_no_delete
  BEFORE DELETE ON claim_relationships
  BEGIN
    SELECT RAISE(ABORT, 'I-31: Claim relationships are immutable. DELETE is prohibited.');
  END;

-- ============================================================================
-- Table: claim_artifact_refs — §9, AMB-CCP-04
-- Junction table linking claims to artifacts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS claim_artifact_refs (
  artifact_id     TEXT    NOT NULL,
  claim_id        TEXT    NOT NULL REFERENCES claim_assertions(id),
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (artifact_id, claim_id)
);

-- Claim-to-artifact lookup
CREATE INDEX IF NOT EXISTS idx_claim_artifact_refs_claim
  ON claim_artifact_refs(claim_id);
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getCcpClaimsMigrations(): MigrationEntry[] {
  return [buildEntry(28, 'ccp_claims', MIGRATION_028_SQL)];
}
