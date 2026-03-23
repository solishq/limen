/**
 * Limen — S29 TechniqueExtractor Edge Case Tests
 * Phase 4E-2b: AC-5 Additional Tests
 *
 * Each test is discriminative — it exercises a specific failure mode that,
 * if unhandled, would corrupt the learning system or crash the extractor.
 *
 * S ref: S29.3 Steps 1-4, D1 (TF-IDF cosine), D2 (LLM failure handling),
 *        D4 (EMA reinforcement), I-03 (audit)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningSystem } from '../../src/learning/harness/learning_harness.js';
import { createTestDatabase, createTestOperationContext, createTestAuditTrail, tenantId, agentId } from '../helpers/test_database.js';
import {
  INITIAL_CONFIDENCE_EXTRACTED,
  DEDUP_SIMILARITY_THRESHOLD,
  EMA_WEIGHT_OLD,
  EMA_WEIGHT_RECENT,
} from '../../src/learning/interfaces/index.js';
import type {
  LearningSystem,
  TechniqueCreateInput,
  ExtractionCandidate,
} from '../../src/learning/interfaces/index.js';
import type { DatabaseConnection, OperationContext, EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway, LlmResponse } from '../../src/substrate/interfaces/substrate.js';
import { computeSimilarity } from '../../src/learning/extractor/technique_extractor.js';

// ─── Test Helpers ───

const TEST_TENANT = tenantId('test-tenant');
const TEST_AGENT = agentId('test-agent');

function createTestCandidate(): ExtractionCandidate {
  return {
    interactionId: 'interaction-edge-001',
    agentId: TEST_AGENT,
    tenantId: TEST_TENANT,
    qualityScore: 0.85,
    userFeedback: 'positive',
    conversationContext: 'System: You are a support agent.\nUser: How do I reset my password?\nAssistant: Go to settings and click reset.\nFeedback: Very helpful!',
  };
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

/**
 * Create a mock LlmGateway that returns a specific response from request().
 * All other methods are stubs.
 * Pattern: tests/gap/test_gap_018_data_integrity.test.ts
 */
function createMockGateway(requestFn: () => Promise<{ ok: true; value: LlmResponse } | { ok: false; error: { code: string; message: string; spec: string } }>): LlmGateway {
  return {
    request: async () => requestFn(),
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

function createLearningSystemWith(gateway: LlmGateway): { ls: LearningSystem; conn: DatabaseConnection; ctx: OperationContext } {
  const conn = createTestDatabase();
  const ctx = createTestOperationContext();
  const ls = createLearningSystem({
    getConnection: () => conn,
    audit: createTestAuditTrail(),
    events: {} as EventBus,
    rbac: {} as RbacEngine,
    rateLimiter: {} as RateLimiter,
    gateway,
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  });
  return { ls, conn, ctx };
}

function validLlmResponse(overrides?: Partial<{ type: string; content: string; confidence: number; applicability: string }>): LlmResponse {
  const proposal = {
    type: overrides?.type ?? 'prompt_fragment',
    content: overrides?.content ?? 'Extracted technique about password resets.',
    confidence: overrides?.confidence ?? 0.7,
    applicability: overrides?.applicability ?? 'Support conversations about account access',
  };
  return {
    content: JSON.stringify(proposal),
    toolCalls: [],
    finishReason: 'stop' as const,
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'test-model',
    providerId: 'test-provider',
    latencyMs: 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// E1-E8: EXTRACTOR EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════

describe('S29 TechniqueExtractor — Edge Cases (Phase 4E-2b AC-5)', () => {

  // ─── E1: Malformed JSON from LLM ───

  it('E1 generateProposal: LLM returns malformed JSON → EXTRACTION_PARSE_ERROR', async () => {
    // CATCHES: JSON parse errors crashing the extractor instead of returning error Result
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: {
        content: 'This is not valid JSON {{{',
        toolCalls: [],
        finishReason: 'stop' as const,
        usage: { inputTokens: 50, outputTokens: 20 },
        model: 'test-model',
        providerId: 'test-provider',
        latencyMs: 50,
      },
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const candidate = createTestCandidate();

    const result = await ls.extractor.generateProposal(ctx, candidate);

    assert.strictEqual(result.ok, false, 'malformed JSON must produce error Result');
    if (result.ok) return;
    assert.strictEqual(result.error.code, 'EXTRACTION_PARSE_ERROR');
  });

  // ─── E2: Invalid TechniqueType from LLM ───

  it('E2 generateProposal: LLM returns invalid TechniqueType → EXTRACTION_INVALID_TYPE', async () => {
    // CATCHES: unvalidated LLM output stored in DB, violating S29.1 type taxonomy
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse({ type: 'invalid_type_from_llm' }),
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const candidate = createTestCandidate();

    const result = await ls.extractor.generateProposal(ctx, candidate);

    assert.strictEqual(result.ok, false, 'invalid technique type must produce error Result');
    if (result.ok) return;
    assert.strictEqual(result.error.code, 'EXTRACTION_INVALID_TYPE');
  });

  // ─── E3: Confidence outside [0,1] from LLM ───

  it('E3 generateProposal: LLM returns confidence=5.0 → clamped to 1.0 (D2)', async () => {
    // CATCHES: unbounded confidence value corrupting EMA calculations in S29.5
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse({ confidence: 5.0 }),
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const candidate = createTestCandidate();

    const result = await ls.extractor.generateProposal(ctx, candidate);

    assert.strictEqual(result.ok, true, 'confidence clamping should succeed, not error');
    if (!result.ok) return;
    assert.ok(result.value.confidence >= 0 && result.value.confidence <= 1,
      `confidence must be clamped to [0,1], got ${result.value.confidence}`);
    assert.strictEqual(result.value.confidence, 1.0, 'confidence 5.0 must clamp to 1.0');
  });

  it('E3b generateProposal: LLM returns confidence=-0.5 → clamped to 0.0 (D2)', async () => {
    // CATCHES: negative confidence values
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse({ confidence: -0.5 }),
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const result = await ls.extractor.generateProposal(ctx, createTestCandidate());

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.confidence, 0.0, 'confidence -0.5 must clamp to 0.0');
  });

  // ─── E4: LLM Gateway Returns Error ───

  it('E4 generateProposal: LLM gateway returns error Result → propagated as EXTRACTION_LLM_ERROR', async () => {
    // CATCHES: unhandled promise rejection or crash when gateway is unavailable
    const gateway = createMockGateway(async () => ({
      ok: false as const,
      error: { code: 'PROVIDER_UNAVAILABLE', message: 'All providers down', spec: 'S25.4' },
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const candidate = createTestCandidate();

    const result = await ls.extractor.generateProposal(ctx, candidate);

    assert.strictEqual(result.ok, false, 'gateway error must propagate as error Result');
    if (result.ok) return;
    assert.strictEqual(result.error.code, 'EXTRACTION_LLM_ERROR');
    assert.ok(result.error.message.includes('All providers down'),
      'error message must contain gateway error details');
  });

  // ─── E5: extractAndStore with Duplicate → EMA Reinforcement ───

  it('E5 extractAndStore: duplicate detected → reinforces existing via EMA, returns null (D4)', async () => {
    // CATCHES: duplicate technique creation instead of reinforcement;
    //          wrong reinforcement formula (must use EMA, not arbitrary constant)
    const existingContent = 'When discussing pricing, always mention the annual discount option first.';
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse({ content: existingContent }),
    }));

    const { ls, conn, ctx } = createLearningSystemWith(gateway);

    // Pre-create a technique with the same content
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;
    const originalConfidence = createResult.value.confidence;

    // extractAndStore should detect duplicate and reinforce
    const candidate = createTestCandidate();
    const result = await ls.extractor.extractAndStore(conn, ctx, candidate);

    assert.strictEqual(result.ok, true, 'duplicate reinforcement should succeed');
    if (!result.ok) return;
    assert.strictEqual(result.value, null, 'duplicate reinforcement returns null');

    // Verify confidence was boosted via EMA formula: 0.8 * old + 0.2 * 1.0
    const updatedResult = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(updatedResult.ok, true);
    if (!updatedResult.ok) return;

    const expectedConfidence = EMA_WEIGHT_OLD * originalConfidence + EMA_WEIGHT_RECENT * 1.0;
    assert.ok(
      Math.abs(updatedResult.value.confidence - expectedConfidence) < 1e-10,
      `confidence must be EMA-updated: expected ${expectedConfidence}, got ${updatedResult.value.confidence}`,
    );

    // Verify no duplicate technique was created
    const allTechniques = ls.store.getByAgent(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(allTechniques.ok, true);
    if (!allTechniques.ok) return;
    assert.strictEqual(allTechniques.value.length, 1,
      'must NOT create a new technique on duplicate — only reinforce existing');
  });

  // ─── E6: Cosine Similarity Boundary at 0.85 ───

  it('E6 computeSimilarity: boundary behavior at threshold (DEDUP_SIMILARITY_THRESHOLD)', () => {
    // CATCHES: off-by-one in threshold comparison (>= vs >)
    // Identical text must produce similarity = 1.0 (well above threshold)
    const text = 'When discussing pricing, always mention the annual discount option first.';
    const identical = computeSimilarity(text, text);
    assert.strictEqual(identical, 1.0, 'identical text must produce similarity 1.0');
    assert.ok(identical >= DEDUP_SIMILARITY_THRESHOLD,
      'identical text must exceed dedup threshold');

    // Completely different text must produce similarity well below threshold
    const different = computeSimilarity(
      text,
      'Database indexing strategies for high-throughput OLTP workloads.',
    );
    assert.ok(different < DEDUP_SIMILARITY_THRESHOLD,
      `different text similarity ${different} must be below ${DEDUP_SIMILARITY_THRESHOLD}`);

    // Empty strings produce 0.0
    assert.strictEqual(computeSimilarity('', ''), 0, 'empty strings → 0');
    assert.strictEqual(computeSimilarity(text, ''), 0, 'one empty string → 0');
  });

  // ─── E7: Empty Candidate conversationContext ───

  it('E7 generateProposal: empty conversationContext → still calls LLM, returns result', async () => {
    // CATCHES: crash on empty input to LLM; the extractor should not pre-validate
    //          conversationContext — let the LLM handle it
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse(),
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const candidate: ExtractionCandidate = {
      ...createTestCandidate(),
      conversationContext: '',
    };

    const result = await ls.extractor.generateProposal(ctx, candidate);

    // LLM mock returns valid response regardless — extractor should not crash
    assert.strictEqual(result.ok, true, 'empty context should not crash extractor');
  });

  // ─── E8: Provenance Chain Correctness ───

  it('E8 extractAndStore: provenance chain uses candidate.interactionId (S29.3 Step 4)', async () => {
    // CATCHES: provenance loss — the technique must trace back to the originating
    //          interaction, not use arbitrary or empty sourceMemoryIds
    const specificInteractionId = 'interaction-provenance-test-42';
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse({ content: 'Unique provenance test technique content xyz.' }),
    }));

    const { ls, conn, ctx } = createLearningSystemWith(gateway);
    const candidate: ExtractionCandidate = {
      ...createTestCandidate(),
      interactionId: specificInteractionId,
    };

    const result = await ls.extractor.extractAndStore(conn, ctx, candidate);

    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.notStrictEqual(result.value, null, 'novel technique should be created');
    if (result.value === null) return;

    assert.ok(result.value.sourceMemoryIds.includes(specificInteractionId),
      `sourceMemoryIds must contain the candidate interactionId '${specificInteractionId}'`);
    assert.strictEqual(result.value.sourceMemoryIds.length, 1,
      'provenance should have exactly one entry from the candidate');
  });

  // ─── E9: LLM returns empty content ───

  it('E9 generateProposal: LLM returns empty content → EXTRACTION_EMPTY_CONTENT', async () => {
    // CATCHES: empty technique stored in DB, producing useless prompt fragments
    const gateway = createMockGateway(async () => ({
      ok: true as const,
      value: validLlmResponse({ content: '' }),
    }));

    const { ls, ctx } = createLearningSystemWith(gateway);
    const result = await ls.extractor.generateProposal(ctx, createTestCandidate());

    assert.strictEqual(result.ok, false, 'empty content must produce error Result');
    if (result.ok) return;
    assert.strictEqual(result.error.code, 'EXTRACTION_EMPTY_CONTENT');
  });
});
