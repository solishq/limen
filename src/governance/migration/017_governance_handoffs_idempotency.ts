/**
 * Migration v26: Governance handoffs, idempotency keys, and resume tokens.
 * Truth Model: Deliverable 7 (Handoff Protocol), Deliverable 12 (Idempotency)
 *
 * Phase: 0A (Foundation)
 *
 * Tables: gov_handoffs, gov_idempotency_keys, gov_resume_tokens
 *
 * BC-050: Handoff entity with lifecycle state machine.
 * BC-130: Idempotency key composite scope: (tenant_id, caller_id, syscall_class, target_scope, key).
 * BC-133: Same key + different hash → IDEMPOTENCY_CONFLICT.
 * BC-136: Resume token — plaintext returned once, only hash stored.
 * BC-137: Resume token stored as SHA-256 hash.
 * BC-138: Resume token single-use consumption.
 * BC-139: Consumed tokens retained as tombstoned record for audit.
 * INV-131: Idempotency key TTL enforcement.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_026_SQL = `
-- Migration 026: Governance handoffs, idempotency keys, and resume tokens
-- Truth Model: Deliverables 7, 12

-- gov_handoffs: Handoff lifecycle (BC-050)
CREATE TABLE gov_handoffs (
  handoff_id          TEXT    PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  mission_id          TEXT    NOT NULL,
  delegator_agent_id  TEXT    NOT NULL,
  delegate_agent_id   TEXT    NOT NULL,
  child_task_id       TEXT,
  state               TEXT    NOT NULL CHECK (state IN (
    'issued', 'accepted', 'active', 'returned',
    'rejected', 'completed', 'failed'
  )),
  acceptance_outcome  TEXT,
  rejection_reason    TEXT,
  schema_version      TEXT    NOT NULL,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);

CREATE INDEX idx_gov_handoffs_tenant ON gov_handoffs (tenant_id);
CREATE INDEX idx_gov_handoffs_mission ON gov_handoffs (mission_id);
CREATE INDEX idx_gov_handoffs_delegator ON gov_handoffs (delegator_agent_id);
CREATE INDEX idx_gov_handoffs_delegate ON gov_handoffs (delegate_agent_id);

-- gov_idempotency_keys: Composite-scoped idempotency (BC-130)
-- BC-130: Primary key is the full composite scope.
-- INV-131: TTL enforced via expires_at check at read time.
CREATE TABLE gov_idempotency_keys (
  tenant_id                TEXT    NOT NULL,
  caller_id                TEXT    NOT NULL,
  syscall_class            TEXT    NOT NULL,
  target_scope             TEXT    NOT NULL,
  key                      TEXT    NOT NULL,
  payload_hash             TEXT    NOT NULL,
  canonicalization_version TEXT    NOT NULL,
  correlation_id           TEXT    NOT NULL,
  created_at               TEXT    NOT NULL,
  expires_at               TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, caller_id, syscall_class, target_scope, key)
);

CREATE INDEX idx_gov_idempotency_keys_expires ON gov_idempotency_keys (expires_at);
CREATE INDEX idx_gov_idempotency_keys_correlation ON gov_idempotency_keys (correlation_id);

-- gov_resume_tokens: Single-use resume tokens (BC-136, BC-137, BC-138)
-- BC-137: Only the SHA-256 hash is stored, never plaintext.
-- BC-138: consumed flag enforces single-use.
-- BC-139: Consumed tokens retained (tombstoned), never deleted.
CREATE TABLE gov_resume_tokens (
  token_hash              TEXT    PRIMARY KEY,
  tenant_id               TEXT    NOT NULL,
  suspension_record_id    TEXT    NOT NULL,
  decision_id             TEXT    NOT NULL,
  expires_at              TEXT    NOT NULL,
  consumed                INTEGER NOT NULL DEFAULT 0,
  consumed_at             TEXT,
  created_at              TEXT    NOT NULL
);

CREATE INDEX idx_gov_resume_tokens_tenant ON gov_resume_tokens (tenant_id);
CREATE INDEX idx_gov_resume_tokens_suspension ON gov_resume_tokens (suspension_record_id);

-- BC-139: Resume tokens are never deleted (tombstone semantics).
CREATE TRIGGER gov_resume_tokens_no_delete
  BEFORE DELETE ON gov_resume_tokens
  BEGIN
    SELECT RAISE(ABORT, 'BC-139: Resume tokens use tombstone semantics. DELETE is prohibited.');
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

export function getGovernanceHandoffsIdempotencyMigrations(): MigrationEntry[] {
  return [buildEntry(26, 'governance_handoffs_idempotency', MIGRATION_026_SQL)];
}
