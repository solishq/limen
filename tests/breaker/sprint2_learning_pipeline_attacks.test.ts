/**
 * BREAKER: Sprint 2 Learning Pipeline Attack Tests
 * Target: collectCandidates in technique_extractor.ts (LEARNING-01)
 *
 * Attack vectors: LP-01 through LP-09
 * Classification: Tier 2 (core product logic, data integrity)
 *
 * What we attack:
 *   - Candidates from wrong tenant
 *   - Candidates from wrong agent
 *   - Candidates below quality threshold (0.7 boundary)
 *   - Candidates with non-positive feedback
 *   - Empty sinceTimestamp (all history)
 *   - Future sinceTimestamp (no results)
 *   - LIMIT 50 enforcement
 *   - Graceful degradation when table doesn't exist
 *   - Quality threshold boundary (exactly 0.7)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, createTestOperationContext, agentId as makeAgentId } from '../helpers/test_database.js';
import type { DatabaseConnection } from '../../src/kernel/interfaces/index.js';
import { createTechniqueExtractor } from '../../src/learning/extractor/technique_extractor.js';
import type { TechniqueStore, LearningDeps } from '../../src/learning/interfaces/index.js';

// ─── Minimal stubs ───

function createStubStore(): TechniqueStore {
  return {
    create() { return { ok: true, value: {} }; },
    get() { return { ok: false, error: { code: 'NOT_FOUND', message: '', spec: '' } }; },
    update() { return { ok: true, value: undefined }; },
    getByAgent() { return { ok: true, value: [] }; },
    query() { return { ok: true, value: [] }; },
  } as unknown as TechniqueStore;
}

function createStubDeps(conn: DatabaseConnection): LearningDeps {
  return {
    getConnection: () => conn,
    audit: { append() { return { ok: true, value: undefined }; } } as unknown as LearningDeps['audit'],
    events: { emit() {} } as unknown as LearningDeps['events'],
    rbac: { checkPermission() { return { ok: true, value: true }; } } as unknown as LearningDeps['rbac'],
    rateLimiter: { checkAndConsume() { return { ok: true, value: true }; } } as unknown as LearningDeps['rateLimiter'],
    gateway: { request() { return Promise.resolve({ ok: false, error: { message: 'stub' } }); } } as unknown as LearningDeps['gateway'],
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
}

function insertInteraction(conn: DatabaseConnection, overrides: {
  id?: string;
  tenantId?: string | null;
  agentId?: string;
  qualityScore?: number | null;
  userFeedback?: string | null;
  createdAt?: string;
  userInput?: string;
  assistantOutput?: string;
}): string {
  const id = overrides.id ?? crypto.randomUUID();
  const effectiveTenantId = 'tenantId' in overrides ? overrides.tenantId : 'test-tenant';
  conn.run(
    `INSERT INTO core_interactions (id, tenant_id, agent_id, session_id, conversation_id, user_input, assistant_output, model_used, input_tokens, output_tokens, quality_score, user_feedback, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      effectiveTenantId,
      overrides.agentId ?? 'agent-001',
      'session-001',
      'conv-001',
      overrides.userInput ?? 'test input',
      overrides.assistantOutput ?? 'test output',
      'default',
      10,
      15,
      overrides.qualityScore ?? null,
      overrides.userFeedback ?? null,
      overrides.createdAt ?? new Date().toISOString(),
    ],
  );
  return id;
}

describe('BREAKER: Sprint 2 Learning Pipeline Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-01: Wrong Tenant — Cross-tenant data leak in learning pipeline
  // CATCHES: If tenant scoping is missing from the query, candidates from
  // all tenants would be returned.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-01: Cross-Tenant Candidate Isolation', () => {
    it('LP-01a: candidates from tenant-B invisible to tenant-A', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());

      insertInteraction(conn, { tenantId: 'tenant-a', agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive' });
      insertInteraction(conn, { tenantId: 'tenant-b', agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive' });

      const ctxA = createTestOperationContext({ tenantId: 'tenant-a' });
      const result = extractor.collectCandidates(conn, ctxA, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');

      assert.ok(result.ok);
      assert.equal(result.value.length, 1, 'Only tenant-A interactions should be returned');

      // Verify the returned candidate is from tenant-A
      assert.equal(result.value[0]!.tenantId, 'tenant-a',
        'Candidate must be from requesting tenant');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-02: Wrong Agent — Cross-agent data leak in learning pipeline
  // CATCHES: If agent_id filter is missing, candidates from all agents returned.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-02: Cross-Agent Candidate Isolation', () => {
    it('LP-02a: candidates from agent-B invisible when querying agent-A', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-a', qualityScore: 0.9, userFeedback: 'positive' });
      insertInteraction(conn, { agentId: 'agent-b', qualityScore: 0.9, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-a'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 1);
      assert.equal(result.value[0]!.agentId, 'agent-a',
        'Only agent-a candidates should be returned');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-03: Quality Threshold Boundary
  // CATCHES: Off-by-one error on quality_score > 0.7 threshold.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-03: Quality Threshold Boundary', () => {
    it('LP-03a: quality_score exactly 0.7 is EXCLUDED (> not >=)', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.7, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0,
        'quality_score = 0.7 exactly should be excluded (threshold is > 0.7, not >= 0.7)');
    });

    it('LP-03b: quality_score 0.70001 is INCLUDED', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.70001, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 1,
        'quality_score just above 0.7 should be included');
    });

    it('LP-03c: quality_score below 0.7 is EXCLUDED', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.5, userFeedback: 'positive' });
      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.3, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0, 'Below-threshold interactions must be excluded');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-04: Non-Positive Feedback Exclusion
  // CATCHES: If feedback filter is missing, negative/correction/null
  // interactions are used for learning (data quality issue).
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-04: Non-Positive Feedback Exclusion', () => {
    it('LP-04a: negative feedback EXCLUDED', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'negative' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0, 'Negative feedback must be excluded');
    });

    it('LP-04b: correction feedback EXCLUDED', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'correction' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0, 'Correction feedback must be excluded');
    });

    it('LP-04c: NULL feedback EXCLUDED', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: null });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0, 'NULL feedback must be excluded');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-05: sinceTimestamp Boundary
  // CATCHES: Empty sinceTimestamp or future timestamp edge cases.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-05: sinceTimestamp Boundaries', () => {
    it('LP-05a: far-past sinceTimestamp returns all matching interactions', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive' });
      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.8, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 2, 'Far-past timestamp should return all matching');
    });

    it('LP-05b: future sinceTimestamp returns no results', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2099-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0, 'Future sinceTimestamp should return nothing');
    });

    it('LP-05c: sinceTimestamp exactly matching interaction created_at is EXCLUDED (>)', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      const exactTime = '2026-03-20T12:00:00.000Z';
      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive', createdAt: exactTime });

      // sinceTimestamp uses > not >=, so exact match is excluded
      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), exactTime);
      assert.ok(result.ok);
      assert.equal(result.value.length, 0,
        'Exact timestamp match should be excluded (strict > comparison)');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-06: LIMIT 50 Enforcement
  // CATCHES: If LIMIT is missing, unbounded result sets cause memory issues.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-06: LIMIT 50 Enforcement', () => {
    it('LP-06a: insert 60 qualifying interactions, verify max 50 returned', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      for (let i = 0; i < 60; i++) {
        insertInteraction(conn, {
          agentId: 'agent-001',
          qualityScore: 0.8 + (i * 0.001),
          userFeedback: 'positive',
        });
      }

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 50, 'Must cap at 50 results');
    });

    it('LP-06b: results are ordered by quality_score DESC (highest first)', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.75, userFeedback: 'positive' });
      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.99, userFeedback: 'positive' });
      insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.85, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 3);
      assert.equal(result.value[0]!.qualityScore, 0.99, 'Highest quality first');
      assert.equal(result.value[1]!.qualityScore, 0.85, 'Second highest');
      assert.equal(result.value[2]!.qualityScore, 0.75, 'Lowest quality last');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-07: Graceful Degradation
  // CATCHES: If the table doesn't exist (migration not run), collectCandidates
  // should return empty array, not crash.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-07: Graceful Degradation', () => {
    it('LP-07a: collectCandidates returns empty on query failure (not crash)', () => {
      // This tests the catch block in collectCandidates.
      // We need a connection where the query will fail — use a fresh DB without
      // the interactions table. We can simulate this by dropping the table.
      const freshConn = createTestDatabase();
      // Drop the interactions table to simulate missing migration
      freshConn.run('DROP TABLE IF EXISTS core_interactions');

      const deps = createStubDeps(freshConn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      const result = extractor.collectCandidates(freshConn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok, 'collectCandidates must return ok: true even on table absence');
      assert.equal(result.value.length, 0, 'Should return empty array on graceful degradation');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-08: Conversation Context Construction
  // CATCHES: Incorrect formatting of conversation context from user_input
  // and assistant_output fields.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-08: Conversation Context Construction', () => {
    it('LP-08a: conversationContext correctly formatted', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, {
        agentId: 'agent-001',
        qualityScore: 0.9,
        userFeedback: 'positive',
        userInput: 'Tell me about quantum computing',
        assistantOutput: 'Quantum computing uses qubits.',
      });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value[0]!.conversationContext,
        'User: Tell me about quantum computing\nAssistant: Quantum computing uses qubits.',
        'conversationContext must use exact "User: ... \\nAssistant: ..." format');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LP-09: NULL Quality Score Handling
  // CATCHES: Interactions with NULL quality_score should be excluded.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('LP-09: NULL Quality Score', () => {
    it('LP-09a: NULL quality_score interactions are excluded', () => {
      const deps = createStubDeps(conn);
      const extractor = createTechniqueExtractor(deps, createStubStore());
      const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

      insertInteraction(conn, { agentId: 'agent-001', qualityScore: null, userFeedback: 'positive' });

      const result = extractor.collectCandidates(conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
      assert.ok(result.ok);
      assert.equal(result.value.length, 0,
        'NULL quality_score should not satisfy > 0.7 condition');
    });
  });
});
