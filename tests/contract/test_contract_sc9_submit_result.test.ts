/**
 * SC-9 Contract Tests: submit_result -- Facade-Level Verification
 * S ref: S23 (submit_result), S6 (Mission lifecycle), I-03 (atomic audit),
 *        I-05 (transactional consistency), I-18 (persistence), I-21 (bounded cognition),
 *        I-25 (deterministic replay), FM-02 (cost explosion defense)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT submitResult directly)
 * Version pins: orchestration.ts frozen zone
 *
 * Amendment 21: Every enforcement DC gets BOTH success AND rejection tests.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CONTROL 2: TRUTH MODEL
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. INVARIANTS
 *    - I-03: Atomic audit — audit entry inside transaction, rolls back together.
 *      DC-SC9-501
 *    - I-05: Transactional consistency — MissionResult INSERT + state UPDATE +
 *      audit + event + compaction all in one transaction.
 *      DC-SC9-204, DC-SC9-301, DC-SC9-302
 *    - I-18: Mission persistence — MissionResult is immutable after creation.
 *      core_mission_results uses mission_id as PK. DC-SC9-104
 *    - I-21: Bounded cognitive state — eager compaction via compactSubtree in same
 *      transaction. DC-SC9-204, DC-SC9-B03
 *    - I-25: Deterministic replay — lifecycle event inside transaction.
 *      DC-SC9-502, DC-SC9-B02
 *    - I-22: Capability immutability — not directly enforced by SC-9 (no capability check)
 *
 * 2. STATE MACHINES
 *    - Mission state: SC-9 checks active states (7 states: CREATED, PLANNING,
 *      EXECUTING, REVIEWING, PAUSED, DEGRADED, BLOCKED). Terminal states
 *      (COMPLETED, FAILED, CANCELLED) rejected with MISSION_NOT_ACTIVE.
 *    - Task state: tasks must be in terminal state (COMPLETED, CANCELLED, FAILED).
 *      Non-terminal tasks → TASKS_INCOMPLETE.
 *    - LIVE DEFECT (DC-SC9-201): Raw SQL bypasses MISSION_TRANSITIONS map.
 *      All 7 active states can transition directly to COMPLETED. Per spec (S6),
 *      only REVIEWING → COMPLETED is valid.
 *
 * 3. FAILURE SEMANTICS
 *    - MISSION_NOT_ACTIVE: mission not found (line 31), terminal state (line 38),
 *      confidence out of range (line 63 — WRONG CODE, DC-SC9-402)
 *    - NO_ARTIFACTS: artifactIds.length === 0 (line 43)
 *    - TASKS_INCOMPLETE: non-terminal tasks in active task graph (line 57)
 *    - UNAUTHORIZED: declared in type but NEVER emitted (DC-SC9-401 LIVE DEFECT)
 *
 * 4. TRUST BOUNDARIES
 *    - SC-9 → MissionStore.get(): mission existence + state check. Error forwarded.
 *      DC-SC9-B01
 *    - SC-9 → EventPropagator.emitLifecycle(): inside transaction, return value
 *      NOT checked. DC-SC9-B02 (LIVE DEFECT)
 *    - SC-9 → CompactionEngine.compactSubtree(): inside transaction, return value
 *      NOT checked. DC-SC9-B03
 *    - SC-9 → deps.conn: direct SQL reads on core_task_graphs, core_tasks
 *
 * 5. SIDE-EFFECT MODEL
 *    - DB write: INSERT into core_mission_results (immutable, PK = mission_id)
 *    - DB write: UPDATE core_missions SET state = 'COMPLETED' (raw SQL, bypasses
 *      missionStore.transition — DC-SC9-201 LIVE DEFECT)
 *    - Audit: submit_result audit entry (inside transaction, I-03)
 *    - Event: MISSION_COMPLETED lifecycle event (inside transaction, I-25)
 *    - Compaction: compactSubtree (inside transaction, I-21)
 *
 * 6. ENVIRONMENTAL ASSUMPTIONS
 *    - SQLite serialized writes (single-process, WAL mode, better-sqlite3)
 *    - Clock: new Date().toISOString() at line 67 — NOT injected (DC-SC9-903).
 *      Timestamps cannot be controlled in tests. Known testability gap.
 *    - core_mission_results.mission_id is PRIMARY KEY — one result per mission
 *    - generateId() produces unique IDs (crypto.randomUUID())
 *
 * DC COVERAGE: DC-SC9-101, DC-SC9-104, DC-SC9-105, DC-SC9-106, DC-SC9-107,
 *   DC-SC9-201, DC-SC9-204, DC-SC9-205, DC-SC9-301, DC-SC9-302,
 *   DC-SC9-401, DC-SC9-402, DC-SC9-501, DC-SC9-502,
 *   DC-SC9-B01, DC-SC9-B02, DC-SC9-B03
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestration } from '../../src/orchestration/index.js';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  agentId,
  missionId as makeMissionId,
  taskId as makeTaskId,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId, ArtifactId, TaskId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  SubmitResultInput,
  OrchestrationDeps,
  MissionState,
} from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;
let orchestrationDeps: OrchestrationDeps;

function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  orchestrationDeps = deps;
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** Create a root mission through the facade */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const deadline = new Date(Date.now() + 3600000).toISOString();
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for submit_result',
    successCriteria: ['Complete the task'],
    scopeBoundaries: ['Within budget'],
    capabilities: ['web_search'],
    ...overrides,
    constraints: {
      budget: 50000,
      deadline,
      ...(overrides.constraints ?? {}),
    },
  };
  const result = engine.proposeMission(ctx, input);
  assert.equal(result.ok, true, 'Test mission creation must succeed');
  if (!result.ok) throw new Error('Failed to create test mission');
  return result.value.missionId;
}

/** Transition mission through facade using real deps */
function transitionMission(mid: MissionId, from: string, to: string): void {
  const result = engine.missions.transition(
    orchestrationDeps, mid, from as MissionState, to as MissionState,
  );
  assert.equal(result.ok, true, `Transition ${from} -> ${to} must succeed`);
}

/** Create an artifact for the mission (needed for submit_result) */
function createTestArtifact(mid: MissionId, tid: TaskId): ArtifactId {
  const result = engine.createArtifact(ctx, {
    missionId: mid,
    name: 'test-artifact',
    type: 'report',
    format: 'markdown',
    content: 'Test artifact content',
    sourceTaskId: tid,
    parentArtifactId: null,
    metadata: {},
  });
  assert.equal(result.ok, true, 'Artifact creation must succeed');
  if (!result.ok) throw new Error('Failed to create artifact');
  return result.value.artifactId;
}

/**
 * Create a mission ready for submit_result:
 * 1. Create mission (CREATED state)
 * 2. Create task graph with one task
 * 3. Transition mission to REVIEWING (the only valid state for COMPLETED per S6)
 * 4. Transition task to terminal state (COMPLETED)
 * 5. Create an artifact
 *
 * Returns { missionId, taskId, artifactId }
 */
function createCompletableMission(missionState: MissionState = 'REVIEWING'): {
  missionId: MissionId;
  taskId: TaskId;
  artifactId: ArtifactId;
} {
  const mid = createTestMission();
  const tid = makeTaskId('task-1');

  // Create task graph
  const graphResult = engine.proposeTaskGraph(ctx, {
    missionId: mid,
    tasks: [{
      id: tid,
      description: 'Test task',
      executionMode: 'deterministic',
      estimatedTokens: 100,
      capabilitiesRequired: ['web_search'],
    }],
    dependencies: [],
    objectiveAlignment: 'Aligned with mission objective',
  });
  assert.equal(graphResult.ok, true, 'Task graph creation must succeed');

  // proposeTaskGraph auto-transitions CREATED -> PLANNING (line 243 in task_graph.ts)
  // So we start from PLANNING here.
  transitionMission(mid, 'PLANNING', 'EXECUTING');
  if (missionState === 'REVIEWING') {
    transitionMission(mid, 'EXECUTING', 'REVIEWING');
  }
  // For other states (e.g., EXECUTING): leave at EXECUTING
  // For PAUSED: caller must do additional transitions after this function

  // Transition task to COMPLETED via direct DB update (task_graph.transitionTask
  // is not exposed through facade as a standalone call)
  conn.run(
    `UPDATE core_tasks SET state = 'COMPLETED', updated_at = ? WHERE id = ?`,
    [new Date().toISOString(), tid],
  );

  // Create artifact
  const artifactId = createTestArtifact(mid, tid);

  return { missionId: mid, taskId: tid, artifactId };
}

/** Construct a valid SubmitResultInput */
function validSubmitInput(
  mid: MissionId,
  artifactId: ArtifactId,
  overrides: Partial<SubmitResultInput> = {},
): SubmitResultInput {
  return {
    missionId: mid,
    summary: 'Mission completed successfully with all objectives met',
    confidence: 0.85,
    artifactIds: [artifactId],
    unresolvedQuestions: [],
    followupRecommendations: [],
    ...overrides,
  };
}

// ─── A21 State-Unchanged Verification ───

function getMissionState(conn: DatabaseConnection, mid: MissionId): string {
  return conn.get<{ state: string }>(
    'SELECT state FROM core_missions WHERE id = ?',
    [mid],
  )?.state ?? 'UNKNOWN';
}

function getMissionResult(conn: DatabaseConnection, mid: MissionId): {
  summary: string;
  confidence: number;
  artifact_ids: string;
} | undefined {
  return conn.get<{ summary: string; confidence: number; artifact_ids: string }>(
    'SELECT summary, confidence, artifact_ids FROM core_mission_results WHERE mission_id = ?',
    [mid],
  );
}

function countSubmitResultAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'submit_result'",
  )?.cnt ?? 0;
}

function countMissionCompletedEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'MISSION_COMPLETED'",
  )?.cnt ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════
// CONTROL 3: VERIFICATION PACK
// ═══════════════════════════════════════════════════════════════════════

describe('SC-9 Contract: submit_result (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('DC-SC9-201-REVIEWING-S: submit_result from REVIEWING state -> COMPLETED + resultId returned', () => {
      // DC-SC9-201 documents LIVE DEFECT for non-REVIEWING states.
      // This test verifies the CORRECT path: REVIEWING -> COMPLETED.
      const { missionId, artifactId } = createCompletableMission('REVIEWING');

      assert.equal(getMissionState(conn, missionId), 'REVIEWING',
        'Mission must be in REVIEWING state before submit');

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      assert.equal(result.ok, true, 'S23: submit_result from REVIEWING must succeed');
      if (!result.ok) return;

      assert.equal(typeof result.value.resultId, 'string',
        'S23: resultId must be a string');
      assert.notEqual(result.value.resultId.length, 0,
        'S23: resultId must be non-empty');
      assert.equal(result.value.missionState, 'COMPLETED',
        'S23: missionState must be COMPLETED');

      // Verify mission state in DB
      assert.equal(getMissionState(conn, missionId), 'COMPLETED',
        'S23: Mission must be COMPLETED in database');
    });

    it('DC-SC9-501-S: successful submit -> audit entry with operation=submit_result', () => {
      // DC-SC9-501 SUCCESS: audit entry exists after successful submit
      const { missionId, artifactId } = createCompletableMission();

      const auditBefore = countSubmitResultAuditEntries(conn);

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));
      assert.equal(result.ok, true, 'Submit must succeed');

      const auditAfter = countSubmitResultAuditEntries(conn);
      assert.equal(auditAfter, auditBefore + 1,
        'I-03: Exactly one submit_result audit entry must be created');

      // Verify audit entry details
      const auditRow = conn.get<{ operation: string; resource_type: string; detail: string }>(
        "SELECT operation, resource_type, detail FROM core_audit_log WHERE operation = 'submit_result' ORDER BY rowid DESC LIMIT 1",
      );
      assert.notEqual(auditRow, undefined, 'I-03: Audit entry must exist');
      assert.equal(auditRow!.operation, 'submit_result',
        'I-03: operation must be submit_result');
      assert.equal(auditRow!.resource_type, 'mission_result',
        'I-03: resource_type must be mission_result');

      const detail = JSON.parse(auditRow!.detail);
      assert.equal(detail.confidence, 0.85,
        'I-03: Audit detail must include confidence');
    });

    it('DC-SC9-502-S: successful submit -> MISSION_COMPLETED event emitted', () => {
      // DC-SC9-502 SUCCESS: lifecycle event inside transaction
      const { missionId, artifactId } = createCompletableMission();

      const eventsBefore = countMissionCompletedEvents(conn);

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));
      assert.equal(result.ok, true, 'Submit must succeed');

      const eventsAfter = countMissionCompletedEvents(conn);
      assert.equal(eventsAfter, eventsBefore + 1,
        'I-25: MISSION_COMPLETED event must be emitted');

      // Verify event payload
      const eventRow = conn.get<{ payload_json: string }>(
        "SELECT payload_json FROM core_events_log WHERE type = 'MISSION_COMPLETED' ORDER BY rowid DESC LIMIT 1",
      );
      assert.notEqual(eventRow, undefined, 'I-25: Event row must exist');
      const payload = JSON.parse(eventRow!.payload_json);
      assert.equal(payload.confidence, 0.85,
        'I-25: Event payload must include confidence');
    });

    it('DC-SC9-205-R: mission with no task graph -> TASKS_INCOMPLETE (Ruling 2, BD-SC9-001)', () => {
      // Ruling 2 REVERSAL: Taskless missions NOT permitted. Zero tasks = zero work.
      // Create mission with no task graph
      const mid = createTestMission();

      // Transition to REVIEWING without task graph
      transitionMission(mid, 'CREATED', 'PLANNING');
      transitionMission(mid, 'PLANNING', 'EXECUTING');
      transitionMission(mid, 'EXECUTING', 'REVIEWING');

      // Create artifact via direct seed since there's no task to reference
      const tid = makeTaskId('no-graph-task');
      const artifactId = createTestArtifact(mid, tid);

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, false,
        'BD-SC9-001: Taskless mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASKS_INCOMPLETE',
          'BD-SC9-001: Error code must be TASKS_INCOMPLETE');
        assert.ok(result.error.message.includes('No task graph'),
          'BD-SC9-001: Message must indicate no task graph');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, mid), 'REVIEWING',
        'A21: Mission state must remain REVIEWING after rejection');
    });

    it('DC-SC9-104-S: first submit for a mission -> succeeds', () => {
      // DC-SC9-104 SUCCESS: first submission succeeds
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      assert.equal(result.ok, true, 'S23: First submission must succeed');

      // Verify MissionResult stored
      const missionResult = getMissionResult(conn, missionId);
      assert.notEqual(missionResult, undefined, 'I-18: MissionResult must be stored');
      assert.equal(missionResult!.summary, 'Mission completed successfully with all objectives met',
        'I-18: MissionResult summary must match input');
      assert.equal(missionResult!.confidence, 0.85,
        'I-18: MissionResult confidence must match input');
    });

    it('DC-SC9-B01-S: MissionStore.get returns valid mission -> proceed', () => {
      // DC-SC9-B01 SUCCESS: valid mission found
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      assert.equal(result.ok, true, 'S23: Valid mission must proceed');
    });

    it('DC-SC9-B03-S: compactSubtree runs inside transaction -> subtree compacted', () => {
      // DC-SC9-B03 SUCCESS: compaction runs as part of the transaction
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      assert.equal(result.ok, true, 'S23: Submit with compaction must succeed');
      // No explicit compaction verification possible without inspecting
      // compaction state — the fact that the transaction committed without
      // error proves compaction ran or was a no-op (no children to compact).
    });

    it('Confidence boundary 0.0 is accepted', () => {
      // Boundary test: confidence = 0.0 is valid
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: 0.0,
      }));

      assert.equal(result.ok, true, 'S23: confidence 0.0 must be accepted');
    });

    it('Confidence boundary 1.0 is accepted', () => {
      // Boundary test: confidence = 1.0 is valid
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: 1.0,
      }));

      assert.equal(result.ok, true, 'S23: confidence 1.0 must be accepted');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // REJECTION PATHS — A21 Dual-Path Testing
  // ════════════════════════════════════════════════════════════════════════

  describe('MISSION_NOT_ACTIVE', () => {

    it('DC-SC9-B01-R: nonexistent mission -> MISSION_NOT_ACTIVE', () => {
      // DC-SC9-B01 REJECTION: MissionStore.get() returns error
      const fakeMid = makeMissionId('nonexistent-mission-sc9');

      const result = engine.submitResult(ctx, validSubmitInput(
        fakeMid,
        'fake-artifact' as ArtifactId,
      ));

      assert.equal(result.ok, false, 'S23: Nonexistent mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S23: Error code must be MISSION_NOT_ACTIVE');
      }
    });

    it('DC-SC9-104-COMPLETED: mission in COMPLETED state -> MISSION_NOT_ACTIVE', () => {
      // DC-SC9-104 REJECTION path: already completed mission
      // Ruling 1: Only REVIEWING -> COMPLETED valid. COMPLETED is not REVIEWING.
      const completedMid = 'completed-mission-sc9';
      seedMission(conn, { id: completedMid, state: 'COMPLETED' });

      const result = engine.submitResult(ctx, validSubmitInput(
        makeMissionId(completedMid),
        'fake-artifact' as ArtifactId,
      ));

      assert.equal(result.ok, false, 'S23: COMPLETED mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S23: Error code must be MISSION_NOT_ACTIVE');
        assert.ok(result.error.message.includes('REVIEWING'),
          'Ruling 1: Message must mention REVIEWING requirement');
      }
    });

    it('DC-SC9-FAILED: mission in FAILED state -> MISSION_NOT_ACTIVE', () => {
      const failedMid = 'failed-mission-sc9';
      seedMission(conn, { id: failedMid, state: 'FAILED' });

      const result = engine.submitResult(ctx, validSubmitInput(
        makeMissionId(failedMid),
        'fake-artifact' as ArtifactId,
      ));

      assert.equal(result.ok, false, 'S23: FAILED mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S23: Error code must be MISSION_NOT_ACTIVE');
      }
    });

    it('DC-SC9-CANCELLED: mission in CANCELLED state -> MISSION_NOT_ACTIVE', () => {
      const cancelledMid = 'cancelled-mission-sc9';
      seedMission(conn, { id: cancelledMid, state: 'CANCELLED' });

      const result = engine.submitResult(ctx, validSubmitInput(
        makeMissionId(cancelledMid),
        'fake-artifact' as ArtifactId,
      ));

      assert.equal(result.ok, false, 'S23: CANCELLED mission must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S23: Error code must be MISSION_NOT_ACTIVE');
      }
    });
  });

  describe('NO_ARTIFACTS', () => {

    it('DC-SC9-NO_ARTIFACTS: empty artifactIds -> NO_ARTIFACTS + state unchanged', () => {
      // NO_ARTIFACTS rejection: artifactIds.length === 0
      const { missionId } = createCompletableMission();
      const stateBefore = getMissionState(conn, missionId);

      const result = engine.submitResult(ctx, {
        missionId,
        summary: 'Test summary',
        confidence: 0.8,
        artifactIds: [],  // Empty!
        unresolvedQuestions: [],
        followupRecommendations: [],
      });

      assert.equal(result.ok, false, 'S23: Empty artifactIds must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'NO_ARTIFACTS',
          'S23: Error code must be NO_ARTIFACTS');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, missionId), stateBefore,
        'A21: Mission state must not change after NO_ARTIFACTS rejection');
    });
  });

  describe('TASKS_INCOMPLETE', () => {

    it('DC-SC9-105-S: all tasks terminal in active graph -> succeeds', () => {
      // DC-SC9-105 SUCCESS: all tasks in terminal state
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));
      assert.equal(result.ok, true, 'S23: All tasks terminal -> succeeds');
    });

    it('DC-SC9-105-R: non-terminal tasks in active graph -> TASKS_INCOMPLETE + state unchanged', () => {
      // DC-SC9-105 REJECTION: incomplete tasks
      const mid = createTestMission();
      const tid = makeTaskId('incomplete-task-1');

      // Create task graph with a task that stays PENDING
      engine.proposeTaskGraph(ctx, {
        missionId: mid,
        tasks: [{
          id: tid,
          description: 'Incomplete task',
          executionMode: 'deterministic',
          estimatedTokens: 100,
          capabilitiesRequired: ['web_search'],
        }],
        dependencies: [],
        objectiveAlignment: 'Test alignment',
      });

      // proposeTaskGraph auto-transitions CREATED -> PLANNING
      transitionMission(mid, 'PLANNING', 'EXECUTING');
      transitionMission(mid, 'EXECUTING', 'REVIEWING');

      // Task stays PENDING — NOT terminal
      const artifactId = createTestArtifact(mid, tid);
      const stateBefore = getMissionState(conn, mid);

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, false, 'S23: Incomplete tasks must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASKS_INCOMPLETE',
          'S23: Error code must be TASKS_INCOMPLETE');
        assert.ok(result.error.message.includes('1'),
          'S23: Message must include count of incomplete tasks');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, mid), stateBefore,
        'A21: Mission state must not change after TASKS_INCOMPLETE');
    });
  });

  describe('Confidence Validation', () => {

    it('DC-SC9-402: confidence > 1.0 -> INVALID_INPUT + state unchanged', () => {
      // FIX: DC-SC9-402 — confidence validation now uses correct error code.
      const { missionId, artifactId } = createCompletableMission();
      const stateBefore = getMissionState(conn, missionId);

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: 1.5,
      }));

      assert.equal(result.ok, false, 'S23: confidence > 1.0 must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'DC-SC9-402 FIX: confidence 1.5 returns INVALID_INPUT (correct code)');
        assert.ok(result.error.message.includes('Confidence'),
          'S23: Message correctly describes the confidence violation');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, missionId), stateBefore,
        'A21: Mission state must not change after confidence rejection');
    });

    it('DC-SC9-402-NEGATIVE: confidence < 0.0 -> INVALID_INPUT', () => {
      // FIX: DC-SC9-402 — confidence validation now uses correct error code.
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: -0.5,
      }));

      assert.equal(result.ok, false, 'S23: confidence < 0.0 must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'DC-SC9-402 FIX: confidence -0.5 returns INVALID_INPUT (correct code)');
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // LIVE DEFECT TESTS
  // ════════════════════════════════════════════════════════════════════════

  describe('LIVE DEFECT Documentation', () => {

    it('DC-SC9-201-R-EXECUTING: submit_result from EXECUTING state -> MISSION_NOT_ACTIVE (Ruling 1)', () => {
      // Ruling 1 FIX: Only REVIEWING -> COMPLETED is valid per §6 MISSION_TRANSITIONS.
      // EXECUTING is NOT a valid state for submit_result.
      const { missionId, artifactId } = createCompletableMission('EXECUTING' as MissionState);

      assert.equal(getMissionState(conn, missionId), 'EXECUTING',
        'Mission must be in EXECUTING state');

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      assert.equal(result.ok, false,
        'Ruling 1: EXECUTING -> COMPLETED must be rejected (only REVIEWING -> COMPLETED valid)');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'Ruling 1: Error code must be MISSION_NOT_ACTIVE');
        assert.ok(result.error.message.includes('REVIEWING'),
          'Ruling 1: Message must mention REVIEWING requirement');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, missionId), 'EXECUTING',
        'A21: Mission state must remain EXECUTING after rejection');
    });

    it('DC-SC9-201-R-CREATED: submit_result from CREATED state -> MISSION_NOT_ACTIVE (Ruling 1)', () => {
      // Ruling 1 FIX: CREATED -> COMPLETED is illegal per S6
      const mid = createTestMission();
      const tid = makeTaskId('created-task');
      const artifactId = createTestArtifact(mid, tid);

      assert.equal(getMissionState(conn, mid), 'CREATED',
        'Mission must be in CREATED state');

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, false,
        'Ruling 1: CREATED -> COMPLETED must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'Ruling 1: Error code must be MISSION_NOT_ACTIVE');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, mid), 'CREATED',
        'A21: Mission state must remain CREATED after rejection');
    });

    it('DC-SC9-401: no UNAUTHORIZED check exists — any agent can submit result', () => {
      // LIVE DEFECT: DC-SC9-401 — UNAUTHORIZED error code declared in type but
      // no authorization check exists. Any caller can submit result for any mission.
      const { missionId, artifactId } = createCompletableMission();

      const differentCtx = createTestOperationContext({
        agentId: 'unauthorized-agent',
        userId: 'unauthorized-user',
      });

      const result = engine.submitResult(differentCtx, validSubmitInput(missionId, artifactId));

      // LIVE DEFECT: DC-SC9-401 — No authorization check
      assert.equal(result.ok, true,
        'LIVE DEFECT: DC-SC9-401 — Unauthorized agent can submit result (no auth check)');
    });

    it('DC-SC9-106: NaN confidence -> INVALID_INPUT (structured error, no crash)', () => {
      // FIX: DC-SC9-106 — NaN now caught by Number.isFinite() guard before INSERT.
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: NaN,
      }));

      assert.equal(result.ok, false,
        'DC-SC9-106 FIX: NaN confidence must return structured error (not crash)');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'DC-SC9-106 FIX: Error code must be INVALID_INPUT');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, missionId), 'REVIEWING',
        'A21: Mission state unchanged after NaN confidence rejection');
    });

    it('DC-SC9-107: empty summary accepted without validation', () => {
      // LIVE DEFECT: DC-SC9-107 — No validation on summary field.
      // Empty string is accepted and stored.
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        summary: '',  // Empty!
      }));

      // LIVE DEFECT: DC-SC9-107 — Empty summary accepted
      assert.equal(result.ok, true,
        'LIVE DEFECT: DC-SC9-107 — Empty summary accepted without validation');

      // Verify empty summary stored
      const missionResult = getMissionResult(conn, missionId);
      assert.notEqual(missionResult, undefined, 'MissionResult must exist');
      assert.equal(missionResult!.summary, '',
        'LIVE DEFECT: DC-SC9-107 — Empty summary stored in core_mission_results');
    });

    it('DC-SC9-301-R: PAUSED state -> MISSION_NOT_ACTIVE (state guard enforced)', () => {
      // FIX: DC-SC9-301 — state-guarded UPDATE + Ruling 1 (only REVIEWING allowed)
      const mid = createTestMission();
      const tid = makeTaskId('paused-task');
      const artifactId = createTestArtifact(mid, tid);

      // Transition to PAUSED (which should NOT allow direct COMPLETED)
      transitionMission(mid, 'CREATED', 'PLANNING');
      transitionMission(mid, 'PLANNING', 'EXECUTING');
      transitionMission(mid, 'EXECUTING', 'PAUSED');

      assert.equal(getMissionState(conn, mid), 'PAUSED', 'Must be PAUSED');

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, false,
        'DC-SC9-301 FIX: PAUSED -> COMPLETED must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'Ruling 1: Error code must be MISSION_NOT_ACTIVE');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, mid), 'PAUSED',
        'A21: Mission state must remain PAUSED');
    });

    it('DC-SC9-302: second submit for same mission throws uncaught PK violation', () => {
      // LIVE DEFECT: DC-SC9-302 — Double submission race.
      // After first successful submit, mission is COMPLETED (terminal).
      // Second submit should return MISSION_NOT_ACTIVE (terminal state check).
      // This test verifies the sequential case (not concurrent).
      const { missionId, artifactId } = createCompletableMission();

      // First submit succeeds
      const first = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));
      assert.equal(first.ok, true, 'First submission must succeed');

      // Second submit for same (now COMPLETED) mission
      const second = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      // Sequential case: second submit hits the active-state check (line 37)
      // which rejects COMPLETED missions with MISSION_NOT_ACTIVE.
      assert.equal(second.ok, false, 'Second submission must be rejected');
      if (!second.ok) {
        assert.equal(second.error.code, 'MISSION_NOT_ACTIVE',
          'DC-SC9-104/302: Second submit returns MISSION_NOT_ACTIVE (mission is COMPLETED)');
      }
    });

    it('DC-SC9-B02: emitLifecycle return value not checked (called as void)', () => {
      // LIVE DEFECT: DC-SC9-B02 — emitLifecycle return value discarded.
      // We cannot directly test the return-error path without mocking,
      // but we verify the event IS emitted on success (the wiring exists,
      // just the return value is not checked).
      const { missionId, artifactId } = createCompletableMission();

      const eventsBefore = countMissionCompletedEvents(conn);
      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));

      assert.equal(result.ok, true, 'Submit must succeed');

      const eventsAfter = countMissionCompletedEvents(conn);
      assert.equal(eventsAfter, eventsBefore + 1,
        'DC-SC9-B02: emitLifecycle IS called (event exists), but return value is not checked');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // OBSERVATION TESTS (Non-A21)
  // ════════════════════════════════════════════════════════════════════════

  describe('Observation Tests', () => {

    it('DC-SC9-101-S: submit_result for own tenant mission -> succeeds', () => {
      // DC-SC9-101 SUCCESS: same-tenant submission
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));
      assert.equal(result.ok, true, 'FM-10: Same-tenant submission succeeds');
    });

    it('DC-SC9-501-R: failed submit (rollback) -> NO audit entry', () => {
      // DC-SC9-501 REJECTION: transaction rollback -> audit entry also rolls back
      const { missionId } = createCompletableMission();

      const auditBefore = countSubmitResultAuditEntries(conn);

      // NO_ARTIFACTS rejection -> no transaction started, no audit
      const result = engine.submitResult(ctx, {
        missionId,
        summary: 'Test',
        confidence: 0.5,
        artifactIds: [],
        unresolvedQuestions: [],
        followupRecommendations: [],
      });

      assert.equal(result.ok, false, 'Must be rejected');

      const auditAfter = countSubmitResultAuditEntries(conn);
      assert.equal(auditAfter, auditBefore,
        'DC-SC9-501: No audit entry after rejection (never entered transaction)');
    });

    it('DC-SC9-502-R: failed submit -> NO MISSION_COMPLETED event', () => {
      // DC-SC9-502 REJECTION: no event if validation fails before transaction
      const { missionId } = createCompletableMission();

      const eventsBefore = countMissionCompletedEvents(conn);

      engine.submitResult(ctx, {
        missionId,
        summary: 'Test',
        confidence: 0.5,
        artifactIds: [],
        unresolvedQuestions: [],
        followupRecommendations: [],
      });

      const eventsAfter = countMissionCompletedEvents(conn);
      assert.equal(eventsAfter, eventsBefore,
        'DC-SC9-502: No event after rejection (never entered transaction)');
    });

    it('MissionResult stores artifact_ids as JSON array', () => {
      // Verify artifact IDs are stored correctly
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId));
      assert.equal(result.ok, true, 'Submit must succeed');

      const missionResult = getMissionResult(conn, missionId);
      assert.notEqual(missionResult, undefined, 'MissionResult must exist');

      const storedArtifacts = JSON.parse(missionResult!.artifact_ids);
      assert.equal(Array.isArray(storedArtifacts), true,
        'artifact_ids must be stored as JSON array');
      assert.equal(storedArtifacts.length, 1,
        'artifact_ids must contain exactly 1 artifact');
      assert.equal(storedArtifacts[0], artifactId,
        'artifact_ids[0] must match the input artifactId');
    });

    it('MissionResult stores unresolvedQuestions and followupRecommendations', () => {
      // Verify auxiliary fields are preserved
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        unresolvedQuestions: ['What about edge case X?'],
        followupRecommendations: ['Investigate Y'],
      }));
      assert.equal(result.ok, true, 'Submit must succeed');

      const row = conn.get<{
        unresolved_questions: string;
        followup_recommendations: string;
      }>(
        'SELECT unresolved_questions, followup_recommendations FROM core_mission_results WHERE mission_id = ?',
        [missionId],
      );
      assert.notEqual(row, undefined, 'MissionResult must exist');

      const questions = JSON.parse(row!.unresolved_questions);
      const recs = JSON.parse(row!.followup_recommendations);

      assert.deepStrictEqual(questions, ['What about edge case X?'],
        'unresolvedQuestions must be preserved');
      assert.deepStrictEqual(recs, ['Investigate Y'],
        'followupRecommendations must be preserved');
    });

    it('DC-SC9-204: NaN confidence rejected at application level (no transaction entered)', () => {
      // DC-SC9-204 updated: NaN confidence is now caught by Number.isFinite()
      // guard BEFORE the transaction, so no transaction rollback occurs.
      // The test verifies state is unchanged after rejection.
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: NaN,
      }));

      assert.equal(result.ok, false,
        'DC-SC9-204: NaN confidence must be rejected');

      // Verify mission state unchanged (rejected before transaction)
      assert.equal(getMissionState(conn, missionId), 'REVIEWING',
        'DC-SC9-204: Mission state must be unchanged after rejection');

      // Verify no MissionResult created
      const missionResult = getMissionResult(conn, missionId);
      assert.equal(missionResult, undefined,
        'DC-SC9-204: No MissionResult after rejection');

      // Verify no audit entry
      const auditRow = conn.get<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'submit_result'",
      );
      assert.equal(auditRow?.cnt ?? 0, 0,
        'DC-SC9-204: No submit_result audit entry after rejection');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // F-002 FIX: Discriminative test for compactSubtree() wiring
  // ════════════════════════════════════════════════════════════════════════

  describe('F-002: compactSubtree() wiring verification', () => {

    it('DC-SC9-F002: parent submit_result -> completed children marked compacted=1 (I-21 eager compaction)', () => {
      // F-002 REMEDIATION: M13 survived all 32 tests because DC-SC9-B03-S
      // only asserted result.ok === true. This test creates a parent-child
      // hierarchy, completes the child, then submits result for the parent.
      // After submit, compactSubtree (submit_result.ts:126) should mark
      // the completed child as compacted=1 (bounded_cognition.ts:70-74).
      //
      // DISCRIMINATIVE: Would fail if compactSubtree() call at line 126 is removed.
      // Without compaction, child.compacted stays 0.

      // 1. Create parent mission through facade
      const parentMid = createTestMission();

      // 2. Create child mission under the parent via seedMission (direct DB insert)
      //    Using seedMission avoids budget allocation complexity — we only need
      //    the parent-child relationship in core_missions for compaction.
      const childMidStr = 'child-for-compaction-test';
      seedMission(conn, {
        id: childMidStr,
        parentId: parentMid as string,
        state: 'COMPLETED',
        capabilities: ['web_search'],
      });
      const childMid = makeMissionId(childMidStr);

      // 3. Verify child is COMPLETED and NOT yet compacted
      assert.equal(getMissionState(conn, childMid), 'COMPLETED',
        'Child mission must be COMPLETED');
      const childBeforeCompaction = conn.get<{ compacted: number }>(
        'SELECT compacted FROM core_missions WHERE id = ?',
        [childMid],
      );
      assert.equal(childBeforeCompaction?.compacted, 0,
        'Child must have compacted=0 before parent submit');

      // 4. Prepare parent for submit_result
      //    Create task graph for parent, complete tasks, create artifact
      const parentTid = makeTaskId('parent-task-compact');
      engine.proposeTaskGraph(ctx, {
        missionId: parentMid,
        tasks: [{
          id: parentTid,
          description: 'Parent task',
          executionMode: 'deterministic',
          estimatedTokens: 100,
          capabilitiesRequired: ['web_search'],
        }],
        dependencies: [],
        objectiveAlignment: 'Aligned',
      });

      // proposeTaskGraph auto-transitions CREATED -> PLANNING
      transitionMission(parentMid, 'PLANNING', 'EXECUTING');
      transitionMission(parentMid, 'EXECUTING', 'REVIEWING');

      // Complete the parent task
      conn.run(
        `UPDATE core_tasks SET state = 'COMPLETED', updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), parentTid],
      );

      // Create artifact for parent
      const parentArtifactId = createTestArtifact(parentMid, parentTid);

      // 5. Submit result for parent (triggers compactSubtree at line 126)
      const submitResult = engine.submitResult(ctx, validSubmitInput(parentMid, parentArtifactId));
      assert.equal(submitResult.ok, true,
        'Parent submit_result must succeed');

      // 6. DISCRIMINATIVE ASSERTION: child must now be marked compacted=1
      //    compactSubtree (bounded_cognition.ts:70-74) marks completed children
      //    with compacted=1. If compactSubtree() is removed from submit_result.ts:126,
      //    child.compacted remains 0 and this assertion FAILS.
      const childAfterCompaction = conn.get<{ compacted: number }>(
        'SELECT compacted FROM core_missions WHERE id = ?',
        [childMid],
      );
      assert.equal(childAfterCompaction?.compacted, 1,
        'F-002: Child mission must be compacted=1 after parent submit_result. ' +
        'If this fails, compactSubtree() was not called at submit_result.ts:126.');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // F-003/RULING GUARD TESTS — NaN/Infinity confidence + Ruling reversals
  // ════════════════════════════════════════════════════════════════════════

  describe('F-003: NaN/Infinity confidence guard', () => {

    it('DC-SC9-106-S: confidence = 0.5 -> stored correctly', () => {
      // DC-SC9-106 SUCCESS: valid mid-range confidence
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: 0.5,
      }));

      assert.equal(result.ok, true,
        'F-003: Confidence 0.5 must succeed');

      const missionResult = getMissionResult(conn, missionId);
      assert.notEqual(missionResult, undefined, 'MissionResult must exist');
      assert.equal(missionResult!.confidence, 0.5,
        'F-003: Stored confidence must be 0.5');
    });

    it('DC-SC9-106-R-INFINITY: confidence = Infinity -> INVALID_INPUT', () => {
      // DC-SC9-106 REJECTION: Infinity caught by Number.isFinite() guard
      const { missionId, artifactId } = createCompletableMission();
      const stateBefore = getMissionState(conn, missionId);

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: Infinity,
      }));

      assert.equal(result.ok, false,
        'F-003: Infinity confidence must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-003: Error code must be INVALID_INPUT');
        assert.ok(result.error.message.includes('finite'),
          'F-003: Message must mention finite requirement');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, missionId), stateBefore,
        'A21: Mission state must not change after Infinity confidence rejection');
    });

    it('DC-SC9-106-R-NEG-INFINITY: confidence = -Infinity -> INVALID_INPUT', () => {
      // DC-SC9-106 REJECTION: -Infinity caught by Number.isFinite() guard
      const { missionId, artifactId } = createCompletableMission();

      const result = engine.submitResult(ctx, validSubmitInput(missionId, artifactId, {
        confidence: -Infinity,
      }));

      assert.equal(result.ok, false,
        'F-003: -Infinity confidence must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'F-003: Error code must be INVALID_INPUT');
      }
    });
  });

  describe('BD-SC9-003: FAILED tasks excluded from completion set', () => {

    it('BD-SC9-003-R-ALL-FAILED: all tasks FAILED -> TASKS_INCOMPLETE', () => {
      // BD-SC9-003 REJECTION: FAILED is NOT in {COMPLETED, CANCELLED}
      const mid = createTestMission();
      const tid = makeTaskId('failed-task-1');

      // Create task graph with one task
      engine.proposeTaskGraph(ctx, {
        missionId: mid,
        tasks: [{
          id: tid,
          description: 'Task that will fail',
          executionMode: 'deterministic',
          estimatedTokens: 100,
          capabilitiesRequired: ['web_search'],
        }],
        dependencies: [],
        objectiveAlignment: 'Test alignment',
      });

      // Transition to REVIEWING
      transitionMission(mid, 'PLANNING', 'EXECUTING');
      transitionMission(mid, 'EXECUTING', 'REVIEWING');

      // Mark task as FAILED
      conn.run(
        `UPDATE core_tasks SET state = 'FAILED', updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), tid],
      );

      // Create artifact
      const artifactId = createTestArtifact(mid, tid);

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, false,
        'BD-SC9-003: All-FAILED tasks must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASKS_INCOMPLETE',
          'BD-SC9-003: Error code must be TASKS_INCOMPLETE');
        assert.ok(result.error.message.includes('1'),
          'BD-SC9-003: Message must include count of incomplete tasks');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, mid), 'REVIEWING',
        'A21: Mission state must remain REVIEWING after rejection');
    });

    it('BD-SC9-003-R-MIX: COMPLETED + FAILED tasks -> TASKS_INCOMPLETE', () => {
      // BD-SC9-003 REJECTION: mix of COMPLETED and FAILED — FAILED prevents completion
      const mid = createTestMission();
      const tid1 = makeTaskId('completed-task-mix');
      const tid2 = makeTaskId('failed-task-mix');

      // Create task graph with two tasks
      engine.proposeTaskGraph(ctx, {
        missionId: mid,
        tasks: [
          {
            id: tid1,
            description: 'Task that will complete',
            executionMode: 'deterministic',
            estimatedTokens: 100,
            capabilitiesRequired: ['web_search'],
          },
          {
            id: tid2,
            description: 'Task that will fail',
            executionMode: 'deterministic',
            estimatedTokens: 100,
            capabilitiesRequired: ['web_search'],
          },
        ],
        dependencies: [],
        objectiveAlignment: 'Test alignment',
      });

      // Transition to REVIEWING
      transitionMission(mid, 'PLANNING', 'EXECUTING');
      transitionMission(mid, 'EXECUTING', 'REVIEWING');

      // Mark first task COMPLETED, second FAILED
      const now = new Date().toISOString();
      conn.run(
        `UPDATE core_tasks SET state = 'COMPLETED', updated_at = ? WHERE id = ?`,
        [now, tid1],
      );
      conn.run(
        `UPDATE core_tasks SET state = 'FAILED', updated_at = ? WHERE id = ?`,
        [now, tid2],
      );

      // Create artifact
      const artifactId = createTestArtifact(mid, tid1);

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, false,
        'BD-SC9-003: COMPLETED + FAILED mix must be rejected');
      if (!result.ok) {
        assert.equal(result.error.code, 'TASKS_INCOMPLETE',
          'BD-SC9-003: Error code must be TASKS_INCOMPLETE');
        assert.ok(result.error.message.includes('1'),
          'BD-SC9-003: One FAILED task counts as incomplete');
      }

      // A21: state unchanged
      assert.equal(getMissionState(conn, mid), 'REVIEWING',
        'A21: Mission state must remain REVIEWING after rejection');
    });

    it('BD-SC9-003-S: COMPLETED + CANCELLED tasks -> succeeds (both in completion set)', () => {
      // BD-SC9-003 SUCCESS: COMPLETED and CANCELLED are both in the completion set
      const mid = createTestMission();
      const tid1 = makeTaskId('completed-task-cc');
      const tid2 = makeTaskId('cancelled-task-cc');

      // Create task graph with two tasks
      engine.proposeTaskGraph(ctx, {
        missionId: mid,
        tasks: [
          {
            id: tid1,
            description: 'Task that completes',
            executionMode: 'deterministic',
            estimatedTokens: 100,
            capabilitiesRequired: ['web_search'],
          },
          {
            id: tid2,
            description: 'Task that gets cancelled',
            executionMode: 'deterministic',
            estimatedTokens: 100,
            capabilitiesRequired: ['web_search'],
          },
        ],
        dependencies: [],
        objectiveAlignment: 'Test alignment',
      });

      // Transition to REVIEWING
      transitionMission(mid, 'PLANNING', 'EXECUTING');
      transitionMission(mid, 'EXECUTING', 'REVIEWING');

      // Mark first task COMPLETED, second CANCELLED
      const now = new Date().toISOString();
      conn.run(
        `UPDATE core_tasks SET state = 'COMPLETED', updated_at = ? WHERE id = ?`,
        [now, tid1],
      );
      conn.run(
        `UPDATE core_tasks SET state = 'CANCELLED', updated_at = ? WHERE id = ?`,
        [now, tid2],
      );

      // Create artifact
      const artifactId = createTestArtifact(mid, tid1);

      const result = engine.submitResult(ctx, validSubmitInput(mid, artifactId));

      assert.equal(result.ok, true,
        'BD-SC9-003: COMPLETED + CANCELLED must succeed (both in completion set)');
      if (!result.ok) return;

      assert.equal(result.value.missionState, 'COMPLETED',
        'BD-SC9-003: Mission state must be COMPLETED');
    });
  });
});
