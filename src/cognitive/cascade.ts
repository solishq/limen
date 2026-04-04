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

import type { TenantScopedConnection } from '../kernel/tenant/tenant_scope.js';

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
 * S-005 FIX: When a parent IS retracted, also check its grandparents.
 * A retracted parent at depth 1 contributes 0.5 penalty, but its retracted
 * grandparent at depth 2 should also contribute 0.25. The worst (minimum)
 * of all penalties found is returned.
 *
 * Performance: Most claims have zero `derived_from` relationships.
 * First query returns empty → penalty 1.0, zero additional work.
 * Bounded at depth 2 with short-circuit on minimum penalty (0.25).
 *
 * CONSTITUTIONAL: Multipliers are 0.5/0.25, non-configurable.
 * I-P4-04: Never stored — computed at query-time.
 * I-P4-05: Composed multiplicatively with decay.
 *
 * @param conn - Tenant-scoped connection. Simple queries only — no JOINs.
 *               Auto-injects tenant_id clause via TenantScopedConnection.
 * @param claimId - The claim to compute penalty for.
 * @returns Penalty multiplier in range [0.25, 1.0].
 */
export function computeCascadePenalty(
  conn: TenantScopedConnection,
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

      // Short-circuit: if worst is already 0.25, no further traversal needed.
      if (worstPenalty <= CASCADE_SECOND_DEGREE_MULTIPLIER) return worstPenalty;
    }

    // S-005 FIX: ALWAYS check grandparents regardless of parent status.
    // When parent IS retracted, its grandparents may also be retracted,
    // contributing 0.25 penalty (depth 2). Previously, retracted parents
    // skipped grandparent traversal, missing this cascade path.
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

  return worstPenalty;
}
