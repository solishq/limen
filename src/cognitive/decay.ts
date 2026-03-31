/**
 * Phase 3 Cognitive Metabolism: Decay Computation.
 *
 * Pure functions for FSRS power-decay. No state, no imports from codebase.
 * TimeProvider injected via `nowMs` parameter -- functions remain pure.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (3.1, 3.3), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md A.3
 * Design Source: docs/sprints/PHASE-3-DESIGN-SOURCE.md (Decision 1, Decision 9)
 *
 * Invariants: I-P3-01 (decay formula), I-P3-02 (effective_confidence), I-P3-04 (no stored decay)
 */

/** Milliseconds per day constant */
const MS_PER_DAY = 86_400_000;

/**
 * Phase 3 section 3.1: FSRS power-decay factor.
 * R(t) = (1 + t/(9*S))^(-1)
 *
 * @param ageMs - Age of the claim in milliseconds (will be clamped to >= 0)
 * @param stabilityDays - Stability in days (must be > 0)
 * @returns Decay factor in range (0.0, 1.0]
 *
 * Guards:
 *   - stabilityDays <= 0: returns 0 (DC-P3-103)
 *   - ageMs < 0: treated as 0 (DC-P3-102)
 *   - ageMs = 0: returns 1.0 (no decay)
 *
 * I-P3-01: CONSTITUTIONAL. Decay formula correctness.
 */
export function computeDecayFactor(ageMs: number, stabilityDays: number): number {
  // DC-P3-103: Guard against zero/negative stability
  if (stabilityDays <= 0) return 0;

  // DC-P3-102: Clamp negative age (future validAt)
  const clampedAgeMs = Math.max(0, ageMs);

  const ageDays = clampedAgeMs / MS_PER_DAY;
  return Math.pow(1 + ageDays / (9 * stabilityDays), -1);
}

/**
 * Phase 3 section 3.3: Effective confidence after decay.
 *
 * @param confidence - Raw stored confidence [0.0, 1.0]
 * @param ageMs - Age of the claim in milliseconds
 * @param stabilityDays - Stability in days
 * @returns confidence * decayFactor, in range [0.0, confidence]
 *
 * I-P3-02: CONSTITUTIONAL. effective_confidence = confidence * R(age, stability).
 */
export function computeEffectiveConfidence(
  confidence: number,
  ageMs: number,
  stabilityDays: number,
): number {
  return confidence * computeDecayFactor(ageMs, stabilityDays);
}

/**
 * Compute age in milliseconds from validAt timestamp and current time.
 * Clamps to >= 0 to handle future-dated claims (Edge Case 3).
 *
 * @param validAt - ISO 8601 timestamp string
 * @param nowMs - Current time in milliseconds since epoch (from TimeProvider)
 * @returns Age in milliseconds (>= 0)
 */
export function computeAgeMs(validAt: string, nowMs: number): number {
  return Math.max(0, nowMs - Date.parse(validAt));
}
