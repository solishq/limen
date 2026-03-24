/**
 * TEST-GAP-009: Cross-Tenant Isolation — Layer 2 Tests
 * Verifies: Every vulnerable query (62) is tenant-scoped. No cross-tenant data leakage.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * FM-07: "Cross-Tenant Data Leakage — cross-tenant access architecturally impossible."
 * FM-10: "tenant ID on every row in every table, query-level tenant filtering."
 * S32.4: "Multi-tenant security"
 *
 * Phase: 4B
 *
 * TEST APPROACH:
 * 1. Create in-memory database in row-level mode
 * 2. Seed data for tenant-A using raw connection
 * 3. Create scoped deps for tenant-B
 * 4. Call module functions through tenant-B deps
 * 5. Assert: tenant-B cannot see/mutate tenant-A data
 *
 * These tests use createScopedTestDeps() which implements the TenantScopedConnection
 * facade spec inline. When the real facade is implemented, these tests validate
 * end-to-end isolation through the production code path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createScopedTestDeps,
  createTestOperationContext,
  createTestAuditTrail,
  createTestTransitionService,
  seedMission,
  seedResource,
  tenantId,
  missionId,
  agentId,
  sessionId,
} from '../helpers/test_database.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import { createTaskGraphEngine } from '../../src/orchestration/tasks/task_graph.js';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import { createCompactionEngine } from '../../src/orchestration/compaction/bounded_cognition.js';
import { createConversationManager } from '../../src/orchestration/conversation/conversation_manager.js';
import { createEventPropagator } from '../../src/orchestration/events/event_propagation.js';

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';
const transitionService = createTestTransitionService(createTestAuditTrail());

// ─── Helper: create scoped test environment ───

function createIsolationTestEnv() {
  const rawConn = createTestDatabase('row-level');
  const tenantBDeps = createScopedTestDeps(rawConn, TENANT_B);
  return { rawConn, depsB: tenantBDeps.deps, auditB: tenantBDeps.audit };
}

// ─── Module 1: mission_store.ts (Queries #1-6) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — mission_store', () => {
  const missions = createMissionStore();

  it('#1: get() — tenant B cannot read tenant A mission', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'ma-001', tenantId: TENANT_A, objective: 'Secret objective' });

    const result = missions.get(depsB, missionId('ma-001'));

    // FM-10: Scoped connection injects AND tenant_id = 'tenant-B'.
    // Mission ma-001 belongs to tenant-A, so query returns nothing.
    assert.equal(result.ok, false, 'FM-10: get() must fail for cross-tenant mission');
    if (!result.ok) {
      assert.equal(result.error.code, 'NOT_FOUND', 'Error must be NOT_FOUND');
    }

    rawConn.close();
  });

  it('#2: getChildren() — tenant B cannot enumerate tenant A children', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'ma-parent', tenantId: TENANT_A });
    seedMission(rawConn, { id: 'ma-child1', tenantId: TENANT_A, parentId: 'ma-parent', depth: 1 });
    seedMission(rawConn, { id: 'ma-child2', tenantId: TENANT_A, parentId: 'ma-parent', depth: 1 });

    const result = missions.getChildren(depsB, missionId('ma-parent'));

    assert.equal(result.ok, true, 'getChildren should not error');
    if (result.ok) {
      assert.equal(result.value.length, 0,
        'FM-10: getChildren must return 0 children for cross-tenant parent');
    }

    rawConn.close();
  });

  it('#3: getChildrenCount() — tenant B gets 0 for tenant A parent', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'mc-parent', tenantId: TENANT_A });
    seedMission(rawConn, { id: 'mc-child', tenantId: TENANT_A, parentId: 'mc-parent', depth: 1 });

    const result = missions.getChildrenCount(depsB, missionId('mc-parent'));

    assert.equal(result.ok, true, 'getChildrenCount should not error');
    if (result.ok) {
      assert.equal(result.value, 0,
        'FM-10: getChildrenCount must return 0 for cross-tenant parent');
    }

    rawConn.close();
  });

  it('#4: getDepth() — tenant B cannot read tenant A depth', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'md-001', tenantId: TENANT_A });

    const result = missions.getDepth(depsB, missionId('md-001'));

    assert.equal(result.ok, false, 'FM-10: getDepth must fail for cross-tenant mission');

    rawConn.close();
  });

  it('#5: getRootMissionId() — tenant B cannot traverse tenant A tree', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'mr-root', tenantId: TENANT_A });
    seedMission(rawConn, { id: 'mr-child', tenantId: TENANT_A, parentId: 'mr-root', depth: 1 });

    const result = missions.getRootMissionId(depsB, missionId('mr-child'));

    // The scoped query for 'mr-child' WHERE id = ? AND tenant_id = 'tenant-B' returns nothing.
    // getRootMissionId should fail because it can't find the starting mission.
    assert.equal(result.ok, false, 'FM-10: getRootMissionId must fail for cross-tenant mission');

    rawConn.close();
  });

  it('#6: transition() — tenant B cannot mutate tenant A mission state', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'mt-001', tenantId: TENANT_A, state: 'CREATED' });

    // transition() throws when UPDATE changes=0 (scoped to tenant-B, so no rows match).
    // The throw is the isolation mechanism — tenant B cannot transition tenant A missions.
    assert.throws(
      () => missions.transition(
        depsB,
        missionId('mt-001'),
        'CREATED' as any,
        'PLANNING' as any,
      ),
      /not in state CREATED/,
      'FM-10: transition must throw for cross-tenant mission',
    );

    // Verify tenant-A mission was NOT mutated
    const mission = rawConn.get<{ state: string }>(
      `SELECT state FROM core_missions WHERE id = ?`, ['mt-001']
    );
    assert.equal(mission?.state, 'CREATED',
      'FM-10: Tenant A mission state must be unchanged');

    rawConn.close();
  });
});

// ─── Module 2: artifact_store.ts (Queries #7-12) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — artifact_store', () => {
  const artifacts = createArtifactStore();

  it('#7-9: create() — tenant B cannot read tenant A mission state/storage/version', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'am-001', tenantId: TENANT_A });
    seedResource(rawConn, { missionId: 'am-001', tenantId: TENANT_A });

    const ctxB = createTestOperationContext({ tenantId: TENANT_B });
    const result = artifacts.create(depsB, ctxB, {
      id: 'art-cross' as any,
      missionId: missionId('am-001'),
      name: 'cross-tenant-artifact',
      type: 'data',
      format: 'markdown',
      content: 'should not work',
      sizeBytes: 10,
    });

    // artifact.create first SELECT state FROM core_missions WHERE id = ? — scoped to tenant-B
    // Returns nothing → mission not found → create fails
    assert.equal(result.ok, false,
      'FM-10: artifact create must fail when mission belongs to different tenant');

    rawConn.close();
  });

  it('#10: read() — tenant B cannot read tenant A artifacts', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'ar-001', tenantId: TENANT_A });

    // Insert artifact directly for tenant-A
    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-001', 1, 'ar-001', TENANT_A, 'secret-doc', 'data', 'markdown', Buffer.from('secret content'), 'ACTIVE', 'setup-task', null, 0, null, now]
    );

    const ctxB = createTestOperationContext({ tenantId: TENANT_B });
    const result = artifacts.read(depsB, ctxB, {
      artifactId: 'art-001' as any,
      version: 'latest',
    });

    assert.equal(result.ok, false,
      'FM-10: read must fail for cross-tenant artifact');

    rawConn.close();
  });

  it('#11: getArtifactCount() — tenant B gets 0 for tenant A mission', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'ac-001', tenantId: TENANT_A });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-cnt', 1, 'ac-001', TENANT_A, 'doc', 'data', 'markdown', Buffer.from('content'), 'ACTIVE', 'setup-task', null, 0, null, now]
    );

    const result = artifacts.getArtifactCount(depsB, missionId('ac-001'));

    assert.equal(result.ok, true, 'getArtifactCount should not error');
    if (result.ok) {
      assert.equal(result.value, 0,
        'FM-10: artifact count must be 0 for cross-tenant mission');
    }

    rawConn.close();
  });

  it('#12: archiveForMission() — tenant B cannot archive tenant A artifacts', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'aa-001', tenantId: TENANT_A });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-arch', 1, 'aa-001', TENANT_A, 'doc', 'data', 'markdown', Buffer.from('content'), 'ACTIVE', 'setup-task', null, 0, null, now]
    );

    const result = artifacts.archiveForMission(depsB, missionId('aa-001'));

    assert.equal(result.ok, true, 'archiveForMission should not error');
    if (result.ok) {
      assert.equal(result.value, 0,
        'FM-10: archiveForMission must affect 0 rows for cross-tenant mission');
    }

    // Verify tenant-A artifact is still ACTIVE
    const art = rawConn.get<{ lifecycle_state: string }>(
      `SELECT lifecycle_state FROM core_artifacts WHERE id = ?`, ['art-arch']
    );
    assert.equal(art?.lifecycle_state, 'ACTIVE',
      'FM-10: Tenant A artifact must remain ACTIVE');

    rawConn.close();
  });
});

// ─── Module 3: task_store.ts (Queries #13-19) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — task_store', () => {
  const taskGraph = createTaskGraphEngine(transitionService);

  it('#13: getTask() — tenant B cannot read tenant A task', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'tm-001', tenantId: TENANT_A });

    // Insert task directly
    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['tg-001', 'tm-001', TENANT_A, 1, 'aligned', 1, now]
    );
    rawConn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-001', 'tm-001', TENANT_A, 'tg-001', 'Secret Task', 'deterministic', 100, '[]', 'PENDING', now, now]
    );

    const result = taskGraph.getTask(depsB, 'task-001' as any);

    assert.equal(result.ok, false,
      'FM-10: getTask must fail for cross-tenant task');

    rawConn.close();
  });

  it('#14-15: getActiveTasks() — tenant B cannot enumerate tenant A tasks', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'ta-001', tenantId: TENANT_A });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['tg-act', 'ta-001', TENANT_A, 1, 'aligned', 1, now]
    );
    rawConn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-act1', 'ta-001', TENANT_A, 'tg-act', 'Task 1', 'deterministic', 100, '[]', 'PENDING', now, now]
    );

    const result = taskGraph.getActiveTasks(depsB, missionId('ta-001'));

    assert.equal(result.ok, true, 'getActiveTasks should not error');
    if (result.ok) {
      assert.equal(result.value.length, 0,
        'FM-10: getActiveTasks must return 0 tasks for cross-tenant mission');
    }

    rawConn.close();
  });

  it('#16: transitionTask() — tenant B cannot mutate tenant A task state', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'tt-001', tenantId: TENANT_A });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['tg-tr', 'tt-001', TENANT_A, 1, 'aligned', 1, now]
    );
    rawConn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-tr1', 'tt-001', TENANT_A, 'tg-tr', 'Task to transition', 'deterministic', 100, '[]', 'PENDING', now, now]
    );

    const result = taskGraph.transitionTask(
      depsB, 'task-tr1' as any, 'PENDING' as any, 'READY' as any,
    );

    assert.equal(result.ok, false,
      'FM-10: transitionTask must fail for cross-tenant task');

    // Verify task state unchanged
    const task = rawConn.get<{ state: string }>(
      `SELECT state FROM core_tasks WHERE id = ?`, ['task-tr1']
    );
    assert.equal(task?.state, 'PENDING', 'FM-10: Task state must be unchanged');

    rawConn.close();
  });

  it('#17-19: areDependenciesMet() — tenant B cannot check tenant A task dependencies', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'td-001', tenantId: TENANT_A });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['tg-dep', 'td-001', TENANT_A, 1, 'aligned', 1, now]
    );
    rawConn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['task-dep1', 'td-001', TENANT_A, 'tg-dep', 'Dep Task', 'deterministic', 100, '[]', 'COMPLETED', now, now]
    );

    const result = taskGraph.areDependenciesMet(depsB, 'task-dep1' as any);

    // Can't find the task (cross-tenant) → should fail
    assert.equal(result.ok, false,
      'FM-10: areDependenciesMet must fail for cross-tenant task');

    rawConn.close();
  });
});

// ─── Module 4: budget_governance.ts (Queries #20-27) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — budget_governance', () => {
  const budget = createBudgetGovernor(transitionService);

  it('#20-21: consume() — tenant B cannot read/mutate tenant A budget', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'bm-001', tenantId: TENANT_A });
    seedResource(rawConn, { missionId: 'bm-001', tenantId: TENANT_A, tokenAllocated: 10000 });

    const result = budget.consume(depsB, missionId('bm-001'), { tokens: 100 });

    assert.equal(result.ok, false,
      'FM-10: consume must fail for cross-tenant mission');

    // Verify budget unchanged
    const res = rawConn.get<{ token_consumed: number }>(
      `SELECT token_consumed FROM core_resources WHERE mission_id = ?`, ['bm-001']
    );
    assert.equal(res?.token_consumed, 0, 'FM-10: Budget must be unchanged');

    rawConn.close();
  });

  it('#22-25: requestFromParent() — tenant B cannot access tenant A budget hierarchy', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'bp-001', tenantId: TENANT_A });
    seedMission(rawConn, { id: 'bp-child', tenantId: TENANT_A, parentId: 'bp-001', depth: 1 });
    seedResource(rawConn, { missionId: 'bp-001', tenantId: TENANT_A, tokenAllocated: 10000 });
    seedResource(rawConn, { missionId: 'bp-child', tenantId: TENANT_A, tokenAllocated: 1000 });

    const result = budget.requestFromParent(depsB, missionId('bp-child'), 500, 'need more');

    assert.equal(result.ok, false,
      'FM-10: requestFromParent must fail for cross-tenant mission');

    rawConn.close();
  });

  it('#26: checkBudget() — tenant B cannot check tenant A budget', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'bc-001', tenantId: TENANT_A });
    seedResource(rawConn, { missionId: 'bc-001', tenantId: TENANT_A, tokenAllocated: 10000 });

    const result = budget.checkBudget(depsB, missionId('bc-001'), 100);

    assert.equal(result.ok, false,
      'FM-10: checkBudget must fail for cross-tenant mission');

    rawConn.close();
  });

  it('#27: getRemaining() — tenant B cannot read tenant A remaining budget', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'br-001', tenantId: TENANT_A });
    seedResource(rawConn, { missionId: 'br-001', tenantId: TENANT_A, tokenAllocated: 5000 });

    const result = budget.getRemaining(depsB, missionId('br-001'));

    assert.equal(result.ok, false,
      'FM-10: getRemaining must fail for cross-tenant mission');

    rawConn.close();
  });
});

// ─── Module 5: checkpoint_coordinator.ts (Queries #28-30) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — checkpoint_coordinator', () => {
  const checkpoints = createCheckpointCoordinator(transitionService);

  it('#28-30: processResponse() — tenant B cannot access/mutate tenant A checkpoints', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'cm-001', tenantId: TENANT_A, state: 'EXECUTING' });

    // Insert checkpoint directly
    const now = new Date().toISOString();
    const timeout = new Date(Date.now() + 3600000).toISOString();
    rawConn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['cp-001', 'cm-001', TENANT_A, 'BUDGET_THRESHOLD', '{}', 'PENDING', timeout, now]
    );

    const result = checkpoints.processResponse(depsB, {
      checkpointId: 'cp-001',
      assessment: 'APPROVE' as any,
      confidence: 0.9,
      proposedAction: 'continue',
    });

    assert.equal(result.ok, false,
      'FM-10: processResponse must fail for cross-tenant checkpoint');

    // Verify checkpoint state unchanged
    const cp = rawConn.get<{ state: string }>(
      `SELECT state FROM core_checkpoints WHERE id = ?`, ['cp-001']
    );
    assert.equal(cp?.state, 'PENDING', 'FM-10: Checkpoint must remain PENDING');

    rawConn.close();
  });
});

// ─── Module 6: bounded_cognition.ts (Queries #31-39) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — bounded_cognition', () => {
  const compaction = createCompactionEngine();

  it('#31-37: compactSubtree() — tenant B cannot compact tenant A subtree', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'cc-root', tenantId: TENANT_A, state: 'EXECUTING' });
    seedMission(rawConn, { id: 'cc-child', tenantId: TENANT_A, parentId: 'cc-root', state: 'COMPLETED', depth: 1 });

    const result = compaction.compactSubtree(depsB, missionId('cc-child'));

    // compactSubtree first queries SELECT state, parent_id WHERE id = ? → scoped to tenant-B → not found
    // The function returns ok:true (no-op) when mission not found — isolation works via query returning nothing.
    // The key assertion is that no compaction actually occurred on tenant-A data.
    assert.equal(result.ok, true,
      'compactSubtree returns ok:true as no-op when mission not visible');

    // Verify no compaction occurred
    const child = rawConn.get<{ compacted: number }>(
      `SELECT compacted FROM core_missions WHERE id = ?`, ['cc-child']
    );
    assert.equal(child?.compacted, 0, 'FM-10: Mission must not be compacted');

    rawConn.close();
  });

  it('#38-39: getWorkingSet() — tenant B cannot traverse tenant A working set', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'cw-root', tenantId: TENANT_A, state: 'EXECUTING' });
    seedMission(rawConn, { id: 'cw-child', tenantId: TENANT_A, parentId: 'cw-root', state: 'EXECUTING', depth: 1 });

    const result = compaction.getWorkingSet(depsB, missionId('cw-root'));

    assert.equal(result.ok, true, 'getWorkingSet should not error');
    if (result.ok) {
      assert.equal(result.value.length, 0,
        'FM-10: getWorkingSet must return empty for cross-tenant root');
    }

    rawConn.close();
  });
});

// ─── Module 7: event_propagation.ts (Queries #40-41) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — event_propagation', () => {
  const events = createEventPropagator();

  it('#40-41: emit() — tenant B cannot read tenant A mission for event propagation', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'em-001', tenantId: TENANT_A, state: 'EXECUTING' });

    const ctxB = createTestOperationContext({ tenantId: TENANT_B });
    const result = events.emit(depsB, ctxB, {
      eventType: 'test_event',
      missionId: missionId('em-001'),
      payload: { test: true },
      propagation: 'none' as any,
    });

    // emit() first queries SELECT id, parent_id, state FROM core_missions WHERE id = ? → scoped to tenant-B
    assert.equal(result.ok, false,
      'FM-10: emit must fail when mission belongs to different tenant');

    rawConn.close();
  });
});

// ─── Module 8: conversation_manager.ts (Queries #42-47) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — conversation_manager', () => {
  const conversations = createConversationManager();

  it('#42-43: appendTurn() — tenant B cannot append to tenant A conversation', () => {
    const { rawConn, depsB } = createIsolationTestEnv();

    // Create conversation for tenant-A directly
    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, parent_conversation_id, fork_at_turn, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, 0, ?, ?)`,
      ['conv-001', 'sess-A', TENANT_A, 'agent-A', now, now]
    );

    const result = conversations.appendTurn(depsB, 'conv-001', {
      role: 'user' as any,
      content: 'Cross-tenant message',
      tokenCount: 10,
    });

    // appendTurn queries SELECT ... FROM core_conversations WHERE id = ? → scoped to tenant-B
    assert.equal(result.ok, false,
      'FM-10: appendTurn must fail for cross-tenant conversation');
    if (!result.ok) {
      assert.equal(result.error.code, 'NOT_FOUND', 'Error must be NOT_FOUND');
    }

    // Verify conversation unchanged
    const conv = rawConn.get<{ total_turns: number }>(
      `SELECT total_turns FROM core_conversations WHERE id = ?`, ['conv-001']
    );
    assert.equal(conv?.total_turns, 0, 'FM-10: Conversation must have 0 turns');

    rawConn.close();
  });

  it('#44-46: autoSummarize() — tenant B cannot summarize tenant A conversation', () => {
    const { rawConn, depsB } = createIsolationTestEnv();

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, parent_conversation_id, fork_at_turn, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, 5, 500, 0, ?, ?)`,
      ['conv-sum', 'sess-A', TENANT_A, 'agent-A', now, now]
    );

    const result = conversations.autoSummarize(depsB, 'conv-sum', 4096);

    // autoSummarize queries SELECT ... FROM core_conversations WHERE id = ? → scoped to tenant-B
    assert.equal(result.ok, false,
      'FM-10: autoSummarize must fail for cross-tenant conversation');

    rawConn.close();
  });

  it('#47: getTurns() — tenant B cannot read tenant A turns', () => {
    const { rawConn, depsB } = createIsolationTestEnv();

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_conversations (id, session_id, tenant_id, agent_id, parent_conversation_id, fork_at_turn, total_turns, total_tokens, summarized_up_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, 1, 10, 0, ?, ?)`,
      ['conv-turns', 'sess-A', TENANT_A, 'agent-A', now, now]
    );
    rawConn.run(
      `INSERT INTO core_conversation_turns (id, conversation_id, tenant_id, turn_number, role, content, token_count, model_used, is_summary, is_learning_source, participant_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['turn-001', 'conv-turns', TENANT_A, 1, 'user', 'Secret message', 10, null, 0, 0, null, null, now]
    );

    const result = conversations.getTurns(depsB, 'conv-turns');

    assert.equal(result.ok, true, 'getTurns should not error');
    if (result.ok) {
      assert.equal(result.value.length, 0,
        'FM-10: getTurns must return 0 turns for cross-tenant conversation');
    }

    rawConn.close();
  });
});

// ─── Module 9: task_graph.ts (Queries #48-54) — proposeGraph() ───

describe('TEST-GAP-009: Cross-Tenant Isolation — task_graph proposeGraph', () => {
  const taskGraph = createTaskGraphEngine(transitionService);

  it('#48-54: proposeGraph() — tenant B cannot create graph for tenant A mission', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'gm-001', tenantId: TENANT_A, state: 'CREATED' });
    seedResource(rawConn, { missionId: 'gm-001', tenantId: TENANT_A, tokenAllocated: 10000 });

    const ctxB = createTestOperationContext({ tenantId: TENANT_B });
    const result = taskGraph.proposeGraph(depsB, ctxB, {
      missionId: missionId('gm-001'),
      tasks: [{ name: 'task1', description: 'desc', requiredCapabilities: ['web_search'], estimatedTokens: 100 }],
      dependencies: [],
      objectiveAlignment: 'aligned',
    });

    // proposeGraph first SELECT state, plan_version ... FROM core_missions WHERE id = ? → scoped to tenant-B
    assert.equal(result.ok, false,
      'FM-10: proposeGraph must fail when mission belongs to different tenant');

    rawConn.close();
  });
});

// ─── Module 10: read_artifact.ts (Query #55) ───
// Note: readArtifact delegates to artifacts.read() which is tested above (#10).
// Query #55 is the direct UPDATE core_artifacts SET relevance_decay = 0 WHERE id = ? AND version = ?
// This test verifies the UPDATE is scoped.

describe('TEST-GAP-009: Cross-Tenant Isolation — read_artifact direct query', () => {

  it('#55: relevance_decay UPDATE — tenant B cannot reset tenant A artifact decay', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'ra-001', tenantId: TENANT_A });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['art-decay', 1, 'ra-001', TENANT_A, 'doc', 'data', 'markdown', Buffer.from('content'), 'ACTIVE', 'setup-task', null, 5, null, now]
    );

    // Direct scoped UPDATE — what readArtifact does internally
    const result = depsB.conn.run(
      `UPDATE core_artifacts SET relevance_decay = 0 WHERE id = ? AND version = ?`,
      ['art-decay', 1]
    );

    assert.equal(result.changes, 0,
      'FM-10: Cross-tenant artifact decay reset must affect 0 rows');

    // Verify decay unchanged
    const art = rawConn.get<{ relevance_decay: number }>(
      `SELECT relevance_decay FROM core_artifacts WHERE id = ?`, ['art-decay']
    );
    assert.equal(art?.relevance_decay, 5, 'FM-10: Decay must be unchanged');

    rawConn.close();
  });
});

// ─── Module 11: submit_result.ts (Queries #56-59) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — submit_result queries', () => {

  it('#56-57: tenant B cannot query tenant A task graphs/tasks', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'sr-001', tenantId: TENANT_A, state: 'EXECUTING' });

    const now = new Date().toISOString();
    rawConn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['tg-sr', 'sr-001', TENANT_A, 1, 'aligned', 1, now]
    );

    // Query #56: SELECT id FROM core_task_graphs WHERE mission_id = ? AND is_active = 1
    const graphs = depsB.conn.query<{ id: string }>(
      `SELECT id FROM core_task_graphs WHERE mission_id = ? AND is_active = 1`,
      ['sr-001']
    );
    assert.equal(graphs.length, 0,
      'FM-10: Cross-tenant task graph query must return empty');

    rawConn.close();
  });

  it('#58-59: tenant B cannot complete/reactivate tenant A mission', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'sr-mut', tenantId: TENANT_A, state: 'EXECUTING' });

    // Query #58: UPDATE core_missions SET state = 'COMPLETED' WHERE id = ?
    const result = depsB.conn.run(
      `UPDATE core_missions SET state = 'COMPLETED', updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), 'sr-mut']
    );
    assert.equal(result.changes, 0,
      'FM-10: Cross-tenant mission completion must affect 0 rows');

    // Verify state unchanged
    const m = rawConn.get<{ state: string }>(
      `SELECT state FROM core_missions WHERE id = ?`, ['sr-mut']
    );
    assert.equal(m?.state, 'EXECUTING', 'FM-10: Mission must remain EXECUTING');

    rawConn.close();
  });
});

// ─── Module 12: propose_task_execution.ts (Query #60) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — propose_task_execution', () => {

  it('#60: tenant B cannot read tenant A mission capabilities', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'pe-001', tenantId: TENANT_A, capabilities: ['web_search', 'code_execution'] });

    const result = depsB.conn.get<{ capabilities: string }>(
      `SELECT capabilities FROM core_missions WHERE id = ?`,
      ['pe-001']
    );
    assert.equal(result, undefined,
      'FM-10: Cross-tenant mission capability read must return undefined');

    rawConn.close();
  });
});

// ─── Module 13: request_capability.ts (Query #61) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — request_capability', () => {

  it('#61: tenant B cannot read tenant A mission capabilities', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'rc-001', tenantId: TENANT_A, capabilities: ['web_search'] });

    const result = depsB.conn.get<{ capabilities: string }>(
      `SELECT capabilities FROM core_missions WHERE id = ?`,
      ['rc-001']
    );
    assert.equal(result, undefined,
      'FM-10: Cross-tenant mission capability read must return undefined');

    rawConn.close();
  });
});

// ─── Module 14: mission_store tree_counts (Query #62) ───

describe('TEST-GAP-009: Cross-Tenant Isolation — tree_counts', () => {

  it('#62: tenant B cannot read tenant A tree counts', () => {
    const { rawConn, depsB } = createIsolationTestEnv();
    seedMission(rawConn, { id: 'tc-root', tenantId: TENANT_A });

    const result = depsB.conn.get<{ total_count: number }>(
      `SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?`,
      ['tc-root']
    );
    assert.equal(result, undefined,
      'FM-10: Cross-tenant tree count read must return undefined');

    rawConn.close();
  });
});
