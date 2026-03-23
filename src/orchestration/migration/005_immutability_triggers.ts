/**
 * Forward-only migration v14: Immutability Enforcement Triggers
 * S ref: I-19 (Artifact Immutability), I-24 (Goal Anchoring)
 *
 * Phase: 4D-2 (Certification — Enforcement Mechanisms)
 * Finding: CF-012
 *
 * Adds BEFORE UPDATE triggers to enforce:
 *   - I-19: core_artifacts content and type columns are write-once
 *   - I-24: core_mission_goals objective, success_criteria, scope_boundaries are immutable
 *
 * Pattern: Mirrors I-06 audit immutability triggers (migrations.ts:49-53)
 * and tenant_id immutability triggers (004_tenant_isolation.ts:80-162).
 *
 * Design: Column-level BEFORE UPDATE triggers with RAISE(ABORT).
 *   - core_artifacts: Protects content and type only. lifecycle_state, relevance_decay,
 *     metadata_json remain mutable for archival/lifecycle operations.
 *   - core_mission_goals: Protects all domain columns (objective, success_criteria,
 *     scope_boundaries). The entire row is immutable once inserted — agents cannot
 *     redefine what success means.
 */

import { createHash } from 'node:crypto';
import type { MigrationEntry } from '../../kernel/interfaces/index.js';

// ─── Migration v14: Immutability Triggers (I-19, I-24) ───

const MIGRATION_014_SQL = `
-- Migration 014: Immutability Enforcement Triggers
-- S ref: I-19 (artifact content immutable), I-24 (goal anchoring)
-- Finding: CF-012 (immutability enforcement without database triggers)
-- Constraint: C-05 (forward-only migration)

-- ────────────────────────────────────────────────────────────
-- I-19: Artifact Content Immutability
-- "Artifacts are write-once. Content and type cannot be modified after creation."
-- lifecycle_state is explicitly excluded — archival transitions are allowed.
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER core_artifacts_content_immutable
  BEFORE UPDATE OF content ON core_artifacts
  BEGIN
    SELECT RAISE(ABORT, 'I-19: Artifact content is immutable. UPDATE on content is prohibited.');
  END;

CREATE TRIGGER core_artifacts_type_immutable
  BEFORE UPDATE OF type ON core_artifacts
  BEGIN
    SELECT RAISE(ABORT, 'I-19: Artifact type is immutable. UPDATE on type is prohibited.');
  END;

-- ────────────────────────────────────────────────────────────
-- I-24: Goal Anchoring
-- "Mission objectives, success criteria, and scope boundaries are immutable
--  once set. The agent cannot redefine what success means."
-- All three domain columns are protected. created_at is excluded (harmless).
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER core_mission_goals_objective_immutable
  BEFORE UPDATE OF objective ON core_mission_goals
  BEGIN
    SELECT RAISE(ABORT, 'I-24: Mission objective is immutable (goal anchoring). UPDATE on objective is prohibited.');
  END;

CREATE TRIGGER core_mission_goals_criteria_immutable
  BEFORE UPDATE OF success_criteria ON core_mission_goals
  BEGIN
    SELECT RAISE(ABORT, 'I-24: Mission success_criteria is immutable (goal anchoring). UPDATE on success_criteria is prohibited.');
  END;

CREATE TRIGGER core_mission_goals_boundaries_immutable
  BEFORE UPDATE OF scope_boundaries ON core_mission_goals
  BEGIN
    SELECT RAISE(ABORT, 'I-24: Mission scope_boundaries is immutable (goal anchoring). UPDATE on scope_boundaries is prohibited.');
  END;
`;

// ─── Build Migration Entry ───

function buildEntry(version: number, name: string, sql: string): MigrationEntry {
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}

/**
 * Get Phase 4D-2 (Immutability Enforcement) migration.
 * Version 14 continues from Phase 4B's version 13.
 * I-19: artifact content/type write-once.
 * I-24: mission goal anchoring (objective, success_criteria, scope_boundaries).
 */
export function getPhase4D2ImmutabilityMigrations(): MigrationEntry[] {
  return [
    buildEntry(14, 'immutability_triggers', MIGRATION_014_SQL),
  ];
}
