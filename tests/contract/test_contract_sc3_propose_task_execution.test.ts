/**
 * SC-3 Contract Tests: propose_task_execution -- Facade-Level Verification
 * S ref: S17 (propose_task_execution), S7 (task lifecycle), I-03 (atomic audit),
 *        I-22 (capability immutability), S11 (budget)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT proposeTaskExecution directly)
 *
 * SC-3 requires tasks to exist, so each test must first:
 *   1. Create a mission via engine.proposeMission()
 *   2. Create a task graph via engine.proposeTaskGraph()
 *   3. Then test engine.proposeTaskExecution()
 *
 * Amendment 21: Every rejection test verifies BOTH error code AND state unchanged.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import { createTaskScheduler } from '../../src/substrate/scheduler/task_scheduler.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  agentId,
  taskId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId, TaskId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  ProposeTaskGraphInput,
  ProposeTaskExecutionInput,
  TaskDefinition,
  TaskDependency,
} from '../../src/orchestration/interfaces/orchestration.js';
import type { Substrate } from '../../src/substrate/interfaces/substrate.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;
let orchestrationDeps: import('../../src/orchestration/interfaces/orchestration.js').OrchestrationDeps;

/**
 * Setup: create a fresh in-memory database with full schema, wire a real
 * TaskScheduler into the substrate stub so SC-3's enqueue() call succeeds,
 * then create the orchestration engine through createOrchestration().
 */
function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();

  // SC-3 calls deps.substrate.scheduler.enqueue() — the default stub throws.
  // Wire a real TaskScheduler (SQL-backed) so enqueue works against the test DB.
  const realScheduler = createTaskScheduler(audit);
  const notImplemented = () => {
    throw new Error('Substrate stub: not needed for SC-3 tests');
  };
  const substrateWithScheduler = {
    scheduler: realScheduler,
    workerPool: { dispatch: notImplemented, getWorker: notImplemented, shutdown: notImplemented, getMetrics: notImplemented },
    gateway: { sendRequest: notImplemented, requestStream: notImplemented, getProviderHealth: notImplemented, registerProvider: notImplemented },
    heartbeat: { start: notImplemented, stop: notImplemented, check: notImplemented, getStatus: notImplemented },
    accounting: { recordInteraction: notImplemented, getAccountingSummary: notImplemented, checkRateLimit: notImplemented, consumeRateLimit: notImplemented },
    shutdown: notImplemented,
  } as unknown as Substrate;

  engine = createOrchestration(conn, substrateWithScheduler, audit);
  orchestrationDeps = Object.freeze({ conn, substrate: substrateWithScheduler, audit });
}

/** S15: Create a mission through the facade for SC-3 tests to operate on */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for task execution',
    successCriteria: ['Complete the task'],
    scopeBoundaries: ['Within budget'],
    capabilities: ['web_search', 'code_execution'],
    constraints: {
      budget: 50000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      ...(overrides.constraints ?? {}),
    },
    ...overrides,
    constraints: {
      budget: 50000,
      deadline: new Date(Date.now() + 3600000).toISOString(),
      ...(overrides.constraints ?? {}),
    },
  };
  const result = engine.proposeMission(ctx, input);
  assert.equal(result.ok, true, 'Test mission creation must succeed');
  if (!result.ok) throw new Error('Failed to create test mission');
  return result.value.missionId;
}

/** S16: Create a task graph with given tasks and dependencies */
function createTestGraph(
  mid: MissionId,
  tasks: TaskDefinition[],
  dependencies: TaskDependency[] = [],
): string {
  const input: ProposeTaskGraphInput = {
    missionId: mid,
    tasks,
    dependencies,
    objectiveAlignment: 'Task graph for SC-3 execution tests',
  };
  const result = engine.proposeTaskGraph(ctx, input);
  assert.equal(result.ok, true, 'Test graph creation must succeed');
  if (!result.ok) throw new Error('Failed to create test graph');
  return result.value.graphId;
}

/** Helper: build a TaskDefinition */
function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: taskId(id),
    description: `Task ${id}`,
    executionMode: 'deterministic',
    estimatedTokens: 100,
    capabilitiesRequired: [],
    ...overrides,
  };
}

/** Helper: build a TaskDependency */
function makeDep(from: string, to: string): TaskDependency {
  return { from: taskId(from), to: taskId(to) };
}

/** S17: Construct a valid ProposeTaskExecutionInput */
function validExecutionInput(tid: TaskId, overrides: Partial<ProposeTaskExecutionInput> = {}): ProposeTaskExecutionInput {
  return {
    taskId: tid,
    executionMode: 'deterministic',
    environmentRequest: {
      capabilities: ['web_search'],
      timeout: 30000,
    },
    ...overrides,
  };
}

// ─── A21 State-Unchanged Verification ───

/** Get task state from database */
function getTaskState(conn: DatabaseConnection, tid: TaskId): string | undefined {
  return conn.get<{ state: string }>('SELECT state FROM core_tasks WHERE id = ?', [tid])?.state;
}

/** Count TASK_SCHEDULED events */
function countTaskScheduledEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'TASK_SCHEDULED'",
  )?.cnt ?? 0;
}

/** Count queue entries in core_task_queue */
function countQueueEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM core_task_queue')?.cnt ?? 0;
}

/** Count task_transition audit entries */
function countTaskTransitionAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'task_transition'",
  )?.cnt ?? 0;
}

/** Snapshot state before a rejection test */
function snapshotState(conn: DatabaseConnection, tid: TaskId): {
  taskState: string | undefined;
  scheduledEvents: number;
  queueEntries: number;
  transitionAudits: number;
} {
  return {
    taskState: getTaskState(conn, tid),
    scheduledEvents: countTaskScheduledEvents(conn),
    queueEntries: countQueueEntries(conn),
    transitionAudits: countTaskTransitionAuditEntries(conn),
  };
}

/**
 * A21: Assert state unchanged after a rejection.
 * Verifies: task state unchanged, no new TASK_SCHEDULED event,
 * no new queue entries, no new task_transition audit entries.
 */
function assertStateUnchanged(
  conn: DatabaseConnection,
  before: ReturnType<typeof snapshotState>,
  tid: TaskId,
  label: string,
): void {
  const afterTaskState = getTaskState(conn, tid);
  assert.equal(afterTaskState, before.taskState,
    `${label}: Task state should not change after rejection (before=${before.taskState}, after=${afterTaskState})`);

  const afterEvents = countTaskScheduledEvents(conn);
  assert.equal(afterEvents, before.scheduledEvents,
    `${label}: TASK_SCHEDULED event count should not change after rejection (before=${before.scheduledEvents}, after=${afterEvents})`);

  const afterQueue = countQueueEntries(conn);
  assert.equal(afterQueue, before.queueEntries,
    `${label}: Queue entry count should not change after rejection (before=${before.queueEntries}, after=${afterQueue})`);

  const afterAudits = countTaskTransitionAuditEntries(conn);
  assert.equal(afterAudits, before.transitionAudits,
    `${label}: task_transition audit count should not change after rejection (before=${before.transitionAudits}, after=${afterAudits})`);
}

describe('SC-3 Contract: propose_task_execution (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('SC3-SUCCESS-SINGLE: create mission + single-task graph + propose execution -- returns executionId, scheduledAt, workerId', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('exec-task-1')]);
      const tid = taskId('exec-task-1');

      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid));

      assert.equal(result.ok, true, 'S17: Single task execution must succeed');
      if (!result.ok) return;

      assert.equal(typeof result.value.executionId, 'string', 'S17: executionId must be a string');
      assert.ok(result.value.executionId.length > 0, 'S17: executionId must be non-empty');
      assert.equal(typeof result.value.scheduledAt, 'string', 'S17: scheduledAt must be a string');
      assert.ok(result.value.scheduledAt.length > 0, 'S17: scheduledAt must be non-empty');
      assert.equal(result.value.workerId, 'pending-assignment', 'S17: workerId must be pending-assignment');
    });

    it('SC3-SUCCESS-WITH-DEPS: graph with A->B, complete A, propose execution of B -- succeeds', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('dep-a'), makeTask('dep-b')], [makeDep('dep-a', 'dep-b')]);

      // Manually transition task A through the full lifecycle: PENDING -> SCHEDULED -> RUNNING -> COMPLETED
      // Use direct SQL since the facade only allows PENDING -> SCHEDULED via proposeTaskExecution
      const tidA = taskId('dep-a');
      const tidB = taskId('dep-b');

      // Transition A: PENDING -> SCHEDULED -> RUNNING -> COMPLETED via SQL
      const now = new Date().toISOString();
      conn.run('UPDATE core_tasks SET state = ?, updated_at = ? WHERE id = ? AND state = ?', ['SCHEDULED', now, tidA, 'PENDING']);
      conn.run('UPDATE core_tasks SET state = ?, updated_at = ? WHERE id = ? AND state = ?', ['RUNNING', now, tidA, 'SCHEDULED']);
      conn.run('UPDATE core_tasks SET state = ?, updated_at = ?, completed_at = ? WHERE id = ? AND state = ?', ['COMPLETED', now, now, tidA, 'RUNNING']);

      // Now propose execution of B -- A is COMPLETED, so deps are met
      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tidB));

      assert.equal(result.ok, true, 'S17: Task execution with met dependencies must succeed');
      if (!result.ok) return;

      assert.equal(typeof result.value.executionId, 'string', 'S17: executionId must be a string');
      assert.equal(result.value.workerId, 'pending-assignment', 'S17: workerId must be pending-assignment');
    });

    it('SC3-SUCCESS-SIDEEFFECTS: verify all side effects -- task PENDING->SCHEDULED, TASK_SCHEDULED event, audit entry, task queued', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('side-task')]);
      const tid = taskId('side-task');

      // Capture before counts
      const eventsBefore = countTaskScheduledEvents(conn);
      const queueBefore = countQueueEntries(conn);
      const auditsBefore = countTaskTransitionAuditEntries(conn);

      // Verify task starts as PENDING
      assert.equal(getTaskState(conn, tid), 'PENDING', 'S7: Task must start as PENDING');

      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid));
      assert.equal(result.ok, true, 'S17: Execution must succeed');
      if (!result.ok) return;

      // 1. Task state transitioned PENDING -> SCHEDULED
      assert.equal(getTaskState(conn, tid), 'SCHEDULED',
        'S7: Task must transition from PENDING to SCHEDULED');

      // 2. TASK_SCHEDULED event emitted
      const eventsAfter = countTaskScheduledEvents(conn);
      assert.equal(eventsAfter, eventsBefore + 1,
        'S17: Exactly one TASK_SCHEDULED event must be emitted');

      // 3. Audit entry for task_transition
      const auditsAfter = countTaskTransitionAuditEntries(conn);
      assert.equal(auditsAfter, auditsBefore + 1,
        'I-03: Exactly one task_transition audit entry must exist');

      // 4. Task queued in core_task_queue
      const queueAfter = countQueueEntries(conn);
      assert.equal(queueAfter, queueBefore + 1,
        'S17: Exactly one queue entry must be created');

      // Verify queue entry references correct task
      const queueEntry = conn.get<{ task_id: string; mission_id: string }>(
        'SELECT task_id, mission_id FROM core_task_queue WHERE task_id = ?',
        [tid],
      );
      assert.ok(queueEntry, 'S17: Queue entry must exist for the scheduled task');
      assert.equal(queueEntry.task_id, tid, 'S17: Queue task_id must match');
      assert.equal(queueEntry.mission_id, mid, 'S17: Queue mission_id must match');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS -- A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths -- A21 Rejection Verification', () => {

    it('SC3-ERR-TASK-NOT-PENDING-SCHEDULED: task already SCHEDULED -- TASK_NOT_PENDING + state unchanged', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('already-scheduled')]);
      const tid = taskId('already-scheduled');

      // First execution succeeds, transitions PENDING -> SCHEDULED
      const first = engine.proposeTaskExecution(ctx, validExecutionInput(tid));
      assert.equal(first.ok, true, 'First execution must succeed');

      // Snapshot after first execution (task is now SCHEDULED)
      const before = snapshotState(conn, tid);
      assert.equal(before.taskState, 'SCHEDULED', 'Task must be SCHEDULED after first execution');

      // Second execution on same task -- should fail
      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid));

      assert.equal(result.ok, false, 'S17: Must reject task not in PENDING state');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASK_NOT_PENDING',
          'S17: Error code must be TASK_NOT_PENDING');
      }

      assertStateUnchanged(conn, before, tid, 'TASK_NOT_PENDING-SCHEDULED');
    });

    it('SC3-ERR-TASK-NOT-PENDING-NOT-FOUND: nonexistent taskId -- TASK_NOT_PENDING + state unchanged', () => {
      const fakeTid = taskId('nonexistent-task-xyz');

      // Snapshot: task doesn't exist, so taskState is undefined
      const eventsBefore = countTaskScheduledEvents(conn);
      const queueBefore = countQueueEntries(conn);
      const auditsBefore = countTaskTransitionAuditEntries(conn);

      const result = engine.proposeTaskExecution(ctx, validExecutionInput(fakeTid));

      assert.equal(result.ok, false, 'S17: Must reject nonexistent task');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASK_NOT_PENDING',
          'S17: Error code must be TASK_NOT_PENDING for nonexistent task');
      }

      // State unchanged: no new events, no new queue, no new audits
      assert.equal(countTaskScheduledEvents(conn), eventsBefore,
        'TASK_NOT_FOUND: No new TASK_SCHEDULED event');
      assert.equal(countQueueEntries(conn), queueBefore,
        'TASK_NOT_FOUND: No new queue entries');
      assert.equal(countTaskTransitionAuditEntries(conn), auditsBefore,
        'TASK_NOT_FOUND: No new task_transition audit entries');
    });

    it('SC3-ERR-DEPENDENCIES-UNMET: task B depends on A, A still PENDING -- DEPENDENCIES_UNMET + state unchanged', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('unmet-a'), makeTask('unmet-b')], [makeDep('unmet-a', 'unmet-b')]);
      const tid = taskId('unmet-b');

      const before = snapshotState(conn, tid);
      assert.equal(before.taskState, 'PENDING', 'Task B must be PENDING');

      // Task A is still PENDING, so B's dependencies are NOT met
      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid));

      assert.equal(result.ok, false, 'S17: Must reject when dependencies are unmet');
      if (!result.ok) {
        assert.equal(result.error.code, 'DEPENDENCIES_UNMET',
          'S17: Error code must be DEPENDENCIES_UNMET');
      }

      assertStateUnchanged(conn, before, tid, 'DEPENDENCIES_UNMET');
    });

    it('SC3-ERR-CAPABILITY-DENIED: request capability not in mission -- CAPABILITY_DENIED + state unchanged', () => {
      // Mission with only 'web_search' capability
      const mid = createTestMission({
        capabilities: ['web_search'],
      });
      createTestGraph(mid, [makeTask('cap-task')]);
      const tid = taskId('cap-task');

      const before = snapshotState(conn, tid);

      // Request 'code_execution' which is NOT in the mission's capabilities
      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid, {
        environmentRequest: {
          capabilities: ['code_execution'],
          timeout: 30000,
        },
      }));

      assert.equal(result.ok, false, 'I-22: Must reject capability not in mission set');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_DENIED',
          'I-22: Error code must be CAPABILITY_DENIED');
      }

      assertStateUnchanged(conn, before, tid, 'CAPABILITY_DENIED');
    });

    it('SC3-ERR-BUDGET-EXCEEDED: task estimatedTokens > remaining -- BUDGET_EXCEEDED + state unchanged', () => {
      // Create mission with sufficient budget for graph creation (SC-2 also checks budget)
      const mid = createTestMission({
        constraints: {
          budget: 5000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      // Task with estimatedTokens = 100 -- passes SC-2 budget check (5000 > 100)
      createTestGraph(mid, [makeTask('expensive-task', { estimatedTokens: 100 })]);
      const tid = taskId('expensive-task');

      // Now drain the budget so token_remaining < estimatedTokens (100)
      // SC-3's budget.checkBudget() compares task.estimatedTokens against core_resources.token_remaining
      conn.run(
        'UPDATE core_resources SET token_consumed = token_allocated - 10, token_remaining = 10 WHERE mission_id = ?',
        [mid],
      );

      const before = snapshotState(conn, tid);

      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid));

      assert.equal(result.ok, false, 'S11: Must reject when estimated tokens exceed remaining budget');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED',
          'S11: Error code must be BUDGET_EXCEEDED');
      }

      assertStateUnchanged(conn, before, tid, 'BUDGET_EXCEEDED');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS -- Facade-Level Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition -- Facade-Level Verification', () => {

    it('SC3-EVENT-TASK-SCHEDULED: verify TASK_SCHEDULED event shape (type, scope, propagation, payload with taskId + executionMode)', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('event-task')]);
      const tid = taskId('event-task');

      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid, {
        executionMode: 'stochastic',
      }));
      assert.equal(result.ok, true, 'Execution must succeed');
      if (!result.ok) return;

      const event = conn.get<{
        type: string; scope: string; propagation: string;
        mission_id: string; emitted_by: string; payload_json: string;
      }>(
        "SELECT type, scope, propagation, mission_id, emitted_by, payload_json FROM core_events_log WHERE type = 'TASK_SCHEDULED' AND mission_id = ?",
        [mid],
      );

      assert.ok(event, 'S17: TASK_SCHEDULED event must exist');
      assert.equal(event.type, 'TASK_SCHEDULED', 'Event type must be TASK_SCHEDULED');
      assert.equal(event.scope, 'system', 'Lifecycle events have system scope');
      assert.equal(event.propagation, 'up', 'S17: Lifecycle event propagation must be up');
      assert.equal(event.mission_id, mid, 'Event must reference the correct mission');
      assert.equal(event.emitted_by, 'orchestrator', 'Lifecycle events emitted by orchestrator');

      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      assert.equal(payload.taskId, tid, 'S17: payload must contain taskId');
      assert.equal(payload.executionMode, 'stochastic', 'S17: payload must contain executionMode');
    });

    it('SC3-AUDIT-ATOMIC: verify audit trail entries for task_transition (PENDING->SCHEDULED)', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('audit-task')]);
      const tid = taskId('audit-task');

      const result = engine.proposeTaskExecution(ctx, validExecutionInput(tid));
      assert.equal(result.ok, true, 'Execution must succeed');
      if (!result.ok) return;

      const auditEntry = conn.get<{
        operation: string; resource_type: string; resource_id: string;
        actor_type: string; detail: string;
      }>(
        "SELECT operation, resource_type, resource_id, actor_type, detail FROM core_audit_log WHERE operation = 'task_transition' AND resource_id = ?",
        [tid],
      );

      assert.ok(auditEntry, 'I-03: Audit entry must exist for task_transition');
      assert.equal(auditEntry.operation, 'task_transition', 'I-03: operation must be task_transition');
      assert.equal(auditEntry.resource_type, 'task', 'I-03: resource_type must be task');
      assert.equal(auditEntry.resource_id, tid, 'I-03: resource_id must be the task id');

      const detail = JSON.parse(auditEntry.detail) as Record<string, unknown>;
      assert.equal(detail.from, 'PENDING', 'I-03: detail.from must be PENDING');
      assert.equal(detail.to, 'SCHEDULED', 'I-03: detail.to must be SCHEDULED');
    });

    it('SC3-TASK-TRANSITIONS-GUARD: invalid state transition PENDING->COMPLETED rejected by TASK_TRANSITIONS (kills M10)', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('transition-task')]);
      const tid = taskId('transition-task');

      assert.equal(getTaskState(conn, tid), 'PENDING', 'Task must start as PENDING');

      // Attempt invalid transition PENDING -> COMPLETED (must go through SCHEDULED -> RUNNING -> COMPLETED)
      const result = engine.taskGraph.transitionTask(
        orchestrationDeps,
        tid,
        'PENDING' as never,
        'COMPLETED' as never,
      );

      // The transitionTask checks TASK_TRANSITIONS[from].includes(to) — PENDING -> COMPLETED is not valid
      assert.equal(result.ok, false, 'S7: Must reject invalid PENDING -> COMPLETED transition');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TRANSITION',
          'S7: Error code must be INVALID_TRANSITION');
      }

      // Task state unchanged
      assert.equal(getTaskState(conn, tid), 'PENDING',
        'S7: Task must remain PENDING after rejected transition');
    });

    it('SC3-IDEMPOTENCY-GUARD: propose execution twice on same task -- second call returns TASK_NOT_PENDING', () => {
      const mid = createTestMission();
      createTestGraph(mid, [makeTask('idempotent-task')]);
      const tid = taskId('idempotent-task');

      // First call succeeds
      const first = engine.proposeTaskExecution(ctx, validExecutionInput(tid));
      assert.equal(first.ok, true, 'S17: First execution must succeed');
      if (!first.ok) return;

      // Task is now SCHEDULED
      assert.equal(getTaskState(conn, tid), 'SCHEDULED', 'Task must be SCHEDULED after first call');

      // Second call fails -- task is no longer PENDING
      const second = engine.proposeTaskExecution(ctx, validExecutionInput(tid));
      assert.equal(second.ok, false, 'S17: Second execution on same task must fail');
      if (!second.ok) {
        assert.equal(second.error.code, 'TASK_NOT_PENDING',
          'S17: Error code must be TASK_NOT_PENDING on second call');
      }

      // Task remains SCHEDULED (not double-transitioned)
      assert.equal(getTaskState(conn, tid), 'SCHEDULED',
        'S17: Task must remain SCHEDULED after rejected second call');
    });
  });
});
