/**
 * Verifies: §4 I-18, §6, §7, §11, I-05
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * I-18: Mission Persistence.
 * "A mission survives engine restarts, session closures, and provider outages.
 * Its complete state (plan, workspace, reflections, resource consumption) is
 * fully persisted in SQLite."
 *
 * Phase 4G: Stubs replaced with real behavioral assertions using
 * createTestDatabase and mission_store.
 *
 * Sprint 4: Activated deferred tests for engine restart recovery and
 * in-memory-only state verification.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
} from '../helpers/test_database.js';
import { createMissionStore } from '../../src/orchestration/missions/mission_store.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import { recoverMissions } from '../../src/orchestration/missions/mission_recovery.js';
import { createOrchestrationTransitionService } from '../../src/orchestration/transitions/transition_service.js';
import type { TimeProvider } from '../../src/kernel/interfaces/time.js';
import type { TransitionEnforcer } from '../../src/kernel/interfaces/lifecycle.js';
import type { MissionId, TaskId, ArtifactId } from '../../src/kernel/interfaces/index.js';

/** P0-A: Passthrough enforcer for tests — approves all transitions. */
const passthroughEnforcer: TransitionEnforcer = {
  enforceMissionTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: '2026-01-01T00:00:00.000Z' } }),
  enforceTaskTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: '2026-01-01T00:00:00.000Z' } }),
  enforceHandoffTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: '2026-01-01T00:00:00.000Z' } }),
  enforceRunTransition: () => ({ ok: true, value: { fromState: '', toState: '', timestamp: '2026-01-01T00:00:00.000Z' } }),
};

describe('I-18: Mission Persistence', () => {

  describe('State Persisted in SQLite', () => {
    it('mission state fully persisted after creation (I-18)', () => {
      /**
       * I-18: "fully persisted in SQLite"
       * All mission fields must be queryable from the database.
       */
      const conn = createTestDatabase();
      seedMission(conn, {
        id: 'persist-m1',
        agentId: 'agent-1',
        objective: 'Persistent objective',
        state: 'EXECUTING',
      });

      const row = conn.get<{
        id: string; state: string; objective: string; agent_id: string;
        success_criteria: string; scope_boundaries: string; capabilities: string;
      }>(
        'SELECT id, state, objective, agent_id, success_criteria, scope_boundaries, capabilities FROM core_missions WHERE id = ?',
        ['persist-m1'],
      );

      assert.ok(row !== undefined, 'Mission must exist in SQLite');
      assert.equal(row!.id, 'persist-m1');
      assert.equal(row!.state, 'EXECUTING');
      assert.equal(row!.objective, 'Persistent objective');
      assert.equal(row!.agent_id, 'agent-1');
      assert.ok(JSON.parse(row!.success_criteria).length > 0, 'Success criteria persisted');
      assert.ok(JSON.parse(row!.capabilities).length > 0, 'Capabilities persisted');

      conn.close();
    });

    it('state transition persists to SQLite (§6, I-18)', () => {
      /**
       * State transitions must be durable. After CREATED -> PLANNING,
       * querying the DB must show PLANNING.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const missionStore = createMissionStore();

      seedMission(conn, { id: 'persist-m1', agentId: 'agent-1', state: 'CREATED' });
      seedResource(conn, { missionId: 'persist-m1' });

      const result = missionStore.transition(deps, missionId('persist-m1'), 'CREATED', 'PLANNING');
      assert.equal(result.ok, true, 'Transition must succeed');

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['persist-m1']);
      assert.equal(row!.state, 'PLANNING',
        'CATCHES: without durable transition, state reverts on restart');

      conn.close();
    });

    it('terminal state sets completed_at (§6)', () => {
      /**
       * §6: Terminal states (COMPLETED, FAILED, CANCELLED) set completed_at.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const missionStore = createMissionStore();

      seedMission(conn, { id: 'persist-m1', agentId: 'agent-1', state: 'REVIEWING' });
      seedResource(conn, { missionId: 'persist-m1' });

      missionStore.transition(deps, missionId('persist-m1'), 'REVIEWING', 'COMPLETED');

      const row = conn.get<{ state: string; completed_at: string | null }>(
        'SELECT state, completed_at FROM core_missions WHERE id = ?', ['persist-m1'],
      );
      assert.equal(row!.state, 'COMPLETED');
      assert.ok(row!.completed_at !== null,
        'CATCHES: without completed_at, cannot determine when mission finished');

      conn.close();
    });

    it('terminal states have no outgoing transitions (§6)', () => {
      /**
       * §6: "Terminal states: COMPLETED, FAILED, CANCELLED (no transitions out)."
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const missionStore = createMissionStore();

      seedMission(conn, { id: 'persist-m1', agentId: 'agent-1', state: 'REVIEWING' });
      seedResource(conn, { missionId: 'persist-m1' });
      missionStore.transition(deps, missionId('persist-m1'), 'REVIEWING', 'COMPLETED');

      // Try to transition out of COMPLETED — must fail
      const result = missionStore.transition(deps, missionId('persist-m1'), 'COMPLETED', 'EXECUTING');
      assert.equal(result.ok, false,
        'CATCHES: without terminal state enforcement, completed missions can be reopened');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TRANSITION');
      }

      conn.close();
    });

    it('resource consumption persisted in core_resources (§11, I-18)', () => {
      /**
       * I-18: "resource consumption" is part of the persisted state.
       */
      const conn = createTestDatabase();
      seedMission(conn, { id: 'persist-m1', agentId: 'agent-1' });
      seedResource(conn, { missionId: 'persist-m1', tokenAllocated: 5000, tokenConsumed: 1200 });

      const row = conn.get<{ token_allocated: number; token_consumed: number; token_remaining: number }>(
        'SELECT token_allocated, token_consumed, token_remaining FROM core_resources WHERE mission_id = ?',
        ['persist-m1'],
      );

      assert.ok(row !== undefined, 'Resource record must persist');
      assert.equal(row!.token_allocated, 5000);
      assert.equal(row!.token_consumed, 1200);
      assert.equal(row!.token_remaining, 3800);

      conn.close();
    });

    it('artifact workspace persisted in core_artifacts (§8, I-18)', () => {
      /**
       * I-18: "workspace" is part of the persisted state.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      const artifacts = createArtifactStore();

      seedMission(conn, { id: 'persist-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'persist-m1' });

      artifacts.create(deps, ctx, {
        missionId: missionId('persist-m1') as MissionId,
        name: 'persistent-artifact',
        type: 'data',
        format: 'json',
        content: '{"persistent": true}',
        sourceTaskId: 'seed-task' as unknown as TaskId,
        parentArtifactId: null as unknown as ArtifactId | null,
        metadata: {},
      });

      const row = conn.get<{ name: string }>(
        'SELECT name FROM core_artifacts WHERE mission_id = ?', ['persist-m1'],
      );
      assert.ok(row !== undefined, 'Artifact must persist in SQLite');
      assert.equal(row!.name, 'persistent-artifact');

      conn.close();
    });

    it('mission goals persist in core_mission_goals (I-24, I-18)', () => {
      const conn = createTestDatabase();
      seedMission(conn, { id: 'persist-m1', agentId: 'agent-1', objective: 'Persisted goal' });

      const goal = conn.get<{ objective: string }>(
        'SELECT objective FROM core_mission_goals WHERE mission_id = ?', ['persist-m1'],
      );
      assert.ok(goal !== undefined, 'Mission goals must persist');
      assert.equal(goal!.objective, 'Persisted goal');

      conn.close();
    });
  });

  describe('Survival: Engine Restart', () => {
    it('mission state recoverable after engine restart (I-18)', () => {
      /**
       * I-18: Mission state recoverable after engine restart.
       * Call recoverMissions(), verify EXECUTING -> PAUSED.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();
      const time: TimeProvider = { nowISO: () => '2026-01-01T00:00:00.000Z', nowMs: () => 1735689600000 };

      seedMission(conn, { id: 'restart-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'restart-m1' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));

      assert.equal(result.ok, true, 'Recovery must succeed');
      assert.ok(result.value.recoveredCount >= 1,
        'CATCHES: EXECUTING mission must be recovered (transitioned to PAUSED)');

      // Verify the mission is now PAUSED
      const row = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?', ['restart-m1'],
      );
      assert.equal(row!.state, 'PAUSED',
        'CATCHES: EXECUTING mission must transition to PAUSED on recovery');

      conn.close();
    });

    it('EXECUTING mission transitions to PAUSED on restart (I-18)', () => {
      /**
       * Recovery rule: EXECUTING -> PAUSED (safe recoverable state).
       * NOT EXECUTING -> EXECUTING (would auto-resume, which is unsafe).
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();
      const time: TimeProvider = { nowISO: () => '2026-01-01T00:00:00.000Z', nowMs: () => 1735689600000 };

      seedMission(conn, { id: 'exec-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'exec-m1' });

      const result = recoverMissions(conn, audit, time, createOrchestrationTransitionService(passthroughEnforcer, audit, time));

      assert.equal(result.ok, true);

      const mission = result.value.missions.find(
        (m: { missionId: string }) => m.missionId === 'exec-m1',
      );
      assert.ok(mission, 'Must find exec-m1 in recovery results');
      assert.equal(mission!.action, 'paused',
        'CATCHES: EXECUTING must -> PAUSED, not remain EXECUTING');
      assert.equal(mission!.previousState, 'EXECUTING');

      conn.close();
    });

    it.skip('BLOCKED mission resumes to BLOCKED on restart — DEFERRED (requires restart simulation)', () => {});
  });

  describe('Survival: Session Closure', () => {
    it.skip('mission continues after session closes — DEFERRED (requires session lifecycle test)', () => {});
  });

  describe('Survival: Provider Outage', () => {
    it.skip('mission transitions to DEGRADED on provider outage — DEFERRED (requires LLM gateway integration)', () => {});
    it.skip('DEGRADED mission returns to EXECUTING on provider recovery — DEFERRED (requires gateway recovery)', () => {});
  });

  describe('Crash Recovery Consistency (I-05 integration)', () => {
    it.skip('crash during mission creation: either fully created or not at all — DEFERRED (tested via I-05 transaction rollback)', () => {});
    it.skip('crash during state transition: old state preserved — DEFERRED (tested via I-05 transaction rollback)', () => {});

    it('no in-memory-only mission state exists (I-18)', () => {
      /**
       * I-18: All mission state in SQLite, no in-memory-only state.
       * Verify that after creating a mission and transitioning it,
       * the state is fully recoverable from the database alone.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const missionStore = createMissionStore();

      seedMission(conn, { id: 'mem-m1', state: 'CREATED' });
      seedResource(conn, { missionId: 'mem-m1' });

      // Transition to PLANNING
      missionStore.transition(deps, missionId('mem-m1'), 'CREATED', 'PLANNING');

      // Verify state is in SQLite (not in any in-memory cache)
      const row = conn.get<{ state: string; plan_version: number }>(
        'SELECT state, plan_version FROM core_missions WHERE id = ?',
        ['mem-m1'],
      );
      assert.ok(row, 'Mission must exist in SQLite');
      assert.equal(row!.state, 'PLANNING',
        'CATCHES: if state were in-memory only, SQLite would still show CREATED');

      // Verify mission goals (part of persistent state) also in SQLite
      const goals = conn.get<{ objective: string }>(
        'SELECT objective FROM core_mission_goals WHERE mission_id = ?',
        ['mem-m1'],
      );
      assert.ok(goals, 'Mission goals must be in SQLite, not in-memory');

      conn.close();
    });
  });
});
