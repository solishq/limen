/**
 * SC-4 Contract Tests: create_artifact -- Facade-Level Verification
 * S ref: S18 (create_artifact), S8 (artifact workspace), I-03 (atomic audit),
 *        I-19 (immutability), I-20 (artifact limits), CF-013 (content size)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT ArtifactStore.create directly)
 *
 * SC-4 requires a sourceTaskId, so each test must first:
 *   1. Create a mission via engine.proposeMission()
 *   2. Create a task graph via engine.proposeTaskGraph()
 *   3. Then test engine.createArtifact()
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
  TaskDefinition,
} from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;

/**
 * Setup: create a fresh in-memory database with full schema,
 * then create the orchestration engine through createOrchestration().
 * SC-4 does NOT need the substrate scheduler (unlike SC-3).
 */
function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** S15: Create a mission through the facade for SC-4 tests to operate on */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for artifact creation',
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
    objectiveAlignment: 'Task graph for SC-4 artifact tests',
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

// ─── A21 State-Unchanged Verification ───

/** Count artifacts in core_artifacts */
function countArtifacts(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM core_artifacts',
  )?.cnt ?? 0;
}

/** Count ARTIFACT_CREATED events */
function countArtifactCreatedEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_events_log WHERE type = 'ARTIFACT_CREATED'",
  )?.cnt ?? 0;
}

/** Count create_artifact audit entries */
function countCreateArtifactAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'create_artifact'",
  )?.cnt ?? 0;
}

/** Snapshot state before a rejection test */
function snapshotState(conn: DatabaseConnection): {
  artifactCount: number;
  createdEvents: number;
  auditEntries: number;
} {
  return {
    artifactCount: countArtifacts(conn),
    createdEvents: countArtifactCreatedEvents(conn),
    auditEntries: countCreateArtifactAuditEntries(conn),
  };
}

/**
 * A21: Assert state unchanged after a rejection.
 * Verifies: no new artifacts, no new ARTIFACT_CREATED events,
 * no new create_artifact audit entries.
 */
function assertStateUnchanged(
  conn: DatabaseConnection,
  before: ReturnType<typeof snapshotState>,
  label: string,
): void {
  const afterArtifacts = countArtifacts(conn);
  assert.equal(afterArtifacts, before.artifactCount,
    `${label}: Artifact count should not change after rejection (before=${before.artifactCount}, after=${afterArtifacts})`);

  const afterEvents = countArtifactCreatedEvents(conn);
  assert.equal(afterEvents, before.createdEvents,
    `${label}: ARTIFACT_CREATED event count should not change after rejection (before=${before.createdEvents}, after=${afterEvents})`);

  const afterAudits = countCreateArtifactAuditEntries(conn);
  assert.equal(afterAudits, before.auditEntries,
    `${label}: create_artifact audit count should not change after rejection (before=${before.auditEntries}, after=${afterAudits})`);
}

describe('SC-4 Contract: create_artifact (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('SC4-SUCCESS-NEW: create new artifact (parentArtifactId=null) -- returns artifactId, version=1', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-task-1');

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid));

      assert.equal(result.ok, true, 'S18: New artifact creation must succeed');
      if (!result.ok) return;

      assert.equal(typeof result.value.artifactId, 'string', 'S18: artifactId must be a string');
      assert.ok((result.value.artifactId as string).length > 0, 'S18: artifactId must be non-empty');
      assert.equal(result.value.version, 1, 'S18: First version of a new artifact must be 1');
    });

    it('SC4-SUCCESS-REVISION: create artifact, then revision (parentArtifactId=first) -- same artifactId, version=2', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-task-2');

      // Create first artifact
      const first = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'versioned-artifact',
        content: 'Version 1 content',
      }));
      assert.equal(first.ok, true, 'S18: First artifact creation must succeed');
      if (!first.ok) return;
      assert.equal(first.value.version, 1, 'S18: First version must be 1');

      // Create revision referencing the first artifact
      const revision = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'versioned-artifact',
        content: 'Version 2 content — revised',
        parentArtifactId: first.value.artifactId,
      }));

      assert.equal(revision.ok, true, 'S18: Revision creation must succeed');
      if (!revision.ok) return;

      assert.equal(revision.value.artifactId, first.value.artifactId,
        'SD-03: Revision must share the same artifactId as the parent (composite PK)');
      assert.equal(revision.value.version, 2,
        'SD-03: Second version of an artifact must be 2');
    });

    it('SC4-SUCCESS-SIDEEFFECTS: verify all side effects -- core_artifacts row, ARTIFACT_CREATED event, audit entry, lifecycle_state=ACTIVE', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-task-3');

      // Capture before counts
      const artifactsBefore = countArtifacts(conn);
      const eventsBefore = countArtifactCreatedEvents(conn);
      const auditsBefore = countCreateArtifactAuditEntries(conn);

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'side-effect-artifact',
        type: 'data',
        format: 'json',
        content: '{"key": "value"}',
        metadata: { source: 'test', version: 1 },
      }));
      assert.equal(result.ok, true, 'S18: Artifact creation must succeed');
      if (!result.ok) return;

      // 1. core_artifacts row exists with correct fields
      const row = conn.get<{
        id: string; version: number; mission_id: string; name: string;
        type: string; format: string; lifecycle_state: string;
        source_task_id: string; parent_artifact_id: string | null;
        relevance_decay: number; metadata_json: string;
      }>(
        'SELECT id, version, mission_id, name, type, format, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json FROM core_artifacts WHERE id = ? AND version = ?',
        [result.value.artifactId, result.value.version],
      );
      assert.ok(row, 'S18: core_artifacts row must exist');
      assert.equal(row.id, result.value.artifactId, 'S18: Row id must match returned artifactId');
      assert.equal(row.version, 1, 'S18: Row version must be 1 for new artifact');
      assert.equal(row.mission_id, mid, 'S18: Row mission_id must match');
      assert.equal(row.name, 'side-effect-artifact', 'S18: Row name must match input');
      assert.equal(row.type, 'data', 'S18: Row type must match input');
      assert.equal(row.format, 'json', 'S18: Row format must match input');
      assert.equal(row.lifecycle_state, 'ACTIVE', 'S18: lifecycle_state must start as ACTIVE');
      assert.equal(row.source_task_id, tid, 'S18: source_task_id must match input');
      assert.equal(row.parent_artifact_id, null, 'S18: parent_artifact_id must be null for new artifact');
      assert.equal(row.relevance_decay, 0, 'FM-15: relevance_decay must start at 0');

      const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
      assert.equal(metadata.source, 'test', 'S18: metadata must be stored as JSON');
      assert.equal(metadata.version, 1, 'S18: metadata values must be preserved');

      // 2. ARTIFACT_CREATED event emitted (exactly one new)
      const eventsAfter = countArtifactCreatedEvents(conn);
      assert.equal(eventsAfter, eventsBefore + 1,
        'S18: Exactly one ARTIFACT_CREATED event must be emitted');

      // 3. Audit entry for create_artifact (exactly one new)
      const auditsAfter = countCreateArtifactAuditEntries(conn);
      assert.equal(auditsAfter, auditsBefore + 1,
        'I-03: Exactly one create_artifact audit entry must exist');

      // 4. Artifact count incremented
      const artifactsAfter = countArtifacts(conn);
      assert.equal(artifactsAfter, artifactsBefore + 1,
        'S18: Artifact count must increment by exactly 1');
    });

    it('SC4-SUCCESS-CONTENT-TYPES: create with string content AND Buffer content -- both succeed', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-task-4');

      // String content
      const stringResult = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'string-content-artifact',
        content: 'This is plain string content for the artifact.',
      }));
      assert.equal(stringResult.ok, true, 'S18: String content artifact must succeed');
      if (!stringResult.ok) return;
      assert.equal(stringResult.value.version, 1, 'S18: String content version must be 1');

      // Buffer content
      const bufferContent = Buffer.from('This is Buffer content for the artifact.', 'utf-8');
      const bufferResult = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'buffer-content-artifact',
        content: bufferContent,
      }));
      assert.equal(bufferResult.ok, true, 'S18: Buffer content artifact must succeed');
      if (!bufferResult.ok) return;
      assert.equal(bufferResult.value.version, 1, 'S18: Buffer content version must be 1');

      // Verify both stored in core_artifacts
      const stringRow = conn.get<{ content: Buffer }>(
        'SELECT content FROM core_artifacts WHERE id = ?',
        [stringResult.value.artifactId],
      );
      assert.ok(stringRow, 'S18: String content row must exist');
      assert.ok(Buffer.isBuffer(stringRow.content), 'S18: String content must be stored as Buffer');

      const bufferRow = conn.get<{ content: Buffer }>(
        'SELECT content FROM core_artifacts WHERE id = ?',
        [bufferResult.value.artifactId],
      );
      assert.ok(bufferRow, 'S18: Buffer content row must exist');
      assert.ok(Buffer.isBuffer(bufferRow.content), 'S18: Buffer content must be stored as Buffer');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS -- A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths -- A21 Rejection Verification', () => {

    it('SC4-ERR-MISSION-NOT-ACTIVE: mission in COMPLETED state -- MISSION_NOT_ACTIVE + state unchanged', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-inactive-1');

      // Transition mission to COMPLETED (not in allowed set: CREATED, PLANNING, EXECUTING, REVIEWING)
      conn.run('UPDATE core_missions SET state = ? WHERE id = ?', ['COMPLETED', mid]);

      const before = snapshotState(conn);

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid));

      assert.equal(result.ok, false, 'S18: Must reject artifact creation for non-active mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S18: Error code must be MISSION_NOT_ACTIVE');
      }

      assertStateUnchanged(conn, before, 'MISSION_NOT_ACTIVE');
    });

    it('SC4-ERR-ARTIFACT-LIMIT-EXCEEDED: artifact count at maxArtifacts (100) -- ARTIFACT_LIMIT_EXCEEDED + state unchanged', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-limit-1');

      // INSERT 100 dummy artifacts directly via SQL (faster than 100 create calls)
      const now = new Date().toISOString();
      for (let i = 0; i < 100; i++) {
        conn.run(
          `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, 0, '{}', ?)`,
          [
            `dummy-artifact-${i}`, 1, mid, 'test-tenant',
            `dummy-${i}`, 'data', 'json', Buffer.from(`content-${i}`),
            tid, now,
          ],
        );
      }

      // Verify we have exactly 100 artifacts for this mission
      const count = conn.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM core_artifacts WHERE mission_id = ?',
        [mid],
      )?.cnt ?? 0;
      assert.equal(count, 100, 'Precondition: must have 100 artifacts before test');

      const before = snapshotState(conn);

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'one-too-many',
      }));

      assert.equal(result.ok, false, 'I-20: Must reject when artifact limit (100) reached');
      if (!result.ok) {
        assert.equal(result.error.code, 'ARTIFACT_LIMIT_EXCEEDED',
          'I-20: Error code must be ARTIFACT_LIMIT_EXCEEDED');
      }

      assertStateUnchanged(conn, before, 'ARTIFACT_LIMIT_EXCEEDED');
    });

    it('SC4-ERR-STORAGE-EXCEEDED: storage budget exhausted -- STORAGE_EXCEEDED + state unchanged', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-storage-1');

      // Set storage_max_bytes to a small value and storage_consumed_bytes near max
      // The artifact_store checks: storage_max_bytes > 0 && (consumed + contentSize) > max
      conn.run(
        'UPDATE core_resources SET storage_max_bytes = ?, storage_consumed_bytes = ? WHERE mission_id = ?',
        [100, 90, mid],
      );

      const before = snapshotState(conn);

      // Content larger than remaining budget (100 - 90 = 10 bytes remaining, content > 10)
      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        content: 'A'.repeat(50), // 50 bytes > 10 bytes remaining
      }));

      assert.equal(result.ok, false, 'S18: Must reject when storage budget would be exceeded');
      if (!result.ok) {
        assert.equal(result.error.code, 'STORAGE_EXCEEDED',
          'S18: Error code must be STORAGE_EXCEEDED');
      }

      assertStateUnchanged(conn, before, 'STORAGE_EXCEEDED');
    });

    it('SC4-ERR-CONTENT-SIZE-EXCEEDED: content exceeds CF-013 10MB limit -- INVALID_INPUT + state unchanged', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-size-1');

      const before = snapshotState(conn);

      // CF-013: 10MB = 10_485_760 bytes. Create content that exceeds this.
      // Use a string of 10_485_761 bytes (1 byte over limit)
      const oversizedContent = 'X'.repeat(10_485_761);

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'oversized-artifact',
        content: oversizedContent,
      }));

      assert.equal(result.ok, false, 'CF-013: Must reject artifact content exceeding 10MB');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'CF-013: Error code must be INVALID_INPUT for oversized content');
        assert.ok(result.error.message.includes('exceeds maximum size'),
          'CF-013: Error message must describe the size violation');
      }

      assertStateUnchanged(conn, before, 'CONTENT_SIZE_EXCEEDED');
    });

    it('SC4-ERR-MISSION-NOT-FOUND: nonexistent missionId -- MISSION_NOT_ACTIVE + state unchanged', () => {
      // Use a missionId that was never created
      const fakeMid = 'nonexistent-mission-xyz' as MissionId;
      const fakeTid = taskId('nonexistent-task-xyz');

      const before = snapshotState(conn);

      const result = engine.createArtifact(ctx, validArtifactInput(fakeMid, fakeTid));

      assert.equal(result.ok, false, 'S18: Must reject artifact creation for nonexistent mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_ACTIVE',
          'S18: Error code must be MISSION_NOT_ACTIVE for nonexistent mission');
      }

      assertStateUnchanged(conn, before, 'MISSION_NOT_FOUND');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS -- Facade-Level Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition -- Facade-Level Verification', () => {

    it('SC4-EVENT-ARTIFACT-CREATED: verify ARTIFACT_CREATED event shape (type, payload with artifactId, version, name, type)', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-event-1');

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'event-shape-artifact',
        type: 'analysis',
      }));
      assert.equal(result.ok, true, 'S18: Artifact creation must succeed');
      if (!result.ok) return;

      const event = conn.get<{
        type: string; scope: string; propagation: string;
        mission_id: string; emitted_by: string; payload_json: string;
      }>(
        "SELECT type, scope, propagation, mission_id, emitted_by, payload_json FROM core_events_log WHERE type = 'ARTIFACT_CREATED' AND mission_id = ?",
        [mid],
      );

      assert.ok(event, 'S18: ARTIFACT_CREATED event must exist');
      assert.equal(event.type, 'ARTIFACT_CREATED', 'Event type must be ARTIFACT_CREATED');
      assert.equal(event.scope, 'system', 'Lifecycle events have system scope');
      assert.equal(event.propagation, 'up', 'S18: Lifecycle event propagation must be up');
      assert.equal(event.mission_id, mid, 'Event must reference the correct mission');
      assert.equal(event.emitted_by, 'orchestrator', 'Lifecycle events emitted by orchestrator');

      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      assert.equal(payload.artifactId, result.value.artifactId,
        'S18: payload must contain artifactId matching returned value');
      assert.equal(payload.version, result.value.version,
        'S18: payload must contain version matching returned value');
      assert.equal(payload.name, 'event-shape-artifact',
        'S18: payload must contain artifact name');
      assert.equal(payload.type, 'analysis',
        'S18: payload must contain artifact type');
    });

    it('SC4-AUDIT-ATOMIC: verify audit entry with operation=create_artifact, resourceId=artifactId@vN', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-audit-1');

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'audit-artifact',
        type: 'code',
        format: 'python',
      }));
      assert.equal(result.ok, true, 'S18: Artifact creation must succeed');
      if (!result.ok) return;

      const expectedResourceId = `${result.value.artifactId as string}@v${result.value.version}`;

      const auditEntry = conn.get<{
        operation: string; resource_type: string; resource_id: string;
        actor_type: string; detail: string;
      }>(
        "SELECT operation, resource_type, resource_id, actor_type, detail FROM core_audit_log WHERE operation = 'create_artifact' AND resource_id = ?",
        [expectedResourceId],
      );

      assert.ok(auditEntry, 'I-03: Audit entry must exist for create_artifact');
      assert.equal(auditEntry.operation, 'create_artifact', 'I-03: operation must be create_artifact');
      assert.equal(auditEntry.resource_type, 'artifact', 'I-03: resource_type must be artifact');
      assert.equal(auditEntry.resource_id, expectedResourceId,
        'I-03: resource_id must follow artifactId@vN format');

      const detail = JSON.parse(auditEntry.detail) as Record<string, unknown>;
      assert.equal(detail.missionId, mid, 'I-03: detail.missionId must match');
      assert.equal(detail.name, 'audit-artifact', 'I-03: detail.name must match input');
      assert.equal(detail.type, 'code', 'I-03: detail.type must match input');
      assert.equal(detail.version, 1, 'I-03: detail.version must be 1 for new artifact');
    });

    it('SC4-IMMUTABILITY-I19: create artifact, attempt UPDATE content via SQL -- trigger blocks it', () => {
      const mid = createTestMission();
      const tid = createTestGraphWithTask(mid, 'art-immut-1');

      const result = engine.createArtifact(ctx, validArtifactInput(mid, tid, {
        name: 'immutable-artifact',
        content: 'Original content that must never change',
      }));
      assert.equal(result.ok, true, 'S18: Artifact creation must succeed');
      if (!result.ok) return;

      // Attempt to UPDATE content directly via SQL -- I-19 trigger must block
      assert.throws(
        () => {
          conn.run(
            'UPDATE core_artifacts SET content = ? WHERE id = ? AND version = ?',
            [Buffer.from('Tampered content'), result.value.artifactId, result.value.version],
          );
        },
        (err: Error) => {
          // The trigger raises: 'I-19: Artifact content is immutable. UPDATE on content is prohibited.'
          return err.message.includes('I-19');
        },
        'I-19: UPDATE on artifact content must be blocked by immutability trigger',
      );

      // Verify original content unchanged
      const row = conn.get<{ content: Buffer }>(
        'SELECT content FROM core_artifacts WHERE id = ? AND version = ?',
        [result.value.artifactId, result.value.version],
      );
      assert.ok(row, 'I-19: Artifact row must still exist after blocked UPDATE');
      assert.equal(
        row.content.toString('utf-8'),
        'Original content that must never change',
        'I-19: Content must remain unchanged after blocked UPDATE attempt',
      );
    });
  });
});
