/**
 * Latency budget enforcement harness.
 * S ref: I-14 (Predictable Latency), §4 (Performance Invariants)
 *
 * Phase: Sprint 5 (Performance & Events)
 * Implements: Per-phase latency budget verification for the 9-phase chat pipeline.
 *
 * I-14: "Memory retrieval: < 50ms for up to 100K memories. Perception: < 5ms.
 *        Mutation-audit: < 1ms (same SQLite transaction). Hot-path total
 *        (excl. LLM): <= 103ms."
 *
 * This module is a VERIFICATION function, not middleware. It takes phase timings
 * from ResponseMetadata.phases (produced by the pipeline) and returns a report
 * indicating whether budgets were met or violated.
 *
 * Design decisions:
 *   - Pure function: no side effects, no database access, no state mutation.
 *   - Does NOT throw on violation: returns violations in report (degraded mode).
 *   - WARNING when phase exceeds budget by < 2x; CRITICAL when >= 2x.
 *   - 'generation' phase excluded from hot-path total (LLM latency is external).
 *
 * Invariants enforced: I-14
 * Failure modes defended: FM-11 (observability overhead < 2%)
 */

import type { PipelinePhase } from '../interfaces/api.js';

// ============================================================================
// Types
// ============================================================================

/**
 * I-14: Per-phase latency budgets in milliseconds.
 * Defaults derived from spec:
 *   - perception: 5ms
 *   - retrieval: 50ms (100K memories)
 *   - contextAssembly: 15ms
 *   - preSafety: 5ms
 *   - postSafety: 5ms
 *   - learning: 10ms
 *   - evaluation: 5ms
 *   - audit: 1ms (mutation-audit, same SQLite transaction)
 *   - hotPathTotal: 103ms (sum excl. generation)
 */
export interface LatencyBudget {
  readonly perception: number;
  readonly retrieval: number;
  readonly contextAssembly: number;
  readonly preSafety: number;
  readonly postSafety: number;
  readonly learning: number;
  readonly evaluation: number;
  readonly audit: number;
  readonly hotPathTotal: number;
}

/**
 * A single latency budget violation detected during evaluation.
 */
export interface LatencyViolation {
  readonly phase: PipelinePhase;
  readonly budgetMs: number;
  readonly actualMs: number;
  readonly severity: 'warning' | 'critical';
}

/**
 * Latency evaluation report produced by evaluateLatency().
 */
export interface LatencyReport {
  readonly violations: readonly LatencyViolation[];
  readonly hotPathMs: number;
  readonly hotPathBudgetMs: number;
  readonly withinBudget: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * I-14: Default latency budgets derived from the spec.
 * All values in milliseconds.
 */
export const DEFAULT_LATENCY_BUDGET: LatencyBudget = Object.freeze({
  perception: 5,
  retrieval: 50,
  contextAssembly: 15,
  preSafety: 5,
  postSafety: 5,
  learning: 10,
  evaluation: 5,
  audit: 1,
  hotPathTotal: 103,
});

// ============================================================================
// Phase-to-Budget Mapping
// ============================================================================

/**
 * Maps PipelinePhase names to LatencyBudget keys.
 * 'generation' has no budget entry because it is excluded from hot-path totals.
 */
const PHASE_BUDGET_MAP: ReadonlyMap<PipelinePhase, keyof Omit<LatencyBudget, 'hotPathTotal'>> = new Map([
  ['perception', 'perception'],
  ['retrieval', 'retrieval'],
  ['context_assembly', 'contextAssembly'],
  ['pre_safety', 'preSafety'],
  ['post_safety', 'postSafety'],
  ['learning', 'learning'],
  ['evaluation', 'evaluation'],
  ['audit', 'audit'],
]);

// ============================================================================
// Evaluation Function
// ============================================================================

/**
 * I-14: Evaluate phase timings against latency budgets.
 *
 * Pure function. Takes phase timings from ResponseMetadata.phases and returns
 * a LatencyReport with any violations found.
 *
 * Severity classification:
 *   - WARNING: phase exceeds budget but by less than 2x
 *   - CRITICAL: phase exceeds budget by 2x or more
 *
 * The 'generation' phase is excluded from hot-path total calculation because
 * LLM inference latency is external and unbounded by design.
 *
 * @param phases - Array of { phase, durationMs } from ResponseMetadata
 * @param budget - Optional partial budget overrides (merged with defaults)
 * @returns LatencyReport with violations, hot-path total, and overall verdict
 */
export function evaluateLatency(
  phases: ReadonlyArray<{ readonly phase: PipelinePhase; readonly durationMs: number }>,
  budget?: Partial<LatencyBudget>,
): LatencyReport {
  // Merge custom budget overrides with defaults
  const effectiveBudget: LatencyBudget = {
    ...DEFAULT_LATENCY_BUDGET,
    ...budget,
  };

  const violations: LatencyViolation[] = [];
  let hotPathMs = 0;

  for (const entry of phases) {
    // Exclude 'generation' from hot-path total
    if (entry.phase !== 'generation') {
      hotPathMs += entry.durationMs;
    }

    // Check per-phase budget
    const budgetKey = PHASE_BUDGET_MAP.get(entry.phase);
    if (budgetKey !== undefined) {
      const phaseBudget = effectiveBudget[budgetKey];
      if (entry.durationMs > phaseBudget) {
        // Severity: CRITICAL if >= 2x budget, WARNING if < 2x
        const severity: 'warning' | 'critical' = entry.durationMs >= phaseBudget * 2
          ? 'critical'
          : 'warning';

        violations.push({
          phase: entry.phase,
          budgetMs: phaseBudget,
          actualMs: entry.durationMs,
          severity,
        });
      }
    }
  }

  // Check hot-path total budget
  const withinHotPath = hotPathMs <= effectiveBudget.hotPathTotal;

  return {
    violations,
    hotPathMs,
    hotPathBudgetMs: effectiveBudget.hotPathTotal,
    withinBudget: violations.length === 0 && withinHotPath,
  };
}
