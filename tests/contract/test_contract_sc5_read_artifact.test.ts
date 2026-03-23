/**
 * SC-5 Contract Tests: read_artifact -- Facade-Level Verification
 * S ref: S19 (read_artifact), I-23 (dependency tracking), I-03 (atomic audit)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT ArtifactStore.read directly)
 *
 * SC-5 requires a prerequisite artifact, so each test must first:
 *   1. Create a mission via engine.proposeMission()
 *   2. Create a task graph via engine.proposeTaskGraph()
 *   3. Create an artifact via engine.createArtifact()
 *   4. Then test engine.readArtifact()
 *
 * IMPORTANT: The facade does NOT pass readingMissionId, so I-23 dependency
 * tracking is NOT exercised through engine.readArtifact(). Tests verify only
 * what IS exercised through the facade.
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
import type { DatabaseConnection, OperationContext, MissionId, TaskId, ArtifactId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  ProposeTaskGraphInput,
  CreateArtifactInput,
  ReadArtifactInput,
  TaskDefinition,
} from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;

/**
 * Setup: create a fresh in-memory database with full schema,
 * then create the orchestration engine through createOrchestration().
 */
function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** S15: Create a mission through the facade for SC-5 tests to operate on */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for artifact reading',
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

/** S16: Create a task graph with a single task, return the taskId */
function createTestGraphWithTask(mid: MissionId, taskIdStr: string): TaskId {
  const tid = taskId(taskIdStr);
  const tasks: TaskDefinition[] = [{
    id: tid,
    description: `Task ${taskIdStr}`,
    executionMode: 'deterministic',
    estimatedTokens: 100,
    capabilitiesRequired: [],
  }];
  const input: ProposeTaskGraphInput = {
    missionId: mid,
    tasks,
    dependencies: [],
    objectiveAlignment: 'Task graph for SC-5 artifact tests',
  };
  const result = engine.proposeTaskGraph(ctx, input);
  assert.equal(result.ok, true, 'Test graph creation must succeed');
  if (!result.ok) throw new Error('Failed to create test graph');
  return tid;
}

/** S18: Construct a valid CreateArtifactInput */
function validArtifactInput(
  mid: MissionId,
  tid: TaskId,
  overrides: Partial<CreateArtifactInput> = {},
): CreateArtifactInput {
  return {
    missionId: mid,
    name: 'test-artifact',
    type: 'report',
    format: 'markdown',
    content: '# Test artifact content\n\nThis is test data.',
    sourceTaskId: tid,
    parentArtifactId: null,
    metadata: { purpose: 'test' },
    ...overrides,
  };
}

/**
 * Create a prerequisite artifact through the facade.
 * Returns the artifactId for subsequent read tests.
 */
function createPrerequisiteArtifact(
  mid: MissionId,
  tid: TaskId,
  overrides: Partial<CreateArtifactInput> = {},
): ArtifactId {
  const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, overrides));
  assert.equal(result.ok, true, 'Prerequisite artifact creation must succeed');
  if (!result.ok) throw new Error('Failed to create prerequisite artifact');
  return result.value.artifactId;
}

// ─── A21 State-Unchanged Verification ───

/** Count ARTIFACT_READ events */
function countArtifactReadEvents(c: DatabaseConnection): number {
  return c.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'ARTIFACT_READ'",
  )?.cnt ?? 0;
}

/** Count all events */
function countAllEvents(c: DatabaseConnection): number {
  return c.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM core_events_log',
  )?.cnt ?? 0;
}

/** Snapshot state before a rejection test */
function snapshotState(c: DatabaseConnection): {
  readEvents: number;
  totalEvents: number;
} {
  return {
    readEvents: countArtifactReadEvents(c),
    totalEvents: countAllEvents(c),
  };
}

/**
 * A21: Assert state unchanged after a rejection.
 * For read_artifact rejections: no new ARTIFACT_READ events,
 * no new events of any kind (the read syscall emits nothing on failure).
 */
function assertStateUnchanged(
  c: DatabaseConnection,
  before: ReturnType<typeof snapshotState>,
  label: string,
): void {
  const afterReadEvents = countArtifactReadEvents(c);
  assert.equal(afterReadEvents, before.readEvents,
    `${label}: ARTIFACT_READ event count must not change after rejection (before=${before.readEvents}, after=${afterReadEvents})`);

  const afterTotalEvents = countAllEvents(c);
  assert.equal(afterTotalEvents, before.totalEvents,
    `${label}: Total event count must not change after rejection (before=${before.totalEvents}, after=${afterTotalEvents})`);
}

describe('SC-5 Contract: read_artifact (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('SC5-SUCCESS-READ-BY-VERSION: read artifact with explicit version=1 -- returns correct artifact data', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-task-1');
      const artifactId = createPrerequisiteArtifact(mid, tid, {
        name: 'read-by-version',
        type: 'report',
        format: 'markdown',
        content: '# Explicit version read test',
        metadata: { readTest: true },
      });

      const readInput: ReadArtifactInput = {
        artifactId,
        version: 1,
      };
      const result = engine.readArtifact(ctx, readInput);

      assert.equal(result.ok, true, 'S19: Read with explicit version=1 must succeed');
      if (!result.ok) return;

      const artifact = result.value.artifact;
      assert.equal(artifact.id, artifactId, 'S19: Returned artifact.id must match requested artifactId');
      assert.equal(artifact.version, 1, 'S19: Returned artifact.version must be 1');
      assert.equal(artifact.missionId, mid, 'S19: Returned artifact.missionId must match');
      assert.equal(artifact.name, 'read-by-version', 'S19: Returned artifact.name must match created name');
      assert.equal(artifact.type, 'report', 'S19: Returned artifact.type must match created type');
      assert.equal(artifact.format, 'markdown', 'S19: Returned artifact.format must match created format');
      assert.equal(artifact.lifecycleState, 'ACTIVE', 'S19: Returned artifact.lifecycleState must be ACTIVE');
      assert.equal(artifact.metadata.readTest, true, 'S19: Returned artifact.metadata must match created metadata');
    });

    it('SC5-SUCCESS-READ-LATEST: create artifact with 2 versions, read with version=latest -- returns version 2', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-task-2');

      // Version 1
      const v1Result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'versioned-read',
        content: 'Version 1 content',
      }));
      assert.equal(v1Result.ok, true, 'S18: First artifact version must succeed');
      if (!v1Result.ok) return;
      const artifactId = v1Result.value.artifactId;

      // Version 2 (revision)
      const v2Result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'versioned-read',
        content: 'Version 2 content -- revised',
        parentArtifactId: artifactId,
      }));
      assert.equal(v2Result.ok, true, 'S18: Revision creation must succeed');
      if (!v2Result.ok) return;
      assert.equal(v2Result.value.version, 2, 'S18: Revision version must be 2');

      // Read with version='latest'
      const readInput: ReadArtifactInput = {
        artifactId,
        version: 'latest',
      };
      const result = engine.readArtifact(ctx, readInput);

      assert.equal(result.ok, true, 'S19: Read with version=latest must succeed');
      if (!result.ok) return;

      assert.equal(result.value.artifact.id, artifactId, 'S19: Latest read must return same artifactId');
      assert.equal(result.value.artifact.version, 2, 'S19: Latest read must return version 2 (highest)');
    });

    it('SC5-SUCCESS-READ-EXPLICIT-VERSION-DISCRIMINATIVE: create 2 versions, read version=1 explicitly -- returns version 1 not latest', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-task-disc');

      // Create version 1
      const v1Result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'disc-artifact',
        content: 'Version 1 specific content',
      }));
      assert.equal(v1Result.ok, true, 'S18: V1 creation must succeed');
      if (!v1Result.ok) return;
      const artifactId = v1Result.value.artifactId;

      // Create version 2 (revision)
      const v2Result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'disc-artifact',
        content: 'Version 2 revised content',
        parentArtifactId: artifactId,
      }));
      assert.equal(v2Result.ok, true, 'S18: V2 creation must succeed');
      if (!v2Result.ok) return;
      assert.equal(v2Result.value.version, 2, 'S18: V2 must be version 2');

      // Read EXPLICIT version=1 — must return version 1, NOT latest (version 2)
      const result = engine.readArtifact(ctx, { artifactId, version: 1 });

      assert.equal(result.ok, true, 'S19: Read with explicit version=1 must succeed');
      if (!result.ok) return;

      assert.equal(result.value.artifact.version, 1,
        'S19: Explicit version=1 read must return version 1, not latest');

      // Verify content is version 1's content, not version 2's
      const contentStr = Buffer.isBuffer(result.value.artifact.content)
        ? result.value.artifact.content.toString('utf-8')
        : result.value.artifact.content;
      assert.equal(contentStr, 'Version 1 specific content',
        'S19: Content must be version 1 content, proving version selection is discriminative');
    });

    it('SC5-SUCCESS-RELEVANCE-DECAY-RESET: create artifact, set relevance_decay to 5 via SQL, read -- relevance_decay reset to 0', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-task-3');
      const artifactId = createPrerequisiteArtifact(mid, tid, {
        name: 'decay-reset-artifact',
      });

      // Set relevance_decay to 5 via direct SQL (simulating time-based decay)
      conn.run(
        'UPDATE core_artifacts SET relevance_decay = 5 WHERE id = ? AND version = 1',
        [artifactId],
      );

      // Verify precondition: decay is 5 before read
      const beforeRow = conn.get<{ relevance_decay: number }>(
        'SELECT relevance_decay FROM core_artifacts WHERE id = ? AND version = 1',
        [artifactId],
      );
      assert.equal(beforeRow?.relevance_decay, 5, 'Precondition: relevance_decay must be 5 before read');

      // Read the artifact through the facade
      const result = engine.readArtifact(ctx, { artifactId, version: 1 });
      assert.equal(result.ok, true, 'S19: Read must succeed');

      // Verify relevance_decay was reset to 0
      const afterRow = conn.get<{ relevance_decay: number }>(
        'SELECT relevance_decay FROM core_artifacts WHERE id = ? AND version = 1',
        [artifactId],
      );
      assert.equal(afterRow?.relevance_decay, 0,
        'S19: relevance_decay must be reset to 0 after read (side effect per spec)');
    });

    it('SC5-SUCCESS-ARTIFACT-READ-EVENT: read artifact -- ARTIFACT_READ event emitted with correct payload', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-task-4');
      const artifactId = createPrerequisiteArtifact(mid, tid, {
        name: 'event-test-artifact',
      });

      const readEventsBefore = countArtifactReadEvents(conn);

      const result = engine.readArtifact(ctx, { artifactId, version: 1 });
      assert.equal(result.ok, true, 'S19: Read must succeed');

      // Verify exactly one new ARTIFACT_READ event
      const readEventsAfter = countArtifactReadEvents(conn);
      assert.equal(readEventsAfter, readEventsBefore + 1,
        'S19: Exactly one ARTIFACT_READ event must be emitted on read');

      // Verify event payload shape
      const event = conn.get<{
        type: string; scope: string; propagation: string;
        mission_id: string; emitted_by: string; payload_json: string;
      }>(
        "SELECT type, scope, propagation, mission_id, emitted_by, payload_json FROM core_events_log WHERE type = 'ARTIFACT_READ' AND mission_id = ? ORDER BY rowid DESC LIMIT 1",
        [mid],
      );

      assert.notEqual(event, undefined, 'S19: ARTIFACT_READ event must exist in events log');
      if (!event) return;

      assert.equal(event.type, 'ARTIFACT_READ', 'S19: Event type must be ARTIFACT_READ');
      assert.equal(event.scope, 'system', 'S19: Lifecycle events have system scope');
      assert.equal(event.propagation, 'up', 'S19: Lifecycle event propagation must be up');
      assert.equal(event.mission_id, mid, 'S19: Event must reference the correct mission');
      assert.equal(event.emitted_by, 'orchestrator', 'S19: Lifecycle events emitted by orchestrator');

      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      assert.equal(payload.artifactId, artifactId,
        'S19: Event payload.artifactId must match the read artifact');
      assert.equal(payload.version, 1,
        'S19: Event payload.version must match the read version');
      assert.equal(payload.readingMissionId, null,
        'S19: Event payload.readingMissionId must be null (facade does not pass readingMissionId)');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS -- A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths -- A21 Rejection Verification', () => {

    it('SC5-ERR-NOT-FOUND: read nonexistent artifactId -- NOT_FOUND + state unchanged', () => {
      // Ensure at least one mission exists so the DB is not empty
      createTestMission();

      const fakeArtifactId = 'nonexistent-artifact-xyz' as ArtifactId;
      const before = snapshotState(conn);

      const result = engine.readArtifact(ctx, {
        artifactId: fakeArtifactId,
        version: 1,
      });

      assert.equal(result.ok, false, 'S19: Must reject read for nonexistent artifactId');
      if (!result.ok) {
        assert.equal(result.error.code, 'NOT_FOUND',
          'S19: Error code must be NOT_FOUND for nonexistent artifact');
      }

      assertStateUnchanged(conn, before, 'NOT_FOUND');
    });

    it('SC5-ERR-DELETED: create artifact, UPDATE lifecycle_state to DELETED, read -- ARCHIVED + state unchanged', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-deleted-1');
      const artifactId = createPrerequisiteArtifact(mid, tid, {
        name: 'deleted-artifact',
      });

      // Transition to DELETED via direct SQL
      conn.run(
        'UPDATE core_artifacts SET lifecycle_state = ? WHERE id = ? AND version = 1',
        ['DELETED', artifactId],
      );

      const before = snapshotState(conn);

      const result = engine.readArtifact(ctx, { artifactId, version: 1 });

      assert.equal(result.ok, false, 'S19: Must reject read for DELETED artifact');
      if (!result.ok) {
        assert.equal(result.error.code, 'ARCHIVED',
          'S19: Error code must be ARCHIVED for DELETED artifact (same guard covers both)');
      }

      assertStateUnchanged(conn, before, 'DELETED');
    });

    it('SC5-ERR-ARCHIVED: create artifact, UPDATE lifecycle_state to ARCHIVED, read -- ARCHIVED + state unchanged', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-archived-1');
      const artifactId = createPrerequisiteArtifact(mid, tid, {
        name: 'archived-artifact',
      });

      // Transition to ARCHIVED via direct SQL (lifecycle_state is mutable per migration design)
      conn.run(
        'UPDATE core_artifacts SET lifecycle_state = ? WHERE id = ? AND version = 1',
        ['ARCHIVED', artifactId],
      );

      // Verify precondition
      const row = conn.get<{ lifecycle_state: string }>(
        'SELECT lifecycle_state FROM core_artifacts WHERE id = ? AND version = 1',
        [artifactId],
      );
      assert.equal(row?.lifecycle_state, 'ARCHIVED', 'Precondition: lifecycle_state must be ARCHIVED');

      const before = snapshotState(conn);

      const result = engine.readArtifact(ctx, {
        artifactId,
        version: 1,
      });

      assert.equal(result.ok, false, 'S19: Must reject read for ARCHIVED artifact');
      if (!result.ok) {
        assert.equal(result.error.code, 'ARCHIVED',
          'S19: Error code must be ARCHIVED for archived artifact');
      }

      assertStateUnchanged(conn, before, 'ARCHIVED');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS -- Facade-Level Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition -- Facade-Level Verification', () => {

    it('SC5-SUCCESS-CONTENT-PRESERVED: create artifact with known string content, read -- content matches', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'read-content-1');
      const knownContent = 'This is precise content for round-trip verification. Special chars: <>&"\'';
      const artifactId = createPrerequisiteArtifact(mid, tid, {
        name: 'content-preservation-artifact',
        content: knownContent,
      });

      const result = engine.readArtifact(ctx, { artifactId, version: 1 });
      assert.equal(result.ok, true, 'S19: Read must succeed');
      if (!result.ok) return;

      const returnedContent = result.value.artifact.content;
      // Content may be Buffer or string depending on store implementation
      const contentStr = Buffer.isBuffer(returnedContent)
        ? returnedContent.toString('utf-8')
        : returnedContent;

      assert.equal(contentStr, knownContent,
        'S19: Read artifact content must exactly match the content provided at creation (round-trip fidelity)');
    });
  });
});
