/**
 * Sprint 3C: Recursive Mission Integration Tests (UC-10)
 * Phase 3 — Parent-Child Mission Composition Verification
 *
 * Purpose: Prove that recursive mission creation (UC-10) works end-to-end
 * through the OrchestrationEngine. A parent mission creates a child mission
 * via SC-1 with parentMissionId. The child executes its own full lifecycle
 * (SC-2→SC-3→SC-9). Budget flow, depth/children limits, capability subsetting,
 * and delegation cycle detection are all exercised through the real engine.
 *
 * Spec refs: §6 (Mission hierarchy), §15 (SC-1 parentMissionId), §16 (SC-2),
 *            §17 (SC-3), §22 (SC-8), §23 (SC-9), I-20 (tree constraints),
 *            I-21 (compaction), I-22 (capability monotonic decrease), I-78
 *            (budget conservation), FM-19 (delegation cycle detection)
 *
 * Invariants exercised: I-03 (atomic audit), I-05 (transactional), I-20 (tree
 *   limits: maxDepth, maxChildren, maxTotalMissions), I-21 (bounded cognition
 *   compaction), I-22 (capability immutability), I-78 (budget conservation),
 *   FM-19 (delegation cycle)
 *
 * ============================================================================
 * DEFECT-CLASS DECLARATION (C1) — 9 mandatory categories
 * ============================================================================
 *
 * | ID | Description | Cat | Control | Mechanism | Trace | [A21] |
 * |----|-------------|-----|---------|-----------|-------|-------|
 * | DC-REC-101 | Child mission created via SC-1 with parentMissionId not functioning through full lifecycle | 1: Data integrity | CBM | REC-001: child completes full SC-2→3→9 lifecycle | §15→§16→§17→§23 | Success: child reaches COMPLETED. Rejection: N/A (lifecycle tests are composition, not enforcement) |
 * | DC-REC-102 | 3-level tree (parent→child→grandchild) not persisted with correct depth values | 1: Data integrity | CBM | REC-002: verify depth 0/1/2 via DB query | §6/I-20 | Success: all 3 levels in DB with correct depth. Rejection: N/A (depth storage is structural) |
 * | DC-REC-201 | Parent stuck after child completes — cannot continue own lifecycle | 2: State consistency | CBM | REC-003: parent reaches COMPLETED after child COMPLETED | §6 | Success: parent COMPLETED. Rejection: N/A (lifecycle composition) |
 * | DC-REC-301 | Concurrency — NOT APPLICABLE: single-threaded SQLite in tests | 3: Concurrency | N/A | N/A | N/A | N/A |
 * | DC-REC-401 | Child budget exceeds parent remaining × decayFactor | 4: Authority/governance | CBM | REC-004/005: verify core_resources for both parent and child [A21] | §15/§11 | Success: child budget within decay. Rejection: BUDGET_EXCEEDED when child requests too much |
 * | DC-REC-402 | Depth limit not enforced — child created beyond maxDepth | 4: Authority/governance | CBM | REC-006: DEPTH_EXCEEDED error, no child in DB [A21] | I-20 | Success: child at valid depth created. Rejection: DEPTH_EXCEEDED, child NOT in DB |
 * | DC-REC-403 | Children limit not enforced — child created beyond maxChildren | 4: Authority/governance | CBM | REC-007: CHILDREN_EXCEEDED error, no new child in DB [A21] | I-20 | Success: children within limit created. Rejection: CHILDREN_EXCEEDED, child NOT in DB |
 * | DC-REC-404 | Capability superset allowed for child (I-22 violation) | 4: Authority/governance | CBM | REC-008: CAPABILITY_VIOLATION error, no child in DB [A21] | I-22 | Success: child with subset created. Rejection: CAPABILITY_VIOLATION, child NOT in DB |
 * | DC-REC-405 | Delegation cycle not detected (FM-19 violation) | 4: Authority/governance | CBM | REC-009: DELEGATION_CYCLE error, second child NOT in DB [A21] | FM-19 | Success: non-cyclic delegation allowed. Rejection: DELEGATION_CYCLE, child NOT in DB |
 * | DC-REC-501 | Audit entries missing for parent-child creation chain | 5: Causality/observability | CBM | REC-001: count audit entries for both parent and child | I-03 | Success: audit entries present. Rejection: N/A (audit is append-only structural) |
 * | DC-REC-601 | Migration/evolution — NOT APPLICABLE: in-memory DB with all migrations | 6: Migration | N/A | N/A | N/A | N/A |
 * | DC-REC-701 | Credential/secret — NOT APPLICABLE: no credentials in SC-1 hierarchy | 7: Credential | N/A | N/A | N/A | N/A |
 * | DC-REC-801 | Test non-discriminativeness (P-001) | 8: Behavioral | CBM | All rejection tests verify SPECIFIC error code AND entity NOT created | P-001 | N/A |
 * | DC-REC-406 | Budget not deducted from parent on child allocation (§17, I-78 conservation law violation) | 4: Authority/governance | CBM | REC-004: verify parent token_remaining decreased by childBudget [A21] | §17/I-78 | Success: parent remaining = original - child budget. Rejection: BUDGET_EXCEEDED when child requests beyond remaining × decay |
 * | DC-REC-407 | SC-8 success path: child requests budget from parent, transfer not atomic or not reflected in DB | 4: Authority/governance | CBM | REC-010: child SC-8 transfers tokens from parent, verify DB state [A21] | §22/I-78 | Success: parent remaining decreased, child remaining increased. Rejection: PARENT_INSUFFICIENT when parent has insufficient remaining |
 * | DC-REC-408 | Compaction not triggered after child completes SC-9 (M11 — compactSubtree gap) | 2: State consistency | CBM | REC-011: child completes lifecycle, parent SC-9 compacts child, verify compaction_log [A21] | §23/I-21 | Success: compaction_log entry exists, child compacted=1. Rejection: N/A (compaction is internal, tested via presence of log entry) |
 * | DC-REC-901 | Budget exhaustion — NOT APPLICABLE: budget tested via DC-REC-401 | 9: Availability | N/A | N/A | N/A | N/A |
 *
 * ============================================================================
 * DISCRIMINATIVENESS PROOF
 * ============================================================================
 *
 * REC-006: If DEPTH_EXCEEDED guard removed from mission_store.ts:82-84, child
 *   would be created at invalid depth → assert on error code fails + child
 *   count in DB would increase.
 * REC-007: If CHILDREN_EXCEEDED guard removed from mission_store.ts:87-89,
 *   child beyond limit would be created → assert on error code fails + child
 *   count exceeds expected.
 * REC-008: If CAPABILITY_VIOLATION guard removed from mission_store.ts:109-114,
 *   child with superset capability would be created → assert on error code fails.
 * REC-009: If DELEGATION_CYCLE guard removed from mission_store.ts:141-143,
 *   cyclic delegation would succeed → assert on error code fails.
 * REC-010: If budget transfer removed from budget_governance.ts:190-201,
 *   parent remaining would not decrease and child remaining would not increase →
 *   DB assertions on both parent and child token_remaining fail.
 * REC-011: If compaction.compactSubtree() call removed from submit_result.ts:124,
 *   compaction_log would have no entry and child compacted flag stays 0 →
 *   both assertions fail. KILLS M11.
 *
 * ============================================================================
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createOrchestration } from '../../src/orchestration/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import {
  createTestDatabase,
  createTestAuditTrail,
  createTestOperationContext,
  agentId,
  taskId as makeTaskId,
} from '../helpers/test_database.js';
import type {
  DatabaseConnection, OperationContext, AuditTrail, TimeProvider,
  MissionId, TaskId,
} from '../../src/kernel/interfaces/index.js';
import type {
  OrchestrationDeps,
  ProposeMissionInput,
  ProposeTaskGraphInput,
  ProposeTaskExecutionInput,
} from '../../src/orchestration/interfaces/orchestration.js';
import type { Substrate } from '../../src/substrate/interfaces/substrate.js';

// ─── Substrate Stub ───
// Duplicated from Sprint 3A per constraint #3 (no cross-sprint imports)

function createIntegrationSubstrateStub(): Substrate {
  const notImplemented = () => {
    throw new Error('Substrate stub: not implemented');
  };

  return {
    scheduler: {
      enqueue: () => ({ ok: true, value: undefined } as const),
      poll: notImplemented,
      markRunning: notImplemented,
      complete: notImplemented,
      fail: notImplemented,
      cancel: notImplemented,
      cancelMissionTasks: notImplemented,
      getStats: notImplemented,
      cleanup: notImplemented,
    },
    workers: {
      initialize: notImplemented,
      allocate: notImplemented,
      dispatch: notImplemented,
      release: notImplemented,
      terminate: notImplemented,
      getWorkers: notImplemented,
      poolStatus: notImplemented,
      shutdown: notImplemented,
    },
    adapters: {
      execute: () => ({
        ok: true,
        value: {
          result: { output: 'capability executed' },
          resourcesConsumed: { wallClockMs: 100, tokensUsed: 50, bytesRead: 0, bytesWritten: 0 },
        },
      } as const),
      validateRegistration: notImplemented,
      getSupportedCapabilities: notImplemented,
      getSandboxConfig: notImplemented,
    },
    gateway: {
      sendRequest: notImplemented,
      requestStream: notImplemented,
      getProviderHealth: notImplemented,
      registerProvider: notImplemented,
    } as Substrate['gateway'],
    heartbeat: {
      start: notImplemented,
      stop: notImplemented,
      check: notImplemented,
      getStatus: notImplemented,
    } as Substrate['heartbeat'],
    accounting: {
      recordInteraction: notImplemented,
      getAccountingSummary: notImplemented,
      checkRateLimit: notImplemented,
      consumeRateLimit: notImplemented,
    } as Substrate['accounting'],
    start: notImplemented,
    health: notImplemented,
    shutdown: notImplemented,
  } as unknown as Substrate;
}

// ─── Test Infrastructure ───

function createTestEngine(): {
  engine: OrchestrationEngine;
  conn: DatabaseConnection;
  ctx: OperationContext;
  audit: AuditTrail;
  deps: OrchestrationDeps;
} {
  const conn = createTestDatabase();
  const audit = createTestAuditTrail();
  const substrate = createIntegrationSubstrateStub();
  const time: TimeProvider = { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  const engine = createOrchestration(conn, substrate, audit, undefined, time);
  const ctx = createTestOperationContext({ tenantId: 'test-tenant' });
  const deps: OrchestrationDeps = Object.freeze({ conn, substrate, audit, time });
  return { engine, conn, ctx, audit, deps };
}

function validMissionInput(overrides: Partial<ProposeMissionInput> = {}): ProposeMissionInput {
  return {
    parentMissionId: null,
    agentId: agentId('agent-rec'),
    objective: 'Recursive mission test',
    successCriteria: ['Complete all tasks'],
    scopeBoundaries: ['Within allocated budget'],
    capabilities: ['web_search', 'code_execution'],
    constraints: {
      budget: 50000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      maxDepth: 3,
      maxChildren: 3,
    },
    ...overrides,
  };
}

function validTaskGraphInput(mid: MissionId, tid: TaskId): ProposeTaskGraphInput {
  return {
    missionId: mid,
    tasks: [{
      id: tid,
      description: 'Recursive test task',
      executionMode: 'deterministic',
      estimatedTokens: 100,
      capabilitiesRequired: ['web_search'],
    }],
    dependencies: [],
    objectiveAlignment: 'Directly supports mission objective',
  };
}

function validTaskExecutionInput(tid: TaskId): ProposeTaskExecutionInput {
  return {
    taskId: tid,
    executionMode: 'deterministic',
    environmentRequest: {
      capabilities: ['web_search'],
      timeout: 30000,
    },
  };
}

/**
 * Run a mission through its full lifecycle: SC-2→SC-3→SC-9.
 * Assumes mission is in CREATED state. Transitions through
 * CREATED→PLANNING→EXECUTING→REVIEWING→COMPLETED.
 *
 * Returns the missionId for verification.
 */
function completeMissionLifecycle(
  engine: OrchestrationEngine,
  conn: DatabaseConnection,
  ctx: OperationContext,
  deps: OrchestrationDeps,
  missionId: MissionId,
): void {
  // CREATED → PLANNING
  const toPlan = engine.missions.transition(deps, missionId, 'CREATED', 'PLANNING');
  assert.equal(toPlan.ok, true, `CREATED→PLANNING must succeed for ${missionId}`);

  // SC-2: propose_task_graph
  const tid = makeTaskId(`task-${missionId}-${Date.now()}`);
  const graphResult = engine.proposeTaskGraph(ctx, validTaskGraphInput(missionId, tid));
  assert.equal(graphResult.ok, true, `SC-2 must succeed for mission ${missionId}`);

  // PLANNING → EXECUTING
  const toExec = engine.missions.transition(deps, missionId, 'PLANNING', 'EXECUTING');
  assert.equal(toExec.ok, true, `PLANNING→EXECUTING must succeed for ${missionId}`);

  // SC-3: propose_task_execution
  const execResult = engine.proposeTaskExecution(ctx, validTaskExecutionInput(tid));
  assert.equal(execResult.ok, true, `SC-3 must succeed for task ${tid}`);

  // Manually transition task: SCHEDULED → RUNNING → COMPLETED
  engine.taskGraph.transitionTask(deps, tid, 'SCHEDULED', 'RUNNING');
  engine.taskGraph.transitionTask(deps, tid, 'RUNNING', 'COMPLETED');

  // SC-4: create_artifact (needed for SC-9 NO_ARTIFACTS check)
  const artifactResult = engine.createArtifact(ctx, {
    missionId,
    name: `artifact-${missionId}`,
    type: 'report',
    format: 'markdown',
    content: `# Result for ${missionId}`,
    sourceTaskId: tid,
    parentArtifactId: null,
    metadata: { test: true },
  });
  assert.equal(artifactResult.ok, true, `SC-4 must succeed for mission ${missionId}`);
  if (!artifactResult.ok) return;

  // EXECUTING → REVIEWING
  const toReview = engine.missions.transition(deps, missionId, 'EXECUTING', 'REVIEWING');
  assert.equal(toReview.ok, true, `EXECUTING→REVIEWING must succeed for ${missionId}`);

  // SC-9: submit_result
  const submitRes = engine.submitResult(ctx, {
    missionId,
    summary: `Completed mission ${missionId}`,
    confidence: 0.9,
    artifactIds: [artifactResult.value.artifactId],
    unresolvedQuestions: [],
    followupRecommendations: [],
  });
  assert.equal(submitRes.ok, true, `SC-9 must succeed for mission ${missionId}`);
  if (!submitRes.ok) return;
  assert.equal(submitRes.value.missionState, 'COMPLETED', `Mission ${missionId} must be COMPLETED`);
}

// ============================================================================
// Category 1: Parent-Child Lifecycle (Composition)
// ============================================================================

describe('Category 1: Parent-Child Lifecycle (Composition)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-001: Parent creates child via SC-1 with parentMissionId, child runs full lifecycle
  it('REC-001: child mission created via SC-1 runs full lifecycle (SC-2→3→9) independently', () => {
    // Create parent (root) mission
    const parentResult = engine.proposeMission(ctx, validMissionInput());
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    // Transition parent to EXECUTING (so it is active while child runs)
    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child mission via SC-1 with parentMissionId
    const childDeadline = new Date(Date.now() + 1800000).toISOString(); // 30 min — within parent's 1hr
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-child'),
      objective: 'Child sub-mission',
      capabilities: ['web_search'], // subset of parent
      constraints: {
        budget: 4000, // within parent 50000 * 0.3 = 15000
        deadline: childDeadline,
        maxDepth: 2,
        maxChildren: 2,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;
    assert.equal(childResult.value.state, 'CREATED', 'Child initial state must be CREATED');

    // Verify child exists in DB with correct parent_id and depth
    const childRow = conn.get<{ parent_id: string; depth: number; state: string }>(
      'SELECT parent_id, depth, state FROM core_missions WHERE id = ?', [childId],
    );
    assert.equal(childRow?.parent_id, parentId, 'DB: child parent_id must reference parent');
    assert.equal(childRow?.depth, 1, 'DB: child depth must be 1');
    assert.equal(childRow?.state, 'CREATED', 'DB: child state must be CREATED');

    // Run child through full lifecycle: SC-2→SC-3→SC-9
    completeMissionLifecycle(engine, conn, ctx, deps, childId);

    // Verify child is COMPLETED in DB
    const childFinal = conn.get<{ state: string; completed_at: string | null }>(
      'SELECT state, completed_at FROM core_missions WHERE id = ?', [childId],
    );
    assert.equal(childFinal?.state, 'COMPLETED', 'DB: child must be COMPLETED after lifecycle');
    assert.notEqual(childFinal?.completed_at, null, 'DB: child completed_at must be set');

    // Verify parent state is unaffected (still EXECUTING)
    const parentRow = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?', [parentId],
    );
    assert.equal(parentRow?.state, 'EXECUTING', 'DB: parent must still be EXECUTING after child completes');

    // Verify audit entries exist for both parent and child creation
    const parentAudit = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM core_audit_log WHERE resource_id = ? AND operation = 'propose_mission'`,
      [parentId],
    );
    assert.equal(parentAudit?.cnt, 1, 'DB: parent must have propose_mission audit entry');

    const childAudit = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM core_audit_log WHERE resource_id = ? AND operation = 'propose_mission'`,
      [childId],
    );
    assert.equal(childAudit?.cnt, 1, 'DB: child must have propose_mission audit entry');
  });

  // REC-002: Parent → child → grandchild (depth=2), grandchild completes
  it('REC-002: three-level tree (parent→child→grandchild) with correct depth values', () => {
    // Create root mission (depth 0)
    const rootResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: 100000,
        deadline: new Date(Date.now() + 7200000).toISOString(), // 2 hours
        maxDepth: 3,
        maxChildren: 5,
      },
    }));
    assert.equal(rootResult.ok, true, 'Root SC-1 must succeed');
    if (!rootResult.ok) return;
    const rootId = rootResult.value.missionId;

    // Transition root to EXECUTING
    engine.missions.transition(deps, rootId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, rootId, 'PLANNING', 'EXECUTING');

    // Create child mission (depth 1)
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-child-d1'),
      objective: 'Depth-1 child mission',
      capabilities: ['web_search', 'code_execution'],
      constraints: {
        budget: 8000, // within 100000 * 0.3 = 30000
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // Transition child to EXECUTING
    engine.missions.transition(deps, childId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, childId, 'PLANNING', 'EXECUTING');

    // Create grandchild mission (depth 2)
    const grandchildResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: childId,
      agentId: agentId('agent-grandchild-d2'),
      objective: 'Depth-2 grandchild mission',
      capabilities: ['web_search'], // subset of child
      constraints: {
        budget: 700, // within 8000 * 0.3 = 2400
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 3,
        maxChildren: 2,
      },
    }));
    assert.equal(grandchildResult.ok, true, 'Grandchild SC-1 must succeed');
    if (!grandchildResult.ok) return;
    const grandchildId = grandchildResult.value.missionId;

    // Verify 3-level tree in DB with correct depths
    const rootRow = conn.get<{ depth: number; parent_id: string | null }>(
      'SELECT depth, parent_id FROM core_missions WHERE id = ?', [rootId],
    );
    assert.equal(rootRow?.depth, 0, 'DB: root depth must be 0');
    assert.equal(rootRow?.parent_id, null, 'DB: root parent_id must be null');

    const childRow = conn.get<{ depth: number; parent_id: string }>(
      'SELECT depth, parent_id FROM core_missions WHERE id = ?', [childId],
    );
    assert.equal(childRow?.depth, 1, 'DB: child depth must be 1');
    assert.equal(childRow?.parent_id, rootId, 'DB: child parent must be root');

    const grandchildRow = conn.get<{ depth: number; parent_id: string }>(
      'SELECT depth, parent_id FROM core_missions WHERE id = ?', [grandchildId],
    );
    assert.equal(grandchildRow?.depth, 2, 'DB: grandchild depth must be 2');
    assert.equal(grandchildRow?.parent_id, childId, 'DB: grandchild parent must be child');

    // Verify tree count reflects all 3 missions
    const treeCount = conn.get<{ total_count: number }>(
      'SELECT total_count FROM core_tree_counts WHERE root_mission_id = ?', [rootId],
    );
    assert.equal(treeCount?.total_count, 3, 'DB: tree count must be 3 (root + child + grandchild)');

    // Complete grandchild lifecycle to prove it works at depth 2
    completeMissionLifecycle(engine, conn, ctx, deps, grandchildId);

    const grandchildFinal = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?', [grandchildId],
    );
    assert.equal(grandchildFinal?.state, 'COMPLETED', 'DB: grandchild must be COMPLETED');
  });

  // REC-003: Parent continues its own lifecycle after child completes
  it('REC-003: parent reaches COMPLETED after child completes its lifecycle', () => {
    // Create parent
    const parentResult = engine.proposeMission(ctx, validMissionInput());
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    // Parent: CREATED → PLANNING
    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');

    // Parent: SC-2 — add task graph
    const parentTaskId = makeTaskId(`task-parent-${Date.now()}`);
    const parentGraphResult = engine.proposeTaskGraph(ctx, validTaskGraphInput(parentId, parentTaskId));
    assert.equal(parentGraphResult.ok, true, 'Parent SC-2 must succeed');

    // Parent: PLANNING → EXECUTING
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child while parent is EXECUTING
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-child-003'),
      capabilities: ['web_search'],
      constraints: {
        budget: 3000,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // Complete child lifecycle
    completeMissionLifecycle(engine, conn, ctx, deps, childId);

    // Verify child is COMPLETED
    const childFinal = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?', [childId],
    );
    assert.equal(childFinal?.state, 'COMPLETED', 'DB: child must be COMPLETED');

    // Now complete parent lifecycle: SC-3 → task transitions → SC-4 → SC-9
    const parentExecResult = engine.proposeTaskExecution(ctx, validTaskExecutionInput(parentTaskId));
    assert.equal(parentExecResult.ok, true, 'Parent SC-3 must succeed');

    engine.taskGraph.transitionTask(deps, parentTaskId, 'SCHEDULED', 'RUNNING');
    engine.taskGraph.transitionTask(deps, parentTaskId, 'RUNNING', 'COMPLETED');

    // Parent: create artifact
    const artifactResult = engine.createArtifact(ctx, {
      missionId: parentId,
      name: 'parent-report',
      type: 'report',
      format: 'markdown',
      content: '# Parent completed after child',
      sourceTaskId: parentTaskId,
      parentArtifactId: null,
      metadata: { test: true },
    });
    assert.equal(artifactResult.ok, true, 'Parent SC-4 must succeed');
    if (!artifactResult.ok) return;

    // Parent: EXECUTING → REVIEWING → COMPLETED via SC-9
    engine.missions.transition(deps, parentId, 'EXECUTING', 'REVIEWING');
    const parentSubmit = engine.submitResult(ctx, {
      missionId: parentId,
      summary: 'Parent completed after child finished',
      confidence: 0.95,
      artifactIds: [artifactResult.value.artifactId],
      unresolvedQuestions: [],
      followupRecommendations: [],
    });
    assert.equal(parentSubmit.ok, true, 'Parent SC-9 must succeed');
    if (!parentSubmit.ok) return;
    assert.equal(parentSubmit.value.missionState, 'COMPLETED', 'Parent must be COMPLETED');

    // Verify both parent and child are COMPLETED in DB
    const parentFinal = conn.get<{ state: string; completed_at: string | null }>(
      'SELECT state, completed_at FROM core_missions WHERE id = ?', [parentId],
    );
    assert.equal(parentFinal?.state, 'COMPLETED', 'DB: parent must be COMPLETED');
    assert.notEqual(parentFinal?.completed_at, null, 'DB: parent completed_at must be set');
  });
});

// ============================================================================
// Category 2: Budget Flow (Governance)
// ============================================================================

describe('Category 2: Budget Flow (Governance)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-004: Child budget allocated from parent's remaining budget (within decay factor)
  it('REC-004: child budget allocation verified via core_resources for both parent and child', () => {
    const parentBudget = 50000;

    // Create parent
    const parentResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: parentBudget,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 3,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    // Verify parent core_resources row
    const parentResourceBefore = conn.get<{ token_allocated: number; token_remaining: number; token_consumed: number }>(
      'SELECT token_allocated, token_remaining, token_consumed FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    assert.equal(parentResourceBefore?.token_allocated, parentBudget, 'DB: parent token_allocated must be 50000');
    assert.equal(parentResourceBefore?.token_remaining, parentBudget, 'DB: parent token_remaining must be 50000 (no consumption)');
    assert.equal(parentResourceBefore?.token_consumed, 0, 'DB: parent token_consumed must be 0');

    // Transition parent to EXECUTING
    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child with budget within decay factor
    const childBudget = 10000; // within 50000 * 0.3 = 15000
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-child-budget'),
      capabilities: ['web_search'],
      constraints: {
        budget: childBudget,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;
    assert.equal(childResult.value.allocated.budget, childBudget, 'SC-1 output: child allocated budget must be 10000');

    // Verify child has its own core_resources row
    const childResource = conn.get<{ token_allocated: number; token_remaining: number; token_consumed: number }>(
      'SELECT token_allocated, token_remaining, token_consumed FROM core_resources WHERE mission_id = ?',
      [childId],
    );
    assert.equal(childResource?.token_allocated, childBudget, 'DB: child token_allocated must be 10000');
    assert.equal(childResource?.token_remaining, childBudget, 'DB: child token_remaining must be 10000');
    assert.equal(childResource?.token_consumed, 0, 'DB: child token_consumed must be 0');

    // §17, I-78: Parent budget MUST decrease on child allocation.
    // S17: "budget reserved from parent". I-78: conservation law.
    // Parent token_allocated is unchanged (original allocation stays).
    // Parent token_remaining decreases by childBudget (reserved for child).
    const parentResourceAfter = conn.get<{ token_allocated: number; token_remaining: number }>(
      'SELECT token_allocated, token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    assert.equal(parentResourceAfter?.token_allocated, parentBudget, 'DB: parent token_allocated unchanged after child creation');
    assert.equal(parentResourceAfter?.token_remaining, parentBudget - childBudget, 'DB: parent token_remaining must decrease by childBudget (§17, I-78)');

    // Verify both resources exist — 2 total rows for parent and child
    const resourceCount = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_resources WHERE mission_id IN (?, ?)',
      [parentId, childId],
    );
    assert.equal(resourceCount?.cnt, 2, 'DB: both parent and child must have core_resources rows');
  });

  // REC-005: Child consumes budget, parent and child resources are independently tracked
  it('REC-005: child budget consumption tracked independently via core_resources', () => {
    // Create parent
    const parentResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: 80000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 3,
        budgetDecayFactor: 0.4,
      },
    }));
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    // Transition parent to EXECUTING
    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child
    const childBudget = 20000; // within 80000 * 0.4 = 32000
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-child-consume'),
      capabilities: ['web_search'],
      constraints: {
        budget: childBudget,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // Run child through lifecycle (SC-3 consumes budget)
    completeMissionLifecycle(engine, conn, ctx, deps, childId);

    // Verify child consumed budget
    const childResource = conn.get<{ token_allocated: number; token_consumed: number; token_remaining: number }>(
      'SELECT token_allocated, token_consumed, token_remaining FROM core_resources WHERE mission_id = ?',
      [childId],
    );
    assert.equal(childResource?.token_allocated, childBudget, 'DB: child token_allocated must be 20000');
    // SC-3 consumes estimatedTokens (100) from child budget. token_consumed should reflect this.
    assert.equal(typeof childResource?.token_consumed, 'number', 'DB: child token_consumed must be a number');
    // Budget invariant: allocated >= consumed
    assert.equal(
      (childResource?.token_allocated ?? 0) >= (childResource?.token_consumed ?? 0),
      true,
      'DB: child allocated must be >= consumed (budget governance invariant)',
    );
    // Remaining = allocated - consumed
    assert.equal(
      childResource?.token_remaining,
      (childResource?.token_allocated ?? 0) - (childResource?.token_consumed ?? 0),
      'DB: child remaining = allocated - consumed',
    );

    // §17, I-78: Parent token_remaining decreased by childBudget on child creation.
    // Parent token_consumed stays 0 — child consumption is tracked independently on child's row.
    const parentResource = conn.get<{ token_allocated: number; token_consumed: number; token_remaining: number }>(
      'SELECT token_allocated, token_consumed, token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    assert.equal(parentResource?.token_allocated, 80000, 'DB: parent token_allocated must remain 80000');
    assert.equal(parentResource?.token_consumed, 0, 'DB: parent token_consumed must be 0 (child consumption is independent)');
    assert.equal(parentResource?.token_remaining, 80000 - childBudget, 'DB: parent token_remaining must decrease by childBudget (§17, I-78)');
  });
});

// ============================================================================
// Category 3: Depth/Children Enforcement (A21 Rejection)
// ============================================================================

describe('Category 3: Depth/Children Enforcement (A21 Rejection)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-006: Create child at maxDepth → rejected with DEPTH_EXCEEDED
  it('REC-006 rejection: creating child beyond maxDepth returns DEPTH_EXCEEDED, no child in DB', () => {
    // Create root with maxDepth=1 (only depth 0 and 1 allowed)
    const rootResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: 100000,
        deadline: new Date(Date.now() + 7200000).toISOString(),
        maxDepth: 1,
        maxChildren: 5,
      },
    }));
    assert.equal(rootResult.ok, true, 'Root SC-1 must succeed');
    if (!rootResult.ok) return;
    const rootId = rootResult.value.missionId;

    engine.missions.transition(deps, rootId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, rootId, 'PLANNING', 'EXECUTING');

    // Create child at depth 1 (should succeed with maxDepth=1)
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-depth-1'),
      capabilities: ['web_search'],
      constraints: {
        budget: 5000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 1, // Carries the same maxDepth
        maxChildren: 3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child at depth 1 must succeed (maxDepth=1 allows depth 1)');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    engine.missions.transition(deps, childId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, childId, 'PLANNING', 'EXECUTING');

    // Count missions before rejection attempt
    const missionCountBefore = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );

    // Attempt to create grandchild at depth 2 (should be rejected: depth 2 > maxDepth 1)
    const grandchildResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: childId,
      agentId: agentId('agent-depth-2'),
      capabilities: ['web_search'],
      constraints: {
        budget: 500,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 1,
        maxChildren: 2,
      },
    }));

    // Assert SPECIFIC error code (A21 rejection path)
    assert.equal(grandchildResult.ok, false, 'Grandchild at depth 2 must be rejected');
    if (grandchildResult.ok) return;
    assert.equal(grandchildResult.error.code, 'DEPTH_EXCEEDED', 'Error code must be DEPTH_EXCEEDED');

    // Verify no child was created in DB
    const missionCountAfter = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );
    assert.equal(missionCountAfter?.cnt, missionCountBefore?.cnt, 'DB: no new mission created after DEPTH_EXCEEDED rejection');

    // Verify no child of the child exists
    const childChildren = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions WHERE parent_id = ?', [childId],
    );
    assert.equal(childChildren?.cnt, 0, 'DB: child must have 0 children (grandchild was rejected)');
  });

  // REC-007: Create child beyond maxChildren → rejected with CHILDREN_EXCEEDED
  it('REC-007 rejection: creating child beyond maxChildren returns CHILDREN_EXCEEDED, no new child in DB', () => {
    // Create root with maxChildren=2
    const rootResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: 200000,
        deadline: new Date(Date.now() + 7200000).toISOString(),
        maxDepth: 3,
        maxChildren: 2,
      },
    }));
    assert.equal(rootResult.ok, true, 'Root SC-1 must succeed');
    if (!rootResult.ok) return;
    const rootId = rootResult.value.missionId;

    engine.missions.transition(deps, rootId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, rootId, 'PLANNING', 'EXECUTING');

    // Create child 1 (should succeed)
    const child1 = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-child-1'),
      capabilities: ['web_search'],
      constraints: {
        budget: 5000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
      },
    }));
    assert.equal(child1.ok, true, 'Child 1 must succeed');

    // Create child 2 (should succeed — maxChildren=2)
    const child2 = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-child-2'),
      capabilities: ['web_search'],
      constraints: {
        budget: 5000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
      },
    }));
    assert.equal(child2.ok, true, 'Child 2 must succeed');

    // Count missions before rejection attempt
    const missionCountBefore = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );

    // Attempt child 3 (should be rejected: 2 children >= maxChildren 2)
    const child3 = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-child-3'),
      capabilities: ['web_search'],
      constraints: {
        budget: 5000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
      },
    }));

    // Assert SPECIFIC error code (A21 rejection path)
    assert.equal(child3.ok, false, 'Child 3 must be rejected (maxChildren=2)');
    if (child3.ok) return;
    assert.equal(child3.error.code, 'CHILDREN_EXCEEDED', 'Error code must be CHILDREN_EXCEEDED');

    // Verify no new mission was created
    const missionCountAfter = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );
    assert.equal(missionCountAfter?.cnt, missionCountBefore?.cnt, 'DB: no new mission created after CHILDREN_EXCEEDED rejection');

    // Verify root has exactly 2 children
    const rootChildCount = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions WHERE parent_id = ?', [rootId],
    );
    assert.equal(rootChildCount?.cnt, 2, 'DB: root must have exactly 2 children (3rd was rejected)');
  });
});

// ============================================================================
// Category 4: Capability Subsetting I-22 (A21 Rejection)
// ============================================================================

describe('Category 4: Capability Subsetting I-22 (A21 Rejection)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-008: Child requests capability NOT in parent's set → CAPABILITY_VIOLATION
  it('REC-008 rejection: child with capability not in parent set returns CAPABILITY_VIOLATION, no child in DB', () => {
    // Create root with capabilities ['web_search', 'code_execution']
    const rootResult = engine.proposeMission(ctx, validMissionInput({
      capabilities: ['web_search', 'code_execution'],
      constraints: {
        budget: 50000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 5,
      },
    }));
    assert.equal(rootResult.ok, true, 'Root SC-1 must succeed');
    if (!rootResult.ok) return;
    const rootId = rootResult.value.missionId;

    engine.missions.transition(deps, rootId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, rootId, 'PLANNING', 'EXECUTING');

    // Count missions before rejection
    const missionCountBefore = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );

    // Attempt to create child with 'database_access' — NOT in parent's capabilities
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-cap-violation'),
      capabilities: ['web_search', 'database_access'], // 'database_access' not in parent
      constraints: {
        budget: 5000,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
      },
    }));

    // Assert SPECIFIC error code (A21 rejection path)
    assert.equal(childResult.ok, false, 'Child with superset capability must be rejected');
    if (childResult.ok) return;
    assert.equal(childResult.error.code, 'CAPABILITY_VIOLATION', 'Error code must be CAPABILITY_VIOLATION');

    // Verify no child was created in DB
    const missionCountAfter = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );
    assert.equal(missionCountAfter?.cnt, missionCountBefore?.cnt, 'DB: no new mission created after CAPABILITY_VIOLATION rejection');

    // Verify root has no children
    const rootChildCount = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions WHERE parent_id = ?', [rootId],
    );
    assert.equal(rootChildCount?.cnt, 0, 'DB: root must have 0 children (capability violation rejected)');
  });
});

// ============================================================================
// Category 5: Delegation Cycle FM-19 (A21 Rejection)
// ============================================================================

describe('Category 5: Delegation Cycle FM-19 (A21 Rejection)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-009: Agent A creates child for Agent B → Agent B creates child for Agent A → DELEGATION_CYCLE
  it('REC-009 rejection: cyclic delegation A→B→A returns DELEGATION_CYCLE, second child NOT in DB', () => {
    // Agent A creates root mission
    const rootResult = engine.proposeMission(ctx, validMissionInput({
      agentId: agentId('agent-A'),
      capabilities: ['web_search', 'code_execution'],
      constraints: {
        budget: 100000,
        deadline: new Date(Date.now() + 7200000).toISOString(),
        maxDepth: 5,
        maxChildren: 5,
      },
    }));
    assert.equal(rootResult.ok, true, 'Root SC-1 (Agent A) must succeed');
    if (!rootResult.ok) return;
    const rootId = rootResult.value.missionId;

    engine.missions.transition(deps, rootId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, rootId, 'PLANNING', 'EXECUTING');

    // Agent A delegates to Agent B (child mission)
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: rootId,
      agentId: agentId('agent-B'),
      capabilities: ['web_search', 'code_execution'],
      constraints: {
        budget: 10000,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 4,
        maxChildren: 3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child (Agent B) must succeed — no cycle yet');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // Verify delegation chain for child: should be ['agent-A']
    const childRow = conn.get<{ delegation_chain: string }>(
      'SELECT delegation_chain FROM core_missions WHERE id = ?', [childId],
    );
    const childChain = JSON.parse(childRow?.delegation_chain ?? '[]') as string[];
    assert.deepEqual(childChain, ['agent-A'], 'DB: child delegation_chain must be ["agent-A"]');

    // Transition child to EXECUTING so it can create sub-missions
    engine.missions.transition(deps, childId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, childId, 'PLANNING', 'EXECUTING');

    // Count missions before cycle attempt
    const missionCountBefore = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );

    // Agent B tries to delegate back to Agent A → DELEGATION_CYCLE
    // Delegation chain at this point is ['agent-A'] + 'agent-B' = ['agent-A', 'agent-B']
    // Agent A is already in the chain → cycle detected
    const cycleResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: childId,
      agentId: agentId('agent-A'), // Agent A already in delegation chain
      capabilities: ['web_search'],
      constraints: {
        budget: 1000,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 3,
        maxChildren: 2,
      },
    }));

    // Assert SPECIFIC error code (A21 rejection path)
    assert.equal(cycleResult.ok, false, 'Cyclic delegation A→B→A must be rejected');
    if (cycleResult.ok) return;
    assert.equal(cycleResult.error.code, 'DELEGATION_CYCLE', 'Error code must be DELEGATION_CYCLE');

    // Verify no new mission was created
    const missionCountAfter = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions', [],
    );
    assert.equal(missionCountAfter?.cnt, missionCountBefore?.cnt, 'DB: no new mission created after DELEGATION_CYCLE rejection');

    // Verify child has no children
    const childChildCount = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_missions WHERE parent_id = ?', [childId],
    );
    assert.equal(childChildCount?.cnt, 0, 'DB: child (Agent B) must have 0 children (cycle was rejected)');
  });
});

// ============================================================================
// Category 6: SC-8 Budget Transfer — Parent→Child (C-2 Verification Condition)
// DC-REC-407: SC-8 success path — child requests budget, parent→child transfer
// ============================================================================

describe('Category 6: SC-8 Budget Transfer (C-2 Verification Condition)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-010: Child calls SC-8 (request_budget) from parent — success path
  it('REC-010: child SC-8 transfers tokens from parent, both DB rows updated correctly', () => {
    const parentBudget = 100000;
    const childBudget = 20000; // within 100000 * 0.3 = 30000

    // Create parent
    const parentResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: parentBudget,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 3,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    // Transition parent to EXECUTING
    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-sc8-child'),
      capabilities: ['web_search'],
      constraints: {
        budget: childBudget,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // §17, I-78: After child creation, parent remaining = parentBudget - childBudget
    const parentAfterCreate = conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    assert.equal(parentAfterCreate?.token_remaining, parentBudget - childBudget,
      'DB: parent remaining must decrease by childBudget after creation');

    // Transition child to EXECUTING (required for SC-8)
    engine.missions.transition(deps, childId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, childId, 'PLANNING', 'EXECUTING');

    // Record pre-SC-8 state
    const parentBefore = conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    const childBefore = conn.get<{ token_remaining: number; token_allocated: number }>(
      'SELECT token_remaining, token_allocated FROM core_resources WHERE mission_id = ?',
      [childId],
    );

    // SC-8: Child requests additional budget from parent
    const transferAmount = 5000;
    const budgetResult = engine.requestBudget(ctx, {
      missionId: childId,
      amount: { tokens: transferAmount },
      justification: 'Need additional tokens for complex task execution',
    });
    assert.equal(budgetResult.ok, true, 'SC-8 must succeed for child requesting from parent');
    if (!budgetResult.ok) return;
    assert.equal(budgetResult.value.approved, true, 'SC-8: transfer must be approved');
    assert.equal(budgetResult.value.source, 'parent', 'SC-8: source must be parent');

    // Verify parent token_remaining DECREASED by transferAmount
    const parentAfter = conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    assert.equal(
      parentAfter?.token_remaining,
      (parentBefore?.token_remaining ?? 0) - transferAmount,
      'DB: parent token_remaining must decrease by transferAmount (§22, I-78)',
    );

    // Verify child token_remaining INCREASED by transferAmount
    const childAfter = conn.get<{ token_remaining: number; token_allocated: number }>(
      'SELECT token_remaining, token_allocated FROM core_resources WHERE mission_id = ?',
      [childId],
    );
    assert.equal(
      childAfter?.token_remaining,
      (childBefore?.token_remaining ?? 0) + transferAmount,
      'DB: child token_remaining must increase by transferAmount (§22)',
    );
    assert.equal(
      childAfter?.token_allocated,
      (childBefore?.token_allocated ?? 0) + transferAmount,
      'DB: child token_allocated must increase by transferAmount (§22)',
    );

    // I-78 conservation: parent decrease = child increase (no tokens created/destroyed)
    const parentDelta = (parentBefore?.token_remaining ?? 0) - (parentAfter?.token_remaining ?? 0);
    const childDelta = (childAfter?.token_remaining ?? 0) - (childBefore?.token_remaining ?? 0);
    assert.equal(parentDelta, childDelta,
      'I-78 conservation: parent decrease must equal child increase');
  });

  // REC-010 [A21 rejection]: SC-8 with insufficient parent budget
  it('REC-010 rejection: SC-8 returns PARENT_INSUFFICIENT when parent has insufficient remaining', () => {
    const parentBudget = 50000;
    const childBudget = 14000; // within 50000 * 0.3 = 15000

    // Create parent
    const parentResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: parentBudget,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 3,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-sc8-insuf'),
      capabilities: ['web_search'],
      constraints: {
        budget: childBudget,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    engine.missions.transition(deps, childId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, childId, 'PLANNING', 'EXECUTING');

    // Parent remaining after child creation: 50000 - 14000 = 36000
    // Request MORE than parent has remaining
    const parentRemaining = conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    const excessiveAmount = (parentRemaining?.token_remaining ?? 0) + 1;

    const budgetResult = engine.requestBudget(ctx, {
      missionId: childId,
      amount: { tokens: excessiveAmount },
      justification: 'Requesting more than parent has',
    });

    // Assert SPECIFIC error code
    assert.equal(budgetResult.ok, false, 'SC-8 must fail with insufficient parent budget');
    if (budgetResult.ok) return;
    assert.equal(budgetResult.error.code, 'PARENT_INSUFFICIENT',
      'Error code must be PARENT_INSUFFICIENT');

    // Verify neither parent nor child budget changed
    const parentAfter = conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [parentId],
    );
    assert.equal(parentAfter?.token_remaining, parentRemaining?.token_remaining,
      'DB: parent token_remaining must be unchanged after failed SC-8');

    const childAfter = conn.get<{ token_remaining: number }>(
      'SELECT token_remaining FROM core_resources WHERE mission_id = ?',
      [childId],
    );
    assert.equal(childAfter?.token_remaining, childBudget,
      'DB: child token_remaining must be unchanged after failed SC-8');
  });
});

// ============================================================================
// Category 7: Compaction After Child Completion (C-1 Verification Condition / M11)
// DC-REC-408: compactSubtree wiring verification with parent+child tree
// ============================================================================

describe('Category 7: Compaction After Child Completion (C-1 / M11)', () => {
  let engine: OrchestrationEngine;
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: OrchestrationDeps;

  beforeEach(() => {
    const setup = createTestEngine();
    engine = setup.engine;
    conn = setup.conn;
    ctx = setup.ctx;
    deps = setup.deps;
  });

  // REC-011: Child completes lifecycle, parent completes SC-9, compaction log entry exists
  it('REC-011: parent SC-9 compacts completed child — compaction_log entry exists, child compacted=1', () => {
    const parentBudget = 80000;
    const childBudget = 15000; // within 80000 * 0.3 = 24000

    // Create parent
    const parentResult = engine.proposeMission(ctx, validMissionInput({
      constraints: {
        budget: parentBudget,
        deadline: new Date(Date.now() + 3600000).toISOString(),
        maxDepth: 3,
        maxChildren: 3,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(parentResult.ok, true, 'Parent SC-1 must succeed');
    if (!parentResult.ok) return;
    const parentId = parentResult.value.missionId;

    // Transition parent to EXECUTING
    engine.missions.transition(deps, parentId, 'CREATED', 'PLANNING');
    engine.missions.transition(deps, parentId, 'PLANNING', 'EXECUTING');

    // Create child
    const childResult = engine.proposeMission(ctx, validMissionInput({
      parentMissionId: parentId,
      agentId: agentId('agent-compact-child'),
      capabilities: ['web_search'],
      constraints: {
        budget: childBudget,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        maxDepth: 2,
        maxChildren: 2,
        budgetDecayFactor: 0.3,
      },
    }));
    assert.equal(childResult.ok, true, 'Child SC-1 must succeed');
    if (!childResult.ok) return;
    const childId = childResult.value.missionId;

    // Complete child lifecycle: SC-2→SC-3→SC-4→SC-9
    completeMissionLifecycle(engine, conn, ctx, deps, childId);

    // Verify child is COMPLETED
    const childAfterLifecycle = conn.get<{ state: string; compacted: number }>(
      'SELECT state, compacted FROM core_missions WHERE id = ?',
      [childId],
    );
    assert.equal(childAfterLifecycle?.state, 'COMPLETED', 'DB: child must be COMPLETED after lifecycle');
    // Child is NOT yet compacted — compaction happens when PARENT completes SC-9
    assert.equal(childAfterLifecycle?.compacted, 0, 'DB: child not yet compacted (parent has not completed SC-9)');

    // Verify no compaction_log entries yet
    const compactionBefore = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_compaction_log',
      [],
    );
    assert.equal(compactionBefore?.cnt, 0, 'DB: no compaction_log entries before parent SC-9');

    // Now complete PARENT lifecycle (needs its own task graph + artifact + SC-9)
    // SC-2: propose task graph for parent
    const parentTid = makeTaskId(`task-parent-compact-${Date.now()}`);
    const graphResult = engine.proposeTaskGraph(ctx, validTaskGraphInput(parentId, parentTid));
    assert.equal(graphResult.ok, true, 'Parent SC-2 must succeed');

    // SC-3: execute task
    const execResult = engine.proposeTaskExecution(ctx, validTaskExecutionInput(parentTid));
    assert.equal(execResult.ok, true, 'Parent SC-3 must succeed');

    // Complete task
    engine.taskGraph.transitionTask(deps, parentTid, 'SCHEDULED', 'RUNNING');
    engine.taskGraph.transitionTask(deps, parentTid, 'RUNNING', 'COMPLETED');

    // SC-4: create artifact for parent
    const artifactResult = engine.createArtifact(ctx, {
      missionId: parentId,
      name: 'parent-result',
      type: 'report',
      format: 'markdown',
      content: '# Parent mission result',
      sourceTaskId: parentTid,
      parentArtifactId: null,
      metadata: { test: true },
    });
    assert.equal(artifactResult.ok, true, 'Parent SC-4 must succeed');
    if (!artifactResult.ok) return;

    // EXECUTING → REVIEWING
    engine.missions.transition(deps, parentId, 'EXECUTING', 'REVIEWING');

    // SC-9: submit result for parent — THIS triggers compactSubtree
    const submitResult = engine.submitResult(ctx, {
      missionId: parentId,
      summary: 'Parent completed after child',
      confidence: 0.92,
      artifactIds: [artifactResult.value.artifactId],
      unresolvedQuestions: [],
      followupRecommendations: [],
    });
    assert.equal(submitResult.ok, true, 'Parent SC-9 must succeed');
    if (!submitResult.ok) return;
    assert.equal(submitResult.value.missionState, 'COMPLETED', 'Parent must be COMPLETED');

    // ═══════════════════════════════════════════════════════════════════════
    // CRITICAL ASSERTIONS — These kill M11 (compactSubtree wiring gap)
    // If compaction.compactSubtree() is removed from submit_result.ts:124,
    // BOTH assertions below will FAIL.
    // ═══════════════════════════════════════════════════════════════════════

    // 1. Child mission must be marked compacted=1
    const childAfterCompaction = conn.get<{ compacted: number }>(
      'SELECT compacted FROM core_missions WHERE id = ?',
      [childId],
    );
    assert.equal(childAfterCompaction?.compacted, 1,
      'DB: child must have compacted=1 after parent SC-9 (I-21, kills M11)');

    // 2. core_compaction_log must have an entry for this compaction
    const compactionLog = conn.get<{ mission_id: string; missions_compacted: string; artifacts_archived: number }>(
      'SELECT mission_id, missions_compacted, artifacts_archived FROM core_compaction_log WHERE mission_id = ?',
      [parentId],
    );
    assert.notEqual(compactionLog, undefined,
      'DB: compaction_log entry must exist for parent mission (I-21, kills M11)');
    assert.equal(compactionLog?.mission_id, parentId,
      'DB: compaction_log.mission_id must be the parent');

    // 3. The compacted missions list must include the child
    const compactedMissions = JSON.parse(compactionLog?.missions_compacted ?? '[]') as string[];
    assert.equal(compactedMissions.includes(childId), true,
      'DB: compaction_log.missions_compacted must include the child mission ID');

    // 4. At least 1 artifact archived (child had an artifact from its lifecycle)
    assert.equal(
      (compactionLog?.artifacts_archived ?? 0) >= 1, true,
      'DB: compaction_log.artifacts_archived must be >= 1 (child artifact archived)',
    );

    // 5. Parent mission itself is NOT compacted (only children get compacted)
    const parentAfterCompaction = conn.get<{ compacted: number }>(
      'SELECT compacted FROM core_missions WHERE id = ?',
      [parentId],
    );
    assert.equal(parentAfterCompaction?.compacted, 0,
      'DB: parent itself must NOT be compacted (only children are compacted by I-21)');
  });
});
