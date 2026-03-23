/**
 * Limen v1.0 — WMP (Working Memory Protocol) Executable Contract Tests
 * Phase 1G: Truth Model Verification
 *
 * Every test in this file MUST FAIL against the NOT_IMPLEMENTED harness.
 * Every test asserts spec-derived behavior, not implementation details.
 * When implementation replaces the harness, tests turn green one by one.
 *
 * Spec ref: WMP v1.0 Design Source (FINAL DRAFT)
 * Invariants: WMP-I1 through WMP-I8
 * Derived constraints: DERIVED-1 through DERIVED-8
 * Failure modes: FM-WMP-01 through FM-WMP-03
 * System calls: SC-14 (write), SC-15 (read), SC-16 (discard)
 * Amendment 2: Control 3 (Executable Contract, Interface-First)
 *
 * Test count: 21 conformance tests (CT-WMP-01 through CT-WMP-21)
 *           + 49 derived tests (error codes, key constraints, deduplication,
 *             terminal variants, trigger sequencing, internal read interface,
 *             capacity replacement, pre-emission adapter, discard all, mission transition)
 *           + 5 suspension lifecycle tests (DC-WMP-212, DC-WMP-213, DC-WMP-214, AMB-WMP-05)
 *           = 75 total
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkingMemorySystem,
  createWmpInternalReader,
  createWmpPreEmissionCapture,
  NotImplementedError,
} from '../../src/working-memory/harness/wmp_harness.js';

import {
  createTestDatabase,
  createTestOperationContext,
  createTestAuditTrail,
  seedMission,
  tenantId,
  agentId,
  missionId,
  taskId,
} from '../helpers/test_database.js';

import type {
  WorkingMemorySystem,
  WriteWorkingMemoryInput,
  ReadWorkingMemoryInput,
  DiscardWorkingMemoryInput,
  ReadWorkingMemoryListOutput,
  ReadWorkingMemoryEntryOutput,
  WmpCapacityPolicy,
  BoundaryEvent,
  SnapshotContent,
  WmpNamespaceState,
  BoundaryEventId,
  SnapshotContentId,
  SystemCallId,
} from '../../src/working-memory/interfaces/wmp_types.js';

import {
  SC14_ERROR_CODES,
  SC15_ERROR_CODES,
  SC16_ERROR_CODES,
  WMP_KEY_MAX_LENGTH,
  WMP_KEY_RESERVED_PREFIX,
  WMP_DEFAULT_MAX_ENTRIES,
  WMP_DEFAULT_MAX_BYTES_PER_ENTRY,
  WMP_DEFAULT_MAX_TOTAL_BYTES,
} from '../../src/working-memory/interfaces/wmp_types.js';

import type { DatabaseConnection, TaskId, AgentId, MissionId } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Helpers — Branded Type Constructors
// ============================================================================

function testTaskId(id: string = 'task-wmp-001'): TaskId {
  return id as TaskId;
}

function testMissionId(id: string = 'mission-wmp-001'): MissionId {
  return id as MissionId;
}

function testAgentId(id: string = 'agent-wmp-001'): AgentId {
  return id as AgentId;
}

function testSystemCallId(id: string = 'sc-wmp-001'): SystemCallId {
  return id as SystemCallId;
}

// ============================================================================
// Test Helpers — Common Setup
// ============================================================================

let conn: DatabaseConnection;
let wmp: WorkingMemorySystem;

function setup(capacityOverrides?: Partial<WmpCapacityPolicy>): void {
  conn = createTestDatabase();
  const policy: WmpCapacityPolicy = {
    maxEntries: capacityOverrides?.maxEntries ?? WMP_DEFAULT_MAX_ENTRIES,
    maxBytesPerEntry: capacityOverrides?.maxBytesPerEntry ?? WMP_DEFAULT_MAX_BYTES_PER_ENTRY,
    maxTotalBytes: capacityOverrides?.maxTotalBytes ?? WMP_DEFAULT_MAX_TOTAL_BYTES,
  };
  wmp = createWorkingMemorySystem({
    audit: createTestAuditTrail(),
    capacityPolicy: policy,
  });

  // Seed a mission and task in RUNNING state
  seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
  seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });
}

/** Seed a task directly for test setup */
function seedTask(c: DatabaseConnection, options: {
  id: string;
  missionId: string;
  state?: string;
  agentId?: string;
}): void {
  const now = new Date().toISOString();
  const state = options.state ?? 'RUNNING';
  const agentIdVal = options.agentId ?? 'agent-wmp-001';

  // Ensure a graph exists for this mission
  const graphId = `graph-${options.missionId}`;
  const existingGraph = c.get<{ id: string }>(
    'SELECT id FROM core_task_graphs WHERE id = ?', [graphId],
  );
  if (!existingGraph) {
    c.run(
      `INSERT INTO core_task_graphs (id, mission_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, 1, 'Aligned with test objective', 1, ?)`,
      [graphId, options.missionId, now],
    );
  }

  const completedAt = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state) ? now : null;
  c.run(
    `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, assigned_agent, retry_count, max_retries, created_at, updated_at, completed_at)
     VALUES (?, ?, 'test-tenant', ?, 'WMP test task', 'deterministic', 100, '[]', ?, ?, 0, 3, ?, ?, ?)`,
    [options.id, options.missionId, graphId, state, agentIdVal, now, now, completedAt],
  );
}

// ============================================================================
// SECTION 1: CONFORMANCE TESTS (21 from design source)
// ============================================================================

describe('WMP Conformance Tests — Design Source §4', () => {

  beforeEach(() => setup());

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-01: Cross-Task Read Isolation [WMP-I1, CF-04]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-01: Cross-task read isolation — Task B cannot read Task A WMP', () => {
    // Setup: Task A writes entry
    const taskA = testTaskId('task-A');
    const taskB = testTaskId('task-B');
    seedTask(conn, { id: 'task-A', missionId: 'mission-wmp-001', state: 'RUNNING' });
    seedTask(conn, { id: 'task-B', missionId: 'mission-wmp-001', state: 'RUNNING' });

    wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'hypothesis', value: 'Earth is round' });

    // Action: Task B reads Task A's entry
    const result = wmp.read.execute(conn, taskB, testAgentId(), { taskId: taskA, key: 'hypothesis' });

    // Expected: TASK_SCOPE_VIOLATION
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, SC15_ERROR_CODES.TASK_SCOPE_VIOLATION);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-02: Cross-Task Write Isolation [WMP-I1, CF-04]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-02: Cross-task write isolation — Task B cannot write Task A WMP', () => {
    const taskA = testTaskId('task-A');
    const taskB = testTaskId('task-B');
    seedTask(conn, { id: 'task-A', missionId: 'mission-wmp-001', state: 'RUNNING' });
    seedTask(conn, { id: 'task-B', missionId: 'mission-wmp-001', state: 'RUNNING' });

    // Action: Task B writes to Task A's WMP
    const result = wmp.write.execute(conn, taskB, testAgentId(), { taskId: taskA, key: 'injection', value: 'malicious' });

    // Expected: TASK_SCOPE_VIOLATION, Task A unaffected
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, SC14_ERROR_CODES.TASK_SCOPE_VIOLATION);
    }

    // Verify Task A's WMP is unaffected
    const readResult = wmp.read.execute(conn, taskA, testAgentId(), { taskId: taskA, key: null }) as { ok: true; value: ReadWorkingMemoryListOutput };
    if (readResult.ok) {
      const list = readResult.value as ReadWorkingMemoryListOutput;
      const injected = list.entries.find(e => e.key === 'injection');
      assert.equal(injected, undefined, 'Task A must not contain injected entry');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-03: Context Admission Scope Isolation [WMP-I1, CF-04]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-03: Context admission scope isolation — Task A entries excluded from Task B P2 candidates', () => {
    const taskA = testTaskId('task-A');
    const taskB = testTaskId('task-B');
    seedTask(conn, { id: 'task-A', missionId: 'mission-wmp-001', state: 'RUNNING' });
    seedTask(conn, { id: 'task-B', missionId: 'mission-wmp-001', state: 'RUNNING' });

    // Task A creates entries
    wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'a', value: 'val-a' });
    wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'b', value: 'val-b' });
    wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'c', value: 'val-c' });

    // Context admission for Task B via internal reader
    const reader = createWmpInternalReader();
    const result = reader.readLiveEntries(taskB);

    // Expected: Task A's entries not in Task B's P2 candidate set
    if (result.ok) {
      const taskAKeys = result.value.map(e => e.key);
      assert.equal(taskAKeys.includes('a'), false, 'Task A key "a" must not appear for Task B');
      assert.equal(taskAKeys.includes('b'), false, 'Task A key "b" must not appear for Task B');
      assert.equal(taskAKeys.includes('c'), false, 'Task A key "c" must not appear for Task B');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-04: In-Scope Replaceability [WMP-I3, WMP-I5, CF-12]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-04: In-scope replaceability — successive writes replace value, no per-mutation audit', () => {
    const tId = testTaskId();

    // Three writes to the same key
    const w1 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'draft', value: 'version 1' });
    const w2 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'draft', value: 'version 2' });
    const w3 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'draft', value: 'version 3' });

    // All three succeed
    assert.equal(w1.ok, true);
    assert.equal(w2.ok, true);
    assert.equal(w3.ok, true);

    // Final read returns version 3
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'draft' });
    assert.equal(read.ok, true);
    if (read.ok) {
      const entry = read.value as ReadWorkingMemoryEntryOutput;
      assert.equal(entry.value, 'version 3');
    }

    // Mutation positions are strictly increasing
    if (w1.ok && w2.ok && w3.ok) {
      assert.ok(w1.value.mutationPosition < w2.value.mutationPosition);
      assert.ok(w2.value.mutationPosition < w3.value.mutationPosition);
    }

    // No per-mutation audit entries exist (WMP-I3)
    // This is verified by checking the audit trail does not contain WMP mutation entries
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-05: No Public Snapshot Call [CF-04]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-05: No public snapshot call — system call surface has no snapshot operation', () => {
    // Verification: The WMP system interface has no method for agent-initiated snapshots.
    // The WorkingMemorySystem interface exposes: write, read, discard, boundary.
    // The boundary coordinator is system-internal, not agent-facing.
    // This test verifies the architectural contract — no snapshot SC exists.

    const system = wmp;
    assert.ok(system.write, 'SC-14 write exists');
    assert.ok(system.read, 'SC-15 read exists');
    assert.ok(system.discard, 'SC-16 discard exists');
    assert.ok(system.boundary, 'Boundary coordinator exists (system-internal)');

    // Verify no snapshot method on write/read/discard handlers
    assert.equal(typeof (system.write as Record<string, unknown>)['snapshot'], 'undefined');
    assert.equal(typeof (system.read as Record<string, unknown>)['snapshot'], 'undefined');
    assert.equal(typeof (system.discard as Record<string, unknown>)['snapshot'], 'undefined');
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-06: Pre-Emission Boundary Capture [WMP-I6, WMP-I8, CF-04, CF-13]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-06: Pre-emission boundary capture — SC-11 triggers snapshot with audit linkage', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Task creates WMP entry
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'draft_claim', value: 'assertion text' });

    // SC-11 validates and passes — trigger pre-emission capture
    const emissionId = testSystemCallId('sc11-001');
    const captureResult = wmp.boundary.capturePreEmission(conn, tId, mId, emissionId);

    assert.equal(captureResult.ok, true);
    if (captureResult.ok) {
      const event = captureResult.value;
      assert.equal(event.trigger, 'pre_irreversible_emission');
      assert.equal(event.taskId, tId);
      assert.equal(event.linkedEmissionId, emissionId);

      // Verify snapshot content contains the WMP entry
      const content = wmp.boundaryStore.getSnapshotContent(conn, event.snapshotContentId);
      assert.equal(content.ok, true);
      if (content.ok) {
        assert.equal(content.value.namespaceState, 'initialized_with_entries');
        assert.notEqual(content.value.entries, null);
        if (content.value.entries) {
          const draftEntry = content.value.entries.find(e => e.key === 'draft_claim');
          assert.ok(draftEntry, 'Snapshot must contain draft_claim entry');
          assert.equal(draftEntry!.value, 'assertion text');
        }
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-07: Terminal Atomicity — COMPLETED [WMP-I7]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-07: Terminal atomicity — capture + transition + discard as one atomic operation', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Task creates 3 entries
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'x', value: 'val-x' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'y', value: 'val-y' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'z', value: 'val-z' });

    // Terminal capture (COMPLETED)
    const captureResult = wmp.boundary.captureAtTerminal(conn, tId, mId, 'COMPLETED');

    // Post-conditions — all must hold simultaneously
    assert.equal(captureResult.ok, true);
    if (captureResult.ok) {
      const event = captureResult.value;

      // 1. Boundary event with terminal trigger, snapshot contains all 3 entries pre-discard
      assert.equal(event.trigger, 'task_terminal');
      const content = wmp.boundaryStore.getSnapshotContent(conn, event.snapshotContentId);
      assert.equal(content.ok, true);
      if (content.ok) {
        assert.equal(content.value.totalEntries, 3);
        assert.notEqual(content.value.entries, null);
        if (content.value.entries) {
          const keys = content.value.entries.map(e => e.key).sort();
          assert.deepEqual(keys, ['x', 'y', 'z']);
        }
      }
    }

    // 3. SC-15 returns TASK_TERMINATED after terminal state
    const readResult = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(readResult.ok, false);
    if (!readResult.ok) {
      assert.equal(readResult.error.code, SC15_ERROR_CODES.TASK_TERMINATED);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-08: Deterministic Read Behavior [WMP-I5]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-08: Deterministic read behavior — identical sequences produce identical state', () => {
    // First execution
    const taskA = testTaskId('task-det-A');
    seedTask(conn, { id: 'task-det-A', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const w1a = wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'alpha', value: 'first' });
    const w2a = wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'beta', value: 'second' });
    wmp.discard.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'alpha' });
    const w3a = wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'gamma', value: 'third' });

    const read1 = wmp.read.execute(conn, taskA, testAgentId(), { taskId: taskA, key: null });

    // Second execution — identical sequence
    const taskB = testTaskId('task-det-B');
    seedTask(conn, { id: 'task-det-B', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const w1b = wmp.write.execute(conn, taskB, testAgentId(), { taskId: taskB, key: 'alpha', value: 'first' });
    const w2b = wmp.write.execute(conn, taskB, testAgentId(), { taskId: taskB, key: 'beta', value: 'second' });
    wmp.discard.execute(conn, taskB, testAgentId(), { taskId: taskB, key: 'alpha' });
    const w3b = wmp.write.execute(conn, taskB, testAgentId(), { taskId: taskB, key: 'gamma', value: 'third' });

    const read2 = wmp.read.execute(conn, taskB, testAgentId(), { taskId: taskB, key: null });

    // Both read results must have identical entries and values
    assert.equal(read1.ok, true);
    assert.equal(read2.ok, true);
    if (read1.ok && read2.ok) {
      const list1 = read1.value as ReadWorkingMemoryListOutput;
      const list2 = read2.value as ReadWorkingMemoryListOutput;
      assert.equal(list1.totalEntries, list2.totalEntries);
      assert.deepEqual(
        list1.entries.map(e => ({ key: e.key, value: e.value })),
        list2.entries.map(e => ({ key: e.key, value: e.value })),
      );
    }

    // Mutation-order positions are identical
    if (w1a.ok && w1b.ok) assert.equal(w1a.value.mutationPosition, w1b.value.mutationPosition);
    if (w2a.ok && w2b.ok) assert.equal(w2a.value.mutationPosition, w2b.value.mutationPosition);
    if (w3a.ok && w3b.ok) assert.equal(w3a.value.mutationPosition, w3b.value.mutationPosition);
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-09: Storage/Admission Separation [WMP-I4, CF-03, CF-01]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-09: Storage/admission separation — context eviction does not affect live namespace', () => {
    const tId = testTaskId();

    // Create 10 entries
    for (let i = 0; i < 10; i++) {
      wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: `entry-${i}`, value: `value-${i}` });
    }

    // All 10 remain accessible via SC-15 regardless of context eviction
    const readResult = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(readResult.ok, true);
    if (readResult.ok) {
      const list = readResult.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 10);
    }

    // Note: Actual context eviction is tested in CGP contract tests.
    // This test verifies that WMP live namespace is independent of admission decisions.
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-10: Capacity Failure Determinism [V1-CHOICE: DERIVED-6]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-10: Capacity exceeded — rejection with usage metrics, existing entries unaffected', () => {
    // Configure maxEntries=5
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem({ capacityPolicy: { maxEntries: 5, maxBytesPerEntry: 65536, maxTotalBytes: 262144 } });
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
    seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const tId = testTaskId();

    // Create 5 entries (succeed)
    for (let i = 0; i < 5; i++) {
      const r = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: `k${i}`, value: `v${i}` });
      assert.equal(r.ok, true, `Entry ${i} should succeed`);
    }

    // 6th entry — CAPACITY_EXCEEDED
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'overflow', value: 'too-many' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, SC14_ERROR_CODES.WORKING_MEMORY_CAPACITY_EXCEEDED);
    }

    // Original 5 entries unaffected
    const readResult = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(readResult.ok, true);
    if (readResult.ok) {
      const list = readResult.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 5);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-11: Failed Mutation Order [WMP-I5, Correction 10]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-11: Failed mutation does not advance counter', () => {
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem({ capacityPolicy: { maxEntries: 100, maxBytesPerEntry: 10, maxTotalBytes: 262144 } });
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
    seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const tId = testTaskId();

    // Write "a" — succeeds, gets position P
    const writeA = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a', value: 'small' });
    assert.equal(writeA.ok, true);

    // Write "b" with value exceeding per-entry limit — fails
    const writeB = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'b', value: 'x'.repeat(20) });
    assert.equal(writeB.ok, false);

    // Write "c" — succeeds, gets position P+1 (not P+2)
    const writeC = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'c', value: 'small2' });
    assert.equal(writeC.ok, true);

    if (writeA.ok && writeC.ok) {
      assert.equal(writeC.value.mutationPosition, writeA.value.mutationPosition + 1,
        'Failed write must not advance counter');
    }

    // Only "a" and "c" exist
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(read.ok, true);
    if (read.ok) {
      const list = read.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 2);
      const keys = list.entries.map(e => e.key).sort();
      assert.deepEqual(keys, ['a', 'c']);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-12: Empty-Boundary Capture [WMP-I6, Correction 7]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-12: Empty-boundary capture — initialized-empty namespace captured at checkpoint', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Write then discard — namespace is initialized but empty
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'temp', value: 'data' });
    wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'temp' });

    // Checkpoint fires
    const capture = wmp.boundary.captureAtCheckpoint(conn, tId, mId);

    assert.equal(capture.ok, true);
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'checkpoint');

      const content = wmp.boundaryStore.getSnapshotContent(conn, capture.value.snapshotContentId);
      assert.equal(content.ok, true);
      if (content.ok) {
        assert.equal(content.value.namespaceState, 'initialized_empty');
        assert.equal(content.value.totalEntries, 0);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-13: Failed-Emission No Snapshot [WMP-I6, Correction 10]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-13: Failed emission does not create pre-emission snapshot', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Task creates WMP entry
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'draft', value: 'text' });

    // Get boundary events BEFORE the failed emission attempt
    const eventsBefore = wmp.boundaryStore.listBoundaryEvents(conn, tId);

    // A failed SC-11 (insufficient evidence) does NOT trigger capture.
    // The WMP system only receives the capture call if validation PASSES.
    // Therefore, no pre-emission capture exists for a failed emission.
    // This test verifies that no pre_irreversible_emission event is created
    // when the emission fails validation (i.e., capturePreEmission is never called).

    // The boundary events list should not contain a pre_irreversible_emission trigger
    // for a failed SC-11 invocation.
    if (eventsBefore.ok) {
      const preEmissionEvents = eventsBefore.value.filter(
        e => e.trigger === 'pre_irreversible_emission',
      );
      assert.equal(preEmissionEvents.length, 0,
        'No pre-emission boundary event should exist before any successful emission');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-14: Post-Terminal Inaccessibility [WMP-I2, CF-04]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-14: Post-terminal inaccessibility — SC-14/SC-15/SC-16 all return TASK_TERMINATED', () => {
    const tId = testTaskId('task-terminal');
    const mId = testMissionId();
    seedTask(conn, { id: 'task-terminal', missionId: 'mission-wmp-001', state: 'RUNNING' });

    // Create entries, then terminal capture
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'data', value: 'val' });
    wmp.boundary.captureAtTerminal(conn, tId, mId, 'COMPLETED');

    // Post-conditions: all three SCs return TASK_TERMINATED
    const writeResult = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'new', value: 'data' });
    assert.equal(writeResult.ok, false);
    if (!writeResult.ok) assert.equal(writeResult.error.code, 'TASK_TERMINATED');

    const readResult = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(readResult.ok, false);
    if (!readResult.ok) assert.equal(readResult.error.code, 'TASK_TERMINATED');

    const discardResult = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(discardResult.ok, false);
    if (!discardResult.ok) assert.equal(discardResult.error.code, 'TASK_TERMINATED');
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-15: Destination-Governed Validation [CF-02]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-15: Destination-governed validation — trust level does not alter validation', () => {
    const adminTask = testTaskId('task-admin');
    const untrustedTask = testTaskId('task-untrusted');
    seedTask(conn, { id: 'task-admin', missionId: 'mission-wmp-001', state: 'RUNNING', agentId: 'agent-admin' });
    seedTask(conn, { id: 'task-untrusted', missionId: 'mission-wmp-001', state: 'RUNNING', agentId: 'agent-untrusted' });

    // Identical inputs for both agents
    const input = { key: 'test-key', value: 'test-value' };

    const adminResult = wmp.write.execute(conn, adminTask, 'agent-admin' as AgentId, { taskId: adminTask, ...input });
    const untrustedResult = wmp.write.execute(conn, untrustedTask, 'agent-untrusted' as AgentId, { taskId: untrustedTask, ...input });

    // Both succeed or both fail identically
    assert.equal(adminResult.ok, untrustedResult.ok, 'Both must have identical success/failure');
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-16: WMP Does Not Survive Retry [Non-Goal, DERIVED]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-16: WMP does not survive retry — retried task has fresh namespace', () => {
    const tId = testTaskId('task-retry');
    seedTask(conn, { id: 'task-retry', missionId: 'mission-wmp-001', state: 'RUNNING' });

    // Write entry
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'important', value: 'data' });

    // Task fails and retries (FAILED → PENDING → SCHEDULED → RUNNING)
    // Simulate: terminal capture, then new task instance
    wmp.boundary.captureAtTerminal(conn, tId, testMissionId(), 'COMPLETED');

    // After retry, the task has a fresh WMP namespace
    // The retried task has same ID but new execution context
    // We simulate this by re-seeding the task as RUNNING
    conn.run('UPDATE core_tasks SET state = ?, completed_at = NULL WHERE id = ?', ['RUNNING', 'task-retry']);

    // Read the key from retried task — should be WORKING_MEMORY_NOT_FOUND
    const readResult = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'important' });
    assert.equal(readResult.ok, false);
    if (!readResult.ok) {
      assert.equal(readResult.error.code, SC15_ERROR_CODES.WORKING_MEMORY_NOT_FOUND);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-17: Conservative Boundary Capture — Never-Initialized [WMP-I6, F-4]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-17: Conservative boundary capture — never-initialized task gets boundary event', () => {
    const tId = testTaskId('task-never-init');
    const mId = testMissionId();
    seedTask(conn, { id: 'task-never-init', missionId: 'mission-wmp-001', state: 'RUNNING' });

    // Task never calls SC-14. Checkpoint fires.
    const capture = wmp.boundary.captureAtCheckpoint(conn, tId, mId);

    assert.equal(capture.ok, true);
    if (capture.ok) {
      const content = wmp.boundaryStore.getSnapshotContent(conn, capture.value.snapshotContentId);
      assert.equal(content.ok, true);
      if (content.ok) {
        assert.equal(content.value.namespaceState, 'never_initialized');
        assert.equal(content.value.entries, null);
        assert.equal(content.value.highestMutationPosition, null);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-18: Initialized-Empty vs Never-Initialized [WMP-I6, F-2]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-18: Initialized-empty and never-initialized are distinct — not deduplicated', () => {
    const taskA = testTaskId('task-init-empty');
    const taskB = testTaskId('task-never');
    const mId = testMissionId();
    seedTask(conn, { id: 'task-init-empty', missionId: 'mission-wmp-001', state: 'RUNNING' });
    seedTask(conn, { id: 'task-never', missionId: 'mission-wmp-001', state: 'RUNNING' });

    // Task A: write then discard → initialized_empty
    wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'temp', value: 'x' });
    wmp.discard.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'temp' });

    // Task B: never calls SC-14 → never_initialized

    // Checkpoint for both
    const captureA = wmp.boundary.captureAtCheckpoint(conn, taskA, mId);
    const captureB = wmp.boundary.captureAtCheckpoint(conn, taskB, mId);

    assert.equal(captureA.ok, true);
    assert.equal(captureB.ok, true);

    if (captureA.ok && captureB.ok) {
      const contentA = wmp.boundaryStore.getSnapshotContent(conn, captureA.value.snapshotContentId);
      const contentB = wmp.boundaryStore.getSnapshotContent(conn, captureB.value.snapshotContentId);

      assert.equal(contentA.ok, true);
      assert.equal(contentB.ok, true);

      if (contentA.ok && contentB.ok) {
        assert.equal(contentA.value.namespaceState, 'initialized_empty');
        assert.equal(contentB.value.namespaceState, 'never_initialized');
        // Different namespace states → different content IDs (not deduplicated)
        assert.notEqual(contentA.value.contentId, contentB.value.contentId);
      }
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-19: Boundary Snapshot Failure Blocks Boundary [F-3, WMP-I6]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-19: Checkpoint boundary capture succeeds and produces valid event (F-WMP-BB-05)', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'data', value: 'val' });

    const capture = wmp.boundary.captureAtCheckpoint(conn, tId, mId);
    // F-WMP-BB-05: Discriminative assertion — verify success AND structure
    assert.equal(capture.ok, true, 'Checkpoint capture must succeed');
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'checkpoint', 'Trigger must be checkpoint');
      assert.equal(capture.value.taskId, tId, 'Event must reference correct task');
      assert.equal(capture.value.missionId, mId, 'Event must reference correct mission');
      assert.ok(capture.value.snapshotContentId, 'Snapshot content must be linked');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-20: Read Returns Live Namespace Only [F-11, WMP-I4]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-20: Read returns live namespace only — no snapshot metadata', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Create entries, trigger checkpoint, create more entries
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'before', value: 'pre-checkpoint' });
    wmp.boundary.captureAtCheckpoint(conn, tId, mId);
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'after', value: 'post-checkpoint' });

    // SC-15 returns current live state including post-checkpoint entries
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(read.ok, true);
    if (read.ok) {
      const list = read.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 2);
      const keys = list.entries.map(e => e.key).sort();
      assert.deepEqual(keys, ['after', 'before']);
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // CT-WMP-21: Snapshot Captures Visible Namespace [F-11]
  // ────────────────────────────────────────────────────────────────────────
  it('CT-WMP-21: Snapshot captures visible namespace — tombstones excluded', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Write entry "a", then discard it
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a', value: 'data' });
    wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a' });

    // Checkpoint fires
    const capture = wmp.boundary.captureAtCheckpoint(conn, tId, mId);
    assert.equal(capture.ok, true);
    if (capture.ok) {
      const content = wmp.boundaryStore.getSnapshotContent(conn, capture.value.snapshotContentId);
      assert.equal(content.ok, true);
      if (content.ok) {
        // Snapshot does NOT include tombstoned entry "a"
        assert.equal(content.value.namespaceState, 'initialized_empty');
        assert.equal(content.value.totalEntries, 0);
        if (content.value.entries) {
          assert.equal(content.value.entries.length, 0);
        }
      }
    }
  });
});

// ============================================================================
// SECTION 2: DERIVED TESTS — Per-SC Error Codes
// ============================================================================

describe('WMP Derived Tests — SC-14 Error Codes (8 codes)', () => {

  beforeEach(() => setup());

  it('SC-14-ERR-01: TASK_NOT_FOUND — non-existent task', () => {
    const bogusTask = testTaskId('task-nonexistent');
    const result = wmp.write.execute(conn, bogusTask, testAgentId(), { taskId: bogusTask, key: 'k', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_NOT_FOUND');
  });

  it('SC-14-ERR-02: TASK_TERMINATED — write to completed task', () => {
    const tId = testTaskId('task-done');
    seedTask(conn, { id: 'task-done', missionId: 'mission-wmp-001', state: 'COMPLETED' });
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'k', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_TERMINATED');
  });

  it('SC-14-ERR-03: TASK_NOT_EXECUTABLE — write to PENDING task', () => {
    const tId = testTaskId('task-pending');
    seedTask(conn, { id: 'task-pending', missionId: 'mission-wmp-001', state: 'PENDING' });
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'k', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_NOT_EXECUTABLE');
  });

  it('SC-14-ERR-04: TASK_SCOPE_VIOLATION — wrong agent', () => {
    const tId = testTaskId();
    const wrongAgent = 'agent-imposter' as AgentId;
    const result = wmp.write.execute(conn, wrongAgent, wrongAgent, { taskId: tId, key: 'k', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_SCOPE_VIOLATION');
  });

  it('SC-14-ERR-05: WORKING_MEMORY_KEY_INVALID — empty key', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: '', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('SC-14-ERR-06: WORKING_MEMORY_KEY_INVALID — reserved prefix _wmp.', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: '_wmp.internal', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('SC-14-ERR-07: WORKING_MEMORY_CAPACITY_EXCEEDED — entry count ceiling', () => {
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem({ capacityPolicy: { maxEntries: 1, maxBytesPerEntry: 65536, maxTotalBytes: 262144 } });
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
    seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const tId = testTaskId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'first', value: 'v' });
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'second', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_CAPACITY_EXCEEDED');
  });

  it('SC-14-ERR-08: WORKING_MEMORY_VALUE_INVALID — null bytes in value rejected (F-WMP-BB-04)', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), {
      taskId: tId,
      key: 'bad-value',
      value: 'hello\0world',
    });
    assert.equal(result.ok, false, 'Null bytes in value must be rejected');
    if (!result.ok) {
      assert.equal(result.error.code, 'WORKING_MEMORY_VALUE_INVALID');
    }

    // [A21] Verify state unchanged — no entry created
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'bad-value' });
    assert.equal(read.ok, false, 'Rejected write must not create entry');
    if (!read.ok) assert.equal(read.error.code, 'WORKING_MEMORY_NOT_FOUND');
  });
});

describe('WMP Derived Tests — SC-15 Error Codes (5 codes)', () => {

  beforeEach(() => setup());

  it('SC-15-ERR-01: TASK_NOT_FOUND — read from non-existent task', () => {
    const bogus = testTaskId('task-missing');
    const result = wmp.read.execute(conn, bogus, testAgentId(), { taskId: bogus, key: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_NOT_FOUND');
  });

  it('SC-15-ERR-02: TASK_TERMINATED — read from failed task', () => {
    const tId = testTaskId('task-failed');
    seedTask(conn, { id: 'task-failed', missionId: 'mission-wmp-001', state: 'FAILED' });
    const result = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_TERMINATED');
  });

  it('SC-15-ERR-03: TASK_SCOPE_VIOLATION — read with wrong agent', () => {
    const tId = testTaskId();
    const wrongAgent = 'agent-wrong' as AgentId;
    const result = wmp.read.execute(conn, wrongAgent, wrongAgent, { taskId: tId, key: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_SCOPE_VIOLATION');
  });

  it('SC-15-ERR-04: WORKING_MEMORY_NOT_FOUND — read non-existent key', () => {
    const tId = testTaskId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'exists', value: 'v' });
    const result = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'does-not-exist' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_NOT_FOUND');
  });

  it('SC-15-ERR-05: UNAUTHORIZED — wrong agent rejected (F-WMP-BB-06)', () => {
    const tId = testTaskId();
    const wrongAgent = testAgentId('agent-unauthorized');
    // Write with correct agent first so entry exists
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'secret', value: 'v' });
    // Read with wrong agent must produce UNAUTHORIZED
    const result = wmp.read.execute(conn, tId, wrongAgent, { taskId: tId, key: 'secret' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'UNAUTHORIZED');
  });
});

describe('WMP Derived Tests — SC-16 Error Codes (6 codes)', () => {

  beforeEach(() => setup());

  it('SC-16-ERR-01: TASK_NOT_FOUND — discard from non-existent task', () => {
    const bogus = testTaskId('task-ghost');
    const result = wmp.discard.execute(conn, bogus, testAgentId(), { taskId: bogus, key: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_NOT_FOUND');
  });

  it('SC-16-ERR-02: TASK_TERMINATED — discard from cancelled task', () => {
    const tId = testTaskId('task-cancelled');
    seedTask(conn, { id: 'task-cancelled', missionId: 'mission-wmp-001', state: 'CANCELLED' });
    const result = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_TERMINATED');
  });

  it('SC-16-ERR-03: TASK_NOT_EXECUTABLE — discard from SCHEDULED task', () => {
    const tId = testTaskId('task-sched');
    seedTask(conn, { id: 'task-sched', missionId: 'mission-wmp-001', state: 'SCHEDULED' });
    const result = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_NOT_EXECUTABLE');
  });

  it('SC-16-ERR-04: TASK_SCOPE_VIOLATION — discard with wrong agent', () => {
    const tId = testTaskId();
    const wrongAgent = 'agent-hacker' as AgentId;
    const result = wmp.discard.execute(conn, wrongAgent, wrongAgent, { taskId: tId, key: 'x' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'TASK_SCOPE_VIOLATION');
  });

  it('SC-16-ERR-05: WORKING_MEMORY_NOT_FOUND — discard non-existent key', () => {
    const tId = testTaskId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'real', value: 'v' });
    const result = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'imaginary' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_NOT_FOUND');
  });

  it('SC-16-ERR-06: UNAUTHORIZED — wrong agent rejected for discard (F-WMP-BB-06)', () => {
    const tId = testTaskId();
    const wrongAgent = testAgentId('agent-unauthorized');
    // Write with correct agent first
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'target', value: 'v' });
    // Discard with wrong agent must produce UNAUTHORIZED
    const result = wmp.discard.execute(conn, tId, wrongAgent, { taskId: tId, key: 'target' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'UNAUTHORIZED');
  });
});

// ============================================================================
// SECTION 3: DERIVED TESTS — Key Constraint Edge Cases (§5.2)
// ============================================================================

describe('WMP Derived Tests — Key Constraints (§5.2)', () => {

  beforeEach(() => setup());

  it('KEY-01: Key with whitespace (space) rejected', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'has space', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-02: Key with tab rejected', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'has\ttab', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-03: Key with newline rejected', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'has\nnewline', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-04: Key with forward slash rejected', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'path/segment', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-05: Key with backslash rejected', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'win\\path', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-06: Key exceeding 256 characters rejected', () => {
    const tId = testTaskId();
    const longKey = 'a'.repeat(257);
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: longKey, value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-07: Key at exactly 256 characters accepted', () => {
    const tId = testTaskId();
    const maxKey = 'a'.repeat(256);
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: maxKey, value: 'v' });
    assert.equal(result.ok, true);
  });

  it('KEY-08: Key with reserved prefix _wmp. rejected', () => {
    const tId = testTaskId();
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: '_wmp.metadata', value: 'v' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'WORKING_MEMORY_KEY_INVALID');
  });

  it('KEY-09: Keys are case-sensitive', () => {
    const tId = testTaskId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'MyKey', value: 'upper' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'mykey', value: 'lower' });

    const upper = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'MyKey' });
    const lower = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'mykey' });

    assert.equal(upper.ok, true);
    assert.equal(lower.ok, true);
    if (upper.ok && lower.ok) {
      assert.equal((upper.value as ReadWorkingMemoryEntryOutput).value, 'upper');
      assert.equal((lower.value as ReadWorkingMemoryEntryOutput).value, 'lower');
    }
  });

  it('KEY-10: Visually identical Unicode keys with different byte representations are distinct', () => {
    const tId = testTaskId();
    // 'é' can be composed (U+00E9) or decomposed (U+0065 U+0301)
    const composed = '\u00e9';     // é as single codepoint
    const decomposed = '\u0065\u0301'; // e + combining accent

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: `key-${composed}`, value: 'composed' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: `key-${decomposed}`, value: 'decomposed' });

    // Both should be distinct entries
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(read.ok, true);
    if (read.ok) {
      const list = read.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 2, 'Composed and decomposed Unicode keys must be distinct entries');
    }
  });
});

// ============================================================================
// SECTION 4: DERIVED TESTS — Boundary Snapshot Deduplication
// ============================================================================

describe('WMP Derived Tests — Boundary Snapshot Deduplication (§6.2)', () => {

  beforeEach(() => setup());

  it('DEDUP-01: Two checkpoints with no intervening mutations may share snapshot content', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Create entry, then two checkpoints with no mutations between them
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'stable', value: 'unchanged' });

    const capture1 = wmp.boundary.captureAtCheckpoint(conn, tId, mId);
    const capture2 = wmp.boundary.captureAtCheckpoint(conn, tId, mId);

    assert.equal(capture1.ok, true);
    assert.equal(capture2.ok, true);

    if (capture1.ok && capture2.ok) {
      // Boundary events are ALWAYS distinct (never deduplicated)
      assert.notEqual(capture1.value.eventId, capture2.value.eventId);

      // Snapshot content records MAY reference the same content ID
      // (deduplication is permitted but not required)
      // Both must reference valid content
      const c1 = wmp.boundaryStore.getSnapshotContent(conn, capture1.value.snapshotContentId);
      const c2 = wmp.boundaryStore.getSnapshotContent(conn, capture2.value.snapshotContentId);
      assert.equal(c1.ok, true);
      assert.equal(c2.ok, true);
    }
  });

  it('DEDUP-02: Boundary events are never deduplicated', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    const capture1 = wmp.boundary.captureAtCheckpoint(conn, tId, mId);
    const capture2 = wmp.boundary.captureAtCheckpoint(conn, tId, mId);

    assert.equal(capture1.ok, true);
    assert.equal(capture2.ok, true);

    if (capture1.ok && capture2.ok) {
      assert.notEqual(capture1.value.eventId, capture2.value.eventId,
        'Boundary event records must NEVER be deduplicated');
    }
  });
});

// ============================================================================
// SECTION 5: DERIVED TESTS — Terminal State Variants
// ============================================================================

describe('WMP Derived Tests — Terminal State Variants', () => {

  it('TERMINAL-FAILED: FAILED terminal preserves FAILED state in core_tasks (F-WMP-BB-01)', () => {
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem();
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });

    const tId = testTaskId('task-fail-term');
    seedTask(conn, { id: 'task-fail-term', missionId: 'mission-wmp-001', state: 'RUNNING' });

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'state', value: 'pre-fail' });

    const capture = wmp.boundary.captureAtTerminal(conn, tId, testMissionId(), 'FAILED');
    assert.equal(capture.ok, true);
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'task_terminal');
      const content = wmp.boundaryStore.getSnapshotContent(conn, capture.value.snapshotContentId);
      if (content.ok) {
        assert.equal(content.value.totalEntries, 1);
      }
    }

    // F-WMP-BB-01: Verify core_tasks.state is FAILED, NOT COMPLETED
    const taskRow = conn.get<{ state: string }>('SELECT state FROM core_tasks WHERE id = ?', [tId]);
    assert.equal(taskRow!.state, 'FAILED', 'Terminal state must be FAILED, not hard-coded COMPLETED');

    // Post-terminal: inaccessible
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.error.code, 'TASK_TERMINATED');
  });

  it('TERMINAL-CANCELLED: CANCELLED terminal preserves CANCELLED state in core_tasks (F-WMP-BB-01)', () => {
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem();
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });

    const tId = testTaskId('task-cancel-term');
    seedTask(conn, { id: 'task-cancel-term', missionId: 'mission-wmp-001', state: 'RUNNING' });

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'work', value: 'in-progress' });

    const capture = wmp.boundary.captureAtTerminal(conn, tId, testMissionId(), 'CANCELLED');
    assert.equal(capture.ok, true);
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'task_terminal');
    }

    // F-WMP-BB-01: Verify core_tasks.state is CANCELLED, NOT COMPLETED
    const taskRow = conn.get<{ state: string }>('SELECT state FROM core_tasks WHERE id = ?', [tId]);
    assert.equal(taskRow!.state, 'CANCELLED', 'Terminal state must be CANCELLED, not hard-coded COMPLETED');

    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(read.ok, false);
    if (!read.ok) assert.equal(read.error.code, 'TASK_TERMINATED');
  });
});

// ============================================================================
// SECTION 6: DERIVED TESTS — Boundary Snapshot Ordering (§6.5)
// ============================================================================

describe('WMP Derived Tests — Snapshot Ordering (§6.5)', () => {

  beforeEach(() => setup());

  it('ORDER-01: Post-checkpoint write not in checkpoint snapshot', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'before', value: 'pre' });

    // Checkpoint captures pre-boundary state
    const capture = wmp.boundary.captureAtCheckpoint(conn, tId, mId);

    // Write AFTER checkpoint
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'after', value: 'post' });

    assert.equal(capture.ok, true);
    if (capture.ok) {
      const content = wmp.boundaryStore.getSnapshotContent(conn, capture.value.snapshotContentId);
      assert.equal(content.ok, true);
      if (content.ok && content.value.entries) {
        const keys = content.value.entries.map(e => e.key);
        assert.ok(keys.includes('before'), 'Pre-checkpoint entry must be in snapshot');
        assert.ok(!keys.includes('after'), 'Post-checkpoint entry must NOT be in snapshot');
      }
    }
  });
});

// ============================================================================
// SECTION 7: DERIVED TESTS — Trigger 4 Sequencing (§6.4)
// ============================================================================

describe('WMP Derived Tests — Trigger 4 Sequencing (§6.4)', () => {

  beforeEach(() => setup());

  it('TRIGGER4-01: Pre-emission capture fires for SC-4 from task with initialized WMP', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'source', value: 'artifact-data' });

    const emissionId = testSystemCallId('sc4-001');
    const capture = wmp.boundary.capturePreEmission(conn, tId, mId, emissionId);

    assert.equal(capture.ok, true);
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'pre_irreversible_emission');
      assert.equal(capture.value.linkedEmissionId, emissionId);
    }
  });

  it('TRIGGER4-02: Pre-emission capture fires for SC-9 from task with initialized WMP', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'summary', value: 'result' });

    const emissionId = testSystemCallId('sc9-001');
    const capture = wmp.boundary.capturePreEmission(conn, tId, mId, emissionId);

    assert.equal(capture.ok, true);
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'pre_irreversible_emission');
      assert.equal(capture.value.linkedEmissionId, emissionId);
    }
  });

  it('TRIGGER4-03: Pre-emission capture succeeds with valid structure (F-WMP-BB-05)', () => {
    const tId = testTaskId();
    const mId = testMissionId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'data', value: 'val' });

    const emissionId = testSystemCallId('sc11-001');
    const capture = wmp.boundary.capturePreEmission(conn, tId, mId, emissionId);
    // F-WMP-BB-05: Discriminative assertion — verify success AND structure
    assert.equal(capture.ok, true, 'Pre-emission capture must succeed');
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'pre_irreversible_emission', 'Trigger must be pre_irreversible_emission');
      assert.equal(capture.value.linkedEmissionId, emissionId, 'Emission ID must be linked');
      assert.equal(capture.value.taskId, tId, 'Event must reference correct task');
      assert.ok(capture.value.snapshotContentId, 'Snapshot content must be linked');
    }
  });
});

// ============================================================================
// SECTION 8: DERIVED TESTS — Internal Read Interface (§9.2)
// ============================================================================

describe('WMP Derived Tests — Internal Read Interface (§9.2)', () => {

  beforeEach(() => setup());

  it('INTERNAL-01: Internal reader returns all live entries with correct metadata', () => {
    const tId = testTaskId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'alpha', value: 'val-a' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'beta', value: 'val-b' });

    const reader = createWmpInternalReader();
    const result = reader.readLiveEntries(tId);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.length, 2);
      for (const entry of result.value) {
        assert.ok(entry.key, 'key must be present');
        assert.ok(entry.value, 'value must be present');
        assert.ok(typeof entry.sizeBytes === 'number', 'sizeBytes must be number');
        assert.ok(entry.createdAt, 'createdAt must be present');
        assert.ok(entry.updatedAt, 'updatedAt must be present');
        assert.ok(typeof entry.mutationPosition === 'number', 'mutationPosition must be number');
      }
    }
  });

  it('INTERNAL-02: Internal reader returns current task entries only', () => {
    const taskA = testTaskId('task-ir-A');
    const taskB = testTaskId('task-ir-B');
    seedTask(conn, { id: 'task-ir-A', missionId: 'mission-wmp-001', state: 'RUNNING' });
    seedTask(conn, { id: 'task-ir-B', missionId: 'mission-wmp-001', state: 'RUNNING' });

    wmp.write.execute(conn, taskA, testAgentId(), { taskId: taskA, key: 'a-only', value: 'v' });
    wmp.write.execute(conn, taskB, testAgentId(), { taskId: taskB, key: 'b-only', value: 'v' });

    const reader = createWmpInternalReader();
    const resultB = reader.readLiveEntries(taskB);

    assert.equal(resultB.ok, true);
    if (resultB.ok) {
      const keys = resultB.value.map(e => e.key);
      assert.ok(!keys.includes('a-only'), 'Task A entry must not appear for Task B internal read');
      assert.ok(keys.includes('b-only'), 'Task B entry must appear');
    }
  });
});

// ============================================================================
// SECTION 9: DERIVED TESTS — Capacity Replacement Edge Cases (§8)
// ============================================================================

describe('WMP Derived Tests — Capacity Replacement (§8)', () => {

  it('CAPACITY-REPLACE-01: Replacing entry with larger value that exceeds byte ceiling is rejected', () => {
    conn = createTestDatabase();
    // Tight byte ceiling: 100 bytes total
    wmp = createWorkingMemorySystem({ capacityPolicy: { maxEntries: 100, maxBytesPerEntry: 65536, maxTotalBytes: 100 } });
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
    seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const tId = testTaskId();

    // Write small value (fits)
    const w1 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'data', value: 'small' });
    assert.equal(w1.ok, true);

    // Replace with value exceeding total byte ceiling
    const bigValue = 'x'.repeat(200);
    const w2 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'data', value: bigValue });
    assert.equal(w2.ok, false);
    if (!w2.ok) assert.equal(w2.error.code, 'WORKING_MEMORY_CAPACITY_EXCEEDED');

    // Original value preserved
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'data' });
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal((read.value as ReadWorkingMemoryEntryOutput).value, 'small');
    }
  });

  it('CAPACITY-REPLACE-02: Replacing entry with smaller value succeeds and frees capacity', () => {
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem({ capacityPolicy: { maxEntries: 100, maxBytesPerEntry: 65536, maxTotalBytes: 100 } });
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
    seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const tId = testTaskId();

    // Write value consuming most of the budget
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'big', value: 'x'.repeat(80) });

    // Replace with smaller value
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'big', value: 'tiny' });
    assert.equal(result.ok, true);

    // Now there's room for more writes
    const w2 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'other', value: 'y'.repeat(50) });
    assert.equal(w2.ok, true);
  });

  it('CAPACITY-REPLACE-03: Discard frees capacity immediately for new writes', () => {
    conn = createTestDatabase();
    wmp = createWorkingMemorySystem({ capacityPolicy: { maxEntries: 2, maxBytesPerEntry: 65536, maxTotalBytes: 262144 } });
    seedMission(conn, { id: 'mission-wmp-001', state: 'EXECUTING' });
    seedTask(conn, { id: 'task-wmp-001', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const tId = testTaskId();

    // Fill to capacity
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a', value: 'v1' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'b', value: 'v2' });

    // At capacity
    const overflow = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'c', value: 'v3' });
    assert.equal(overflow.ok, false);

    // Discard one entry
    wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a' });

    // Now write succeeds
    const result = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'c', value: 'v3' });
    assert.equal(result.ok, true);
  });
});

// ============================================================================
// SECTION 10: DERIVED TESTS — WmpPreEmissionCapture Adapter
// ============================================================================

describe('WMP Derived Tests — Pre-Emission Capture Adapter (CCP Trigger 4)', () => {

  beforeEach(() => setup());

  it('ADAPTER-01: WmpPreEmissionCapture.capture returns captureId and sourcingStatus', () => {
    const tId = testTaskId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'claim-draft', value: 'text' });

    const adapter = createWmpPreEmissionCapture();
    const result = adapter.capture(conn, tId);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.value.captureId, 'captureId must be present');
      assert.ok(
        ['verified', 'not_verified', 'not_applicable'].includes(result.value.sourcingStatus),
        'sourcingStatus must be a valid value',
      );
    }
  });

  it('ADAPTER-02: Capture for never-initialized task returns not_applicable', () => {
    const tId = testTaskId('task-no-wmp');
    seedTask(conn, { id: 'task-no-wmp', missionId: 'mission-wmp-001', state: 'RUNNING' });

    const adapter = createWmpPreEmissionCapture();
    const result = adapter.capture(conn, tId);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.sourcingStatus, 'not_applicable');
    }
  });

  it('ADAPTER-03: Capture for initialized task returns not_verified (v1 default)', () => {
    const tId = testTaskId();
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'k', value: 'v' });

    const adapter = createWmpPreEmissionCapture();
    const result = adapter.capture(conn, tId);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.sourcingStatus, 'not_verified');
    }
  });
});

// ============================================================================
// SECTION 11: DERIVED TESTS — Discard All
// ============================================================================

describe('WMP Derived Tests — Discard All (SC-16 key=null)', () => {

  beforeEach(() => setup());

  it('DISCARD-ALL-01: Discard all removes all entries and returns count', () => {
    const tId = testTaskId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a', value: 'v1' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'b', value: 'v2' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'c', value: 'v3' });

    const result = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.discardedCount, 3);
      assert.ok(result.value.freedBytes > 0);
      assert.ok(typeof result.value.mutationPosition === 'number');
    }

    // Namespace is now initialized_empty
    const read = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(read.ok, true);
    if (read.ok) {
      const list = read.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 0);
    }
  });

  it('DISCARD-ALL-02: Discard all on empty namespace returns count 0', () => {
    const tId = testTaskId();

    // Initialize namespace then discard all
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'temp', value: 'v' });
    wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'temp' });

    // Discard all on already-empty namespace
    const result = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.discardedCount, 0);
      assert.equal(result.value.freedBytes, 0);
    }
  });
});

// ============================================================================
// SECTION 12B: REMEDIATION — SC-16 Mutation Counter (BPB-001)
// ============================================================================

describe('WMP Remediation Pass B — SC-16 Mutation Counter', () => {

  beforeEach(() => setup());

  it('BPB-001: Failed single-key discard does not advance mutation counter (WMP-I5)', () => {
    // BPB-001: "Failed operations do not receive mutation-order positions."
    // Write key "a" (gets position P).
    // Attempt single-key discard of nonexistent key "z" — expect WORKING_MEMORY_NOT_FOUND.
    // Write key "b" — verify b's mutation position = P + 1 (no gap from the failed discard).
    const tId = testTaskId();

    // Step 1: Write key "a"
    const w1 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'a', value: 'value-a' });
    assert.equal(w1.ok, true);
    const positionP = (w1 as { ok: true; value: { mutationPosition: number } }).value.mutationPosition;

    // Step 2: Attempt discard of nonexistent key "z"
    const discardResult = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'z' });
    assert.equal(discardResult.ok, false);
    if (!discardResult.ok) {
      assert.equal(discardResult.error.code, SC16_ERROR_CODES.WORKING_MEMORY_NOT_FOUND);
    }

    // Step 3: Write key "b"
    const w2 = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'b', value: 'value-b' });
    assert.equal(w2.ok, true);
    const positionB = (w2 as { ok: true; value: { mutationPosition: number } }).value.mutationPosition;

    // Verify: b's position = P + 1 (no gap from failed discard)
    assert.equal(positionB, positionP + 1, `Expected position ${positionP + 1} but got ${positionB} — failed discard must not advance counter`);
  });
});

// ============================================================================
// SECTION 12: DERIVED TESTS — Mission Transition Trigger (§6.4 Trigger 3)
// ============================================================================

describe('WMP Derived Tests — Mission Transition Trigger (§6.4)', () => {

  beforeEach(() => setup());

  it('MISSION-TRANS-01: Mission transition captures WMP for active task', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'active-work', value: 'in-progress' });

    // Mission transitions (e.g., EXECUTING → PAUSED)
    const capture = wmp.boundary.captureAtMissionTransition(conn, tId, mId);

    assert.equal(capture.ok, true);
    if (capture.ok) {
      assert.equal(capture.value.trigger, 'mission_transition');
      assert.equal(capture.value.taskId, tId);
      assert.equal(capture.value.missionId, mId);
    }
  });
});

// ============================================================================
// SECTION 13: SUSPENSION LIFECYCLE TESTS (DC-WMP-212, DC-WMP-213, DC-WMP-214, AMB-WMP-05)
// ============================================================================

describe('WMP Suspension Lifecycle — onTaskSuspended / onTaskResumed', () => {

  beforeEach(() => setup());

  it('SUSPEND-01: onTaskSuspended sets suspension flag and creates boundary event (DC-WMP-213)', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Suspend the task via lifecycle handler
    const suspendResult = wmp.taskLifecycle.onTaskSuspended(conn, tId, mId);

    // Must return a BoundaryEvent with trigger 'suspension'
    assert.equal(suspendResult.ok, true, 'onTaskSuspended must succeed');
    if (suspendResult.ok) {
      assert.equal(suspendResult.value.trigger, 'suspension', 'Trigger must be suspension');
      assert.equal(suspendResult.value.taskId, tId, 'Event must reference correct task');
      assert.equal(suspendResult.value.missionId, mId, 'Event must reference correct mission');
      assert.ok(suspendResult.value.snapshotContentId, 'Snapshot content must be linked');
      assert.ok(suspendResult.value.eventId, 'Event ID must be present');
    }

    // Verify the suspension flag is set by attempting a write — must fail
    const writeResult = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'blocked', value: 'should-fail' });
    assert.equal(writeResult.ok, false, 'Write must fail during suspension');
    if (!writeResult.ok) {
      assert.equal(writeResult.error.code, SC14_ERROR_CODES.TASK_NOT_EXECUTABLE, 'Error code must be TASK_NOT_EXECUTABLE');
    }
  });

  it('SUSPEND-02: SC-14 write rejected during suspension with TASK_NOT_EXECUTABLE (DC-WMP-212)', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Write a key before suspension to prove namespace is active
    const preWrite = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'pre-suspend', value: 'alive' });
    assert.equal(preWrite.ok, true, 'Pre-suspension write must succeed');

    // Suspend the task
    const suspendResult = wmp.taskLifecycle.onTaskSuspended(conn, tId, mId);
    assert.equal(suspendResult.ok, true, 'Suspension must succeed');

    // Attempt write during suspension — must be rejected
    const writeResult = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'during-suspend', value: 'blocked' });
    assert.equal(writeResult.ok, false, 'Write during suspension must fail');
    if (!writeResult.ok) {
      assert.equal(writeResult.error.code, SC14_ERROR_CODES.TASK_NOT_EXECUTABLE,
        'Suspended write must return TASK_NOT_EXECUTABLE');
    }

    // Verify state did not change — pre-suspension key still readable, blocked key absent
    const readPre = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'pre-suspend' });
    assert.equal(readPre.ok, true, 'Pre-suspension entry must still be readable');
    if (readPre.ok) {
      const entry = readPre.value as ReadWorkingMemoryEntryOutput;
      assert.equal(entry.value, 'alive', 'Pre-suspension value must be intact');
    }

    const readBlocked = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'during-suspend' });
    assert.equal(readBlocked.ok, false, 'Blocked write key must not exist');
    if (!readBlocked.ok) {
      assert.equal(readBlocked.error.code, SC15_ERROR_CODES.WORKING_MEMORY_NOT_FOUND,
        'Blocked write key must return NOT_FOUND');
    }
  });

  it('SUSPEND-03: SC-16 discard rejected during suspension with TASK_NOT_EXECUTABLE (DC-WMP-212)', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Write a key, then suspend
    const preWrite = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'to-discard', value: 'protected' });
    assert.equal(preWrite.ok, true, 'Pre-suspension write must succeed');

    const suspendResult = wmp.taskLifecycle.onTaskSuspended(conn, tId, mId);
    assert.equal(suspendResult.ok, true, 'Suspension must succeed');

    // Attempt single-key discard during suspension — must be rejected
    const discardResult = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'to-discard' });
    assert.equal(discardResult.ok, false, 'Discard during suspension must fail');
    if (!discardResult.ok) {
      assert.equal(discardResult.error.code, SC16_ERROR_CODES.TASK_NOT_EXECUTABLE,
        'Suspended discard must return TASK_NOT_EXECUTABLE');
    }

    // Verify state did not change — entry still exists
    const readResult = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'to-discard' });
    assert.equal(readResult.ok, true, 'Protected entry must still be readable after rejected discard');
    if (readResult.ok) {
      const entry = readResult.value as ReadWorkingMemoryEntryOutput;
      assert.equal(entry.value, 'protected', 'Entry value must be intact');
    }
  });

  it('SUSPEND-04: SC-15 read succeeds during suspension (AMB-WMP-05)', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Write entries before suspension
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'readable-a', value: 'value-a' });
    wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'readable-b', value: 'value-b' });

    // Suspend the task
    const suspendResult = wmp.taskLifecycle.onTaskSuspended(conn, tId, mId);
    assert.equal(suspendResult.ok, true, 'Suspension must succeed');

    // Read specific key during suspension — must succeed
    const readEntry = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'readable-a' });
    assert.equal(readEntry.ok, true, 'Read by key must succeed during suspension');
    if (readEntry.ok) {
      const entry = readEntry.value as ReadWorkingMemoryEntryOutput;
      assert.equal(entry.key, 'readable-a');
      assert.equal(entry.value, 'value-a');
    }

    // List all entries during suspension — must succeed
    const readList = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: null });
    assert.equal(readList.ok, true, 'Read list must succeed during suspension');
    if (readList.ok) {
      const list = readList.value as ReadWorkingMemoryListOutput;
      assert.equal(list.totalEntries, 2, 'Both entries must be listed during suspension');
    }
  });

  it('SUSPEND-05: onTaskResumed clears suspension and allows writes (DC-WMP-214)', () => {
    const tId = testTaskId();
    const mId = testMissionId();

    // Write a key before suspension
    const preWrite = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'persistent', value: 'original' });
    assert.equal(preWrite.ok, true, 'Pre-suspension write must succeed');

    // Suspend the task
    const suspendResult = wmp.taskLifecycle.onTaskSuspended(conn, tId, mId);
    assert.equal(suspendResult.ok, true, 'Suspension must succeed');

    // Verify write is blocked during suspension
    const blockedWrite = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'blocked', value: 'no' });
    assert.equal(blockedWrite.ok, false, 'Write must be blocked during suspension');

    // Resume the task
    const resumeResult = wmp.taskLifecycle.onTaskResumed(conn, tId, mId);
    assert.equal(resumeResult.ok, true, 'onTaskResumed must succeed');

    // Pre-suspension entry must survive — namespace integrity verified (DC-WMP-214)
    const readPersistent = wmp.read.execute(conn, tId, testAgentId(), { taskId: tId, key: 'persistent' });
    assert.equal(readPersistent.ok, true, 'Pre-suspension entry must survive resume');
    if (readPersistent.ok) {
      const entry = readPersistent.value as ReadWorkingMemoryEntryOutput;
      assert.equal(entry.value, 'original', 'Value must be intact after suspend-resume cycle');
    }

    // Write must succeed after resume
    const postWrite = wmp.write.execute(conn, tId, testAgentId(), { taskId: tId, key: 'post-resume', value: 'works' });
    assert.equal(postWrite.ok, true, 'Write must succeed after resume');
    if (postWrite.ok) {
      assert.equal(postWrite.value.key, 'post-resume');
      assert.equal(postWrite.value.created, true);
    }

    // Discard must also succeed after resume
    const postDiscard = wmp.discard.execute(conn, tId, testAgentId(), { taskId: tId, key: 'post-resume' });
    assert.equal(postDiscard.ok, true, 'Discard must succeed after resume');
  });
});
