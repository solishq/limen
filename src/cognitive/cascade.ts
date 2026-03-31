/**
 * Phase 4 Quality & Safety: Cascade Retraction Penalty Computation.
 *
 * Pure functions for computing cascade retraction penalties via derived_from traversal.
 * No state, no side effects. TimeProvider not needed (no temporal logic).
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (4.3), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md A.2 Rule 3
 * Design Source: docs/sprints/PHASE-4-DESIGN-SOURCE.md (Decision 4)
 *
 * Invariants: I-P4-01, I-P4-02, I-P4-03, I-P4-04, I-P4-05
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';

/**
 * Phase 4 §4.3: First-degree cascade penalty multiplier.
 * CONSTITUTIONAL: Not configurable. A.2 Rule 3.
 * I-P4-01: CASCADE_FIRST_DEGREE_MULTIPLIER === 0.5
 */
export const CASCADE_FIRST_DEGREE_MULTIPLIER = 0.5;

/**
 * Phase 4 §4.3: Second-degree cascade penalty multiplier.
 * CONSTITUTIONAL: Not configurable. A.2 Rule 3.
 * I-P4-02: CASCADE_SECOND_DEGREE_MULTIPLIER === 0.25
 */
export const CASCADE_SECOND_DEGREE_MULTIPLIER = 0.25;

/**
 * Phase 4 §4.3: Maximum traversal depth for cascade computation.
 * CONSTITUTIONAL: Not configurable. A.2 Rule 3.
 * I-P4-03: CASCADE_MAX_DEPTH === 2
 */
export const CASCADE_MAX_DEPTH = 2;

/**
 * Phase 4 §4.3: Compute cascade retraction penalty for a claim.
 *
 * Traverses `derived_from` relationships up to depth 2.
 * If any ancestor (via `derived_from`) is retracted:
 *   - First-degree ancestor retracted: penalty = 0.5
 *   - Second-degree ancestor retracted: penalty = 0.25
 *
 * Returns the worst (minimum) penalty found.
 * Returns 1.0 if no retracted ancestors (no penalty).
 *
 * Performance: Most claims have zero `derived_from` relationships.
 * First query returns empty → penalty 1.0, zero additional work.
 * Bounded at depth 2 with short-circuit on minimum penalty (0.25).
 *
 * CONSTITUTIONAL: Multipliers are 0.5/0.25, non-configurable.
 * I-P4-04: Never stored — computed at query-time.
 * I-P4-05: Composed multiplicatively with decay.
 *
 * @param conn - Database connection (tenant-scoped). Simple queries only — no JOINs.
 * @param claimId - The claim to compute penalty for.
 * @returns Penalty multiplier in range [0.25, 1.0].
 */
export function computeCascadePenalty(
  conn: DatabaseConnection,
  claimId: string,
): number {
  // Level 1: Find derived_from parents (this claim DERIVES FROM parent claims)
  // Direction: from_claim_id = this claim (child), to_claim_id = parent
  const parents = conn.query<{ to_claim_id: string }>(
    `SELECT to_claim_id FROM claim_relationships WHERE from_claim_id = ? AND type = 'derived_from'`,
    [claimId],
  );

  // Fast path: no derived_from edges → no penalty
  if (parents.length === 0) return 1.0;

  let worstPenalty = 1.0;

  for (const parent of parents) {
    // Check parent retraction status
    const parentRow = conn.get<{ status: string }>(
      `SELECT status FROM claim_assertions WHERE id = ?`,
      [parent.to_claim_id],
    );

    if (parentRow?.status === 'retracted') {
      // First-degree penalty
      worstPenalty = Math.min(worstPenalty, CASCADE_FIRST_DEGREE_MULTIPLIER);

      // Short-circuit: 0.25 is the minimum possible penalty — if we already
      // found a first-degree retraction and could only get worse at second
      // degree, we know the worst case. But we can't short-circuit here because
      // 0.5 > 0.25, and we might find 0.25 at second-degree. However, if
      // worstPenalty is already 0.25, no further traversal needed.
      if (worstPenalty <= CASCADE_SECOND_DEGREE_MULTIPLIER) return worstPenalty;
    } else {
      // Parent is active — check grandparents (second-degree, depth 2)
      const grandparents = conn.query<{ to_claim_id: string }>(
        `SELECT to_claim_id FROM claim_relationships WHERE from_claim_id = ? AND type = 'derived_from'`,
        [parent.to_claim_id],
      );

      for (const gp of grandparents) {
        const gpRow = conn.get<{ status: string }>(
          `SELECT status FROM claim_assertions WHERE id = ?`,
          [gp.to_claim_id],
        );

        if (gpRow?.status === 'retracted') {
          // Second-degree penalty
          worstPenalty = Math.min(worstPenalty, CASCADE_SECOND_DEGREE_MULTIPLIER);
          // 0.25 is the minimum — short-circuit
          return worstPenalty;
        }
      }
    }
  }

  return worstPenalty;
}
