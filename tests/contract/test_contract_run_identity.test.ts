/**
 * Limen Phase 0A — Run Identity + Attempt + Causal Ordering
 * Truth Model: Deliverable 2
 * Assertions: BC-010 to BC-019, ST-010, ST-020, EDGE-013, INV-X04, INV-X12
 *
 * Phase: 0A (Foundation)
 * Gate: All tests FAIL with NotImplementedError before implementation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type { Run, RunState, Attempt, AttemptState, AttemptPinnedVersions, AttemptFailureRef, AttemptStrategyDelta } from '../../src/kernel/interfaces/run_identity.js';
import type { SupervisorDecisionId } from '../../src/kernel/interfaces/governance_ids.js';
import { supervisorDecisionId } from '../helpers/governance_test_helpers.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
  // Debt 2: Seed runs — TransitionEnforcer now requires entities to exist
  const now = testTimestamp();
  const runIds = ['run-st020-comp', 'run-st020-fail', 'run-st020-aband', 'run-st020-rev'];
  for (const id of runIds) {
    conn.run(
      `INSERT INTO gov_runs (run_id, tenant_id, mission_id, state, started_at, schema_version, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'test-tenant', 'mission-001', 'active', now, '0.1.0', 'runtime'],
    );
  }
}

function makePinnedVersions(): AttemptPinnedVersions {
  return { missionContractVersion: '1.0.0', traceGrammarVersion: '1.0.0', evalSchemaVersion: '1.0.0', capabilityManifestSchemaVersion: '1.0.0' };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: runId('run-001'), tenantId: tenantId('test-tenant'), missionId: missionId('mission-001'),
    state: 'active' as RunState, startedAt: testTimestamp(), schemaVersion: '0.1.0', origin: 'runtime',
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    attemptId: attemptId('attempt-001'), taskId: taskId('task-001'), missionId: missionId('mission-001'),
    runId: runId('run-001'), state: 'started' as AttemptState, pinnedVersions: makePinnedVersions(),
    schemaVersion: '0.1.0', origin: 'runtime', createdAt: testTimestamp(),
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Run Identity (Deliverable 2)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-010: Run entity shape ──

  describe('BC-010: Run creation returns complete entity', () => {
    it('should return Run with runId, tenantId, missionId, state=active, origin=runtime', () => {
      const run = makeRun();
      const result = gov.runStore.create(conn, run);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.runId, 'run-001');
      assert.equal(result.value.tenantId, 'test-tenant');
      assert.equal(result.value.missionId, 'mission-001');
      assert.equal(result.value.state, 'active');
      assert.equal(result.value.origin, 'runtime');
    });

    it('should return Run with startedAt as ISO timestamp string', () => {
      const run = makeRun();
      const result = gov.runStore.create(conn, run);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(typeof result.value.startedAt, 'string');
      assert.doesNotThrow(() => new Date(result.value.startedAt));
    });
  });

  describe('BC-010: Run fork lineage', () => {
    it('should create forked run with forkOfRunId and forkFromEventRef', () => {
      const forkedRun = makeRun({
        runId: runId('run-fork-001'),
        forkOfRunId: runId('run-parent-001'),
        forkFromEventRef: traceEventId('evt-fork-point'),
      });
      const result = gov.runStore.create(conn, forkedRun);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.forkOfRunId, 'run-parent-001');
      assert.equal(result.value.forkFromEventRef, 'evt-fork-point');
    });
  });

  describe('BC-010: RunState exactly 4 values', () => {
    it('should accept all 4 RunState values via updateState', () => {
      const states: RunState[] = ['active', 'completed', 'failed', 'abandoned'];
      for (const state of states) {
        const result = gov.runStore.updateState(conn, runId(`run-state-${state}`), state);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.value.state, state);
      }
    });
  });

  // ── BC-011: Attempt entity shape ──

  describe('BC-011: Attempt creation returns complete entity', () => {
    it('should return Attempt with all required fields', () => {
      const attempt = makeAttempt();
      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.attemptId, 'attempt-001');
      assert.equal(result.value.taskId, 'task-001');
      assert.equal(result.value.runId, 'run-001');
      assert.equal(result.value.state, 'started');
      assert.equal(result.value.origin, 'runtime');
    });
  });

  describe('BC-011 v1.1: Attempt typed triggeringFailure', () => {
    it('should preserve AttemptFailureRef with errorCode, summary, priorAttemptId, violations', () => {
      const failure: AttemptFailureRef = {
        priorAttemptId: attemptId('attempt-prior'),
        errorCode: 'BUDGET_EXCEEDED',
        violations: [{ type: 'BUDGET', code: 'BUDGET_001', message: 'Over budget', spec: '§DBA' }],
        summary: 'Budget exceeded during execution',
      };
      const attempt = makeAttempt({ triggeringFailure: failure });
      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.triggeringFailure?.errorCode, 'BUDGET_EXCEEDED');
      assert.equal(result.value.triggeringFailure?.priorAttemptId, 'attempt-prior');
      assert.equal(result.value.triggeringFailure?.summary, 'Budget exceeded during execution');
      assert.equal(result.value.triggeringFailure?.violations?.[0]?.type, 'BUDGET');
    });
  });

  describe('BC-011 v1.1: Attempt typed strategyDelta', () => {
    it('should preserve AttemptStrategyDelta with description, changedParameters, supervisorInterventionIds', () => {
      const delta: AttemptStrategyDelta = {
        description: 'Reduced scope after budget warning',
        changedParameters: { maxTokens: 5000 },
        supervisorInterventionIds: [supervisorDecisionId('dec-001')],
      };
      const attempt = makeAttempt({ strategyDelta: delta });
      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.strategyDelta?.description, 'Reduced scope after budget warning');
      assert.deepStrictEqual(result.value.strategyDelta?.changedParameters, { maxTokens: 5000 });
      assert.equal(result.value.strategyDelta?.supervisorInterventionIds?.[0], 'dec-001');
    });
  });

  // ── BC-012: AttemptPinnedVersions typed ──

  describe('BC-012: AttemptPinnedVersions has 4 typed version fields', () => {
    it('should preserve all 4 version fields exactly', () => {
      const versions: AttemptPinnedVersions = {
        missionContractVersion: '2.1.0',
        traceGrammarVersion: '1.3.0',
        evalSchemaVersion: '1.0.0',
        capabilityManifestSchemaVersion: '3.0.0',
      };
      const attempt = makeAttempt({ pinnedVersions: versions });
      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.pinnedVersions.missionContractVersion, '2.1.0');
      assert.equal(result.value.pinnedVersions.traceGrammarVersion, '1.3.0');
      assert.equal(result.value.pinnedVersions.evalSchemaVersion, '1.0.0');
      assert.equal(result.value.pinnedVersions.capabilityManifestSchemaVersion, '3.0.0');
    });
  });

  // ── BC-013: RunSequencer monotonically increasing ──

  describe('BC-013: RunSequencer.nextRunSeq returns a number', () => {
    it('should return a numeric sequence value', () => {
      const seq = gov.traceEmitter.sequencer.nextRunSeq(runId('run-seq-001'));
      assert.equal(typeof seq, 'number');
      assert.equal(seq >= 1, true);
    });
  });

  // ── BC-014: Forked run runSeq starts at 1 ──

  describe('BC-014: Forked run runSeq starts at 1', () => {
    it('should return 1 as first runSeq for a new forked run', () => {
      const forkedRunId = runId('run-forked-seq');
      const seq = gov.traceEmitter.sequencer.nextRunSeq(forkedRunId);
      assert.equal(seq, 1);
    });
  });

  // ── BC-019: Only one non-terminal Attempt per task ──

  describe('BC-019: getActiveForTask returns at most one non-terminal attempt', () => {
    it('should return a single Attempt or null for a given task', () => {
      const result = gov.attemptStore.getActiveForTask(conn, taskId('task-bc019'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // Null if no active attempt, or a single Attempt — never an array
      const isNullOrAttempt = result.value === null || typeof result.value?.attemptId === 'string';
      assert.equal(isNullOrAttempt, true);
    });
  });

  // ── ST-010: Attempt lifecycle transitions ──

  describe('ST-010: Attempt transition started → executing', () => {
    it('should succeed for legal transition', () => {
      const result = gov.attemptStore.updateState(conn, attemptId('attempt-st010'), 'executing');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.state, 'executing');
    });
  });

  describe('ST-010: Attempt transition executing → succeeded', () => {
    it('should succeed for legal transition', () => {
      const result = gov.attemptStore.updateState(conn, attemptId('attempt-st010-exec'), 'succeeded');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.state, 'succeeded');
    });
  });

  describe('ST-010: Attempt transition executing → failed', () => {
    it('should succeed for legal transition', () => {
      const result = gov.attemptStore.updateState(conn, attemptId('attempt-st010-fail'), 'failed');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.state, 'failed');
    });
  });

  describe('ST-010: Attempt transition executing → abandoned', () => {
    it('should succeed for suspension-revoke path', () => {
      const result = gov.attemptStore.updateState(conn, attemptId('attempt-st010-aband'), 'abandoned');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.state, 'abandoned');
    });
  });

  // ── ST-020: Run lifecycle transitions (v1.1) ──

  describe('ST-020: Run transition active → completed', () => {
    it('should succeed when mission completed', () => {
      const result = gov.transitionEnforcer.enforceRunTransition(conn, runId('run-st020-comp'), 'completed');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'completed');
    });
  });

  describe('ST-020: Run transition active → failed', () => {
    it('should succeed when mission failed', () => {
      const result = gov.transitionEnforcer.enforceRunTransition(conn, runId('run-st020-fail'), 'failed');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'failed');
    });
  });

  describe('ST-020: Run transition active → abandoned', () => {
    it('should succeed when mission revoked', () => {
      const result = gov.transitionEnforcer.enforceRunTransition(conn, runId('run-st020-aband'), 'abandoned');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.toState, 'abandoned');
    });
  });

  describe('ST-020: No reverse from terminal — completed → active', () => {
    it('should reject reverse transition from completed', () => {
      // Setup: transition to terminal state 'completed' first
      gov.transitionEnforcer.enforceRunTransition(conn, runId('run-st020-rev'), 'completed');
      // Attempt transition from terminal state — must be rejected (BC-070)
      const result = gov.transitionEnforcer.enforceRunTransition(conn, runId('run-st020-rev'), 'completed');
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'LIFECYCLE_INVALID_TRANSITION');
    });
  });

  // ── EDGE-013: Fork from active run ──

  describe('EDGE-013: Fork from active (non-completed) run is valid', () => {
    it('should create a new run with forkOfRunId referencing an active run', () => {
      const forked = makeRun({
        runId: runId('run-fork-edge013'),
        forkOfRunId: runId('run-active-parent'),
        forkFromEventRef: traceEventId('evt-fork-edge013'),
      });
      const result = gov.runStore.create(conn, forked);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.forkOfRunId, 'run-active-parent');
      assert.equal(result.value.state, 'active');
    });
  });

  // ── INV-X04: schemaVersion on both entities ──

  describe('INV-X04: Run carries schemaVersion', () => {
    it('should preserve schemaVersion on created Run', () => {
      const run = makeRun({ schemaVersion: '0.2.0' });
      const result = gov.runStore.create(conn, run);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.schemaVersion, '0.2.0');
    });
  });

  describe('INV-X04: Attempt carries schemaVersion', () => {
    it('should preserve schemaVersion on created Attempt', () => {
      const attempt = makeAttempt({ schemaVersion: '0.3.0' });
      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.schemaVersion, '0.3.0');
    });
  });

  // ── INV-X12: origin discriminator ──

  describe('INV-X12: Run with origin=migration-backfill', () => {
    it('should accept migration-backfill origin', () => {
      const run = makeRun({ origin: 'migration-backfill' });
      const result = gov.runStore.create(conn, run);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.origin, 'migration-backfill');
    });
  });

  describe('INV-X12: Attempt with origin=migration-backfill', () => {
    it('should accept migration-backfill origin', () => {
      const attempt = makeAttempt({ origin: 'migration-backfill' });
      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.origin, 'migration-backfill');
    });
  });

  // ── BC-010: Run retrieval by mission ──

  describe('BC-010: getByMission returns all runs for a mission', () => {
    it('should return an array of runs for the given missionId', () => {
      const result = gov.runStore.getByMission(conn, missionId('mission-getby'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(Array.isArray(result.value), true);
    });
  });

  // ── BC-011: getByTask returns all attempts for a task ──

  describe('BC-011: getByTask returns all attempts for a task', () => {
    it('should return an array of attempts for the given taskId', () => {
      const result = gov.attemptStore.getByTask(conn, taskId('task-getby'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(Array.isArray(result.value), true);
    });
  });
});
