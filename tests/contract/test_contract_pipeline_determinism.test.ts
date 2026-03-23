/**
 * Contract tests for Pipeline Determinism (I-28).
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * Verifies:
 *   - All 9 status chunks emitted in order (streaming mode)
 *   - All 9 status chunks emitted in order (non-streaming mode)
 *   - Phase timings in metadata
 *   - Error path still emits pre-error phases
 *
 * Amendment 21: Every enforcement DC has success AND rejection tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PipelinePhase, StreamChunk } from '../../src/api/interfaces/api.js';
import { ChatPipeline } from '../../src/api/chat/chat_pipeline.js';
import { createMockGateway } from '../helpers/mock_gateway.js';
import { createTestDatabase, createTestAuditTrail } from '../helpers/test_database.js';
import type { SessionState } from '../../src/api/sessions/session_manager.js';

// Shared test infrastructure
function createTestPipeline(gatewayResponse?: string) {
  const conn = createTestDatabase();
  const audit = createTestAuditTrail();
  const gateway = createMockGateway(gatewayResponse ?? 'test response');
  const time = { nowISO: () => '2026-01-01T00:00:00.000Z', nowMs: () => 1735689600000 };

  const rbac = {
    checkPermission: () => ({ ok: true, value: true }),
    hasPermission: () => ({ ok: true, value: true }),
  } as unknown as import('../../src/kernel/interfaces/index.js').RbacEngine;

  const rateLimiter = {
    checkAndConsume: () => ({ ok: true, value: true }),
    getStatus: () => ({ ok: true, value: { currentTokens: 100, maxTokens: 100, refillRate: 10, lastRefillAt: '2026-01-01T00:00:00.000Z' } }),
  } as unknown as import('../../src/kernel/interfaces/index.js').RateLimiter;

  const orchestration = {
    conversations: {
      appendTurn: () => ({ ok: true, value: 1 }),
    },
  } as unknown as import('../../src/orchestration/interfaces/orchestration.js').OrchestrationEngine;

  const chatPipeline = new ChatPipeline(
    rbac,
    rateLimiter,
    orchestration,
    gateway,
    () => conn,
    () => audit,
    () => ({ shutdown: () => {} }) as unknown as import('../../src/substrate/interfaces/substrate.js').Substrate,
    60000,
    { bufferSizeBytes: 4096, stallTimeoutMs: 30000, maxConcurrentStreams: 50 },
    'mock-model',
    undefined,
    127500,
    time,
  );

  const sessionState: SessionState = {
    sessionId: `session-${Date.now()}`,
    conversationId: `conv-${Date.now()}`,
    tenantId: 'test-tenant',
    userId: 'test-user',
    agentId: 'test-agent',
    permissions: new Set(['chat']),
    hitlMode: null,
    createdAt: 1735689600000,
    activeStreams: new Set<string>(),
  } as unknown as SessionState;

  return { chatPipeline, sessionState, conn };
}

const EXPECTED_PHASES: PipelinePhase[] = [
  'perception', 'retrieval', 'context_assembly', 'pre_safety',
  'generation', 'post_safety', 'learning', 'evaluation', 'audit',
];

describe('Contract: Pipeline Determinism (I-28)', () => {

  describe('Phase Ordering — Streaming Mode', () => {
    it('success: all 9 status chunks in exact spec order (streaming)', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Hello streaming', { stream: true });

      const statusChunks: Array<{ phase: PipelinePhase; durationMs: number }> = [];
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') {
          statusChunks.push({ phase: chunk.phase, durationMs: chunk.durationMs });
        }
      }

      assert.equal(statusChunks.length, 9,
        `CATCHES: streaming mode must emit exactly 9 status chunks, got ${statusChunks.length}`);

      for (let i = 0; i < EXPECTED_PHASES.length; i++) {
        assert.equal(statusChunks[i]!.phase, EXPECTED_PHASES[i],
          `CATCHES: streaming phase ${i} must be '${EXPECTED_PHASES[i]}', got '${statusChunks[i]!.phase}'`);
      }

      conn.close();
    });
  });

  describe('Phase Ordering — Non-Streaming Mode', () => {
    it('success: all 9 status chunks in exact spec order (non-streaming)', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Hello non-streaming', { stream: false });

      const statusChunks: Array<{ phase: PipelinePhase; durationMs: number }> = [];
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') {
          statusChunks.push({ phase: chunk.phase, durationMs: chunk.durationMs });
        }
      }

      assert.equal(statusChunks.length, 9,
        `CATCHES: non-streaming mode must emit exactly 9 status chunks, got ${statusChunks.length}`);

      for (let i = 0; i < EXPECTED_PHASES.length; i++) {
        assert.equal(statusChunks[i]!.phase, EXPECTED_PHASES[i],
          `CATCHES: non-streaming phase ${i} must be '${EXPECTED_PHASES[i]}', got '${statusChunks[i]!.phase}'`);
      }

      conn.close();
    });
  });

  describe('Phase Timings in Metadata', () => {
    it('success: metadata.phases has 9 entries with non-negative durations', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Hello metadata', { stream: true });

      // Must consume stream to drive pipeline execution (pipeline runs lazily on iteration)
      for await (const _chunk of result.stream) {
        // Drain all chunks to completion
      }

      const metadata = await result.metadata;

      assert.ok(metadata.phases, 'metadata must include phases array');
      assert.equal(metadata.phases.length, 9,
        `CATCHES: metadata.phases must have 9 entries, got ${metadata.phases.length}`);

      for (let i = 0; i < EXPECTED_PHASES.length; i++) {
        assert.equal(metadata.phases[i]!.phase, EXPECTED_PHASES[i],
          `CATCHES: metadata phase ${i} must be '${EXPECTED_PHASES[i]}'`);
        assert.ok(metadata.phases[i]!.durationMs >= 0,
          `CATCHES: phase '${EXPECTED_PHASES[i]}' duration must be non-negative`);
      }

      conn.close();
    });
  });

  describe('Error Path', () => {
    it('success: error path emits error chunk', async () => {
      /**
       * When pipeline encounters an error, it should emit an error chunk.
       * Pre-error phases should still have been emitted up to the failure point.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();
      const time = { nowISO: () => '2026-01-01T00:00:00.000Z', nowMs: () => 1735689600000 };

      // Create a gateway that fails on request
      const failingGateway = {
        registerProvider: () => ({ ok: true, value: undefined }),
        request: async () => ({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Test failure', spec: '' } }),
        requestStream: async () => ({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Test failure', spec: '' } }),
        getProviderHealth: () => ({ ok: true, value: [] }),
        hasHealthyProvider: () => ({ ok: true, value: false }),
        checkFailoverBudget: () => ({ ok: true, value: { allowed: true } }),
      } as unknown as import('../../src/substrate/interfaces/substrate.js').LlmGateway;

      const rbac = {
        checkPermission: () => ({ ok: true, value: true }),
        hasPermission: () => ({ ok: true, value: true }),
      } as unknown as import('../../src/kernel/interfaces/index.js').RbacEngine;

      const rateLimiter = {
        checkAndConsume: () => ({ ok: true, value: true }),
        getStatus: () => ({ ok: true, value: { currentTokens: 100, maxTokens: 100, refillRate: 10, lastRefillAt: '2026-01-01T00:00:00.000Z' } }),
      } as unknown as import('../../src/kernel/interfaces/index.js').RateLimiter;

      const orchestration = {
        conversations: {
          appendTurn: () => ({ ok: true, value: 1 }),
        },
      } as unknown as import('../../src/orchestration/interfaces/orchestration.js').OrchestrationEngine;

      const chatPipeline = new ChatPipeline(
        rbac, rateLimiter, orchestration, failingGateway,
        () => conn, () => audit,
        () => ({ shutdown: () => {} }) as unknown as import('../../src/substrate/interfaces/substrate.js').Substrate,
        60000,
        { bufferSizeBytes: 4096, stallTimeoutMs: 30000, maxConcurrentStreams: 50 },
        'mock-model', undefined, 127500, time,
      );

      const sessionState = {
        sessionId: 'err-session',
        conversationId: 'err-conv',
        tenantId: 'test-tenant',
        userId: 'test-user',
        agentId: 'test-agent',
        permissions: new Set(['chat']),
        hitlMode: null,
        createdAt: 1735689600000,
        activeStreams: new Set<string>(),
      } as unknown as SessionState;

      const result = chatPipeline.execute(sessionState, 'Trigger error', { stream: true });

      // Suppress unhandled rejections on text/metadata — they are expected to reject on error path
      result.text.catch(() => {});
      result.metadata.catch(() => {});

      const allChunks: StreamChunk[] = [];
      for await (const chunk of result.stream) {
        allChunks.push(chunk);
      }

      // The pipeline should emit at least the pre-error phase status chunks
      const statusChunks = allChunks.filter(c => c.type === 'status');
      assert.ok(statusChunks.length >= 4,
        `CATCHES: pre-error phases (perception, retrieval, context_assembly, pre_safety) should emit before generation fails. Got ${statusChunks.length} status chunks`);

      // Should also have an error chunk
      const errorChunks = allChunks.filter(c => c.type === 'error');
      assert.ok(errorChunks.length > 0,
        'CATCHES: pipeline error must produce an error chunk');

      conn.close();
    });
  });

  describe('Pipeline Sealed', () => {
    it('rejection: cannot inject 10th phase via ChatPipeline prototype', () => {
      /**
       * I-28: No pipeline extension. Verify ChatPipeline has no extension API.
       */
      const proto = Object.getOwnPropertyNames(ChatPipeline.prototype);

      // No dynamic phase registration methods
      const extensionMethods = proto.filter(m =>
        m.includes('Phase') || m.includes('phase') ||
        m.includes('middleware') || m.includes('plugin') ||
        m.includes('register') || m.includes('hook'),
      );

      // Filter out legitimate phase-related private methods
      const illegitimate = extensionMethods.filter(m =>
        m !== 'execute' && m !== 'constructor',
      );

      // Any remaining method names that could add phases are a concern
      // This is a structural check — the real enforcement is TypeScript's type system
      assert.equal(illegitimate.length, 0,
        `CATCHES: ChatPipeline must not have extension methods: [${illegitimate.join(', ')}]`);
    });
  });
});
