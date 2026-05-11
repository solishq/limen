// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability docs/SPRP-PHASE-0.1-TRACEABILITY-FABRIC.md FINDING-024
/**
 * Migration v52: Tighten Agent Name Uniqueness
 *
 * FINDING-024: Agent names must be unique per tenant, regardless of framework.
 * The original index (migration 048) was on (name, framework, COALESCE(tenant_id, '__NULL__')).
 * This allowed two agents with the same name but different frameworks in the same tenant.
 *
 * Fix: Add a UNIQUE index on (name, COALESCE(tenant_id, '__NULL__')) without framework.
 * The old index is dropped first to avoid conflicting constraints.
 *
 * Additive then restrictive. Forward-only (AD-12).
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_052_SQL = `
-- Migration 052: Tighten Agent Name Uniqueness (FINDING-024)
-- Names must be unique per tenant, regardless of framework.

-- Drop the old index that included framework
DROP INDEX IF EXISTS idx_lm_agents_unique_name;

-- Create tighter uniqueness: name + tenant only
CREATE UNIQUE INDEX IF NOT EXISTS idx_lm_agents_unique_name_per_tenant
  ON lm_agents(name, COALESCE(tenant_id, '__NULL__'));
`;

export function getAgentNameUniquenessMigrations(): MigrationEntry[] {
  return [
    {
      version: 52,
      name: 'agent_name_uniqueness',
      sql: MIGRATION_052_SQL,
      checksum: createHash('sha256').update(MIGRATION_052_SQL).digest('hex'),
    },
  ];
}
