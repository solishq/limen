/**
 * SC-10 Contract Tests: respond_checkpoint -- Facade-Level Verification
 * S ref: S24 (Checkpoint), I-17 (governance boundary), I-24 (goal anchoring),
 *        I-25 (deterministic replay), I-03 (atomic audit)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT CheckpointCoordinator.processResponse directly)
 *
 * SC-10 requires a checkpoint to exist first. Each test must:
 *   1. Create a mission via engine.proposeMission()
 *   2. Transition mission to EXECUTING (checkpoints fire on active missions)
 *   3. Fire a checkpoint via engine.checkpoints.fire(deps, missionId, trigger)
 *   4. Then test engine.respondCheckpoint()
 *
 * Amendment 21: Every rejection test verifies BOTH error code AND state unchanged.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  agentId,
  taskId,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine, OrchestrationDeps } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  ProposeTaskGraphInput,
  RespondCheckpointInput,
  TaskDefinition,
} from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;
let deps: OrchestrationDeps;

/**
 * Setup: create a fresh in-memory database with full schema,
 * then create the orchestration engine through createOrchestration().
 * SC-10 needs deps access for engine.checkpoints.fire().
 */
function setup(): void {
  const result = createTestOrchestrationDeps();
  conn = result.conn;
  deps = result.deps;
  ctx = createTestOperationContext();
  engine = createOrchestration(conn, result.deps.substrate, result.audit);
}

/** S15: Create a mission through the facade */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for checkpoint response',
    successCriteria: ['Complete the task'],
    scopeBoundaries: ['Within budget'],
    capabilities: ['web_search'],
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

/**
 * Transition a mission to EXECUTING state.
 * Missions start in CREATED → must go through PLANNING → EXECUTING.
 * SC-10 side-effects (BLOCKED/CANCELLED) only fire on non-terminal missions.
 */
function transitionToExecuting(mid: MissionId): void {
  // CREATED → PLANNING
  const toPlan = engine.missions.transition(deps, mid, 'CREATED', 'PLANNING');
  assert.equal(toPlan.ok, true, 'Mission transition CREATED → PLANNING must succeed');
  // PLANNING → EXECUTING (requires a task graph)
  const tasks: TaskDefinition[] = [{
    id: taskId('chk-task-1'),
    description: 'Task for checkpoint tests',
    executionMode: 'deterministic',
    estimatedTokens: 100,
    capabilitiesRequired: [],
  }];
  const graphInput: ProposeTaskGraphInput = {
    missionId: mid,
    tasks,
    dependencies: [],
    objectiveAlignment: 'Task graph for SC-10 checkpoint tests',
  };
  const graphResult = engine.proposeTaskGraph(ctx, graphInput);
  assert.equal(graphResult.ok, true, 'Task graph creation must succeed');
  const toExec = engine.missions.transition(deps, mid, 'PLANNING', 'EXECUTING');
  assert.equal(toExec.ok, true, 'Mission transition PLANNING → EXECUTING must succeed');
}

/**
 * Fire a checkpoint for a mission and return the checkpointId.
 * Uses engine.checkpoints.fire() which is exposed on the facade.
 */
function fireCheckpoint(mid: MissionId): string {
  const result = engine.checkpoints.fire(deps, mid, 'PERIODIC');
  assert.equal(result.ok, true, 'S24: Checkpoint fire must succeed');
  if (!result.ok) throw new Error('Failed to fire checkpoint');
  return result.value;
}

/** Construct a valid RespondCheckpointInput with sensible defaults */
function validRespondInput(
  checkpointId: string,
  overrides: Partial<RespondCheckpointInput> = {},
): RespondCheckpointInput {
  return {
    checkpointId,
    assessment: 'Test mission for checkpoint response proceeding well with all tasks on track',
    confidence: 0.9,
    proposedAction: 'continue',
    planRevision: null,
    escalationReason: null,
    ...overrides,
  };
}

// ─── A21 State-Unchanged Verification ───

/** Count checkpoints in PENDING state */
function countPendingCheckpoints(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_checkpoints WHERE state = 'PENDING'",
  )?.cnt ?? 0;
}

/** Count respond_checkpoint audit entries */
function countRespondCheckpointAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'respond_checkpoint'",
  )?.cnt ?? 0;
}

/** Count mission_transition audit entries */
function countMissionTransitionAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'mission_transition'",
  )?.cnt ?? 0;
}

/** Snapshot state before a rejection test */
function snapshotState(conn: DatabaseConnection): {
  pendingCheckpoints: number;
  respondAuditEntries: number;
  missionTransitionAuditEntries: number;
} {
  return {
    pendingCheckpoints: countPendingCheckpoints(conn),
    respondAuditEntries: countRespondCheckpointAuditEntries(conn),
    missionTransitionAuditEntries: countMissionTransitionAuditEntries(conn),
  };
}

/**
 * A21: Assert state unchanged after a rejection.
 * Verifies: no checkpoints changed from PENDING, no new respond_checkpoint audit entries,
 * no new mission_transition audit entries.
 */
function assertStateUnchanged(
  conn: DatabaseConnection,
  before: ReturnType<typeof snapshotState>,
  label: string,
): void {
  const afterPending = countPendingCheckpoints(conn);
  assert.equal(afterPending, before.pendingCheckpoints,
    `${label}: PENDING checkpoint count should not change after rejection (before=${before.pendingCheckpoints}, after=${afterPending})`);

  const afterRespondAudits = countRespondCheckpointAuditEntries(conn);
  assert.equal(afterRespondAudits, before.respondAuditEntries,
    `${label}: respond_checkpoint audit count should not change after rejection (before=${before.respondAuditEntries}, after=${afterRespondAudits})`);

  const afterTransitionAudits = countMissionTransitionAuditEntries(conn);
  assert.equal(afterTransitionAudits, before.missionTransitionAuditEntries,
    `${label}: mission_transition audit count should not change after rejection (before=${before.missionTransitionAuditEntries}, after=${afterTransitionAudits})`);
}

describe('SC-10 Contract: respond_checkpoint (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('SC10-SUCCESS-CONTINUE-HIGH-CONFIDENCE: confidence=0.9 proposedAction=continue -- action=continue, checkpoint state=RESPONDED', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        confidence: 0.9,
        proposedAction: 'continue',
      }));

      assert.equal(result.ok, true, 'S24: High confidence continue must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'continue',
        'SD-23: Confidence 0.9 (CONTINUE_AUTONOMOUS band 0.8-1.0) must yield action=continue');
      assert.equal(typeof result.value.reason, 'string',
        'S24: Reason must be a non-empty string');
      assert.ok(result.value.reason.length > 0,
        'S24: Reason must be non-empty');

      // Verify checkpoint state is RESPONDED
      const checkpoint = conn.get<{ state: string; system_action: string }>(
        'SELECT state, system_action FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      assert.equal(checkpoint?.state, 'RESPONDED',
        'S24: Checkpoint state must transition to RESPONDED after response');
      assert.equal(checkpoint?.system_action, 'continue',
        'S24: system_action must be persisted as continue');
    });

    it('SC10-SUCCESS-CONTINUE-FLAGGED: confidence=0.6 proposedAction=continue -- action=continue (flagged band)', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        confidence: 0.6,
        proposedAction: 'continue',
      }));

      assert.equal(result.ok, true, 'S24: Flagged confidence continue must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'continue',
        'SD-23: Confidence 0.6 (CONTINUE_FLAGGED band 0.5-0.8) must yield action=continue');

      // Verify checkpoint persisted correctly
      const checkpoint = conn.get<{ state: string; confidence: number; system_action: string }>(
        'SELECT state, confidence, system_action FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      assert.equal(checkpoint?.state, 'RESPONDED',
        'S24: Checkpoint state must be RESPONDED');
      assert.equal(checkpoint?.confidence, 0.6,
        'S24: Stored confidence must match input value');
      assert.equal(checkpoint?.system_action, 'continue',
        'SD-23: system_action must be continue for flagged band');
    });

    it('SC10-SUCCESS-ESCALATED-LOW-CONFIDENCE: confidence=0.3 proposedAction=continue -- action=escalated, mission state=BLOCKED', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        confidence: 0.3,
        proposedAction: 'continue',
      }));

      assert.equal(result.ok, true, 'S24: Low confidence response must succeed (system escalates)');
      if (!result.ok) return;

      assert.equal(result.value.action, 'escalated',
        'SD-23: Confidence 0.3 (PAUSE_HUMAN_INPUT band 0.2-0.5) must yield action=escalated');

      // Verify mission transitioned to BLOCKED
      const mission = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(mission?.state, 'BLOCKED',
        'S24: Mission must transition to BLOCKED when checkpoint escalated');

      // Verify checkpoint state
      const checkpoint = conn.get<{ state: string; system_action: string }>(
        'SELECT state, system_action FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      assert.equal(checkpoint?.state, 'RESPONDED',
        'S24: Checkpoint state must be RESPONDED');
      assert.equal(checkpoint?.system_action, 'escalated',
        'SD-23: system_action must be escalated');
    });

    it('SC10-SUCCESS-ABORT: proposedAction=abort -- action=aborted, mission state=CANCELLED', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        proposedAction: 'abort',
        confidence: 0.5,
      }));

      assert.equal(result.ok, true, 'S24: Abort response must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'aborted',
        'S24: proposedAction=abort must yield action=aborted');

      // Verify mission transitioned to CANCELLED
      const mission = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(mission?.state, 'CANCELLED',
        'S24: Mission must transition to CANCELLED when agent proposes abort');

      // Verify checkpoint state
      const checkpoint = conn.get<{ state: string; system_action: string }>(
        'SELECT state, system_action FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      assert.equal(checkpoint?.state, 'RESPONDED',
        'S24: Checkpoint state must be RESPONDED after abort');
      assert.equal(checkpoint?.system_action, 'aborted',
        'S24: system_action must be aborted');
    });

    it('SC10-SUCCESS-REPLAN-ACCEPTED: proposedAction=replan with planRevision != null -- action=replan_accepted', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const planRevision: RespondCheckpointInput['planRevision'] = {
        missionId: mid,
        tasks: [{
          id: taskId('replan-task-1'),
          description: 'Replanned task after checkpoint',
          executionMode: 'deterministic',
          estimatedTokens: 200,
          capabilitiesRequired: [],
        }],
        dependencies: [],
        objectiveAlignment: 'Revised plan after checkpoint assessment',
      };

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        proposedAction: 'replan',
        confidence: 0.7,
        planRevision,
      }));

      assert.equal(result.ok, true, 'S24: Replan with plan revision must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'replan_accepted',
        'S24: proposedAction=replan with planRevision != null must yield action=replan_accepted');

      // Verify checkpoint recorded the plan revision
      const checkpoint = conn.get<{ state: string; system_action: string; plan_revision: string | null }>(
        'SELECT state, system_action, plan_revision FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      assert.equal(checkpoint?.state, 'RESPONDED',
        'S24: Checkpoint state must be RESPONDED');
      assert.equal(checkpoint?.system_action, 'replan_accepted',
        'S24: system_action must be replan_accepted');
      assert.notEqual(checkpoint?.plan_revision, null,
        'S24: plan_revision must be stored when provided');

      const storedPlan = JSON.parse(checkpoint!.plan_revision!) as Record<string, unknown>;
      assert.equal(storedPlan.missionId, mid,
        'S24: Stored plan revision must contain the correct missionId');
    });

    it('SC10-SUCCESS-REPLAN-REJECTED: proposedAction=replan with planRevision = null -- action=replan_rejected', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        proposedAction: 'replan',
        confidence: 0.7,
        planRevision: null,
      }));

      assert.equal(result.ok, true, 'S24: Replan without plan revision must succeed (system rejects)');
      if (!result.ok) return;

      assert.equal(result.value.action, 'replan_rejected',
        'S24: proposedAction=replan with planRevision = null must yield action=replan_rejected');

      // Verify checkpoint state
      const checkpoint = conn.get<{ state: string; system_action: string; plan_revision: string | null }>(
        'SELECT state, system_action, plan_revision FROM core_checkpoints WHERE id = ?',
        [checkpointId],
      );
      assert.equal(checkpoint?.state, 'RESPONDED',
        'S24: Checkpoint state must be RESPONDED');
      assert.equal(checkpoint?.system_action, 'replan_rejected',
        'S24: system_action must be replan_rejected');
      assert.equal(checkpoint?.plan_revision, null,
        'S24: plan_revision must be null when not provided');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS -- A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths -- A21 Rejection Verification', () => {

    it('SC10-ERR-CHECKPOINT-NOT-FOUND: respond to nonexistent checkpointId -- CHECKPOINT_EXPIRED + state unchanged', () => {
      const before = snapshotState(conn);

      const result = engine.respondCheckpoint(ctx, validRespondInput('nonexistent-checkpoint-xyz'));

      assert.equal(result.ok, false, 'S24: Must reject response to nonexistent checkpoint');
      if (!result.ok) {
        assert.equal(result.error.code, 'CHECKPOINT_EXPIRED',
          'S24: Error code must be CHECKPOINT_EXPIRED for nonexistent checkpoint');
      }

      assertStateUnchanged(conn, before, 'CHECKPOINT_NOT_FOUND');
    });

    it('SC10-ERR-CHECKPOINT-ALREADY-RESPONDED: respond twice to same checkpoint -- second returns CHECKPOINT_EXPIRED + state unchanged', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      // First response should succeed
      const first = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        confidence: 0.9,
        proposedAction: 'continue',
      }));
      assert.equal(first.ok, true, 'S24: First response must succeed');

      // Snapshot state AFTER first successful response
      const before = snapshotState(conn);

      // Second response to same checkpoint must fail
      const second = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        confidence: 0.8,
        proposedAction: 'continue',
        assessment: 'Second attempt that should fail',
      }));

      assert.equal(second.ok, false, 'S24: Must reject second response to already-responded checkpoint');
      if (!second.ok) {
        assert.equal(second.error.code, 'CHECKPOINT_EXPIRED',
          'S24: Error code must be CHECKPOINT_EXPIRED for already-responded checkpoint');
      }

      assertStateUnchanged(conn, before, 'CHECKPOINT_ALREADY_RESPONDED');
    });

    it('SC10-ERR-CHECKPOINT-TIMEOUT: create checkpoint with past timeout, respond -- CHECKPOINT_EXPIRED + state unchanged', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);

      // Create a checkpoint with timeout in the past via direct SQL INSERT
      const checkpointId = `chk-expired-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date();
      const pastTimeout = new Date(now.getTime() - 60000).toISOString(); // 1 minute ago
      const tenantRow = conn.get<{ tenant_id: string | null }>(
        'SELECT tenant_id FROM core_missions WHERE id = ?',
        [mid],
      );

      conn.run(
        `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
         VALUES (?, ?, ?, 'PERIODIC', 'PENDING', ?, ?)`,
        [checkpointId, mid, tenantRow?.tenant_id ?? null, pastTimeout, now.toISOString()],
      );

      const before = snapshotState(conn);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId));

      assert.equal(result.ok, false, 'S24: Must reject response to timed-out checkpoint');
      if (!result.ok) {
        assert.equal(result.error.code, 'CHECKPOINT_EXPIRED',
          'S24: Error code must be CHECKPOINT_EXPIRED for timed-out checkpoint');
      }

      assertStateUnchanged(conn, before, 'CHECKPOINT_TIMEOUT');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS -- Facade-Level Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition -- Facade-Level Verification', () => {

    it('SC10-AUDIT-FULL-EXCHANGE: respond -- audit entry with operation=respond_checkpoint containing assessment, confidence, proposedAction, systemAction', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        assessment: 'Test mission for checkpoint response — all subsystems nominal, memory within bounds',
        confidence: 0.85,
        proposedAction: 'continue',
      }));
      assert.equal(result.ok, true, 'S24: Checkpoint response must succeed');
      if (!result.ok) return;

      // I-03/I-25: Verify full checkpoint exchange recorded in audit
      const auditEntry = conn.get<{
        operation: string; resource_type: string; resource_id: string;
        actor_type: string; detail: string;
      }>(
        "SELECT operation, resource_type, resource_id, actor_type, detail FROM core_audit_log WHERE operation = 'respond_checkpoint' AND resource_id = ?",
        [checkpointId],
      );

      assert.ok(auditEntry, 'I-03: Audit entry must exist for respond_checkpoint');
      assert.equal(auditEntry.operation, 'respond_checkpoint',
        'I-03: operation must be respond_checkpoint');
      assert.equal(auditEntry.resource_type, 'checkpoint',
        'I-03: resource_type must be checkpoint');
      assert.equal(auditEntry.resource_id, checkpointId,
        'I-03: resource_id must be the checkpointId');
      assert.equal(auditEntry.actor_type, 'system',
        'I-17: Checkpoint processing is system-initiated');

      const detail = JSON.parse(auditEntry.detail) as Record<string, unknown>;
      assert.equal(detail.assessment, 'Test mission for checkpoint response — all subsystems nominal, memory within bounds',
        'I-25: Audit detail must contain the full assessment for replay');
      assert.equal(detail.confidence, 0.85,
        'I-25: Audit detail must contain confidence for replay');
      assert.equal(detail.proposedAction, 'continue',
        'I-25: Audit detail must contain proposedAction for replay');
      assert.equal(detail.systemAction, 'continue',
        'I-25: Audit detail must contain systemAction for replay');
      assert.equal(detail.missionId, mid,
        'I-25: Audit detail must contain missionId for traceability');
      assert.equal(typeof detail.reason, 'string',
        'I-25: Audit detail must contain reason string');
    });

    it('SC10-ESCALATION-MISSION-AUDIT: respond with escalation -- audit entry for mission_transition to BLOCKED', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      // Count mission_transition audit entries before
      const transitionAuditsBefore = countMissionTransitionAuditEntries(conn);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        proposedAction: 'escalate',
        confidence: 0.4,
        escalationReason: 'External dependency unavailable, cannot proceed without human input',
      }));
      assert.equal(result.ok, true, 'S24: Escalation response must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'escalated',
        'S24: proposedAction=escalate must yield action=escalated');

      // F-08 fix: Verify I-03 audit for mission state side-effect
      const transitionAuditsAfter = countMissionTransitionAuditEntries(conn);
      assert.equal(transitionAuditsAfter, transitionAuditsBefore + 1,
        'I-03/F-08: Exactly one mission_transition audit entry must be created for escalation');

      // Query the LATEST mission_transition audit entry for this mission (transitionToExecuting
      // also creates mission_transition entries, so we need the most recent one from the escalation)
      const transitionAudit = conn.get<{
        operation: string; resource_type: string; resource_id: string; detail: string;
      }>(
        "SELECT operation, resource_type, resource_id, detail FROM core_audit_log WHERE operation = 'mission_transition' AND resource_id = ? ORDER BY rowid DESC LIMIT 1",
        [mid],
      );

      assert.ok(transitionAudit, 'I-03: mission_transition audit entry must exist');
      assert.equal(transitionAudit.operation, 'mission_transition',
        'I-03: operation must be mission_transition');
      assert.equal(transitionAudit.resource_type, 'mission',
        'I-03: resource_type must be mission');
      assert.equal(transitionAudit.resource_id, mid,
        'I-03: resource_id must be the missionId');

      const detail = JSON.parse(transitionAudit.detail) as Record<string, unknown>;
      assert.equal(detail.to, 'BLOCKED',
        'S24: Mission must transition to BLOCKED on escalation');
      assert.equal(detail.reason, 'checkpoint_escalation',
        'S24: Transition reason must be checkpoint_escalation');
      assert.equal(detail.checkpointId, checkpointId,
        'S24: Transition detail must reference the triggering checkpointId');

      // Verify mission is actually BLOCKED
      const mission = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(mission?.state, 'BLOCKED',
        'S24: Mission state must be BLOCKED after escalation');
    });

    it('SC10-ABORT-MISSION-AUDIT: respond with abort -- audit entry for mission_transition to CANCELLED', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const transitionAuditsBefore = countMissionTransitionAuditEntries(conn);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        proposedAction: 'abort',
        confidence: 0.1,
        assessment: 'Mission is unsalvageable',
      }));
      assert.equal(result.ok, true, 'S24: Abort response must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'aborted',
        'S24: proposedAction=abort must yield action=aborted');

      // F-08 fix: Verify I-03 audit for mission state side-effect (abort path)
      const transitionAuditsAfter = countMissionTransitionAuditEntries(conn);
      assert.equal(transitionAuditsAfter, transitionAuditsBefore + 1,
        'I-03/F-08: Exactly one mission_transition audit entry must be created for abort');

      const transitionAudit = conn.get<{
        operation: string; resource_id: string; detail: string;
      }>(
        "SELECT operation, resource_id, detail FROM core_audit_log WHERE operation = 'mission_transition' AND resource_id = ? ORDER BY rowid DESC LIMIT 1",
        [mid],
      );

      assert.ok(transitionAudit, 'I-03: mission_transition audit entry must exist for abort');
      const detail = JSON.parse(transitionAudit.detail) as Record<string, unknown>;
      assert.equal(detail.to, 'CANCELLED',
        'S24: Mission must transition to CANCELLED on abort');
      assert.equal(detail.reason, 'checkpoint_abort',
        'S24: Transition reason must be checkpoint_abort');
      assert.equal(detail.checkpointId, checkpointId,
        'S24: Transition detail must reference the triggering checkpointId');

      // Verify mission is actually CANCELLED
      const mission = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(mission?.state, 'CANCELLED',
        'S24: Mission state must be CANCELLED after abort');
    });

    it('SC10-SUCCESS-HALT-ESCALATE-BAND: confidence=0.1 (HALT_ESCALATE band 0.0-0.2) -- action=escalated, mission=BLOCKED', () => {
      const mid = createTestMission();
      transitionToExecuting(mid);
      const checkpointId = fireCheckpoint(mid);

      const result = engine.respondCheckpoint(ctx, validRespondInput(checkpointId, {
        proposedAction: 'continue',
        confidence: 0.1,
        assessment: 'Very low confidence — halt and escalate',
      }));

      assert.equal(result.ok, true, 'S24: Response must succeed');
      if (!result.ok) return;

      assert.equal(result.value.action, 'escalated',
        'SD-23: Confidence 0.1 (HALT_ESCALATE band 0.0-0.2) must yield action=escalated');
      assert.ok(result.value.reason.includes('0.1'),
        'SD-23: Reason must reference the confidence value');

      // Verify mission transitioned to BLOCKED
      const mission = conn.get<{ state: string }>(
        'SELECT state FROM core_missions WHERE id = ?',
        [mid],
      );
      assert.equal(mission?.state, 'BLOCKED',
        'SD-23: Mission must be BLOCKED when confidence is in HALT_ESCALATE band');
    });
  });
});
