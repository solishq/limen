/**
 * Migration v25: Governance capability manifests.
 * Truth Model: Deliverable 9 (Capability Manifest Schema)
 *
 * Phase: 0A (Foundation)
 *
 * Tables: gov_capability_manifests
 *
 * BC-100: CapabilityManifest carries trust tier.
 * BC-103: Manifest immutable once registered — no UPDATE.
 * BC-102: secretRequirements carry references only, never plaintext.
 * INV-X04: schemaVersion on every entity.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_025_SQL = `
-- Migration 025: Governance capability manifests
-- Truth Model: Deliverable 9

-- gov_capability_manifests: Immutable capability registration (BC-100, BC-103)
CREATE TABLE gov_capability_manifests (
  manifest_id         TEXT    PRIMARY KEY,
  capability_type     TEXT    NOT NULL UNIQUE,
  trust_tier          TEXT    NOT NULL CHECK (trust_tier IN (
    'deterministic-local', 'sandboxed-local', 'remote-tenant',
    'remote-third-party', 'human-mediated'
  )),
  side_effect_class   TEXT    NOT NULL CHECK (side_effect_class IN (
    'none', 'idempotent', 'reversible', 'irreversible'
  )),
  secret_requirements TEXT    NOT NULL,
  schema_version      TEXT    NOT NULL,
  created_at          TEXT    NOT NULL
);

-- BC-103: Manifests are immutable — no UPDATE.
CREATE TRIGGER gov_capability_manifests_no_update
  BEFORE UPDATE ON gov_capability_manifests
  BEGIN
    SELECT RAISE(ABORT, 'BC-103: Capability manifests are immutable. UPDATE is prohibited.');
  END;

-- BC-103: Manifests are immutable — no DELETE.
CREATE TRIGGER gov_capability_manifests_no_delete
  BEFORE DELETE ON gov_capability_manifests
  BEGIN
    SELECT RAISE(ABORT, 'BC-103: Capability manifests are immutable. DELETE is prohibited.');
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

export function getGovernanceCapabilitiesMigrations(): MigrationEntry[] {
  return [buildEntry(25, 'governance_capabilities', MIGRATION_025_SQL)];
}
