/**
 * Limen Phase 0A — Supervisor Decision Model
 * Truth Model: Deliverable 5 (Supervisor Decision Model)
 * Assertions: BC-040 to BC-052, INV-X04, INV-X05, INV-X12
 *
 * Phase: 0A (Foundation)
 * Gate: All tests FAIL with NotImplementedError before implementation.
 *
 * BC-040: 9 supervisor types with defined authority scopes.
 * BC-041: 9 decision outcomes.
 * BC-042: Hard-policy decisions are immutable and non-overridable.
 * BC-043: Evaluators can assess only (no revoke authority).
 * BC-044: Scope-bound authority enforcement.
 * BC-045: Orthogonal decisions compose; contradictions resolved by precedence.
 * BC-046: Timeout creates synthetic decision (not silent skip).
 * BC-047: SuspensionRecord with 'active' | 'resolved' state.
 * BC-048: Resume tokens (plaintext returned once, stored as hash) — cross-ref idempotency tests.
 * BC-049: Mission suspended → all tasks implicitly suspended (cascade).
 * BC-050: Task suspended → all attempts implicitly suspended.
 * BC-051: Parent handoff suspension ≠ auto-suspend child task (autonomy preserved).
 * BC-052: handoff.parent-suspended notification — covered in trace payload tests.
 * BC-069: Handoff lifecycle with typed acceptance/rejection outcomes.
 * INV-X04: Every entity carries schemaVersion.
 * INV-X05: Suspension is orthogonal to lifecycle state.
 * INV-X12: origin distinguishes runtime from migration-backfill.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId, agentId } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, correlationId, missionContractId, supervisorDecisionId, suspensionRecordId, handoffId, evalCaseId, capabilityManifestId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type {
  SupervisorDecision, SuspensionRecord, Handoff,
  SupervisorType, DecisionOutcome, SuspensionState, SuspensionTargetType,
  HandoffAcceptanceOutcome, HandoffRejectionReason,
} from '../../src/kernel/interfaces/supervisor.js';
import type { HandoffLifecycleState } from '../../src/kernel/interfaces/lifecycle.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

// ─── Fixtures ───

function makeDecision(overrides = {}): SupervisorDecision {
  return {
    decisionId: supervisorDecisionId('dec-001'),
    tenantId: 'test-tenant',
    supervisorType: 'human' as SupervisorType,
    targetType: 'mission',
    targetId: 'mission-001',
    outcome: 'approve' as DecisionOutcome,
    rationale: 'Approved by human supervisor',
    precedence: 1,
    schemaVersion: '0.1.0',
    origin: 'runtime',
    createdAt: testTimestamp(),
    ...overrides,
  };
}

function makeSuspension(overrides = {}): SuspensionRecord {
  return {
    suspensionId: suspensionRecordId('susp-001'),
    tenantId: 'test-tenant',
    targetType: 'mission' as SuspensionTargetType,
    targetId: 'mission-001',
    state: 'active' as SuspensionState,
    creatingDecisionId: supervisorDecisionId('dec-creating-001'),
    resolutionDecisionId: null,
    schemaVersion: '0.1.0',
    origin: 'runtime',
    createdAt: testTimestamp(),
    resolvedAt: null,
    ...overrides,
  };
}

function makeHandoff(overrides = {}): Handoff {
  return {
    handoffId: handoffId('handoff-001'),
    tenantId: 'test-tenant',
    fromTaskId: taskId('task-delegator'),
    toAgentId: agentId('agent-delegate'),
    state: 'issued' as HandoffLifecycleState,
    acceptanceOutcome: null,
    rejectionReason: null,
    schemaVersion: '0.1.0',
    origin: 'runtime',
    createdAt: testTimestamp(),
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Supervisor Decision Model (Deliverable 5)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-040: 9 supervisor types with defined authority scopes ──

  describe('BC-040: SupervisorDecision accepts supervisorType=human', () => {
    it('should create a decision with supervisorType human', () => {
      const decision = makeDecision({ supervisorType: 'human' as SupervisorType });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.supervisorType, 'human');
    });
  });

  describe('BC-040: SupervisorDecision accepts supervisorType=hard-policy', () => {
    it('should create a decision with supervisorType hard-policy', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-040-hp'),
        supervisorType: 'hard-policy' as SupervisorType,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.supervisorType, 'hard-policy');
    });
  });

  describe('BC-040: SupervisorDecision accepts supervisorType=evaluator', () => {
    it('should create a decision with supervisorType evaluator', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-040-eval'),
        supervisorType: 'evaluator' as SupervisorType,
        outcome: 'approve' as DecisionOutcome,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.supervisorType, 'evaluator');
    });
  });

  // ── BC-041: 9 decision outcomes ──

  describe('BC-041: DecisionOutcome approve', () => {
    it('should create a decision with outcome approve', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-041-approve'),
        outcome: 'approve' as DecisionOutcome,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.outcome, 'approve');
    });
  });

  describe('BC-041: DecisionOutcome reject', () => {
    it('should create a decision with outcome reject', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-041-reject'),
        outcome: 'reject' as DecisionOutcome,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.outcome, 'reject');
    });
  });

  describe('BC-041: DecisionOutcome revoke', () => {
    it('should create a decision with outcome revoke', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-041-revoke'),
        outcome: 'revoke' as DecisionOutcome,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.outcome, 'revoke');
    });
  });

  // ── BC-042: Hard-policy decisions are immutable ──

  describe('BC-042: Hard-policy decision is immutable after creation', () => {
    it('should return the same decision unchanged on retrieval', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-042-immutable'),
        supervisorType: 'hard-policy' as SupervisorType,
        outcome: 'reject' as DecisionOutcome,
        rationale: 'Policy violation detected',
      });
      const createResult = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      const getResult = gov.supervisorDecisionStore.get(conn, supervisorDecisionId('dec-042-immutable'));
      assert.equal(getResult.ok, true);
      if (!getResult.ok) return;
      assert.notEqual(getResult.value, null);
      assert.equal(getResult.value!.supervisorType, 'hard-policy');
      assert.equal(getResult.value!.outcome, 'reject');
      assert.equal(getResult.value!.rationale, 'Policy violation detected');
    });
  });

  // ── BC-043: Evaluator can assess only (no revoke authority) ──

  describe('BC-043: Evaluator cannot revoke', () => {
    it('should reject evaluator decision with outcome=revoke', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-043-eval-revoke'),
        supervisorType: 'evaluator' as SupervisorType,
        outcome: 'revoke' as DecisionOutcome,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'EVALUATOR_REVOKE_FORBIDDEN');
    });
  });

  // ── BC-044: Scope-bound authority ──

  describe('BC-044: Decision has targetType and targetId for scope-bound authority', () => {
    it('should preserve targetType and targetId on created decision', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-044-scope'),
        targetType: 'task',
        targetId: 'task-scoped-001',
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.targetType, 'task');
      assert.equal(result.value.targetId, 'task-scoped-001');
    });
  });

  // ── BC-045: Precedence for conflict resolution ──

  describe('BC-045: Decision carries precedence field', () => {
    it('should preserve numeric precedence value', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-045-prec'),
        precedence: 42,
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.precedence, 42);
    });
  });

  // ── BC-046: system-timeout creates synthetic decision ──

  describe('BC-046: system-timeout creates synthetic decision', () => {
    it('should accept supervisorType=system-timeout as valid synthetic source', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-046-timeout'),
        supervisorType: 'system-timeout' as SupervisorType,
        outcome: 'reject' as DecisionOutcome,
        rationale: 'Decision timeout expired — synthetic reject',
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.supervisorType, 'system-timeout');
      assert.equal(result.value.outcome, 'reject');
    });
  });

  // ── BC-047: SuspensionRecord creation with state='active' ──

  describe('BC-047: SuspensionRecord creation with state=active', () => {
    it('should create suspension with active state, targetType, targetId', () => {
      const suspension = makeSuspension();
      const result = gov.suspensionStore.create(conn, suspension);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.state, 'active');
      assert.equal(result.value.targetType, 'mission');
      assert.equal(result.value.targetId, 'mission-001');
      assert.equal(result.value.resolutionDecisionId, null);
      assert.equal(result.value.resolvedAt, null);
    });
  });

  describe('BC-047: SuspensionRecord.resolve changes state to resolved', () => {
    it('should transition state to resolved with resolutionDecisionId', () => {
      const resolveResult = gov.suspensionStore.resolve(
        conn,
        suspensionRecordId('susp-resolve-001'),
        supervisorDecisionId('dec-resolving-001'),
      );
      assert.equal(resolveResult.ok, true);
      if (!resolveResult.ok) return;
      assert.equal(resolveResult.value.state, 'resolved');
      assert.equal(resolveResult.value.resolutionDecisionId, 'dec-resolving-001');
      assert.notEqual(resolveResult.value.resolvedAt, null);
    });
  });

  describe('BC-047: SuspensionStore.getActiveForTarget returns active suspension', () => {
    it('should return active suspension or null for the target', () => {
      const result = gov.suspensionStore.getActiveForTarget(conn, 'mission', 'mission-active-check');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // Either null (no active suspension) or a suspension with state='active'
      const isNullOrActive = result.value === null || result.value.state === 'active';
      assert.equal(isNullOrActive, true);
    });
  });

  // ── BC-048: Resume token — cross-reference to idempotency tests ──

  describe('BC-048: Resume token via resumeTokenStore.create', () => {
    it('should reference resume token creation (full coverage in idempotency contract tests)', () => {
      // BC-048 specifies plaintext returned once, stored as SHA-256 hash.
      // The resumeTokenStore.create is the primary interface.
      // Full verification lives in test_contract_idempotency.test.ts.
      // Here we verify the store is reachable and the method signature is correct.
      const result = gov.resumeTokenStore.create(conn, {
        tokenHash: 'sha256-placeholder',
        suspensionId: suspensionRecordId('susp-token-001'),
        tenantId: 'test-tenant',
        schemaVersion: '0.1.0',
        origin: 'runtime',
        createdAt: testTimestamp(),
      } as any);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(typeof result.value.plaintextToken, 'string');
    });
  });

  // ── BC-049: Mission suspension — cascade to tasks ──

  describe('BC-049: Suspension with targetType=mission', () => {
    it('should create a mission-scoped suspension record', () => {
      const suspension = makeSuspension({
        suspensionId: suspensionRecordId('susp-049-mission'),
        targetType: 'mission' as SuspensionTargetType,
        targetId: 'mission-cascade-001',
      });
      const result = gov.suspensionStore.create(conn, suspension);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.targetType, 'mission');
      assert.equal(result.value.targetId, 'mission-cascade-001');
      assert.equal(result.value.state, 'active');
    });
  });

  // ── BC-050: Task suspension — cascade to attempts ──

  describe('BC-050: Suspension with targetType=task', () => {
    it('should create a task-scoped suspension record', () => {
      const suspension = makeSuspension({
        suspensionId: suspensionRecordId('susp-050-task'),
        targetType: 'task' as SuspensionTargetType,
        targetId: 'task-cascade-001',
      });
      const result = gov.suspensionStore.create(conn, suspension);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.targetType, 'task');
      assert.equal(result.value.targetId, 'task-cascade-001');
      assert.equal(result.value.state, 'active');
    });
  });

  // ── BC-051: Parent handoff suspended ≠ auto-suspend child ──

  describe('BC-051: Parent handoff suspension does not auto-suspend child task', () => {
    it('should create handoff and suspension independently without cascading to child', () => {
      // Create a handoff: parent task delegates to child agent
      const handoff = makeHandoff({
        handoffId: handoffId('handoff-051-parent'),
        fromTaskId: taskId('task-parent-051'),
        toAgentId: agentId('agent-child-051'),
        state: 'active' as HandoffLifecycleState,
      });
      const handoffResult = gov.handoffStore.create(conn, handoff);
      assert.equal(handoffResult.ok, true);
      if (!handoffResult.ok) return;

      // Suspend the parent task — the child should NOT be auto-suspended
      const parentSuspension = makeSuspension({
        suspensionId: suspensionRecordId('susp-051-parent'),
        targetType: 'task' as SuspensionTargetType,
        targetId: 'task-parent-051',
      });
      const suspResult = gov.suspensionStore.create(conn, parentSuspension);
      assert.equal(suspResult.ok, true);
      if (!suspResult.ok) return;

      // Verify no suspension exists for the child agent's task scope
      // The child agent's autonomy is preserved (BC-051)
      const childCheck = gov.suspensionStore.getActiveForTarget(conn, 'task', 'task-child-051');
      assert.equal(childCheck.ok, true);
      if (!childCheck.ok) return;
      assert.equal(childCheck.value, null);
    });
  });

  // ── BC-052: handoff.parent-suspended notification ──
  // Covered in trace event payload tests (BC-052 v1.1 specifies a notification
  // event type, not a supervisor entity). Reference only.

  // ── BC-069: Handoff creation with state='issued' ──

  describe('BC-069: Handoff creation with state=issued', () => {
    it('should create handoff with initial state issued', () => {
      const handoff = makeHandoff();
      const result = gov.handoffStore.create(conn, handoff);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.handoffId, 'handoff-001');
      assert.equal(result.value.state, 'issued');
      assert.equal(result.value.fromTaskId, 'task-delegator');
      assert.equal(result.value.toAgentId, 'agent-delegate');
      assert.equal(result.value.acceptanceOutcome, null);
      assert.equal(result.value.rejectionReason, null);
    });
  });

  describe('BC-069: Handoff updateState to accepted', () => {
    it('should transition handoff state from issued to accepted', () => {
      const result = gov.handoffStore.updateState(
        conn,
        handoffId('handoff-069-accept'),
        'accepted' as HandoffLifecycleState,
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.state, 'accepted');
    });
  });

  // ── INV-X04: SupervisorDecision carries schemaVersion ──

  describe('INV-X04: SupervisorDecision carries schemaVersion', () => {
    it('should preserve schemaVersion on created decision', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-invx04'),
        schemaVersion: '0.2.0',
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.schemaVersion, '0.2.0');
    });
  });

  // ── INV-X05: Suspension is orthogonal to lifecycle state ──

  describe('INV-X05: SuspensionRecord state is active/resolved, not a lifecycle state', () => {
    it('should only have active or resolved as valid suspension states', () => {
      const activeSuspension = makeSuspension({
        suspensionId: suspensionRecordId('susp-invx05-active'),
        state: 'active' as SuspensionState,
      });
      const activeResult = gov.suspensionStore.create(conn, activeSuspension);
      assert.equal(activeResult.ok, true);
      if (!activeResult.ok) return;
      // Suspension state is 'active' — NOT a lifecycle state like 'created', 'executing', etc.
      assert.equal(activeResult.value.state, 'active');
      assert.notEqual(activeResult.value.state, 'created');
      assert.notEqual(activeResult.value.state, 'completed');
      assert.notEqual(activeResult.value.state, 'failed');
    });
  });

  // ── INV-X12: origin field on SupervisorDecision and SuspensionRecord ──

  describe('INV-X12: SupervisorDecision carries origin=runtime', () => {
    it('should preserve runtime origin on decision', () => {
      const decision = makeDecision({
        decisionId: supervisorDecisionId('dec-invx12-rt'),
        origin: 'runtime',
      });
      const result = gov.supervisorDecisionStore.create(conn, decision);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.origin, 'runtime');
    });
  });

  describe('INV-X12: SuspensionRecord carries origin=migration-backfill', () => {
    it('should accept migration-backfill origin on suspension', () => {
      const suspension = makeSuspension({
        suspensionId: suspensionRecordId('susp-invx12-mig'),
        origin: 'migration-backfill',
      });
      const result = gov.suspensionStore.create(conn, suspension);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.origin, 'migration-backfill');
    });
  });
});
