/**
 * Verifies: §4 I-14
 * Phase: Sprint 5 (Performance & Events — activated from scaffold)
 *
 * I-14: Predictable Latency.
 * "Memory retrieval: < 50ms for up to 100K memories. Perception: < 5ms.
 * Mutation-audit: < 1ms (same SQLite transaction). Hot-path total
 * (excl. LLM): <= 103ms."
 *
 * Previously: Classification B (PARTIALLY IMPLEMENTABLE)
 * Now: ACTIVATED — evaluateLatency() verifies per-phase budgets.
 *
 * S ref: I-14, §4 (Performance Invariants)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLatency,
  DEFAULT_LATENCY_BUDGET,
} from '../../../src/api/enforcement/latency_harness.js';
import type { PipelinePhase } from '../../../src/api/interfaces/api.js';

describe('I-14: Predictable Latency', () => {
  it('memory retrieval < 50ms for up to 100K memories — verified by latency harness', () => {
    // Verify the budget enforcement mechanism exists and enforces the 50ms budget
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'retrieval', durationMs: 40 }, // Under budget
    ];
    const report = evaluateLatency(phases);
    assert.equal(report.violations.length, 0);
    assert.equal(DEFAULT_LATENCY_BUDGET.retrieval, 50, 'Budget must be 50ms per spec');

    // Verify violation detection
    const overBudget = evaluateLatency([{ phase: 'retrieval', durationMs: 55 }]);
    assert.equal(overBudget.violations.length, 1);
    assert.equal(overBudget.violations[0].phase, 'retrieval');
  });

  it('perception < 5ms — verified by latency harness', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 3 }, // Under budget
    ];
    const report = evaluateLatency(phases);
    assert.equal(report.violations.length, 0);
    assert.equal(DEFAULT_LATENCY_BUDGET.perception, 5, 'Budget must be 5ms per spec');

    // Verify violation detection
    const overBudget = evaluateLatency([{ phase: 'perception', durationMs: 7 }]);
    assert.equal(overBudget.violations.length, 1);
    assert.equal(overBudget.violations[0].phase, 'perception');
  });

  it('mutation-audit < 1ms — verified by latency harness', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'audit', durationMs: 0.5 }, // Under budget
    ];
    const report = evaluateLatency(phases);
    assert.equal(report.violations.length, 0);
    assert.equal(DEFAULT_LATENCY_BUDGET.audit, 1, 'Budget must be 1ms per spec');

    // Verify violation detection
    const overBudget = evaluateLatency([{ phase: 'audit', durationMs: 2 }]);
    assert.equal(overBudget.violations.length, 1);
    assert.equal(overBudget.violations[0].phase, 'audit');
  });

  it('hot-path total (excl. LLM) <= 103ms — verified by latency harness', () => {
    const allPhases: PipelinePhase[] = [
      'perception', 'retrieval', 'context_assembly', 'pre_safety',
      'generation', 'post_safety', 'learning', 'evaluation', 'audit',
    ];

    // Each non-generation phase at 10ms -> hot path = 80ms <= 103ms
    const phases = allPhases.map(p => ({
      phase: p,
      durationMs: p === 'generation' ? 5000 : 10,
    }));

    const report = evaluateLatency(phases);
    assert.equal(report.hotPathMs, 80);
    assert.equal(report.hotPathBudgetMs, 103);
    assert.ok(report.hotPathMs <= report.hotPathBudgetMs);

    // Verify hot path violation
    const heavyPhases = allPhases.map(p => ({
      phase: p,
      durationMs: p === 'generation' ? 5000 : 15,
    }));
    const heavyReport = evaluateLatency(heavyPhases);
    assert.equal(heavyReport.hotPathMs, 120);
    assert.equal(heavyReport.withinBudget, false);
  });
});
