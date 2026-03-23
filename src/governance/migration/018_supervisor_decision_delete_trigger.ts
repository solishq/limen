/**
 * Migration v27: Add missing DELETE trigger for gov_supervisor_decisions.
 * Truth Model: Deliverable 5 — BC-060 immutability.
 *
 * Phase: 0A (Foundation)
 * Finding: BRK-003 — gov_supervisor_decisions had BEFORE UPDATE trigger
 *   but was missing BEFORE DELETE trigger. Every other immutable governance
 *   table (obs_trace_events, gov_mission_contracts, gov_eval_cases,
 *   gov_capability_manifests) has both triggers. This migration restores
 *   structural parity.
 *
 * Defect-Class: DC-108 reclassified from "impossible by construction" back
 *   to "impossible by construction" once this trigger is applied.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

const MIGRATION_027_SQL = `
-- Migration 027: Add DELETE trigger for gov_supervisor_decisions (BRK-003)
-- BC-060: Supervisor decisions are immutable. Both UPDATE and DELETE must be blocked.

CREATE TRIGGER IF NOT EXISTS gov_supervisor_decisions_no_delete
  BEFORE DELETE ON gov_supervisor_decisions
  BEGIN
    SELECT RAISE(ABORT, 'BC-060: Supervisor decisions are immutable. DELETE is prohibited.');
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

export function getSupervisorDecisionDeleteTriggerMigrations(): MigrationEntry[] {
  return [buildEntry(27, 'supervisor_decision_delete_trigger', MIGRATION_027_SQL)];
}
