/**
 * Limen — Phase 4E-R2 Remediation Tests
 *
 * Discriminative tests for findings BRK-IMPL-002, BRK-IMPL-004,
 * BRK-IMPL-005, BRK-IMPL-006. Each test fails if the fix is removed.
 *
 * S ref: S29.7 (quarantine), S29.8 (transfer), S29.6 (retirement),
 *        S29.9 (cold-start), I-07 (agent isolation)
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
} from '../../src/learning/interfaces/index.js';
import type { EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';
import type { TechniqueId } from '../../src/learning/interfaces/index.js';

// ─── Constants ───

const TEST_TENANT = tenantId('test-tenant');
const TEST_TENANT_B = tenantId('test-tenant-b');
const TEST_AGENT = agentId('test-agent');
const TEST_AGENT_B = agentId('test-agent-b');

// ─── Helpers ───

function createMockLlmGateway(): LlmGateway {
  return {
    request: async () => ({
      ok: true as const,
      value: {
        content: JSON.stringify({
          type: 'prompt_fragment',
          content: 'test technique',
          confidence: 0.7,
          applicability: 'test',
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

function createCtxForTenant(tenant: string) {
  return createTestOperationContext({ tenantId: tenant });
}

// ═══════════════════════════════════════════════════════════════
// FIX-1: BRK-IMPL-002 — Tenant scoping on resolve/approve/reject
// ═══════════════════════════════════════════════════════════════

describe('BRK-IMPL-002: Cross-tenant isolation on resolve/approve/reject', () => {

  it('quarantine resolve: Tenant B cannot resolve Tenant A entry', () => {
    const { ls, conn } = createTestLearningSystem();
    const ctxA = createCtxForTenant('test-tenant');
    const ctxB = createCtxForTenant('test-tenant-b');

    // Create technique for Tenant A
    const createResult = ls.store.create(conn, ctxA, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Tenant A technique for quarantine.',
      sourceMemoryIds: ['mem-q-001'],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Quarantine it under Tenant A context
    const quarResult = ls.quarantine.quarantine(conn, ctxA,
      [createResult.value.id], TEST_TENANT, 'suspected poisoning');
    assert.strictEqual(quarResult.ok, true);
    if (!quarResult.ok) return;
    assert.strictEqual(quarResult.value.length, 1);

    const entryId = quarResult.value[0].id;

    // Tenant B tries to resolve Tenant A's quarantine entry
    const resolveResult = ls.quarantine.resolve(conn, ctxB, entryId, 'reactivated');

    // Must fail — entry not found for Tenant B's tenant scope
    assert.strictEqual(resolveResult.ok, false,
      'Tenant B must NOT be able to resolve Tenant A quarantine entry');
    if (!resolveResult.ok) {
      assert.strictEqual(resolveResult.error.code, 'QUARANTINE_ENTRY_NOT_FOUND');
    }

    // Verify entry is still pending (not resolved by Tenant B)
    const pending = ls.quarantine.getPending(conn, TEST_TENANT);
    assert.strictEqual(pending.ok, true);
    if (!pending.ok) return;
    assert.strictEqual(pending.value.length, 1, 'entry must still be pending');
  });

  it('transfer approve: Tenant B cannot approve Tenant A transfer', () => {
    const { ls, conn } = createTestLearningSystem();
    const ctxA = createCtxForTenant('test-tenant');
    const ctxB = createCtxForTenant('test-tenant-b');

    // Create qualified technique for Tenant A
    const createResult = ls.store.create(conn, ctxA, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Transfer candidate technique.',
      sourceMemoryIds: ['mem-t-001'],
      initialConfidence: 0.9,
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Qualify for transfer
    ls.store.update(conn, ctxA, createResult.value.id, TEST_TENANT, {
      confidence: 0.9, successRate: 0.8, applicationCount: 55,
    });

    // Request transfer within Tenant A
    const requestResult = ls.transfer.requestTransfer(conn, ctxA, {
      tenantId: TEST_TENANT,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      sourceTechniqueId: createResult.value.id,
    });
    assert.strictEqual(requestResult.ok, true);
    if (!requestResult.ok) return;

    const requestId = requestResult.value;

    // Tenant B tries to approve Tenant A's transfer
    const approveResult = ls.transfer.approveTransfer(conn, ctxB, requestId);

    // Must fail — request not found for Tenant B's scope
    assert.strictEqual(approveResult.ok, false,
      'Tenant B must NOT be able to approve Tenant A transfer');
    if (!approveResult.ok) {
      assert.strictEqual(approveResult.error.code, 'TRANSFER_REQUEST_NOT_FOUND');
    }
  });

  it('transfer reject: Tenant B cannot reject Tenant A transfer', () => {
    const { ls, conn } = createTestLearningSystem();
    const ctxA = createCtxForTenant('test-tenant');
    const ctxB = createCtxForTenant('test-tenant-b');

    // Create qualified technique for Tenant A
    const createResult = ls.store.create(conn, ctxA, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Transfer reject test technique.',
      sourceMemoryIds: ['mem-tr-001'],
      initialConfidence: 0.9,
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Qualify for transfer
    ls.store.update(conn, ctxA, createResult.value.id, TEST_TENANT, {
      confidence: 0.9, successRate: 0.8, applicationCount: 55,
    });

    // Request transfer within Tenant A
    const requestResult = ls.transfer.requestTransfer(conn, ctxA, {
      tenantId: TEST_TENANT,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      sourceTechniqueId: createResult.value.id,
    });
    assert.strictEqual(requestResult.ok, true);
    if (!requestResult.ok) return;

    const requestId = requestResult.value;

    // Tenant B tries to reject Tenant A's transfer
    const rejectResult = ls.transfer.rejectTransfer(conn, ctxB, requestId);

    // Must fail — request not found for Tenant B's scope
    assert.strictEqual(rejectResult.ok, false,
      'Tenant B must NOT be able to reject Tenant A transfer');
    if (!rejectResult.ok) {
      assert.strictEqual(rejectResult.error.code, 'TRANSFER_REQUEST_NOT_FOUND');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// FIX-2: BRK-IMPL-005 — Retirement skips suspended techniques
// ═══════════════════════════════════════════════════════════════

describe('BRK-IMPL-005: Retirement evaluateAll skips suspended techniques', () => {

  it('suspended technique excluded from evaluateAll even with terrible metrics', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create technique with terrible metrics that would normally trigger retirement
    const createResult = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Terrible suspended technique.',
      sourceMemoryIds: ['mem-sus-001'],
      initialConfidence: 0.1,
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Set terrible metrics
    ls.store.update(conn, ctx, createResult.value.id, TEST_TENANT, {
      confidence: 0.1,
      successRate: 0.1,
      applicationCount: 100,
    });

    // Quarantine (suspends) the technique
    const quarResult = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'suspected poisoning');
    assert.strictEqual(quarResult.ok, true);

    // Verify technique is now suspended
    const technique = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.strictEqual(technique.value.status, 'suspended');

    // Run retirement evaluateAll
    const retireResult = ls.retirement.evaluateAll(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(retireResult.ok, true);
    if (!retireResult.ok) return;

    // Suspended technique must NOT appear in evaluation results
    const found = retireResult.value.find(
      d => d.techniqueId === createResult.value.id
    );
    assert.strictEqual(found, undefined,
      'suspended technique must be excluded from retirement evaluation');
  });

  it('quarantine → retirement → resolve interaction: suspended skipped, active evaluated', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create two techniques with bad metrics
    const t1 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'prompt_fragment',
      content: 'Active bad technique', sourceMemoryIds: ['mem-int-1'],
      initialConfidence: 0.1,
    });
    const t2 = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT, agentId: TEST_AGENT, type: 'decision_rule',
      content: 'Suspended bad technique', sourceMemoryIds: ['mem-int-2'],
      initialConfidence: 0.1,
    });
    assert.strictEqual(t1.ok, true);
    assert.strictEqual(t2.ok, true);
    if (!t1.ok || !t2.ok) return;

    // Both get terrible metrics
    ls.store.update(conn, ctx, t1.value.id, TEST_TENANT, { applicationCount: 25 });
    ls.store.update(conn, ctx, t2.value.id, TEST_TENANT, { applicationCount: 25 });

    // Quarantine t2 (suspends it)
    ls.quarantine.quarantine(conn, ctx, [t2.value.id], TEST_TENANT, 'investigation');

    // Evaluate — only t1 (active) should appear, not t2 (suspended)
    const result = ls.retirement.evaluateAll(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    const t1Decision = result.value.find(d => d.techniqueId === t1.value.id);
    const t2Decision = result.value.find(d => d.techniqueId === t2.value.id);

    assert.ok(t1Decision, 't1 (active) must be in evaluation results');
    assert.strictEqual(t1Decision!.shouldRetire, true, 't1 should be retired (low confidence)');
    assert.strictEqual(t2Decision, undefined, 't2 (suspended) must NOT be in evaluation results');
  });
});

// ═══════════════════════════════════════════════════════════════
// FIX-3: BRK-IMPL-006 — resolve() checks return values
// ═══════════════════════════════════════════════════════════════

describe('BRK-IMPL-006: resolve() checks store operation return values', () => {

  it('resolve as reactivated fails when technique already retired', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create and quarantine a technique
    const createResult = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Soon to be retired via quarantine test.',
      sourceMemoryIds: ['mem-r006-001'],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const quarResult = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'investigation');
    assert.strictEqual(quarResult.ok, true);
    if (!quarResult.ok) return;

    const entryId = quarResult.value[0].id;

    // Manually retire the technique (simulating out-of-band retirement)
    const retireResult = ls.store.retire(conn, ctx,
      createResult.value.id, TEST_TENANT,
      'human_flagged' as import('../../src/learning/interfaces/index.js').RetirementReason);
    assert.strictEqual(retireResult.ok, true);

    // Now try to resolve quarantine as 'reactivated' — should fail
    // because the technique is already retired (I-10: terminal state)
    const resolveResult = ls.quarantine.resolve(conn, ctx, entryId, 'reactivated');
    assert.strictEqual(resolveResult.ok, false,
      'resolve must fail when technique cannot be reactivated');
    if (!resolveResult.ok) {
      assert.strictEqual(resolveResult.error.code, 'TECHNIQUE_STATE_CHANGED');
    }

    // Verify quarantine entry is still pending (not incorrectly resolved)
    const pending = ls.quarantine.getPending(conn, TEST_TENANT);
    assert.strictEqual(pending.ok, true);
    if (!pending.ok) return;
    const stillPending = pending.value.find(e => e.id === entryId);
    assert.ok(stillPending, 'quarantine entry must still be pending');
  });

  it('resolve as permanently_retired fails when technique already retired', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create and quarantine a technique
    const createResult = ls.store.create(conn, ctx, {
      tenantId: TEST_TENANT,
      agentId: TEST_AGENT,
      type: 'prompt_fragment',
      content: 'Double-retire test.',
      sourceMemoryIds: ['mem-r006-002'],
      initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    });
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const quarResult = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'poisoning');
    assert.strictEqual(quarResult.ok, true);
    if (!quarResult.ok) return;

    const entryId = quarResult.value[0].id;

    // Retire via store directly
    ls.store.retire(conn, ctx, createResult.value.id, TEST_TENANT,
      'low_confidence' as import('../../src/learning/interfaces/index.js').RetirementReason);

    // Try to resolve quarantine as permanently_retired — should fail
    // because store.retire returns ALREADY_RETIRED
    const resolveResult = ls.quarantine.resolve(conn, ctx, entryId, 'permanently_retired');
    assert.strictEqual(resolveResult.ok, false,
      'resolve must fail when technique already retired');
    if (!resolveResult.ok) {
      assert.strictEqual(resolveResult.error.code, 'TECHNIQUE_STATE_CHANGED');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// FIX-4: BRK-IMPL-004 — Cold-start idempotency
// ═══════════════════════════════════════════════════════════════

describe('BRK-IMPL-004: Cold-start template idempotency', () => {

  it('second applyTemplate returns existing techniques, count unchanged', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // First application
    const result1 = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'customer-support');
    assert.strictEqual(result1.ok, true);
    if (!result1.ok) return;
    const count1 = result1.value.length;
    assert.ok(count1 > 0, 'first application must create techniques');

    // Second application — same template, same agent
    const result2 = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'customer-support');
    assert.strictEqual(result2.ok, true);
    if (!result2.ok) return;

    // Must return same count
    assert.strictEqual(result2.value.length, count1,
      'second application must return same technique count');

    // Must return same IDs
    const ids1 = result1.value.map(t => t.id).sort();
    const ids2 = result2.value.map(t => t.id).sort();
    assert.deepStrictEqual(ids2, ids1,
      'second application must return the same technique IDs');

    // Total in store must be count1 (not 2×count1)
    const allResult = ls.store.getByAgent(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(allResult.ok, true);
    if (!allResult.ok) return;
    assert.strictEqual(allResult.value.length, count1,
      'total technique count must not increase on second application');
  });

  it('different agents can apply same template independently', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Agent A applies template
    const resultA = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'code-assistant');
    assert.strictEqual(resultA.ok, true);
    if (!resultA.ok) return;

    // Agent B applies same template — should create new techniques (different agent)
    const resultB = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT_B, TEST_TENANT, 'code-assistant');
    assert.strictEqual(resultB.ok, true);
    if (!resultB.ok) return;

    // Both should have techniques
    assert.strictEqual(resultB.value.length, resultA.value.length);

    // IDs must be different (different agents)
    const idsA = new Set(resultA.value.map(t => t.id));
    for (const t of resultB.value) {
      assert.ok(!idsA.has(t.id), 'Agent B techniques must have different IDs from Agent A');
    }
  });
});
