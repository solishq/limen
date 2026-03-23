/**
 * Limen — Tracker + Retirement Integration & Edge Case Tests
 * Phase 4E-2d: EffectivenessTracker + RetirementEvaluator
 *
 * These tests verify behaviors that the contract tests do NOT cover:
 * 1. Full-chain integration: outcomes → tracker → store → retirement (no store.update shortcuts)
 * 2. EMA edge cases: zero outcomes, convergence trajectory, floating-point boundaries
 * 3. Success rate edge cases: fewer than 50, all-neutral, window boundary
 * 4. Retirement edge cases: below thresholds, boundary conditions, priority
 *
 * S ref: S29.5 (EMA, rolling window), S29.6 (retirement thresholds)
 * Amendment 2: Control 3 (discriminative tests — each has CATCHES comment)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSystem, NotImplementedError } from '../../src/learning/harness/learning_harness.js';
import { createTestDatabase, createTestOperationContext, createTestAuditTrail, tenantId, agentId } from '../helpers/test_database.js';
import {
  INITIAL_CONFIDENCE_EXTRACTED,
  EMA_WEIGHT_OLD,
  EMA_WEIGHT_RECENT,
  SUCCESS_RATE_WINDOW,
  RETIREMENT_THRESHOLD_SUCCESS_RATE,
  RETIREMENT_THRESHOLD_CONFIDENCE,
  RETIREMENT_MIN_APPLICATIONS_SUCCESS,
  RETIREMENT_MIN_APPLICATIONS_CONFIDENCE,
  RETIREMENT_STALENESS_DAYS,
} from '../../src/learning/interfaces/index.js';
import type {
  LearningSystem,
  TechniqueId,
  TechniqueCreateInput,
} from '../../src/learning/interfaces/index.js';
import type { DatabaseConnection, OperationContext, EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';

// ─── Test Setup ───

const TEST_TENANT = tenantId('test-tenant');
const TEST_AGENT = agentId('test-agent');

function createTestLearningSystem(): { ls: LearningSystem; conn: DatabaseConnection; ctx: OperationContext } {
  const conn = createTestDatabase();
  const ctx = createTestOperationContext();
  const ls = createLearningSystem({
    getConnection: () => conn,
    audit: createTestAuditTrail(),
    events: {} as EventBus,
    rbac: {} as RbacEngine,
    rateLimiter: {} as RateLimiter,
    gateway: {} as LlmGateway,
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  });
  return { ls, conn, ctx };
}

function createValidInput(): TechniqueCreateInput {
  return {
    tenantId: TEST_TENANT,
    agentId: TEST_AGENT,
    type: 'prompt_fragment',
    content: 'Integration test technique for tracker-retirement chain.',
    sourceMemoryIds: ['mem-int-001'],
    initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
  };
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATION: FULL CHAIN — tracker → store → retirement
// This is the most important test in this phase.
// ═══════════════════════════════════════════════════════════════

describe('Integration: Tracker → Store → Retirement (full chain, no shortcuts)', () => {

  it('healthy technique survives retirement after positive outcomes flow through tracker', () => {
    // CATCHES: If tracker.updateConfidence does NOT persist successRate to the store,
    // retirement reads 0.0 from the store and incorrectly recommends retirement.
    // This test uses NO direct store.update() — all metrics flow through the tracker.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Record 50 positive outcomes (all positive = 100% success rate)
    for (let i = 0; i < 50; i++) {
      const r = ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
      assert.strictEqual(r.ok, true, `recordOutcome #${i} must succeed`);
    }

    // Update confidence — this must persist both confidence AND successRate
    const confResult = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
    assert.strictEqual(confResult.ok, true);
    if (!confResult.ok) return;

    // Verify confidence was updated via EMA: 0.8 * 0.5 + 0.2 * 1.0 = 0.6
    const expectedConf = EMA_WEIGHT_OLD * INITIAL_CONFIDENCE_EXTRACTED + EMA_WEIGHT_RECENT * 1.0;
    assert.ok(Math.abs(confResult.value - expectedConf) < 0.001,
      `Confidence must be ${expectedConf}, got ${confResult.value}`);

    // Set applicationCount to 100 for retirement evaluation
    // (applicationCount is managed by applicator, not tracker — this is the one permitted store.update)
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: 100,
      lastApplied: new Date().toISOString(),
    });

    // NOW evaluate retirement — it reads from the store
    const retResult = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(retResult.ok, true);
    if (!retResult.ok) return;

    // Must NOT retire: successRate=1.0 (persisted by tracker), confidence=0.6
    assert.strictEqual(retResult.value.shouldRetire, false,
      'Healthy technique with 100% success rate must NOT be retired');
    assert.strictEqual(retResult.value.reason, null);

    // Verify the store actually has the persisted values
    const technique = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.ok(Math.abs(technique.value.successRate - 1.0) < 0.001,
      `Store must have successRate=1.0, got ${technique.value.successRate}`);
    assert.ok(Math.abs(technique.value.confidence - expectedConf) < 0.001,
      `Store must have confidence=${expectedConf}, got ${technique.value.confidence}`);
  });

  it('failing technique triggers retirement after negative outcomes flow through tracker', () => {
    // CATCHES: Same coupling test as above, but with failure path.
    // If tracker doesn't persist successRate, retirement reads 0.0 but
    // might STILL retire (since 0.0 < 0.3). This test verifies the
    // retirement reason is correctly derived from tracker-computed metrics.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Record 50 outcomes: 10 positive + 40 negative = 20% success rate
    for (let i = 0; i < 10; i++) {
      ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    }
    for (let i = 0; i < 40; i++) {
      ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');
    }

    // Update confidence — persists successRate = 0.2
    const confResult = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
    assert.strictEqual(confResult.ok, true);
    if (!confResult.ok) return;

    // EMA: 0.8 * 0.5 + 0.2 * 0.2 = 0.44
    const expectedConf = EMA_WEIGHT_OLD * INITIAL_CONFIDENCE_EXTRACTED + EMA_WEIGHT_RECENT * 0.2;
    assert.ok(Math.abs(confResult.value - expectedConf) < 0.001,
      `Confidence must be ${expectedConf}, got ${confResult.value}`);

    // Set applicationCount >= 50 for retirement to trigger
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: RETIREMENT_MIN_APPLICATIONS_SUCCESS,
    });

    // Evaluate retirement — must trigger low_success_rate
    const retResult = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(retResult.ok, true);
    if (!retResult.ok) return;

    assert.strictEqual(retResult.value.shouldRetire, true,
      'Technique with 20% success rate over 50+ applications must be retired');
    assert.strictEqual(retResult.value.reason, 'low_success_rate');

    // Verify the store has the tracker-persisted values
    const technique = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.ok(Math.abs(technique.value.successRate - 0.2) < 0.001,
      `Store successRate must be 0.2 (tracker-persisted), got ${technique.value.successRate}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// EMA EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe('EMA Edge Cases (S29.5)', () => {

  it('updateConfidence with zero recent outcomes returns current confidence unchanged', () => {
    // CATCHES: If updateConfidence computes success rate from zero outcomes,
    // the result is NaN (0/0) which propagates through EMA. This test verifies
    // the defined behavior: no outcomes = no update.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // No outcomes recorded — call updateConfidence immediately
    const result = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    // Must return initial confidence (0.5), unchanged
    assert.strictEqual(result.value, INITIAL_CONFIDENCE_EXTRACTED,
      `No outcomes: confidence must stay at initial ${INITIAL_CONFIDENCE_EXTRACTED}`);

    // Verify store was NOT updated (confidence still initial)
    const technique = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.strictEqual(technique.value.confidence, INITIAL_CONFIDENCE_EXTRACTED,
      'Store confidence must remain at initial value when no outcomes exist');
  });

  it('updateConfidence converges toward 1.0 with consistent 100% success over 15 cycles', () => {
    // CATCHES: Verifies EMA convergence trajectory matches mathematical expectation.
    // If the formula is wrong (e.g., weights swapped), convergence rate changes.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Each cycle: record 10 positive outcomes, then updateConfidence
    let currentConf = INITIAL_CONFIDENCE_EXTRACTED;
    const expectedTrajectory: number[] = [];

    for (let cycle = 0; cycle < 15; cycle++) {
      // Record 10 positive outcomes per cycle
      for (let i = 0; i < 10; i++) {
        ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
      }

      const result = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
      assert.strictEqual(result.ok, true, `Cycle ${cycle}: updateConfidence must succeed`);
      if (!result.ok) return;

      // Compute expected: 0.8 * old + 0.2 * 1.0 (all positive)
      currentConf = EMA_WEIGHT_OLD * currentConf + EMA_WEIGHT_RECENT * 1.0;
      expectedTrajectory.push(currentConf);

      assert.ok(Math.abs(result.value - currentConf) < 0.001,
        `Cycle ${cycle}: confidence ${result.value} must match EMA trajectory ${currentConf}`);
    }

    // After 15 cycles of 100% success starting from 0.5:
    // Mathematical result: 0.5 * 0.8^15 + 1.0 * (1 - 0.8^15) ≈ 0.9648
    assert.ok(currentConf > 0.96, `After 15 cycles of 100% success, confidence must be >0.96, got ${currentConf}`);
    assert.ok(currentConf < 1.0, 'EMA cannot reach exactly 1.0 from 0.5 in finite cycles');
  });

  it('floating-point boundary: confidence near retirement threshold', () => {
    // CATCHES: IEEE 754 floating-point can produce values like 0.19999999999999998
    // instead of 0.2. If retirement uses >= instead of >, or vice versa, this matters.
    // The spec says "confidence < 0.2" — strictly less than. We verify the boundary.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Set confidence to exactly the threshold
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: RETIREMENT_MIN_APPLICATIONS_CONFIDENCE,
      confidence: RETIREMENT_THRESHOLD_CONFIDENCE, // exactly 0.2
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    // At exactly 0.2: NOT retired (spec says < 0.2, not <= 0.2)
    assert.strictEqual(result.value.shouldRetire, false,
      'Confidence exactly at threshold (0.2) must NOT trigger retirement (< not <=)');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUCCESS RATE EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe('Success Rate Edge Cases (S29.5)', () => {

  it('fewer than 50 outcomes uses all available', () => {
    // CATCHES: If getSuccessRate only works with exactly 50 outcomes
    // and returns 0 or errors with fewer, this test catches it.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // 5 positive + 5 negative = 10 total, success rate = 0.5
    for (let i = 0; i < 5; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    for (let i = 0; i < 5; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');

    const result = ls.tracker.getSuccessRate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.value - 0.5) < 0.001,
      `10 outcomes (5+5): success rate must be 0.5, got ${result.value}`);
  });

  it('exactly 50 outcomes, all neutral: denominator zero returns 0.0', () => {
    // CATCHES: Division by zero when all outcomes are neutral.
    // If implementation doesn't handle this, it returns NaN or throws.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // 50 neutral outcomes
    for (let i = 0; i < 50; i++) {
      ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'neutral');
    }

    const result = ls.tracker.getSuccessRate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value, 0.0,
      'All neutral outcomes: success rate must be 0.0 (not NaN or error)');
  });

  it('window boundary: 51st outcome pushes oldest out', () => {
    // CATCHES: If the rolling window is not correctly limited to 50,
    // old outcomes contaminate the ratio. This test creates 50 negative
    // then 50 positive (total 100), and verifies only the last 50 count.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // First 50: all negative (would give 0% if counted)
    for (let i = 0; i < 50; i++) {
      ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');
    }

    // Next 50: all positive (window should only see these)
    for (let i = 0; i < 50; i++) {
      ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    }

    const result = ls.tracker.getSuccessRate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    // Rolling window of last 50: all positive = 100% success rate
    assert.ok(Math.abs(result.value - 1.0) < 0.001,
      `Rolling window must only include last 50 outcomes: expected 1.0, got ${result.value}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// RETIREMENT EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe('Retirement Edge Cases (S29.6)', () => {

  it('49 applications with bad success rate: NOT retired (below threshold)', () => {
    // CATCHES: If retirement doesn't check minimum application count,
    // techniques are prematurely retired without sufficient evidence.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: 49, // One below threshold
      successRate: 0.1,     // Terrible, but not enough data
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, false,
      '49 applications (below 50 threshold) must NOT trigger retirement even with 10% success');
  });

  it('lastApplied exactly 90 days ago: NOT stale (boundary)', () => {
    // CATCHES: Off-by-one in staleness check. Spec says ">90 days" not ">=90 days".
    // Exactly 90 days is NOT stale.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    // Use 90 days minus 1 minute to avoid flakiness from elapsed time between
    // timestamp computation and evaluation (a few ms can push past the >90 boundary).
    const exactly90DaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000 + 60_000).toISOString();
    ls.store.update(conn, ctx, tid, TEST_TENANT, { lastApplied: exactly90DaysAgo });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, false,
      'Exactly 90 days: must NOT retire (>90, not >=90)');
  });

  it('multiple retirement conditions: first match wins with correct priority', () => {
    // CATCHES: If retirement checks conditions in wrong order, the reason
    // reported doesn't match the expected priority (low_success_rate > low_confidence > stale).
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

    // All three conditions true simultaneously:
    // - applicationCount=100 >= 50, successRate=0.1 < 0.3 → low_success_rate
    // - applicationCount=100 >= 20, confidence=0.1 < 0.2 → low_confidence
    // - lastApplied=120 days ago > 90 → stale
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: 100,
      successRate: 0.1,
      confidence: 0.1,
      lastApplied: longAgo,
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, true);
    assert.strictEqual(result.value.reason, 'low_success_rate',
      'When all conditions true, low_success_rate has highest priority');
  });

  it('evaluateAll returns decisions for all active techniques', () => {
    // CATCHES: If evaluateAll misses techniques or includes retired ones.
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create 3 techniques
    const t1 = ls.store.create(conn, ctx, createValidInput());
    const input2 = { ...createValidInput(), content: 'Second technique' };
    const t2 = ls.store.create(conn, ctx, input2);
    const input3 = { ...createValidInput(), content: 'Third technique (will be retired)' };
    const t3 = ls.store.create(conn, ctx, input3);

    assert.strictEqual(t1.ok, true);
    assert.strictEqual(t2.ok, true);
    assert.strictEqual(t3.ok, true);
    if (!t1.ok || !t2.ok || !t3.ok) return;

    // Retire the third one
    ls.store.retire(conn, ctx, t3.value.id, TEST_TENANT, 'human_flagged');

    // evaluateAll should return decisions for t1 and t2 only (not retired t3)
    const result = ls.retirement.evaluateAll(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    assert.strictEqual(result.value.length, 2,
      'evaluateAll must return decisions for 2 active techniques (not retired)');

    // Both should be healthy (just created, no bad metrics)
    for (const decision of result.value) {
      assert.strictEqual(decision.shouldRetire, false);
      assert.strictEqual(decision.reason, null);
    }
  });

  it('retired technique returns shouldRetire=false from evaluate', () => {
    // CATCHES: If evaluate tries to evaluate a retired technique and
    // incorrectly recommends re-retirement.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Retire it
    ls.store.retire(conn, ctx, tid, TEST_TENANT, 'human_flagged');

    // Evaluate the retired technique
    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    assert.strictEqual(result.value.shouldRetire, false,
      'Already retired technique: shouldRetire must be false');
    assert.strictEqual(result.value.reason, null);
  });

  it('success_rate at exactly 0.3 with 50+ apps: NOT retired (< not <=)', () => {
    // CATCHES: Off-by-one in success rate comparison.
    // Spec says "success_rate < 0.3" — exactly 0.3 is NOT below threshold.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: RETIREMENT_MIN_APPLICATIONS_SUCCESS,
      successRate: RETIREMENT_THRESHOLD_SUCCESS_RATE, // exactly 0.3
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, false,
      'Success rate exactly at threshold (0.3) must NOT trigger retirement (< not <=)');
  });
});

// ═══════════════════════════════════════════════════════════════
// R-04: DATA PERSISTENCE VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe('R-04: updateConfidence persists both confidence and successRate', () => {

  it('store.get() after updateConfidence reflects persisted confidence', () => {
    // CATCHES: If updateConfidence returns the correct value but doesn't
    // call store.update(), the store still has the old value.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Record outcomes: 6 positive + 4 negative = 60% success
    for (let i = 0; i < 6; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    for (let i = 0; i < 4; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');

    const confResult = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
    assert.strictEqual(confResult.ok, true);
    if (!confResult.ok) return;

    // Read back from store
    const technique = ls.store.get(conn, tid, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;

    // Confidence must match what updateConfidence returned
    assert.ok(Math.abs(technique.value.confidence - confResult.value) < 0.001,
      `Store confidence (${technique.value.confidence}) must match updateConfidence result (${confResult.value})`);

    // successRate must be persisted (not still 0.0)
    assert.ok(Math.abs(technique.value.successRate - 0.6) < 0.001,
      `Store successRate must be 0.6 (6 positive / 10 total), got ${technique.value.successRate}`);
  });

  it('successive updateConfidence calls accumulate correctly', () => {
    // CATCHES: If updateConfidence reads stale confidence from the store
    // instead of the freshly-updated value, the EMA accumulation is wrong.
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;

    // Cycle 1: 10 positive = 100% success
    for (let i = 0; i < 10; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    const r1 = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
    assert.strictEqual(r1.ok, true);
    if (!r1.ok) return;

    // Expected: 0.8 * 0.5 + 0.2 * 1.0 = 0.6
    const expected1 = EMA_WEIGHT_OLD * 0.5 + EMA_WEIGHT_RECENT * 1.0;
    assert.ok(Math.abs(r1.value - expected1) < 0.001);

    // Cycle 2: 10 more positive = still 100% success (all 20 outcomes positive)
    for (let i = 0; i < 10; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    const r2 = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);
    assert.strictEqual(r2.ok, true);
    if (!r2.ok) return;

    // Expected: 0.8 * 0.6 + 0.2 * 1.0 = 0.68
    const expected2 = EMA_WEIGHT_OLD * expected1 + EMA_WEIGHT_RECENT * 1.0;
    assert.ok(Math.abs(r2.value - expected2) < 0.001,
      `Second update must use persisted confidence from first: expected ${expected2}, got ${r2.value}`);
  });
});
