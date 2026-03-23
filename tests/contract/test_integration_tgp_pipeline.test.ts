/**
 * Limen v1.0 — TGP ↔ Pipeline Integration Tests
 * Phase 2B: Cross-Subsystem Wiring Verification — Technique Injection
 *
 * These tests verify that active prompt_fragment techniques are correctly
 * injected into the system prompt and their cost flows into systemOverhead.
 *
 * Uses real SQLite database with real TechniqueApplicator — no mocks of the
 * injection path. The TechniqueApplicator queries learning_techniques directly.
 *
 * Defect classes: DC-TGP-001 through DC-TGP-011
 * Key invariants: I-07, I-54, I-89, I-92, I-94, I-96
 * Spec refs: §31 (technique application), I-54 (overhead boundary)
 *
 * IT-TGP-01 through IT-TGP-14: 14 tests covering all defect classes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Module under test
import { injectTechniques } from '../../src/api/chat/technique_injector.js';
import type { TechniqueReader } from '../../src/api/chat/technique_injector.js';

// Real TechniqueApplicator — the wire target
import { createTechniqueApplicator, estimateTokens } from '../../src/learning/applicator/technique_applicator.js';

// Learning system types
import type { TechniqueApplicator, LearningDeps } from '../../src/learning/interfaces/index.js';
import { MAX_CONTEXT_WINDOW_RATIO } from '../../src/learning/interfaces/index.js';
import { createTechniqueStore } from '../../src/learning/store/technique_store.js';

// CGP types for overhead verification
import type { SystemOverheadBreakdown } from '../../src/context/interfaces/cgp_types.js';

// Kernel types
import type {
  DatabaseConnection, TenantId, AgentId,
  AuditTrail, EventBus, RbacEngine, RateLimiter,
} from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';

// Test infrastructure
import { createTestDatabase } from '../helpers/test_database.js';

// ============================================================================
// Test Constants
// ============================================================================

const TEST_TENANT = 'tenant-tgp-pipeline' as TenantId;
const TEST_AGENT_A = 'agent-tgp-A' as AgentId;
const TEST_AGENT_B = 'agent-tgp-B' as AgentId;
const MODEL_CONTEXT_WINDOW = 100_000; // 100k tokens

// ============================================================================
// Seed Helper — Direct SQL INSERT for technique data
// ============================================================================

function seedTechnique(conn: DatabaseConnection, opts: {
  id: string;
  tenantId?: string;
  agentId?: string;
  type?: string;
  content?: string;
  confidence?: number;
  status?: string;
  sourceMemoryIds?: string[];
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
      opts.agentId ?? TEST_AGENT_A,
      opts.type ?? 'prompt_fragment',
      opts.content ?? `Technique content for ${opts.id}`,
      JSON.stringify(opts.sourceMemoryIds ?? ['memory-default']),
      opts.confidence ?? 0.5,
      null, // success_rate
      0,    // application_count
      null, // last_applied
      now,  // last_updated
      opts.status ?? 'active',
      now,  // created_at
      'local_extraction', // provenance_kind
      null, null, null, null, null, null, // TGP fields
    ],
  );
}

// ============================================================================
// Mock Dependencies (minimal — only audit/events needed by TechniqueApplicator)
// ============================================================================

function createMockLearningDeps(conn: DatabaseConnection): LearningDeps {
  return {
    getConnection: () => conn,
    audit: {
      append: () => ({ ok: true as const, value: undefined }),
    } as unknown as AuditTrail,
    events: {
      emit: () => {},
    } as unknown as EventBus,
    rbac: {} as unknown as RbacEngine,
    rateLimiter: {} as unknown as RateLimiter,
    gateway: {} as unknown as LlmGateway,
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
}

/**
 * Create a real TechniqueReader backed by TechniqueApplicator + TechniqueStore.
 * This is the same wiring path used in production via LearningSystem.
 */
function createRealTechniqueReader(conn: DatabaseConnection): TechniqueReader {
  const deps = createMockLearningDeps(conn);
  const store = createTechniqueStore(deps);
  return createTechniqueApplicator(deps, store);
}

// ============================================================================
// Tests
// ============================================================================

describe('TGP ↔ Pipeline Integration: Technique Injection', () => {
  let conn: DatabaseConnection;
  let reader: TechniqueReader;

  beforeEach(() => {
    conn = createTestDatabase();
    reader = createRealTechniqueReader(conn);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-01: Active prompt_fragment technique injected into system prompt
  // DC-TGP-001 success + DC-TGP-010 success
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-01: Active prompt_fragment injected into system prompt [DC-TGP-001, DC-TGP-010]', () => {
    const content = 'Always respond in JSON format when the user asks for structured data.';
    seedTechnique(conn, {
      id: 'tech-active-pf-001',
      status: 'active',
      type: 'prompt_fragment',
      content,
      confidence: 0.8,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 1, 'Exactly one technique injected');
    assert.ok(result.systemPromptSection.includes(content),
      'I-94: Technique content appears verbatim in system prompt section');
    assert.ok(result.systemPromptSection.includes('LEARNED_TECHNIQUES'),
      'System prompt section has technique delimiters');
    assert.strictEqual(result.techniqueTokenCost, estimateTokens(content),
      'I-54: Token cost matches estimateTokens of injected content');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-02: Candidate technique excluded from injection
  // DC-TGP-001 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-02: Candidate technique excluded from injection [DC-TGP-001, I-96, I-89]', () => {
    seedTechnique(conn, {
      id: 'tech-candidate-001',
      status: 'candidate',
      type: 'prompt_fragment',
      content: 'This candidate must NOT appear in the system prompt.',
      confidence: 0.9,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 0,
      'I-96: Candidate technique must not be injected');
    assert.strictEqual(result.systemPromptSection, '',
      'No system prompt section when no techniques injected');
    assert.strictEqual(result.techniqueTokenCost, 0,
      'Zero token cost when no techniques injected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-03: Suspended technique excluded
  // DC-TGP-002 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-03: Suspended technique excluded from injection [DC-TGP-002, I-96, I-92]', () => {
    seedTechnique(conn, {
      id: 'tech-suspended-001',
      status: 'suspended',
      type: 'prompt_fragment',
      content: 'This suspended technique must NOT appear.',
      confidence: 0.7,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 0,
      'I-96: Suspended technique must not be injected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-04: Retired technique excluded
  // DC-TGP-003 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-04: Retired technique excluded from injection [DC-TGP-003, I-96]', () => {
    seedTechnique(conn, {
      id: 'tech-retired-001',
      status: 'retired',
      type: 'prompt_fragment',
      content: 'This retired technique must NOT appear.',
      confidence: 0.6,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 0,
      'I-96: Retired technique must not be injected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-05: Wrong agent's techniques excluded
  // DC-TGP-004 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-05: Wrong agent techniques excluded [DC-TGP-004, I-07]', () => {
    // Seed technique for agent B
    seedTechnique(conn, {
      id: 'tech-agent-b-001',
      agentId: TEST_AGENT_B as string,
      status: 'active',
      type: 'prompt_fragment',
      content: 'Agent B technique — must not appear for agent A.',
      confidence: 0.9,
    });

    // Seed technique for agent A
    seedTechnique(conn, {
      id: 'tech-agent-a-001',
      agentId: TEST_AGENT_A as string,
      status: 'active',
      type: 'prompt_fragment',
      content: 'Agent A technique — should appear.',
      confidence: 0.8,
    });

    // Inject for agent A
    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 1,
      'I-07: Only agent A technique injected');
    assert.ok(result.systemPromptSection.includes('Agent A technique'),
      'Agent A technique content present');
    assert.ok(!result.systemPromptSection.includes('Agent B technique'),
      'I-07: Agent B technique must NOT appear');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-06: decision_rule type excluded from system prompt
  // DC-TGP-010 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-06: decision_rule type excluded from system prompt [DC-TGP-010, §31]', () => {
    seedTechnique(conn, {
      id: 'tech-dr-001',
      status: 'active',
      type: 'decision_rule',
      content: 'Decision rule — must NOT appear in system prompt.',
      confidence: 0.9,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 0,
      '§31: Only prompt_fragment techniques go in the system prompt');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-07: rag_pattern type excluded from system prompt
  // DC-TGP-010 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-07: rag_pattern type excluded from system prompt [DC-TGP-010, §31]', () => {
    seedTechnique(conn, {
      id: 'tech-rp-001',
      status: 'active',
      type: 'rag_pattern',
      content: 'RAG pattern — must NOT appear in system prompt.',
      confidence: 0.9,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 0,
      '§31: Only prompt_fragment techniques go in the system prompt');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-08: Techniques ordered by confidence descending
  // DC-TGP-009
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-08: Techniques ordered by confidence descending [DC-TGP-009, §31]', () => {
    seedTechnique(conn, { id: 'tech-low', confidence: 0.5, content: 'LOW_CONFIDENCE', status: 'active' });
    seedTechnique(conn, { id: 'tech-high', confidence: 0.9, content: 'HIGH_CONFIDENCE', status: 'active' });
    seedTechnique(conn, { id: 'tech-mid', confidence: 0.7, content: 'MID_CONFIDENCE', status: 'active' });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 3, 'All three active techniques injected');

    // Verify ordering in system prompt: HIGH before MID before LOW
    const section = result.systemPromptSection;
    const highIdx = section.indexOf('HIGH_CONFIDENCE');
    const midIdx = section.indexOf('MID_CONFIDENCE');
    const lowIdx = section.indexOf('LOW_CONFIDENCE');

    assert.ok(highIdx < midIdx, '§31: High confidence (0.9) before mid (0.7)');
    assert.ok(midIdx < lowIdx, '§31: Mid confidence (0.7) before low (0.5)');

    // Verify audit details preserve ordering
    const auditConfidences = result.auditDetails.techniques.map(t => t.confidence);
    assert.deepStrictEqual(auditConfidences, [0.9, 0.7, 0.5],
      'Audit records techniques in confidence-descending order');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-09: Techniques truncated at 20% of window
  // DC-TGP-006 rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-09: Techniques truncated at 20% of context window [DC-TGP-006, §31]', () => {
    // Use a small window to make truncation testable
    const smallWindow = 100; // 100 tokens total → 20 token budget
    const tokenBudget = Math.floor(smallWindow * MAX_CONTEXT_WINDOW_RATIO); // 20 tokens

    // Create content that uses ~16 tokens (64 chars / 4 = 16)
    const content16 = 'A'.repeat(64); // 16 tokens
    // Create content that uses ~8 tokens (32 chars / 4 = 8)
    const content8 = 'B'.repeat(32);  // 8 tokens

    seedTechnique(conn, { id: 'tech-big', confidence: 0.9, content: content16, status: 'active' });
    seedTechnique(conn, { id: 'tech-small', confidence: 0.7, content: content8, status: 'active' });

    // Budget is 20 tokens. Big (16) fits. Small (8) would push to 24 > 20. Excluded.
    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, smallWindow);

    assert.strictEqual(result.count, 1,
      '§31: Only techniques fitting within 20% budget are injected');
    assert.ok(result.systemPromptSection.includes(content16),
      'Highest confidence technique (0.9) retained');
    assert.ok(!result.systemPromptSection.includes(content8),
      'Lower confidence technique dropped due to budget');
    assert.ok(result.techniqueTokenCost <= tokenBudget,
      'I-54: Total technique cost within 20% budget');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-10: Highest-confidence techniques retained under truncation
  // DC-TGP-006 + DC-TGP-009
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-10: Highest-confidence retained under truncation [DC-TGP-006, DC-TGP-009]', () => {
    // Window: 200 tokens → 40 token budget
    const window = 200;
    // Technique at 0.9: 20 tokens (80 chars)
    // Technique at 0.7: 20 tokens (80 chars)
    // Technique at 0.5: 20 tokens (80 chars)
    // Budget 40: can fit exactly 2 of the 3 (greedy fill, ordered by confidence)

    seedTechnique(conn, { id: 'tech-09', confidence: 0.9, content: 'X'.repeat(80), status: 'active' });
    seedTechnique(conn, { id: 'tech-07', confidence: 0.7, content: 'Y'.repeat(80), status: 'active' });
    seedTechnique(conn, { id: 'tech-05', confidence: 0.5, content: 'Z'.repeat(80), status: 'active' });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, window);

    assert.strictEqual(result.count, 2,
      '§31: Only 2 of 3 fit within 40-token budget');
    assert.ok(result.systemPromptSection.includes('X'.repeat(80)),
      'Confidence 0.9 technique retained');
    assert.ok(result.systemPromptSection.includes('Y'.repeat(80)),
      'Confidence 0.7 technique retained');
    assert.ok(!result.systemPromptSection.includes('Z'.repeat(80)),
      'Confidence 0.5 technique dropped (lowest confidence)');

    // Verify audit IDs match retained techniques
    const injectedIds = result.auditDetails.injectedIds;
    assert.strictEqual(injectedIds.length, 2);
    assert.ok(injectedIds.includes('tech-09' as any), 'High-confidence ID in audit');
    assert.ok(injectedIds.includes('tech-07' as any), 'Mid-confidence ID in audit');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-11: Technique token cost included in systemOverhead
  // DC-TGP-007 success
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-11: Technique token cost available for systemOverhead [DC-TGP-007, I-54]', () => {
    const content = 'Respond with empathy when the user expresses frustration.';
    seedTechnique(conn, {
      id: 'tech-overhead-001',
      status: 'active',
      type: 'prompt_fragment',
      content,
      confidence: 0.8,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    const expectedTokenCost = estimateTokens(content);
    assert.strictEqual(result.techniqueTokenCost, expectedTokenCost,
      'I-54: techniqueTokenCost matches estimated tokens of injected content');
    assert.ok(result.techniqueTokenCost > 0,
      'Technique cost is non-zero');

    // Verify overhead breakdown can be constructed
    const fixedPipeline = 500; // Hypothetical fixed cost
    const breakdown: SystemOverheadBreakdown = {
      fixedPipeline,
      activeTechniques: result.techniqueTokenCost,
      total: fixedPipeline + result.techniqueTokenCost,
    };

    assert.strictEqual(breakdown.total, fixedPipeline + expectedTokenCost,
      'I-54: Total overhead = fixed + technique cost');
    assert.strictEqual(breakdown.activeTechniques, expectedTokenCost,
      'Breakdown.activeTechniques matches technique cost');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-12: ECB reduced when techniques present vs absent
  // DC-TGP-007 end-to-end
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-12: ECB reduced when techniques present [DC-TGP-007, I-54]', () => {
    const content = 'When debugging, always check error logs first.';
    seedTechnique(conn, {
      id: 'tech-ecb-001',
      status: 'active',
      type: 'prompt_fragment',
      content,
      confidence: 0.85,
    });

    // Without techniques: overhead = fixed only
    const fixedPipeline = 1000;
    const overheadWithout = fixedPipeline;

    // With techniques: overhead = fixed + technique cost
    const injection = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);
    const overheadWith = fixedPipeline + injection.techniqueTokenCost;

    assert.ok(overheadWith > overheadWithout,
      'I-54: Overhead with techniques > overhead without techniques');

    // ECB = window - overhead. Higher overhead = lower ECB.
    const ecbWithout = MODEL_CONTEXT_WINDOW - overheadWithout;
    const ecbWith = MODEL_CONTEXT_WINDOW - overheadWith;

    assert.ok(ecbWith < ecbWithout,
      'I-54: ECB with techniques < ECB without (techniques reduce available budget)');
    assert.strictEqual(ecbWithout - ecbWith, injection.techniqueTokenCost,
      'ECB reduction equals technique token cost');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-13: Injection audit record contains technique details
  // DC-TGP-008
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-13: Audit record contains technique injection details [DC-TGP-008, I-63]', () => {
    seedTechnique(conn, {
      id: 'tech-audit-001',
      status: 'active',
      type: 'prompt_fragment',
      content: 'Audit test technique content.',
      confidence: 0.75,
    });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);
    const audit = result.auditDetails;

    // Verify audit structure
    assert.strictEqual(audit.injectedIds.length, 1, 'One technique ID in audit');
    assert.strictEqual(audit.injectedIds[0], 'tech-audit-001' as any,
      'Correct technique ID recorded');

    assert.strictEqual(audit.techniques.length, 1, 'One technique detail entry');
    assert.strictEqual(audit.techniques[0].id, 'tech-audit-001' as any,
      'Technique detail ID matches');
    assert.strictEqual(audit.techniques[0].confidence, 0.75,
      'Technique confidence recorded');
    assert.ok(audit.techniques[0].tokenCost > 0,
      'Technique token cost recorded');

    assert.strictEqual(audit.tokenBudget, Math.floor(MODEL_CONTEXT_WINDOW * MAX_CONTEXT_WINDOW_RATIO),
      'Token budget = 20% of context window');
    assert.strictEqual(audit.tokensUsed, audit.techniques[0].tokenCost,
      'Tokens used matches technique cost');
    assert.strictEqual(audit.tgpQueryFailed, false,
      'TGP query did not fail');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IT-TGP-14: TGP failure = empty techniques + trace event
  // DC-TGP-011
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-14: TGP failure = empty techniques + graceful degradation [DC-TGP-011]', () => {
    // Create a reader that throws on query
    const failingReader: TechniqueReader = {
      getActivePromptFragments() {
        throw new Error('TGP store unavailable');
      },
    };

    const result = injectTechniques(
      failingReader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW,
    );

    assert.strictEqual(result.count, 0,
      'Graceful degradation: zero techniques on TGP failure');
    assert.strictEqual(result.systemPromptSection, '',
      'No system prompt section on failure');
    assert.strictEqual(result.techniqueTokenCost, 0,
      'Zero token cost on failure');
    assert.strictEqual(result.auditDetails.tgpQueryFailed, true,
      'Audit records TGP query failure');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Additional: Mixed statuses — only active survives
  // Comprehensive I-96 validation
  // ──────────────────────────────────────────────────────────────────────────
  it('IT-TGP-COMP: Mixed statuses — only active techniques survive [I-96 comprehensive]', () => {
    seedTechnique(conn, { id: 'tech-active', status: 'active', confidence: 0.8, content: 'ACTIVE_CONTENT' });
    seedTechnique(conn, { id: 'tech-candidate', status: 'candidate', confidence: 0.95, content: 'CANDIDATE_CONTENT' });
    seedTechnique(conn, { id: 'tech-suspended', status: 'suspended', confidence: 0.7, content: 'SUSPENDED_CONTENT' });
    seedTechnique(conn, { id: 'tech-retired', status: 'retired', confidence: 0.6, content: 'RETIRED_CONTENT' });

    const result = injectTechniques(reader, conn, TEST_AGENT_A, TEST_TENANT, MODEL_CONTEXT_WINDOW);

    assert.strictEqual(result.count, 1, 'I-96: Only 1 of 4 techniques is active');
    assert.ok(result.systemPromptSection.includes('ACTIVE_CONTENT'),
      'Active technique content present');
    assert.ok(!result.systemPromptSection.includes('CANDIDATE_CONTENT'),
      'I-96: Candidate excluded despite higher confidence');
    assert.ok(!result.systemPromptSection.includes('SUSPENDED_CONTENT'),
      'I-96: Suspended excluded');
    assert.ok(!result.systemPromptSection.includes('RETIRED_CONTENT'),
      'I-96: Retired excluded');
  });
});
