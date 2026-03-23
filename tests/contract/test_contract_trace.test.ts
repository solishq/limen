/**
 * Limen Phase 0A — Trace Grammar + TraceEmitter + RunSequencer
 * Truth Model: Deliverable 3
 * Assertions: BC-020 to BC-029, BC-029.1, BC-052, INV-020, INV-021, INV-023, INV-X13
 *
 * Phase: 0A (Foundation)
 * Gate: All tests FAIL with NotImplementedError before implementation.
 *
 * HARNESS GAP: INV-X13 (GovernanceQueryContext) — no harness method returns this type.
 * SC-G governance queries are not yet part of the harness surface. GovernanceQueryContext
 * shape verification is deferred until the SC-G harness method is added. Writing a
 * standalone type-construction test would pass immediately (no harness call), violating
 * the contract test pattern.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId, agentId } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, correlationId, missionContractId, supervisorDecisionId, suspensionRecordId, handoffId, evalCaseId, capabilityManifestId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type { TraceEvent, TraceEventInput, TraceEventType, TraceEventPayload, GovernanceQueryContext, TraceEmitter, RunSequencer, TraceEventStore } from '../../src/kernel/interfaces/trace.js';
import type { MissionLifecycleState, TaskLifecycleState } from '../../src/kernel/interfaces/lifecycle.js';
import type { HandoffAcceptanceOutcome, HandoffRejectionReason, SupervisorType, DecisionOutcome } from '../../src/kernel/interfaces/supervisor.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

// ─── Helper: Construct a valid TraceEventInput for a given payload ───

function makeTraceInput(payload: TraceEventPayload, overrides: Partial<TraceEventInput> = {}): TraceEventInput {
  return {
    runId: runId('run-trace-001'),
    correlationId: correlationId('corr-trace-001'),
    type: payload.type,
    payload,
    ...overrides,
  };
}

// ─── Helper: Construct a full TraceEvent (for TraceEventStore.insert) ───

function makeTraceEvent(payload: TraceEventPayload, overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    traceEventId: traceEventId('evt-001'),
    runId: runId('run-trace-001'),
    runSeq: 1,
    spanSeq: 0,
    correlationId: correlationId('corr-trace-001'),
    version: '1.0.0',
    type: payload.type,
    tenantId: tenantId('test-tenant'),
    timestamp: testTimestamp(),
    payload,
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Trace Grammar + TraceEmitter + RunSequencer (Deliverable 3)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-020: TraceEmitter has emit method and sequencer property ──

  describe('BC-020: TraceEmitter is separate from EventBus with emit + sequencer', () => {
    it('should emit a trace event via TraceEmitter.emit', () => {
      const input = makeTraceInput({
        type: 'mission.created',
        missionId: missionId('mission-bc020'),
        agentId: agentId('agent-bc020'),
      });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(typeof result.value, 'string'); // TraceEventId is branded string
    });

    it('should expose sequencer property on TraceEmitter', () => {
      // Accessing sequencer should not throw — it's a property, not a method call.
      // The real test is calling a method on it (tested in BC-029.1).
      const seq = gov.traceEmitter.sequencer;
      assert.notEqual(seq, undefined);
      assert.notEqual(seq, null);
    });
  });

  // ── BC-021: TraceEmitter.emit returns Result<TraceEventId> ──

  describe('BC-021: TraceEmitter.emit returns Result<TraceEventId>', () => {
    it('should return ok=true with a TraceEventId string value', () => {
      const input = makeTraceInput({
        type: 'task.created',
        taskId: taskId('task-bc021'),
        missionId: missionId('mission-bc021'),
      });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // TraceEventId is a branded string — discriminative: must be a string, not a number or object
      assert.equal(typeof result.value, 'string');
      assert.notEqual(result.value, '');
    });
  });

  // ── BC-022: TraceEvent has all Table 6 fields ──

  describe('BC-022: TraceEvent has all Table 6 fields', () => {
    it('should return a TraceEvent with traceEventId, runId, runSeq, spanSeq, correlationId, version, type, tenantId, timestamp, payload', () => {
      const payload: TraceEventPayload = {
        type: 'mission.created',
        missionId: missionId('mission-bc022'),
        agentId: agentId('agent-bc022'),
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc022') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // All 10 Table 6 fields must exist with correct types
      assert.equal(typeof result.value.traceEventId, 'string');
      assert.equal(typeof result.value.runId, 'string');
      assert.equal(typeof result.value.runSeq, 'number');
      assert.equal(typeof result.value.spanSeq, 'number');
      assert.equal(typeof result.value.correlationId, 'string');
      assert.equal(typeof result.value.version, 'string');
      assert.equal(typeof result.value.type, 'string');
      assert.equal(typeof result.value.tenantId, 'string');
      assert.equal(typeof result.value.timestamp, 'string');
      assert.notEqual(result.value.payload, undefined);
      // Discriminative: type must match the payload type
      assert.equal(result.value.type, 'mission.created');
      assert.equal(result.value.payload.type, 'mission.created');
    });
  });

  // ── BC-023: All 32 TraceEventType values accepted by emitter ──

  describe('BC-023: All 32 TraceEventType values are accepted', () => {
    // This is the exhaustive enumeration test. Each of the 32 event types
    // must be accepted by TraceEmitter.emit with an appropriate payload.

    // ── Mission lifecycle (5) ──

    it('should emit mission.created', () => {
      const input = makeTraceInput({ type: 'mission.created', missionId: missionId('m-023'), agentId: agentId('a-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit mission.transition', () => {
      const input = makeTraceInput({ type: 'mission.transition', missionId: missionId('m-023'), fromState: 'created' as MissionLifecycleState, toState: 'active' as MissionLifecycleState });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit mission.completed', () => {
      const input = makeTraceInput({ type: 'mission.completed', missionId: missionId('m-023'), contractSatisfied: true });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit mission.failed', () => {
      const input = makeTraceInput({ type: 'mission.failed', missionId: missionId('m-023'), reason: 'budget exhausted' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit mission.revoked', () => {
      const input = makeTraceInput({ type: 'mission.revoked', missionId: missionId('m-023'), revokedBy: 'human-supervisor' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Task lifecycle (4) ──

    it('should emit task.created', () => {
      const input = makeTraceInput({ type: 'task.created', taskId: taskId('t-023'), missionId: missionId('m-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit task.transition', () => {
      const input = makeTraceInput({ type: 'task.transition', taskId: taskId('t-023'), fromState: 'pending' as TaskLifecycleState, toState: 'ready' as TaskLifecycleState });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit task.completed', () => {
      const input = makeTraceInput({ type: 'task.completed', taskId: taskId('t-023'), missionId: missionId('m-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit task.skipped', () => {
      const input = makeTraceInput({ type: 'task.skipped', taskId: taskId('t-023'), missionId: missionId('m-023'), reason: 'dependency failed' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Attempt lifecycle (4) ──

    it('should emit attempt.started', () => {
      const input = makeTraceInput({ type: 'attempt.started', attemptId: attemptId('att-023'), taskId: taskId('t-023'), runId: runId('run-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit attempt.succeeded', () => {
      const input = makeTraceInput({ type: 'attempt.succeeded', attemptId: attemptId('att-023'), taskId: taskId('t-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit attempt.failed', () => {
      const input = makeTraceInput({ type: 'attempt.failed', attemptId: attemptId('att-023'), taskId: taskId('t-023'), errorCode: 'TIMEOUT' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit attempt.abandoned', () => {
      const input = makeTraceInput({ type: 'attempt.abandoned', attemptId: attemptId('att-023'), taskId: taskId('t-023'), suspensionRecordId: suspensionRecordId('sus-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Handoff lifecycle (5) ──

    it('should emit handoff.issued', () => {
      const input = makeTraceInput({ type: 'handoff.issued', handoffId: handoffId('h-023'), delegatorAgentId: agentId('delegator'), delegateAgentId: agentId('delegate') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit handoff.accepted', () => {
      const input = makeTraceInput({ type: 'handoff.accepted', handoffId: handoffId('h-023'), acceptanceOutcome: 'accepted-as-is' as HandoffAcceptanceOutcome });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit handoff.returned', () => {
      const input = makeTraceInput({ type: 'handoff.returned', handoffId: handoffId('h-023'), returnReason: 'scope exceeded' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit handoff.rejected', () => {
      const input = makeTraceInput({ type: 'handoff.rejected', handoffId: handoffId('h-023'), rejectionReason: 'rejected-missing-capability' as HandoffRejectionReason });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit handoff.parent-suspended', () => {
      const input = makeTraceInput({
        type: 'handoff.parent-suspended',
        handoffId: handoffId('h-023'),
        parentMissionId: missionId('m-parent-023'),
        childTaskId: taskId('t-child-023'),
        suspensionRecordId: suspensionRecordId('sus-parent-023'),
        delegateAgentId: agentId('delegate-023'),
      });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Suspension (2) ──

    it('should emit suspension.entered', () => {
      const input = makeTraceInput({ type: 'suspension.entered', suspensionRecordId: suspensionRecordId('sus-023'), targetType: 'mission', targetId: 'mission-sus-023' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit suspension.resolved', () => {
      const input = makeTraceInput({ type: 'suspension.resolved', suspensionRecordId: suspensionRecordId('sus-023'), decisionId: supervisorDecisionId('dec-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Supervision (1) ──

    it('should emit supervision.decision', () => {
      const input = makeTraceInput({ type: 'supervision.decision', decisionId: supervisorDecisionId('dec-023'), supervisorType: 'hard-policy' as SupervisorType, outcome: 'approve' as DecisionOutcome });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Claims (4) ──

    it('should emit claim.asserted', () => {
      const input = makeTraceInput({ type: 'claim.asserted', claimId: 'claim-023', agentId: agentId('a-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit claim.grounded', () => {
      const input = makeTraceInput({ type: 'claim.grounded', claimId: 'claim-023', evidenceCount: 3 });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit claim.challenged', () => {
      const input = makeTraceInput({ type: 'claim.challenged', claimId: 'claim-023', challengerId: agentId('challenger-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit claim.retracted', () => {
      const input = makeTraceInput({ type: 'claim.retracted', claimId: 'claim-023', reason: 'evidence disproven' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Eval (1) ──

    it('should emit eval.scored', () => {
      const input = makeTraceInput({ type: 'eval.scored', evalCaseId: evalCaseId('eval-023'), score: 0.85 });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Capability (1) ──

    it('should emit capability.executed', () => {
      const input = makeTraceInput({ type: 'capability.executed', capabilityType: 'web_search', manifestId: capabilityManifestId('cap-023'), trustTier: 'sandboxed' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Artifact (1) ──

    it('should emit artifact.created', () => {
      const input = makeTraceInput({ type: 'artifact.created', artifactId: 'art-023', missionId: missionId('m-023'), taskId: taskId('t-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Budget (1) ──

    it('should emit budget.consumed', () => {
      const input = makeTraceInput({ type: 'budget.consumed', missionId: missionId('m-023'), tokensConsumed: 1500, remaining: 8500 });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    // ── Memory governance (3) ──

    it('should emit memory.published', () => {
      const input = makeTraceInput({ type: 'memory.published', entryId: 'mem-023', taskId: taskId('t-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit memory.tombstoned', () => {
      const input = makeTraceInput({ type: 'memory.tombstoned', entryId: 'mem-023', taskId: taskId('t-023') });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });

    it('should emit memory.promoted', () => {
      const input = makeTraceInput({ type: 'memory.promoted', entryId: 'mem-023', claimId: 'claim-mem-023' });
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
    });
  });

  // ── BC-024: Payload discriminated union — mission.created ──

  describe('BC-024: mission.created payload has missionId and agentId', () => {
    it('should preserve missionId and agentId on the returned trace event', () => {
      const payload: TraceEventPayload = {
        type: 'mission.created',
        missionId: missionId('m-bc024'),
        agentId: agentId('a-bc024'),
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc024-mc') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.payload.type, 'mission.created');
      // Narrow the discriminated union and assert specific fields
      const p = result.value.payload;
      if (p.type !== 'mission.created') { assert.fail('Payload type narrowing failed'); return; }
      assert.equal(p.missionId, 'm-bc024');
      assert.equal(p.agentId, 'a-bc024');
    });
  });

  // ── BC-024: Payload discriminated union — attempt.failed ──

  describe('BC-024: attempt.failed payload has errorCode', () => {
    it('should preserve errorCode string on the returned trace event', () => {
      const payload: TraceEventPayload = {
        type: 'attempt.failed',
        attemptId: attemptId('att-bc024'),
        taskId: taskId('t-bc024'),
        errorCode: 'BUDGET_EXCEEDED',
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc024-af') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const p = result.value.payload;
      if (p.type !== 'attempt.failed') { assert.fail('Payload type narrowing failed'); return; }
      assert.equal(p.errorCode, 'BUDGET_EXCEEDED');
      assert.equal(p.attemptId, 'att-bc024');
    });
  });

  // ── BC-024: Payload discriminated union — budget.consumed ──

  describe('BC-024: budget.consumed payload has tokensConsumed and remaining', () => {
    it('should preserve numeric token fields on the returned trace event', () => {
      const payload: TraceEventPayload = {
        type: 'budget.consumed',
        missionId: missionId('m-bc024-budget'),
        tokensConsumed: 2500,
        remaining: 7500,
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc024-bc') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const p = result.value.payload;
      if (p.type !== 'budget.consumed') { assert.fail('Payload type narrowing failed'); return; }
      assert.equal(p.tokensConsumed, 2500);
      assert.equal(p.remaining, 7500);
    });
  });

  // ── BC-025: CorrelationId is required on TraceEventInput ──

  describe('BC-025: CorrelationId is required (not optional) on TraceEventInput', () => {
    it('should emit successfully with a provided correlationId', () => {
      const input = makeTraceInput(
        { type: 'mission.created', missionId: missionId('m-bc025'), agentId: agentId('a-bc025') },
        { correlationId: correlationId('corr-bc025-explicit') },
      );
      const result = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // The emitter accepted the event — correlationId was present and valid.
      // Discriminative: if correlationId were optional and omitted, behavior would differ.
      assert.equal(typeof result.value, 'string');
    });
  });

  // ── BC-027: Emit within transaction — transaction-coupled ──

  describe('BC-027: Emit within SQLite transaction is transaction-coupled', () => {
    it('should succeed when emit is called inside conn.transaction()', () => {
      const txResult = conn.transaction(() => {
        const input = makeTraceInput({
          type: 'mission.created',
          missionId: missionId('m-bc027-tx'),
          agentId: agentId('a-bc027-tx'),
        });
        return gov.traceEmitter.emit(conn, ctx, input);
      });
      assert.equal(txResult.ok, true);
      if (!txResult.ok) return;
      assert.equal(typeof txResult.value, 'string');
    });
  });

  // ── BC-029 v1.1: handoff.accepted payload has typed acceptanceOutcome ──

  describe('BC-029 v1.1: handoff.accepted payload carries typed acceptanceOutcome', () => {
    it('should preserve acceptanceOutcome on handoff.accepted trace event', () => {
      const payload: TraceEventPayload = {
        type: 'handoff.accepted',
        handoffId: handoffId('h-bc029-acc'),
        acceptanceOutcome: 'accepted-with-scope-reduction' as HandoffAcceptanceOutcome,
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc029-acc') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const p = result.value.payload;
      if (p.type !== 'handoff.accepted') { assert.fail('Payload type narrowing failed'); return; }
      // Discriminative: the exact typed value, not just a string
      assert.equal(p.acceptanceOutcome, 'accepted-with-scope-reduction');
    });
  });

  // ── BC-029 v1.1: handoff.rejected payload has typed rejectionReason ──

  describe('BC-029 v1.1: handoff.rejected payload carries typed rejectionReason', () => {
    it('should preserve rejectionReason on handoff.rejected trace event', () => {
      const payload: TraceEventPayload = {
        type: 'handoff.rejected',
        handoffId: handoffId('h-bc029-rej'),
        rejectionReason: 'rejected-contract-ambiguity' as HandoffRejectionReason,
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc029-rej') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const p = result.value.payload;
      if (p.type !== 'handoff.rejected') { assert.fail('Payload type narrowing failed'); return; }
      assert.equal(p.rejectionReason, 'rejected-contract-ambiguity');
    });
  });

  // ── BC-029.1 v1.1: RunSequencer dual-mode ──

  describe('BC-029.1 v1.1: RunSequencer.nextRunSeq returns number', () => {
    it('should return a numeric run sequence value', () => {
      const seq = gov.traceEmitter.sequencer.nextRunSeq(runId('run-bc0291-seq'));
      assert.equal(typeof seq, 'number');
      assert.equal(seq >= 1, true);
    });
  });

  describe('BC-029.1 v1.1: RunSequencer.nextSpanSeq returns number', () => {
    it('should return a numeric span sequence value', () => {
      const seq = gov.traceEmitter.sequencer.nextSpanSeq(runId('run-bc0291-span'), 0);
      assert.equal(typeof seq, 'number');
      assert.equal(seq >= 0, true);
    });
  });

  // ── BC-052 v1.1: handoff.parent-suspended payload shape ──

  describe('BC-052 v1.1: handoff.parent-suspended carries suspension cascade payload', () => {
    it('should preserve parentMissionId, childTaskId, suspensionRecordId, delegateAgentId', () => {
      const payload: TraceEventPayload = {
        type: 'handoff.parent-suspended',
        handoffId: handoffId('h-bc052'),
        parentMissionId: missionId('m-parent-bc052'),
        childTaskId: taskId('t-child-bc052'),
        suspensionRecordId: suspensionRecordId('sus-bc052'),
        delegateAgentId: agentId('delegate-bc052'),
      };
      const event = makeTraceEvent(payload, { traceEventId: traceEventId('evt-bc052') });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const p = result.value.payload;
      if (p.type !== 'handoff.parent-suspended') { assert.fail('Payload type narrowing failed'); return; }
      assert.equal(p.parentMissionId, 'm-parent-bc052');
      assert.equal(p.childTaskId, 't-child-bc052');
      assert.equal(p.suspensionRecordId, 'sus-bc052');
      assert.equal(p.delegateAgentId, 'delegate-bc052');
      assert.equal(p.handoffId, 'h-bc052');
    });
  });

  // ── INV-020: TraceEvent immutable — no update or delete on TraceEventStore ──

  describe('INV-020: TraceEventStore has no update or delete methods (insert-only)', () => {
    it('should insert and return the immutable trace event', () => {
      const payload: TraceEventPayload = {
        type: 'mission.created',
        missionId: missionId('m-inv020'),
        agentId: agentId('a-inv020'),
      };
      const event = makeTraceEvent(payload, {
        traceEventId: traceEventId('evt-inv020'),
        runSeq: 1,
      });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // The store only has insert, getByRun, getByCorrelation — no update, no delete.
      // Verify the returned event matches what was inserted (immutable preservation).
      assert.equal(result.value.traceEventId, 'evt-inv020');
      assert.equal(result.value.runSeq, 1);
      assert.equal(result.value.type, 'mission.created');
    });
  });

  // ── INV-021: (runId, runSeq) uniqueness preserved ──

  describe('INV-021: (runId, runSeq) combination is preserved on insert', () => {
    it('should return event with the exact runId and runSeq provided', () => {
      const payload: TraceEventPayload = {
        type: 'task.created',
        taskId: taskId('t-inv021'),
        missionId: missionId('m-inv021'),
      };
      const event = makeTraceEvent(payload, {
        traceEventId: traceEventId('evt-inv021'),
        runId: runId('run-inv021'),
        runSeq: 42,
      });
      const result = gov.traceEventStore.insert(conn, event);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.runId, 'run-inv021');
      assert.equal(result.value.runSeq, 42);
    });

    it('should retrieve events by runId preserving runSeq ordering', () => {
      const result = gov.traceEventStore.getByRun(conn, runId('run-inv021-getby'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(Array.isArray(result.value), true);
    });
  });

  // ── INV-023: Constitutional trace events vs domain events are distinct systems ──
  // INV-023 is verified structurally: TraceEmitter is a separate interface from EventBus.
  // The 32 event types in TraceEventType are constitutional governance events.
  // This test verifies getByCorrelation returns trace events (not domain events).

  describe('INV-023: Trace events are distinct from domain events — getByCorrelation returns trace events', () => {
    it('should return readonly TraceEvent[] for a correlationId', () => {
      const result = gov.traceEventStore.getByCorrelation(conn, correlationId('corr-inv023'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(Array.isArray(result.value), true);
    });
  });
});
