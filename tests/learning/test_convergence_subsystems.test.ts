/**
 * Limen — Phase 4E-2e Convergence Subsystem Edge-Case Tests
 *
 * Supplementary tests for QuarantineManager, CrossAgentTransfer,
 * OverSpecializationDetector, and ColdStartManager.
 *
 * These tests go beyond the contract tests to exercise edge cases,
 * boundary conditions, and defensive behaviors.
 *
 * S ref: S29.7 (quarantine), S29.8 (transfer), S29.9 (cold-start),
 *        S29.10 (over-specialization), FM-01, FM-07, I-07, I-10
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
  CONFIDENCE_RESET_TRANSFER,
  CONFIDENCE_RESET_REACTIVATION,
  OVERSPECIALIZATION_THRESHOLD,
  TRANSFER_MIN_CONFIDENCE,
  TRANSFER_MIN_SUCCESS_RATE,
  TRANSFER_MIN_APPLICATIONS,
} from '../../src/learning/interfaces/index.js';
import type {
  TechniqueCreateInput,
  TransferRequest,
} from '../../src/learning/interfaces/index.js';
import type { EventBus, RbacEngine, RateLimiter } from '../../src/kernel/interfaces/index.js';
import type { LlmGateway } from '../../src/substrate/interfaces/substrate.js';

// ─── Test Constants ───

const TEST_TENANT = tenantId('test-tenant');
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
          content: 'Test technique content.',
          confidence: 0.7,
          applicability: 'Test context',
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

function createValidInput(overrides?: Partial<TechniqueCreateInput>): TechniqueCreateInput {
  return {
    tenantId: TEST_TENANT,
    agentId: TEST_AGENT,
    type: 'prompt_fragment',
    content: 'Test technique content for edge-case testing.',
    sourceMemoryIds: ['mem-edge-001', 'mem-edge-002'],
    initialConfidence: INITIAL_CONFIDENCE_EXTRACTED,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// QUARANTINE MANAGER — Edge Cases (S29.7, FM-01)
// ═══════════════════════════════════════════════════════════════

describe('QuarantineManager — Edge Cases', () => {

  it('quarantine with empty technique list succeeds with empty entries', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.quarantine.quarantine(conn, ctx, [], TEST_TENANT, 'empty cascade test');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'no techniques = no entries');
  });

  it('quarantine skips retired techniques (FS-04)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create and retire a technique
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.store.suspend(conn, ctx, createResult.value.id, TEST_TENANT);
    ls.store.retire(conn, ctx, createResult.value.id, TEST_TENANT, 'low_success_rate');

    // Quarantine the retired technique — should be skipped
    const result = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'FM-01 cascade'
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 0, 'retired technique must be skipped');
  });

  it('quarantine creates entry for already-suspended technique without double-suspending', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create and suspend a technique
    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    ls.store.suspend(conn, ctx, createResult.value.id, TEST_TENANT);

    // Quarantine the already-suspended technique — entry created, no double-suspend
    const result = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'FM-01 cascade'
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 1, 'entry created for suspended technique');
    assert.strictEqual(result.value[0].resolution, null, 'entry unresolved');
  });

  it('quarantine cascade across agents within same tenant', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create techniques for two different agents
    const t1 = ls.store.create(conn, ctx, createValidInput({ agentId: TEST_AGENT }));
    const t2 = ls.store.create(conn, ctx, createValidInput({ agentId: TEST_AGENT_B }));
    assert.strictEqual(t1.ok, true);
    assert.strictEqual(t2.ok, true);
    if (!t1.ok || !t2.ok) return;

    // Quarantine both — cross-agent within tenant (D4)
    const result = ls.quarantine.quarantine(
      conn, ctx, [t1.value.id, t2.value.id], TEST_TENANT, 'memory poisoning cascade'
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, 2, 'both agents techniques quarantined');

    // Verify both techniques are now suspended
    const get1 = ls.store.get(conn, t1.value.id, TEST_TENANT, TEST_AGENT);
    const get2 = ls.store.get(conn, t2.value.id, TEST_TENANT, TEST_AGENT_B);
    assert.strictEqual(get1.ok, true);
    assert.strictEqual(get2.ok, true);
    if (get1.ok) assert.strictEqual(get1.value.status, 'suspended');
    if (get2.ok) assert.strictEqual(get2.value.status, 'suspended');
  });

  it('resolve with reactivation resets confidence to 0.3', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    // Quarantine → resolve as reactivated
    const qResult = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'FM-01 investigation'
    );
    assert.strictEqual(qResult.ok, true);
    if (!qResult.ok) return;

    const resolveResult = ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'reactivated');
    assert.strictEqual(resolveResult.ok, true);

    // Verify technique is active again with reset confidence
    const technique = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.strictEqual(technique.value.status, 'active');
    assert.strictEqual(technique.value.confidence, CONFIDENCE_RESET_REACTIVATION);
    assert.strictEqual(CONFIDENCE_RESET_REACTIVATION, 0.3, 'reactivation confidence must be 0.3');
  });

  it('resolve with permanent_retirement retires the technique', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const qResult = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'FM-01 confirmed poisoning'
    );
    assert.strictEqual(qResult.ok, true);
    if (!qResult.ok) return;

    const resolveResult = ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'permanently_retired');
    assert.strictEqual(resolveResult.ok, true);

    // Verify technique is retired (I-10: terminal state)
    const technique = ls.store.get(conn, createResult.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(technique.ok, true);
    if (!technique.ok) return;
    assert.strictEqual(technique.value.status, 'retired');
  });

  it('resolve already-resolved entry returns error', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const createResult = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    const qResult = ls.quarantine.quarantine(
      conn, ctx, [createResult.value.id], TEST_TENANT, 'FM-01'
    );
    assert.strictEqual(qResult.ok, true);
    if (!qResult.ok) return;

    // Resolve once
    ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'reactivated');

    // Resolve again — should fail
    const doubleResolve = ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'permanently_retired');
    assert.strictEqual(doubleResolve.ok, false);
    if (!doubleResolve.ok) {
      assert.strictEqual(doubleResolve.error.code, 'ALREADY_RESOLVED');
    }
  });

  it('getPending returns only unresolved entries', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const t1 = ls.store.create(conn, ctx, createValidInput());
    const t2 = ls.store.create(conn, ctx, createValidInput({ content: 'second technique' }));
    assert.strictEqual(t1.ok, true);
    assert.strictEqual(t2.ok, true);
    if (!t1.ok || !t2.ok) return;

    const qResult = ls.quarantine.quarantine(
      conn, ctx, [t1.value.id, t2.value.id], TEST_TENANT, 'cascade'
    );
    assert.strictEqual(qResult.ok, true);
    if (!qResult.ok) return;

    // Resolve first entry
    ls.quarantine.resolve(conn, ctx, qResult.value[0].id, 'reactivated');

    // getPending should return only the second
    const pending = ls.quarantine.getPending(conn, TEST_TENANT);
    assert.strictEqual(pending.ok, true);
    if (!pending.ok) return;
    assert.strictEqual(pending.value.length, 1);
    assert.strictEqual(pending.value[0].techniqueId, t2.value.id);
  });

  it('resolve nonexistent entry returns QUARANTINE_ENTRY_NOT_FOUND', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.quarantine.resolve(conn, ctx, 'nonexistent-id', 'reactivated');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'QUARANTINE_ENTRY_NOT_FOUND');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// CROSS-AGENT TRANSFER — Edge Cases (S29.8)
// ═══════════════════════════════════════════════════════════════

describe('CrossAgentTransfer — Edge Cases', () => {

  function qualifyTechnique(ls: ReturnType<typeof createTestLearningSystem>['ls'],
    conn: ReturnType<typeof createTestLearningSystem>['conn'],
    ctx: ReturnType<typeof createTestLearningSystem>['ctx'],
    techniqueId: string) {
    ls.store.update(conn, ctx, techniqueId as any, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.8,
      applicationCount: 55,
    });
  }

  it('requestTransfer rejects technique below confidence threshold', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    // Only boost success_rate and applicationCount — confidence stays at 0.5
    ls.store.update(conn, ctx, t.value.id, TEST_TENANT, {
      successRate: 0.8,
      applicationCount: 55,
    });

    const result = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(result.ok, false, 'confidence below threshold must reject');
  });

  it('requestTransfer rejects technique below success_rate threshold', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    ls.store.update(conn, ctx, t.value.id, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.5, // below 0.7
      applicationCount: 55,
    });

    const result = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(result.ok, false, 'success_rate below threshold must reject');
  });

  it('requestTransfer rejects technique below applicationCount threshold', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    ls.store.update(conn, ctx, t.value.id, TEST_TENANT, {
      confidence: 0.9,
      successRate: 0.8,
      applicationCount: 30, // below 50
    });

    const result = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(result.ok, false, 'applicationCount below threshold must reject');
  });

  it('requestTransfer rejects suspended technique', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    qualifyTechnique(ls, conn, ctx, t.value.id);
    ls.store.suspend(conn, ctx, t.value.id, TEST_TENANT);

    const result = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(result.ok, false, 'suspended technique must not be transferable');
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'TECHNIQUE_NOT_ACTIVE');
    }
  });

  it('requestTransfer rejects nonexistent technique', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: 'nonexistent-id' as any,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'TECHNIQUE_NOT_FOUND');
    }
  });

  it('requestTransfer rejects agent mismatch (I-07)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput({ agentId: TEST_AGENT }));
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    qualifyTechnique(ls, conn, ctx, t.value.id);

    // Claim agent B owns the technique — but agent A does
    const result = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT_B, // wrong agent
      targetAgentId: TEST_AGENT,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'AGENT_MISMATCH');
    }
  });

  it('approveTransfer on nonexistent request returns error', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.transfer.approveTransfer(conn, ctx, 'nonexistent-request-id');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'TRANSFER_REQUEST_NOT_FOUND');
    }
  });

  it('approveTransfer on already-approved request returns error', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    qualifyTechnique(ls, conn, ctx, t.value.id);

    const reqResult = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(reqResult.ok, true);
    if (!reqResult.ok) return;

    // Approve once
    const approve1 = ls.transfer.approveTransfer(conn, ctx, reqResult.value);
    assert.strictEqual(approve1.ok, true);

    // Approve again — should fail
    const approve2 = ls.transfer.approveTransfer(conn, ctx, reqResult.value);
    assert.strictEqual(approve2.ok, false);
    if (!approve2.ok) {
      assert.strictEqual(approve2.error.code, 'TRANSFER_NOT_PENDING');
    }
  });

  it('rejectTransfer on nonexistent request returns error', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.transfer.rejectTransfer(conn, ctx, 'nonexistent-request-id');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'TRANSFER_REQUEST_NOT_FOUND');
    }
  });

  it('rejectTransfer on already-rejected request returns error', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    qualifyTechnique(ls, conn, ctx, t.value.id);

    const reqResult = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(reqResult.ok, true);
    if (!reqResult.ok) return;

    ls.transfer.rejectTransfer(conn, ctx, reqResult.value);
    const doubleReject = ls.transfer.rejectTransfer(conn, ctx, reqResult.value);
    assert.strictEqual(doubleReject.ok, false);
    if (!doubleReject.ok) {
      assert.strictEqual(doubleReject.error.code, 'TRANSFER_NOT_PENDING');
    }
  });

  it('source technique is unaffected after transfer (clone, not move)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const t = ls.store.create(conn, ctx, createValidInput());
    assert.strictEqual(t.ok, true);
    if (!t.ok) return;

    qualifyTechnique(ls, conn, ctx, t.value.id);

    const reqResult = ls.transfer.requestTransfer(conn, ctx, {
      sourceTechniqueId: t.value.id,
      sourceAgentId: TEST_AGENT,
      targetAgentId: TEST_AGENT_B,
      tenantId: TEST_TENANT,
    });
    assert.strictEqual(reqResult.ok, true);
    if (!reqResult.ok) return;

    ls.transfer.approveTransfer(conn, ctx, reqResult.value);

    // Source technique still exists and is active
    const source = ls.store.get(conn, t.value.id, TEST_TENANT, TEST_AGENT);
    assert.strictEqual(source.ok, true);
    if (!source.ok) return;
    assert.strictEqual(source.value.status, 'active');
    assert.strictEqual(source.value.agentId, TEST_AGENT);
  });
});

// ═══════════════════════════════════════════════════════════════
// OVER-SPECIALIZATION DETECTOR — Edge Cases (S29.10, FM-07)
// ═══════════════════════════════════════════════════════════════

describe('OverSpecializationDetector — Edge Cases', () => {

  it('N=0: no techniques → score 0.0, not over-specialized', () => {
    const { ls, conn } = createTestLearningSystem();
    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.specializationScore, 0.0);
    assert.strictEqual(result.value.overSpecialized, false);
  });

  it('N=1: single type → score 1.0, maximally specialized', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create 3 techniques all of same type
    for (let i = 0; i < 3; i++) {
      ls.store.create(conn, ctx, createValidInput({
        type: 'prompt_fragment',
        content: `single-type technique ${i}`,
      }));
    }

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.specializationScore, 1.0);
    assert.strictEqual(result.value.overSpecialized, 1.0 > OVERSPECIALIZATION_THRESHOLD);
  });

  it('uniform distribution → score near 0.0 (maximum diversity)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Create exactly one of each type
    ls.store.create(conn, ctx, createValidInput({ type: 'prompt_fragment', content: 'pf-uniform' }));
    ls.store.create(conn, ctx, createValidInput({ type: 'decision_rule', content: 'dr-uniform' }));
    ls.store.create(conn, ctx, createValidInput({ type: 'rag_pattern', content: 'rp-uniform' }));

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Perfect uniform → H = log(N), score = 1 - log(N)/log(N) = 0.0
    assert.ok(Math.abs(result.value.specializationScore) < 1e-10,
      `uniform distribution should have score ≈ 0.0, got ${result.value.specializationScore}`);
    assert.strictEqual(result.value.overSpecialized, false);
  });

  it('skewed distribution → score between 0 and 1', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // 8 prompt_fragment, 1 decision_rule, 1 rag_pattern
    for (let i = 0; i < 8; i++) {
      ls.store.create(conn, ctx, createValidInput({ type: 'prompt_fragment', content: `pf-skewed-${i}` }));
    }
    ls.store.create(conn, ctx, createValidInput({ type: 'decision_rule', content: 'dr-skewed' }));
    ls.store.create(conn, ctx, createValidInput({ type: 'rag_pattern', content: 'rp-skewed' }));

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.value.specializationScore > 0.0, 'skewed must be > 0');
    assert.ok(result.value.specializationScore < 1.0, 'skewed must be < 1');
  });

  it('typeDistribution counts are correct', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    ls.store.create(conn, ctx, createValidInput({ type: 'prompt_fragment', content: 'pf-1' }));
    ls.store.create(conn, ctx, createValidInput({ type: 'prompt_fragment', content: 'pf-2' }));
    ls.store.create(conn, ctx, createValidInput({ type: 'decision_rule', content: 'dr-1' }));

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.typeDistribution.prompt_fragment, 2);
    assert.strictEqual(result.value.typeDistribution.decision_rule, 1);
    assert.strictEqual(result.value.typeDistribution.rag_pattern, 0);
  });

  it('only counts active techniques (suspended excluded)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const t1 = ls.store.create(conn, ctx, createValidInput({ type: 'prompt_fragment', content: 'pf-active' }));
    const t2 = ls.store.create(conn, ctx, createValidInput({ type: 'decision_rule', content: 'dr-suspend' }));
    assert.strictEqual(t1.ok, true);
    assert.strictEqual(t2.ok, true);
    if (!t1.ok || !t2.ok) return;

    ls.store.suspend(conn, ctx, t2.value.id, TEST_TENANT);

    const result = ls.specialization.analyze(conn, TEST_AGENT, TEST_TENANT);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    // Only 1 active technique (prompt_fragment) → N=1 → score=1.0
    assert.strictEqual(result.value.specializationScore, 1.0);
    assert.strictEqual(result.value.typeDistribution.prompt_fragment, 1);
    assert.strictEqual(result.value.typeDistribution.decision_rule, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// COLD-START MANAGER — Edge Cases (S29.9)
// ═══════════════════════════════════════════════════════════════

describe('ColdStartManager — Edge Cases', () => {

  it('applyTemplate with unknown templateId returns TEMPLATE_NOT_FOUND', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'nonexistent-template');
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, 'TEMPLATE_NOT_FOUND');
    }
  });

  it('all templates have version >= 1 (BRK-S29-001)', () => {
    const { ls } = createTestLearningSystem();
    const result = ls.coldStart.getAvailableTemplates();
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    for (const t of result.value) {
      assert.ok(t.version >= 1, `template ${t.templateId} version must be >= 1, got ${t.version}`);
    }
  });

  it('all 5 spec templates exist', () => {
    const { ls } = createTestLearningSystem();
    const result = ls.coldStart.getAvailableTemplates();
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    const ids = new Set(result.value.map(t => t.templateId));
    const specTemplates = ['customer-support', 'document-qa', 'code-assistant', 'claims-processor', 'research-analyst'];
    for (const id of specTemplates) {
      assert.ok(ids.has(id), `spec template '${id}' must exist`);
    }
  });

  it('every template has all 3 technique types', () => {
    const { ls } = createTestLearningSystem();
    const result = ls.coldStart.getAvailableTemplates();
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    for (const template of result.value) {
      const types = new Set(template.techniques.map(t => t.type));
      assert.ok(types.has('prompt_fragment'),
        `template ${template.templateId} must have prompt_fragment`);
      assert.ok(types.has('decision_rule'),
        `template ${template.templateId} must have decision_rule`);
      assert.ok(types.has('rag_pattern'),
        `template ${template.templateId} must have rag_pattern`);
    }
  });

  it('applyTemplate creates correct number of techniques', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    // Get expected count from template
    const templates = ls.coldStart.getAvailableTemplates();
    assert.strictEqual(templates.ok, true);
    if (!templates.ok) return;

    const salesTemplate = templates.value.find(t => t.templateId === 'sales-default');
    assert.ok(salesTemplate, 'sales-default must exist');

    const result = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'sales-default');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;
    assert.strictEqual(result.value.length, salesTemplate!.techniques.length,
      'created technique count must match template technique count');
  });

  it('cold-start techniques have template-based provenance', () => {
    const { ls, conn, ctx } = createTestLearningSystem();
    const result = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'sales-default');
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    for (const t of result.value) {
      assert.ok(t.sourceMemoryIds.length > 0, 'cold-start technique must have provenance');
      assert.ok(
        t.sourceMemoryIds.some(id => id.includes('cold-start:template:')),
        'provenance must reference template origin'
      );
    }
  });

  it('duplicate application returns existing techniques (idempotent, BRK-IMPL-004)', () => {
    const { ls, conn, ctx } = createTestLearningSystem();

    const result1 = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'sales-default');
    assert.strictEqual(result1.ok, true);
    if (!result1.ok) return;

    const result2 = ls.coldStart.applyTemplate(conn, ctx, TEST_AGENT, TEST_TENANT, 'sales-default');
    assert.strictEqual(result2.ok, true);
    if (!result2.ok) return;

    // Same techniques returned — idempotent
    assert.strictEqual(result2.value.length, result1.value.length,
      'second application must return same count');

    // IDs must match (same techniques, not new ones)
    const ids1 = result1.value.map(t => t.id).sort();
    const ids2 = result2.value.map(t => t.id).sort();
    assert.deepStrictEqual(ids2, ids1,
      'second application must return the same technique IDs');
  });
});
