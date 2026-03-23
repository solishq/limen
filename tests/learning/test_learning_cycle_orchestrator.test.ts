/**
 * Limen — Phase 4E-2f LearningCycleOrchestrator Tests
 *
 * Integration and edge-case tests for the learning cycle orchestrator.
 * Includes the full pipeline integration test (AC-4) — the most important
 * test in the §29 Learning System.
 *
 * S ref: S29.3 (learning cycle), S29.5 (confidence tracking), S29.6 (retirement),
 *        S29.10 (over-specialization), DEC-4E-003 (HITL confidence 1.0)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSystem } from '../../src/learning/harness/learning_harness.js';
import {
  createTestDatabase, createTestOperationContext, createTestAuditTrail,
  tenantId, agentId,
} from '../helpers/test_database.js';
import {
  INITIAL_CONFIDENCE_EXTRACTED,
  INITIAL_CONFIDENCE_COLD_START,
  HITL_CONFIDENCE,
  OVERSPECIALIZATION_THRESHOLD,
} from '../../src/learning/interfaces/index.js';
import type { EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';

// ─── Constants ───

const TEST_TENANT = tenantId('test-tenant');
const TEST_AGENT = agentId('test-agent');

// ─── Helpers ───

function createMockLlmGateway(): LlmGateway {
  return {
    request: async () => ({
      ok: true as const,
      value: {
        content: JSON.stringify({
          type: 'prompt_fragment',
          content: 'When discussing pricing, always mention the annual discount option first.',
          confidence: 0.7,
          applicability: 'Sales conversations about pricing options',
        }),
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { inputTokens: 100, outputTokens: 50 },
        model: 'test-model',
        providerId: 'test-provider',
        latencyMs: 100,
      },
    }),
    requestStream: async () => ({ ok: false as const, error: { code: 'NOT_IMPL', message: 'N/A', spec: 'N/A' } }),
    registerProvider: () => ({ ok: true as const, value: undefined }),
    getProviderHealth: () => ({ ok: true as const, value: [] }),
    hasHealthyProvider: () => ({ ok: true as const, value: true }),
    checkFailoverBudget: () => ({ ok: true as const, value: { allowed: true } }),
  } as unknown as LlmGateway;
}

function createTestLearningSystem() {
  const conn = createTestDatabase();
  const ctx = createTestOperationContext();
  const ls = createLearningSystem({
    getConnection: () => conn,
    audit: createTestAuditTrail(),
    events: {} as EventBus,
    rbac: {} as RbacEngine,
    rateLimiter: {} as RateLimiter,
    gateway: createMockLlmGateway(),
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  });
  return { ls, conn, ctx };
}

// ═══════════════════════════════════════════════════════════════
// CYCLE ORCHESTRATOR — Core Behavior
// ═══════════════════════════════════════════════════════════════

describe('LearningCycleOrchestrator — Core Behavior', () => {

  it('runCycle returns valid result structure', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    const cycle = result.value;
    assert.strictEqual(cycle.agentId, TEST_AGENT);
    assert.strictEqual(cycle.tenantId, TEST_TENANT);
    assert.strictEqual(cycle.trigger, 'periodic');
    assert.ok(cycle.cycleId.length > 0, 'cycleId must not be empty');
    assert.ok(cycle.timestamp.length > 0, 'timestamp must not be empty');
  });

  it('runCycle with no candidates produces zero counts', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    assert.strictEqual(result.value.candidatesEvaluated, 0);
    assert.strictEqual(result.value.techniquesExtracted, 0);
    assert.strictEqual(result.value.duplicatesReinforced, 0);
  });

  it('getLastCycleTime returns null before any cycle', () => {
    const { ls, conn } = createTestLearningSystem();
    const result = ls.cycle.getLastCycleTime(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value, null);
  });

  it('getLastCycleTime returns timestamp after cycle', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Run a cycle
    const cycleResult = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(cycleResult.ok, true);

    // Check timestamp
    const timeResult = ls.cycle.getLastCycleTime(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(timeResult.ok, true);
    if (!timeResult.ok) return;
    assert.notStrictEqual(timeResult.value, null, 'timestamp must not be null after cycle');
    assert.ok(typeof timeResult.value === 'string');
    // Verify it's a valid ISO timestamp
    assert.ok(!isNaN(Date.parse(timeResult.value!)), 'must be valid ISO timestamp');
  });

  it('cycle-after-cycle: second cycle has later timestamp', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    const time1 = ls.cycle.getLastCycleTime(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(time1.ok, true);
    if (!time1.ok) return;

    // Small delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 5));

    await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    const time2 = ls.cycle.getLastCycleTime(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(time2.ok, true);
    if (!time2.ok) return;

    assert.ok(time2.value! > time1.value!, 'second cycle must have later timestamp');
  });

  it('cycle with explicit_feedback trigger succeeds', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'explicit_feedback');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.trigger, 'explicit_feedback');
  });

  it('cycle with hitl_correction trigger succeeds', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'hitl_correction');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.trigger, 'hitl_correction');
  });

  it('each cycle gets a unique cycleId', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const r1 = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    const r2 = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(r2.ok, true);
    if (!r1.ok || !r2.ok) return;

    assert.notStrictEqual(r1.value.cycleId, r2.value.cycleId, 'each cycle must have unique ID');
  });
});

// ═══════════════════════════════════════════════════════════════
// RETIREMENT SWEEP — Integration with Cycle
// ═══════════════════════════════════════════════════════════════

describe('LearningCycleOrchestrator — Retirement Sweep', () => {

  it('cycle retires techniques that meet retirement criteria', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create a technique with low confidence and enough applications for retirement
    const createResult = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Retirement test technique.',
      sourceMemoryIds: ['mem-retire-001'],
      initialConfidence: 0.1, // below RETIREMENT_THRESHOLD_CONFIDENCE (0.2)
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Set applicationCount above RETIREMENT_MIN_APPLICATIONS_CONFIDENCE (20)
    ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, {
      applicationCount: 25,
    });

    // Run cycle — retirement sweep should catch this technique
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.techniquesRetired, 1, 'one technique should be retired');

    // Verify technique is now retired
    const technique = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.strictEqual(technique.value.status, 'retired');
  });

  it('cycle does not retire healthy techniques', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create a healthy technique (confidence 0.5, no applications — nothing triggers retirement)
    ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Healthy technique.',
      sourceMemoryIds: ['mem-healthy-001'],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });

    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.techniquesRetired, 0, 'healthy technique must not be retired');
  });
});

// ═══════════════════════════════════════════════════════════════
// OVER-SPECIALIZATION DETECTION — Integration with Cycle
// ═══════════════════════════════════════════════════════════════

describe('LearningCycleOrchestrator — Specialization Check', () => {

  it('cycle detects over-specialization when all techniques are one type', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create 5 techniques all of type prompt_fragment
    for (let i = 0; i < 5; i++) {
      ls.store.create(conn, ctx, {
        tenantId: TEST_TENANT,
        agentId: TEST_AGENT,
        type: 'prompt_fragment',
        content: `Specialized technique ${i}`,
        sourceMemoryIds: [`mem-spec-${i}`],
        initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
      });
    }

    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // All same type → score = 1.0 > 0.9 threshold → overSpecialized = true
    assert.strictEqual(result.value.overSpecializationDetected, true,
      'all same type must trigger over-specialization');
  });

  it('cycle reports no over-specialization for diverse techniques', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create one of each type — uniform distribution
    ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'prompt_fragment',
      content: 'Diverse PF', sourceMemoryIds: ['mem-d1'], initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });
    ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'decision_rule',
      content: 'Diverse DR', sourceMemoryIds: ['mem-d2'], initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });
    ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'rag_pattern',
      content: 'Diverse RP', sourceMemoryIds: ['mem-d3'], initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });

    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.overSpecializationDetected, false,
      'diverse types must not trigger over-specialization');
  });
});

// ═══════════════════════════════════════════════════════════════
// HITL CONFIDENCE — DEC-4E-003
// ═══════════════════════════════════════════════════════════════

describe('LearningCycleOrchestrator — HITL Confidence', () => {

  it('HITL_CONFIDENCE constant is 1.0', () => {
    assert.strictEqual(HITL_CONFIDENCE, 1.0, 'DEC-4E-003: HITL confidence must be 1.0');
  });

  it('hitl_correction cycle completes with valid result', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create a technique (pre-existing, not from this cycle)
    ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'HITL test technique.',
      sourceMemoryIds: ['mem-hitl-001'],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });

    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'hitl_correction');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.trigger, 'hitl_correction');
    // collectCandidates returns empty (no interaction table) — so 0 extracted
    // But the cycle itself completes. HITL mechanism is ready for when
    // candidates arrive (tested via pipeline integration in future phases).
    assert.strictEqual(result.value.candidatesEvaluated, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// FULL PIPELINE INTEGRATION TEST (AC-4)
// ═══════════════════════════════════════════════════════════════

describe('LearningCycleOrchestrator — Full Pipeline Integration', () => {

  /**
   * This test exercises the data flow through all real subsystems.
   * It is the most important test in §29.
   *
   * Since collectCandidates currently returns empty (no interaction table),
   * this test validates the pipeline's integration with store, tracker,
   * retirement, and specialization — the subsystems that DO operate on
   * existing data.
   *
   * The full extraction path (candidate → LLM → proposal → dedup → store)
   * is validated by the extractor tests. The orchestrator's value is in
   * wiring those subsystems together with confidence update, retirement
   * sweep, and specialization check.
   */
  it('full pipeline: store → cycle → retirement + specialization check', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // ── Setup: Create techniques in various states ──

    // Technique 1: Healthy, high confidence — should survive cycle
    const t1 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'High-confidence technique.',
      sourceMemoryIds: ['mem-pipe-001'],
      initialConfidence: 0.9,
    });
    assert.strictEqual(t1.ok, true);
    if (!t1.ok) return;

    // Technique 2: Low confidence, enough applications — should be retired
    const t2 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'decision_rule',
      content: 'Low-confidence technique for retirement.',
      sourceMemoryIds: ['mem-pipe-002'],
      initialConfidence: 0.15,
    });
    assert.strictEqual(t2.ok, true);
    if (!t2.ok) return;
    ls.store.update(conn, ctx, t2.value.id, TEST_TENANT, {
      applicationCount: 25, // exceeds RETIREMENT_MIN_APPLICATIONS_CONFIDENCE (20)
    });

    // Technique 3: Another prompt_fragment — creates over-specialization
    // (2 prompt_fragment + 1 decision_rule, but t2 will be retired)
    const t3 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Second prompt_fragment for specialization test.',
      sourceMemoryIds: ['mem-pipe-003'],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });
    assert.strictEqual(t3.ok, true);

    // ── Execute: Run the full cycle ──
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    // ── Verify: Extraction (no candidates from empty collectCandidates) ──
    assert.strictEqual(result.value.candidatesEvaluated, 0, 'no interaction table → no candidates');
    assert.strictEqual(result.value.techniquesExtracted, 0);
    assert.strictEqual(result.value.duplicatesReinforced, 0);

    // ── Verify: Retirement sweep retired t2 ──
    assert.strictEqual(result.value.techniquesRetired, 1, 'low-confidence t2 should be retired');

    // Confirm t2 is actually retired in store
    const t2After = ls.store.get(conn, t2.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(t2After.ok, true);
    if (!t2After.ok) return;
    assert.strictEqual(t2After.value.status, 'retired', 't2 must be retired by cycle');

    // Confirm t1 survives
    const t1After = ls.store.get(conn, t1.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(t1After.ok, true);
    if (!t1After.ok) return;
    assert.strictEqual(t1After.value.status, 'active', 't1 must remain active');

    // ── Verify: Specialization check ──
    // After retirement: t1 (prompt_fragment) and t3 (prompt_fragment) remain active
    // All same type → overSpecialized = true
    assert.strictEqual(result.value.overSpecializationDetected, true,
      'after retirement, remaining techniques are all prompt_fragment → over-specialized');

    // ── Verify: Cycle timing ──
    const timeResult = ls.cycle.getLastCycleTime(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(timeResult.ok, true);
    if (!timeResult.ok) return;
    assert.notStrictEqual(timeResult.value, null, 'cycle time must be recorded');
    assert.strictEqual(timeResult.value, result.value.timestamp,
      'getLastCycleTime must match cycle result timestamp');

    // ── Verify: Result metadata ──
    assert.strictEqual(result.value.agentId, TEST_AGENT);
    assert.strictEqual(result.value.tenantId, TEST_TENANT);
    assert.strictEqual(result.value.trigger, 'periodic');
  });

  it('cold-start → cycle: template techniques survive cycle without retirement', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Apply cold-start template
    const templateResult = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'sales-default');
    assert.strictEqual(templateResult.ok, true);
    if (!templateResult.ok) return;

    const templateTechniques = templateResult.value;
    assert.ok(templateTechniques.length > 0);

    // Verify initial confidence
    for (const t of templateTechniques) {
      assert.strictEqual(t.confidence, INITIAL_CONFIDENCE_COLD_START);
      assert.strictEqual(t.status, 'active');
    }

    // Run cycle — cold-start techniques are healthy (confidence 0.6, 0 applications)
    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    // None should be retired (confidence > 0.2, not stale, not enough applications)
    assert.strictEqual(result.value.techniquesRetired, 0,
      'cold-start techniques should not be retired immediately');

    // Verify all still active
    for (const t of templateTechniques) {
      const check = ls.store.get(conn, t.id, TEST_TENANT, TEST_AGENT);
      assert.strictEqual(check.ok, true);
      if (!check.ok) return;
      assert.strictEqual(check.value.status, 'active');
    }
  });

  it('multiple cycles: retirement is cumulative', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create two techniques that should both be retired
    const t1 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'prompt_fragment',
      content: 'Low confidence 1', sourceMemoryIds: ['mem-mc-1'],
      initialConfidence: 0.15,
    });
    assert.strictEqual(t1.ok, true);
    if (!t1.ok) return;
    ls.store.update(conn, ctx, t1.value.id, TEST_TENANT, { applicationCount: 25 });

    // First cycle retires t1
    const r1 = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(r1.ok, true);
    if (!r1.ok) return;
    assert.strictEqual(r1.value.techniquesRetired, 1);

    // Create another low-confidence technique
    const t2 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'decision_rule',
      content: 'Low confidence 2', sourceMemoryIds: ['mem-mc-2'],
      initialConfidence: 0.1,
    });
    assert.strictEqual(t2.ok, true);
    if (!t2.ok) return;
    ls.store.update(conn, ctx, t2.value.id, TEST_TENANT, { applicationCount: 30 });

    // Second cycle retires t2 (t1 already retired, skipped by evaluateAll)
    const r2 = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');
    assert.strictEqual(r2.ok, true);
    if (!r2.ok) return;
    assert.strictEqual(r2.value.techniquesRetired, 1, 'second cycle retires t2');
  });
});
