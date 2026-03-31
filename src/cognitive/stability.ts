/**
 * Phase 3 Cognitive Metabolism: Stability Resolution.
 *
 * Pure functions for resolving a claim's predicate to its stability value.
 * Configurable via StabilityConfig. No state, no imports from codebase.
 *
 * Spec ref: LIMEN_BUILD_PHASES.md (3.2)
 * Design Source: docs/sprints/PHASE-3-DESIGN-SOURCE.md (Decision 3)
 *
 * Invariant: I-P3-03 (stability assignment accuracy)
 */

/** Phase 3 section 3.2: Stability configuration. */
export interface StabilityConfig {
  /** Custom predicate patterns (first match wins). Prepended before defaults. */
  readonly patterns?: readonly StabilityPattern[];
  /** Default stability for unmatched predicates. Default: 90 days. */
  readonly defaultStabilityDays?: number;
}

export interface StabilityPattern {
  /** Predicate pattern. Trailing wildcard supported (e.g., 'governance.*'). */
  readonly pattern: string;
  /** Stability in days (must be > 0). */
  readonly stabilityDays: number;
}

/** Default stability for unmatched predicates (finding category). */
export const DEFAULT_STABILITY_DAYS = 90;

/**
 * Built-in stability patterns from Phase 3 section 3.2 spec.
 * Order matters: first match wins.
 */
export const DEFAULT_STABILITY_PATTERNS: readonly StabilityPattern[] = [
  // Governance: 365 days
  { pattern: 'governance.*', stabilityDays: 365 },
  { pattern: 'system.*', stabilityDays: 365 },
  { pattern: 'lifecycle.*', stabilityDays: 365 },
  // Architectural: 180 days
  { pattern: 'architecture.*', stabilityDays: 180 },
  { pattern: 'decision.*', stabilityDays: 180 },
  { pattern: 'design.*', stabilityDays: 180 },
  // Preference: 120 days
  { pattern: 'preference.*', stabilityDays: 120 },
  { pattern: 'reflection.pattern', stabilityDays: 120 },
  { pattern: 'reflection.decision', stabilityDays: 120 },
  // Finding: 90 days
  { pattern: 'finding.*', stabilityDays: 90 },
  { pattern: 'observation.*', stabilityDays: 90 },
  { pattern: 'reflection.finding', stabilityDays: 90 },
  // Warning: 30 days
  { pattern: 'warning.*', stabilityDays: 30 },
  { pattern: 'reflection.warning', stabilityDays: 30 },
  // Ephemeral: 7 days
  { pattern: 'ephemeral.*', stabilityDays: 7 },
  { pattern: 'session.*', stabilityDays: 7 },
  { pattern: 'scratch.*', stabilityDays: 7 },
];

/**
 * Check if a predicate matches a stability pattern.
 * Supports trailing wildcard ('governance.*' matches 'governance.policy').
 * Exact match also supported ('reflection.pattern' matches 'reflection.pattern').
 */
function matchesPattern(predicate: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1); // 'governance.' (includes the dot)
    return predicate.startsWith(prefix);
  }
  return predicate === pattern;
}

/**
 * Resolve a predicate to its stability value.
 *
 * @param predicate - Claim predicate (e.g., 'governance.policy')
 * @param config - Stability configuration (optional, uses defaults)
 * @returns Stability in days (always > 0)
 *
 * Resolution order:
 *   1. User-provided patterns (first match wins)
 *   2. Built-in default patterns (first match wins)
 *   3. defaultStabilityDays (default: 90)
 *
 * I-P3-03: QUALITY_GATE. Stability assignment accuracy.
 */
export function resolveStability(predicate: string, config?: StabilityConfig): number {
  const defaultDays = config?.defaultStabilityDays ?? DEFAULT_STABILITY_DAYS;

  // Check user patterns first (prepended before defaults)
  if (config?.patterns) {
    for (const entry of config.patterns) {
      if (entry.stabilityDays <= 0) continue; // Skip invalid entries (DC-P3-402)
      if (matchesPattern(predicate, entry.pattern)) {
        return entry.stabilityDays;
      }
    }
  }

  // Check built-in patterns
  for (const entry of DEFAULT_STABILITY_PATTERNS) {
    if (matchesPattern(predicate, entry.pattern)) {
      return entry.stabilityDays;
    }
  }

  // Fallback to default
  return defaultDays > 0 ? defaultDays : DEFAULT_STABILITY_DAYS;
}
