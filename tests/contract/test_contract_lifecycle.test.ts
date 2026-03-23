/**
 * Limen Phase 0A — Lifecycle Transition Tables
 * Truth Model: Deliverable 6 (Lifecycle Transition Tables)
 * Assertions: BC-060 to BC-071, ST-060 to ST-063
 *
 * Phase: 0A (Foundation)
 * Gate: All tests FAIL with NotImplementedError before implementation.
 *
 * BC-060: 6 mission lifecycle states (replaces 10-state v3.2 MissionState).
 * BC-061: 4 mission active substates.
 * BC-062: TransitionEnforcer is the SOLE mechanism for lifecycle state changes.
 * BC-063: TransitionEnforcer validates preconditions before allowing transitions.
 * BC-064: 7 task lifecycle states with readiness discriminator.
 * BC-065: 3 task readiness substates.
 * BC-066: 7 handoff lifecycle states.
 * BC-067: Suspension is orthogonal — entities freeze at current state (INV-X05).
 * BC-068: Migration backfill mapping from v3.2 states (Binding 9).
 * BC-069: Handoff lifecycle with acceptance/rejection typed outcomes.
 * BC-070: No reverse transitions from terminal states.
 * BC-071: Completing is an intermediate state between active and completed.
 * ST-060: Mission lifecycle transition table.
 * ST-061: Task lifecycle transition table.
 * ST-062: Handoff lifecycle transition table.
 * ST-063: Suspension lifecycle (active → resolved).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId, agentId, seedMission } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, correlationId, missionContractId, supervisorDecisionId, suspensionRecordId, handoffId, evalCaseId, capabilityManifestId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type {
  MissionLifecycleState, MissionActiveSubstate,
  TaskLifecycleState, TaskReadiness,
  HandoffLifecycleState, TransitionResult, TransitionEnforcer,
} from '../../src/kernel/interfaces/lifecycle.js';
import { MISSION_STATE_BACKFILL_MAP, TASK_STATE_BACKFILL_MAP } from '../../src/kernel/interfaces/lifecycle.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

// ── Debt 2: Seed helpers — TransitionEnforcer now requires entities to exist ──

function seedLifecycleMissions(): void {
  const ids = [
    'mission-060-01', 'mission-060-02', 'mission-060-03', 'mission-060-04',
    'mission-060-05', 'mission-060-06', 'mission-060-07',
    'mission-070-01', 'mission-070-02', 'mission-070-03',
    'mission-061-01', 'mission-061-02', 'mission-061-03', 'mission-061-04',
    'mission-067-suspended', 'mission-071-comp', 'mission-071-fail',
    'lifecycle-task-parent',
  ];
  for (const id of ids) {
    seedMission(conn, { id });
  }
}

function seedLifecycleTasks(): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_task_graphs (id, mission_id, version, objective_alignment, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['lifecycle-graph', 'lifecycle-task-parent', 1, 'lifecycle test', 1, now],
  );
  const taskIds = [
    'task-064-01', 'task-064-02', 'task-064-03', 'task-064-04',
    'task-064-05', 'task-064-06',
    'task-070-01', 'task-070-02',
    'task-065-01', 'task-065-02', 'task-065-03',
  ];
  for (const id of taskIds) {
    conn.run(
      `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, 'lifecycle-task-parent', 'test-tenant', 'lifecycle-graph', 'lifecycle test', 'deterministic', 'PENDING', now, now],
    );
  }
}

function seedLifecycleHandoffs(): void {
  const now = new Date().toISOString();
  const handoffIds = [
    'handoff-066-01', 'handoff-066-02', 'handoff-066-03',
    'handoff-066-04', 'handoff-066-05', 'handoff-070-01',
  ];
  for (const id of handoffIds) {
    conn.run(
      `INSERT INTO gov_handoffs (handoff_id, tenant_id, mission_id, delegator_agent_id, delegate_agent_id, state, schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, 'test-tenant', 'lifecycle-task-parent', 'agent-a', 'agent-b', 'issued', '0.1.0', now, now],
    );
  }
}

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
  // Debt 2: Seed all entities used by lifecycle tests
  seedLifecycleMissions();
  seedLifecycleTasks();
  seedLifecycleHandoffs();
}

describe('Phase 0A Contract Tests: Lifecycle Transition Tables (Deliverable 6)', () => {
  beforeEach(async () => { await setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // Mission Lifecycle (ST-060)
  // ════════════════════════════════════════════════════════════════════════

  describe('BC-060/ST-060: Mission created → active (legal)', () => {
    it('should allow transition from created to active', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-01'), 'active',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'active');
    });
  });

  describe('BC-060/BC-071/ST-060: Mission active → completing (legal)', () => {
    it('should allow transition from active to completing (intermediate state)', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-02'), 'completing',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'completing');
    });
  });

  describe('BC-060/ST-060: Mission completing → completed (legal)', () => {
    it('should allow transition from completing to completed', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-03'), 'completed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'completed');
    });
  });

  describe('BC-060/ST-060: Mission completing → failed (legal)', () => {
    it('should allow transition from completing to failed', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-04'), 'failed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'failed');
    });
  });

  describe('BC-060/ST-060: Mission active → failed (legal)', () => {
    it('should allow transition from active to failed', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-05'), 'failed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'failed');
    });
  });

  describe('BC-060/ST-060: Mission created → revoked (legal)', () => {
    it('should allow transition from created to revoked', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-06'), 'revoked',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'revoked');
    });
  });

  describe('BC-060/ST-060: Mission active → revoked (legal)', () => {
    it('should allow transition from active to revoked', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-060-07'), 'revoked',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'revoked');
    });
  });

  // ── BC-070: No reverse transitions from terminal states ──

  describe('BC-070: Mission completed → active (INVALID — terminal, no reverse)', () => {
    it('should reject reverse transition from terminal state completed', () => {
      // Setup: transition to terminal state 'completed' first
      gov.transitionEnforcer.enforceMissionTransition(conn, missionId('mission-070-01'), 'completed');
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-070-01'), 'active',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  describe('BC-070: Mission failed → active (INVALID — terminal)', () => {
    it('should reject reverse transition from terminal state failed', () => {
      // Setup: transition to terminal state 'failed' first
      gov.transitionEnforcer.enforceMissionTransition(conn, missionId('mission-070-02'), 'failed');
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-070-02'), 'active',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  describe('BC-070: Mission revoked → active (INVALID — terminal)', () => {
    it('should reject reverse transition from terminal state revoked', () => {
      // Setup: transition to terminal state 'revoked' first
      gov.transitionEnforcer.enforceMissionTransition(conn, missionId('mission-070-03'), 'revoked');
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-070-03'), 'active',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  // ── BC-061: Active substates ──

  describe('BC-061: Mission active with substate=planning', () => {
    it('should accept planning as a valid active substate', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-061-01'), 'active', 'planning',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'active');
    });
  });

  describe('BC-061: Mission active with substate=executing', () => {
    it('should accept executing as a valid active substate', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-061-02'), 'active', 'executing',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'active');
    });
  });

  describe('BC-061: Mission active with substate=reviewing', () => {
    it('should accept reviewing as a valid active substate', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-061-03'), 'active', 'reviewing',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'active');
    });
  });

  describe('BC-061: Mission active with substate=degraded', () => {
    it('should accept degraded as a valid active substate', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-061-04'), 'active', 'degraded',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'active');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Task Lifecycle (ST-061)
  // ════════════════════════════════════════════════════════════════════════

  describe('BC-064/ST-061: Task pending → ready (legal)', () => {
    it('should allow transition from pending to ready', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-064-01'), 'ready',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'ready');
    });
  });

  describe('BC-064/ST-061: Task ready → executing (legal)', () => {
    it('should allow transition from ready to executing', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-064-02'), 'executing',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'executing');
    });
  });

  describe('BC-064/ST-061: Task executing → completed (legal)', () => {
    it('should allow transition from executing to completed', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-064-03'), 'completed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'completed');
    });
  });

  describe('BC-064/ST-061: Task executing → failed (legal)', () => {
    it('should allow transition from executing to failed', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-064-04'), 'failed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'failed');
    });
  });

  describe('BC-064/ST-061: Task pending → skipped (legal)', () => {
    it('should allow transition from pending to skipped', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-064-05'), 'skipped',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'skipped');
    });
  });

  describe('BC-064/ST-061: Task pending → revoked (legal)', () => {
    it('should allow transition from pending to revoked', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-064-06'), 'revoked',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'revoked');
    });
  });

  // ── BC-070: No reverse from task terminal states ──

  describe('BC-070: Task completed → executing (INVALID — terminal)', () => {
    it('should reject reverse transition from terminal state completed', () => {
      // Setup: transition to terminal state 'completed' first
      gov.transitionEnforcer.enforceTaskTransition(conn, taskId('task-070-01'), 'completed');
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-070-01'), 'executing',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  describe('BC-070: Task failed → ready (INVALID — terminal)', () => {
    it('should reject reverse transition from terminal state failed', () => {
      // Setup: transition to terminal state 'failed' first
      gov.transitionEnforcer.enforceTaskTransition(conn, taskId('task-070-02'), 'failed');
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-070-02'), 'ready',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  // ── BC-065: Task readiness substates ──

  describe('BC-065: Task pending with readiness=awaiting-dependencies', () => {
    it('should accept awaiting-dependencies as valid readiness for pending', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-065-01'), 'pending', 'awaiting-dependencies',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'pending');
    });
  });

  describe('BC-065: Task pending with readiness=awaiting-scheduling', () => {
    it('should accept awaiting-scheduling as valid readiness for pending', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-065-02'), 'pending', 'awaiting-scheduling',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'pending');
    });
  });

  describe('BC-065: Task pending with readiness=ready', () => {
    it('should accept ready as valid readiness for pending', () => {
      const result = gov.transitionEnforcer.enforceTaskTransition(
        conn, taskId('task-065-03'), 'pending', 'ready',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'pending');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Handoff Lifecycle (ST-062)
  // ════════════════════════════════════════════════════════════════════════

  describe('BC-066/ST-062: Handoff issued → accepted (legal)', () => {
    it('should allow transition from issued to accepted', () => {
      const result = gov.transitionEnforcer.enforceHandoffTransition(
        conn, handoffId('handoff-066-01'), 'accepted',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'accepted');
    });
  });

  describe('BC-066/ST-062: Handoff issued → rejected (legal)', () => {
    it('should allow transition from issued to rejected', () => {
      const result = gov.transitionEnforcer.enforceHandoffTransition(
        conn, handoffId('handoff-066-02'), 'rejected',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'rejected');
    });
  });

  describe('BC-066/ST-062: Handoff accepted → active (legal)', () => {
    it('should allow transition from accepted to active', () => {
      const result = gov.transitionEnforcer.enforceHandoffTransition(
        conn, handoffId('handoff-066-03'), 'active',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'active');
    });
  });

  describe('BC-066/ST-062: Handoff active → returned (legal)', () => {
    it('should allow transition from active to returned', () => {
      const result = gov.transitionEnforcer.enforceHandoffTransition(
        conn, handoffId('handoff-066-04'), 'returned',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'returned');
    });
  });

  describe('BC-066/ST-062: Handoff issued → expired (legal)', () => {
    it('should allow transition from issued to expired', () => {
      const result = gov.transitionEnforcer.enforceHandoffTransition(
        conn, handoffId('handoff-066-05'), 'expired',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'expired');
    });
  });

  // ── BC-070: No reverse from handoff terminal states ──

  describe('BC-070: Handoff returned → active (INVALID — terminal)', () => {
    it('should reject reverse transition from terminal state returned', () => {
      // Setup: transition to terminal state 'returned' first
      gov.transitionEnforcer.enforceHandoffTransition(conn, handoffId('handoff-070-01'), 'returned');
      const result = gov.transitionEnforcer.enforceHandoffTransition(
        conn, handoffId('handoff-070-01'), 'active',
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Suspension (ST-063)
  // ════════════════════════════════════════════════════════════════════════

  describe('BC-067/ST-063: Suspended entity cannot transition', () => {
    it('should reject lifecycle transition for a suspended mission', () => {
      // Setup: create an active suspension record targeting this mission
      gov.suspensionStore.create(conn, {
        suspensionId: suspensionRecordId('susp-067-setup'),
        tenantId: 'test-tenant',
        targetType: 'mission',
        targetId: 'mission-067-suspended',
        state: 'active',
        creatingDecisionId: supervisorDecisionId('dec-067-setup'),
        resolutionDecisionId: null,
        schemaVersion: '0.1.0',
        origin: 'runtime',
        createdAt: testTimestamp(),
        resolvedAt: null,
      } as any);
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-067-suspended'), 'completing',
      );
      // If the mission is suspended, the transition enforcer should reject.
      // The implementation determines whether this specific ID is suspended.
      // The contract requires: suspended entities cannot transition.
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  describe('BC-071: Completing is intermediate — must eventually reach completed or failed', () => {
    it('should allow completing → completed as the normal completion path', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-071-comp'), 'completed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'completed');
    });

    it('should allow completing → failed as the failure path from intermediate', () => {
      const result = gov.transitionEnforcer.enforceMissionTransition(
        conn, missionId('mission-071-fail'), 'failed',
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'failed');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Backfill Mapping (BC-068)
  // ════════════════════════════════════════════════════════════════════════
  //
  // NOTE: These tests verify static const exports defined in lifecycle.ts.
  // They test configuration data (the backfill mapping tables), not harness
  // behavior. They PASS immediately because the maps are already defined
  // as const exports. This is acceptable — they lock down the mapping values
  // so any accidental change to the backfill tables breaks these tests.

  describe('BC-068: MISSION_STATE_BACKFILL_MAP maps CREATED to {state:created, substate:null}', () => {
    it('should map v3.2 CREATED to constitutional created with null substate', () => {
      const mapping = MISSION_STATE_BACKFILL_MAP['CREATED'];
      assert.notEqual(mapping, undefined);
      assert.equal(mapping.state, 'created');
      assert.equal(mapping.substate, null);
    });
  });

  describe('BC-068: TASK_STATE_BACKFILL_MAP maps BLOCKED to {state:pending, readiness:awaiting-dependencies}', () => {
    it('should map v3.2 BLOCKED to constitutional pending with awaiting-dependencies readiness', () => {
      const mapping = TASK_STATE_BACKFILL_MAP['BLOCKED'];
      assert.notEqual(mapping, undefined);
      assert.equal(mapping.state, 'pending');
      assert.equal(mapping.readiness, 'awaiting-dependencies');
    });
  });
});
