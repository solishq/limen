/**
 * Contract tests for LEARNING-01 collectCandidates (Sprint 2 Trust & Learning).
 * Validates that the learning extractor's collectCandidates function queries
 * real interaction data from core_interactions.
 *
 * Phase: Sprint 2 (Trust & Learning)
 * Spec ref: LEARNING-01 (Cross-Agent Learning), S29.3 Step 1
 *
 * Tests cover:
 *   - Returns interactions with quality > 0.7 and positive feedback
 *   - Filters by agent_id and tenant_id
 *   - Respects sinceTimestamp
 *   - Returns max 50 results
 *   - Empty when no matching interactions exist
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, createTestOperationContext, agentId as makeAgentId } from '../helpers/test_database.js';
import type { DatabaseConnection } from '../../src/kernel/interfaces/index.js';
import { createTechniqueExtractor } from '../../src/learning/extractor/technique_extractor.js';
import type { TechniqueStore } from '../../src/learning/interfaces/index.js';
import type { LearningDeps } from '../../src/learning/interfaces/index.js';

// ─── Minimal stubs for factory requirements ───

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

// ─── Helper: insert interaction ───

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
  // Note: 'tenantId' in overrides checks property existence, not nullish.
  // This lets callers pass explicit null (distinct from omitting the field).
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

describe('LEARNING-01 collectCandidates — Contract Tests', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  it('returns interactions with quality > 0.7 and positive feedback', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });
    const aid = makeAgentId('agent-001');

    // Insert qualifying interaction
    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.85, userFeedback: 'positive' });
    // Insert non-qualifying: low quality
    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.5, userFeedback: 'positive' });
    // Insert non-qualifying: negative feedback
    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'negative' });
    // Insert non-qualifying: no feedback
    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.9, userFeedback: null });

    const result = extractor.collectCandidates(conn, ctx, aid, '2000-01-01T00:00:00.000Z');
    assert.ok(result.ok);
    assert.equal(result.value.length, 1, 'Only quality > 0.7 with positive feedback');
    assert.equal(result.value[0]!.qualityScore, 0.85);
    assert.equal(result.value[0]!.userFeedback, 'positive');
  });

  it('filters by agent_id', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

    insertInteraction(conn, { agentId: 'agent-a', qualityScore: 0.9, userFeedback: 'positive' });
    insertInteraction(conn, { agentId: 'agent-b', qualityScore: 0.9, userFeedback: 'positive' });

    const resultA = extractor.collectCandidates(conn, ctx, makeAgentId('agent-a'), '2000-01-01T00:00:00.000Z');
    assert.ok(resultA.ok);
    assert.equal(resultA.value.length, 1);
    assert.equal(resultA.value[0]!.agentId, 'agent-a');

    const resultB = extractor.collectCandidates(conn, ctx, makeAgentId('agent-b'), '2000-01-01T00:00:00.000Z');
    assert.ok(resultB.ok);
    assert.equal(resultB.value.length, 1);
    assert.equal(resultB.value[0]!.agentId, 'agent-b');
  });

  it('filters by tenant_id', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());

    insertInteraction(conn, { tenantId: 'tenant-x', agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive' });
    insertInteraction(conn, { tenantId: 'tenant-y', agentId: 'agent-001', qualityScore: 0.9, userFeedback: 'positive' });

    const ctxX = createTestOperationContext({ tenantId: 'tenant-x' });
    const resultX = extractor.collectCandidates(conn, ctxX, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
    assert.ok(resultX.ok);
    assert.equal(resultX.value.length, 1);

    const ctxY = createTestOperationContext({ tenantId: 'tenant-y' });
    const resultY = extractor.collectCandidates(conn, ctxY, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z');
    assert.ok(resultY.ok);
    assert.equal(resultY.value.length, 1);
  });

  it('respects sinceTimestamp', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

    // Old interaction
    insertInteraction(conn, {
      agentId: 'agent-001',
      qualityScore: 0.9,
      userFeedback: 'positive',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    // Recent interaction
    insertInteraction(conn, {
      agentId: 'agent-001',
      qualityScore: 0.8,
      userFeedback: 'positive',
      createdAt: '2026-06-01T00:00:00.000Z',
    });

    const result = extractor.collectCandidates(
      conn, ctx, makeAgentId('agent-001'), '2026-01-01T00:00:00.000Z',
    );
    assert.ok(result.ok);
    assert.equal(result.value.length, 1, 'Only interactions after sinceTimestamp');
    assert.equal(result.value[0]!.qualityScore, 0.8);
  });

  it('returns max 50 results', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

    // Insert 60 qualifying interactions
    for (let i = 0; i < 60; i++) {
      insertInteraction(conn, {
        agentId: 'agent-001',
        qualityScore: 0.8 + (i * 0.001), // Vary slightly for ordering
        userFeedback: 'positive',
      });
    }

    const result = extractor.collectCandidates(
      conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z',
    );
    assert.ok(result.ok);
    assert.equal(result.value.length, 50, 'Must cap at 50 results');
  });

  it('returns ordered by quality_score descending', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.75, userFeedback: 'positive' });
    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.95, userFeedback: 'positive' });
    insertInteraction(conn, { agentId: 'agent-001', qualityScore: 0.85, userFeedback: 'positive' });

    const result = extractor.collectCandidates(
      conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z',
    );
    assert.ok(result.ok);
    assert.equal(result.value.length, 3);
    assert.equal(result.value[0]!.qualityScore, 0.95);
    assert.equal(result.value[1]!.qualityScore, 0.85);
    assert.equal(result.value[2]!.qualityScore, 0.75);
  });

  it('empty when no matching interactions exist', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

    const result = extractor.collectCandidates(
      conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z',
    );
    assert.ok(result.ok);
    assert.equal(result.value.length, 0);
  });

  it('builds conversationContext from user_input and assistant_output', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: 'test-tenant' });

    insertInteraction(conn, {
      agentId: 'agent-001',
      qualityScore: 0.9,
      userFeedback: 'positive',
      userInput: 'What is 2+2?',
      assistantOutput: 'The answer is 4.',
    });

    const result = extractor.collectCandidates(
      conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z',
    );
    assert.ok(result.ok);
    assert.equal(result.value.length, 1);
    assert.equal(
      result.value[0]!.conversationContext,
      'User: What is 2+2?\nAssistant: The answer is 4.',
    );
  });

  it('null tenant_id matches null tenant context', () => {
    const deps = createStubDeps(conn);
    const extractor = createTechniqueExtractor(deps, createStubStore());
    const ctx = createTestOperationContext({ tenantId: null });

    insertInteraction(conn, {
      tenantId: null,
      agentId: 'agent-001',
      qualityScore: 0.9,
      userFeedback: 'positive',
    });
    // Different tenant should not match
    insertInteraction(conn, {
      tenantId: 'some-tenant',
      agentId: 'agent-001',
      qualityScore: 0.9,
      userFeedback: 'positive',
    });

    const result = extractor.collectCandidates(
      conn, ctx, makeAgentId('agent-001'), '2000-01-01T00:00:00.000Z',
    );
    assert.ok(result.ok);
    assert.equal(result.value.length, 1, 'Only null-tenant interactions');
  });
});
