/**
 * Trust Progression Logic — I-09 (Trust is Earned)
 * Store-level implementation: trust state machine + safety demotion.
 *
 * Phase: Sprint 2 (Trust & Learning)
 * Spec ref: I-09 "No agent starts with admin trust. Progression:
 *           untrusted → probationary → trusted → admin (human grant only).
 *           Revocable on safety violation."
 *
 * Trust State Machine:
 *   Forward: untrusted→probationary, probationary→trusted, trusted→admin
 *   Admin requires actorType='human' (application-level AND trigger enforcement)
 *   No skipping levels (untrusted→trusted is INVALID)
 *   Retired agents cannot be promoted (blocked by retired terminal trigger)
 *
 * Demotion on Safety Violation:
 *   critical/high on trusted/admin → untrusted
 *   critical/high on probationary → untrusted
 *   low/medium on trusted → probationary
 *   low/medium on probationary → untrusted
 *   low/medium on admin → trusted
 *
 * Security: Self-promotion prevention — agents cannot promote themselves.
 */

import type { AgentId } from '../../kernel/interfaces/index.js';

// ─── Trust Level Type ───

export type TrustLevel = 'untrusted' | 'probationary' | 'trusted' | 'admin';

// ─── Trust State Machine Constants ───

/**
 * Valid forward transitions in the trust hierarchy.
 * Each level can only advance to the immediately next level.
 * I-09: "Progression: untrusted → probationary → trusted → admin"
 */
const NEXT_LEVEL: Record<TrustLevel, TrustLevel | null> = {
  untrusted: 'probationary',
  probationary: 'trusted',
  trusted: 'admin',
  admin: null, // admin is the terminal forward state
};

/**
 * Determine the next trust level for a given current level.
 * Returns null if already at admin (no forward progression possible).
 */
export function getNextTrustLevel(current: TrustLevel): TrustLevel | null {
  return NEXT_LEVEL[current];
}

/**
 * Validate that a trust level transition is valid (single step forward).
 * Returns { valid: true } if the transition is allowed,
 * or { valid: false, reason: string } if not.
 *
 * Rules:
 *   1. from !== to (no self-transition)
 *   2. to must be exactly one step above from
 *   3. admin requires human actor type
 */
export function validatePromotion(
  fromLevel: TrustLevel,
  targetLevel: TrustLevel,
  actorType: 'system' | 'human',
): { valid: true } | { valid: false; reason: string } {
  // Same level is not a promotion
  if (fromLevel === targetLevel) {
    return { valid: false, reason: `Already at trust level '${fromLevel}'.` };
  }

  // Verify the target is exactly one step up
  const expected = NEXT_LEVEL[fromLevel];
  if (expected === null) {
    return { valid: false, reason: `Cannot promote beyond admin trust level.` };
  }

  if (targetLevel !== expected) {
    return {
      valid: false,
      reason: `Invalid trust progression: '${fromLevel}' → '${targetLevel}'. Must advance to '${expected}' (no skipping levels).`,
    };
  }

  // Admin requires human actor
  if (targetLevel === 'admin' && actorType !== 'human') {
    return {
      valid: false,
      reason: `Admin trust requires human actor (got '${actorType}'). I-09: "admin (human grant only)".`,
    };
  }

  return { valid: true };
}

/**
 * Validate self-promotion is not occurring.
 * Security-critical: agents cannot promote themselves.
 *
 * @param ctxAgentId - The agent ID from the operation context (caller's identity)
 * @param targetAgentId - The agent being promoted
 * @returns { allowed: true } if not self-promotion, { allowed: false } if blocked
 */
export function checkSelfPromotion(
  ctxAgentId: AgentId | null | undefined,
  targetAgentId: AgentId | string,
): { allowed: true } | { allowed: false; reason: string } {
  if (ctxAgentId && ctxAgentId === targetAgentId) {
    return {
      allowed: false,
      reason: 'SELF_PROMOTION_BLOCKED: agents cannot promote themselves.',
    };
  }
  return { allowed: true };
}

// ─── Safety Violation Demotion Logic ───

/**
 * Severity levels for safety violations.
 */
export type ViolationSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Determine the demotion target level after a safety violation.
 * Returns the new trust level if demotion is needed, or null if no demotion applies.
 *
 * Demotion matrix (I-09 spec):
 *   critical/high on any level above untrusted → untrusted
 *   low/medium on admin → trusted
 *   low/medium on trusted → probationary
 *   low/medium on probationary → untrusted
 *   any on untrusted → null (already at lowest)
 */
export function getDemotionTarget(
  currentLevel: TrustLevel,
  severity: ViolationSeverity,
): TrustLevel | null {
  // Already at lowest level — no demotion possible
  if (currentLevel === 'untrusted') {
    return null;
  }

  // Critical/high severity: drop to untrusted regardless of current level
  if (severity === 'critical' || severity === 'high') {
    return 'untrusted';
  }

  // Low/medium severity: drop one level
  const demotionMap: Record<Exclude<TrustLevel, 'untrusted'>, TrustLevel> = {
    admin: 'trusted',
    trusted: 'probationary',
    probationary: 'untrusted',
  };

  return demotionMap[currentLevel];
}
