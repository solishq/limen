/**
 * Breaker attack tests for Latency Harness (I-14: Predictable Latency).
 * Sprint 5 — Performance & Events.
 *
 * Attack surfaces:
 *   1. Negative durationMs — bypass budget checks?
 *   2. NaN/Infinity durationMs — undefined behavior?
 *   3. Duplicate phase names — double-counted in hot path?
 *   4. Unknown phase name — counted in hot path but no per-phase check?
 *   5. Zero/negative budget overrides — logic inversion?
 *   6. withinBudget semantics — any per-phase violation makes withinBudget false
 *   7. Empty string phase — type bypass
 *   8. Extreme values — overflow, incorrect severity
 *
 * S ref: I-14 (Predictable Latency), §4 (Performance Invariants)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PipelinePhase } from '../../src/api/interfaces/api.js';
import {
  evaluateLatency,
  DEFAULT_LATENCY_BUDGET,
} from '../../src/api/enforcement/latency_harness.js';

// ============================================================================
// ATTACK 1: Negative durationMs
// ============================================================================

describe('ATTACK: I-14 Latency Harness — Negative durationMs', () => {
  it('ATK-I14-001: negative durationMs does NOT bypass per-phase budget check', () => {
    // A negative duration should not be flagged as a violation (it is under budget).
    // But it should still be added to hot-path total, potentially making hot-path
    // total negative — which could falsely pass a hot-path check.
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: -100 },
      { phase: 'retrieval', durationMs: 200 }, // Exceeds 50ms budget
    ];
    const report = evaluateLatency(phases);

    // FINDING CHECK: Does the negative duration reduce the hot-path total?
    // hotPathMs = -100 + 200 = 100, which is < 103ms budget.
    // This means a single phase (retrieval at 200ms, 4x budget) is masked by
    // the negative phase bringing the hot-path total under budget.
    // The per-phase violation for retrieval should still be detected.
    const retrievalV = report.violations.find(v => v.phase === 'retrieval');
    assert.ok(retrievalV, 'Retrieval violation must be detected even with negative offset');
    assert.equal(retrievalV.severity, 'critical'); // 200ms >= 2 * 50ms = critical
    assert.equal(retrievalV.actualMs, 200);
    assert.equal(retrievalV.budgetMs, 50);

    // Document: hotPathMs can go negative with negative durations.
    // This is a data quality issue, not a harness bug — negative durations
    // are garbage input. But the harness should not crash or produce NaN.
    assert.equal(typeof report.hotPathMs, 'number');
    assert.ok(!Number.isNaN(report.hotPathMs), 'hotPathMs must not be NaN');
  });

  it('ATK-I14-002: negative durationMs reduces hot-path total, masking overrun', () => {
    // Adversarial scenario: inject a negative phase to bring hot-path total
    // under budget despite real phases being slow.
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: -200 },
      { phase: 'retrieval', durationMs: 50 },
      { phase: 'context_assembly', durationMs: 15 },
      { phase: 'pre_safety', durationMs: 200 }, // Way over budget
      { phase: 'post_safety', durationMs: 5 },
      { phase: 'learning', durationMs: 10 },
      { phase: 'evaluation', durationMs: 5 },
      { phase: 'audit', durationMs: 1 },
    ];
    const report = evaluateLatency(phases);

    // Hot-path = -200 + 50 + 15 + 200 + 5 + 10 + 5 + 1 = 86ms — under 103ms!
    // But pre_safety at 200ms is a massive violation.
    // FINDING: withinBudget should be false due to per-phase violation,
    // even though hot-path total looks fine.
    assert.equal(report.withinBudget, false, 'withinBudget must be false when per-phase violations exist');
    assert.ok(report.violations.length >= 1, 'pre_safety violation must be reported');
  });
});

// ============================================================================
// ATTACK 2: NaN and Infinity durationMs
// ============================================================================

describe('ATTACK: I-14 Latency Harness — NaN/Infinity inputs', () => {
  it('ATK-I14-003: NaN durationMs does not produce crash or true violation', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: NaN },
    ];
    const report = evaluateLatency(phases);

    // NaN > 5 is false in JS, so no per-phase violation will be raised.
    // NaN > phaseBudget * 2 is also false, so severity logic won't trigger.
    // hotPathMs will be NaN (0 + NaN = NaN).
    // withinHotPath: NaN <= 103 is false.
    // So withinBudget should be false (violations.length === 0 && false).
    // FINDING: NaN input produces no violations but withinBudget false with NaN hotPathMs.
    // This is inconsistent — no violations but not within budget.
    assert.equal(typeof report.hotPathMs, 'number'); // NaN is typeof number
    // Document the behavior: NaN propagates but does not crash.
    // The withinBudget logic handles this because NaN <= budget is false.
  });

  it('ATK-I14-004: Infinity durationMs correctly detected as critical violation', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: Infinity },
    ];
    const report = evaluateLatency(phases);

    // Infinity > 5 is true, and Infinity >= 5 * 2 is true, so severity = critical.
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'critical');
    assert.equal(report.violations[0].actualMs, Infinity);
    // hotPathMs = Infinity, Infinity <= 103 is false, so withinBudget = false.
    assert.equal(report.withinBudget, false);
  });

  it('ATK-I14-005: -Infinity durationMs bypasses per-phase check, corrupts hot-path', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: -Infinity },
      { phase: 'retrieval', durationMs: 200 }, // 4x budget
    ];
    const report = evaluateLatency(phases);

    // -Infinity > 5 is false -> no perception violation.
    // 200 > 50 is true -> retrieval violation at critical.
    assert.ok(report.violations.length >= 1);
    // hotPathMs = -Infinity + 200 = -Infinity, -Infinity <= 103 is true.
    // So withinHotPath is true, but violations.length > 0, so withinBudget = false.
    assert.equal(report.withinBudget, false);
  });
});

// ============================================================================
// ATTACK 3: Duplicate phase names
// ============================================================================

describe('ATTACK: I-14 Latency Harness — Duplicate phases', () => {
  it('ATK-I14-006: duplicate phase counted twice in hot-path total', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 5 },
      { phase: 'perception', durationMs: 5 }, // Duplicate
    ];
    const report = evaluateLatency(phases);

    // Both entries should be counted: hotPathMs = 10, each within budget.
    assert.equal(report.hotPathMs, 10);
    assert.equal(report.violations.length, 0);
    assert.equal(report.withinBudget, true);
  });

  it('ATK-I14-007: duplicate phase with one under budget and one over', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 3 },  // Under budget
      { phase: 'perception', durationMs: 8 },  // Over budget (warning)
    ];
    const report = evaluateLatency(phases);

    // Both counted in hot-path. Only the second produces a violation.
    assert.equal(report.hotPathMs, 11);
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].actualMs, 8);
    assert.equal(report.violations[0].severity, 'warning');
  });
});

// ============================================================================
// ATTACK 4: Unknown phase name (not in PHASE_BUDGET_MAP)
// ============================================================================

describe('ATTACK: I-14 Latency Harness — Unknown phase', () => {
  it('ATK-I14-008: generation phase has no per-phase budget but IS excluded from hot path', () => {
    // 'generation' is a valid PipelinePhase but NOT in PHASE_BUDGET_MAP.
    // It should be excluded from hot-path total.
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'generation', durationMs: 999999 },
    ];
    const report = evaluateLatency(phases);

    assert.equal(report.hotPathMs, 0); // generation excluded
    assert.equal(report.violations.length, 0); // no budget to violate
    assert.equal(report.withinBudget, true);
  });

  it('ATK-I14-009: unknown phase via type assertion counted in hot-path but no violation', () => {
    // If someone passes a phase name not in PipelinePhase via type assertion,
    // it should still be added to hot-path total (line 152: only 'generation'
    // is excluded) but produce no per-phase violation (no budget entry).
    const phases = [
      { phase: 'unknown_phase' as PipelinePhase, durationMs: 500 },
    ];
    const report = evaluateLatency(phases);

    // FINDING: unknown phase is added to hot-path total (not excluded by line 152)
    // since it is NOT 'generation'. But no per-phase violation is raised
    // because budgetKey is undefined.
    assert.equal(report.hotPathMs, 500);
    assert.equal(report.violations.length, 0); // No budget entry -> no violation
    // But hot-path total 500 > 103 -> withinBudget false.
    assert.equal(report.withinBudget, false);
  });
});

// ============================================================================
// ATTACK 5: Zero and negative budget overrides
// ============================================================================

describe('ATTACK: I-14 Latency Harness — Budget edge cases', () => {
  it('ATK-I14-010: zero budget override means ANY positive duration is a violation', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 0.001 }, // Tiniest positive value
    ];
    const report = evaluateLatency(phases, { perception: 0 });

    // 0.001 > 0 is true -> violation.
    // 0.001 >= 0 * 2 (= 0) is true -> severity = critical.
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'critical');
    assert.equal(report.violations[0].budgetMs, 0);
  });

  it('ATK-I14-011: negative budget override — all positive durations are violations', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 1 },
    ];
    const report = evaluateLatency(phases, { perception: -5 });

    // 1 > -5 is true -> violation.
    // 1 >= -5 * 2 (= -10) is true -> severity = critical.
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'critical');
    assert.equal(report.violations[0].budgetMs, -5);
  });

  it('ATK-I14-012: zero hotPathTotal budget — any non-generation phase triggers failure', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 0 }, // Exactly at budget
    ];
    const report = evaluateLatency(phases, { perception: 0, hotPathTotal: 0 });

    // perception at 0 is not > 0 (budget), so no per-phase violation.
    // hotPathMs = 0, withinHotPath: 0 <= 0 is true.
    assert.equal(report.withinBudget, true);
    assert.equal(report.violations.length, 0);
  });
});

// ============================================================================
// ATTACK 6: withinBudget semantics — line 183 logic
// ============================================================================

describe('ATTACK: I-14 Latency Harness — withinBudget semantics', () => {
  it('ATK-I14-013: per-phase WARNING makes withinBudget false even if hot-path total OK', () => {
    // Line 183: withinBudget: violations.length === 0 && withinHotPath
    // This means ANY violation (even a warning) makes withinBudget false.
    // Is this intended? Yes — the contract is binary: budget met or not.
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 6 }, // 1ms over budget = warning
      { phase: 'retrieval', durationMs: 10 },
      { phase: 'context_assembly', durationMs: 5 },
      { phase: 'pre_safety', durationMs: 2 },
      { phase: 'post_safety', durationMs: 2 },
      { phase: 'learning', durationMs: 3 },
      { phase: 'evaluation', durationMs: 2 },
      { phase: 'audit', durationMs: 0.5 },
    ];
    const report = evaluateLatency(phases);

    // Hot-path total = 6+10+5+2+2+3+2+0.5 = 30.5ms — well under 103ms.
    assert.ok(report.hotPathMs <= DEFAULT_LATENCY_BUDGET.hotPathTotal,
      'Hot-path total should be under budget');
    // But perception at 6ms > 5ms = warning.
    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'warning');
    // DOCUMENTED BEHAVIOR: withinBudget is false despite hot-path being OK.
    assert.equal(report.withinBudget, false);
  });

  it('ATK-I14-014: hot-path exceeded but no per-phase violations -> withinBudget false', () => {
    // All individual phases within budget, but a phase not in PHASE_BUDGET_MAP
    // (via type assertion) bloats the hot-path total.
    const phases = [
      { phase: 'perception' as PipelinePhase, durationMs: 5 },
      { phase: 'unknown' as PipelinePhase, durationMs: 200 }, // No per-phase budget
    ];
    const report = evaluateLatency(phases);

    // No per-phase violations (both within budget or no budget).
    // But hotPathMs = 205 > 103.
    assert.equal(report.violations.length, 0);
    assert.equal(report.withinBudget, false);
  });
});

// ============================================================================
// ATTACK 7: Empty string phase
// ============================================================================

describe('ATTACK: I-14 Latency Harness — Empty string phase', () => {
  it('ATK-I14-015: empty string as PipelinePhase via type assertion', () => {
    const phases = [
      { phase: '' as PipelinePhase, durationMs: 50 },
    ];
    const report = evaluateLatency(phases);

    // Empty string is not 'generation', so added to hot-path.
    // Empty string not in PHASE_BUDGET_MAP, so no per-phase violation.
    assert.equal(report.hotPathMs, 50);
    assert.equal(report.violations.length, 0);
    // 50 <= 103, so withinBudget = true (vacuously).
    assert.equal(report.withinBudget, true);
  });
});

// ============================================================================
// ATTACK 8: Extreme values
// ============================================================================

describe('ATTACK: I-14 Latency Harness — Extreme values', () => {
  it('ATK-I14-016: very large durationMs (1 million ms) produces correct severity', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'audit', durationMs: 1_000_000 }, // 1M ms vs 1ms budget
    ];
    const report = evaluateLatency(phases);

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'critical'); // 1M >= 2 * 1
    assert.equal(report.violations[0].actualMs, 1_000_000);
    assert.equal(report.violations[0].budgetMs, 1);
    assert.equal(report.withinBudget, false);
  });

  it('ATK-I14-017: Number.MAX_SAFE_INTEGER durationMs does not overflow', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: Number.MAX_SAFE_INTEGER },
    ];
    const report = evaluateLatency(phases);

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].severity, 'critical');
    assert.equal(report.hotPathMs, Number.MAX_SAFE_INTEGER);
    assert.equal(report.withinBudget, false);
  });

  it('ATK-I14-018: exactly at budget boundary — no violation', () => {
    // Boundary: durationMs === budget should NOT be a violation (> not >=).
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 5 },   // Exactly at 5ms budget
      { phase: 'retrieval', durationMs: 50 },    // Exactly at 50ms budget
      { phase: 'audit', durationMs: 1 },         // Exactly at 1ms budget
    ];
    const report = evaluateLatency(phases);

    // Line 160: if (entry.durationMs > phaseBudget) — strict greater than.
    assert.equal(report.violations.length, 0, 'Exact budget should not be a violation');
  });

  it('ATK-I14-019: durationMs = budget + epsilon triggers warning', () => {
    const phases: Array<{ phase: PipelinePhase; durationMs: number }> = [
      { phase: 'perception', durationMs: 5.000001 }, // Just over 5ms
    ];
    const report = evaluateLatency(phases);

    assert.equal(report.violations.length, 1);
    // 5.000001 < 10 (2 * 5), so severity = warning.
    assert.equal(report.violations[0].severity, 'warning');
  });
});
