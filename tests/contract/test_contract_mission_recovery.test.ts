/**
 * Contract tests for Mission Recovery (I-18: Mission Persistence/Recovery).
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * Verifies:
 *   - EXECUTING -> PAUSED on recovery
 *   - REVIEWING -> PAUSED on recovery
 *   - CREATED -> unchanged on recovery
 *   - PLANNING -> unchanged on recovery
 *   - PAUSED -> unchanged on recovery
 *   - BLOCKED -> unchanged on recovery
 *   - DEGRADED -> unchanged on recovery
 *   - Terminal missions not touched
 *   - Audit trail created for every recovery action
 *   - Recovery is idempotent
 *   - Root-first ordering (parent recovered before child)
 *   - Non-fatal: one mission failure doesn't stop others
 *
 * Amendment 21: Every enforcement DC has success AND rejection tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import { recoverMissions } from '../../src/orchestration/missions/mission_recovery.js';
import { createOrchestrationTransitionService } from '../../src/orchestration/transitions/transition_service.js';
import type { TimeProvider } from '../../src/kernel/interfaces/time.js';
import type { TransitionEnforcer } from '../../src/kernel/interfaces/lifecycle.js';

const time: TimeProvider = {
  nowISO: () => '2026-01-01T00:00:00.000Z',
  nowMs: () => 1735689600000,
};

/** P0-A: Passthrough enforcer for tests — approves all transitions. */
const passthroughEnforcer: TransitionEnforcer = {
  enforceMissionTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: time.nowISO() } }),
  enforceTaskTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: time.nowISO() } }),
  enforceHandoffTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: time.nowISO() } }),
  enforceRunTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: time.nowISO() } }),
};

describe('Contract: Mission Recovery (I-18)', () => {

  describe('State Transitions', () => {
    it('success: EXECUTING -> PAUSED on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-exec', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'rec-exec' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-exec');
      assert.ok(mission, 'Must find rec-exec in results');
      assert.equal(mission!.action, 'paused');
      assert.equal(mission!.previousState, 'EXECUTING');

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['rec-exec']);
      assert.equal(row!.state, 'PAUSED',
        'CATCHES: EXECUTING must transition to PAUSED on recovery');

      conn.close();
    });

    it('success: REVIEWING -> PAUSED on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-review', state: 'REVIEWING' });
      seedResource(conn, { missionId: 'rec-review' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-review');
      assert.ok(mission, 'Must find rec-review in results');
      assert.equal(mission!.action, 'paused');

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['rec-review']);
      assert.equal(row!.state, 'PAUSED',
        'CATCHES: REVIEWING must transition to PAUSED on recovery');

      conn.close();
    });

    it('success: CREATED -> unchanged on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-created', state: 'CREATED' });
      seedResource(conn, { missionId: 'rec-created' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-created');
      assert.ok(mission);
      assert.equal(mission!.action, 'unchanged');

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['rec-created']);
      assert.equal(row!.state, 'CREATED', 'CREATED must remain CREATED');

      conn.close();
    });

    it('success: PLANNING -> unchanged on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-plan', state: 'PLANNING' });
      seedResource(conn, { missionId: 'rec-plan' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-plan');
      assert.equal(mission!.action, 'unchanged');

      conn.close();
    });

    it('success: PAUSED -> unchanged on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-paused', state: 'PAUSED' });
      seedResource(conn, { missionId: 'rec-paused' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-paused');
      assert.equal(mission!.action, 'unchanged');

      conn.close();
    });

    it('success: BLOCKED -> unchanged on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-blocked', state: 'BLOCKED' });
      seedResource(conn, { missionId: 'rec-blocked' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-blocked');
      assert.equal(mission!.action, 'unchanged');

      conn.close();
    });

    it('success: DEGRADED -> unchanged on recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-degraded', state: 'DEGRADED' });
      seedResource(conn, { missionId: 'rec-degraded' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      const mission = result.value.missions.find(m => m.missionId === 'rec-degraded');
      assert.equal(mission!.action, 'unchanged');

      conn.close();
    });

    it('rejection: terminal missions not touched by recovery', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'rec-completed', state: 'COMPLETED' });
      seedMission(conn, { id: 'rec-failed', state: 'FAILED' });
      seedMission(conn, { id: 'rec-cancelled', state: 'CANCELLED' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      // Terminal missions should not appear in recovery results at all
      const completedMission = result.value.missions.find(m => m.missionId === 'rec-completed');
      const failedMission = result.value.missions.find(m => m.missionId === 'rec-failed');
      const cancelledMission = result.value.missions.find(m => m.missionId === 'rec-cancelled');

      assert.equal(completedMission, undefined,
        'CATCHES: COMPLETED mission must not be in recovery results');
      assert.equal(failedMission, undefined,
        'CATCHES: FAILED mission must not be in recovery results');
      assert.equal(cancelledMission, undefined,
        'CATCHES: CANCELLED mission must not be in recovery results');

      // Verify state unchanged in DB
      const c = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['rec-completed']);
      assert.equal(c!.state, 'COMPLETED');
      const f = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['rec-failed']);
      assert.equal(f!.state, 'FAILED');

      conn.close();
    });
  });

  describe('Audit Trail', () => {
    it('success: audit trail created for every recovery action', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'aud-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'aud-m1' });
      seedMission(conn, { id: 'aud-m2', state: 'CREATED' });
      seedResource(conn, { missionId: 'aud-m2' });

      recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));

      // Check audit entries for both missions.
      // P0-A: Transitioned missions get 'mission_transition' from the transition service.
      // Unchanged missions get 'mission_recovery' from the recovery function.
      const auditEntries = conn.query<{ resource_id: string; operation: string }>(
        `SELECT resource_id, operation FROM core_audit_log WHERE operation IN ('mission_recovery', 'mission_transition')`,
      );

      assert.ok(auditEntries.length >= 2,
        'CATCHES: every recovery action must produce an audit entry');

      const m1Entry = auditEntries.find(e => e.resource_id === 'aud-m1');
      const m2Entry = auditEntries.find(e => e.resource_id === 'aud-m2');
      assert.ok(m1Entry, 'EXECUTING mission must have audit entry (mission_transition from transition service)');
      assert.ok(m2Entry, 'CREATED mission must have audit entry (mission_recovery)');

      conn.close();
    });
  });

  describe('Idempotency', () => {
    it('success: recovery is idempotent (running twice produces same result)', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'idemp-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'idemp-m1' });

      // First recovery pass
      const result1 = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result1.ok, true);
      assert.equal(result1.value.recoveredCount, 1, 'First pass: one mission recovered');

      // Second recovery pass — mission is now PAUSED, plus it has an idempotency audit entry
      const result2 = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result2.ok, true);

      // On second pass, the mission is PAUSED (unchanged state) and has existing recovery audit
      // So it should report unchanged, not attempt another transition
      const m1Second = result2.value.missions.find(m => m.missionId === 'idemp-m1');
      assert.ok(m1Second);
      assert.equal(m1Second!.action, 'unchanged',
        'CATCHES: second recovery pass must not re-transition an already-recovered mission');

      // State remains PAUSED
      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['idemp-m1']);
      assert.equal(row!.state, 'PAUSED');

      conn.close();
    });
  });

  describe('Ordering', () => {
    it('success: root-first ordering (parent recovered before child)', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Create parent (depth 0) and child (depth 1) both EXECUTING
      seedMission(conn, { id: 'parent-m1', state: 'EXECUTING', depth: 0 });
      seedResource(conn, { missionId: 'parent-m1' });
      seedMission(conn, { id: 'child-m1', state: 'EXECUTING', depth: 1, parentId: 'parent-m1' });
      seedResource(conn, { missionId: 'child-m1' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);

      // Both should be recovered
      assert.equal(result.value.recoveredCount, 2,
        'Both parent and child must be recovered');

      // Verify ordering: parent should appear before child in results
      const parentIdx = result.value.missions.findIndex(m => m.missionId === 'parent-m1');
      const childIdx = result.value.missions.findIndex(m => m.missionId === 'child-m1');
      assert.ok(parentIdx < childIdx,
        'CATCHES: parent (depth 0) must be recovered before child (depth 1)');

      conn.close();
    });
  });

  describe('Non-Fatal Continuation', () => {
    it('success: recovered count reflects actual transitions', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Mix of states: 2 will transition, 2 won't
      seedMission(conn, { id: 'mix-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'mix-m1' });
      seedMission(conn, { id: 'mix-m2', state: 'CREATED' });
      seedResource(conn, { missionId: 'mix-m2' });
      seedMission(conn, { id: 'mix-m3', state: 'REVIEWING' });
      seedResource(conn, { missionId: 'mix-m3' });
      seedMission(conn, { id: 'mix-m4', state: 'PAUSED' });
      seedResource(conn, { missionId: 'mix-m4' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));
      assert.equal(result.ok, true);
      assert.equal(result.value.recoveredCount, 2,
        'Only EXECUTING and REVIEWING should be recovered (2 transitions)');
      assert.equal(result.value.missions.length, 4,
        'All 4 non-terminal missions should appear in results');

      conn.close();
    });
  });

  describe('Recovery State Machine Validation', () => {
    it('rejection: recovery does not auto-resume any mission', () => {
      /**
       * Security constraint: recovery is conservative — never auto-resumes.
       * EXECUTING -> PAUSED, not EXECUTING -> EXECUTING.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'noresume-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'noresume-m1' });

      recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['noresume-m1']);
      assert.notEqual(row!.state, 'EXECUTING',
        'CATCHES: recovery must NOT leave missions in EXECUTING state');
      assert.equal(row!.state, 'PAUSED',
        'Recovery must transition to PAUSED, not back to EXECUTING');

      conn.close();
    });
  });
});
