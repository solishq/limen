/**
 * Limen v1.0 — CCP Event Emission Contract Tests
 * Phase 1A: Truth Model Verification — Event Group
 *
 * Separated from main contract tests because events require EventBus mock.
 * These tests verify event scope, propagation, and payload per CCP §14.4.
 *
 * Spec ref: CCP §14.4, CCP-LI-08, FM-22
 * Tests #105-#110 (GROUP 8)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClaimSystem, NotImplementedError } from '../../src/claims/harness/claim_harness.js';
import { createTestDatabase, createTestOperationContext, createTestAuditTrail, tenantId, agentId, missionId, taskId } from '../helpers/test_database.js';
import type { ClaimSystem, ClaimSystemDeps, ClaimCreateInput, EvidenceSourceValidator } from '../../src/claims/interfaces/claim_types.js';
import { CCP_EVENTS } from '../../src/claims/interfaces/claim_types.js';
import type { DatabaseConnection, OperationContext, EventBus, TenantId } from '../../src/kernel/interfaces/index.js';

// ============================================================================
// Test Helpers — reused from main test file
// ============================================================================

type ClaimId = import('../../src/claims/interfaces/claim_types.js').ClaimId;

function claimId(id: string = 'claim-test-001'): ClaimId {
  return id as ClaimId;
}

function createMockEventBus(): EventBus & { emitted: Array<{ type: string; scope: string; propagation: string; payload: unknown }> } {
  const emitted: Array<{ type: string; scope: string; propagation: string; payload: unknown }> = [];
  return {
    emitted,
    emit(_conn, _ctx, event) {
      emitted.push({
        type: event.type,
        scope: event.scope,
        propagation: event.propagation,
        payload: event.payload,
      });
      return { ok: true, value: 'evt-mock' as import('../../src/kernel/interfaces/index.js').EventId };
    },
    subscribe(_pattern, _handler) { return { ok: true, value: 'sub-mock' }; },
    unsubscribe(_id) { return { ok: true, value: undefined }; },
    registerWebhook(_conn, _ctx, _pattern, _url, _secret) { return { ok: true, value: 'wh-mock' }; },
    processWebhooks(_conn) { return { ok: true, value: { delivered: 0, failed: 0, exhausted: 0 } }; },
  };
}

function createMockEvidenceValidator(): EvidenceSourceValidator {
  return {
    exists(_conn, _type, _id, _tenantId) {
      return { ok: true, value: true };
    },
  };
}

function createTestClaimDeps(): ClaimSystemDeps & { eventBus: ReturnType<typeof createMockEventBus> } {
  return {
    audit: createTestAuditTrail(),
    eventBus: createMockEventBus(),
    evidenceValidator: createMockEvidenceValidator(),
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
}

function makeValidClaimInput(overrides?: Partial<ClaimCreateInput>): ClaimCreateInput {
  return {
    subject: 'entity:company:acme',
    predicate: 'financial.revenue',
    object: { type: 'number', value: 1_000_000 },
    confidence: 0.85,
    validAt: '2026-01-15T00:00:00.000Z',
    missionId: missionId('test-mission'),
    taskId: taskId('test-task'),
    evidenceRefs: [{ type: 'memory', id: 'mem-test-001' }],
    groundingMode: 'evidence_path',
    ...overrides,
  };
}

// ============================================================================
// GROUP 8: Events (scope + propagation)
// Tests #105-#110
// ============================================================================

describe('CCP Event Contract Tests — GROUP 8', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: ReturnType<typeof createTestClaimDeps>;
  let system: ClaimSystem;

  beforeEach(() => {
    const db = createTestDatabase();
    conn = db;
    ctx = createTestOperationContext();
    deps = createTestClaimDeps();
    system = createClaimSystem(deps);
  });

  it('#105: claim.asserted event emitted on successful SC-11, scope=mission, propagation=local', () => {
    // CATCHES: DC-CCP-022 — event scope/propagation incorrect
    const input = makeValidClaimInput();
    system.assertClaim.execute(conn, ctx, input);

    const assertedEvents = deps.eventBus.emitted.filter(e => e.type === 'claim.asserted');
    assert.ok(assertedEvents.length > 0, 'Must emit claim.asserted event');

    const event = assertedEvents[0];
    assert.strictEqual(event.scope, CCP_EVENTS.CLAIM_ASSERTED.scope);
    assert.strictEqual(event.propagation, CCP_EVENTS.CLAIM_ASSERTED.propagation);
  });

  it('#106: claim.retracted event emitted on retraction, scope=system, propagation=up', () => {
    // CATCHES: DC-CCP-022 — event scope/propagation incorrect
    const createResult = system.assertClaim.execute(conn, ctx, makeValidClaimInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    deps.eventBus.emitted.length = 0; // Clear creation events
    system.retractClaim.execute(conn, ctx, {
      claimId: createResult.value.claim.id,
      reason: 'manual',
    });

    const retractedEvents = deps.eventBus.emitted.filter(e => e.type === 'claim.retracted');
    assert.ok(retractedEvents.length > 0, 'Must emit claim.retracted event');

    const event = retractedEvents[0];
    assert.strictEqual(event.scope, CCP_EVENTS.CLAIM_RETRACTED.scope);
    assert.strictEqual(event.propagation, CCP_EVENTS.CLAIM_RETRACTED.propagation);
  });

  it('#107: claim.evidence.retracted emitted per dependent, scope=system', () => {
    // CATCHES: DC-CCP-016 — retraction events not emitted for dependents
    // Create claim A, create claim B with evidence → A, retract A
    const inputA = makeValidClaimInput();
    const resultA = system.assertClaim.execute(conn, ctx, inputA);
    assert.strictEqual(resultA.ok, true);
    if (!resultA.ok) return;

    const inputB = makeValidClaimInput({
      subject: 'entity:company:dependent',
      evidenceRefs: [{ type: 'claim', id: resultA.value.claim.id as string }],
    });
    system.assertClaim.execute(conn, ctx, inputB);

    deps.eventBus.emitted.length = 0;
    system.retractClaim.execute(conn, ctx, {
      claimId: resultA.value.claim.id,
      reason: 'manual',
    });

    const evidenceRetractedEvents = deps.eventBus.emitted.filter(
      e => e.type === 'claim.evidence.retracted',
    );
    assert.ok(evidenceRetractedEvents.length > 0, 'Must emit claim.evidence.retracted per dependent');

    const event = evidenceRetractedEvents[0];
    assert.strictEqual(event.scope, CCP_EVENTS.CLAIM_EVIDENCE_RETRACTED.scope);
  });

  it('#108: claim.relationship.declared emitted on SC-12, scope=mission, propagation=local', () => {
    // CATCHES: DC-CCP-022 — event scope/propagation
    const a = system.assertClaim.execute(conn, ctx, makeValidClaimInput());
    assert.strictEqual(a.ok, true);
    if (!a.ok) return;
    const b = system.assertClaim.execute(conn, ctx, makeValidClaimInput({ subject: 'entity:company:beta' }));
    assert.strictEqual(b.ok, true);
    if (!b.ok) return;

    deps.eventBus.emitted.length = 0;
    system.relateClaims.execute(conn, ctx, {
      fromClaimId: a.value.claim.id,
      toClaimId: b.value.claim.id,
      type: 'supports',
      missionId: missionId('test-mission'),
    });

    const relEvents = deps.eventBus.emitted.filter(e => e.type === 'claim.relationship.declared');
    assert.ok(relEvents.length > 0, 'Must emit claim.relationship.declared event');

    const event = relEvents[0];
    assert.strictEqual(event.scope, CCP_EVENTS.CLAIM_RELATIONSHIP_DECLARED.scope);
    assert.strictEqual(event.propagation, CCP_EVENTS.CLAIM_RELATIONSHIP_DECLARED.propagation);
  });

  it('#109: claim.tombstoned emitted on tombstone, scope=system', () => {
    // CATCHES: DC-CCP-022 — tombstone event
    const createResult = system.assertClaim.execute(conn, ctx, makeValidClaimInput());
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    deps.eventBus.emitted.length = 0;
    system.store.tombstone(conn, createResult.value.claim.id, ctx.tenantId, 'retention');

    const tombstoneEvents = deps.eventBus.emitted.filter(e => e.type === 'claim.tombstoned');
    assert.ok(tombstoneEvents.length > 0, 'Must emit claim.tombstoned event');

    const event = tombstoneEvents[0];
    assert.strictEqual(event.scope, CCP_EVENTS.CLAIM_TOMBSTONED.scope);
  });

  // BPB-07: Domain event payload content exposure audit
  // Verify that claim content fields (object_type, object_value) do NOT
  // appear in domain event payloads. Subject and predicate are present
  // for routing/identification purposes — documented architectural choice.
  it('#110b: CLAIM_ASSERTED event payload does not expose object_value or object_type (BPB-07)', () => {
    const input = makeValidClaimInput({
      subject: 'entity:company:secret-corp',
      predicate: 'financial.revenue',
      object: { type: 'number', value: 99_999_999 },
    });
    const result = system.assertClaim.execute(conn, ctx, input);
    assert.ok(result.ok, 'Assertion must succeed');

    const assertedEvents = deps.eventBus.emitted.filter(
      e => e.type === 'claim.asserted',
    );
    assert.ok(assertedEvents.length > 0, 'Must emit claim.asserted event');

    const payload = assertedEvents[0].payload as Record<string, unknown>;
    const payloadStr = JSON.stringify(payload);

    // object_value (the claim's actual value) must NOT be in the event
    assert.ok(
      !payloadStr.includes('99999999') && !payloadStr.includes('99_999_999'),
      'Domain event payload must not contain claim object_value',
    );
    assert.ok(
      !('object_type' in payload) && !('objectType' in payload),
      'Domain event payload must not contain object_type field',
    );
    assert.ok(
      !('object_value' in payload) && !('objectValue' in payload),
      'Domain event payload must not contain object_value field',
    );
    assert.ok(
      !('object' in payload),
      'Domain event payload must not contain object field',
    );
  });

  it('#110: claim.evidence.orphaned emitted when non-claim source purged, scope=system', () => {
    // CATCHES: I-30 — evidence orphaning event
    // When a memory or artifact is purged, claims referencing it get orphaned event
    const createResult = system.assertClaim.execute(conn, ctx, makeValidClaimInput({
      evidenceRefs: [{ type: 'memory', id: 'mem-orphan-test' }],
    }));
    assert.strictEqual(createResult.ok, true);
    if (!createResult.ok) return;

    deps.eventBus.emitted.length = 0;
    // Mark evidence as tombstoned (simulating memory purge)
    system.evidence.markSourceTombstoned(conn, 'memory', 'mem-orphan-test');

    const orphanEvents = deps.eventBus.emitted.filter(e => e.type === 'claim.evidence.orphaned');
    assert.ok(orphanEvents.length > 0, 'Must emit claim.evidence.orphaned event');

    const event = orphanEvents[0];
    assert.strictEqual(event.scope, CCP_EVENTS.CLAIM_EVIDENCE_ORPHANED.scope);
  });
});
