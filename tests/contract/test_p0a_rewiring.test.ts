/**
 * P0-A Rewiring Verification Tests
 * Task #233: Verify all bypass paths are rewired through OrchestrationTransitionService
 *
 * Tests:
 * 1. Cycle detection in getRootMissionId
 * 2. Task dependency cross-mission validation (structural)
 * 3. RunStore phantom rejection (updateState on non-existent run)
 * 4. AttemptStore phantom rejection (updateState on non-existent attempt)
 * 5. Task scheduling order (enqueue-first, transition-second)
 *
 * S ref: I-20 (tree limits), BC-010 (run identity), BC-011 (attempt identity),
 *        S17 (propose_task_execution), S6 (mission lifecycle)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  taskId,
} from '../helpers/test_database.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationDeps } from '../../src/orchestration/interfaces/orchestration.js';
import { runId, attemptId, testTimestamp } from '../helpers/governance_test_helpers.js';
import { createTaskGraphEngine } from '../../src/orchestration/tasks/task_graph.js';
import { proposeTaskExecution } from '../../src/orchestration/syscalls/propose_task_execution.js';
import { createBudgetGovernor } from '../../src/orchestration/budget/budget_governance.js';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import { createEventPropagator } from '../../src/orchestration/events/event_propagation.js';
import {
  createOrchestrationTransitionService,
} from '../../src/orchestration/transitions/transition_service.js';
import type { OrchestrationTransitionService } from '../../src/orchestration/transitions/transition_service.js';

let conn: DatabaseConnection;
let deps: OrchestrationDeps;
let ctx: OperationContext;
let gov: GovernanceSystem;
let transitionService: OrchestrationTransitionService;

function setup(): void {
  const testDeps = createTestOrchestrationDeps();
  conn = testDeps.conn;
  deps = testDeps.deps;
  transitionService = testDeps.transitionService;
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

// ============================================================================
// 1. Cycle detection in getRootMissionId (Criticals #11, #14)
// ============================================================================

describe('P0-A Critical #11/#14: getRootMissionId cycle detection', () => {
  beforeEach(() => setup());

  it('should detect a cycle in mission parent chain and return CYCLE_DETECTED error', () => {
    const now = new Date().toISOString();

    // To create a cycle we must temporarily disable FK checks since
    // mission-cycle-a references mission-cycle-c which doesn't exist yet.
    // Strategy: insert all three with null parent_id, then UPDATE to create cycle.
    conn.run(
      `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, capabilities, state, plan_version, delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mission-cycle-a', null, null, 'agent-1', 'obj', '[]', '[]', '[]', 'EXECUTING', 0, '[]', '{"budget":100,"deadline":"2030-01-01","maxTasks":10,"maxDepth":5,"maxChildren":5,"budgetDecayFactor":0.3}', 0, 0, now, now],
    );
    conn.run(
      `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, capabilities, state, plan_version, delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mission-cycle-b', null, 'mission-cycle-a', 'agent-1', 'obj', '[]', '[]', '[]', 'EXECUTING', 0, '[]', '{"budget":100,"deadline":"2030-01-01","maxTasks":10,"maxDepth":5,"maxChildren":5,"budgetDecayFactor":0.3}', 1, 0, now, now],
    );
    conn.run(
      `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, capabilities, state, plan_version, delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mission-cycle-c', null, 'mission-cycle-b', 'agent-1', 'obj', '[]', '[]', '[]', 'EXECUTING', 0, '[]', '{"budget":100,"deadline":"2030-01-01","maxTasks":10,"maxDepth":5,"maxChildren":5,"budgetDecayFactor":0.3}', 2, 0, now, now],
    );

    // Now close the cycle: a -> c (making it a -> c -> b -> a)
    conn.run(
      `UPDATE core_missions SET parent_id = 'mission-cycle-c' WHERE id = 'mission-cycle-a'`,
    );

    const store = createMissionStore();
    const result = store.getRootMissionId(deps, missionId('mission-cycle-a'));

    assert.equal(result.ok, false, 'Should fail with CYCLE_DETECTED');
    if (!result.ok) {
      assert.equal(result.error.code, 'CYCLE_DETECTED');
    }
  });

  it('should succeed for a normal parent chain with no cycle', () => {
    const now = new Date().toISOString();

    // Create a normal chain: root -> child
    conn.run(
      `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, capabilities, state, plan_version, delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mission-root', null, null, 'agent-1', 'obj', '[]', '[]', '[]', 'EXECUTING', 0, '[]', '{"budget":100,"deadline":"2030-01-01","maxTasks":10,"maxDepth":5,"maxChildren":5,"budgetDecayFactor":0.3}', 0, 0, now, now],
    );
    conn.run(
      `INSERT INTO core_missions (id, tenant_id, parent_id, agent_id, objective, success_criteria, scope_boundaries, capabilities, state, plan_version, delegation_chain, constraints_json, depth, compacted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['mission-child', null, 'mission-root', 'agent-2', 'obj', '[]', '[]', '[]', 'EXECUTING', 0, '["agent-1"]', '{"budget":100,"deadline":"2030-01-01","maxTasks":10,"maxDepth":5,"maxChildren":5,"budgetDecayFactor":0.3}', 1, 0, now, now],
    );

    const store = createMissionStore();
    const result = store.getRootMissionId(deps, missionId('mission-child'));

    assert.equal(result.ok, true, 'Should succeed');
    if (result.ok) {
      assert.equal(result.value, 'mission-root');
    }
  });
});

// ============================================================================
// 2. Task dependency cross-mission validation (Critical #15)
// ============================================================================

describe('P0-A Critical #15: Task dependency cross-mission validation', () => {
  beforeEach(() => setup());

  it('dependencies within the same graph are structurally prevented from crossing missions', () => {
    // This test verifies the STRUCTURAL prevention: proposeGraph only accepts
    // tasks + dependencies that reference task IDs within the same input.
    // Cross-mission dependencies are impossible through the API because:
    // 1. All tasks in a graph share the same missionId
    // 2. Dependencies can only reference task IDs from the input graph
    // 3. The validation at task_graph.ts rejects unknown task IDs
    //
    // We verify this by confirming an invalid dependency reference is rejected.
    seedMission(conn, { id: 'mission-dep-1' });
    seedResource(conn, { missionId: 'mission-dep-1' });

    // Transition to PLANNING state
    conn.run(
      `UPDATE core_missions SET state = 'PLANNING' WHERE id = 'mission-dep-1'`,
    );

    const engine = createTaskGraphEngine(transitionService);

    const result = engine.proposeGraph(deps, ctx, {
      missionId: missionId('mission-dep-1'),
      tasks: [
        { id: taskId('task-1'), description: 'T1', executionMode: 'deterministic', estimatedTokens: 10, capabilitiesRequired: [] },
      ],
      dependencies: [
        { from: taskId('task-1'), to: taskId('task-from-other-mission') }, // Does not exist in this graph
      ],
      objectiveAlignment: 'Test alignment',
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_DEPENDENCY');
    }
  });
});

// ============================================================================
// 3. RunStore phantom rejection (Critical #6)
// ============================================================================

describe('P0-A Critical #6: RunStore phantom rejection', () => {
  beforeEach(() => setup());

  it('updateState returns error for non-existent run (no phantom creation)', () => {
    const result = gov.runStore.updateState(conn, runId('run-phantom-nonexistent'), 'completed');

    assert.equal(result.ok, false, 'Should fail for non-existent run');
    if (!result.ok) {
      assert.equal(result.error.code, 'RUN_NOT_FOUND');
      assert.ok(
        result.error.message.includes('not found'),
        `Error message should indicate run not found, got: ${result.error.message}`,
      );
    }
  });

  it('updateState succeeds for existing run', () => {
    const now = testTimestamp();
    // Create the run first
    const run = {
      runId: runId('run-existing-test'),
      tenantId: 'test-tenant' as import('../../src/kernel/interfaces/index.js').TenantId,
      missionId: missionId('mission-001'),
      state: 'active' as import('../../src/kernel/interfaces/run_identity.js').RunState,
      startedAt: now,
      schemaVersion: '0.1.0',
      origin: 'runtime' as const,
    };
    const createResult = gov.runStore.create(conn, run);
    assert.equal(createResult.ok, true);

    // Now update should work
    const result = gov.runStore.updateState(conn, runId('run-existing-test'), 'completed');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.state, 'completed');
    }
  });
});

// ============================================================================
// 4. AttemptStore phantom rejection (Critical #6)
// ============================================================================

describe('P0-A Critical #6: AttemptStore phantom rejection', () => {
  beforeEach(() => setup());

  it('updateState returns error for non-existent attempt (no phantom creation)', () => {
    const result = gov.attemptStore.updateState(conn, attemptId('attempt-phantom-nonexistent'), 'executing');

    assert.equal(result.ok, false, 'Should fail for non-existent attempt');
    if (!result.ok) {
      assert.equal(result.error.code, 'ATTEMPT_NOT_FOUND');
      assert.ok(
        result.error.message.includes('not found'),
        `Error message should indicate attempt not found, got: ${result.error.message}`,
      );
    }
  });

  it('updateState succeeds for existing attempt', () => {
    const now = testTimestamp();
    // Create a run first (FK constraint)
    const run = {
      runId: runId('run-for-attempt-test'),
      tenantId: 'test-tenant' as import('../../src/kernel/interfaces/index.js').TenantId,
      missionId: missionId('mission-001'),
      state: 'active' as import('../../src/kernel/interfaces/run_identity.js').RunState,
      startedAt: now,
      schemaVersion: '0.1.0',
      origin: 'runtime' as const,
    };
    gov.runStore.create(conn, run);

    // Create the attempt
    const attempt = {
      attemptId: attemptId('attempt-existing-test'),
      taskId: taskId('task-001'),
      missionId: missionId('mission-001'),
      runId: runId('run-for-attempt-test'),
      state: 'started' as import('../../src/kernel/interfaces/run_identity.js').AttemptState,
      pinnedVersions: {
        missionContractVersion: '1.0.0',
        traceGrammarVersion: '1.0.0',
        evalSchemaVersion: '1.0.0',
        capabilityManifestSchemaVersion: '1.0.0',
      },
      schemaVersion: '0.1.0',
      origin: 'runtime' as const,
      createdAt: now,
    };
    const createResult = gov.attemptStore.create(conn, attempt);
    assert.equal(createResult.ok, true);

    // Now update should work
    const result = gov.attemptStore.updateState(conn, attemptId('attempt-existing-test'), 'executing');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.state, 'executing');
    }
  });
});

// ============================================================================
// 5. Task scheduling order verification (Critical #9)
// ============================================================================

describe('P0-A Critical #9: Task scheduling order (enqueue-first)', () => {
  beforeEach(() => setup());

  it('task stays PENDING when substrate enqueue fails', () => {
    // This test verifies the scheduling order fix:
    // 1. Enqueue first
    // 2. If enqueue fails, task stays PENDING (no zombie SCHEDULED task)

    // Seed the mission and task
    seedMission(conn, { id: 'mission-sched' });
    seedResource(conn, { missionId: 'mission-sched' });
    conn.run(`UPDATE core_missions SET state = 'EXECUTING' WHERE id = 'mission-sched'`);

    const graphId = crypto.randomUUID();
    conn.run(
      `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [graphId, 'mission-sched', 'test-tenant', 1, 'test', new Date().toISOString()],
    );
    conn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [
        'task-sched-1', 'mission-sched', 'test-tenant', graphId, 'Test task',
        'deterministic', 10, '[]', new Date().toISOString(), new Date().toISOString(),
      ],
    );

    // The substrate scheduler in test deps throws (not implemented in stub).
    // The enqueue-first ordering means the throw happens BEFORE any state transition,
    // so the task must remain PENDING (no zombie SCHEDULED task).
    const taskGraph = createTaskGraphEngine(transitionService);
    const budget = createBudgetGovernor(transitionService);
    const events = createEventPropagator();

    let threw = false;
    try {
      proposeTaskExecution(deps, ctx, {
        taskId: taskId('task-sched-1'),
        executionMode: 'deterministic',
        environmentRequest: { capabilities: [], timeout: 5000 },
      }, taskGraph, budget, events);
    } catch {
      threw = true;
    }

    assert.ok(threw, 'Substrate enqueue should throw (test stub not implemented)');

    // The critical assertion: task must still be PENDING, not SCHEDULED.
    // In the old (broken) code, the task would be SCHEDULED before the enqueue attempt,
    // leaving a zombie SCHEDULED task when enqueue fails.
    const taskRow = conn.get<{ state: string }>(
      'SELECT state FROM core_tasks WHERE id = ?',
      ['task-sched-1'],
    );
    assert.ok(taskRow, 'Task should exist');
    assert.equal(taskRow!.state, 'PENDING', 'Task should stay PENDING when enqueue fails (Critical #9)');
  });
});

// ============================================================================
// 6. F-RW-008: Budget governance → transitionService delegation verification
// ============================================================================

describe('F-RW-008: Budget governance delegates to transitionMissionRecovery', () => {
  let service: OrchestrationTransitionService;

  beforeEach(() => {
    setup();
    gov = createGovernanceSystem();
    service = createOrchestrationTransitionService(
      gov.transitionEnforcer,
      deps.audit,
      deps.time,
    );
  });

  it('success: transitions EXECUTING mission to BLOCKED when budget exceeded via recovery path', () => {
    // Seed mission in EXECUTING state with budget
    seedMission(conn, { id: 'mission-budget-001', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'mission-budget-001', tokenAllocated: 100, tokenConsumed: 95 });

    // Create budget governor WITH transition service (F-RW-004: uses recovery path)
    const governor = createBudgetGovernor(service);

    // Attempt to consume more than remaining (5 remaining, consuming 10)
    const result = governor.consume(deps, missionId('mission-budget-001'), { tokens: 10 });

    // Budget consume should fail with BUDGET_EXCEEDED
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'BUDGET_EXCEEDED');
    }

    // The mission should now be BLOCKED (transitioned via recovery path)
    const missionRow = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      ['mission-budget-001'],
    );
    assert.ok(missionRow, 'Mission should exist');
    assert.equal(missionRow!.state, 'BLOCKED', 'Mission should be BLOCKED after budget exceeded');

    // Verify audit trail records the transition (not silent)
    const auditEntries = conn.query<{ operation: string; resource_id: string }>(
      `SELECT operation, resource_id FROM core_audit_log WHERE resource_id = 'mission-budget-001' AND operation = 'mission_transition'`,
      [],
    );
    assert.ok(auditEntries.length > 0, 'Audit trail should record the BLOCKED transition');
  });

  it('rejection: budget exceeded on PAUSED mission still transitions to BLOCKED via recovery', () => {
    // F-RW-004: PAUSED → BLOCKED is not in MISSION_TRANSITIONS, but recovery skips map.
    // Budget enforcement is a system-level override — must work from any non-terminal state.
    seedMission(conn, { id: 'mission-budget-paused', state: 'PAUSED' });
    seedResource(conn, { missionId: 'mission-budget-paused', tokenAllocated: 50, tokenConsumed: 45 });

    const governor = createBudgetGovernor(service);

    const result = governor.consume(deps, missionId('mission-budget-paused'), { tokens: 10 });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, 'BUDGET_EXCEEDED');
    }

    // Mission should be BLOCKED even though it was PAUSED (recovery path handles this)
    const missionRow = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      ['mission-budget-paused'],
    );
    assert.ok(missionRow, 'Mission should exist');
    assert.equal(missionRow!.state, 'BLOCKED', 'PAUSED mission should be BLOCKED via recovery path');
  });
});

// ============================================================================
// 7. F-RW-008: Checkpoint coordinator → transitionService delegation verification
// ============================================================================

describe('F-RW-008: Checkpoint coordinator delegates to transitionMissionRecovery', () => {
  let service: OrchestrationTransitionService;

  beforeEach(() => {
    setup();
    gov = createGovernanceSystem();
    service = createOrchestrationTransitionService(
      gov.transitionEnforcer,
      deps.audit,
      deps.time,
    );
  });

  it('success: escalation transitions EXECUTING mission to BLOCKED via recovery path', () => {
    seedMission(conn, { id: 'mission-ckpt-001', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'mission-ckpt-001' });

    const coordinator = createCheckpointCoordinator(service);

    // Fire a checkpoint
    const fireResult = coordinator.fire(deps, missionId('mission-ckpt-001'), 'PERIODIC');
    assert.equal(fireResult.ok, true);
    const checkpointId = (fireResult as { ok: true; value: string }).value;

    // Respond with escalation (very low confidence → system escalates)
    const respondResult = coordinator.processResponse(deps, {
      checkpointId,
      assessment: 'Things look bad',
      confidence: 0.1, // Very low → halt and escalate
      proposedAction: 'continue',
      planRevision: null,
      escalationReason: null,
    });

    assert.equal(respondResult.ok, true);
    if (respondResult.ok) {
      assert.equal(respondResult.value.action, 'escalated');
    }

    // Mission should be BLOCKED via transition service recovery path
    const missionRow = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      ['mission-ckpt-001'],
    );
    assert.ok(missionRow, 'Mission should exist');
    assert.equal(missionRow!.state, 'BLOCKED', 'Mission should be BLOCKED after checkpoint escalation');
  });

  it('rejection: abort on PAUSED mission transitions to CANCELLED via recovery path', () => {
    // F-RW-004: PAUSED → CANCELLED is not in MISSION_TRANSITIONS, but recovery handles it.
    seedMission(conn, { id: 'mission-ckpt-paused', state: 'PAUSED' });
    seedResource(conn, { missionId: 'mission-ckpt-paused' });

    const coordinator = createCheckpointCoordinator(service);

    // Fire checkpoint
    const fireResult = coordinator.fire(deps, missionId('mission-ckpt-paused'), 'PERIODIC');
    assert.equal(fireResult.ok, true);
    const checkpointId = (fireResult as { ok: true; value: string }).value;

    // Respond with abort
    const respondResult = coordinator.processResponse(deps, {
      checkpointId,
      assessment: 'Must abort',
      confidence: 0.5,
      proposedAction: 'abort',
      planRevision: null,
      escalationReason: null,
    });

    assert.equal(respondResult.ok, true);
    if (respondResult.ok) {
      assert.equal(respondResult.value.action, 'aborted');
    }

    // Mission should be CANCELLED via recovery path (PAUSED → CANCELLED)
    const missionRow = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      ['mission-ckpt-paused'],
    );
    assert.ok(missionRow, 'Mission should exist');
    assert.equal(missionRow!.state, 'CANCELLED', 'PAUSED mission should be CANCELLED via recovery path on abort');
  });
});
