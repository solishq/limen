/**
 * Phase 2B Pipeline-Level Integration Tests: TGP ↔ ChatPipeline Call-Site Wiring
 * Findings: BPB-CROSS-01, BPB-TGP-01, BPB-TGP-02, BPB-TGP-03
 *
 * These tests exercise the CHAT PIPELINE with a real TechniqueReader, verifying
 * that the pipeline's injectTechniques() call site is wired correctly and
 * technique content flows end-to-end through to the LLM request and metadata.
 *
 * Unlike test_integration_tgp_pipeline.test.ts (which tests injectTechniques()
 * in isolation), these tests call ChatPipeline.execute() and verify:
 *   - injectTechniques() is called (BPB-TGP-01: M10 survival fix)
 *   - Technique content reaches LLM systemPrompt (BPB-TGP-02: M11 survival fix)
 *   - techniquesApplied metadata > 0 (BPB-TGP-03: M12 survival fix)
 *   - techniqueTokenCost flows to metadata (BPB-CROSS-01: cross-wire fix)
 *
 * Amendment 22: Call-site wiring verification at the pipeline integration level.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ChatPipeline } from '../../src/api/chat/chat_pipeline.js';
import type { TechniqueReader, TechniqueInjectionResult } from '../../src/api/chat/technique_injector.js';
import { estimateTokens } from '../../src/learning/applicator/technique_applicator.js';
import { createTechniqueApplicator } from '../../src/learning/applicator/technique_applicator.js';
import { createTechniqueStore } from '../../src/learning/store/technique_store.js';
import { MAX_CONTEXT_WINDOW_RATIO } from '../../src/learning/interfaces/index.js';

import { createTestDatabase, createTestAuditTrail } from '../helpers/test_database.js';
import type {
  DatabaseConnection, RbacEngine, RateLimiter, Permission,
  TenantId, AgentId, AuditTrail,
} from '../../src/kernel/interfaces/index.js';
import type { LlmGateway, LlmRequest, LlmStreamChunk, Substrate } from '../../src/substrate/interfaces/substrate.js';
import type { OrchestrationEngine } from '../../src/orchestration/interfaces/orchestration.js';
import type { SessionState } from '../../src/api/sessions/session_manager.js';
import type { BackpressureConfig, StreamChunk } from '../../src/api/interfaces/api.js';
import type { LearningDeps } from '../../src/learning/interfaces/index.js';
import type { EventBus } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Constants
// ============================================================================

const TEST_TENANT = 'tenant-pipeline-tgp' as TenantId;
const TEST_AGENT = 'agent-pipeline-tgp' as AgentId;
const MODEL_CONTEXT_WINDOW = 100_000;

// ============================================================================
// Mock Factories
// ============================================================================

function createMockRbac(): RbacEngine {
  return {
    checkPermission: () => ({ ok: true, value: true }),
  } as unknown as RbacEngine;
}

function createMockRateLimiter(): RateLimiter {
  return {
    checkAndConsume: () => ({ ok: true, value: true }),
    getStatus: () => ({ ok: true, value: { refillRate: 100, maxTokens: 100, currentTokens: 100 } }),
  } as unknown as RateLimiter;
}

function createMockOrchestration(): OrchestrationEngine {
  return {
    conversations: {
      appendTurn: () => ({ ok: true, value: 1 }),
    },
  } as unknown as OrchestrationEngine;
}

/**
 * Capturing LLM gateway — records the LlmRequest so tests can verify
 * that technique content reached the systemPrompt field.
 */
function createCapturingGateway(chunks: LlmStreamChunk[]): {
  gateway: LlmGateway;
  getCapturedRequest: () => LlmRequest | null;
} {
  let capturedRequest: LlmRequest | null = null;

  const gateway = {
    request: async () => ({ ok: false, error: { code: 'NOT_IMPL', message: 'N/A', spec: 'N/A' } }),
    requestStream: async (_conn: unknown, _ctx: unknown, request: LlmRequest) => {
      capturedRequest = request;
      return {
        ok: true as const,
        value: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      };
    },
    registerProvider: () => ({ ok: true, value: undefined }),
    getProviderHealth: () => ({ ok: true, value: [] }),
    hasHealthyProvider: () => ({ ok: true, value: true }),
    checkFailoverBudget: () => ({ ok: true, value: { allowed: true } }),
  } as unknown as LlmGateway;

  return { gateway, getCapturedRequest: () => capturedRequest };
}

function createTestSessionState(): SessionState {
  return {
    sessionId: 'test-session-tgp' as any,
    tenantId: TEST_TENANT,
    agentId: TEST_AGENT,
    conversationId: 'test-conv-tgp',
    userId: null,
    permissions: new Set<Permission>(['chat']),
    hitlMode: null,
    createdAt: Date.now(),
    activeStreams: new Set<string>(),
  };
}

function defaultStreamChunks(): LlmStreamChunk[] {
  return [
    { type: 'content_delta', delta: 'Hello from LLM' },
    { type: 'usage', inputTokens: 50, outputTokens: 15 },
    { type: 'done', finishReason: 'stop' },
  ];
}

// ============================================================================
// Seed Helper
// ============================================================================

function seedTechnique(conn: DatabaseConnection, opts: {
  id: string;
  tenantId?: string;
  agentId?: string;
  type?: string;
  content?: string;
  confidence?: number;
  status?: string;
}): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO learning_techniques
      (id, tenant_id, agent_id, type, content, source_memory_ids,
       confidence, success_rate, application_count, last_applied,
       last_updated, status, created_at, provenance_kind,
       quarantined_at, promoted_at, promotion_decision_id,
       transfer_source_technique_id, retired_at, retired_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.tenantId ?? TEST_TENANT,
      opts.agentId ?? TEST_AGENT,
      opts.type ?? 'prompt_fragment',
      opts.content ?? `Technique content for ${opts.id}`,
      JSON.stringify(['memory-default']),
      opts.confidence ?? 0.8,
      null, 0, null, now,
      opts.status ?? 'active',
      now, 'local_extraction',
      null, null, null, null, null, null,
    ],
  );
}

/**
 * Create a real TechniqueReader backed by TechniqueApplicator + TechniqueStore.
 */
function createRealTechniqueReader(conn: DatabaseConnection): TechniqueReader {
  const deps: LearningDeps = {
    getConnection: () => conn,
    audit: { append: () => ({ ok: true as const, value: undefined }) } as unknown as AuditTrail,
    events: { emit: () => {} } as unknown as EventBus,
    rbac: {} as unknown as RbacEngine,
    rateLimiter: {} as unknown as RateLimiter,
    gateway: {} as unknown as LlmGateway,
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
  const store = createTechniqueStore(deps);
  return createTechniqueApplicator(deps, store);
}

// ============================================================================
// Pipeline Factory
// ============================================================================

function createTestPipeline(
  gateway: LlmGateway,
  conn: DatabaseConnection,
  techniqueReader?: TechniqueReader,
): { pipeline: ChatPipeline; session: SessionState } {
  const audit = createTestAuditTrail();
  const pipeline = new ChatPipeline(
    createMockRbac(),
    createMockRateLimiter(),
    createMockOrchestration(),
    gateway,
    () => conn,
    () => audit,
    () => ({} as unknown as Substrate),
    60000,
    { bufferSizeBytes: 4096, stallTimeoutMs: 30000, maxConcurrentStreams: 50 },
    'test-model',
    techniqueReader,
    MODEL_CONTEXT_WINDOW,
  );
  return { pipeline, session: createTestSessionState() };
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 2B: TGP ↔ ChatPipeline Call-Site Wiring', () => {
  let conn: DatabaseConnection;
  let reader: TechniqueReader;

  beforeEach(() => {
    conn = createTestDatabase();
    reader = createRealTechniqueReader(conn);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-TGP-01: injectTechniques() call site exercised (M10 killed)
  // Removing lines 348-356 of chat_pipeline.ts must cause this test to fail.
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-01: Pipeline calls injectTechniques() — systemPrompt populated [BPB-TGP-01]', async () => {
    const content = 'Always respond concisely when the user asks a direct question.';
    seedTechnique(conn, {
      id: 'tech-pipe-01',
      content,
      confidence: 0.9,
      status: 'active',
    });

    const { gateway, getCapturedRequest } = createCapturingGateway(defaultStreamChunks());
    const { pipeline, session } = createTestPipeline(gateway, conn, reader);

    const result = pipeline.execute(session, 'Hello');

    // Consume stream to drive pipeline execution
    for await (const chunk of result.stream) {
      // drain
    }

    // BPB-TGP-01: injectTechniques() call site must be wired — request must exist
    const captured = getCapturedRequest();
    assert.notStrictEqual(captured, null,
      'LLM request must have been captured');

    // If injectTechniques() call is removed, systemPrompt will be absent
    assert.ok(captured!.systemPrompt !== undefined && captured!.systemPrompt!.length > 0,
      'BPB-TGP-01: systemPrompt must be populated when techniques are active — removing injectTechniques() call must fail this');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-TGP-02: Technique content reaches LLM systemPrompt (M11 killed)
  // Removing technique content from the LLM request must cause this test to fail.
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-02: Technique content appears verbatim in LLM systemPrompt [BPB-TGP-02, I-94]', async () => {
    const content = 'Use bullet points for lists. Number steps sequentially.';
    seedTechnique(conn, {
      id: 'tech-pipe-02',
      content,
      confidence: 0.85,
      status: 'active',
    });

    const { gateway, getCapturedRequest } = createCapturingGateway(defaultStreamChunks());
    const { pipeline, session } = createTestPipeline(gateway, conn, reader);

    const result = pipeline.execute(session, 'Hello');
    for await (const chunk of result.stream) { /* drain */ }

    const captured = getCapturedRequest();
    assert.notStrictEqual(captured, null);

    // BPB-TGP-02: technique content must be in the systemPrompt field
    assert.ok(captured!.systemPrompt!.includes(content),
      'BPB-TGP-02: Technique content must appear verbatim in systemPrompt (I-94) — removing systemPrompt assignment must fail this');
    assert.ok(captured!.systemPrompt!.includes('LEARNED_TECHNIQUES'),
      'System prompt must contain technique section delimiters');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-TGP-03: techniquesApplied metadata field (M12 killed)
  // Zeroing techniquesApplied must cause this test to fail.
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-03: techniquesApplied > 0 in metadata when techniques injected [BPB-TGP-03]', async () => {
    seedTechnique(conn, {
      id: 'tech-pipe-03',
      content: 'Always explain your reasoning.',
      confidence: 0.8,
      status: 'active',
    });

    const { gateway } = createCapturingGateway(defaultStreamChunks());
    const { pipeline, session } = createTestPipeline(gateway, conn, reader);

    const result = pipeline.execute(session, 'Hello');
    for await (const chunk of result.stream) { /* drain */ }

    const metadata = await result.metadata;

    assert.strictEqual(metadata.techniquesApplied, 1,
      'BPB-TGP-03: techniquesApplied must reflect injected count — zeroing it must fail this');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-CROSS-01: techniqueTokenCost flows to metadata (cross-wire gap)
  // I-54: Technique cost must be surfaced for ECB accounting.
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-04: techniqueTokenCost > 0 in metadata when techniques injected [BPB-CROSS-01, I-54]', async () => {
    const content = 'Respond with empathy when the user expresses frustration or confusion.';
    seedTechnique(conn, {
      id: 'tech-pipe-04',
      content,
      confidence: 0.9,
      status: 'active',
    });

    const { gateway } = createCapturingGateway(defaultStreamChunks());
    const { pipeline, session } = createTestPipeline(gateway, conn, reader);

    const result = pipeline.execute(session, 'Hello');
    for await (const chunk of result.stream) { /* drain */ }

    const metadata = await result.metadata;
    const expectedCost = estimateTokens(content);

    assert.strictEqual(metadata.techniqueTokenCost, expectedCost,
      'BPB-CROSS-01: techniqueTokenCost must equal estimateTokens() of injected content');
    assert.ok(metadata.techniqueTokenCost > 0,
      'I-54: Technique token cost must be non-zero when techniques are active');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-CROSS-01 rejection: no techniques = zero cost
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-05: techniqueTokenCost = 0 when no techniques [BPB-CROSS-01 rejection]', async () => {
    // No techniques seeded — pipeline should have zero technique cost
    const { gateway } = createCapturingGateway(defaultStreamChunks());
    const { pipeline, session } = createTestPipeline(gateway, conn, reader);

    const result = pipeline.execute(session, 'Hello');
    for await (const chunk of result.stream) { /* drain */ }

    const metadata = await result.metadata;

    assert.strictEqual(metadata.techniqueTokenCost, 0,
      'No techniques = zero technique token cost');
    assert.strictEqual(metadata.techniquesApplied, 0,
      'No techniques = zero count');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-TGP-01 rejection: no techniqueReader = no systemPrompt
  // Pipeline without techniqueReader should NOT set systemPrompt.
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-06: No techniqueReader = no systemPrompt [BPB-TGP-01 rejection]', async () => {
    seedTechnique(conn, {
      id: 'tech-pipe-06',
      content: 'This should NOT appear.',
      confidence: 0.9,
      status: 'active',
    });

    const { gateway, getCapturedRequest } = createCapturingGateway(defaultStreamChunks());
    // No techniqueReader passed to pipeline
    const { pipeline, session } = createTestPipeline(gateway, conn, undefined);

    const result = pipeline.execute(session, 'Hello');
    for await (const chunk of result.stream) { /* drain */ }

    const captured = getCapturedRequest();
    assert.notStrictEqual(captured, null);

    // Without techniqueReader, systemPrompt should not be set
    assert.strictEqual(captured!.systemPrompt, undefined,
      'Without techniqueReader, LLM request must not have systemPrompt');

    const metadata = await result.metadata;
    assert.strictEqual(metadata.techniquesApplied, 0);
    assert.strictEqual(metadata.techniqueTokenCost, 0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BPB-CROSS-01 discriminative: cost matches overhead breakdown
  // Verify that techniqueTokenCost can be used to construct SystemOverheadBreakdown.
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-PIPE-TGP-07: techniqueTokenCost compatible with SystemOverheadBreakdown [BPB-CROSS-01, I-63]', async () => {
    const content = 'Apply structured debugging: hypothesis → test → verify → iterate.';
    seedTechnique(conn, {
      id: 'tech-pipe-07',
      content,
      confidence: 0.95,
      status: 'active',
    });

    const { gateway } = createCapturingGateway(defaultStreamChunks());
    const { pipeline, session } = createTestPipeline(gateway, conn, reader);

    const result = pipeline.execute(session, 'Hello');
    for await (const chunk of result.stream) { /* drain */ }

    const metadata = await result.metadata;

    // Construct SystemOverheadBreakdown from metadata — this is what ECB would use
    const fixedPipeline = 500; // hypothetical fixed cost
    const breakdown = {
      fixedPipeline,
      activeTechniques: metadata.techniqueTokenCost,
      total: fixedPipeline + metadata.techniqueTokenCost,
    };

    assert.strictEqual(breakdown.activeTechniques, estimateTokens(content),
      'I-54: breakdown.activeTechniques must equal actual technique token cost');
    assert.strictEqual(breakdown.total, fixedPipeline + estimateTokens(content),
      'I-54: Total overhead = fixed + technique cost');

    // ECB reduction: with techniques, ECB is smaller than without
    const ecbWithout = MODEL_CONTEXT_WINDOW - fixedPipeline;
    const ecbWith = MODEL_CONTEXT_WINDOW - breakdown.total;
    assert.ok(ecbWith < ecbWithout,
      'I-54: ECB with techniques < ECB without — technique cost is visible to budget system');
  });
});
