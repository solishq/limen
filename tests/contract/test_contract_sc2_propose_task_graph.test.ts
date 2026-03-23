/**
 * SC-2 Contract Tests: propose_task_graph -- Facade-Level Verification
 * S ref: S16 (propose_task_graph), S7 (task lifecycle), I-03 (atomic audit),
 *        I-20 (task limits), I-22 (capability immutability),
 *        I-24 (goal anchoring -- objectiveAlignment required),
 *        FM-17 (plan revision limit, task limit)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT TaskGraphEngine.proposeGraph directly)
 *
 * Amendment 21: Every rejection test verifies BOTH error code AND state unchanged.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import { MISSION_TREE_DEFAULTS } from '../../src/orchestration/interfaces/orchestration.js';
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
import type { ProposeMissionInput, ProposeTaskGraphInput, TaskDefinition, TaskDependency } from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;

function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** S15: Create a mission through the facade for SC-2 tests to operate on */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for task graph',
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

/** S16: Construct a valid task graph input */
function validGraphInput(mid: MissionId, overrides: Partial<ProposeTaskGraphInput> = {}): ProposeTaskGraphInput {
  return {
    missionId: mid,
    tasks: [{
      id: taskId('task-1'),
      description: 'Test task',
      executionMode: 'deterministic',
      estimatedTokens: 100,
      capabilitiesRequired: [],
    }],
    dependencies: [],
    objectiveAlignment: 'This task graph serves the mission objective',
    ...overrides,
  };
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

// ─── A21 State-Unchanged Verification ───

/** Count rows in core_task_graphs */
function countGraphs(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM core_task_graphs')?.cnt ?? 0;
}

/** Count rows in core_tasks */
function countTasks(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM core_tasks')?.cnt ?? 0;
}

/** Count PLAN_UPDATED events */
function countPlanUpdatedEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'PLAN_UPDATED'",
  )?.cnt ?? 0;
}

/** Get mission plan_version */
function getPlanVersion(conn: DatabaseConnection, mid: MissionId): number {
  return conn.get<{ plan_version: number }>(
    'SELECT plan_version FROM core_missions WHERE id = ?',
    [mid],
  )?.plan_version ?? -1;
}

/**
 * A21: Assert state unchanged after a rejection.
 * Verifies no new graphs, no new tasks, no new PLAN_UPDATED event,
 * and mission plan_version is unchanged.
 */
function assertStateUnchanged(
  conn: DatabaseConnection,
  graphCountBefore: number,
  taskCountBefore: number,
  eventCountBefore: number,
  planVersionBefore: number,
  mid: MissionId,
  label: string,
): void {
  const graphCountAfter = countGraphs(conn);
  assert.equal(graphCountAfter, graphCountBefore,
    `${label}: Graph count should not change after rejection (before=${graphCountBefore}, after=${graphCountAfter})`);

  const taskCountAfter = countTasks(conn);
  assert.equal(taskCountAfter, taskCountBefore,
    `${label}: Task count should not change after rejection (before=${taskCountBefore}, after=${taskCountAfter})`);

  const eventCountAfter = countPlanUpdatedEvents(conn);
  assert.equal(eventCountAfter, eventCountBefore,
    `${label}: PLAN_UPDATED event count should not change after rejection (before=${eventCountBefore}, after=${eventCountAfter})`);

  const planVersionAfter = getPlanVersion(conn, mid);
  assert.equal(planVersionAfter, planVersionBefore,
    `${label}: Mission plan_version should not change after rejection (before=${planVersionBefore}, after=${planVersionAfter})`);
}

/** Snapshot state before a rejection test */
function snapshotState(conn: DatabaseConnection, mid: MissionId): {
  graphs: number; tasks: number; events: number; planVersion: number;
} {
  return {
    graphs: countGraphs(conn),
    tasks: countTasks(conn),
    events: countPlanUpdatedEvents(conn),
    planVersion: getPlanVersion(conn, mid),
  };
}

describe('SC-2 Contract: propose_task_graph (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('SC2-SUCCESS-SINGLE: single task, no deps -- returns graphId, planVersion=1, taskCount=1', () => {
      const mid = createTestMission();
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid));

      assert.equal(result.ok, true, 'S16: Single task graph must succeed');
      if (!result.ok) return;

      assert.equal(typeof result.value.graphId, 'string', 'S16: graphId must be a string');
      assert.ok(result.value.graphId.length > 0, 'S16: graphId must be non-empty');
      assert.equal(result.value.planVersion, 1, 'S16: First graph planVersion must be 1');
      assert.equal(result.value.taskCount, 1, 'S16: taskCount must be 1');
      assert.ok(Array.isArray(result.value.validationWarnings), 'S16: validationWarnings must be an array');
    });

    it('SC2-SUCCESS-DAG: 3 tasks with A->B, A->C deps -- success, taskCount=3', () => {
      const mid = createTestMission();
      const tasks: TaskDefinition[] = [
        makeTask('task-a'),
        makeTask('task-b'),
        makeTask('task-c'),
      ];
      const dependencies: TaskDependency[] = [
        makeDep('task-a', 'task-b'),
        makeDep('task-a', 'task-c'),
      ];

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, { tasks, dependencies }));

      assert.equal(result.ok, true, 'S16: 3-task DAG must succeed');
      if (!result.ok) return;

      assert.equal(result.value.taskCount, 3, 'S16: taskCount must be 3');
      assert.equal(result.value.planVersion, 1, 'S16: First graph planVersion must be 1');
    });

    it('SC2-SUCCESS-SIDEEFFECTS: verifies all side effects -- graph row, task rows, dependency rows, plan_version, PLAN_UPDATED event, audit', () => {
      const mid = createTestMission();
      const tasks: TaskDefinition[] = [
        makeTask('task-x'),
        makeTask('task-y'),
      ];
      const dependencies: TaskDependency[] = [
        makeDep('task-x', 'task-y'),
      ];

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks,
        dependencies,
        objectiveAlignment: 'Side-effect verification alignment',
      }));

      assert.equal(result.ok, true, 'S16: Graph creation must succeed');
      if (!result.ok) return;

      const graphId = result.value.graphId;

      // core_task_graphs row
      const graphRow = conn.get<{
        id: string; mission_id: string; version: number; objective_alignment: string; is_active: number;
      }>(
        'SELECT id, mission_id, version, objective_alignment, is_active FROM core_task_graphs WHERE id = ?',
        [graphId],
      );
      assert.ok(graphRow, 'I-18: core_task_graphs row must exist');
      assert.equal(graphRow.mission_id, mid, 'S16: Graph mission_id must match');
      assert.equal(graphRow.version, 1, 'S16: Graph version must be 1');
      assert.equal(graphRow.objective_alignment, 'Side-effect verification alignment', 'I-24: objectiveAlignment must be stored');
      assert.equal(graphRow.is_active, 1, 'S16: New graph must be active');

      // core_tasks rows
      const taskRows = conn.query<{ id: string; graph_id: string; state: string; mission_id: string }>(
        'SELECT id, graph_id, state, mission_id FROM core_tasks WHERE graph_id = ? ORDER BY id',
        [graphId],
      );
      assert.equal(taskRows.length, 2, 'S16: Two task rows must exist');
      assert.equal(taskRows[0].state, 'PENDING', 'S7: Initial task state must be PENDING');
      assert.equal(taskRows[1].state, 'PENDING', 'S7: Initial task state must be PENDING');
      assert.equal(taskRows[0].mission_id, mid, 'S16: Task mission_id must match');

      // core_task_dependencies rows
      const depRows = conn.query<{ graph_id: string; from_task: string; to_task: string }>(
        'SELECT graph_id, from_task, to_task FROM core_task_dependencies WHERE graph_id = ?',
        [graphId],
      );
      assert.equal(depRows.length, 1, 'S16: One dependency row must exist');
      assert.equal(depRows[0].from_task, 'task-x', 'S16: Dependency from must match');
      assert.equal(depRows[0].to_task, 'task-y', 'S16: Dependency to must match');

      // Mission plan_version incremented
      const planVersion = getPlanVersion(conn, mid);
      assert.equal(planVersion, 1, 'S16: Mission plan_version must be 1 after first graph');

      // PLAN_UPDATED event
      const eventRow = conn.get<{
        type: string; scope: string; propagation: string; payload_json: string; mission_id: string;
      }>(
        "SELECT type, scope, propagation, payload_json, mission_id FROM core_events_log WHERE type = 'PLAN_UPDATED' AND mission_id = ?",
        [mid],
      );
      assert.ok(eventRow, 'S16: PLAN_UPDATED event must exist');
      assert.equal(eventRow.type, 'PLAN_UPDATED', 'S16: Event type must be PLAN_UPDATED');

      // I-03: Audit entry
      const auditRow = conn.get<{ operation: string; resource_id: string }>(
        "SELECT operation, resource_id FROM core_audit_log WHERE operation = 'propose_task_graph' AND resource_id = ?",
        [graphId],
      );
      assert.ok(auditRow, 'I-03: Audit entry must exist for propose_task_graph');
      assert.equal(auditRow.operation, 'propose_task_graph', 'I-03: Audit operation must be propose_task_graph');
    });

    it('SC2-SUCCESS-REPLANNING: submit graph, then submit new graph -- planVersion increments, old graph deactivated, old PENDING tasks cancelled', () => {
      const mid = createTestMission();

      // First graph
      const result1 = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('first-task')],
        dependencies: [],
      }));
      assert.equal(result1.ok, true, 'First graph must succeed');
      if (!result1.ok) return;

      const firstGraphId = result1.value.graphId;
      assert.equal(result1.value.planVersion, 1, 'First planVersion must be 1');

      // Second graph (replanning)
      const result2 = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('second-task-a'), makeTask('second-task-b')],
        dependencies: [makeDep('second-task-a', 'second-task-b')],
      }));
      assert.equal(result2.ok, true, 'Second graph (replanning) must succeed');
      if (!result2.ok) return;

      assert.equal(result2.value.planVersion, 2, 'S16: planVersion must increment to 2');
      assert.equal(result2.value.taskCount, 2, 'S16: taskCount must be 2');

      // Old graph deactivated
      const oldGraph = conn.get<{ is_active: number }>(
        'SELECT is_active FROM core_task_graphs WHERE id = ?',
        [firstGraphId],
      );
      assert.ok(oldGraph, 'Old graph row must still exist');
      assert.equal(oldGraph.is_active, 0, 'S16: Old graph must be deactivated');

      // Old PENDING tasks cancelled
      const oldTasks = conn.query<{ state: string }>(
        'SELECT state FROM core_tasks WHERE graph_id = ?',
        [firstGraphId],
      );
      assert.equal(oldTasks.length, 1, 'Old graph task row must still exist');
      assert.equal(oldTasks[0].state, 'CANCELLED', 'S16: Old PENDING tasks must be cancelled on replanning');
    });

    it('SC2-SUCCESS-STATE-TRANSITION: mission in CREATED state -- after graph -- transitions to PLANNING', () => {
      const mid = createTestMission();

      // Verify initial state is CREATED
      const beforeState = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(beforeState?.state, 'CREATED', 'S6: Mission must start in CREATED state');

      // Submit graph
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid));
      assert.equal(result.ok, true, 'Graph submission must succeed');

      // Verify state transition to PLANNING
      const afterState = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(afterState?.state, 'PLANNING', 'S16: Mission must transition from CREATED to PLANNING after graph proposal');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS -- A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths -- A21 Rejection Verification', () => {

    it('SC2-ERR-CYCLE-DETECTED-DIRECT: A->B->A cycle -- CYCLE_DETECTED', () => {
      const mid = createTestMission();
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('task-a'), makeTask('task-b')],
        dependencies: [makeDep('task-a', 'task-b'), makeDep('task-b', 'task-a')],
      }));

      assert.equal(result.ok, false, 'S16: Must reject cyclic graph');
      if (!result.ok) {
        assert.equal(result.error.code, 'CYCLE_DETECTED', 'S16: Error code must be CYCLE_DETECTED');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'CYCLE_DETECTED-DIRECT');
    });

    it('SC2-ERR-CYCLE-DETECTED-SELF: A->A self-dependency -- CYCLE_DETECTED', () => {
      const mid = createTestMission();
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('task-a')],
        dependencies: [makeDep('task-a', 'task-a')],
      }));

      assert.equal(result.ok, false, 'S16: Must reject self-dependency');
      if (!result.ok) {
        assert.equal(result.error.code, 'CYCLE_DETECTED', 'S16: Error code must be CYCLE_DETECTED for self-dependency');
        assert.ok(result.error.message.includes('Self-dependency'),
          'S16: Error message must indicate self-dependency guard (not Kahn fallback) — discriminates M9');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'CYCLE_DETECTED-SELF');
    });

    it('SC2-ERR-BUDGET-EXCEEDED: total estimatedTokens > mission remaining -- BUDGET_EXCEEDED', () => {
      // Create mission with small budget
      const mid = createTestMission({
        constraints: {
          budget: 500,
          deadline: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      const before = snapshotState(conn, mid);

      // Submit tasks with estimated tokens exceeding budget
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [
          makeTask('big-task-1', { estimatedTokens: 300 }),
          makeTask('big-task-2', { estimatedTokens: 300 }),
        ],
        dependencies: [],
      }));

      assert.equal(result.ok, false, 'S11: Must reject when estimated tokens exceed remaining budget');
      if (!result.ok) {
        assert.equal(result.error.code, 'BUDGET_EXCEEDED', 'S11: Error code must be BUDGET_EXCEEDED');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'BUDGET_EXCEEDED');
    });

    it('SC2-ERR-TASK-LIMIT-EXCEEDED: tasks.length > maxTasks -- TASK_LIMIT_EXCEEDED', () => {
      // Create mission with low maxTasks
      const mid = createTestMission({
        constraints: {
          budget: 500000,
          deadline: new Date(Date.now() + 3600000).toISOString(),
          maxTasks: 2,
        },
      });
      const before = snapshotState(conn, mid);

      // Submit 3 tasks, maxTasks is 2
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('t-1'), makeTask('t-2'), makeTask('t-3')],
        dependencies: [],
      }));

      assert.equal(result.ok, false, 'FM-17: Must reject when tasks exceed maxTasks');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASK_LIMIT_EXCEEDED', 'FM-17: Error code must be TASK_LIMIT_EXCEEDED');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'TASK_LIMIT_EXCEEDED');
    });

    it('SC2-ERR-INVALID-DEPENDENCY-MISSING-FROM: dependency.from references non-existent task -- INVALID_DEPENDENCY', () => {
      const mid = createTestMission();
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('task-a')],
        dependencies: [makeDep('nonexistent', 'task-a')],
      }));

      assert.equal(result.ok, false, 'S16: Must reject dependency referencing non-existent task');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_DEPENDENCY', 'S16: Error code must be INVALID_DEPENDENCY');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'INVALID_DEPENDENCY-MISSING-FROM');
    });

    it('SC2-ERR-INVALID-DEPENDENCY-DUPLICATE-IDS: two tasks with same ID -- INVALID_DEPENDENCY', () => {
      const mid = createTestMission();
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('dup-id'), makeTask('dup-id')],
        dependencies: [],
      }));

      assert.equal(result.ok, false, 'S16: Must reject duplicate task IDs');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_DEPENDENCY', 'S16: Error code must be INVALID_DEPENDENCY for duplicate IDs');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'INVALID_DEPENDENCY-DUPLICATE-IDS');
    });

    it('SC2-ERR-CAPABILITY-VIOLATION: task requires capability not in mission -- CAPABILITY_VIOLATION', () => {
      // Create mission with only 'web_search' capability
      const mid = createTestMission({
        capabilities: ['web_search'],
      });
      const before = snapshotState(conn, mid);

      // Submit task requiring 'code_execution' which is not in mission
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('cap-task', { capabilitiesRequired: ['code_execution'] })],
        dependencies: [],
      }));

      assert.equal(result.ok, false, 'I-22: Must reject task with capability not in mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'CAPABILITY_VIOLATION', 'I-22: Error code must be CAPABILITY_VIOLATION');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'CAPABILITY_VIOLATION');
    });

    it('SC2-ERR-MISSION-NOT-ACTIVE-COMPLETED: mission in COMPLETED state -- MISSION_NOT_ACTIVE', () => {
      // Seed a mission in COMPLETED state (bypasses orchestration validation)
      const completedId = 'completed-mission-1';
      seedMission(conn, {
        id: completedId,
        state: 'COMPLETED',
        capabilities: ['web_search'],
      });
      seedResource(conn, { missionId: completedId });

      const mid = missionId(completedId);
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid));

      assert.equal(result.ok, false, 'S16: Must reject graph for COMPLETED mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE', 'S16: Error code must be MISSION_NOT_ACTIVE');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'MISSION_NOT_ACTIVE-COMPLETED');
    });

    it('SC2-ERR-MISSION-NOT-ACTIVE-FAILED: mission in FAILED state -- MISSION_NOT_ACTIVE', () => {
      const failedId = 'failed-mission-1';
      seedMission(conn, {
        id: failedId,
        state: 'FAILED',
        capabilities: ['web_search'],
      });
      seedResource(conn, { missionId: failedId });

      const mid = missionId(failedId);
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid));

      assert.equal(result.ok, false, 'S16: Must reject graph for FAILED mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE', 'S16: Error code must be MISSION_NOT_ACTIVE');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'MISSION_NOT_ACTIVE-FAILED');
    });

    it('SC2-ERR-MISSION-NOT-ACTIVE-NOT-FOUND: nonexistent missionId -- MISSION_NOT_ACTIVE', () => {
      const fakeMid = missionId('nonexistent-mission-xyz');
      const graphsBefore = countGraphs(conn);
      const tasksBefore = countTasks(conn);
      const eventsBefore = countPlanUpdatedEvents(conn);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(fakeMid));

      assert.equal(result.ok, false, 'S16: Must reject graph for nonexistent mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE', 'S16: Error code must be MISSION_NOT_ACTIVE');
      }

      // State unchanged (no mission to check planVersion on, so check global counts only)
      const graphsAfter = countGraphs(conn);
      assert.equal(graphsAfter, graphsBefore, 'MISSION_NOT_FOUND: Graph count must not change');

      const tasksAfter = countTasks(conn);
      assert.equal(tasksAfter, tasksBefore, 'MISSION_NOT_FOUND: Task count must not change');

      const eventsAfter = countPlanUpdatedEvents(conn);
      assert.equal(eventsAfter, eventsBefore, 'MISSION_NOT_FOUND: Event count must not change');
    });

    it('SC2-ERR-PLAN-REVISION-LIMIT: plan_version at max -- PLAN_REVISION_LIMIT', () => {
      const mid = createTestMission();

      // Set plan_version to maxPlanRevisions (10) directly
      conn.run(
        'UPDATE core_missions SET plan_version = ? WHERE id = ?',
        [MISSION_TREE_DEFAULTS.maxPlanRevisions, mid],
      );

      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid));

      assert.equal(result.ok, false, 'FM-17: Must reject when plan_version >= maxPlanRevisions');
      if (!result.ok) {
        assert.equal(result.error.code, 'PLAN_REVISION_LIMIT', 'FM-17: Error code must be PLAN_REVISION_LIMIT');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'PLAN_REVISION_LIMIT');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS -- Facade-Level Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition -- Facade-Level Verification', () => {

    it('SC2-EVENT-PLAN-UPDATED: verifies PLAN_UPDATED event shape (type, scope, propagation, payload with graphId/planVersion/taskCount)', () => {
      const mid = createTestMission();
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        tasks: [makeTask('event-task-1'), makeTask('event-task-2')],
        dependencies: [],
      }));
      assert.equal(result.ok, true, 'Graph creation must succeed');
      if (!result.ok) return;

      const event = conn.get<{
        type: string; scope: string; propagation: string;
        mission_id: string; emitted_by: string; payload_json: string;
      }>(
        "SELECT type, scope, propagation, mission_id, emitted_by, payload_json FROM core_events_log WHERE type = 'PLAN_UPDATED' AND mission_id = ?",
        [mid],
      );

      assert.ok(event, 'S16: PLAN_UPDATED event must exist');
      assert.equal(event.type, 'PLAN_UPDATED', 'Event type must be PLAN_UPDATED');
      assert.equal(event.scope, 'system', 'Lifecycle events have system scope');
      assert.equal(event.propagation, 'up', 'S16: Lifecycle event propagation must be up');
      assert.equal(event.mission_id, mid, 'Event must reference the correct mission');
      assert.equal(event.emitted_by, 'orchestrator', 'Lifecycle events emitted by orchestrator');

      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      assert.equal(payload.graphId, result.value.graphId, 'S16: payload must contain graphId');
      assert.equal(payload.planVersion, 1, 'S16: payload must contain planVersion');
      assert.equal(payload.taskCount, 2, 'S16: payload must contain taskCount');
    });

    it('SC2-AUDIT-ATOMIC: verifies audit entry with operation=propose_task_graph', () => {
      const mid = createTestMission();
      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid));
      assert.equal(result.ok, true, 'Graph creation must succeed');
      if (!result.ok) return;

      const graphId = result.value.graphId;

      const auditEntry = conn.get<{
        operation: string; resource_type: string; resource_id: string;
        actor_type: string; detail: string;
      }>(
        "SELECT operation, resource_type, resource_id, actor_type, detail FROM core_audit_log WHERE operation = 'propose_task_graph' AND resource_id = ?",
        [graphId],
      );

      assert.ok(auditEntry, 'I-03: Audit entry must exist');
      assert.equal(auditEntry.operation, 'propose_task_graph', 'I-03: operation must be propose_task_graph');
      assert.equal(auditEntry.resource_type, 'task_graph', 'I-03: resource_type must be task_graph');
      assert.equal(auditEntry.resource_id, graphId, 'I-03: resource_id must be the graph id');

      const detail = JSON.parse(auditEntry.detail) as Record<string, unknown>;
      assert.equal(detail.missionId, mid, 'I-03: detail must contain missionId');
      assert.equal(detail.taskCount, 1, 'I-03: detail must contain taskCount');
      assert.equal(detail.planVersion, 1, 'I-03: detail must contain planVersion');
    });

    it('SC2-OBJECTIVEALIGNMENT-EMPTY: empty objectiveAlignment -- error (I-24)', () => {
      const mid = createTestMission();
      const before = snapshotState(conn, mid);

      const result = engine.proposeTaskGraph(ctx, validGraphInput(mid, {
        objectiveAlignment: '',
      }));

      assert.equal(result.ok, false, 'I-24: Must reject empty objectiveAlignment');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'I-24: Empty objectiveAlignment returns MISSION_NOT_ACTIVE (implementation re-uses this code per task_graph.ts line 98)');
      }

      assertStateUnchanged(conn, before.graphs, before.tasks, before.events, before.planVersion, mid, 'OBJECTIVEALIGNMENT-EMPTY');
    });
  });
});
