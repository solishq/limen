/**
 * Phase 4 Quality & Safety: Structural Conflict Detection.
 *
 * Pure function that detects existing active claims with the same
 * subject + predicate but different object value. Returns the IDs
 * of conflicting claims so the caller can create `contradicts` relationships.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (4.1), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md A.2 Rule 2
 * Design Source: docs/sprints/PHASE-4-DESIGN-SOURCE.md (Decision 1, Decision 2, Decision 3)
 *
 * Invariants: I-P4-06 (synchronous), I-P4-07 (structural match), I-P4-08 (threshold 0.8)
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';

/**
 * Phase 4 §4.2: Default auto-conflict threshold.
 * CONSTITUTIONAL: A.2 Rule 2 says >= 0.8.
 * This threshold determines when contradiction relationships are created.
 * Per Design Source Decision 3: ALL structural conflicts create relationships.
 * This constant is exposed for future phases that may use it for review severity.
 */
export const DEFAULT_AUTO_CONFLICT_THRESHOLD = 0.8;

/**
 * Result of structural conflict detection.
 */
export interface ConflictDetectionResult {
  /** IDs of existing active claims that conflict with the new claim */
  readonly conflictingClaimIds: readonly string[];
}

/**
 * Phase 4 §4.1: Detect structural conflicts for a newly created claim.
 *
 * A structural conflict exists when:
 * 1. Another claim has the same subject AND predicate
 * 2. That claim has a different object_value
 * 3. That claim is active (status = 'active')
 * 4. That claim is not the same claim (id != newClaimId)
 *
 * Performance: Uses compound partial index idx_claims_conflict_detection
 * on (subject, predicate, status) WHERE status = 'active'.
 * Budget: <2ms on tables up to 100K claims.
 *
 * I-P4-06: Called inside the assertion transaction — synchronous.
 * I-P4-07: Subject + predicate + different value + both active.
 *
 * @param conn - Database connection (tenant-scoped)
 * @param newClaimId - The newly created claim's ID (excluded from results)
 * @param subject - The subject URN of the new claim
 * @param predicate - The predicate of the new claim
 * @param objectValue - The serialized object value of the new claim
 * @returns IDs of conflicting claims (empty array if no conflicts)
 */
export function detectStructuralConflicts(
  conn: DatabaseConnection,
  newClaimId: string,
  subject: string,
  predicate: string,
  objectValue: string,
): ConflictDetectionResult {
  const conflicts = conn.query<{ id: string }>(
    `SELECT id FROM claim_assertions WHERE subject = ? AND predicate = ? AND status = 'active' AND object_value != ? AND id != ?`,
    [subject, predicate, objectValue, newClaimId],
  );

  return {
    conflictingClaimIds: conflicts.map(r => r.id),
  };
}
