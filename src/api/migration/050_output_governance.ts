// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_OUTPUT_GOVERNANCE.md §7
/**
 * Migration v50: Output Governance Tables
 *
 * OG-7.4, OG-7.19, OG-7.28: Creates tables for plugin and hook persistence.
 *
 * Schema changes:
 *   1. CREATE TABLE output_plugins (plugin registration records)
 *   2. CREATE TABLE output_hooks (hook registration records)
 *
 * Additive only. No ALTER, no DROP. Forward-only (AD-12).
 * Idempotent: IF NOT EXISTS on all tables. Running twice is safe.
 *
 * Note: Output primitives and telemetry are stored as governed claims in the
 * existing claim_assertions table (via CCP). Only plugin and hook metadata
 * requires dedicated tables for lifecycle management.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_050_SQL = `
-- Migration 050: Output Governance Plugin & Hook Tables
-- OG-7.19, OG-7.28: 2 tables for output governance subsystem

-- output_plugins: Plugin registration records (OG-7.19)
-- BRK-012: Added tenant_id for multi-tenant isolation
CREATE TABLE IF NOT EXISTS output_plugins (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'error')),
  installed_at TEXT NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  config TEXT NOT NULL DEFAULT '{}'
);

-- Unique constraint on plugin name per tenant (OG-7.1: id uniqueness, name for lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_output_plugins_name ON output_plugins(tenant_id, name);

-- output_hooks: Hook registration records (OG-7.28)
-- BRK-012: Added tenant_id for multi-tenant isolation
CREATE TABLE IF NOT EXISTS output_hooks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('before_assert', 'after_assert', 'before_recall', 'after_recall', 'before_decay', 'before_output', 'after_output')),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  name TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  fired_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  last_fired_at TEXT,
  error_count INTEGER NOT NULL DEFAULT 0
);

-- Index for hook lookup by type (OG-12.7: deterministic ordering)
CREATE INDEX IF NOT EXISTS idx_output_hooks_type_priority ON output_hooks(tenant_id, type, priority, registered_at);
`;

/**
 * Return migration entries for output governance tables.
 * Forward-only (AD-12). Idempotent via IF NOT EXISTS.
 */
export function getOutputGovernanceMigrations(): MigrationEntry[] {
  const checksum = createHash('sha256').update(MIGRATION_050_SQL).digest('hex');
  return [
    {
      version: 50,
      name: 'output_governance_plugin_hook_tables',
      sql: MIGRATION_050_SQL,
      checksum,
    },
  ];
}
