/**
 * Phase 3 Cognitive Metabolism: Freshness Classification.
 *
 * Pure functions for classifying claim freshness based on last access time.
 * No state, no imports from codebase.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (3.5)
 * Design Source: docs/sprints/PHASE-3-DESIGN-SOURCE.md (Output 2)
 *
 * Invariant: I-P3-06 (freshness classification correctness)
 */

/** Milliseconds per day constant */
const MS_PER_DAY = 86_400_000;

/** Phase 3 section 3.5: Freshness classification labels. */
export type FreshnessLabel = 'fresh' | 'aging' | 'stale';

/** Phase 3 section 3.5: Freshness classification thresholds (configurable). */
export interface FreshnessThresholds {
  /** Days since last access for 'fresh'. Default: 7. */
  readonly freshDays?: number;
  /** Days since last access for 'aging'. Default: 30. Claims beyond this are 'stale'. */
  readonly agingDays?: number;
}

/** Default freshness thresholds */
export const DEFAULT_FRESH_DAYS = 7;
export const DEFAULT_AGING_DAYS = 30;

/**
 * Classify a claim's freshness based on time since last access.
 *
 * @param lastAccessedAtMs - Timestamp of last access (ms since epoch), or null if never accessed
 * @param nowMs - Current time (ms since epoch)
 * @param thresholds - Configurable thresholds (defaults: fresh < 7d, aging < 30d, stale >= 30d)
 * @returns FreshnessLabel
 *
 * I-P3-06: CONSTITUTIONAL. Fresh/Aging/Stale classification.
 * Never-accessed claims are classified as 'stale'.
 */
export function classifyFreshness(
  lastAccessedAtMs: number | null,
  nowMs: number,
  thresholds?: FreshnessThresholds,
): FreshnessLabel {
  // Never-accessed claims are stale
  if (lastAccessedAtMs === null) return 'stale';

  const freshDays = thresholds?.freshDays ?? DEFAULT_FRESH_DAYS;
  const agingDays = thresholds?.agingDays ?? DEFAULT_AGING_DAYS;

  const daysSinceAccess = (nowMs - lastAccessedAtMs) / MS_PER_DAY;

  if (daysSinceAccess < freshDays) return 'fresh';
  if (daysSinceAccess < agingDays) return 'aging';
  return 'stale';
}
