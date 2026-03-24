/**
 * P0-A: OrchestrationTransitionService Contract Tests
 * Truth Model: S6 (Mission lifecycle), S7 (Task lifecycle), BC-062, BC-070, I-03, I-25
 *
 * Phase: P0-A (Structural Integrity Pass)
 *
 * Tests the OrchestrationTransitionService — the SOLE mechanism for changing
 * mission and task state at L2 (orchestration layer). The service bridges
 * orchestration types (MissionState — 10 flat states) to governance types
 * (MissionLifecycleState — 6 states + substates) via the TransitionEnforcer.
 *
 * 11 required contract tests:
 *   1. Legal mission transition succeeds (CREATED → PLANNING)
 *   2. Illegal mission transition rejected (CREATED → COMPLETED)
 *   3. Phantom entity cannot be transitioned
 *   4. Audit trail honesty (transition + audit entry agree)
 *   5. TOCTOU handling (two concurrent transitions from same state)
 *   6. Legal task transition (PENDING → SCHEDULED)
 *   7. Illegal task transition (PENDING → COMPLETED)
 *   8. Bulk task transition (all or none)
 *   9. Recovery override (bypass transition map for recovery)
 *  10. REVIEWING trigger (all tasks terminal → auto REVIEWING)
 *  11. Terminal state rejection (COMPLETED → anything rejected)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestOrchestrationDeps,
  seedMission,
  missionId,
  taskId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, AuditTrail, TimeProvider } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationDeps } from '../../src/orchestration/interfaces/orchestration.js';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { TransitionEnforcer } from '../../src/kernel/interfaces/lifecycle.js';
import {
  createOrchestrationTransitionService,
} from '../../src/orchestration/transitions/transition_service.js';
import type {
  OrchestrationTransitionService,
} from '../../src/orchestration/transitions/transition_service.js';

// ─── Test Fixture State ───

let conn: DatabaseConnection;
let deps: OrchestrationDeps;
let audit: AuditTrail;
let gov: GovernanceSystem;
let service: OrchestrationTransitionService;

// ─── Seed Helpers ───

function seedMissionAtState(id: string, state: string): void {
  seedMission(conn, { id, state });
}

function seedTaskGraph(graphId: string, mid: string): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_task_graphs (id, mission_id, version, objective_alignment, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [graphId, mid, 1, 'test alignment', 1, now],
  );
}

function seedTask(id: string, mid: string, graphId: string, state: string = 'PENDING'): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, mid, 'test-tenant', graphId, 'test task', 'deterministic', state, now, now],
  );
}

function getAuditEntries(resourceId: string): Array<Record<string, unknown>> {
  return conn.query<Record<string, unknown>>(
    `SELECT * FROM core_audit_log WHERE resource_id = ? ORDER BY seq_no DESC`,
    [resourceId],
  );
}

function getMissionState(id: string): string | undefined {
  const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', [id]);
  return row?.state;
}

function getTaskState(id: string): string | undefined {
  const row = conn.get<{ state: string }>('SELECT state FROM core_tasks WHERE id = ?', [id]);
  return row?.state;
}

// ─── Test Suite ───

describe('P0-A: OrchestrationTransitionService', () => {
  beforeEach(() => {
    const testSetup = createTestOrchestrationDeps();
    conn = testSetup.conn;
    deps = testSetup.deps;
    audit = testSetup.audit;
    gov = createGovernanceSystem();
    service = createOrchestrationTransitionService(
      gov.transitionEnforcer,
      deps.audit,
      deps.time,
    );
  });

  // ── Test 1: Legal mission transition succeeds ──

  describe('mission transitions', () => {
    it('1. legal transition CREATED → PLANNING succeeds with state + audit entry', () => {
      const mid = 'mission-legal-001';
      seedMissionAtState(mid, 'CREATED');

      const result = service.transitionMission(
        conn,
        missionId(mid),
        'CREATED',
        'PLANNING',
      );

      assert.ok(result.ok, `Expected success, got error: ${!result.ok ? result.error.message : ''}`);
      assert.equal(result.value.fromState, 'CREATED');
      assert.equal(result.value.toState, 'PLANNING');
      assert.ok(result.value.timestamp, 'Timestamp must be present');

      // Verify DB state changed
      assert.equal(getMissionState(mid), 'PLANNING');

      // Verify audit entry exists
      const audits = getAuditEntries(mid);
      assert.ok(audits.length > 0, 'Audit entry must exist');
      const lastAudit = audits[0]!;
      assert.equal(lastAudit['operation'], 'mission_transition');
      const detail = JSON.parse(lastAudit['detail'] as string);
      assert.equal(detail.from, 'CREATED');
      assert.equal(detail.to, 'PLANNING');
    });

    // ── Test 2: Illegal mission transition rejected ──

    it('2. illegal transition CREATED → COMPLETED rejected with INVALID_TRANSITION', () => {
      const mid = 'mission-illegal-001';
      seedMissionAtState(mid, 'CREATED');

      const result = service.transitionMission(
        conn,
        missionId(mid),
        'CREATED',
        'COMPLETED',
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TRANSITION');
      }

      // State must NOT have changed
      assert.equal(getMissionState(mid), 'CREATED');
    });

    // ── Test 3: Phantom entity cannot be transitioned ──

    it('3. phantom entity transition returns LIFECYCLE_INVALID_TRANSITION', () => {
      const phantomId = 'mission-phantom-nonexistent-001';

      const result = service.transitionMission(
        conn,
        missionId(phantomId),
        'CREATED',
        'PLANNING',
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
      }

      // No record should have been created
      const row = conn.get<Record<string, unknown>>(
        'SELECT * FROM core_missions WHERE id = ?',
        [phantomId],
      );
      assert.equal(row, undefined);
    });

    // ── Test 4: Audit trail honesty ──

    it('4. audit trail records agree with actual state after transition', () => {
      const mid = 'mission-audit-001';
      seedMissionAtState(mid, 'CREATED');

      const result = service.transitionMission(
        conn,
        missionId(mid),
        'CREATED',
        'PLANNING',
      );
      assert.ok(result.ok);

      // Read the entity state
      const actualState = getMissionState(mid);
      assert.equal(actualState, 'PLANNING');

      // Read the audit trail
      const audits = getAuditEntries(mid);
      assert.ok(audits.length > 0);
      const latestAudit = audits[0]!;
      const detail = JSON.parse(latestAudit['detail'] as string);
      assert.equal(detail.to, actualState, 'Audit detail.to must match actual DB state');
    });

    // ── Test 5: TOCTOU handling ──

    it('5. TOCTOU: two concurrent transitions from same state — exactly one succeeds', () => {
      const mid = 'mission-toctou-001';
      seedMissionAtState(mid, 'CREATED');

      // First transition: CREATED → PLANNING
      const result1 = service.transitionMission(
        conn,
        missionId(mid),
        'CREATED',
        'PLANNING',
      );

      // Second transition also claims "from CREATED" but state is now PLANNING
      const result2 = service.transitionMission(
        conn,
        missionId(mid),
        'CREATED',
        'CANCELLED',
      );

      // Exactly one should succeed, one should fail
      const successes = [result1, result2].filter(r => r.ok);
      const failures = [result1, result2].filter(r => !r.ok);

      assert.equal(successes.length, 1, 'Exactly one transition must succeed');
      assert.equal(failures.length, 1, 'Exactly one transition must fail');

      // The failed one should have an appropriate error code
      const failed = failures[0]!;
      if (!failed.ok) {
        assert.ok(
          failed.error.code === 'INVALID_TRANSITION' || failed.error.code === 'LIFECYCLE_INVALID_TRANSITION',
          `Error code should be INVALID_TRANSITION or LIFECYCLE_INVALID_TRANSITION, got: ${failed.error.code}`,
        );
      }
    });

    // ── Test 11: Terminal state rejection ──

    it('11. COMPLETED mission cannot transition to anything', () => {
      const mid = 'mission-terminal-001';
      seedMissionAtState(mid, 'COMPLETED');

      const result = service.transitionMission(
        conn,
        missionId(mid),
        'COMPLETED',
        'EXECUTING',
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(
          result.error.code === 'INVALID_TRANSITION' || result.error.code === 'LIFECYCLE_INVALID_TRANSITION',
          `Expected INVALID_TRANSITION or LIFECYCLE_INVALID_TRANSITION, got: ${result.error.code}`,
        );
      }

      // State unchanged
      assert.equal(getMissionState(mid), 'COMPLETED');
    });

    // ── Test 9: Recovery override ──

    it('9. recovery override allows non-standard transition REVIEWING → PAUSED', () => {
      const mid = 'mission-recovery-001';
      seedMissionAtState(mid, 'REVIEWING');

      // REVIEWING → PAUSED is NOT in MISSION_TRANSITIONS (REVIEWING allows: COMPLETED, EXECUTING, FAILED)
      const result = service.transitionMissionRecovery(
        conn,
        missionId(mid),
        'REVIEWING',
        'PAUSED',
      );

      assert.ok(result.ok, `Expected recovery to succeed, got: ${!result.ok ? result.error.message : ''}`);

      // State should have changed
      assert.equal(getMissionState(mid), 'PAUSED');

      // Audit trail should still record it
      const audits = getAuditEntries(mid);
      assert.ok(audits.length > 0, 'Recovery must still produce audit entry');
    });
  });

  // ── Task Transitions ──

  describe('task transitions', () => {
    // ── Test 6: Legal task transition ──

    it('6. legal task transition PENDING → SCHEDULED succeeds', () => {
      const mid = 'mission-task-legal-001';
      const graphId = 'graph-task-legal-001';
      const tid = 'task-legal-001';

      seedMissionAtState(mid, 'EXECUTING');
      seedTaskGraph(graphId, mid);
      seedTask(tid, mid, graphId, 'PENDING');

      const result = service.transitionTask(
        conn,
        taskId(tid),
        'PENDING',
        'SCHEDULED',
      );

      assert.ok(result.ok, `Expected success, got: ${!result.ok ? result.error.message : ''}`);
      assert.equal(result.value.fromState, 'PENDING');
      assert.equal(result.value.toState, 'SCHEDULED');
      assert.equal(getTaskState(tid), 'SCHEDULED');
    });

    // ── Test 7: Illegal task transition ──

    it('7. illegal task transition PENDING → COMPLETED rejected', () => {
      const mid = 'mission-task-illegal-001';
      const graphId = 'graph-task-illegal-001';
      const tid = 'task-illegal-001';

      seedMissionAtState(mid, 'EXECUTING');
      seedTaskGraph(graphId, mid);
      seedTask(tid, mid, graphId, 'PENDING');

      const result = service.transitionTask(
        conn,
        taskId(tid),
        'PENDING',
        'COMPLETED',
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TRANSITION');
      }

      // State unchanged
      assert.equal(getTaskState(tid), 'PENDING');
    });

    // ── Test 8: Bulk task transition ──

    it('8. bulk transition cancels multiple tasks — all or none', () => {
      const mid = 'mission-bulk-001';
      const graphId = 'graph-bulk-001';

      seedMissionAtState(mid, 'EXECUTING');
      seedTaskGraph(graphId, mid);
      seedTask('task-bulk-001', mid, graphId, 'PENDING');
      seedTask('task-bulk-002', mid, graphId, 'SCHEDULED');
      seedTask('task-bulk-003', mid, graphId, 'RUNNING');

      const result = service.bulkTransitionTasks(
        conn,
        [
          { taskId: taskId('task-bulk-001'), from: 'PENDING', to: 'CANCELLED' },
          { taskId: taskId('task-bulk-002'), from: 'SCHEDULED', to: 'CANCELLED' },
          { taskId: taskId('task-bulk-003'), from: 'RUNNING', to: 'CANCELLED' },
        ],
      );

      assert.ok(result.ok, `Expected bulk success, got: ${!result.ok ? result.error.message : ''}`);
      if (result.ok) {
        assert.equal(result.value.length, 3);
      }

      // All tasks should be CANCELLED
      assert.equal(getTaskState('task-bulk-001'), 'CANCELLED');
      assert.equal(getTaskState('task-bulk-002'), 'CANCELLED');
      assert.equal(getTaskState('task-bulk-003'), 'CANCELLED');
    });

    it('8b. bulk transition rolls back all on single failure', () => {
      const mid = 'mission-bulk-fail-001';
      const graphId = 'graph-bulk-fail-001';

      seedMissionAtState(mid, 'EXECUTING');
      seedTaskGraph(graphId, mid);
      seedTask('task-bulkf-001', mid, graphId, 'PENDING');
      seedTask('task-bulkf-002', mid, graphId, 'COMPLETED'); // terminal, cannot transition

      const result = service.bulkTransitionTasks(
        conn,
        [
          { taskId: taskId('task-bulkf-001'), from: 'PENDING', to: 'CANCELLED' },
          { taskId: taskId('task-bulkf-002'), from: 'COMPLETED', to: 'CANCELLED' }, // will fail
        ],
      );

      assert.equal(result.ok, false, 'Bulk must fail if any individual transition fails');

      // First task should NOT have been transitioned (rolled back)
      assert.equal(getTaskState('task-bulkf-001'), 'PENDING', 'Must roll back on failure');
      assert.equal(getTaskState('task-bulkf-002'), 'COMPLETED', 'Terminal state unchanged');
    });
  });

  // ── REVIEWING Trigger ──

  describe('REVIEWING trigger', () => {
    it('10. all tasks terminal → mission auto-transitions to REVIEWING', () => {
      const mid = 'mission-reviewing-trigger-001';
      const graphId = 'graph-reviewing-001';

      seedMissionAtState(mid, 'EXECUTING');
      seedTaskGraph(graphId, mid);
      seedTask('task-rev-001', mid, graphId, 'RUNNING');
      seedTask('task-rev-002', mid, graphId, 'COMPLETED');
      seedTask('task-rev-003', mid, graphId, 'CANCELLED');

      // Transition the last non-terminal task to COMPLETED
      const result = service.transitionTask(
        conn,
        taskId('task-rev-001'),
        'RUNNING',
        'COMPLETED',
      );

      assert.ok(result.ok, `Expected success, got: ${!result.ok ? result.error.message : ''}`);

      // After this transition, ALL tasks are terminal.
      // The service should auto-trigger EXECUTING → REVIEWING on the mission.
      assert.equal(getMissionState(mid), 'REVIEWING',
        'Mission should auto-transition to REVIEWING when all tasks are terminal');
    });

    it('10b. not all tasks terminal → mission stays in EXECUTING', () => {
      const mid = 'mission-no-reviewing-001';
      const graphId = 'graph-no-reviewing-001';

      seedMissionAtState(mid, 'EXECUTING');
      seedTaskGraph(graphId, mid);
      seedTask('task-norev-001', mid, graphId, 'RUNNING');
      seedTask('task-norev-002', mid, graphId, 'PENDING');

      // Transition one task to COMPLETED
      const result = service.transitionTask(
        conn,
        taskId('task-norev-001'),
        'RUNNING',
        'COMPLETED',
      );

      assert.ok(result.ok);

      // Mission should still be EXECUTING (task-norev-002 is still PENDING)
      assert.equal(getMissionState(mid), 'EXECUTING',
        'Mission must stay EXECUTING while non-terminal tasks remain');
    });

    it('10c. REVIEWING trigger only fires when mission is in EXECUTING state', () => {
      const mid = 'mission-reviewing-guard-001';
      const graphId = 'graph-reviewing-guard-001';

      // Mission is in PLANNING, not EXECUTING
      seedMissionAtState(mid, 'PLANNING');
      seedTaskGraph(graphId, mid);
      seedTask('task-revg-001', mid, graphId, 'RUNNING');

      const result = service.transitionTask(
        conn,
        taskId('task-revg-001'),
        'RUNNING',
        'COMPLETED',
      );

      assert.ok(result.ok);

      // Mission should stay in PLANNING — the trigger only fires from EXECUTING
      assert.equal(getMissionState(mid), 'PLANNING',
        'REVIEWING trigger must not fire when mission is not in EXECUTING state');
    });
  });
});
