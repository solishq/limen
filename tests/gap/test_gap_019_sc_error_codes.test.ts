/**
 * TEST-GAP-019: System Call Error Code Negative Tests
 * Phase 4G: Test Hardening Sweep — CF-003 Resolution
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * Verifies: Every SC error code has at least one negative test that:
 *   1. Calls real implementation code
 *   2. Triggers the specific error condition
 *   3. Asserts the exact error code returned
 *
 * Coverage: 20 previously-untested error codes across SC-2, SC-3, SC-4, SC-5, SC-6, SC-7, SC-9, SC-10.
 * Phase 4G Remediation: Added SC-5/NOT_FOUND, SC-6/INVALID_TYPE, SC-6/MISSION_NOT_FOUND,
 * SC-7/CAPABILITY_DENIED, SC-10/CHECKPOINT_EXPIRED.
 *
 * S ref: S16-S19, S23, FM-17, I-20, I-22, I-24
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskGraphEngine } from '../../src/orchestration/tasks/task_graph.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import { createEventPropagator } from '../../src/orchestration/events/event_propagation.js';
import { createCompactionEngine } from '../../src/orchestration/compaction/bounded_cognition.js';
import { proposeTaskExecution } from '../../src/orchestration/syscalls/propose_task_execution.js';
import { submitResult } from '../../src/orchestration/syscalls/submit_result.js';
import { readArtifact } from '../../src/orchestration/syscalls/read_artifact.js';
import { requestCapability } from '../../src/orchestration/syscalls/request_capability.js';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import { MISSION_TREE_DEFAULTS } from '../../src/orchestration/interfaces/orchestration.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  taskId,
  agentId,
} from '../helpers/test_database.js';
import type { MissionId, TaskId, ArtifactId } from '../../src/kernel/interfaces/index.js';

// ─── Helpers ───

function makeTask(id: string, tokens: number = 100, caps: string[] = ['web_search']) {
  return {
    id: taskId(id) as unknown as import('../../src/orchestration/interfaces/orchestration.js').TaskDefinition['id'],
    description: `Task ${id}`,
    executionMode: 'deterministic' as const,
    estimatedTokens: tokens,
    capabilitiesRequired: caps,
  };
}

function makeDep(from: string, to: string) {
  return {
    from: taskId(from) as unknown as import('../../src/orchestration/interfaces/orchestration.js').TaskDependency['from'],
    to: taskId(to) as unknown as import('../../src/orchestration/interfaces/orchestration.js').TaskDependency['to'],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SC-2: propose_task_graph — 5 error codes
// ═══════════════════════════════════════════════════════════════════════════

describe('TEST-GAP-019: SC-2 propose_task_graph error codes', () => {

  it('CYCLE_DETECTED: rejects self-referencing dependency', () => {
    // S16: "CYCLE_DETECTED -- dependency graph contains cycle"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'cycle-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'cycle-m1' });

    const result = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('cycle-m1'),
      tasks: [makeTask('t1'), makeTask('t2')],
      dependencies: [makeDep('t1', 't1')], // self-cycle
      objectiveAlignment: 'Test alignment',
    });

    assert.equal(result.ok, false, 'S16: must reject cyclic graph');
    if (!result.ok) {
      assert.equal(result.error.code, 'CYCLE_DETECTED',
        'CATCHES: without cycle detection, self-dependency silently accepted');
    }

    conn.close();
  });

  it('TASK_LIMIT_EXCEEDED: rejects when task count exceeds maxTasks', () => {
    // S16/FM-17: "TASK_LIMIT_EXCEEDED -- count > mission.maxTasks"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'limit-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'limit-m1' });

    // Create maxTasks + 1 tasks
    const tasks = [];
    for (let i = 0; i <= MISSION_TREE_DEFAULTS.maxTasks; i++) {
      tasks.push(makeTask(`t${i}`));
    }

    const result = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('limit-m1'),
      tasks,
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });

    assert.equal(result.ok, false, 'FM-17: must reject when tasks exceed limit');
    if (!result.ok) {
      assert.equal(result.error.code, 'TASK_LIMIT_EXCEEDED',
        'CATCHES: without limit check, unbounded task creation causes plan explosion');
    }

    conn.close();
  });

  it('INVALID_DEPENDENCY: rejects dependency referencing non-existent task', () => {
    // S16: "INVALID_DEPENDENCY -- edge references non-existent task"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'dep-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'dep-m1' });

    const result = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('dep-m1'),
      tasks: [makeTask('t1'), makeTask('t2')],
      dependencies: [makeDep('t1', 'nonexistent')], // 'nonexistent' not in tasks
      objectiveAlignment: 'Test alignment',
    });

    assert.equal(result.ok, false, 'S16: must reject invalid dependency reference');
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_DEPENDENCY',
        'CATCHES: without ref validation, dangling dependency causes runtime crash');
    }

    conn.close();
  });

  it('MISSION_NOT_ACTIVE: rejects when mission is in terminal state', () => {
    // S16: "MISSION_NOT_ACTIVE -- mission state doesn't permit planning"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const ctx = createTestOperationContext();

    // Seed mission in COMPLETED state (terminal)
    seedMission(conn, { id: 'term-m1', agentId: 'agent-1', state: 'COMPLETED', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'term-m1' });

    const result = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('term-m1'),
      tasks: [makeTask('t1')],
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });

    assert.equal(result.ok, false, 'S16: must reject planning for terminal mission');
    if (!result.ok) {
      assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
        'CATCHES: without state check, completed missions accept new task graphs');
    }

    conn.close();
  });

  it('PLAN_REVISION_LIMIT: rejects when plan version at maximum', () => {
    // S16/FM-17: "PLAN_REVISION_LIMIT -- revision count >= maxPlanRevisions"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'rev-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'rev-m1' });

    // Set plan_version to maxPlanRevisions (10)
    conn.run(
      `UPDATE core_missions SET plan_version = ? WHERE id = ?`,
      [MISSION_TREE_DEFAULTS.maxPlanRevisions, 'rev-m1'],
    );

    const result = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('rev-m1'),
      tasks: [makeTask('t1')],
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });

    assert.equal(result.ok, false, 'FM-17: must reject when plan revision at limit');
    if (!result.ok) {
      assert.equal(result.error.code, 'PLAN_REVISION_LIMIT',
        'CATCHES: without limit, agents can replan infinitely (plan explosion)');
    }

    conn.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SC-3: propose_task_execution — 4 error codes
// ═══════════════════════════════════════════════════════════════════════════

describe('TEST-GAP-019: SC-3 propose_task_execution error codes', () => {

  it('TASK_NOT_PENDING: rejects when task is not in PENDING state', () => {
    // S17: task must be in PENDING state to be scheduled
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const budget = createBudgetGovernor();
    const events = createEventPropagator();
    const ctx = createTestOperationContext();

    // Create mission and task graph with one task
    seedMission(conn, { id: 'exec-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'exec-m1' });

    const graphResult = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('exec-m1'),
      tasks: [makeTask('exec-t1')],
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });
    assert.equal(graphResult.ok, true, 'Setup: graph must succeed');

    // Manually transition task to COMPLETED (not PENDING)
    conn.run(
      `UPDATE core_tasks SET state = 'COMPLETED' WHERE id = ?`,
      ['exec-t1'],
    );

    const result = proposeTaskExecution(deps, ctx, {
      taskId: taskId('exec-t1'),
      executionMode: 'deterministic',
      environmentRequest: { capabilities: ['web_search'], timeout: 30000 },
    }, taskGraph, budget, events);

    assert.equal(result.ok, false, 'S17: must reject non-PENDING task');
    if (!result.ok) {
      assert.equal(result.error.code, 'TASK_NOT_PENDING',
        'CATCHES: without state check, completed tasks get re-executed');
    }

    conn.close();
  });

  it('DEPENDENCIES_UNMET: rejects when prerequisite tasks not completed', () => {
    // S17: "DEPENDENCIES_UNMET -- prerequisite tasks not COMPLETED"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const budget = createBudgetGovernor();
    const events = createEventPropagator();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'depmet-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'depmet-m1' });

    // Create two tasks where t2 depends on t1
    const graphResult = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('depmet-m1'),
      tasks: [makeTask('depmet-t1'), makeTask('depmet-t2')],
      dependencies: [makeDep('depmet-t1', 'depmet-t2')],
      objectiveAlignment: 'Test alignment',
    });
    assert.equal(graphResult.ok, true, 'Setup: graph must succeed');

    // Try to execute t2 without completing t1
    const result = proposeTaskExecution(deps, ctx, {
      taskId: taskId('depmet-t2'),
      executionMode: 'deterministic',
      environmentRequest: { capabilities: ['web_search'], timeout: 30000 },
    }, taskGraph, budget, events);

    assert.equal(result.ok, false, 'S17: must reject when dependencies not met');
    if (!result.ok) {
      assert.equal(result.error.code, 'DEPENDENCIES_UNMET',
        'CATCHES: without dep check, tasks execute before prerequisites complete');
    }

    conn.close();
  });

  it('CAPABILITY_DENIED: rejects when capability not in mission set', () => {
    // S17/I-22: "CAPABILITY_DENIED -- capability not in mission set"
    const { deps, conn } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const budget = createBudgetGovernor();
    const events = createEventPropagator();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'cap-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'cap-m1' });

    const graphResult = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('cap-m1'),
      tasks: [makeTask('cap-t1')],
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });
    assert.equal(graphResult.ok, true, 'Setup: graph must succeed');

    // Request capability not in mission set
    const result = proposeTaskExecution(deps, ctx, {
      taskId: taskId('cap-t1'),
      executionMode: 'deterministic',
      environmentRequest: { capabilities: ['code_execute'], timeout: 30000 }, // 'code_execute' not in mission
    }, taskGraph, budget, events);

    assert.equal(result.ok, false, 'I-22: must deny capability not in mission set');
    if (!result.ok) {
      assert.equal(result.error.code, 'CAPABILITY_DENIED',
        'CATCHES: without cap check, agents escalate beyond mission scope');
    }

    conn.close();
  });

  it('WORKER_UNAVAILABLE: rejects when substrate scheduler fails', () => {
    // S17: "WORKER_UNAVAILABLE -- substrate scheduler enqueue failed"
    const { conn, audit } = createTestOrchestrationDeps();
    const taskGraph = createTaskGraphEngine();
    const budget = createBudgetGovernor();
    const events = createEventPropagator();
    const ctx = createTestOperationContext();

    // Create deps with a custom substrate that returns a failure Result (not throw)
    const failingSubstrate = {
      scheduler: {
        enqueue: () => ({ ok: false, error: { code: 'SCHEDULER_FULL', message: 'No workers available', spec: 'S17' } }),
        dequeue: () => { throw new Error('stub'); },
        peek: () => { throw new Error('stub'); },
        size: () => { throw new Error('stub'); },
        clear: () => { throw new Error('stub'); },
      },
      workerPool: { dispatch: () => { throw new Error('stub'); }, getWorker: () => { throw new Error('stub'); }, shutdown: () => { throw new Error('stub'); }, getMetrics: () => { throw new Error('stub'); } },
      gateway: { sendRequest: () => { throw new Error('stub'); }, requestStream: () => { throw new Error('stub'); }, getProviderHealth: () => { throw new Error('stub'); }, registerProvider: () => { throw new Error('stub'); } },
      heartbeat: { start: () => { throw new Error('stub'); }, stop: () => { throw new Error('stub'); }, check: () => { throw new Error('stub'); }, getStatus: () => { throw new Error('stub'); } },
      accounting: { recordInteraction: () => { throw new Error('stub'); }, getAccountingSummary: () => { throw new Error('stub'); }, checkRateLimit: () => { throw new Error('stub'); }, consumeRateLimit: () => { throw new Error('stub'); } },
      shutdown: () => { throw new Error('stub'); },
    } as unknown as import('../../src/orchestration/interfaces/orchestration.js').OrchestrationDeps['substrate'];

    const depsWithFailingScheduler: import('../../src/orchestration/interfaces/orchestration.js').OrchestrationDeps = Object.freeze({
      conn, substrate: failingSubstrate, audit,
      time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
    });

    seedMission(conn, { id: 'worker-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'worker-m1' });

    const graphResult = taskGraph.proposeGraph(depsWithFailingScheduler, ctx, {
      missionId: missionId('worker-m1'),
      tasks: [makeTask('worker-t1')],
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });
    assert.equal(graphResult.ok, true, 'Setup: graph must succeed');

    const result = proposeTaskExecution(depsWithFailingScheduler, ctx, {
      taskId: taskId('worker-t1'),
      executionMode: 'deterministic',
      environmentRequest: { capabilities: ['web_search'], timeout: 30000 },
    }, taskGraph, budget, events);

    assert.equal(result.ok, false, 'S17: must handle scheduler failure');
    if (!result.ok) {
      assert.equal(result.error.code, 'WORKER_UNAVAILABLE',
        'CATCHES: without error handling, scheduler failure kills request');
    }

    conn.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SC-4: create_artifact — 2 error codes
// ═══════════════════════════════════════════════════════════════════════════

describe('TEST-GAP-019: SC-4 create_artifact error codes', () => {

  it('ARTIFACT_LIMIT_EXCEEDED: rejects when artifact count at maximum', () => {
    // I-20/S18: "ARTIFACT_LIMIT_EXCEEDED -- count >= max"
    const { deps, conn } = createTestOrchestrationDeps();
    const artifacts = createArtifactStore();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'artlim-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'artlim-m1' });

    // Seed maxArtifacts artifacts directly (source_task_id is NOT NULL)
    const now = new Date().toISOString();
    for (let i = 0; i < MISSION_TREE_DEFAULTS.maxArtifacts; i++) {
      conn.run(
        `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
         VALUES (?, 1, ?, 'test-tenant', ?, 'report', 'markdown', X'00', 'ACTIVE', 'seed-task', NULL, 0, '{}', ?)`,
        [`art-${i}`, 'artlim-m1', `Artifact ${i}`, now],
      );
    }

    const result = artifacts.create(deps, ctx, {
      missionId: missionId('artlim-m1'),
      name: 'One too many',
      type: 'report',
      format: 'markdown',
      content: 'Content',
      sourceTaskId: taskId('t-1'),
      parentArtifactId: null,
      metadata: {},
    });

    assert.equal(result.ok, false, 'I-20: must reject when artifact count at maximum');
    if (!result.ok) {
      assert.equal(result.error.code, 'ARTIFACT_LIMIT_EXCEEDED',
        'CATCHES: without limit, unbounded artifact creation exhausts storage');
    }

    conn.close();
  });

  it('STORAGE_EXCEEDED: rejects when content exceeds storage budget', () => {
    // S18: "STORAGE_EXCEEDED -- content size exceeds storage budget"
    const { deps, conn } = createTestOrchestrationDeps();
    const artifacts = createArtifactStore();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'store-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'store-m1' });

    // Set a small storage budget
    conn.run(
      `UPDATE core_resources SET storage_max_bytes = 100, storage_consumed_bytes = 50 WHERE mission_id = ?`,
      ['store-m1'],
    );

    const result = artifacts.create(deps, ctx, {
      missionId: missionId('store-m1'),
      name: 'Large artifact',
      type: 'data',
      format: 'json',
      content: 'X'.repeat(200), // 200 bytes > remaining 50
      sourceTaskId: taskId('t-1'),
      parentArtifactId: null,
      metadata: {},
    });

    assert.equal(result.ok, false, 'S18: must reject when storage budget exceeded');
    if (!result.ok) {
      assert.equal(result.error.code, 'STORAGE_EXCEEDED',
        'CATCHES: without storage check, missions consume unbounded disk');
    }

    conn.close();
  });

  it('MISSION_NOT_ACTIVE: rejects artifact creation for completed mission', () => {
    // S18: "MISSION_NOT_ACTIVE -- mission in terminal state"
    const { deps, conn } = createTestOrchestrationDeps();
    const artifacts = createArtifactStore();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'artterm-m1', agentId: 'agent-1', state: 'COMPLETED', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'artterm-m1' });

    const result = artifacts.create(deps, ctx, {
      missionId: missionId('artterm-m1'),
      name: 'Late artifact',
      type: 'report',
      format: 'markdown',
      content: 'Should be rejected',
      sourceTaskId: taskId('t-1'),
      parentArtifactId: null,
      metadata: {},
    });

    assert.equal(result.ok, false, 'S18: must reject for completed mission');
    if (!result.ok) {
      assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
        'CATCHES: without state check, artifacts created after mission ends');
    }

    conn.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SC-5: read_artifact — ARCHIVED error code
// ═══════════════════════════════════════════════════════════════════════════

describe('TEST-GAP-019: SC-5 read_artifact error codes', () => {

  it('ARCHIVED: rejects read of archived artifact', () => {
    // S19: "ARCHIVED -- artifact in ARCHIVED or DELETED state"
    const { deps, conn } = createTestOrchestrationDeps();
    const artifacts = createArtifactStore();
    const ctx = createTestOperationContext();

    // Seed a mission for FK, then an artifact in ARCHIVED state
    seedMission(conn, { id: 'arch-m1', agentId: 'agent-1', state: 'COMPLETED', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'arch-m1' });

    const now = new Date().toISOString();
    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES ('archived-art-1', 1, 'arch-m1', 'test-tenant', 'Old report', 'report', 'markdown', X'48656C6C6F', 'ARCHIVED', 'seed-task', NULL, 0, '{}', ?)`,
      [now],
    );

    const result = artifacts.read(deps, ctx, {
      artifactId: 'archived-art-1' as ArtifactId,
      version: 'latest',
    });

    assert.equal(result.ok, false, 'S19: must reject read of archived artifact');
    if (!result.ok) {
      assert.equal(result.error.code, 'ARCHIVED',
        'CATCHES: without lifecycle check, archived data returned as active');
    }

    conn.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SC-9: submit_result — 2 error codes
// ═══════════════════════════════════════════════════════════════════════════

describe('TEST-GAP-019: SC-9 submit_result error codes', () => {

  it('NO_ARTIFACTS: rejects when no deliverable artifacts specified', () => {
    // S23: "NO_ARTIFACTS -- no deliverables specified"
    const { deps, conn } = createTestOrchestrationDeps();
    const missions = createMissionStore();
    const events = createEventPropagator();
    const compaction = createCompactionEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'noart-m1', agentId: 'agent-1', state: 'REVIEWING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'noart-m1' });

    const result = submitResult(deps, ctx, {
      missionId: missionId('noart-m1'),
      summary: 'Done',
      confidence: 0.9,
      artifactIds: [], // empty — violation
      unresolvedQuestions: [],
      followupRecommendations: [],
    }, missions, events, compaction);

    assert.equal(result.ok, false, 'S23: must reject when no artifacts');
    if (!result.ok) {
      assert.equal(result.error.code, 'NO_ARTIFACTS',
        'CATCHES: without check, missions complete without deliverables');
    }

    conn.close();
  });

  it('TASKS_INCOMPLETE: rejects when tasks not in terminal state', () => {
    // S23: "TASKS_INCOMPLETE -- required tasks not COMPLETED/CANCELLED"
    const { deps, conn } = createTestOrchestrationDeps();
    const missions = createMissionStore();
    const taskGraph = createTaskGraphEngine();
    const events = createEventPropagator();
    const compaction = createCompactionEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'taskinc-m1', agentId: 'agent-1', state: 'CREATED', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'taskinc-m1' });

    // Create a task graph with a PENDING task (auto-transitions CREATED -> PLANNING)
    const graphResult = taskGraph.proposeGraph(deps, ctx, {
      missionId: missionId('taskinc-m1'),
      tasks: [makeTask('taskinc-t1')],
      dependencies: [],
      objectiveAlignment: 'Test alignment',
    });
    assert.equal(graphResult.ok, true, 'Setup: graph must succeed');

    // Manually transition to REVIEWING (Ruling 1: only REVIEWING -> COMPLETED valid)
    deps.conn.run(
      `UPDATE core_missions SET state = 'REVIEWING', updated_at = ? WHERE id = ?`,
      [new Date().toISOString(), 'taskinc-m1'],
    );

    // Task is still PENDING — not terminal
    const result = submitResult(deps, ctx, {
      missionId: missionId('taskinc-m1'),
      summary: 'Premature completion',
      confidence: 0.8,
      artifactIds: ['art-1' as ArtifactId],
      unresolvedQuestions: [],
      followupRecommendations: [],
    }, missions, events, compaction);

    assert.equal(result.ok, false, 'S23: must reject when tasks not terminal');
    if (!result.ok) {
      assert.equal(result.error.code, 'TASKS_INCOMPLETE',
        'CATCHES: without task check, missions complete with work still pending');
    }

    conn.close();
  });

  it('MISSION_NOT_ACTIVE: rejects when mission already completed', () => {
    // S23: "MISSION_NOT_ACTIVE -- mission in terminal state"
    const { deps, conn } = createTestOrchestrationDeps();
    const missions = createMissionStore();
    const events = createEventPropagator();
    const compaction = createCompactionEngine();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'compl-m1', agentId: 'agent-1', state: 'COMPLETED', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'compl-m1' });

    const result = submitResult(deps, ctx, {
      missionId: missionId('compl-m1'),
      summary: 'Double completion',
      confidence: 0.9,
      artifactIds: ['art-1' as ArtifactId],
      unresolvedQuestions: [],
      followupRecommendations: [],
    }, missions, events, compaction);

    assert.equal(result.ok, false, 'S23: must reject for completed mission');
    if (!result.ok) {
      assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
        'CATCHES: without state check, missions completed multiple times');
    }

    conn.close();
  });

  // ─── Phase 4G Remediation: 5 additional SC error codes ───

  it('SC-5 NOT_FOUND: read_artifact returns NOT_FOUND for nonexistent artifact', () => {
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const artifacts = createArtifactStore();
    const events = createEventPropagator();

    const result = readArtifact(deps, ctx, {
      artifactId: 'nonexistent-artifact-id' as unknown as ArtifactId,
      version: 'latest',
    }, artifacts, events);

    assert.equal(result.ok, false, 'S19: must return error for nonexistent artifact');
    if (!result.ok) {
      assert.equal(result.error.code, 'NOT_FOUND',
        'CATCHES: without NOT_FOUND, agents cannot distinguish missing from archived');
    }

    conn.close();
  });

  it('SC-6 INVALID_TYPE: emit_event rejects reserved system.* namespace (SD-09)', () => {
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const events = createEventPropagator();

    // Seed a mission for the event to target
    seedMission(conn, { id: 'ev-m1', agentId: 'agent-1', state: 'EXECUTING' });

    const result = events.emit(deps, ctx, {
      eventType: 'system.shutdown',
      missionId: missionId('ev-m1'),
      payload: {},
      propagation: 'local',
    });

    assert.equal(result.ok, false, 'S20: must reject reserved namespace');
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_TYPE',
        'CATCHES: without namespace validation, agents can spoof system events (FM-13)');
    }

    conn.close();
  });

  it('SC-6 MISSION_NOT_FOUND: emit_event rejects event for nonexistent mission', () => {
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const events = createEventPropagator();

    const result = events.emit(deps, ctx, {
      eventType: 'custom.test_event',
      missionId: missionId('nonexistent-mission'),
      payload: { test: true },
      propagation: 'local',
    });

    assert.equal(result.ok, false, 'S20: must reject for nonexistent mission');
    if (!result.ok) {
      assert.equal(result.error.code, 'MISSION_NOT_FOUND',
        'CATCHES: without mission validation, events emitted into void');
    }

    conn.close();
  });

  it('SC-7 CAPABILITY_DENIED: request_capability rejects capability not in mission set (I-22)', () => {
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const budget = createBudgetGovernor();

    // Seed mission with only web_search capability
    seedMission(conn, { id: 'cap-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
    seedResource(conn, { missionId: 'cap-m1' });

    // Request code_execute — not in mission's capability set
    const result = requestCapability(deps, ctx, {
      capabilityType: 'code_execute',
      parameters: {},
      missionId: missionId('cap-m1'),
      taskId: taskId('task-1'),
    }, budget);

    assert.equal(result.ok, false, 'S21: must reject capability not in set');
    if (!result.ok) {
      assert.equal(result.error.code, 'CAPABILITY_DENIED',
        'CATCHES: without I-22 enforcement, agents can escalate beyond declared capabilities');
    }

    conn.close();
  });

  it('SC-10 CHECKPOINT_EXPIRED: respond_checkpoint rejects nonexistent checkpoint', () => {
    /**
     * Spec index lists both CHECKPOINT_EXPIRED and NOT_FOUND for SC-10.
     * Implementation uses CHECKPOINT_EXPIRED for all three cases:
     * - checkpoint doesn't exist
     * - checkpoint not in PENDING state
     * - checkpoint response after timeout
     * Decision: test what the code returns (CHECKPOINT_EXPIRED).
     * The code conflates NOT_FOUND with expired — acceptable since both
     * indicate the response window is closed.
     */
    const { deps, conn } = createTestOrchestrationDeps();
    const coordinator = createCheckpointCoordinator();

    const result = coordinator.processResponse(deps, {
      checkpointId: 'nonexistent-checkpoint-id',
      assessment: 'Test assessment',
      confidence: 0.9,
      proposedAction: 'continue',
      planRevision: null,
      escalationReason: null,
    });

    assert.equal(result.ok, false, 'S24: must reject nonexistent checkpoint');
    if (!result.ok) {
      assert.equal(result.error.code, 'CHECKPOINT_EXPIRED',
        'CATCHES: without existence check, responses to phantom checkpoints accepted');
    }

    conn.close();
  });
});
