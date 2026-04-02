/**
 * Phase 9: Knowledge Poisoning Defense.
 *
 * Spec ref: PHASE-9-DESIGN-SOURCE.md (Output 1, Poisoning Defense)
 * Invariants: I-P9-30 (burst limit), I-P9-31 (diversity), I-P9-32 (composability), I-P9-33 (disabled no-op)
 * DCs: DC-P9-403, DC-P9-404, DC-P9-302, DC-P9-902
 *
 * Query-based check against claim_assertions:
 *   1. Count claims by agent in sliding window
 *   2. Count unique subjects by agent in sliding window
 *   3. Block if burst limit exceeded or diversity too low
 *
 * Stateless computation — queries the existing claim_assertions table.
 */

import type { DatabaseConnection } from '../kernel/interfaces/index.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { AgentClaimStats, PoisoningVerdict, SecurityPolicy } from './security_types.js';

/**
 * Check if an agent's claim assertion should be allowed by poisoning defense.
 *
 * I-P9-30: If count >= burstLimit, return POISONING_BURST_LIMIT.
 * I-P9-31: If uniqueSubjects < diversityMin and current subject is not new, return POISONING_LOW_DIVERSITY.
 * I-P9-33: If poisoning.enabled = false, always allow.
 *
 * @param conn - Database connection (read-only query)
 * @param agentId - The agent asserting the claim
 * @param tenantId - Tenant context
 * @param currentSubject - The subject of the claim being asserted
 * @param policy - Security policy with poisoning configuration
 * @param time - TimeProvider for window calculation (Hard Stop #7)
 * @returns PoisoningVerdict indicating whether the claim is allowed
 */
export function checkPoisoning(
  conn: DatabaseConnection,
  agentId: string,
  tenantId: string | null,
  currentSubject: string,
  policy: SecurityPolicy,
  time: TimeProvider,
): PoisoningVerdict {
  // I-P9-33: Disabled policy no-op
  if (!policy.poisoning.enabled) {
    return {
      allowed: true,
      stats: {
        agentId,
        windowStart: time.nowISO(),
        claimsInWindow: 0,
        uniqueSubjects: 0,
      },
    };
  }

  const windowSeconds = policy.poisoning.windowSeconds;
  const nowMs = time.nowMs();
  const windowStartMs = nowMs - (windowSeconds * 1000);
  const windowStartISO = new Date(windowStartMs).toISOString();

  // Query agent's claims in the sliding window.
  // DC-P9-902: Target < 5ms. Uses existing indexes on source_agent_id + created_at.
  const row = conn.get<{ claim_count: number; unique_subjects: number }>(
    `SELECT COUNT(*) as claim_count, COUNT(DISTINCT subject) as unique_subjects
     FROM claim_assertions
     WHERE source_agent_id = ?
     AND created_at > ?
     AND tenant_id IS ?`,
    [agentId, windowStartISO, tenantId],
  );

  const claimsInWindow = row?.claim_count ?? 0;
  const uniqueSubjects = row?.unique_subjects ?? 0;

  const stats: AgentClaimStats = {
    agentId,
    windowStart: windowStartISO,
    claimsInWindow,
    uniqueSubjects,
  };

  // I-P9-30: Burst limit enforcement
  if (claimsInWindow >= policy.poisoning.burstLimit) {
    return {
      allowed: false,
      reason: `Agent exceeded burst limit: ${claimsInWindow} >= ${policy.poisoning.burstLimit} claims in ${windowSeconds}s window`,
      stats,
    };
  }

  // I-P9-31: Diversity check
  // Only enforce if agent has enough claims AND current subject is not new.
  // The diversity check prevents an agent from hammering a single subject.
  if (claimsInWindow >= policy.poisoning.subjectDiversityMin) {
    // Check if current subject is already in the window
    const subjectExists = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM claim_assertions
       WHERE source_agent_id = ?
       AND subject = ?
       AND created_at > ?
       AND tenant_id IS ?`,
      [agentId, currentSubject, windowStartISO, tenantId],
    );

    const subjectAlreadyExists = (subjectExists?.cnt ?? 0) > 0;

    if (uniqueSubjects < policy.poisoning.subjectDiversityMin && subjectAlreadyExists) {
      return {
        allowed: false,
        reason: `Agent subject diversity too low: ${uniqueSubjects} < ${policy.poisoning.subjectDiversityMin} unique subjects`,
        stats,
      };
    }
  }

  return { allowed: true, stats };
}
