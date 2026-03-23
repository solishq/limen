/**
 * Verifies: §4 I-24, §6, §16, FM-14, FM-16
 * Phase: 4G (Test Hardening Sweep — CF-003)
 *
 * I-24: Goal Anchoring.
 * "Every mission stores a canonical objective, success criteria, and scope
 * boundaries as immutable goal artifacts created at mission inception."
 *
 * Phase 4G: Stubs replaced with real behavioral assertions using database
 * triggers (migration 014) and createTestDatabase.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
} from '../helpers/test_database.js';
import { createTaskGraphEngine } from '../../src/orchestration/tasks/task_graph.js';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import type { MissionId } from '../../src/kernel/interfaces/index.js';

describe('I-24: Goal Anchoring', () => {

  describe('Immutable Goal Artifacts', () => {
    it('objective UPDATE blocked by trigger (I-24)', () => {
      /**
       * Migration 014: BEFORE UPDATE trigger on core_mission_goals.objective
       * raises ABORT with I-24 message.
       */
      const conn = createTestDatabase();
      seedMission(conn, { id: 'ga-m1', agentId: 'agent-1' });

      let threw = false;
      let errorMsg = '';
      try {
        conn.run(
          `UPDATE core_mission_goals SET objective = 'Changed objective' WHERE mission_id = ?`,
          ['ga-m1'],
        );
      } catch (err) {
        threw = true;
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      assert.equal(threw, true,
        'CATCHES: without trigger, agent can silently redefine what success means');
      assert.ok(errorMsg.includes('I-24'),
        'CATCHES: trigger error must reference I-24 spec');

      conn.close();
    });

    it('successCriteria UPDATE blocked by trigger (I-24)', () => {
      const conn = createTestDatabase();
      seedMission(conn, { id: 'ga-m1', agentId: 'agent-1' });

      let threw = false;
      try {
        conn.run(
          `UPDATE core_mission_goals SET success_criteria = '["changed"]' WHERE mission_id = ?`,
          ['ga-m1'],
        );
      } catch {
        threw = true;
      }

      assert.equal(threw, true,
        'CATCHES: without trigger, success criteria can be silently loosened');

      conn.close();
    });

    it('scopeBoundaries UPDATE blocked by trigger (I-24)', () => {
      const conn = createTestDatabase();
      seedMission(conn, { id: 'ga-m1', agentId: 'agent-1' });

      let threw = false;
      try {
        conn.run(
          `UPDATE core_mission_goals SET scope_boundaries = '["expanded"]' WHERE mission_id = ?`,
          ['ga-m1'],
        );
      } catch {
        threw = true;
      }

      assert.equal(threw, true,
        'CATCHES: without trigger, scope boundaries can be silently expanded');

      conn.close();
    });

    it('goal anchor row created at mission inception (§15)', () => {
      /**
       * §15 Side Effects: "Goal anchor artifacts created (I-24)"
       * seedMission inserts into core_mission_goals atomically.
       */
      const conn = createTestDatabase();
      seedMission(conn, { id: 'ga-m1', agentId: 'agent-1', objective: 'Test the goal anchor' });

      const goal = conn.get<{ objective: string; success_criteria: string; scope_boundaries: string }>(
        'SELECT objective, success_criteria, scope_boundaries FROM core_mission_goals WHERE mission_id = ?',
        ['ga-m1'],
      );

      assert.ok(goal !== undefined,
        'CATCHES: without goal anchor creation, drift detection has no reference point');
      assert.equal(goal!.objective, 'Test the goal anchor');
      assert.ok(goal!.success_criteria.length > 0, 'Success criteria must be stored');
      assert.ok(goal!.scope_boundaries.length > 0, 'Scope boundaries must be stored');

      conn.close();
    });

    it.skip('no system call can modify goal anchor fields — DEFERRED (enforced by triggers, verified above)', () => {});
  });

  describe('objective_alignment on propose_task_graph', () => {
    it('objective_alignment is NOT NULL in task graph schema (§16)', () => {
      /**
       * §16: objective_alignment is mandatory per schema.
       * Migration 003: objective_alignment TEXT NOT NULL
       */
      const conn = createTestDatabase();
      seedMission(conn, { id: 'ga-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
      seedResource(conn, { missionId: 'ga-m1' });

      // Try to INSERT a task graph without objective_alignment — must fail
      let threw = false;
      try {
        conn.run(
          `INSERT INTO core_task_graphs (id, mission_id, tenant_id, version, is_active, created_at)
           VALUES ('tg-1', 'ga-m1', 'test-tenant', 1, 1, datetime('now'))`,
        );
      } catch {
        threw = true;
      }

      assert.equal(threw, true,
        'CATCHES: without NOT NULL constraint, task graphs can omit alignment justification');

      conn.close();
    });

    it('proposeGraph stores objective_alignment in task graph record (§16)', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      const taskGraph = createTaskGraphEngine();

      seedMission(conn, { id: 'ga-m1', agentId: 'agent-1', state: 'EXECUTING', capabilities: ['web_search'] });
      seedResource(conn, { missionId: 'ga-m1' });

      const result = taskGraph.proposeGraph(deps, ctx, {
        missionId: missionId('ga-m1'),
        tasks: [{
          id: 'task-1' as unknown as import('../../src/kernel/interfaces/index.js').TaskId,
          description: 'Test task',
          executionMode: 'deterministic' as const,
          estimatedTokens: 100,
          capabilitiesRequired: ['web_search'],
        }],
        dependencies: [],
        objectiveAlignment: 'This task directly supports the test objective',
      });

      assert.equal(result.ok, true, 'ProposeGraph must succeed');
      if (!result.ok) return;

      // Verify objective_alignment stored in DB
      const graph = conn.get<{ objective_alignment: string }>(
        'SELECT objective_alignment FROM core_task_graphs WHERE mission_id = ?',
        ['ga-m1'],
      );
      assert.ok(graph !== undefined);
      assert.equal(graph!.objective_alignment, 'This task directly supports the test objective',
        'CATCHES: without storing alignment, audit trail for drift detection is lost');

      conn.close();
    });

    it.skip('empty objective_alignment is rejected — DEFERRED (no validation in proposeGraph)', () => {});
    it.skip('orchestrator does not evaluate quality of alignment — DEFERRED (Layer 3 concern, no code)', () => {});
    it.skip('objective_alignment preserved in plan history — DEFERRED (plan versioning not fully implemented)', () => {});
  });

  describe('Checkpoint Drift Assessment', () => {
    it('checkpoints include semantic drift assessment (I-24)', () => {
      /**
       * I-24: Every checkpoint response triggers a drift assessment that
       * compares the checkpoint's assessment text against the goal anchor.
       * The drift assessment is stored in core_drift_assessments.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const coordinator = createCheckpointCoordinator();

      seedMission(conn, {
        id: 'drift-m1', agentId: 'agent-1', state: 'EXECUTING',
        objective: 'Analyze customer feedback data and produce sentiment report',
      });
      seedResource(conn, { missionId: 'drift-m1' });

      // Fire a checkpoint
      const fireResult = coordinator.fire(deps, missionId('drift-m1') as MissionId, 'PERIODIC');
      assert.equal(fireResult.ok, true);
      if (!fireResult.ok) return;

      // Respond with an assessment that closely matches the objective
      const respondResult = coordinator.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Analyzing customer feedback data and generating sentiment analysis report',
        confidence: 0.9,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });
      assert.equal(respondResult.ok, true);

      // Verify drift assessment was stored
      const driftRow = conn.get<{ drift_score: number; similarity_score: number; action_taken: string }>(
        'SELECT drift_score, similarity_score, action_taken FROM core_drift_assessments WHERE checkpoint_id = ?',
        [fireResult.value],
      );
      assert.ok(driftRow !== undefined,
        'CATCHES: without drift assessment at checkpoints, goal drift goes undetected');
      assert.equal(typeof driftRow!.drift_score, 'number');
      assert.equal(typeof driftRow!.similarity_score, 'number');

      conn.close();
    });

    it('orchestrator compares checkpoint assessment against goal anchor (I-24)', () => {
      /**
       * I-24: Drift engine reads from core_mission_goals (trigger-protected table).
       * The original_objective in the drift assessment must match the goal anchor.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const coordinator = createCheckpointCoordinator();

      const objective = 'Build a recommendation engine for product suggestions';
      seedMission(conn, { id: 'cmp-m1', agentId: 'agent-1', state: 'EXECUTING', objective });
      seedResource(conn, { missionId: 'cmp-m1' });

      const fireResult = coordinator.fire(deps, missionId('cmp-m1') as MissionId, 'PERIODIC');
      assert.equal(fireResult.ok, true);
      if (!fireResult.ok) return;

      coordinator.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Working on building product recommendation engine',
        confidence: 0.85,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });

      const driftRow = conn.get<{ original_objective: string; current_assessment: string }>(
        'SELECT original_objective, current_assessment FROM core_drift_assessments WHERE checkpoint_id = ?',
        [fireResult.value],
      );
      assert.ok(driftRow !== undefined);
      assert.equal(driftRow!.original_objective, objective,
        'CATCHES: if drift engine reads from wrong table, objective comparison is against stale/wrong data');
      assert.equal(driftRow!.current_assessment, 'Working on building product recommendation engine');

      conn.close();
    });

    it('drift detection triggers human escalation (I-24)', () => {
      /**
       * I-24: When drift score exceeds escalation threshold (>0.7),
       * the checkpoint system_action is overridden to 'escalated'.
       * This ensures the mission is blocked for human review when
       * the agent has drifted far from the original objective.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const coordinator = createCheckpointCoordinator();

      seedMission(conn, {
        id: 'esc-m1', agentId: 'agent-1', state: 'EXECUTING',
        objective: 'Analyze customer feedback data and produce sentiment report',
      });
      seedResource(conn, { missionId: 'esc-m1' });

      const fireResult = coordinator.fire(deps, missionId('esc-m1') as MissionId, 'PERIODIC');
      assert.equal(fireResult.ok, true);
      if (!fireResult.ok) return;

      // Respond with assessment completely unrelated to objective → high drift
      const respondResult = coordinator.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Optimizing database indexes for better query performance on user tables',
        confidence: 0.9,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });
      assert.equal(respondResult.ok, true);
      if (!respondResult.ok) return;

      // Verify escalation occurred despite high confidence
      const driftRow = conn.get<{ drift_score: number; action_taken: string }>(
        'SELECT drift_score, action_taken FROM core_drift_assessments WHERE checkpoint_id = ?',
        [fireResult.value],
      );
      assert.ok(driftRow !== undefined);
      assert.equal(driftRow!.action_taken, 'escalated',
        'CATCHES: without drift escalation, agent pursues divergent objectives undetected');

      // Verify the checkpoint system_action was overridden
      const checkpoint = conn.get<{ system_action: string }>(
        'SELECT system_action FROM core_checkpoints WHERE id = ?',
        [fireResult.value],
      );
      assert.equal(checkpoint?.system_action, 'escalated',
        'CATCHES: drift detection must override continue→escalated to block divergent work');

      conn.close();
    });
  });

  describe('FM-14 Defense: Semantic Drift', () => {
    it.skip('I-24 prevents agent from pursuing divergent objectives — DEFERRED (drift detection not implemented)', () => {});
    it.skip('periodic consistency checks at checkpoints — DEFERRED (checkpoint drift not implemented)', () => {});
  });

  describe('FM-16 Defense: Mission Drift', () => {
    it.skip('reflection checkpoints compare work against canonical objective — DEFERRED (no reflection engine)', () => {});
    it.skip('budget constraints provide secondary drift defense — DEFERRED (budget exhaustion tested in SC-8/I-20)', () => {});
  });
});
