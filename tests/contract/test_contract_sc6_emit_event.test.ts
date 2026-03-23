/**
 * SC-6 Contract Tests: emit_event -- Facade-Level Verification
 * S ref: S20 (emit_event), S10 (Event), FM-13 (unbounded autonomy),
 *        CF-007 (rate limiting), CF-013 (payload size), I-03 (atomic audit)
 *
 * Phase: 2C (System Call Contracts)
 * Tests through: createOrchestration() facade (NOT EventPropagator.emit directly)
 *
 * SC-6 requires a missionId, so each test must first:
 *   1. Create a mission via engine.proposeMission()
 *   2. Then test engine.emitEvent()
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
} from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, MissionId } from '../../src/kernel/interfaces/index.js';
import type { OrchestrationEngine } from '../../src/orchestration/index.js';
import type {
  ProposeMissionInput,
  EmitEventInput,
  PropagationDirection,
} from '../../src/orchestration/interfaces/orchestration.js';

// ─── Test Infrastructure ───

let conn: DatabaseConnection;
let ctx: OperationContext;
let engine: OrchestrationEngine;

/**
 * Setup: create a fresh in-memory database with full schema,
 * then create the orchestration engine through createOrchestration().
 * SC-6 does NOT inject a kernel rateLimiter — the fallback in-memory
 * Map-based limiter is exercised (line 47-56 of event_propagation.ts).
 */
function setup(): void {
  const { deps, conn: c, audit } = createTestOrchestrationDeps();
  conn = c;
  ctx = createTestOperationContext();
  engine = createOrchestration(conn, deps.substrate, audit);
}

/** S15: Create a mission through the facade for SC-6 tests to operate on */
function createTestMission(overrides: Partial<ProposeMissionInput> = {}): MissionId {
  const input: ProposeMissionInput = {
    parentMissionId: null,
    agentId: agentId('agent-1'),
    objective: 'Test mission for event emission',
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

/** Construct a valid EmitEventInput */
function validEventInput(
  mid: MissionId,
  overrides: Partial<EmitEventInput> = {},
): EmitEventInput {
  return {
    eventType: 'test.custom_event',
    missionId: mid,
    payload: { key: 'value' },
    propagation: 'local' as PropagationDirection,
    ...overrides,
  };
}

// ─── A21 State-Unchanged Verification ───

/** Count events in core_events_log matching a specific type */
function countEventsByType(conn: DatabaseConnection, eventType: string): number {
  return conn.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM core_events_log WHERE type = ?',
    [eventType],
  )?.cnt ?? 0;
}

/** Count all events in core_events_log */
function countAllEvents(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM core_events_log',
  )?.cnt ?? 0;
}

/** Count emit_event audit entries */
function countEmitEventAuditEntries(conn: DatabaseConnection): number {
  return conn.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM core_audit_log WHERE operation = 'emit_event'",
  )?.cnt ?? 0;
}

/** Snapshot state before a rejection test */
function snapshotState(conn: DatabaseConnection, eventType: string): {
  eventCount: number;
  totalEvents: number;
  auditEntries: number;
} {
  return {
    eventCount: countEventsByType(conn, eventType),
    totalEvents: countAllEvents(conn),
    auditEntries: countEmitEventAuditEntries(conn),
  };
}

/**
 * A21: Assert state unchanged after a rejection.
 * Verifies: no new events of that type, no new total events,
 * no new emit_event audit entries.
 */
function assertStateUnchanged(
  conn: DatabaseConnection,
  before: ReturnType<typeof snapshotState>,
  eventType: string,
  label: string,
): void {
  const afterTypeCount = countEventsByType(conn, eventType);
  assert.equal(afterTypeCount, before.eventCount,
    `${label}: Event count for type '${eventType}' must not change after rejection (before=${before.eventCount}, after=${afterTypeCount})`);

  const afterTotal = countAllEvents(conn);
  assert.equal(afterTotal, before.totalEvents,
    `${label}: Total event count must not change after rejection (before=${before.totalEvents}, after=${afterTotal})`);

  const afterAudits = countEmitEventAuditEntries(conn);
  assert.equal(afterAudits, before.auditEntries,
    `${label}: emit_event audit count must not change after rejection (before=${before.auditEntries}, after=${afterAudits})`);
}

describe('SC-6 Contract: emit_event (Facade-Level)', () => {
  beforeEach(() => { setup(); });

  // ════════════════════════════════════════════════════════════════════════
  // SUCCESS PATH
  // ════════════════════════════════════════════════════════════════════════

  describe('Success Path', () => {

    it('SC6-SUCCESS-LOCAL-EVENT: emit event with propagation=local -- returns eventId, delivered=true, event in core_events_log', () => {
      const mid = createTestMission();

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType: 'test.local_event',
        propagation: 'local',
      }));

      assert.equal(result.ok, true, 'S20: Local event emission must succeed');
      if (!result.ok) return;

      assert.equal(typeof result.value.eventId, 'string', 'S20: eventId must be a string');
      assert.notEqual((result.value.eventId as string).length, 0, 'S20: eventId must be non-empty');
      assert.equal(result.value.delivered, true, 'S20: delivered must be true');

      // Verify event stored in core_events_log
      const row = conn.get<{
        id: string; type: string; scope: string; mission_id: string;
        propagation: string; emitted_by: string; payload_json: string;
      }>(
        'SELECT id, type, scope, mission_id, propagation, emitted_by, payload_json FROM core_events_log WHERE id = ?',
        [result.value.eventId],
      );
      assert.notEqual(row, undefined, 'S20: Event must be stored in core_events_log');
      assert.equal(row!.type, 'test.local_event', 'S20: Stored event type must match input');
      assert.equal(row!.scope, 'mission', 'S20: Event scope must be mission for agent-emitted events');
      assert.equal(row!.mission_id, mid, 'S20: Stored mission_id must match input');
      assert.equal(row!.propagation, 'local', 'S20: Stored propagation must be local');
    });

    it('SC6-SUCCESS-UP-PROPAGATION: emit from child with propagation=up -- event appears for child AND parent mission', () => {
      // Create parent mission
      const parentDeadline = new Date(Date.now() + 3600000).toISOString();
      const parentMid = createTestMission({
        objective: 'Parent mission for up-propagation test',
        constraints: { budget: 50000, deadline: parentDeadline },
      });

      // Create child mission under parent (FM-19: different agentId to avoid delegation cycle,
      // S15: budget within decay factor 0.3 × 50000 = 15000)
      const childMid = createTestMission({
        parentMissionId: parentMid,
        agentId: agentId('agent-child-1'),
        objective: 'Child mission for up-propagation test',
        constraints: { budget: 10000, deadline: parentDeadline },
      });

      const result = engine.emitEvent(ctx, validEventInput(childMid, {
        eventType: 'test.up_propagation',
        propagation: 'up',
        payload: { direction: 'up' },
      }));

      assert.equal(result.ok, true, 'S20: Up-propagation event emission must succeed');
      if (!result.ok) return;
      assert.equal(result.value.delivered, true, 'S20: delivered must be true');

      // Verify event stored for the child mission (original emitter)
      const childEvent = conn.get<{ id: string; mission_id: string }>(
        "SELECT id, mission_id FROM core_events_log WHERE type = 'test.up_propagation' AND mission_id = ?",
        [childMid],
      );
      assert.notEqual(childEvent, undefined, 'S20: Event must exist for child mission');
      assert.equal(childEvent!.mission_id, childMid, 'S20: Child event mission_id must match');

      // Verify propagated copy stored for the parent mission
      const parentEvent = conn.get<{ id: string; mission_id: string; propagation: string }>(
        "SELECT id, mission_id, propagation FROM core_events_log WHERE type = 'test.up_propagation' AND mission_id = ?",
        [parentMid],
      );
      assert.notEqual(parentEvent, undefined, 'S20: Propagated event must exist for parent mission');
      assert.equal(parentEvent!.mission_id, parentMid, 'S20: Parent event mission_id must match parent');
      assert.equal(parentEvent!.propagation, 'local', 'S20: Propagated copy must have propagation=local');
    });

    it('SC6-SUCCESS-DOWN-PROPAGATION: emit from parent with propagation=down -- event appears for parent AND child', () => {
      // Create parent mission
      const parentDeadline = new Date(Date.now() + 3600000).toISOString();
      const parentMid = createTestMission({
        objective: 'Parent mission for down-propagation test',
        constraints: { budget: 50000, deadline: parentDeadline },
      });

      // Create child mission under parent (FM-19: different agentId to avoid delegation cycle,
      // S15: budget within decay factor 0.3 × 50000 = 15000)
      const childMid = createTestMission({
        parentMissionId: parentMid,
        agentId: agentId('agent-child-2'),
        objective: 'Child mission for down-propagation test',
        constraints: { budget: 10000, deadline: parentDeadline },
      });

      const result = engine.emitEvent(ctx, validEventInput(parentMid, {
        eventType: 'test.down_propagation',
        propagation: 'down',
        payload: { direction: 'down' },
      }));

      assert.equal(result.ok, true, 'S20: Down-propagation event emission must succeed');
      if (!result.ok) return;
      assert.equal(result.value.delivered, true, 'S20: delivered must be true');

      // Verify event stored for the parent mission (original emitter)
      const parentEvent = conn.get<{ id: string; mission_id: string }>(
        "SELECT id, mission_id FROM core_events_log WHERE type = 'test.down_propagation' AND mission_id = ?",
        [parentMid],
      );
      assert.notEqual(parentEvent, undefined, 'S20: Event must exist for parent mission');
      assert.equal(parentEvent!.mission_id, parentMid, 'S20: Parent event mission_id must match');

      // Verify propagated copy stored for the child mission
      const childEvent = conn.get<{ id: string; mission_id: string; propagation: string }>(
        "SELECT id, mission_id, propagation FROM core_events_log WHERE type = 'test.down_propagation' AND mission_id = ?",
        [childMid],
      );
      assert.notEqual(childEvent, undefined, 'S20: Propagated event must exist for child mission');
      assert.equal(childEvent!.mission_id, childMid, 'S20: Child event mission_id must match child');
      assert.equal(childEvent!.propagation, 'local', 'S20: Propagated copy must have propagation=local');
    });

    it('SC6-SUCCESS-AUDIT-ENTRY: emit event -- audit entry exists with operation=emit_event', () => {
      const mid = createTestMission();

      const auditsBefore = countEmitEventAuditEntries(conn);

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType: 'test.audit_verification',
      }));

      assert.equal(result.ok, true, 'S20: Event emission must succeed');
      if (!result.ok) return;

      // I-03: Verify audit entry created atomically
      const auditsAfter = countEmitEventAuditEntries(conn);
      assert.equal(auditsAfter, auditsBefore + 1,
        'I-03: Exactly one emit_event audit entry must be created');

      const auditRow = conn.get<{
        operation: string; resource_type: string; resource_id: string;
      }>(
        "SELECT operation, resource_type, resource_id FROM core_audit_log WHERE operation = 'emit_event' AND resource_id = ?",
        [result.value.eventId],
      );
      assert.notEqual(auditRow, undefined, 'I-03: Audit entry must exist');
      assert.equal(auditRow!.operation, 'emit_event', 'I-03: operation must be emit_event');
      assert.equal(auditRow!.resource_type, 'event', 'I-03: resource_type must be event');
      assert.equal(auditRow!.resource_id, result.value.eventId as string,
        'I-03: resource_id must match the emitted eventId');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // ERROR PATHS -- A21 Dual-Path (rejection code + state unchanged)
  // ════════════════════════════════════════════════════════════════════════

  describe('Error Paths -- A21 Rejection Verification', () => {

    it('SC6-ERR-INVALID-TYPE-SYSTEM: emit eventType=system.internal -- INVALID_TYPE + state unchanged', () => {
      const mid = createTestMission();
      const eventType = 'system.internal';

      const before = snapshotState(conn, eventType);

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType,
      }));

      assert.equal(result.ok, false, 'SD-09: Must reject reserved namespace system.*');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TYPE',
          'SD-09: Error code must be INVALID_TYPE for system.* namespace');
      }

      assertStateUnchanged(conn, before, eventType, 'INVALID_TYPE (system.*)');
    });

    it('SC6-ERR-INVALID-TYPE-LIFECYCLE: emit eventType=lifecycle.checkpoint -- INVALID_TYPE + state unchanged', () => {
      const mid = createTestMission();
      const eventType = 'lifecycle.checkpoint';

      const before = snapshotState(conn, eventType);

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType,
      }));

      assert.equal(result.ok, false, 'SD-09: Must reject reserved namespace lifecycle.*');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TYPE',
          'SD-09: Error code must be INVALID_TYPE for lifecycle.* namespace');
      }

      assertStateUnchanged(conn, before, eventType, 'INVALID_TYPE (lifecycle.*)');
    });

    it('SC6-ERR-MISSION-NOT-FOUND: emit for nonexistent missionId -- MISSION_NOT_FOUND + state unchanged', () => {
      const fakeMid = 'nonexistent-mission-xyz' as MissionId;
      const eventType = 'test.nonexistent_mission';

      const before = snapshotState(conn, eventType);

      const result = engine.emitEvent(ctx, validEventInput(fakeMid, {
        eventType,
      }));

      assert.equal(result.ok, false, 'S20: Must reject event for nonexistent mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_FOUND',
          'S20: Error code must be MISSION_NOT_FOUND');
      }

      assertStateUnchanged(conn, before, eventType, 'MISSION_NOT_FOUND');
    });

    it('SC6-ERR-RATE-LIMITED: emit 11 events rapidly (>10/min limit) -- 11th returns RATE_LIMITED + state unchanged', () => {
      const mid = createTestMission();
      const eventType = 'test.rate_limit_event';

      // Emit 10 events successfully (within rate limit)
      for (let i = 0; i < 10; i++) {
        const r = engine.emitEvent(ctx, validEventInput(mid, {
          eventType,
          payload: { index: i },
        }));
        assert.equal(r.ok, true, `FM-13: Event ${i + 1}/10 must succeed (within rate limit)`);
      }

      // Snapshot state AFTER the 10 successful events
      const before = snapshotState(conn, eventType);

      // 11th event should be rate-limited
      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType,
        payload: { index: 10 },
      }));

      assert.equal(result.ok, false, 'FM-13/CF-007: 11th event must be rate-limited');
      if (!result.ok) {
        assert.equal(result.error.code, 'RATE_LIMITED',
          'FM-13/CF-007: Error code must be RATE_LIMITED');
      }

      assertStateUnchanged(conn, before, eventType, 'RATE_LIMITED');
    });

    it('SC6-ERR-PAYLOAD-SIZE-EXCEEDED: emit event with payload > 64KB -- INVALID_INPUT + state unchanged', () => {
      const mid = createTestMission();
      const eventType = 'test.oversized_payload';

      // CF-013: 64KB = 65,536 bytes. Create a payload that exceeds this.
      const largeValue = 'X'.repeat(70_000);
      const oversizedPayload = { data: largeValue };

      const before = snapshotState(conn, eventType);

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType,
        payload: oversizedPayload,
      }));

      assert.equal(result.ok, false, 'CF-013: Must reject event payload exceeding 64KB');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_INPUT',
          'CF-013: Error code must be INVALID_INPUT for oversized payload');
        assert.ok(result.error.message.includes('exceeds maximum size'),
          'CF-013: Error message must describe the size violation');
      }

      assertStateUnchanged(conn, before, eventType, 'PAYLOAD_SIZE_EXCEEDED');
    });

    it('SC6-ERR-INVALID-TYPE-CASE-VARIANT: emit eventType=System.Internal (mixed case) -- INVALID_TYPE + state unchanged', () => {
      const mid = createTestMission();
      const eventType = 'System.Internal';

      const before = snapshotState(conn, eventType);

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType,
      }));

      assert.equal(result.ok, false, 'SD-09: Must reject case-variant reserved namespace');
      if (!result.ok) {
        assert.equal(result.error.code, 'INVALID_TYPE',
          'SD-09: Error code must be INVALID_TYPE for case-variant reserved namespace');
      }

      assertStateUnchanged(conn, before, eventType, 'INVALID_TYPE_CASE_VARIANT');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // COMPOSITION TESTS -- Facade-Level Verification
  // ════════════════════════════════════════════════════════════════════════

  describe('Composition -- Facade-Level Verification', () => {

    it('SC6-EVENT-PAYLOAD-PRESERVED: emit event with complex payload object -- stored payload_json matches input', () => {
      const mid = createTestMission();

      const complexPayload = {
        action: 'data_processed',
        metrics: { count: 42, rate: 3.14 },
        tags: ['alpha', 'beta', 'gamma'],
        nested: { deep: { value: true } },
        nullField: null,
      };

      const result = engine.emitEvent(ctx, validEventInput(mid, {
        eventType: 'test.complex_payload',
        payload: complexPayload,
      }));

      assert.equal(result.ok, true, 'S20: Event with complex payload must succeed');
      if (!result.ok) return;

      // Verify stored payload matches input
      const row = conn.get<{ payload_json: string }>(
        'SELECT payload_json FROM core_events_log WHERE id = ?',
        [result.value.eventId],
      );
      assert.notEqual(row, undefined, 'S20: Event row must exist in core_events_log');

      const stored = JSON.parse(row!.payload_json) as Record<string, unknown>;

      assert.equal(stored.action, 'data_processed',
        'S20: payload.action must be preserved');
      assert.deepStrictEqual(stored.metrics, { count: 42, rate: 3.14 },
        'S20: payload.metrics must be preserved with numeric values');
      assert.deepStrictEqual(stored.tags, ['alpha', 'beta', 'gamma'],
        'S20: payload.tags array must be preserved');
      assert.deepStrictEqual(stored.nested, { deep: { value: true } },
        'S20: payload nested objects must be preserved');
      assert.equal(stored.nullField, null,
        'S20: payload null values must be preserved');
    });
  });
});
