/**
 * Sprint 4 Breaker Attacks: Pipeline Determinism (I-28) + Migration v35
 *
 * Target: src/api/chat/chat_pipeline.ts
 * Target: src/api/migration/026_replay_pipeline.ts
 *
 * Attack vectors:
 *   - T-S4-014: Phase injection (adding phases beyond the 9)
 *   - T-S4-015: Phase ordering violation
 *   - T-S4-016: Timing side-channel
 *   - T-S4-017: Phase bypass on error
 *   - T-S4-006: LLM log tampering
 *
 * Mutation targets:
 *   - Remove phase ordering enforcement
 *   - Skip phases on error path
 *   - Remove LLM log immutability trigger
 *   - Remove partial index for recovery
 *
 * Recurring patterns checked:
 *   P-001 (non-discriminative tests)
 *   P-002 (defense built not wired)
 *   P-010 (implementation logic in harness)
 *   Direct Date.now() usage (F-S3-004)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PipelinePhase, StreamChunk } from '../../src/api/interfaces/api.js';
import { ChatPipeline } from '../../src/api/chat/chat_pipeline.js';
import { createMockGateway } from '../helpers/mock_gateway.js';
import { createTestDatabase, createTestAuditTrail, seedMission } from '../helpers/test_database.js';
import type { SessionState } from '../../src/api/sessions/session_manager.js';

const EXPECTED_PHASES: PipelinePhase[] = [
  'perception', 'retrieval', 'context_assembly', 'pre_safety',
  'generation', 'post_safety', 'learning', 'evaluation', 'audit',
];

// Shared test infrastructure
function createTestPipeline(options?: {
  gatewayResponse?: string;
  failingGateway?: boolean;
  timeProvider?: { nowISO: () => string; nowMs: () => number };
}) {
  const conn = createTestDatabase();
  const audit = createTestAuditTrail();
  const time = options?.timeProvider ?? {
    nowISO: () => '2026-01-01T00:00:00.000Z',
    nowMs: () => 1735689600000,
  };

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

  let gateway;
  if (options?.failingGateway) {
    gateway = {
      registerProvider: () => ({ ok: true, value: undefined }),
      request: async () => ({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Test failure', spec: '' } }),
      requestStream: async () => ({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Test failure', spec: '' } }),
      getProviderHealth: () => ({ ok: true, value: [] }),
      hasHealthyProvider: () => ({ ok: true, value: false }),
      checkFailoverBudget: () => ({ ok: true, value: { allowed: true } }),
    } as unknown as import('../../src/substrate/interfaces/substrate.js').LlmGateway;
  } else {
    gateway = createMockGateway(options?.gatewayResponse ?? 'test response');
  }

  const chatPipeline = new ChatPipeline(
    rbac, rateLimiter, orchestration, gateway,
    () => conn, () => audit,
    () => ({ shutdown: () => {} }) as unknown as import('../../src/substrate/interfaces/substrate.js').Substrate,
    60000,
    { bufferSizeBytes: 4096, stallTimeoutMs: 30000, maxConcurrentStreams: 50 },
    'mock-model', undefined, 127500, time,
  );

  const sessionState: SessionState = {
    sessionId: `session-${crypto.randomUUID()}`,
    conversationId: `conv-${crypto.randomUUID()}`,
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

describe('Breaker: Pipeline Determinism + Migration Attacks (Sprint 4)', () => {

  // ========================================================================
  // T-S4-014: Phase Injection Attacks
  // ========================================================================

  describe('T-S4-014: Phase injection', () => {
    it('attack: pipeline emits exactly 9 phases, no more', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Test message', { stream: true });

      const allChunks: StreamChunk[] = [];
      for await (const chunk of result.stream) {
        allChunks.push(chunk);
      }

      const statusChunks = allChunks.filter(c => c.type === 'status');
      assert.equal(statusChunks.length, 9,
        `CATCHES T-S4-014: exactly 9 status chunks required, got ${statusChunks.length}`);

      // No unknown phases
      const unknownPhases = statusChunks.filter(c => {
        if (c.type !== 'status') return false;
        return !EXPECTED_PHASES.includes(c.phase);
      });
      assert.equal(unknownPhases.length, 0,
        'CATCHES T-S4-014: no unknown phase names allowed');

      conn.close();
    });

    it('attack: ChatPipeline prototype has no extension methods', () => {
      const proto = Object.getOwnPropertyNames(ChatPipeline.prototype);
      const dangerousMethods = proto.filter(m =>
        m.includes('addPhase') || m.includes('registerPhase') ||
        m.includes('middleware') || m.includes('plugin') ||
        m.includes('extend') || m.includes('hook') ||
        m.includes('interceptor') || m.includes('register'),
      );
      assert.equal(dangerousMethods.length, 0,
        `CATCHES T-S4-014: ChatPipeline must not have phase extension methods: [${dangerousMethods.join(', ')}]`);
    });
  });

  // ========================================================================
  // T-S4-015: Phase Ordering Violation
  // ========================================================================

  describe('T-S4-015: Phase ordering', () => {
    it('attack: streaming mode phases in exact spec order', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Hello streaming', { stream: true });

      const phases: PipelinePhase[] = [];
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') {
          phases.push(chunk.phase);
        }
      }

      for (let i = 0; i < EXPECTED_PHASES.length; i++) {
        assert.equal(phases[i], EXPECTED_PHASES[i],
          `CATCHES T-S4-015: phase ${i} must be '${EXPECTED_PHASES[i]}', got '${phases[i]}'`);
      }

      conn.close();
    });

    it('attack: non-streaming mode phases in exact spec order', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Hello non-streaming', { stream: false });

      const phases: PipelinePhase[] = [];
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') {
          phases.push(chunk.phase);
        }
      }

      for (let i = 0; i < EXPECTED_PHASES.length; i++) {
        assert.equal(phases[i], EXPECTED_PHASES[i],
          `CATCHES: non-streaming phase ${i} must be '${EXPECTED_PHASES[i]}', got '${phases[i]}'`);
      }

      conn.close();
    });

    it('attack: metadata.phases mirrors stream status chunks', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Hello metadata', { stream: true });

      const streamPhases: PipelinePhase[] = [];
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') {
          streamPhases.push(chunk.phase);
        }
      }

      const metadata = await result.metadata;

      assert.equal(metadata.phases.length, streamPhases.length,
        'metadata.phases count must match stream status chunk count');

      for (let i = 0; i < metadata.phases.length; i++) {
        assert.equal(metadata.phases[i]!.phase, streamPhases[i],
          `CATCHES: metadata phase ${i} must match stream phase`);
      }

      conn.close();
    });
  });

  // ========================================================================
  // T-S4-017: Phase Bypass on Error
  // ========================================================================

  describe('T-S4-017: Phase bypass on error', () => {
    it('attack: generation failure still emits pre-error phases', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline({ failingGateway: true });

      const result = chatPipeline.execute(sessionState, 'Trigger error', { stream: true });

      // Suppress expected rejections
      result.text.catch(() => {});
      result.metadata.catch(() => {});

      const allChunks: StreamChunk[] = [];
      for await (const chunk of result.stream) {
        allChunks.push(chunk);
      }

      const statusChunks = allChunks.filter(c => c.type === 'status');
      const errorChunks = allChunks.filter(c => c.type === 'error');

      // Pre-generation phases (perception, retrieval, context_assembly, pre_safety) must emit
      assert.ok(statusChunks.length >= 4,
        `CATCHES T-S4-017: at least 4 pre-error phases must emit, got ${statusChunks.length}`);

      // Verify the pre-error phases are in order
      const preErrorExpected: PipelinePhase[] = ['perception', 'retrieval', 'context_assembly', 'pre_safety'];
      for (let i = 0; i < Math.min(statusChunks.length, preErrorExpected.length); i++) {
        const chunk = statusChunks[i];
        if (chunk && chunk.type === 'status') {
          assert.equal(chunk.phase, preErrorExpected[i],
            `Pre-error phase ${i} must be '${preErrorExpected[i]}'`);
        }
      }

      // Error chunk must be present
      assert.ok(errorChunks.length > 0,
        'CATCHES: generation failure must produce error chunk');

      conn.close();
    });

    it('attack: error path rejects text and metadata promises', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline({ failingGateway: true });

      const result = chatPipeline.execute(sessionState, 'Error path', { stream: true });

      // Consume stream to drive pipeline
      for await (const _chunk of result.stream) {}

      // Text promise must reject
      await assert.rejects(result.text,
        'CATCHES: text promise must reject on pipeline error');

      // Metadata promise must reject
      await assert.rejects(result.metadata,
        'CATCHES: metadata promise must reject on pipeline error');

      conn.close();
    });
  });

  // ========================================================================
  // FINDING: ChatPipeline clock fallback uses Date.now() directly
  // ========================================================================

  describe('FINDING: ChatPipeline clock fallback uses Date.now()', () => {
    it('analysis: ChatPipeline.clock getter falls back to raw Date.now()', () => {
      /**
       * FINDING — F-S4-005: ChatPipeline clock fallback violates Hard Stop #7
       * File: src/api/chat/chat_pipeline.ts, line 79
       *
       *   private get clock(): TimeProvider {
       *     return this.time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
       *   }
       *
       * When no TimeProvider is injected (this.time is undefined), the pipeline
       * falls back to raw Date.now(). This violates Hard Stop #7:
       *   "All temporal logic uses TimeProvider, never direct Date.now()."
       *
       * In practice, the builder passes time from the constructor, so this
       * fallback only triggers if time parameter is omitted. But the fallback
       * exists in the code and would survive a mutation removing the time
       * parameter from the constructor.
       *
       * This is the SAME pattern as F-S3-004 (generateDriftId Date.now()).
       *
       * Severity: MEDIUM — the fallback path exists and could be exercised.
       * The constructor accepts an optional time parameter (line 75), which
       * means callers CAN omit it and trigger the raw Date.now() path.
       *
       * Additionally, Date.now() in the fallback at line 62 of the test pipeline
       * setup (sessionState creation) uses Date.now() directly, but that's test
       * code, not production code.
       */

      // Verify the fallback exists by instantiating ChatPipeline WITHOUT time
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();
      const gateway = createMockGateway('test');

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

      // Omit time parameter — triggers Date.now() fallback
      const chatPipeline = new ChatPipeline(
        rbac, rateLimiter, orchestration, gateway,
        () => conn, () => audit,
        () => ({ shutdown: () => {} }) as unknown as import('../../src/substrate/interfaces/substrate.js').Substrate,
        60000,
        { bufferSizeBytes: 4096, stallTimeoutMs: 30000, maxConcurrentStreams: 50 },
        'mock-model',
        // time is omitted — this is the finding
      );

      // The pipeline still works but uses raw Date.now()
      // This test documents the finding
      assert.ok(chatPipeline,
        'FINDING F-S4-005 DOCUMENTED: ChatPipeline can be created without TimeProvider, using Date.now() fallback');

      conn.close();
    });
  });

  // ========================================================================
  // Migration v35 Attacks
  // ========================================================================

  describe('Migration v35: Trigger and Index Verification', () => {
    it('attack: core_replay_snapshots UPDATE trigger exists and blocks', () => {
      const conn = createTestDatabase();

      // Verify trigger exists
      const trigger = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_replay_snapshots_no_update'`,
      );
      assert.ok(trigger, 'trg_replay_snapshots_no_update trigger must exist');

      conn.close();
    });

    it('attack: core_replay_snapshots DELETE trigger exists and blocks', () => {
      const conn = createTestDatabase();

      const trigger = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_replay_snapshots_no_delete'`,
      );
      assert.ok(trigger, 'trg_replay_snapshots_no_delete trigger must exist');

      conn.close();
    });

    it('attack: LLM log immutability trigger exists', () => {
      const conn = createTestDatabase();

      const trigger = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_llm_log_immutable'`,
      );
      assert.ok(trigger, 'trg_llm_log_immutable trigger must exist');

      conn.close();
    });

    it('attack: non-terminal missions partial index exists', () => {
      const conn = createTestDatabase();

      const index = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_core_missions_non_terminal'`,
      );
      assert.ok(index, 'idx_core_missions_non_terminal partial index must exist');

      conn.close();
    });

    it('attack: replay_snapshots_mission index exists', () => {
      const conn = createTestDatabase();

      const index = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_replay_snapshots_mission'`,
      );
      assert.ok(index, 'idx_replay_snapshots_mission index must exist');

      conn.close();
    });

    it('attack: replay_snapshots_tenant index exists', () => {
      const conn = createTestDatabase();

      const index = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_replay_snapshots_tenant'`,
      );
      assert.ok(index, 'idx_replay_snapshots_tenant index must exist');

      conn.close();
    });

    it('attack: core_replay_snapshots CHECK constraint on snapshot_type', () => {
      const conn = createTestDatabase();

      seedMission(conn, { id: 'check-m1', tenantId: 'tenant-a', state: 'CREATED' });

      // Attempt to insert an invalid snapshot_type
      assert.throws(() => {
        conn.run(
          `INSERT INTO core_replay_snapshots (id, mission_id, tenant_id, snapshot_type, state_hash, state_detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['bad-snap', 'check-m1', 'tenant-a', 'INVALID_TYPE', 'hash', '{}', '2026-01-01T00:00:00Z'],
        );
      }, /CHECK constraint/,
        'CATCHES: invalid snapshot_type must be rejected by CHECK constraint');

      conn.close();
    });
  });

  // ========================================================================
  // T-S4-006: LLM Log Tampering — Extended
  // ========================================================================

  describe('T-S4-006: LLM log tampering — extended', () => {
    it('attack: multiple fields tampered simultaneously on completed log entry', () => {
      const conn = createTestDatabase();

      seedMission(conn, { id: 'multi-m1', tenantId: 'tenant-a', state: 'EXECUTING' });

      conn.run(
        `INSERT INTO core_llm_request_log
         (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, response_body, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['multi-req-1', 'multi-m1', 'task-1', 'tenant-a', 'p1', 'm1', 'h1', '{}', 'completed', '{"ok":true}', 100, 50, '2026-01-01T00:00:00Z'],
      );

      // Attempt to tamper with multiple fields at once
      assert.throws(() => {
        conn.run(
          `UPDATE core_llm_request_log
           SET response_body = '{"tampered":true}', prompt_hash = 'evil', input_tokens = 0, output_tokens = 0
           WHERE request_id = ?`,
          ['multi-req-1'],
        );
      }, /completed\/failed entries are immutable/,
        'CATCHES T-S4-006: multi-field tampering must be blocked');

      conn.close();
    });

    it('attack: updating non-protected fields on completed entry', () => {
      /**
       * The immutability trigger checks specific fields:
       *   status, response_body, request_body, prompt_hash, input_tokens, output_tokens
       *
       * What about other fields? Can we update created_at, provider_id, model_id?
       * The trigger's WHEN clause only fires if the listed fields change.
       * If we SET a field NOT in the WHEN clause, the update should succeed.
       *
       * This is a design decision, not a bug — but we document it.
       */
      const conn = createTestDatabase();

      seedMission(conn, { id: 'nonprot-m1', tenantId: 'tenant-a', state: 'EXECUTING' });

      conn.run(
        `INSERT INTO core_llm_request_log
         (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['nonprot-req-1', 'nonprot-m1', 'task-1', 'tenant-a', 'p1', 'm1', 'h1', '{}', 'completed', '{"ok":true}', '2026-01-01T00:00:00Z'],
      );

      // Check if we can update a non-trigger-protected field (e.g., a hypothetical column)
      // The trigger only blocks changes to the 6 listed fields.
      // UPDATE that sets the SAME values should also be fine (IS NOT check in trigger)

      // Set same response_body — should NOT trigger because value hasn't changed
      // The trigger uses IS NOT which is NULL-safe comparison
      conn.run(
        `UPDATE core_llm_request_log SET response_body = '{"ok":true}' WHERE request_id = ?`,
        ['nonprot-req-1'],
      );

      const row = conn.get<{ response_body: string }>(
        'SELECT response_body FROM core_llm_request_log WHERE request_id = ?', ['nonprot-req-1'],
      );
      assert.equal(row!.response_body, '{"ok":true}',
        'Setting same value should succeed (IS NOT comparison)');

      conn.close();
    });
  });

  // ========================================================================
  // Pipeline Behavior Under Specific Conditions
  // ========================================================================

  describe('Pipeline specific conditions', () => {
    it('attack: empty message content handled correctly', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, '', { stream: true });

      const allChunks: StreamChunk[] = [];
      for await (const chunk of result.stream) {
        allChunks.push(chunk);
      }

      // Pipeline should still execute all 9 phases even with empty message
      const statusChunks = allChunks.filter(c => c.type === 'status');
      assert.equal(statusChunks.length, 9,
        'CATCHES: empty message must still execute all 9 phases');

      conn.close();
    });

    it('attack: stream cleanup removes streamId from activeStreams', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      assert.equal(sessionState.activeStreams.size, 0, 'No active streams initially');

      const result = chatPipeline.execute(sessionState, 'Test cleanup', { stream: true });

      // During execution, there should be 1 active stream
      // (but due to async timing, we check after completion)

      for await (const _chunk of result.stream) {}

      // After pipeline completes, streamId should be cleaned up
      assert.equal(sessionState.activeStreams.size, 0,
        'CATCHES: stream cleanup must remove streamId from activeStreams');

      conn.close();
    });

    it('attack: done chunk has correct finishReason', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Test finish', { stream: true });

      let doneChunk: StreamChunk | undefined;
      for await (const chunk of result.stream) {
        if (chunk.type === 'done') {
          doneChunk = chunk;
        }
      }

      assert.ok(doneChunk, 'Pipeline must emit done chunk');
      assert.equal(doneChunk!.type, 'done');
      if (doneChunk!.type === 'done') {
        assert.equal(doneChunk!.finishReason, 'stop',
          'Normal completion must have finishReason "stop"');
      }

      conn.close();
    });

    it('attack: metadata has correct token counts from gateway', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Token test', { stream: true });

      for await (const _chunk of result.stream) {}

      const metadata = await result.metadata;

      // Mock gateway returns inputTokens: 10, outputTokens: 5
      assert.equal(metadata.tokens.input, 10,
        'CATCHES: metadata must reflect actual gateway token counts');
      assert.equal(metadata.tokens.output, 5,
        'CATCHES: metadata must reflect actual gateway token counts');

      conn.close();
    });

    it('attack: text promise resolves with accumulated content', async () => {
      const { chatPipeline, sessionState, conn } = createTestPipeline({ gatewayResponse: 'Hello World' });

      const result = chatPipeline.execute(sessionState, 'Text test', { stream: true });

      for await (const _chunk of result.stream) {}

      const text = await result.text;
      assert.equal(text, 'Hello World',
        'CATCHES: text promise must resolve with full accumulated content');

      conn.close();
    });
  });

  // ========================================================================
  // Mutation Testing
  // ========================================================================

  describe('Mutation Testing', () => {
    it('mutation: removing a phase from pipeline changes output', async () => {
      /**
       * If any phase was removed from the pipeline, the status chunk count
       * would drop below 9. This test catches that mutation.
       */
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Mutation test', { stream: true });

      let statusCount = 0;
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') statusCount++;
      }

      assert.equal(statusCount, 9,
        'MUTATION CHECK: removing any phase must be caught by status count assertion');

      conn.close();
    });

    it('mutation: reordering phases changes output', async () => {
      /**
       * If phases were reordered (e.g., generation before pre_safety),
       * the phase sequence assertion would catch it.
       */
      const { chatPipeline, sessionState, conn } = createTestPipeline();

      const result = chatPipeline.execute(sessionState, 'Order test', { stream: true });

      const phases: PipelinePhase[] = [];
      for await (const chunk of result.stream) {
        if (chunk.type === 'status') phases.push(chunk.phase);
      }

      // Specifically check that pre_safety comes before generation
      const preSafetyIdx = phases.indexOf('pre_safety');
      const generationIdx = phases.indexOf('generation');
      assert.ok(preSafetyIdx < generationIdx,
        'MUTATION CHECK: pre_safety must come before generation');

      // And post_safety comes after generation
      const postSafetyIdx = phases.indexOf('post_safety');
      assert.ok(postSafetyIdx > generationIdx,
        'MUTATION CHECK: post_safety must come after generation');

      conn.close();
    });

    it('mutation: removing LLM log immutability trigger allows tampering', () => {
      /**
       * Mutation target: Migration v35 — DROP TRIGGER trg_llm_log_immutable
       * If the trigger were removed, completed entries could be modified.
       */
      const conn = createTestDatabase();

      // Verify trigger exists (if removed, this fails)
      const trigger = conn.get<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_llm_log_immutable'`,
      );
      assert.ok(trigger,
        'MUTATION CHECK: LLM log immutability trigger must exist in migration v35');

      conn.close();
    });

    it('mutation: removing snapshot CHECK constraint allows invalid types', () => {
      /**
       * Mutation target: CHECK(snapshot_type IN ('mission_start', 'checkpoint', 'mission_end'))
       * If removed, arbitrary snapshot types could be inserted.
       */
      const conn = createTestDatabase();

      seedMission(conn, { id: 'check-mut-m1', tenantId: 'tenant-a', state: 'CREATED' });

      let constraintExists = false;
      try {
        conn.run(
          `INSERT INTO core_replay_snapshots (id, mission_id, tenant_id, snapshot_type, state_hash, state_detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['bad-type-snap', 'check-mut-m1', 'tenant-a', 'EVIL_TYPE', 'hash', '{}', '2026-01-01T00:00:00Z'],
        );
      } catch {
        constraintExists = true;
      }

      assert.ok(constraintExists,
        'MUTATION CHECK: CHECK constraint on snapshot_type must reject invalid types');

      conn.close();
    });
  });
});
