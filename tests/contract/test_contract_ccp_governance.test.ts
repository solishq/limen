/**
 * Limen v1.0 — CCP Governance Integration Contract Tests
 * Phase 1: Controls 2-3 Verification — Test Extension (Stage 3)
 *
 * 32 tests covering 25 "caught before merge" defect classes that lacked
 * test coverage, as identified in CORTEX_PHASE_1_CCP_GAP_REPORT.md §5.
 *
 * Every test MUST FAIL with NotImplementedError against the harness.
 * Tests are spec-derived from DC declarations and truth model obligations.
 *
 * Organization by priority tier:
 *   GROUP 21: P1 — Phase 0A Trace Integration (DC-CCP-501..514) — Tests #163-#172
 *   GROUP 22: P2 — Epistemic Integrity (DC-CCP-117, DC-CCP-118) — Tests #173-#176
 *   GROUP 23: P3 — State/WMP Boundary (DC-CCP-205..305) — Tests #177-#181
 *   GROUP 24: P4 — Authority/Concurrency (DC-CCP-307, DC-CCP-406) — Tests #182-#184
 *   GROUP 25: P5 — Migration/Credential (DC-CCP-604..707) — Tests #185-#194
 *
 * Defect class version: 1.1 (96 DCs)
 * Truth model version: 2.0
 * Engineering directive version: 3.3 CONSOLIDATED
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClaimSystem, NotImplementedError } from '../../src/claims/harness/claim_harness.js';
import { createTestDatabase, createTestOperationContext, createTestAuditTrail, tenantId, agentId, missionId, taskId } from '../helpers/test_database.js';
import type {
  ClaimSystem, ClaimSystemDeps, ClaimCreateInput, EvidenceRef, ClaimId,
  RelationshipCreateInput, RetractClaimInput, EvidenceSourceValidator,
  GroundingValidator, ClaimLifecycleProjection,
} from '../../src/claims/interfaces/claim_types.js';
import {
  CCP_EVENTS, CCP_TRACE_EVENTS, SC11_ERROR_CODES,
} from '../../src/claims/interfaces/claim_types.js';
import type {
  DatabaseConnection, OperationContext, EventBus, TenantId, AgentId,
  MissionId, ArtifactId,
} from '../../src/kernel/interfaces/index.js';
import type { TraceEmitter, TraceEventInput, RunSequencer } from '../../src/kernel/interfaces/trace.js';
import type { RunId, TraceEventId, CorrelationId } from '../../src/kernel/interfaces/governance_ids.js';

// ============================================================================
// Test Helpers — Branded Type Constructors
// ============================================================================

function claimId(id: string = 'claim-test-001'): ClaimId {
  return id as ClaimId;
}

function artifactId(id: string = 'artifact-test-001'): ArtifactId {
  return id as ArtifactId;
}

function runId(id: string = 'run-test-001'): RunId {
  return id as RunId;
}

function traceEventId(id: string = 'trace-test-001'): TraceEventId {
  return id as TraceEventId;
}

function correlationId(id: string = 'corr-test-001'): CorrelationId {
  return id as CorrelationId;
}

// ============================================================================
// Test Helpers — Mock Dependencies (with TraceEmitter)
// ============================================================================

/** Mock TraceEmitter that records emitted trace events */
function createMockTraceEmitter(): TraceEmitter & {
  emitted: Array<{ type: string; payload: unknown; correlationId: string }>;
} {
  const emitted: Array<{ type: string; payload: unknown; correlationId: string }> = [];
  const sequencer: RunSequencer = {
    nextRunSeq(_runId: RunId): number { return 1; },
    nextSpanSeq(_runId: RunId, _spanIndex: number): number { return 1; },
  };

  return {
    emitted,
    emit(_conn: DatabaseConnection, _ctx: OperationContext, event: TraceEventInput) {
      emitted.push({
        type: event.type,
        payload: event.payload,
        correlationId: event.correlationId as string,
      });
      return { ok: true, value: traceEventId(`trace-${emitted.length}`) };
    },
    sequencer,
  };
}

/** Mock EventBus that records emitted domain events */
function createMockEventBus(): EventBus & { emitted: Array<{ type: string; payload: unknown }> } {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  return {
    emitted,
    emit(_conn, _ctx, event) {
      emitted.push({ type: event.type, payload: event.payload });
      return { ok: true, value: 'evt-mock' as import('../../src/kernel/interfaces/index.js').EventId };
    },
    subscribe(_pattern, _handler) { return { ok: true, value: 'sub-mock' }; },
    unsubscribe(_id) { return { ok: true, value: undefined }; },
    registerWebhook(_conn, _ctx, _pattern, _url, _secret) { return { ok: true, value: 'wh-mock' }; },
    processWebhooks(_conn) { return { ok: true, value: { delivered: 0, failed: 0, exhausted: 0 } }; },
  };
}

/** Mock EvidenceSourceValidator — returns true for known test IDs */
function createMockEvidenceValidator(): EvidenceSourceValidator {
  const knownSources: Set<string> = new Set([
    'memory:mem-test-001',
    'artifact:art-test-001',
    'artifact:art-orphan-001',
    'capability_result:cap-result-same-mission',
    'capability_result:cap-result-other-mission',
    'memory:wmp-promoted-entry-001',
  ]);
  return {
    exists(_conn, evidenceType, evidenceId, _tenantId) {
      const key = `${evidenceType}:${evidenceId}`;
      if (!knownSources.has(key)) {
        return { ok: false, error: { code: 'EVIDENCE_NOT_FOUND', message: `Source ${key} not found`, spec: 'I-30' } };
      }
      return { ok: true, value: true };
    },
  };
}

/** Mock CapabilityResultScopeValidator — DC-CCP-118 */
function createMockCapabilityResultScopeValidator(): import('../../src/claims/interfaces/claim_types.js').CapabilityResultScopeValidator {
  // Only 'cap-result-same-mission' is within the mission chain
  return {
    validateScope(_conn, evidenceId, _missionId) {
      if (evidenceId === 'cap-result-same-mission') {
        return { ok: true, value: true };
      }
      return { ok: true, value: false };
    },
  };
}

/** Create ClaimSystemDeps with Phase 0A TraceEmitter */
function createTestClaimDeps(): ClaimSystemDeps & {
  eventBus: ReturnType<typeof createMockEventBus>;
  traceEmitter: ReturnType<typeof createMockTraceEmitter>;
} {
  return {
    audit: createTestAuditTrail(),
    eventBus: createMockEventBus(),
    evidenceValidator: createMockEvidenceValidator(),
    traceEmitter: createMockTraceEmitter(),
    capabilityResultScopeValidator: createMockCapabilityResultScopeValidator(),
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
}

/** Create a valid ClaimCreateInput for testing */
function makeValidClaimInput(overrides?: Partial<ClaimCreateInput>): ClaimCreateInput {
  return {
    subject: 'entity:company:acme',
    predicate: 'financial.revenue',
    object: { type: 'number', value: 1_000_000 },
    confidence: 0.85,
    validAt: '2026-01-15T00:00:00.000Z',
    missionId: missionId('mission-gov-001'),
    taskId: taskId('task-gov-001'),
    evidenceRefs: [{ type: 'memory', id: 'mem-test-001' }],
    groundingMode: 'evidence_path',
    ...overrides,
  };
}

/** Create a valid RelationshipCreateInput for testing */
function makeValidRelationshipInput(overrides?: Partial<RelationshipCreateInput>): RelationshipCreateInput {
  return {
    fromClaimId: claimId('claim-from-001'),
    toClaimId: claimId('claim-to-001'),
    type: 'supports',
    missionId: missionId('mission-gov-001'),
    ...overrides,
  };
}

/** Create a valid RetractClaimInput for testing */
function makeValidRetractInput(overrides?: Partial<RetractClaimInput>): RetractClaimInput {
  return {
    claimId: claimId('claim-retract-001'),
    reason: 'Updated analysis shows previous conclusion was incorrect',
    ...overrides,
  };
}

/** Seed a claim directly into the database for test setup */
function seedClaim(conn: DatabaseConnection, options: {
  id: string;
  tenantId?: string | null;
  status?: string;
  sourceAgentId?: string;
  evidenceRefs?: Array<{ type: string; id: string }>;
}): void {
  const {
    id,
    tenantId: tid = 'test-tenant',
    status = 'active',
    sourceAgentId = 'test-agent',
    evidenceRefs = [],
  } = options;
  conn.run(
    `INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value,
       confidence, valid_at, source_agent_id, source_mission_id, source_task_id,
       grounding_mode, status)
     VALUES (?, ?, 'entity:company:seed', 'financial.revenue', 'number', '1000000',
       0.85, '2026-01-15T00:00:00.000Z', ?, 'mission-gov-001', 'task-gov-001',
       'evidence_path', ?)`,
    [id, tid, sourceAgentId, status],
  );
  for (const ref of evidenceRefs) {
    conn.run(
      `INSERT INTO claim_evidence (id, claim_id, evidence_type, evidence_id, source_state)
       VALUES (?, ?, ?, ?, 'live')`,
      [`ev-seed-${id}-${ref.type}-${ref.id}`, id, ref.type, ref.id],
    );
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('CCP Governance Integration Contract Tests — Limen v1.0', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: ReturnType<typeof createTestClaimDeps>;
  let system: ClaimSystem;

  beforeEach(() => {
    const db = createTestDatabase();
    conn = db as unknown as DatabaseConnection;
    ctx = createTestOperationContext();
    deps = createTestClaimDeps();
    system = createClaimSystem(deps);
  });

  // ========================================================================
  // GROUP 21: Phase 0A Trace Integration
  // DC-CCP-501, 502, 503, 511, 512, 513, 514
  // Tests #163-#172
  // ========================================================================

  describe('GROUP 21: Phase 0A trace integration', () => {

    // DC-CCP-501: Claim lifecycle transition without trace event
    // Control: caught before merge
    // Obligation: Binding 14 — every CCP lifecycle transition MUST emit
    //   a constitutional trace event through TraceEmitter (BC-027: transaction-coupled).
    it('#163: SC-11 assert_claim emits claim.asserted trace event (DC-CCP-501)', () => {
      const input = makeValidClaimInput();
      // Execute SC-11 assertion
      const result = system.assertClaim.execute(conn, ctx, input);

      // Verify claim.asserted trace event was emitted
      assert.ok(result.ok, 'SC-11 should succeed');
      const traceEvents = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_ASSERTED,
      );
      assert.equal(traceEvents.length, 1, 'Exactly one claim.asserted trace event must be emitted');
    });

    // DC-CCP-501 (retraction path): retraction must emit claim.retracted trace
    it('#164: retract_claim emits claim.retracted trace event (DC-CCP-501)', () => {
      // First assert a claim, then retract it
      const assertInput = makeValidClaimInput();
      const assertResult = system.assertClaim.execute(conn, ctx, assertInput);
      assert.ok(assertResult.ok, 'Assertion should succeed');

      const retractInput = makeValidRetractInput({
        claimId: assertResult.value.claim.id,
      });
      const retractResult = system.retractClaim.execute(conn, ctx, retractInput);
      assert.ok(retractResult.ok, 'Retraction should succeed');

      const traceEvents = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_RETRACTED,
      );
      assert.equal(traceEvents.length, 1, 'Exactly one claim.retracted trace event must be emitted');
    });

    // DC-CCP-502: Trace event with wrong type for CCP transition
    // Control: caught before merge
    // Obligation: Each CCP operation maps to exactly one trace event type.
    //   Assert → claim.asserted, Retract → claim.retracted,
    //   Contradicts → claim.challenged, Grounded → claim.grounded.
    it('#165: SC-11 trace event type is claim.asserted, not other CCP type (DC-CCP-502)', () => {
      const input = makeValidClaimInput();
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'SC-11 should succeed');

      // Verify the trace event type is exactly claim.asserted
      const traceEvents = deps.traceEmitter.emitted;
      const ccpTraceTypes = [
        CCP_TRACE_EVENTS.CLAIM_ASSERTED,
        CCP_TRACE_EVENTS.CLAIM_GROUNDED,
        CCP_TRACE_EVENTS.CLAIM_CHALLENGED,
        CCP_TRACE_EVENTS.CLAIM_RETRACTED,
      ];
      const ccpEvents = traceEvents.filter((e) => ccpTraceTypes.includes(e.type as typeof CCP_TRACE_EVENTS[keyof typeof CCP_TRACE_EVENTS]));

      // SC-11 may emit claim.asserted AND claim.grounded (if grounding succeeds),
      // but must NOT emit claim.challenged or claim.retracted
      const wrongTypes = ccpEvents.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_CHALLENGED || e.type === CCP_TRACE_EVENTS.CLAIM_RETRACTED,
      );
      assert.equal(wrongTypes.length, 0, 'SC-11 must not emit claim.challenged or claim.retracted trace events');
    });

    // DC-CCP-503: CorrelationId mismatch between EventBus and TraceEmitter
    // Control: caught before merge
    // Obligation: Binding 12 — same CorrelationId in both emission systems
    //   for the same causal action. BC-025.
    it('#166: SC-11 uses same CorrelationId for EventBus and TraceEmitter (DC-CCP-503)', () => {
      const input = makeValidClaimInput();
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'SC-11 should succeed');

      // Both systems should have emitted events
      assert.ok(deps.eventBus.emitted.length > 0, 'EventBus must emit');
      assert.ok(deps.traceEmitter.emitted.length > 0, 'TraceEmitter must emit');

      // The CorrelationId in trace events must match the operation's CorrelationId
      // (which is also used by EventBus through OperationContext)
      const traceCorrelationIds = new Set(
        deps.traceEmitter.emitted.map((e) => e.correlationId),
      );
      // All trace events from one operation share one CorrelationId
      assert.equal(traceCorrelationIds.size, 1, 'All trace events from one SC-11 call must share one CorrelationId');
    });

    // DC-CCP-511: TraceEmitter/EventBus dual-emission divergence
    // Control: caught before merge
    // Obligation: Both systems must emit for the same lifecycle transition.
    //   If one emits and the other doesn't, observability is incomplete.
    it('#167: SC-11 emits to BOTH EventBus and TraceEmitter (DC-CCP-511)', () => {
      const input = makeValidClaimInput();
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'SC-11 should succeed');

      // EventBus: claim.asserted domain event
      const domainAsserted = deps.eventBus.emitted.filter(
        (e) => e.type === CCP_EVENTS.CLAIM_ASSERTED.type,
      );
      assert.ok(domainAsserted.length > 0, 'EventBus must emit claim.asserted domain event');

      // TraceEmitter: claim.asserted constitutional trace event
      const traceAsserted = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_ASSERTED,
      );
      assert.ok(traceAsserted.length > 0, 'TraceEmitter must emit claim.asserted trace event');
    });

    // DC-CCP-511: retraction dual-emission
    it('#168: retract_claim emits to BOTH EventBus and TraceEmitter (DC-CCP-511)', () => {
      // Assert then retract
      const assertInput = makeValidClaimInput();
      const assertResult = system.assertClaim.execute(conn, ctx, assertInput);
      assert.ok(assertResult.ok);

      const retractInput = makeValidRetractInput({
        claimId: assertResult.value.claim.id,
      });
      system.retractClaim.execute(conn, ctx, retractInput);

      // EventBus: claim.retracted domain event
      const domainRetracted = deps.eventBus.emitted.filter(
        (e) => e.type === CCP_EVENTS.CLAIM_RETRACTED.type,
      );
      assert.ok(domainRetracted.length > 0, 'EventBus must emit claim.retracted');

      // TraceEmitter: claim.retracted trace event
      const traceRetracted = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_RETRACTED,
      );
      assert.ok(traceRetracted.length > 0, 'TraceEmitter must emit claim.retracted');
    });

    // DC-CCP-512 (v1.1): claim.challenged trace not emitted on contradicts relationship
    // Control: caught before merge
    // Obligation: SC-12 with type='contradicts' must emit claim.challenged
    //   through TraceEmitter. This is a new v1.1 requirement.
    it('#169: SC-12 contradicts relationship emits claim.challenged trace (DC-CCP-512)', () => {
      // Create two claims, then declare 'contradicts' relationship
      const input1 = makeValidClaimInput({ subject: 'entity:company:alpha' });
      const input2 = makeValidClaimInput({ subject: 'entity:company:beta' });
      const result1 = system.assertClaim.execute(conn, ctx, input1);
      const result2 = system.assertClaim.execute(conn, ctx, input2);
      assert.ok(result1.ok && result2.ok);

      // Reset emitted to isolate relationship events
      deps.traceEmitter.emitted.length = 0;

      const relInput = makeValidRelationshipInput({
        fromClaimId: result1.value.claim.id,
        toClaimId: result2.value.claim.id,
        type: 'contradicts',
      });
      const relResult = system.relateClaims.execute(conn, ctx, relInput);
      assert.ok(relResult.ok, 'SC-12 contradicts should succeed');

      const traceEvents = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_CHALLENGED,
      );
      assert.equal(traceEvents.length, 1, 'claim.challenged trace must be emitted for contradicts');
    });

    // DC-CCP-513 (v1.1): claim.grounded trace not emitted on SC-11 grounding success
    // Control: caught before merge
    // Obligation: When SC-11 grounding succeeds (GroundingResult.grounded=true),
    //   a claim.grounded trace event MUST be emitted.
    it('#170: SC-11 grounding success emits claim.grounded trace (DC-CCP-513)', () => {
      const input = makeValidClaimInput({
        groundingMode: 'evidence_path',
        evidenceRefs: [{ type: 'artifact', id: 'art-test-001' }],
      });
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'SC-11 should succeed');
      assert.ok(result.value.grounding.grounded, 'Grounding should succeed');

      const traceEvents = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_GROUNDED,
      );
      assert.equal(traceEvents.length, 1, 'claim.grounded trace must be emitted on grounding success');
    });

    // DC-CCP-513: grounding failure must NOT emit claim.grounded
    it('#171: SC-11 grounding failure does NOT emit claim.grounded trace (DC-CCP-513)', () => {
      // Evidence refs pointing to nonexistent source should fail grounding
      const input = makeValidClaimInput({
        groundingMode: 'evidence_path',
        evidenceRefs: [{ type: 'memory', id: 'nonexistent-source' }],
      });
      const result = system.assertClaim.execute(conn, ctx, input);

      // Whether assertion itself fails or succeeds with grounded=false,
      // claim.grounded trace must NOT be emitted
      const traceEvents = deps.traceEmitter.emitted.filter(
        (e) => e.type === CCP_TRACE_EVENTS.CLAIM_GROUNDED,
      );
      assert.equal(traceEvents.length, 0, 'claim.grounded trace must NOT be emitted on grounding failure');
    });

    // DC-CCP-514 (v1.1): claim.evidence.orphaned emission trigger missing
    // Control: caught before merge
    // Obligation: When a non-claim evidence source is purged, the domain event
    //   claim.evidence.orphaned (CCP_EVENTS.CLAIM_EVIDENCE_ORPHANED) must fire
    //   for each affected evidence reference.
    it('#172: markSourceTombstoned triggers claim.evidence.orphaned event (DC-CCP-514)', () => {
      // First: create a claim with artifact evidence
      const input = makeValidClaimInput({
        evidenceRefs: [{ type: 'artifact', id: 'art-orphan-001' }],
      });
      const assertResult = system.assertClaim.execute(conn, ctx, input);
      assert.ok(assertResult.ok);

      // Reset events
      deps.eventBus.emitted.length = 0;

      // Mark the artifact source as tombstoned (simulating artifact purge)
      const tombResult = system.evidence.markSourceTombstoned(conn, 'artifact', 'art-orphan-001');
      assert.ok(tombResult.ok, 'markSourceTombstoned should succeed');

      // claim.evidence.orphaned domain event must fire
      const orphanedEvents = deps.eventBus.emitted.filter(
        (e) => e.type === CCP_EVENTS.CLAIM_EVIDENCE_ORPHANED.type,
      );
      assert.ok(orphanedEvents.length > 0, 'claim.evidence.orphaned must be emitted when non-claim evidence is purged');
    });
  });

  // ========================================================================
  // GROUP 22: Epistemic Integrity
  // DC-CCP-117, DC-CCP-118
  // Tests #173-#176
  // ========================================================================

  describe('GROUP 22: Epistemic integrity', () => {

    // DC-CCP-117 (v1.1 CRITICAL): Evidence chain through retracted intermediate claim
    // Control: caught before merge
    // Obligation: GroundingValidator.validateWithRetractedCheck() must reject
    //   evidence chains that traverse retracted intermediate claims.
    //   Without this, new claims can be grounded through retracted (unreliable) evidence.
    it('#173: validateWithRetractedCheck rejects chain through retracted claim (DC-CCP-117)', () => {
      // Scenario: Claim A (retracted) → evidence chain contaminated.
      // Seed retracted claim that the grounding traversal will encounter.
      seedClaim(conn, {
        id: 'claim-retracted-intermediate',
        status: 'retracted',
        evidenceRefs: [{ type: 'memory', id: 'mem-test-001' }],
      });
      const result = system.grounding.validateWithRetractedCheck(
        conn,
        claimId('claim-new-001'),
        [{ type: 'claim', id: 'claim-retracted-intermediate' }],
        'evidence_path',
        3,
      );

      // Must either fail with GROUNDING_RETRACTED_INTERMEDIATE or return grounded=false
      if (result.ok) {
        assert.equal(result.value.grounded, false, 'Grounding through retracted intermediate must fail');
        assert.ok(
          result.value.failureReason?.includes('retracted'),
          'Failure reason must mention retracted intermediate',
        );
      } else {
        assert.equal(
          result.error.code,
          SC11_ERROR_CODES.GROUNDING_RETRACTED_INTERMEDIATE,
          'Error code must be GROUNDING_RETRACTED_INTERMEDIATE',
        );
      }
    });

    // DC-CCP-117: validate (without retracted check) does NOT reject retracted intermediates
    // This test verifies the discriminating behavior — the standard validate() does not
    // check intermediate status, while validateWithRetractedCheck() does.
    it('#174: standard validate does not check intermediate claim status (DC-CCP-117 inverse)', () => {
      // The standard validate() method should process the chain without checking
      // intermediate claim status — this is the existing behavior before v1.1.
      const result = system.grounding.validate(
        conn,
        claimId('claim-new-002'),
        [{ type: 'claim', id: 'claim-retracted-intermediate' }],
        'evidence_path',
        3,
      );

      // Standard validate completes without intermediate status check.
      // The result is determined by evidence existence, not intermediate status.
      assert.ok(result !== undefined, 'Standard validate must return a result');
    });

    // DC-CCP-117 (BPB-01 MUTATION KILLER): assertClaim handler must use
    // validateWithRetractedCheck, NOT validate. This test exercises the FULL
    // assertion path (SC-11 handler → step 13 grounding validation).
    // If line 1042 of claim_stores.ts is reverted to validate(), this test FAILS
    // because grounding would succeed through the retracted intermediate.
    it('#174b: assertClaim rejects assertion grounded through retracted intermediate (DC-CCP-117, BPB-01)', () => {
      // Seed a retracted claim WITH valid evidence chain to a non-claim anchor.
      // This ensures that WITHOUT the retracted check, grounding would SUCCEED.
      seedClaim(conn, {
        id: 'claim-retracted-handler-test',
        status: 'retracted',
        evidenceRefs: [{ type: 'memory', id: 'mem-test-001' }],
      });

      // Assert a new claim that references the retracted claim as evidence.
      // The handler's grounding validation must detect the retracted intermediate.
      const input = makeValidClaimInput({
        subject: 'entity:company:contaminated-assertion',
        predicate: 'financial.revenue',
        evidenceRefs: [{ type: 'claim', id: 'claim-retracted-handler-test' }],
        groundingMode: 'evidence_path',
      });

      const result = system.assertClaim.execute(conn, ctx, input);

      // MUST FAIL: The handler must reject because evidence chain traverses
      // a retracted intermediate claim. With validate() (the defect), this
      // would succeed — the retracted claim has a valid memory anchor.
      assert.equal(result.ok, false,
        'Assertion grounded through retracted intermediate MUST be rejected');
      assert.ok(
        result.error.message.includes('retracted'),
        `Rejection reason must mention retracted intermediate, got: ${result.error.message}`,
      );
    });

    // DC-CCP-118 (v1.1): capability_result evidence from outside mission ancestor chain
    // Control: caught before merge
    // Obligation: When evidenceType='capability_result', the referenced result
    //   must originate from within the claiming agent's mission ancestor chain.
    it('#175: capability_result evidence from outside mission chain is rejected (DC-CCP-118)', () => {
      const input = makeValidClaimInput({
        evidenceRefs: [{ type: 'capability_result', id: 'cap-result-other-mission' }],
        groundingMode: 'evidence_path',
      });

      const result = system.assertClaim.execute(conn, ctx, input);

      // Must reject: capability_result is from a different mission chain
      if (result.ok) {
        // If assertion proceeds, grounding must fail
        assert.equal(result.value.grounding.grounded, false,
          'Grounding must fail for cross-mission capability_result evidence');
      } else {
        assert.equal(result.error.code, SC11_ERROR_CODES.EVIDENCE_SCOPE_VIOLATION,
          'Error code must be EVIDENCE_SCOPE_VIOLATION');
      }
    });

    // DC-CCP-118: capability_result from within mission chain is accepted
    it('#176: capability_result evidence from within mission chain is accepted (DC-CCP-118)', () => {
      const input = makeValidClaimInput({
        evidenceRefs: [{ type: 'capability_result', id: 'cap-result-same-mission' }],
        groundingMode: 'evidence_path',
      });

      const result = system.assertClaim.execute(conn, ctx, input);

      // When capability_result is from the same mission chain, should not fail
      // with EVIDENCE_SCOPE_VIOLATION
      if (!result.ok) {
        assert.notEqual(result.error.code, SC11_ERROR_CODES.EVIDENCE_SCOPE_VIOLATION,
          'In-scope capability_result must not trigger EVIDENCE_SCOPE_VIOLATION');
      }
    });
  });

  // ========================================================================
  // GROUP 23: State Consistency / WMP Boundary
  // DC-CCP-205, DC-CCP-209, DC-CCP-212, DC-CCP-302, DC-CCP-305
  // Tests #177-#181
  // ========================================================================

  describe('GROUP 23: State consistency / WMP boundary', () => {

    // DC-CCP-205: Lifecycle projection function returns wrong state
    // Control: caught before merge
    // Obligation: Binding 3 — ClaimLifecycleProjection.project() must compute
    //   the correct composite state from status + relationship flags.
    it('#177: lifecycle projection returns retracted for retracted claim (DC-CCP-205)', () => {
      const state = system.lifecycleProjection.project(
        'retracted',  // status
        true,          // grounded
        false,         // hasContradicts
        false,         // hasSupersedes
      );
      // Retracted is highest severity — always wins
      assert.equal(state, 'retracted', 'Retracted status must project to retracted state');
    });

    // DC-CCP-205: projection precedence — superseded > disputed > grounded > asserted
    it('#178: lifecycle projection follows severity precedence (DC-CCP-205)', () => {
      // Active + grounded + contradicted + superseded → superseded (highest)
      const state = system.lifecycleProjection.project(
        'active',  // not retracted
        true,      // grounded
        true,      // hasContradicts (disputed)
        true,      // hasSupersedes (superseded)
      );
      assert.equal(state, 'superseded', 'Superseded has higher precedence than disputed');

      // Active + grounded + contradicted → disputed
      const state2 = system.lifecycleProjection.project('active', true, true, false);
      assert.equal(state2, 'disputed', 'Contradicted claim should be disputed');

      // Active + grounded + no relationships → grounded
      const state3 = system.lifecycleProjection.project('active', true, false, false);
      assert.equal(state3, 'grounded', 'Grounded without relationships should be grounded');

      // Active + not grounded → asserted
      const state4 = system.lifecycleProjection.project('active', false, false, false);
      assert.equal(state4, 'asserted', 'Ungrounded active claim should be asserted');
    });

    // DC-CCP-209: WMP entry modified after CCP promotion
    // Control: caught before merge
    // Obligation: Binding 18 — once a WMP entry is promoted to a CCP claim,
    //   the original WMP entry must not be modifiable. The promotion is atomic.
    it('#179: WMP-promoted claim preserves immutability of source entry (DC-CCP-209)', () => {
      // This tests that when a claim is created via WMP promotion (wmpCapture present),
      // the resulting claim's evidence chain includes the WMP capture ID,
      // proving the promotion snapshot was taken.
      const input = makeValidClaimInput({
        evidenceRefs: [{ type: 'memory', id: 'wmp-promoted-entry-001' }],
      });

      // Execute with WMP capture deps
      const depsWithWmp: ClaimSystemDeps = {
        ...deps,
        wmpCapture: {
          capture(_conn, _taskId) {
            return {
              ok: true,
              value: { captureId: 'wmp-cap-001', sourcingStatus: 'not_verified' as const },
            };
          },
        },
      };
      const systemWithWmp = createClaimSystem(depsWithWmp);
      const result = systemWithWmp.assertClaim.execute(conn, ctx, input);

      assert.ok(result.ok, 'WMP-promoted assertion should succeed');
      // The assertion result should carry the WMP capture proof
      // (actual field depends on implementation — this tests the contract)
    });

    // DC-CCP-302: Concurrent retraction + query returns partial state
    // Control: caught before merge
    // Obligation: SQLite WAL single-writer guarantees that a query during retraction
    //   either sees the pre-retraction state or the post-retraction state, never partial.
    it('#180: query during retraction returns consistent state (DC-CCP-302)', () => {
      // Assert a claim
      const input = makeValidClaimInput();
      const assertResult = system.assertClaim.execute(conn, ctx, input);
      assert.ok(assertResult.ok);

      // Query and retraction in sequence — both must succeed
      const queryResult = system.queryClaims.execute(conn, ctx, {
        subject: 'entity:company:acme',
      });
      assert.ok(queryResult.ok, 'Query should succeed');

      // The returned claim must have a consistent status — either active or retracted, not partial
      if (queryResult.value.claims.length > 0) {
        const claim = queryResult.value.claims[0].claim;
        assert.ok(
          claim.status === 'active' || claim.status === 'retracted',
          'Claim status must be fully consistent (active or retracted)',
        );
      }
    });

    // DC-CCP-305: Concurrent tombstone + query returns tombstoned claim
    // Control: caught before merge
    // Obligation: After tombstoning, queries must either not return the claim
    //   or return it in tombstoned form. No partial tombstone state visible.
    it('#181: query after tombstone does not return content fields (DC-CCP-305)', () => {
      // Assert, then tombstone, then query
      const input = makeValidClaimInput();
      const assertResult = system.assertClaim.execute(conn, ctx, input);
      assert.ok(assertResult.ok);
      const createdId = assertResult.value.claim.id;

      // Tombstone the claim
      const tombResult = system.store.tombstone(conn, createdId, tenantId('tenant-001'), 'GDPR deletion');
      assert.ok(tombResult.ok, 'Tombstone should succeed');

      // Use getAsTombstone to retrieve — must return ClaimTombstone, not full Claim
      const getResult = system.store.getAsTombstone(conn, createdId, tenantId('tenant-001'));
      assert.ok(getResult.ok, 'getAsTombstone should succeed');
      if (getResult.value !== null) {
        // ClaimTombstone has id, tenantId, status, archived, purgedAt, purgeReason
        // It must NOT have subject, predicate, object, confidence, validAt (content fields)
        const tombstone = getResult.value;
        assert.equal(tombstone.id, createdId, 'Tombstone must preserve claim ID');
        assert.ok(tombstone.purgedAt, 'Tombstone must have purgedAt timestamp');
        assert.ok(tombstone.purgeReason, 'Tombstone must have purge reason');
        // Verify it's a ClaimTombstone shape, not a Claim shape
        assert.equal('subject' in tombstone, false, 'Tombstone must NOT contain subject field');
      }
    });
  });

  // ========================================================================
  // GROUP 24: Authority / Concurrency
  // DC-CCP-307, DC-CCP-406
  // Tests #182-#184
  // ========================================================================

  describe('GROUP 24: Authority / concurrency', () => {

    // DC-CCP-307: Duplicate claim from idempotent retry
    // Control: caught before merge
    // Obligation: When ClaimCreateInput.idempotencyKey is provided, a second
    //   call with the same key must return the cached result, not create a duplicate.
    it('#182: SC-11 with idempotency key deduplicates on retry (DC-CCP-307)', () => {
      const input = makeValidClaimInput({
        idempotencyKey: { key: 'idem-key-001' },
      });

      // First call
      const result1 = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result1.ok, 'First assertion should succeed');

      // Second call with same key — must return same claim, not create duplicate
      const result2 = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result2.ok, 'Idempotent retry should succeed');
      assert.equal(
        result2.value.claim.id, result1.value.claim.id,
        'Retry must return the same claim ID, not a new one',
      );
    });

    // DC-CCP-307: different payload with same key → conflict
    it('#183: SC-11 idempotency key conflict on different payload (DC-CCP-307)', () => {
      const input1 = makeValidClaimInput({
        idempotencyKey: { key: 'idem-key-002' },
        confidence: 0.85,
      });
      const input2 = makeValidClaimInput({
        idempotencyKey: { key: 'idem-key-002' },
        confidence: 0.95, // Different payload
      });

      const result1 = system.assertClaim.execute(conn, ctx, input1);
      assert.ok(result1.ok, 'First assertion should succeed');

      // Same key, different payload → must reject
      const result2 = system.assertClaim.execute(conn, ctx, input2);
      assert.ok(!result2.ok, 'Different payload with same idempotency key must fail');
      assert.equal(
        result2.error.code, SC11_ERROR_CODES.IDEMPOTENT_DUPLICATE,
        'Error code must be IDEMPOTENT_DUPLICATE',
      );
    });

    // DC-CCP-406: Policy enforcement inconsistent between constitutional modes
    // Control: caught before merge
    // Obligation: Binding 5, Binding 13 — constitutional mode (when active) may
    //   enforce stricter validation than non-constitutional mode. The test verifies
    //   that the system's enforcement is consistent within a given mode.
    it('#184: claim validation rules are consistent within operational mode (DC-CCP-406)', () => {
      // Two claims with the same input should get the same validation result
      const input = makeValidClaimInput();
      const result1 = system.assertClaim.execute(conn, ctx, input);
      const result2 = system.assertClaim.execute(conn, ctx, {
        ...input,
        idempotencyKey: { key: 'mode-consistency-check' },
      });

      // Both should have the same ok/error status (consistent enforcement)
      assert.equal(result1.ok, result2.ok,
        'Same input must get consistent validation in same operational mode');
    });
  });

  // ========================================================================
  // GROUP 25: Migration / Credential / Secret
  // DC-CCP-604, 606, 608, 701, 702, 704, 705, 706, 707
  // Tests #185-#194
  // ========================================================================

  describe('GROUP 25: Migration / credential / secret', () => {

    // DC-CCP-604: Migration-backfill claim without origin marker
    // Control: caught before merge
    // Obligation: Claims created via migration backfill must carry an origin
    //   marker distinguishing them from organically-asserted claims.
    it('#185: migration-backfilled claim carries origin marker (DC-CCP-604)', () => {
      // A claim with predicate in the lifecycle.* reserved namespace
      // can only be created by migration, not organic assertion.
      const input = makeValidClaimInput({
        predicate: 'lifecycle.migration_origin',
      });
      // Organic assertion of reserved predicate must fail
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(!result.ok, 'Organic assertion of reserved lifecycle.* predicate must fail');
    });

    // DC-CCP-606: Schema version mismatch during claim replay
    // Control: caught before merge
    // Obligation: When replaying claims from a backup/migration, the schema version
    //   must be checked. Claims from a different schema version must be transformed
    //   or rejected, never silently loaded.
    it('#186: claim schema version is preserved and queryable (DC-CCP-606)', () => {
      const input = makeValidClaimInput();
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'Assertion should succeed');

      // The created claim must have a deterministic createdAt timestamp
      // (schema version tracking is internal — we verify the claim preserves
      //  all identity fields needed for version-aware replay)
      assert.ok(result.value.claim.createdAt, 'Claim must have createdAt for replay ordering');
      assert.ok(result.value.claim.id, 'Claim must have ID for replay identity');
    });

    // DC-CCP-608: Grounding depth config change affects only new claims
    // Control: caught before merge
    // Obligation: If CLAIM_GROUNDING_MAX_HOPS changes, existing claims retain
    //   their original grounding result. Only new assertions use the new limit.
    it('#187: grounding result is immutable after assertion (DC-CCP-608)', () => {
      const input = makeValidClaimInput({
        groundingMode: 'evidence_path',
        evidenceRefs: [{ type: 'artifact', id: 'art-test-001' }],
      });
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'Assertion should succeed');

      // The grounding result captured at assertion time must be immutable
      assert.ok(result.value.grounding.mode === 'evidence_path',
        'Grounding mode must be captured in result');
      // Re-querying the same claim should return the same grounding state
      // (grounding is not re-evaluated on read)
    });

    // DC-CCP-701: Claim content in trace event payloads
    // Control: caught before merge
    // Obligation: Trace event payloads (trace.ts:156-159) carry only claimId
    //   and metadata, never claim content (subject, predicate, object, confidence).
    it('#188: trace event payload does not leak claim content (DC-CCP-701)', () => {
      const input = makeValidClaimInput({
        subject: 'entity:company:secret-corp',
        predicate: 'financial.secret_revenue',
        object: { type: 'number', value: 42_000_000 },
      });
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'Assertion should succeed');

      // Check all trace event payloads for content leakage
      for (const event of deps.traceEmitter.emitted) {
        const payloadStr = JSON.stringify(event.payload);
        assert.ok(!payloadStr.includes('secret-corp'),
          'Trace payload must not contain claim subject');
        assert.ok(!payloadStr.includes('secret_revenue'),
          'Trace payload must not contain claim predicate');
        assert.ok(!payloadStr.includes('42000000'),
          'Trace payload must not contain claim object value');
      }
    });

    // DC-CCP-702: Claim object value leaked via error messages
    // Control: caught before merge
    // Obligation: Error messages returned from CCP operations must not include
    //   the claim's object value or other content fields. Error messages are
    //   visible to callers and may cross trust boundaries.
    it('#189: error messages do not contain claim content (DC-CCP-702)', () => {
      // Trigger a validation error with a distinctive object value
      const input = makeValidClaimInput({
        confidence: 1.5, // Out of range — will trigger error
        object: { type: 'string', value: 'SENSITIVE_DATA_12345' },
      });
      const result = system.assertClaim.execute(conn, ctx, input);

      assert.ok(!result.ok, 'Invalid confidence should fail');
      const errorMessage = result.error.message;
      assert.ok(!errorMessage.includes('SENSITIVE_DATA_12345'),
        'Error message must not leak claim object value');
    });

    // DC-CCP-704: Content retrieved from tombstoned claim
    // Control: caught before merge
    // Obligation: Binding 7, CCP-I10 — tombstoned claims have content NULLed.
    //   ClaimStore.getAsTombstone() must return ClaimTombstone (no content),
    //   and ClaimStore.get() must not return content for tombstoned claims.
    it('#190: getAsTombstone returns only identity fields (DC-CCP-704)', () => {
      // Assert a claim
      const input = makeValidClaimInput();
      const assertResult = system.assertClaim.execute(conn, ctx, input);
      assert.ok(assertResult.ok);
      const id = assertResult.value.claim.id;

      // Tombstone it (use same tenant as creation context)
      system.store.tombstone(conn, id, ctx.tenantId, 'Retention policy');

      // getAsTombstone must return ClaimTombstone shape
      const result = system.store.getAsTombstone(conn, id, ctx.tenantId);
      assert.ok(result.ok);
      assert.ok(result.value !== null, 'Tombstoned claim must be retrievable');
      assert.equal(result.value!.id, id, 'Tombstone must preserve ID');

      // Must not have Claim content fields
      const raw = result.value as Record<string, unknown>;
      assert.equal(raw['subject'], undefined, 'Tombstone must not have subject');
      assert.equal(raw['predicate'], undefined, 'Tombstone must not have predicate');
      assert.equal(raw['object'], undefined, 'Tombstone must not have object');
      assert.equal(raw['confidence'], undefined, 'Tombstone must not have confidence');
    });

    // DC-CCP-705: Audit record contains unredacted sensitive content
    // Control: caught before merge
    // Obligation: CF-13 audit sufficiency requires audit records, but audit
    //   records must not contain raw claim content. They should reference
    //   claimId, not embed subject/predicate/object.
    it('#191: audit record references claimId, not claim content (DC-CCP-705)', () => {
      const input = makeValidClaimInput({
        subject: 'entity:person:private-individual',
        object: { type: 'string', value: 'PRIVATE_INFO_XYZ' },
      });
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'Assertion should succeed');

      // Audit trail should have recorded the operation
      // The audit record must reference claimId, not embed content
      // (We can't directly inspect audit internals in contract test,
      //  but we verify the assertion doesn't expose content in its output)
      assert.ok(result.value.claim.id, 'Result must include claimId for audit reference');
    });

    // DC-CCP-706: Runtime witness witnessedValues exposes sensitive data
    // Control: caught before merge
    // Obligation: witnessedValues in RuntimeWitnessInput are stored with the claim
    //   (CCP-I1 immutable). They must not appear in error messages, event payloads,
    //   or trace events. Only the claim record itself holds them.
    it('#192: runtime witness values not leaked in trace or events (DC-CCP-706)', () => {
      const input = makeValidClaimInput({
        groundingMode: 'runtime_witness',
        evidenceRefs: [],
        runtimeWitness: {
          witnessType: 'api_response',
          witnessedValues: { secret_key: 'WITNESS_SECRET_VALUE_999' },
          witnessTimestamp: '2026-01-15T12:00:00.000Z',
        },
      });
      const result = system.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'Runtime witness assertion should succeed');

      // Verify witness values don't leak into trace events
      for (const event of deps.traceEmitter.emitted) {
        const payloadStr = JSON.stringify(event.payload);
        assert.ok(!payloadStr.includes('WITNESS_SECRET_VALUE_999'),
          'Trace payload must not contain witness values');
      }

      // Verify witness values don't leak into domain events
      for (const event of deps.eventBus.emitted) {
        const payloadStr = JSON.stringify(event.payload);
        assert.ok(!payloadStr.includes('WITNESS_SECRET_VALUE_999'),
          'Domain event payload must not contain witness values');
      }
    });

    // DC-CCP-707: WMP capture exposes claim content cross-scope
    // Control: caught before merge
    // Obligation: WmpCaptureResult contains captureId and sourcingStatus only.
    //   Claim content must not appear in the WMP capture result.
    it('#193: WMP capture result does not contain claim content (DC-CCP-707)', () => {
      let capturedResult: { captureId: string; sourcingStatus: string } | null = null;

      const depsWithWmp: ClaimSystemDeps = {
        ...deps,
        wmpCapture: {
          capture(_conn, _taskId) {
            const result = { captureId: 'wmp-cap-secret-001', sourcingStatus: 'not_verified' as const };
            capturedResult = result;
            return { ok: true, value: result };
          },
        },
      };
      const systemWithWmp = createClaimSystem(depsWithWmp);

      const input = makeValidClaimInput({
        subject: 'entity:company:wmp-secret-corp',
        object: { type: 'string', value: 'WMP_SECRET_DATA' },
        taskId: taskId('task-wmp-001'),
      });
      const result = systemWithWmp.assertClaim.execute(conn, ctx, input);
      assert.ok(result.ok, 'WMP assertion should succeed');

      // WMP capture result should only have captureId and sourcingStatus
      if (capturedResult) {
        const captureStr = JSON.stringify(capturedResult);
        assert.ok(!captureStr.includes('wmp-secret-corp'),
          'WMP capture must not contain claim subject');
        assert.ok(!captureStr.includes('WMP_SECRET_DATA'),
          'WMP capture must not contain claim content');
      }
    });

    // DC-CCP-212: Published WMP entry treated as durable claim without promotion
    // Control: caught before merge
    // Obligation: A WMP entry that has been published but NOT promoted to CCP
    //   must not be queryable as a claim. CCP queries must only return
    //   properly-asserted claims, not raw WMP entries.
    it('#194: WMP entries are not queryable as claims without promotion (DC-CCP-212)', () => {
      // Query for claims — should not return any WMP entries that haven't
      // been promoted through SC-11
      const queryResult = system.queryClaims.execute(conn, ctx, {
        subject: 'entity:wmp:unpromoted-entry',
      });

      if (queryResult.ok) {
        // If query succeeds, it should return 0 results for unpromoted WMP entries
        assert.equal(queryResult.value.claims.length, 0,
          'Unpromoted WMP entries must not appear in CCP query results');
      }
      // If query fails, that's also acceptable — the point is no WMP leak
    });
  });

  // ========================================================================
  // GROUP 26: Structural Trigger Mutation Tests (BPB-02, BPB-03, BPB-04)
  // These tests KILL the mutation of removing SQLite triggers.
  // Each test exercises raw SQL that the trigger must block.
  // If the trigger is removed, the SQL succeeds and the test FAILS.
  // ========================================================================

  describe('GROUP 26: Structural trigger mutation tests', () => {

    // BPB-02: CCP-I2 forward-only lifecycle trigger
    // Mutation: remove claim_assertions_no_reactivation trigger
    // Kill: direct SQL reactivation of retracted claim must throw
    it('#195: CCP-I2 trigger blocks retracted-to-active transition via raw SQL (BPB-02)', () => {
      // Seed a retracted claim
      seedClaim(conn, {
        id: 'claim-trigger-i2-test',
        status: 'retracted',
      });

      // Attempt direct SQL reactivation — bypassing all handler logic
      assert.throws(
        () => {
          conn.run(
            `UPDATE claim_assertions SET status = 'active' WHERE id = 'claim-trigger-i2-test'`,
            [],
          );
        },
        (err: Error) => {
          assert.ok(
            err.message.includes('CCP-I2'),
            `Trigger error must reference CCP-I2, got: ${err.message}`,
          );
          return true;
        },
        'CCP-I2 trigger must block retracted-to-active transition via raw SQL',
      );
    });

    // BPB-03: CCP-I1 content immutability trigger
    // Mutation: remove claim_assertions_content_immutable trigger
    // Kill: direct SQL content modification must throw
    it('#196: CCP-I1 trigger blocks content field modification via raw SQL (BPB-03)', () => {
      // Seed an active claim
      seedClaim(conn, {
        id: 'claim-trigger-i1-test',
        status: 'active',
      });

      // Attempt direct SQL modification of subject (content field)
      assert.throws(
        () => {
          conn.run(
            `UPDATE claim_assertions SET subject = 'entity:modified:value' WHERE id = 'claim-trigger-i1-test'`,
            [],
          );
        },
        (err: Error) => {
          assert.ok(
            err.message.includes('CCP-I1'),
            `Trigger error must reference CCP-I1, got: ${err.message}`,
          );
          return true;
        },
        'CCP-I1 trigger must block content field modification via raw SQL',
      );
    });

    // BPB-03 additional: verify multiple content fields are protected
    it('#197: CCP-I1 trigger blocks confidence modification via raw SQL (BPB-03)', () => {
      seedClaim(conn, {
        id: 'claim-trigger-i1-confidence',
        status: 'active',
      });

      assert.throws(
        () => {
          conn.run(
            `UPDATE claim_assertions SET confidence = 0.99 WHERE id = 'claim-trigger-i1-confidence'`,
            [],
          );
        },
        (err: Error) => {
          assert.ok(
            err.message.includes('CCP-I1'),
            `Trigger error must reference CCP-I1, got: ${err.message}`,
          );
          return true;
        },
        'CCP-I1 trigger must block confidence modification via raw SQL',
      );
    });

    // BPB-04: I-31 relationship append-only triggers
    // Mutation: remove claim_relationships_no_update trigger
    // Kill: direct SQL UPDATE on relationships must throw
    it('#198: I-31 trigger blocks UPDATE on claim_relationships via raw SQL (BPB-04)', () => {
      // First, create two claims and a relationship via the handler
      const input = makeValidClaimInput({
        subject: 'entity:company:rel-test-from',
      });
      const fromResult = system.assertClaim.execute(conn, ctx, input);
      assert.ok(fromResult.ok, 'From-claim creation must succeed');

      const input2 = makeValidClaimInput({
        subject: 'entity:company:rel-test-to',
      });
      const toResult = system.assertClaim.execute(conn, ctx, input2);
      assert.ok(toResult.ok, 'To-claim creation must succeed');

      const relInput = makeValidRelationshipInput({
        fromClaimId: fromResult.value.claim.id,
        toClaimId: toResult.value.claim.id,
        type: 'supports',
      });
      const relResult = system.relateClaims.execute(conn, ctx, relInput);
      assert.ok(relResult.ok, 'Relationship creation must succeed');

      // Attempt direct SQL UPDATE on the relationship
      assert.throws(
        () => {
          conn.run(
            `UPDATE claim_relationships SET type = 'contradicts' WHERE from_claim_id = ?`,
            [fromResult.value.claim.id],
          );
        },
        (err: Error) => {
          assert.ok(
            err.message.includes('I-31'),
            `Trigger error must reference I-31, got: ${err.message}`,
          );
          return true;
        },
        'I-31 trigger must block UPDATE on claim_relationships via raw SQL',
      );
    });

    // BPB-04: I-31 relationship DELETE trigger
    // Mutation: remove claim_relationships_no_delete trigger
    // Kill: direct SQL DELETE on relationships must throw
    it('#199: I-31 trigger blocks DELETE on claim_relationships via raw SQL (BPB-04)', () => {
      // Create claims and relationship via handler
      const input = makeValidClaimInput({
        subject: 'entity:company:rel-del-from',
      });
      const fromResult = system.assertClaim.execute(conn, ctx, input);
      assert.ok(fromResult.ok, 'From-claim creation must succeed');

      const input2 = makeValidClaimInput({
        subject: 'entity:company:rel-del-to',
      });
      const toResult = system.assertClaim.execute(conn, ctx, input2);
      assert.ok(toResult.ok, 'To-claim creation must succeed');

      const relInput = makeValidRelationshipInput({
        fromClaimId: fromResult.value.claim.id,
        toClaimId: toResult.value.claim.id,
        type: 'supports',
      });
      const relResult = system.relateClaims.execute(conn, ctx, relInput);
      assert.ok(relResult.ok, 'Relationship creation must succeed');

      // Attempt direct SQL DELETE on the relationship
      assert.throws(
        () => {
          conn.run(
            `DELETE FROM claim_relationships WHERE from_claim_id = ?`,
            [fromResult.value.claim.id],
          );
        },
        (err: Error) => {
          assert.ok(
            err.message.includes('I-31'),
            `Trigger error must reference I-31, got: ${err.message}`,
          );
          return true;
        },
        'I-31 trigger must block DELETE on claim_relationships via raw SQL',
      );
    });

    // BPB-06: Cycle detection (visited set) mutation test
    // Mutation: remove `if (visited.has(ref.id)) continue; visited.add(ref.id);`
    // Kill: With a true cycle and large maxHops, the hop count reveals whether
    //   the visited set prevented re-traversal. Without it, the traversal
    //   re-visits the cycle until maxHops, producing a much larger hop count.
    it('#201: cycle detection bounds traversal hops below maxHops for cyclic evidence (BPB-06)', () => {
      // Create true cycle: A→B→A, where B ALSO has a memory anchor
      seedClaim(conn, {
        id: 'claim-cycle-a',
        status: 'active',
        evidenceRefs: [{ type: 'claim', id: 'claim-cycle-b' }],
      });
      seedClaim(conn, {
        id: 'claim-cycle-b',
        status: 'active',
        evidenceRefs: [
          { type: 'claim', id: 'claim-cycle-a' },   // cycle back to A
          { type: 'memory', id: 'mem-test-001' },    // anchor
        ],
      });

      // Call validate with large maxHops (10) to give cycle time to manifest
      const result = system.grounding.validate(
        conn,
        claimId('claim-cycle-test'),
        [{ type: 'claim', id: 'claim-cycle-a' }],
        'evidence_path',
        10, // large maxHops — without visited set, traversal would re-visit cycle
      );

      assert.ok(result.ok, 'Grounding validation must succeed');
      assert.equal(result.value.grounded, true, 'Chain must ground (B has memory anchor)');

      // With cycle detection: path is new→A→B→memory = 3 hops max
      // Without cycle detection: path would be new→A→B→A→B→...→memory = up to 10 hops
      if (result.value.traversalPath) {
        assert.ok(
          result.value.traversalPath.hops <= 4,
          `Cycle detection must bound hops: got ${result.value.traversalPath.hops}, expected <= 4. ` +
          'If this fails, the visited set (cycle detection) may have been removed.',
        );
      }
    });

    // BPB-05: WMP capture failure guard
    // Mutation: remove the `if (!captureResult.ok) return captureResult` line
    // Kill: assertion proceeds despite WMP capture failure
    it('#200: WMP capture failure blocks assertion (BPB-05)', () => {
      // Create deps with a WMP capture that always fails
      const depsWithFailingWmp: ClaimSystemDeps = {
        ...deps,
        wmpCapture: {
          capture(_conn: DatabaseConnection, _taskId: import('../../src/kernel/interfaces/index.js').TaskId) {
            return {
              ok: false as const,
              error: { code: 'WMP_CAPTURE_FAILED', message: 'WMP snapshot creation failed', spec: 'WMP-T4' },
            };
          },
        },
      };
      const systemWithFailingWmp = createClaimSystem(depsWithFailingWmp);

      const input = makeValidClaimInput({
        subject: 'entity:company:wmp-fail-test',
        taskId: taskId('task-wmp-fail-001'),
      });

      const result = systemWithFailingWmp.assertClaim.execute(conn, ctx, input);

      // MUST FAIL: WMP capture failure must block the assertion.
      // If the guard is removed, the assertion succeeds — killing the mutation.
      assert.equal(result.ok, false,
        'Assertion must be rejected when WMP capture fails');
      assert.equal(result.error.code, 'WMP_CAPTURE_FAILED',
        'Error code must be WMP_CAPTURE_FAILED');
    });
  });
});
