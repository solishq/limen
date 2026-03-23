/**
 * Layer 3: Mutation Tests
 * Proves the test suite itself is protective by demonstrating that WITHOUT
 * the TenantScopedConnection facade, cross-tenant access SUCCEEDS.
 *
 * For each critical query path:
 * (a) RAW connection: cross-tenant access SUCCEEDS (the "mutant" — facade removed)
 * (b) SCOPED connection: cross-tenant access FAILS (the facade catches it)
 *
 * If (a) doesn't succeed, the test is useless — it would pass even without the facade.
 * If (b) doesn't fail, the facade is broken.
 * Together, they prove the facade IS the enforcement mechanism.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * FM-10: "query-level tenant filtering"
 * Design Layer 3: "verify that REMOVING the tenant_id predicate causes the test to fail"
 *
 * Phase: 4B (Certification — Tenant Isolation)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  createScopedTestDeps,
  seedMission,
  seedResource,
  tenantId,
} from '../helpers/test_database.js';
import {
  createTestOperationContext,
} from '../helpers/test_database.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import { createConversationManager } from '../../src/orchestration/conversation/conversation_manager.js';
import type { OrchestrationDeps } from '../../src/orchestration/interfaces/orchestration.js';
import type { MissionId, ArtifactId } from '../../src/kernel/interfaces/index.js';

// ─── Constants ───

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

// ─── Helper: raw deps (no facade — the "mutant") ───

function createSubstrateStub(): OrchestrationDeps['substrate'] {
  const notImplemented = () => { throw new Error('Substrate stub'); };
  return {
    scheduler: { enqueue: notImplemented, dequeue: notImplemented, peek: notImplemented, size: notImplemented, clear: notImplemented },
    workerPool: { dispatch: notImplemented, getWorker: notImplemented, shutdown: notImplemented, getMetrics: notImplemented },
    gateway: { sendRequest: notImplemented, requestStream: notImplemented, getProviderHealth: notImplemented, registerProvider: notImplemented },
    heartbeat: { start: notImplemented, stop: notImplemented, check: notImplemented, getStatus: notImplemented },
    accounting: { recordInteraction: notImplemented, getAccountingSummary: notImplemented, checkRateLimit: notImplemented, consumeRateLimit: notImplemented },
    shutdown: notImplemented,
  } as unknown as OrchestrationDeps['substrate'];
}

function createRawDeps(rawConn: ReturnType<typeof createTestDatabase>): OrchestrationDeps {
  return Object.freeze({
    conn: rawConn,
    substrate: createSubstrateStub(),
    audit: createTestAuditTrail(),
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  });
}

// ─── Layer 3: Mutation Tests ───

describe('Layer 3: Mutation Tests — Proving facade IS the enforcement', () => {

  // Mutation 1: mission_store.get()
  it('#1: mission_store.get() — without facade, cross-tenant read SUCCEEDS', () => {
    const rawConn = createTestDatabase('row-level');
    const missions = createMissionStore();

    seedMission(rawConn, { id: 'mission-mut-1', tenantId: TENANT_A });

    // (a) RAW connection (mutant — facade removed): tenant-B CAN read tenant-A mission
    const rawDeps = createRawDeps(rawConn);
    const rawResult = missions.get(rawDeps, 'mission-mut-1' as MissionId);
    assert.equal(rawResult.ok, true,
      'MUTANT: Without facade, cross-tenant mission read must SUCCEED — proving isolation is NOT in the module');

    // (b) SCOPED connection (facade active): tenant-B CANNOT read tenant-A mission
    const { deps: scopedDeps } = createScopedTestDeps(rawConn, TENANT_B);
    const scopedResult = missions.get(scopedDeps, 'mission-mut-1' as MissionId);
    assert.equal(scopedResult.ok, false,
      'PROTECTED: With facade, cross-tenant mission read must FAIL — proving the facade provides isolation');

    rawConn.close();
  });

  // Mutation 2: mission_store.transition()
  it('#2: mission_store.transition() — without facade, cross-tenant mutation SUCCEEDS', () => {
    const rawConn = createTestDatabase('row-level');
    const missions = createMissionStore();

    seedMission(rawConn, { id: 'mission-mut-2', tenantId: TENANT_A, state: 'CREATED' });

    // (a) RAW connection (mutant): tenant-B CAN transition tenant-A mission
    const rawDeps = createRawDeps(rawConn);
    const rawResult = missions.transition(rawDeps, 'mission-mut-2' as MissionId, 'CREATED', 'PLANNING');
    assert.equal(rawResult.ok, true,
      'MUTANT: Without facade, cross-tenant mission transition must SUCCEED');

    // Reset state for scoped test
    rawConn.run(
      "UPDATE core_missions SET state = 'CREATED', updated_at = ? WHERE id = ?",
      [new Date().toISOString(), 'mission-mut-2'],
    );

    // (b) SCOPED connection: tenant-B CANNOT transition tenant-A mission
    const { deps: scopedDeps } = createScopedTestDeps(rawConn, TENANT_B);
    // transition() throws when UPDATE changes=0 (scoped query finds no rows)
    assert.throws(
      () => missions.transition(scopedDeps, 'mission-mut-2' as MissionId, 'CREATED', 'PLANNING'),
      /not in state CREATED/,
      'PROTECTED: With facade, cross-tenant mission transition must THROW',
    );

    rawConn.close();
  });

  // Mutation 3: artifact_store.read()
  it('#3: artifact_store.read() — without facade, cross-tenant artifact read SUCCEEDS', () => {
    const rawConn = createTestDatabase('row-level');
    const artifacts = createArtifactStore();
    const now = new Date().toISOString();

    seedMission(rawConn, { id: 'mission-mut-3', tenantId: TENANT_A });
    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-mut-3', 1, 'mission-mut-3', TENANT_A, 'secret-data', 'data', 'json', '{"secret":true}', 'ACTIVE', 'task-1', 1, '{}', now],
    );

    // (a) RAW connection (mutant): cross-tenant read SUCCEEDS
    const rawDeps = createRawDeps(rawConn);
    const ctx = createTestOperationContext({ tenantId: TENANT_B });
    const rawResult = artifacts.read(rawDeps, ctx, {
      artifactId: 'art-mut-3' as ArtifactId,
      version: 1,
    });
    assert.equal(rawResult.ok, true,
      'MUTANT: Without facade, cross-tenant artifact read must SUCCEED');
    if (rawResult.ok) {
      assert.equal(rawResult.value.artifact.name, 'secret-data', 'Must retrieve the actual artifact data');
    }

    // (b) SCOPED connection: cross-tenant read FAILS
    const { deps: scopedDeps } = createScopedTestDeps(rawConn, TENANT_B);
    const scopedResult = artifacts.read(scopedDeps, ctx, {
      artifactId: 'art-mut-3' as ArtifactId,
      version: 1,
    });
    assert.equal(scopedResult.ok, false,
      'PROTECTED: With facade, cross-tenant artifact read must FAIL');

    rawConn.close();
  });

  // Mutation 4: budget_governance.consume()
  it('#4: budget_governance.consume() — without facade, cross-tenant budget drain SUCCEEDS', () => {
    const rawConn = createTestDatabase('row-level');
    const budget = createBudgetGovernor();

    seedMission(rawConn, { id: 'mission-mut-4', tenantId: TENANT_A });
    seedResource(rawConn, { missionId: 'mission-mut-4', tenantId: TENANT_A, tokenAllocated: 10000 });

    // (a) RAW connection (mutant): tenant-B CAN consume tenant-A budget
    const rawDeps = createRawDeps(rawConn);
    const rawResult = budget.consume(rawDeps, 'mission-mut-4' as MissionId, { tokens: 100 });
    assert.equal(rawResult.ok, true,
      'MUTANT: Without facade, cross-tenant budget consumption must SUCCEED');

    // Reset budget
    rawConn.run(
      'UPDATE core_resources SET token_consumed = 0, token_remaining = 10000 WHERE mission_id = ?',
      ['mission-mut-4'],
    );

    // (b) SCOPED connection: tenant-B CANNOT consume tenant-A budget
    const { deps: scopedDeps } = createScopedTestDeps(rawConn, TENANT_B);
    const scopedResult = budget.consume(scopedDeps, 'mission-mut-4' as MissionId, { tokens: 100 });
    assert.equal(scopedResult.ok, false,
      'PROTECTED: With facade, cross-tenant budget consumption must FAIL');

    rawConn.close();
  });

  // Mutation 5: conversation_manager.appendTurn()
  it('#5: conversation_manager.appendTurn() — without facade, cross-tenant conversation access SUCCEEDS', () => {
    const rawConn = createTestDatabase('row-level');
    const conversations = createConversationManager();
    const now = new Date().toISOString();

    // Seed a conversation for tenant-A
    rawConn.run(
      `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['conv-mut-5', 'sess-A', TENANT_A, 'agent-A', 0, 0, 0, now, now],
    );

    // (a) RAW connection (mutant): tenant-B CAN append to tenant-A conversation
    const rawDeps = createRawDeps(rawConn);
    const rawResult = conversations.appendTurn(rawDeps, 'conv-mut-5', {
      role: 'user',
      content: 'Cross-tenant message from raw',
      tokenCount: 10,
    });
    assert.equal(rawResult.ok, true,
      'MUTANT: Without facade, cross-tenant appendTurn must SUCCEED');

    // (b) SCOPED connection: tenant-B CANNOT see or append to tenant-A conversation
    const { deps: scopedDeps } = createScopedTestDeps(rawConn, TENANT_B);
    const scopedResult = conversations.appendTurn(scopedDeps, 'conv-mut-5', {
      role: 'user',
      content: 'This should fail',
      tokenCount: 10,
    });
    assert.equal(scopedResult.ok, false,
      'PROTECTED: With facade, cross-tenant appendTurn must FAIL');

    rawConn.close();
  });
});
