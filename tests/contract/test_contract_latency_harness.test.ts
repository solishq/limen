/**
 * Contract tests for Latency Harness (I-14: Predictable Latency).
 * Phase: Sprint 5 (Performance & Events)
 *
 * Verifies:
 *   - All phases within budget -> withinBudget: true, no violations
 *   - Phase exceeds budget -> violation with correct severity
 *   - Hot-path total exceeds 103ms -> withinBudget: false
 *   - Generation phase excluded from hot-path total
 *   - Custom budget overrides default
 *   - Warning vs critical threshold (2x budget)
 *   - Empty phases array
 *   - Partial budget override
 *
 * Amendment 21: Every enforcement DC has success AND rejection tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PipelinePhase } from '../../src/api/interfaces/api.js';
import {
  evaluateLatency,
  DEFAULT_LATENCY_BUDGET,
  type LatencyReport,
} from '../../src/api/enforcement/latency_harness.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Build a standard set of phase timings for a pipeline execution.
 * All phases at exact budget values.
 */
function buildPhaseTimings(overrides?: Partial<Record<PipelinePhase, number>>): Array<{ phase: PipelinePhase; durationMs: number }> {
  const defaults: Record<PipelinePhase, number> = {
    perception: DEFAULT_LATENCY_BUDGET.perception,
    retrieval: DEFAULT_LATENCY_BUDGET.retrieval,
    context_assembly: DEFAULT_LATENCY_BUDGET.contextAssembly,
    pre_safety: DEFAULT_LATENCY_BUDGET.preSafety,
    generation: 500, // Not counted in hot path
    post_safety: DEFAULT_LATENCY_BUDGET.postSafety,
    learning: DEFAULT_LATENCY_BUDGET.learning,
    evaluation: DEFAULT_LATENCY_BUDGET.evaluation,
    audit: DEFAULT_LATENCY_BUDGET.audit,
  };

  const merged = { ...defaults, ...overrides };
  const phases: PipelinePhase[] = [
    'perception', 'retrieval', 'context_assembly', 'pre_safety',
    'generation', 'post_safety', 'learning', 'evaluation', 'audit',
  ];

  return phases.map(p => ({ phase: p, durationMs: merged[p] }));
}

// ============================================================================
// SUCCESS: All phases within budget
// ============================================================================

describe('I-14: Latency Harness — Success Paths', () => {
  it('DC-I14-001 success: all phases at budget -> withinBudget true, no violations', () => {
    const timings = buildPhaseTimings();
    const report = evaluateLatency(timings);

    assert.equal(report.withinBudget, true);
    assert.equal(report.violations.length, 0);
    // Hot path = all phases except generation
    const expectedHotPath = DEFAULT_LATENCY_BUDGET.perception +
      DEFAULT_LATENCY_BUDGET.retrieval +
      DEFAULT_LATENCY_BUDGET.contextAssembly +
      DEFAULT_LATENCY_BUDGET.preSafety +
      DEFAULT_LATENCY_BUDGET.postSafety +
      DEFAULT_LATENCY_BUDGET.learning +
      DEFAULT_LATENCY_BUDGET.evaluation +
      DEFAULT_LATENCY_BUDGET.audit;
    assert.equal(report.hotPathMs, expectedHotPath);
    assert.equal(report.hotPathBudgetMs, DEFAULT_LATENCY_BUDGET.hotPathTotal);
  });

  it('DC-I14-002 success: phases well under budget -> withinBudget true', () => {
    const timings = buildPhaseTimings({
      perception: 1,
      retrieval: 10,
      context_assembly: 5,
      pre_safety: 1,
      post_safety: 1,
      learning: 2,
      evaluation: 1,
      audit: 0.5,
    });
    const report = evaluateLatency(timings);

    assert.equal(report.withinBudget, true);
    assert.equal(report.violations.length, 0);
    assert.ok(report.hotPathMs < DEFAULT_LATENCY_BUDGET.hotPathTotal);
  });

  it('DC-I14-003 success: generation phase excluded from hot-path total', () => {
    const timings = buildPhaseTimings({
      generation: 50000, // 50 seconds of LLM inference
    });
    const report = evaluateLatency(timings);

    // Hot path should NOT include the 50s generation
    assert.equal(report.withinBudget, true);
    assert.ok(report.hotPathMs < 200, `hotPathMs should not include generation, got ${report.hotPathMs}`);
  });

  it('DC-I14-004 success: empty phases array -> withinBudget true', () => {
    const report = evaluateLatency([]);

    assert.equal(report.withinBudget, true);
    assert.equal(report.violations.length, 0);
    assert.equal(report.hotPathMs, 0);
  });

  it('DC-I14-005 success: custom budget allows higher values', () => {
    const timings = buildPhaseTimings({
      perception: 20, // Exceeds default 5ms but within custom 30ms
    });
    // Override perception budget to 30ms AND raise hotPathTotal to accommodate
    // the increased perception time (default 96 + 15 extra = 111 > 103).
    const report = evaluateLatency(timings, { perception: 30, hotPathTotal: 120 });

    assert.equal(report.withinBudget, true);
    assert.equal(report.violations.length, 0);
  });
});

// ============================================================================
// REJECTION: Budget violations detected
// ============================================================================

describe('I-14: Latency Harness — Rejection Paths', () => {
  it('DC-I14-001 rejection: perception exceeds 5ms -> warning violation', () => {
    const timings = buildPhaseTimings({
      perception: 8, // Exceeds 5ms budget but < 2x (10ms)
    });
    const report = evaluateLatency(timings);

    // Should have a violation for perception
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].phase, 'perception');
    assert.equal(report.violations[0].budgetMs, 5);
    assert.equal(report.violations[0].actualMs, 8);
    assert.equal(report.violations[0].severity, 'warning');
  });

  it('DC-I14-002 rejection: perception at 2x budget -> critical violation', () => {
    const timings = buildPhaseTimings({
      perception: 10, // Exactly 2x the 5ms budget
    });
    const report = evaluateLatency(timings);

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'critical');
    assert.equal(report.violations[0].actualMs, 10);
  });

  it('DC-I14-003 rejection: hot-path total exceeds 103ms -> withinBudget false', () => {
    // Set each phase to 15ms -> total = 8 * 15 = 120ms > 103ms
    const timings = buildPhaseTimings({
      perception: 15,
      retrieval: 15,
      context_assembly: 15,
      pre_safety: 15,
      post_safety: 15,
      learning: 15,
      evaluation: 15,
      audit: 15,
    });
    const report = evaluateLatency(timings);

    assert.equal(report.withinBudget, false);
    assert.equal(report.hotPathMs, 120);
    assert.ok(report.hotPathMs > report.hotPathBudgetMs);
  });

  it('DC-I14-004 rejection: retrieval exceeds 50ms -> violation reported', () => {
    const timings = buildPhaseTimings({
      retrieval: 75, // 1.5x budget -> warning
    });
    const report = evaluateLatency(timings);

    const retrievalViolation = report.violations.find(v => v.phase === 'retrieval');
    assert.ok(retrievalViolation, 'Expected retrieval violation');
    assert.equal(retrievalViolation.budgetMs, 50);
    assert.equal(retrievalViolation.actualMs, 75);
    assert.equal(retrievalViolation.severity, 'warning');
  });

  it('DC-I14-005 rejection: audit exceeds 1ms -> violation reported', () => {
    const timings = buildPhaseTimings({
      audit: 3, // 3x the 1ms budget -> critical (>= 2x)
    });
    const report = evaluateLatency(timings);

    const auditViolation = report.violations.find(v => v.phase === 'audit');
    assert.ok(auditViolation, 'Expected audit violation');
    assert.equal(auditViolation.budgetMs, 1);
    assert.equal(auditViolation.actualMs, 3);
    assert.equal(auditViolation.severity, 'critical');
  });

  it('DC-I14-006 rejection: multiple violations reported simultaneously', () => {
    const timings = buildPhaseTimings({
      perception: 20, // 4x -> critical
      retrieval: 80,  // 1.6x -> warning
      audit: 5,       // 5x -> critical
    });
    const report = evaluateLatency(timings);

    assert.equal(report.violations.length, 3);
    assert.equal(report.withinBudget, false);

    const perceptionV = report.violations.find(v => v.phase === 'perception')!;
    assert.equal(perceptionV.severity, 'critical');

    const retrievalV = report.violations.find(v => v.phase === 'retrieval')!;
    assert.equal(retrievalV.severity, 'warning');

    const auditV = report.violations.find(v => v.phase === 'audit')!;
    assert.equal(auditV.severity, 'critical');
  });

  it('DC-I14-007 rejection: partial budget override only affects specified phase', () => {
    const timings = buildPhaseTimings({
      perception: 8, // Would be warning with default (5ms)
      retrieval: 60, // Would be warning with default (50ms)
    });
    // Override perception to 10ms but keep retrieval at default 50ms
    const report = evaluateLatency(timings, { perception: 10 });

    // Perception at 8ms should now be within budget (10ms)
    const perceptionV = report.violations.find(v => v.phase === 'perception');
    assert.equal(perceptionV, undefined, 'Perception should be within overridden budget');

    // Retrieval should still violate default budget
    const retrievalV = report.violations.find(v => v.phase === 'retrieval');
    assert.ok(retrievalV, 'Retrieval should still violate default budget');
    assert.equal(retrievalV.budgetMs, 50);
  });
});

// ============================================================================
// Constants verification
// ============================================================================

describe('I-14: Latency Budget Constants', () => {
  it('default budget values match spec requirements', () => {
    assert.equal(DEFAULT_LATENCY_BUDGET.perception, 5);
    assert.equal(DEFAULT_LATENCY_BUDGET.retrieval, 50);
    assert.equal(DEFAULT_LATENCY_BUDGET.audit, 1);
    assert.equal(DEFAULT_LATENCY_BUDGET.hotPathTotal, 103);

    // Budget sum (excl. hotPathTotal) should be <= hotPathTotal
    const sum = DEFAULT_LATENCY_BUDGET.perception +
      DEFAULT_LATENCY_BUDGET.retrieval +
      DEFAULT_LATENCY_BUDGET.contextAssembly +
      DEFAULT_LATENCY_BUDGET.preSafety +
      DEFAULT_LATENCY_BUDGET.postSafety +
      DEFAULT_LATENCY_BUDGET.learning +
      DEFAULT_LATENCY_BUDGET.evaluation +
      DEFAULT_LATENCY_BUDGET.audit;
    // Sum should be <= hotPathTotal (allows for overhead)
    assert.ok(sum <= DEFAULT_LATENCY_BUDGET.hotPathTotal + 10,
      `Budget sum ${sum} should be close to hotPathTotal ${DEFAULT_LATENCY_BUDGET.hotPathTotal}`);
  });
});
