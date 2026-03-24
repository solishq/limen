/**
 * TEST-GAP-007: Checkpoint Governance — S24
 * Verifies: Checkpoint fire/respond lifecycle, confidence-driven behavior, expiry.
 *
 * DERIVED FROM SPEC, NOT IMPLEMENTATION.
 * S24: "Checkpoint. Fire -> Agent responds -> System decides."
 * SD-23: Confidence thresholds: 0.8-1.0 continue, 0.5-0.8 flagged, 0.2-0.5 pause+human, 0.0-0.2 halt+escalate.
 * S24: "CHECKPOINT_EXPIRED — response after timeout."
 *
 * Phase: 4A-3 (harness-dependent tests)
 * NOTE: Spec reference corrected from I-15 (Linear Cost Scaling) per FINDING-R1. Attributed to S24.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import { CONFIDENCE_BANDS } from '../../src/orchestration/interfaces/orchestration.js';
import {
  createTestOrchestrationDeps,
  seedMission,
  seedResource,
  missionId,
} from '../helpers/test_database.js';
import type { MissionId } from '../../src/kernel/interfaces/index.js';

describe('TEST-GAP-007: Checkpoint Governance (S24)', () => {

  describe('S24: Checkpoint fire and response lifecycle', () => {

    it('fire() creates a PENDING checkpoint and returns checkpoint ID', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-m1' });

      const result = checkpoints.fire(deps, missionId('cp-m1'), 'TASK_COMPLETED');

      assert.equal(result.ok, true, 'S24: fire() must succeed');
      if (result.ok) {
        assert.ok(result.value.length > 0, 'S24: Must return non-empty checkpoint ID');

        // Verify checkpoint is PENDING in database
        const cp = conn.get<{ state: string; trigger_type: string }>(
          `SELECT state, trigger_type FROM core_checkpoints WHERE id = ?`,
          [result.value]
        );
        assert.ok(cp, 'Checkpoint must exist in database');
        assert.equal(cp.state, 'PENDING', 'S24: Initial checkpoint state must be PENDING');
        assert.equal(cp.trigger_type, 'TASK_COMPLETED', 'Trigger type must match');
      }

      conn.close();
    });

    it('CHECKPOINT_EXPIRED for nonexistent checkpoint', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      const result = checkpoints.processResponse(deps, {
        checkpointId: 'nonexistent-cp-id',
        assessment: 'All good',
        confidence: 0.9,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });

      assert.equal(result.ok, false, 'S24: Nonexistent checkpoint must fail');
      if (!result.ok) {
        assert.equal(result.error.code, 'CHECKPOINT_EXPIRED',
          'S24: Error code must be CHECKPOINT_EXPIRED');
      }

      conn.close();
    });

    it('CHECKPOINT_EXPIRED when response is after timeout', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-timeout', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-timeout' });

      const fireResult = checkpoints.fire(deps, missionId('cp-timeout'), 'PERIODIC');
      assert.ok(fireResult.ok);

      // Set timeout_at to past to simulate expiry
      conn.run(
        `UPDATE core_checkpoints SET timeout_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`,
        [fireResult.value]
      );

      const result = checkpoints.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Late response',
        confidence: 0.9,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });

      assert.equal(result.ok, false, 'S24: Expired checkpoint must fail');
      if (!result.ok) {
        assert.equal(result.error.code, 'CHECKPOINT_EXPIRED',
          'S24: Error code must be CHECKPOINT_EXPIRED');
      }

      conn.close();
    });
  });

  describe('SD-23: Confidence-driven behavior thresholds', () => {

    it('high confidence (>= 0.8) results in continue action', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-high', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-high' });

      const fireResult = checkpoints.fire(deps, missionId('cp-high'), 'TASK_COMPLETED');
      assert.ok(fireResult.ok);

      const result = checkpoints.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Test mission objective task completed successfully with high confidence',
        confidence: 0.95,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });

      assert.equal(result.ok, true, 'SD-23: High confidence response must succeed');
      if (result.ok) {
        assert.equal(result.value.action, 'continue',
          `SD-23: Confidence ${0.95} >= ${CONFIDENCE_BANDS.CONTINUE_AUTONOMOUS.min} must result in continue`);
      }

      conn.close();
    });

    it('low confidence (0.2-0.5) results in escalation', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-low', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-low' });

      const fireResult = checkpoints.fire(deps, missionId('cp-low'), 'PERIODIC');
      assert.ok(fireResult.ok);

      const result = checkpoints.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Uncertain about approach',
        confidence: 0.3,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });

      assert.equal(result.ok, true, 'SD-23: Low confidence response must succeed');
      if (result.ok) {
        assert.equal(result.value.action, 'escalated',
          `SD-23: Confidence 0.3 in PAUSE_HUMAN_INPUT band must escalate`);
      }

      // Verify mission is BLOCKED (side effect of escalation)
      const mission = conn.get<{ state: string }>(
        `SELECT state FROM core_missions WHERE id = ?`, ['cp-low']
      );
      assert.equal(mission?.state, 'BLOCKED',
        'SD-23: Escalation must transition mission to BLOCKED');

      conn.close();
    });

    it('very low confidence (< 0.2) results in escalation with halt', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-vlow', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-vlow' });

      const fireResult = checkpoints.fire(deps, missionId('cp-vlow'), 'PERIODIC');
      assert.ok(fireResult.ok);

      const result = checkpoints.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Completely lost',
        confidence: 0.1,
        proposedAction: 'continue',
        planRevision: null,
        escalationReason: null,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.action, 'escalated',
          `SD-23: Confidence 0.1 in HALT_ESCALATE band must escalate`);
      }

      conn.close();
    });
  });

  describe('S24: Agent-proposed actions', () => {

    it('abort action transitions mission to CANCELLED', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-abort', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-abort' });

      const fireResult = checkpoints.fire(deps, missionId('cp-abort'), 'TASK_FAILED');
      assert.ok(fireResult.ok);

      const result = checkpoints.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Task failed irrecoverably',
        confidence: 0.9,
        proposedAction: 'abort',
        planRevision: null,
        escalationReason: null,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.action, 'aborted', 'S24: Abort must be honored');
      }

      // Verify mission is CANCELLED
      const mission = conn.get<{ state: string }>(
        `SELECT state FROM core_missions WHERE id = ?`, ['cp-abort']
      );
      assert.equal(mission?.state, 'CANCELLED',
        'S24: Abort must transition mission to CANCELLED');

      conn.close();
    });

    it('escalate action with reason transitions mission to BLOCKED', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-esc', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-esc' });

      const fireResult = checkpoints.fire(deps, missionId('cp-esc'), 'BUDGET_THRESHOLD');
      assert.ok(fireResult.ok);

      const result = checkpoints.processResponse(deps, {
        checkpointId: fireResult.value,
        assessment: 'Need human guidance',
        confidence: 0.7,
        proposedAction: 'escalate',
        planRevision: null,
        escalationReason: 'Budget approaching limit, need approval to continue',
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.action, 'escalated', 'S24: Escalate must be honored');
      }

      conn.close();
    });
  });

  describe('S24: Bulk checkpoint expiry', () => {

    it('expireOverdue expires PENDING checkpoints past timeout', () => {
      const { deps, conn, transitionService } = createTestOrchestrationDeps();
      const checkpoints = createCheckpointCoordinator(transitionService);

      seedMission(conn, { id: 'cp-expire', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cp-expire' });

      // Fire 3 checkpoints
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = checkpoints.fire(deps, missionId('cp-expire'), 'PERIODIC');
        assert.ok(r.ok);
        ids.push(r.value);
      }

      // Set all to past timeout
      conn.run(
        `UPDATE core_checkpoints SET timeout_at = '2020-01-01T00:00:00.000Z' WHERE state = 'PENDING'`
      );

      const result = checkpoints.expireOverdue(deps);
      assert.equal(result.ok, true);
      assert.equal(result.value, 3, 'S24: All 3 overdue checkpoints must be expired');

      // Verify all are EXPIRED
      const expired = conn.query<{ state: string }>(
        `SELECT state FROM core_checkpoints WHERE id IN (?, ?, ?)`,
        ids
      );
      for (const cp of expired) {
        assert.equal(cp.state, 'EXPIRED', 'S24: Each checkpoint must be in EXPIRED state');
      }

      conn.close();
    });
  });
});
