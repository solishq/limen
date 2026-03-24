/**
 * Migration v36: Interactions Retention Policy.
 * PRR-PE-016: core_interactions table had no retention policy, causing unbounded growth.
 *
 * Schema changes:
 *   - Recreates core_retention_policies with expanded CHECK constraint (adds 'interactions')
 *   - Seeds default 90-day delete policy for interactions
 *
 * The original CHECK constraint in migration 003 only allowed:
 *   'memories','audit','sessions','artifacts','techniques','events'
 * This migration adds 'interactions' to support chat interaction retention.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_036_SQL = `
-- Migration 036: Interactions Retention Policy
-- PRR-PE-016: Prevent unbounded growth of core_interactions table.

-- Step 1: Recreate core_retention_policies with expanded CHECK constraint.
-- SQLite does not support ALTER CHECK, so table recreation is required.
CREATE TABLE core_retention_policies_v2 (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT,
  data_type       TEXT    NOT NULL CHECK (data_type IN ('memories','audit','sessions','artifacts','techniques','events','interactions')),
  retention_days  INTEGER NOT NULL,
  action          TEXT    NOT NULL DEFAULT 'archive' CHECK (action IN ('archive','delete','soft_delete')),
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(tenant_id, data_type)
);

-- Step 2: Preserve existing policies.
INSERT INTO core_retention_policies_v2 SELECT * FROM core_retention_policies;

-- Step 3: Replace original table.
DROP TABLE core_retention_policies;
ALTER TABLE core_retention_policies_v2 RENAME TO core_retention_policies;

-- Step 4: Seed interactions retention (90 days, delete — same as events).
-- ON CONFLICT handles re-runs safely.
INSERT INTO core_retention_policies (id, tenant_id, data_type, retention_days, action, enabled, created_at, updated_at)
VALUES (
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  NULL, 'interactions', 90, 'delete', 1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(tenant_id, data_type) DO NOTHING;
`;

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

export function getInteractionsRetentionMigrations(): MigrationEntry[] {
  return [buildEntry(36, 'interactions_retention', MIGRATION_036_SQL)];
}
