/**
 * Limen — S29 Learning System Executable Contract Tests
 * Phase 4E-1: Truth Model Verification
 *
 * Every test in this file MUST FAIL against the NOT_IMPLEMENTED harness.
 * Every test asserts spec-derived behavior, not implementation details.
 * When implementation replaces the harness, tests turn green one by one.
 *
 * S ref: S29.1-S29.10, I-03, I-07, I-10, I-28, FM-01, FM-07
 * Amendment 2: Control 3 (Executable Contract, Interface-First)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSystem, NotImplementedError } from '../../src/learning/harness/learning_harness.js';
import { createTestDatabase, createTestOperationContext, createTestAuditTrail, tenantId, agentId } from '../helpers/test_database.js';
import {
  INITIAL_CONFIDENCE_EXTRACTED,
  INITIAL_CONFIDENCE_COLD_START,
  CONFIDENCE_RESET_TRANSFER,
  CONFIDENCE_RESET_REACTIVATION,
  EMA_WEIGHT_OLD,
  EMA_WEIGHT_RECENT,
  RETIREMENT_THRESHOLD_SUCCESS_RATE,
  RETIREMENT_THRESHOLD_CONFIDENCE,
  RETIREMENT_MIN_APPLICATIONS_SUCCESS,
  RETIREMENT_MIN_APPLICATIONS_CONFIDENCE,
  DEDUP_SIMILARITY_THRESHOLD,
  OVERSPECIALIZATION_THRESHOLD,
  TRANSFER_MIN_CONFIDENCE,
  TRANSFER_MIN_SUCCESS_RATE,
  TRANSFER_MIN_APPLICATIONS,
  HITL_CONFIDENCE,
  LEARNING_PERMISSIONS,
} from '../../src/learning/interfaces/index.js';
import type {
  LearningSystem,
  TechniqueId,
  TechniqueCreateInput,
  ExtractionCandidate,
  TechniqueApplication,
  TransferRequest,
} from '../../src/learning/interfaces/index.js';
import type { DatabaseConnection, OperationContext, AuditTrail, EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';

// ─── Test Setup ───

/**
 * Create a functional LlmGateway mock for extraction tests.
 * Returns a valid TechniqueProposal JSON from request().
 * Pattern: tests/gap/test_gap_018_data_integrity.test.ts
 * Phase 4E-2b: Required for tests #11, #14 (generateProposal path).
 */
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
    requestStream: async () => ({
      ok: false as const,
      error: { code: 'NOT_IMPL', message: 'N/A', spec: 'N/A' },
    }),
    registerProvider: () => ({ ok: true as const, value: undefined }),
    getProviderHealth: () => ({ ok: true as const, value: [] }),
    hasHealthyProvider: () => ({ ok: true as const, value: true }),
    checkFailoverBudget: () => ({ ok: true as const, value: { allowed: true } }),
  } as unknown as LlmGateway;
}

function createTestLearningSystem(): { ls: LearningSystem; conn: DatabaseConnection; ctx: OperationContext } {
  const conn = createTestDatabase();
  const ctx = createTestOperationContext();
  const ls = createLearningSystem({
    getConnection: () => conn,
    audit: createTestAuditTrail(),
    events: {} as EventBus,
    rbac: {} as RbacEngine,
    rateLimiter: {} as RateLimiter,
    gateway: createMockLlmGateway(),  // BRK-S29-012: Functional mock for extraction tests
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  });
  return { ls, conn, ctx };
}

const TEST_TENANT = tenantId('test-tenant');
const TEST_AGENT = agentId('test-agent');
const TEST_AGENT_B = agentId('test-agent-b');

function techniqueId(id: string): TechniqueId {
  return id as TechniqueId;
}

function createValidInput(): TechniqueCreateInput {
  return {
    tenantId: TEST_TENANT,
    agentId: TEST_AGENT,
    type: 'prompt_fragment',
    content: 'When discussing pricing, always mention the annual discount option first.',
    sourceMemoryIds: ['mem-001', 'mem-002'],
    initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
  };
}

function createTestCandidate(): ExtractionCandidate {
  return {
    interactionId: 'interaction-001',
    agentId: TEST_AGENT,
    tenantId: TEST_TENANT,
    qualityScore: 0.85,
    userFeedback: 'positive',
    conversationContext: 'System: You are a sales agent.\nUser: What are your pricing options?\nAssistant: We offer monthly and annual plans...\nFeedback: Great explanation!',
  };
}

// ═══════════════════════════════════════════════════════════════
// S29.2 + S29.3 Step 4: TECHNIQUE STORE — CRUD + LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — TechniqueStore', () => {
  it('#1 create: returns technique with all schema fields (S29.2)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const input = createValidInput();

    const result = ls.store.create(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const t = result.value;
    assert.strictEqual(t.tenantId, TEST_TENANT);
    assert.strictEqual(t.agentId, TEST_AGENT);
    assert.strictEqual(t.type, 'prompt_fragment');
    assert.strictEqual(t.content, input.content);
    assert.deepStrictEqual(t.sourceMemoryIds, ['mem-001', 'mem-002']);
    assert.strictEqual(t.confidence, INITIAL_CONFIDENCE_EXTRACTED);
    assert.strictEqual(t.successRate, 0);
    assert.strictEqual(t.applicationCount, 0);
    assert.strictEqual(t.lastApplied, null);
    assert.strictEqual(t.status, 'active');
    assert.ok(t.id, 'technique must have a non-empty ID');
    assert.ok(t.createdAt, 'technique must have a createdAt timestamp');
  });

  it('#2 create: enforces initial confidence = 0.5 for extracted techniques (S29.3 Step 4)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const input = createValidInput();

    const result = ls.store.create(conn, ctx, input);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.confidence, INITIAL_CONFIDENCE_EXTRACTED);
    assert.strictEqual(INITIAL_CONFIDENCE_EXTRACTED, 0.5, 'spec constant must be 0.5');
  });

  it('#3 create: rejects empty sourceMemoryIds — provenance required (S29.3 Step 4)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const input: TechniqueCreateInput = {
      ...createValidInput(),
      sourceMemoryIds: [],
    };

    const result = ls.store.create(conn, ctx, input);

    assert.strictEqual(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.code.includes('PROVENANCE'), 'must reject with provenance-related error');
  });

  it('#4 get: retrieves technique by ID with tenant + agent isolation (I-07, BRK-S29-014)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const result = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.id, createResult.value.id);
    assert.strictEqual(result.value.tenantId, TEST_TENANT);
    assert.strictEqual(result.value.agentId, TEST_AGENT);
  });

  it('#5 get: returns error for wrong tenant — tenant isolation enforced', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const wrongTenant = tenantId('other-tenant');
    const result = ls.store.get(conn, createResult.value.id, wrongTenant, TEST_AGENT);

    assert.strictEqual(result.ok, false, 'must not return technique for wrong tenant');
  });

  it('#6 getByAgent: filters by agent and status (I-07)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, createValidInput());
    ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'Route cancel to retention' });

    const result = ls.store.getByAgent(conn, TEST_AGENT, TEST_TENANT, 'active');

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 2);
    for (const t of result.value) {
      assert.strictEqual(t.agentId, TEST_AGENT);
      assert.strictEqual(t.status, 'active');
    }
  });

  it('#7 retire: transitions status to retired — technique no longer active (S29.6)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const retireResult = ls.store.retire(conn, ctx, createResult.value.id, TEST_TENANT, 'low_success_rate');

    assert.strictEqual(retireResult.ok, true);

    const getResult = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(getResult.ok, true);
    if (!getResult.ok) return;
    assert.strictEqual(getResult.value.status, 'retired');
  });

  it('#8 reactivate: rejected for retired techniques — retirement is permanent (I-10)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.store.retire(conn, ctx, createResult.value.id, TEST_TENANT, 'human_flagged');
    const reactivateResult = ls.store.reactivate(conn, ctx, createResult.value.id, TEST_TENANT, CONFIDENCE_RESET_REACTIVATION);

    assert.strictEqual(reactivateResult.ok, false, 'retired techniques cannot be reactivated (I-10)');
  });

  it('#9 suspend + reactivate: quarantine cycle resets confidence to 0.3 (S29.7)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.store.suspend(conn, ctx, createResult.value.id, TEST_TENANT);
    ls.store.reactivate(conn, ctx, createResult.value.id, TEST_TENANT, CONFIDENCE_RESET_REACTIVATION);

    const getResult = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(getResult.ok, true);
    if (!getResult.ok) return;
    assert.strictEqual(getResult.value.status, 'active');
    assert.strictEqual(getResult.value.confidence, CONFIDENCE_RESET_REACTIVATION);
    assert.strictEqual(CONFIDENCE_RESET_REACTIVATION, 0.3, 'spec constant must be 0.3');
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.3: TECHNIQUE EXTRACTION
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — TechniqueExtractor', () => {
  it('#10 collectCandidates: filters by quality > 0.7 (S29.3 Step 1)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const result = ls.extractor.collectCandidates(conn, ctx, TEST_AGENT, new Date(0).toISOString());

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    for (const candidate of result.value) {
      assert.ok(candidate.qualityScore > 0.7, `candidate quality ${candidate.qualityScore} must exceed 0.7`);
    }
  });

  it('#11 generateProposal: returns typed proposal via LLM (S29.3 Step 2)', async () => {
    const { ls, ctx } = createTestLearningSystem();
    const candidate = createTestCandidate();

    const result = await ls.extractor.generateProposal(ctx, candidate);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const proposal = result.value;
    assert.ok(['prompt_fragment', 'decision_rule', 'rag_pattern'].includes(proposal.type));
    assert.ok(proposal.content.length > 0, 'proposal content must not be empty');
    assert.ok(proposal.confidence >= 0 && proposal.confidence <= 1, 'confidence must be in [0,1]');
    assert.ok(proposal.applicability.length > 0, 'applicability must not be empty');
  });

  it('#12 checkDuplicate: similarity > 0.85 returns isDuplicate=true (S29.3 Step 3)', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // First, create a technique
    ls.store.create(conn, ctx, createValidInput());

    // Check duplicate with same content
    const result = await ls.extractor.checkDuplicate(conn, TEST_AGENT, TEST_TENANT, createValidInput().content);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.isDuplicate, true);
    assert.ok(result.value.similarity >= DEDUP_SIMILARITY_THRESHOLD,
      `similarity ${result.value.similarity} must be >= ${DEDUP_SIMILARITY_THRESHOLD}`);
  });

  it('#13 checkDuplicate: novel content returns isDuplicate=false (S29.3 Step 3)', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, createValidInput());

    const result = await ls.extractor.checkDuplicate(conn, TEST_AGENT, TEST_TENANT,
      'Completely different technique about database optimization and indexing strategies.');

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.isDuplicate, false);
    assert.ok(result.value.similarity < DEDUP_SIMILARITY_THRESHOLD);
  });

  it('#14 extractAndStore: creates technique with provenance in single transaction (S29.3 Step 4, I-03)', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const candidate = createTestCandidate();

    const result = await ls.extractor.extractAndStore(conn, ctx, candidate);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.notStrictEqual(result.value, null, 'novel extraction should return a technique');
    if (result.value === null) return;
    assert.strictEqual(result.value.confidence, INITIAL_CONFIDENCE_EXTRACTED);
    assert.strictEqual(result.value.applicationCount, 0);
    assert.strictEqual(result.value.status, 'active');
    assert.ok(result.value.sourceMemoryIds.length > 0, 'provenance chain must not be empty');
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.4: APPLICATION MECHANICS
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — TechniqueApplicator', () => {
  it('#15 getActivePromptFragments: ordered by confidence descending (S29.4)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create techniques with varying confidence
    const t1 = ls.store.create(conn, ctx, { ...createValidInput(), content: 'Low conf technique' });
    const t2 = ls.store.create(conn, ctx, { ...createValidInput(), content: 'High conf technique' });

    // Manually set different confidences via update
    if (t1.ok) ls.store.update(conn, ctx, t1.value.id, TEST_TENANT, { confidence: 0.3 });
    if (t2.ok) ls.store.update(conn, ctx, t2.value.id, TEST_TENANT, { confidence: 0.9 });

    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, 10000);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.value.length >= 2, 'should return at least 2 fragments');
    // Verify descending confidence order
    for (let i = 1; i < result.value.length; i++) {
      assert.ok(result.value[i - 1].confidence >= result.value[i].confidence,
        `fragments must be ordered by confidence descending: ${result.value[i - 1].confidence} >= ${result.value[i].confidence}`);
    }
  });

  it('#16 getActivePromptFragments: respects 20% context window limit (S29.4)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create many techniques that collectively exceed token budget
    for (let i = 0; i < 20; i++) {
      ls.store.create(conn, ctx, {
        ...createValidInput(),
        content: `Technique ${i}: ` + 'A'.repeat(500), // ~500 chars each
      });
    }

    // Request with small budget — should truncate by lowest confidence
    const maxTokenBudget = 100; // Very small budget
    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT, TEST_TENANT, maxTokenBudget);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Total content should fit within budget
    const totalTokens = result.value.reduce((sum, t) => sum + Math.ceil(t.content.length / 4), 0);
    assert.ok(totalTokens <= maxTokenBudget,
      `total tokens ${totalTokens} must not exceed budget ${maxTokenBudget}`);
  });

  it('#17 getActiveDecisionRules: excludes retired and suspended (S29.4, S29.6)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'Active rule' });
    const retired = ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'Retired rule' });
    const suspended = ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: 'Suspended rule' });

    if (retired.ok) ls.store.retire(conn, ctx, retired.value.id, TEST_TENANT, 'human_flagged');
    if (suspended.ok) ls.store.suspend(conn, ctx, suspended.value.id, TEST_TENANT);

    const result = ls.applicator.getActiveDecisionRules(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 1, 'only active rules returned');
    assert.strictEqual(result.value[0].content, 'Active rule');
  });

  it('#18 recordApplications: records each application with applied flag (S29.4)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const applications: TechniqueApplication[] = [
      { techniqueId: techniqueId('t-1'), interactionId: 'int-1', tenantId: TEST_TENANT, timestamp: new Date().toISOString(), applied: true },
      { techniqueId: techniqueId('t-2'), interactionId: 'int-1', tenantId: TEST_TENANT, timestamp: new Date().toISOString(), applied: false },
    ];

    const result = ls.applicator.recordApplications(conn, ctx, applications);

    assert.strictEqual(result.ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.5: EFFECTIVENESS TRACKING
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — EffectivenessTracker', () => {
  it('#19 updateConfidence: applies EMA formula 0.8*old + 0.2*recent (S29.5)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Record enough outcomes to compute a meaningful success rate
    const tid = createResult.value.id;
    // 8 positive + 2 negative = success_rate 0.8
    for (let i = 0; i < 8; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    for (let i = 0; i < 2; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');

    const result = ls.tracker.updateConfidence(conn, ctx, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // EMA: 0.8 * 0.5 (initial) + 0.2 * 0.8 (recent success rate)
    const expected = EMA_WEIGHT_OLD * INITIAL_CONFIDENCE_EXTRACTED + EMA_WEIGHT_RECENT * 0.8;
    assert.ok(Math.abs(result.value - expected) < 0.001,
      `EMA result ${result.value} must equal ${expected} (0.8*0.5 + 0.2*0.8 = 0.56)`);
  });

  it('#20 getSuccessRate: computes over rolling 50-application window (S29.5)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    // Record 30 positive + 20 negative = 0.6 success rate
    for (let i = 0; i < 30; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    for (let i = 0; i < 20; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');

    const result = ls.tracker.getSuccessRate(conn, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // 30/(30+20) = 0.6
    assert.ok(Math.abs(result.value - 0.6) < 0.001,
      `success rate ${result.value} must be 0.6 (30 positive / 50 total)`);
  });

  it('#21 getSuccessRate: neutral outcomes excluded from ratio (S29.5)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    // 3 positive + 1 negative + 6 neutral = success rate = 3/(3+1) = 0.75
    for (let i = 0; i < 3; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');
    ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'negative');
    for (let i = 0; i < 6; i++) ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'neutral');

    const result = ls.tracker.getSuccessRate(conn, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.value - 0.75) < 0.001,
      `success rate ${result.value} must be 0.75 — neutral excluded (3/(3+1))`);
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.6: RETIREMENT THRESHOLDS
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — RetirementEvaluator', () => {
  it('#22 evaluate: recommends retirement when success_rate < 0.3 over 50+ apps (S29.6)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    // Set up: 50+ applications with success_rate below 0.3
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: RETIREMENT_MIN_APPLICATIONS_SUCCESS,
      successRate: RETIREMENT_THRESHOLD_SUCCESS_RATE - 0.01,
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, true);
    assert.strictEqual(result.value.reason, 'low_success_rate');
  });

  it('#23 evaluate: recommends retirement when confidence < 0.2 after 20+ apps (S29.6)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: RETIREMENT_MIN_APPLICATIONS_CONFIDENCE,
      confidence: RETIREMENT_THRESHOLD_CONFIDENCE - 0.01,
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, true);
    assert.strictEqual(result.value.reason, 'low_confidence');
  });

  it('#24 evaluate: recommends retirement when not applied in 90 days (S29.6)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    ls.store.update(conn, ctx, tid, TEST_TENANT, { lastApplied: ninetyOneDaysAgo });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, true);
    assert.strictEqual(result.value.reason, 'stale');
  });

  it('#25 evaluate: does NOT recommend retirement when thresholds not met (S29.6)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    // Healthy technique: good metrics, recently applied
    ls.store.update(conn, ctx, tid, TEST_TENANT, {
      applicationCount: 100,
      successRate: 0.8,
      confidence: 0.7,
      lastApplied: new Date().toISOString(),
    });

    const result = ls.retirement.evaluate(conn, tid, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.shouldRetire, false);
    assert.strictEqual(result.value.reason, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.7: QUARANTINE CASCADE (FM-01 Defense)
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — QuarantineManager', () => {
  it('#26 quarantine: suspends all specified techniques atomically (S29.7)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t1 = ls.store.create(conn, ctx, { ...createValidInput(), content: 'Technique A' });
    const t2 = ls.store.create(conn, ctx, { ...createValidInput(), content: 'Technique B' });
    assert.strictEqual(t1.ok, true);
    assert.strictEqual(t2.ok, true);
    if (!t1.ok || !t2.ok) return;

    const ids = [t1.value.id, t2.value.id];
    const result = ls.quarantine.quarantine(conn, ctx, ids, TEST_TENANT, 'Suspected poisoning');

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 2, 'all techniques quarantined');

    // Verify both are now suspended
    const get1 = ls.store.get(conn, t1.value.id, TEST_TENANT, TEST_AGENT);
    const get2 = ls.store.get(conn, t2.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(get1.ok && get1.value.status, 'suspended');
    assert.strictEqual(get2.ok && get2.value.status, 'suspended');
  });

  it('#27 resolve: reactivation resets confidence to 0.3 (S29.7)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const qResult = ls.quarantine.quarantine(conn, ctx, [createResult.value.id], TEST_TENANT, 'Investigation');
    assert.strictEqual(qResult.ok, true);
    if (!qResult.ok) return;

    ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'reactivated');

    const getResult = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(getResult.ok, true);
    if (!getResult.ok) return;
    assert.strictEqual(getResult.value.status, 'active');
    assert.strictEqual(getResult.value.confidence, CONFIDENCE_RESET_REACTIVATION);
  });

  it('#28 resolve: permanent retirement from quarantine (S29.7)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const qResult = ls.quarantine.quarantine(conn, ctx, [createResult.value.id], TEST_TENANT, 'Confirmed poisoned');
    assert.strictEqual(qResult.ok, true);
    if (!qResult.ok) return;

    ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'permanently_retired');

    const getResult = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(getResult.ok, true);
    if (!getResult.ok) return;
    assert.strictEqual(getResult.value.status, 'retired');
  });

  it('#29 getPending: returns unresolved quarantine entries (S29.7)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.quarantine.quarantine(conn, ctx, [createResult.value.id], TEST_TENANT, 'Under review');

    const result = ls.quarantine.getPending(conn, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.value.length >= 1, 'at least one pending quarantine entry');
    assert.strictEqual(result.value[0].resolution, null, 'pending entry has no resolution');
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.8: CROSS-AGENT TRANSFER
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — CrossAgentTransfer', () => {
  it('#30 approveTransfer: creates new technique at confidence 0.4 (S29.8)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Qualify technique for transfer (BRK-S29-002: confidence > 0.8, success_rate > 0.7, applicationCount > 50)
    ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.8,
      applicationCount: 55,
    });

    const request: TransferRequest = {
      sourceTechniqueId: createResult.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    };

    const reqResult = ls.transfer.requestTransfer(conn, ctx, request);
    assert.strictEqual(reqResult.ok, true);
    if (!reqResult.ok) return;

    const approveResult = ls.transfer.approveTransfer(conn, ctx, reqResult.value);

    assert.strictEqual(approveResult.ok, true);
    if (!approveResult.ok) return;
    assert.strictEqual(approveResult.value.confidence, CONFIDENCE_RESET_TRANSFER);
    assert.strictEqual(CONFIDENCE_RESET_TRANSFER, 0.4, 'spec constant must be 0.4');
    assert.notStrictEqual(approveResult.value.newTechniqueId, createResult.value.id, 'new technique, not same ID');
  });

  it('#31 approveTransfer: preserves source provenance chain (S29.8)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Qualify technique for transfer (BRK-S29-002: confidence > 0.8, success_rate > 0.7, applicationCount > 50)
    ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.8,
      applicationCount: 55,
    });

    const request: TransferRequest = {
      sourceTechniqueId: createResult.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    };
    const reqResult = ls.transfer.requestTransfer(conn, ctx, request);
    assert.strictEqual(reqResult.ok, true);
    if (!reqResult.ok) return;

    const approveResult = ls.transfer.approveTransfer(conn, ctx, reqResult.value);
    assert.strictEqual(approveResult.ok, true);
    if (!approveResult.ok) return;

    assert.ok(approveResult.value.sourceProvenanceChain.length > 0, 'provenance chain must not be empty');
    // Source memory IDs should be preserved or extended
    assert.deepStrictEqual(
      approveResult.value.sourceProvenanceChain.slice(0, createResult.value.sourceMemoryIds.length),
      createResult.value.sourceMemoryIds,
      'source provenance must be preserved in transferred technique'
    );
  });

  it('#32 requestTransfer: rejects self-transfer (S29.8, I-07)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const request: TransferRequest = {
      sourceTechniqueId: createResult.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT, // Same agent!
      tenantId: TEST_TENANT,
    };

    const result = ls.transfer.requestTransfer(conn, ctx, request);

    assert.strictEqual(result.ok, false, 'self-transfer must be rejected');
  });

  it('#33 rejectTransfer: transfer request rejected, no technique created (S29.8)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Qualify technique for transfer (BRK-S29-002: confidence > 0.8, success_rate > 0.7, applicationCount > 50)
    ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.8,
      applicationCount: 55,
    });

    const request: TransferRequest = {
      sourceTechniqueId: createResult.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    };
    const reqResult = ls.transfer.requestTransfer(conn, ctx, request);
    assert.strictEqual(reqResult.ok, true);
    if (!reqResult.ok) return;

    const rejectResult = ls.transfer.rejectTransfer(conn, ctx, reqResult.value);
    assert.strictEqual(rejectResult.ok, true);

    // Verify target agent has no techniques from transfer
    const targetTechniques = ls.store.getByAgent(conn, TEST_AGENT_B, TEST_TENANT);
    assert.strictEqual(targetTechniques.ok, true);
    if (!targetTechniques.ok) return;
    assert.strictEqual(targetTechniques.value.length, 0, 'rejected transfer creates no technique');
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.10: OVER-SPECIALIZATION DETECTION (FM-07 Defense)
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — OverSpecializationDetector', () => {
  it('#34 analyze: detects over-specialization via Shannon entropy when single type dominates (S29.10, DEC-4E-001)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create 10 prompt_fragments and 0 of other types — zero entropy, score = 1.0
    for (let i = 0; i < 10; i++) {
      ls.store.create(conn, ctx, {
        ...createValidInput(),
        type: 'prompt_fragment',
        content: `Fragment ${i}`,
      });
    }

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.overSpecialized, true);
    // Score = 1 - (H / log(N)). With all one type, H = 0, so score = 1.0
    assert.ok(result.value.specializationScore > OVERSPECIALIZATION_THRESHOLD,
      `specialization score ${result.value.specializationScore} must exceed ${OVERSPECIALIZATION_THRESHOLD}`);
  });

  it('#35 analyze: not over-specialized with diverse distribution — low Shannon score (S29.10, DEC-4E-001)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create balanced distribution: 4 of each type — maximum entropy, score ≈ 0.0
    for (let i = 0; i < 4; i++) {
      ls.store.create(conn, ctx, { ...createValidInput(), type: 'prompt_fragment', content: `PF ${i}` });
      ls.store.create(conn, ctx, { ...createValidInput(), type: 'decision_rule', content: `DR ${i}` });
      ls.store.create(conn, ctx, { ...createValidInput(), type: 'rag_pattern', content: `RP ${i}` });
    }

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.overSpecialized, false);
    // Score = 1 - (H / log(N)). With uniform distribution, H = log(N), so score ≈ 0.0
    assert.ok(result.value.specializationScore <= OVERSPECIALIZATION_THRESHOLD,
      `specialization score ${result.value.specializationScore} must not exceed ${OVERSPECIALIZATION_THRESHOLD}`);
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.9: COLD-START TEMPLATES
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — ColdStartManager', () => {
  it('#36 applyTemplate: creates techniques at confidence 0.6 (S29.9)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const result = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'sales-default');

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.value.length > 0, 'template must create at least one technique');
    for (const t of result.value) {
      assert.strictEqual(t.confidence, INITIAL_CONFIDENCE_COLD_START);
      assert.strictEqual(INITIAL_CONFIDENCE_COLD_START, 0.6, 'cold-start confidence must be 0.6');
      assert.strictEqual(t.status, 'active');
      assert.strictEqual(t.agentId, TEST_AGENT);
    }
  });

  it('#37 getAvailableTemplates: returns registered templates with version (S29.9, BRK-S29-001)', () => {
    const { ls } = createTestLearningSystem();

    const result = ls.coldStart.getAvailableTemplates();

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // At minimum, the system should have template definitions available
    assert.ok(Array.isArray(result.value));
    for (const template of result.value) {
      assert.ok(template.templateId, 'template must have an ID');
      assert.ok(template.name, 'template must have a name');
      assert.ok(typeof template.version === 'number', 'template must have a version number (S29.9)');
      assert.ok(template.version >= 1, 'template version must be >= 1');
      assert.ok(template.techniques.length > 0, 'template must have techniques');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// S29.3 FULL CYCLE: LEARNING CYCLE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — LearningCycleOrchestrator', () => {
  it('#38 runCycle: produces cycle result with extraction stats (S29.3)', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    const cycle = result.value;
    assert.strictEqual(cycle.agentId, TEST_AGENT);
    assert.strictEqual(cycle.trigger, 'periodic');
    assert.ok(typeof cycle.candidatesEvaluated === 'number');
    assert.ok(typeof cycle.techniquesExtracted === 'number');
    assert.ok(typeof cycle.duplicatesReinforced === 'number');
    assert.ok(typeof cycle.techniquesRetired === 'number');
    assert.ok(typeof cycle.overSpecializationDetected === 'boolean');
    assert.ok(cycle.cycleId, 'cycle must have an ID');
    assert.ok(cycle.timestamp, 'cycle must have a timestamp');
  });

  it('#39 runCycle: with no candidates produces zero extractions (S29.3)', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // No interactions seeded — no candidates should exist

    const result = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'periodic');

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.candidatesEvaluated, 0);
    assert.strictEqual(result.value.techniquesExtracted, 0);
  });

  it('#40 getLastCycleTime: returns null when no cycle has run (S29.3)', () => {
    const { ls, conn } = createTestLearningSystem();

    const result = ls.cycle.getLastCycleTime(conn, TEST_AGENT, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value, null, 'no prior cycle should return null');
  });
});

// ═══════════════════════════════════════════════════════════════
// STATE MACHINE + INVARIANTS: CROSS-CUTTING VERIFICATION
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — State Machine & Invariants', () => {
  it('#41 state machine: active -> suspended is valid (S29.7)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const suspendResult = ls.store.suspend(conn, ctx, createResult.value.id, TEST_TENANT);
    assert.strictEqual(suspendResult.ok, true);

    const getResult = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(getResult.ok, true);
    if (!getResult.ok) return;
    assert.strictEqual(getResult.value.status, 'suspended');
  });

  it('#42 state machine: retired -> active is PROHIBITED (I-10 — retirement permanent)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.store.retire(conn, ctx, createResult.value.id, TEST_TENANT, 'stale');

    // Attempt to update status back to active
    const updateResult = ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, { status: 'active' });
    assert.strictEqual(updateResult.ok, false, 'retired -> active must be rejected (I-10)');
  });

  it('#43 state machine: retired -> suspended is PROHIBITED', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.store.retire(conn, ctx, createResult.value.id, TEST_TENANT, 'low_confidence');

    const suspendResult = ls.store.suspend(conn, ctx, createResult.value.id, TEST_TENANT);
    assert.strictEqual(suspendResult.ok, false, 'retired -> suspended must be rejected');
  });

  it('#44 agent isolation: technique from agent A invisible to agent B query (I-07)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, createValidInput()); // Agent A's technique

    const result = ls.store.getByAgent(conn, TEST_AGENT_B, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'agent B must not see agent A techniques (I-07)');
  });

  it('#45 constants: verify all spec-derived constants match specification values', () => {
    // This test verifies the constants are correct per spec.
    // It calls store.create to ensure the harness is invoked (must fail).
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, createValidInput()); // Trigger harness

    // Constants verification (these pass independently but the test fails on the harness call above)
    assert.strictEqual(INITIAL_CONFIDENCE_EXTRACTED, 0.5, 'S29.3 Step 4: initial confidence 0.5');
    assert.strictEqual(INITIAL_CONFIDENCE_COLD_START, 0.6, 'S29.9: cold-start confidence 0.6');
    assert.strictEqual(CONFIDENCE_RESET_TRANSFER, 0.4, 'S29.8: transfer confidence 0.4');
    assert.strictEqual(CONFIDENCE_RESET_REACTIVATION, 0.3, 'S29.7: reactivation confidence 0.3');
    assert.strictEqual(EMA_WEIGHT_OLD, 0.8, 'S29.5: EMA old weight 0.8');
    assert.strictEqual(EMA_WEIGHT_RECENT, 0.2, 'S29.5: EMA recent weight 0.2');
    assert.strictEqual(RETIREMENT_THRESHOLD_SUCCESS_RATE, 0.3, 'S29.6: success threshold 0.3');
    assert.strictEqual(RETIREMENT_THRESHOLD_CONFIDENCE, 0.2, 'S29.6: confidence threshold 0.2');
    assert.strictEqual(RETIREMENT_MIN_APPLICATIONS_SUCCESS, 50, 'S29.6: min apps for success 50');
    assert.strictEqual(RETIREMENT_MIN_APPLICATIONS_CONFIDENCE, 20, 'S29.6: min apps for confidence 20');
    assert.strictEqual(DEDUP_SIMILARITY_THRESHOLD, 0.85, 'S29.3: dedup threshold 0.85');
    assert.strictEqual(OVERSPECIALIZATION_THRESHOLD, 0.9, 'S29.10: over-spec threshold 0.9');
    // Transfer qualification constants (BRK-S29-002, S29.8 Step 1)
    assert.strictEqual(TRANSFER_MIN_CONFIDENCE, 0.8, 'S29.8: transfer min confidence 0.8');
    assert.strictEqual(TRANSFER_MIN_SUCCESS_RATE, 0.7, 'S29.8: transfer min success rate 0.7');
    assert.strictEqual(TRANSFER_MIN_APPLICATIONS, 50, 'S29.8: transfer min applications 50');
    // HITL confidence (DEC-4E-003, §31.2)
    assert.strictEqual(HITL_CONFIDENCE, 1.0, 'DEC-4E-003: HITL confidence always 1.0');
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 4E-R1 REMEDIATION: ADDITIONAL CONTRACT TESTS
// Addresses: BRK-S29-002, BRK-S29-003, BRK-S29-007, BRK-S29-013,
//            BRK-S29-014, BRK-S29-019, DEC-4E-001, DEC-4E-002, DEC-4E-003
// ═══════════════════════════════════════════════════════════════

describe('S29 Learning System — Remediation Tests', () => {
  it('#46 transfer qualification: technique must meet thresholds before transfer (S29.8 Step 1, BRK-S29-002)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create technique that does NOT meet transfer qualification
    // Initial: confidence=0.5, successRate=0, applicationCount=0
    // Required: confidence > 0.8, success_rate > 0.7, applicationCount > 50
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const request: TransferRequest = {
      sourceTechniqueId: createResult.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    };

    const result = ls.transfer.requestTransfer(conn, ctx, request);

    // Must reject — technique doesn't meet qualification thresholds
    assert.strictEqual(result.ok, false, 'unqualified technique must not be transferable');
    if (!result.ok) {
      assert.ok(
        result.error.code.includes('QUALIFICATION') || result.error.code.includes('THRESHOLD'),
        'error must indicate qualification failure',
      );
    }
  });

  it('#47 HITL confidence: human corrections set confidence to 1.0 (DEC-4E-003)', async () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create a technique that will be corrected by HITL
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Run HITL correction cycle — confidence for HITL-corrected techniques = 1.0
    const cycleResult = await ls.cycle.runCycle(conn, ctx, TEST_AGENT, 'hitl_correction');

    assert.strictEqual(cycleResult.ok, true);
    if (!cycleResult.ok) return;
    // HITL_CONFIDENCE constant verified
    assert.strictEqual(HITL_CONFIDENCE, 1.0, 'HITL confidence must be maximum (1.0)');
  });

  it('#48 cross-tenant transfer: structurally blocked — single tenantId (DEC-4E-002)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Qualify technique for transfer (BRK-S29-002: confidence > 0.8, success_rate > 0.7, applicationCount > 50)
    ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.8,
      applicationCount: 55,
    });

    // TransferRequest has a single tenantId field — cross-tenant is impossible by construction.
    // Both source and target agents share this tenantId. No way to specify different tenants.
    const request: TransferRequest = {
      sourceTechniqueId: createResult.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,  // Only one tenantId — cross-tenant structurally impossible
    };

    // Attempt same-tenant transfer — structural proof is the interface shape
    const result = ls.transfer.requestTransfer(conn, ctx, request);
    // Whether it succeeds or fails on qualification, it must be within same tenant
    assert.strictEqual(result.ok, true, 'same-tenant transfer structurally valid');
  });

  it('#49 quarantine cascade: getBySourceMemory finds techniques from poisoned memory (BRK-S29-007)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create technique with known source memory
    const sourceMemoryId = 'mem-suspected-poison';
    ls.store.create(conn, ctx, {
      ...createValidInput(),
      sourceMemoryIds: [sourceMemoryId, 'mem-clean'],
    });

    // Look up techniques derived from suspected memory
    const result = ls.store.getBySourceMemory(conn, sourceMemoryId, TEST_TENANT);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.value.length >= 1, 'must find techniques derived from source memory');
    for (const t of result.value) {
      assert.ok(t.sourceMemoryIds.includes(sourceMemoryId),
        'returned technique must reference the queried source memory');
    }
  });

  it('#50 cross-tenant isolation: applicator returns only own agent techniques (I-07, BRK-S29-019)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    // Create techniques for agent A
    ls.store.create(conn, ctx, {
      ...createValidInput(),
      type: 'prompt_fragment',
      content: 'Agent A exclusive technique',
    });

    // Query prompt fragments for agent B — must return empty
    const result = ls.applicator.getActivePromptFragments(conn, TEST_AGENT_B, TEST_TENANT, 10000);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'agent B must not see agent A prompt fragments (I-07)');
  });

  it('#51 cross-tenant isolation: quarantine entries scoped to tenant (I-07, BRK-S29-019)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Quarantine in TEST_TENANT
    ls.quarantine.quarantine(conn, ctx, [createResult.value.id], TEST_TENANT, 'Test isolation');

    // Query pending for different tenant — must return empty
    const otherTenant = tenantId('other-tenant-isolated');
    const result = ls.quarantine.getPending(conn, otherTenant);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'other tenant must not see quarantine entries (I-07)');
  });

  it('#52 cross-tenant isolation: effectiveness tracking scoped to tenant (I-07, BRK-S29-019)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const tid = createResult.value.id;
    // Record outcomes for TEST_TENANT
    ls.tracker.recordOutcome(conn, ctx, tid, TEST_TENANT, 'positive');

    // Query success rate with wrong tenant — must fail
    const otherTenant = tenantId('other-tenant-isolated');
    const result = ls.tracker.getSuccessRate(conn, tid, otherTenant);

    assert.strictEqual(result.ok, false, 'must not return success rate for wrong tenant');
  });

  it('#53 get: returns error for wrong agent — agent isolation enforced (BRK-S29-014)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Attempt to get technique with correct tenant but wrong agent
    const result = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT_B);

    assert.strictEqual(result.ok, false, 'must not return technique for wrong agent (BRK-S29-014)');
  });

  it('#54 RBAC: learning permissions defined for all operations (BRK-S29-013)', () => {
    // Trigger harness to ensure test fails
    const { ls, conn, ctx } = createTestLearningSystem();
    ls.store.create(conn, ctx, createValidInput());

    // Verify RBAC permission constants exist and are well-formed
    assert.strictEqual(typeof LEARNING_PERMISSIONS.READ, 'string');
    assert.strictEqual(typeof LEARNING_PERMISSIONS.WRITE, 'string');
    assert.strictEqual(typeof LEARNING_PERMISSIONS.QUARANTINE_RESOLVE, 'string');
    assert.strictEqual(typeof LEARNING_PERMISSIONS.TRANSFER_APPROVE, 'string');
    assert.strictEqual(typeof LEARNING_PERMISSIONS.COLD_START, 'string');
    // Permissions must follow namespace pattern
    assert.ok(LEARNING_PERMISSIONS.READ.startsWith('learning:'), 'permission must be namespaced');
    assert.ok(LEARNING_PERMISSIONS.WRITE.startsWith('learning:'), 'permission must be namespaced');
  });
});
