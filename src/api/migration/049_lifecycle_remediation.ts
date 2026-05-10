// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Migration v49: Agent Lifecycle Remediation
 *
 * BK-12: Add suspension_reason column to lm_agents
 * BK-16/BK-17: Add FOREIGN KEY constraints via new tables
 *   (SQLite does not support ALTER TABLE ADD FOREIGN KEY;
 *    instead we use triggers to enforce referential integrity)
 *
 * Additive only. No ALTER, no DROP. Forward-only (AD-12).
 * Idempotent: IF NOT EXISTS on all objects. Running twice is safe.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_049_SQL = `
-- Migration 049: Lifecycle Remediation (BK-12, BK-16, BK-17)

-- BK-12: Add suspension_reason column to lm_agents
-- SQLite ALTER TABLE ADD COLUMN does NOT support IF NOT EXISTS.
-- The migration runner tracks applied versions, so this will only run once.
ALTER TABLE lm_agents ADD COLUMN suspension_reason TEXT;

-- BK-16/BK-17: Enforce referential integrity via triggers
-- SQLite foreign keys with IF NOT EXISTS on CREATE TABLE won't work retroactively,
-- so we use BEFORE INSERT triggers to enforce the FK constraint.

-- Trigger: lm_capabilities.agent_id REFERENCES lm_agents(id)
CREATE TRIGGER IF NOT EXISTS trg_lm_capabilities_fk_agent
  BEFORE INSERT ON lm_capabilities
  FOR EACH ROW
  WHEN NOT EXISTS (SELECT 1 FROM lm_agents WHERE id = NEW.agent_id)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: lm_capabilities.agent_id references lm_agents(id)');
END;

-- Trigger: lm_capability_history.agent_id REFERENCES lm_agents(id)
CREATE TRIGGER IF NOT EXISTS trg_lm_cap_history_fk_agent
  BEFORE INSERT ON lm_capability_history
  FOR EACH ROW
  WHEN NOT EXISTS (SELECT 1 FROM lm_agents WHERE id = NEW.agent_id)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: lm_capability_history.agent_id references lm_agents(id)');
END;

-- Trigger: lm_agent_consents.agent_id REFERENCES lm_agents(id)
CREATE TRIGGER IF NOT EXISTS trg_lm_consents_fk_agent
  BEFORE INSERT ON lm_agent_consents
  FOR EACH ROW
  WHEN NOT EXISTS (SELECT 1 FROM lm_agents WHERE id = NEW.agent_id)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: lm_agent_consents.agent_id references lm_agents(id)');
END;
`;

export function getLifecycleRemediationMigrations(): MigrationEntry[] {
  return [
    {
      version: 49,
      name: 'lifecycle_remediation',
      sql: MIGRATION_049_SQL,
      checksum: createHash('sha256').update(MIGRATION_049_SQL).digest('hex'),
    },
  ];
}
