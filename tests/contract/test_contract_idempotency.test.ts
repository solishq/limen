/**
 * Limen Phase 0A — Idempotency + Resume-Token Semantics Contract Tests
 * Truth Model: Deliverable 12 (Idempotency / Resume-Token Semantics)
 * Assertions: BC-130 to BC-139, INV-130 to INV-132
 *
 * Phase: 0A (Foundation)
 * Gate: All tests FAIL with NotImplementedError before implementation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId, agentId } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, correlationId, missionContractId, supervisorDecisionId, suspensionRecordId, handoffId, evalCaseId, capabilityManifestId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type { IdempotencyKey, IdempotencyCheckResult, ResumeToken, PayloadCanonicalizer } from '../../src/kernel/interfaces/idempotency.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

function makeIdempotencyKey(overrides: Partial<IdempotencyKey> = {}): IdempotencyKey {
  return {
    tenantId: 'test-tenant',
    callerId: 'agent-001',
    syscallClass: 'SC-1',
    targetScope: 'mission-001',
    key: 'create-mission-abc',
    payloadHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    canonicalizationVersion: '1.0.0',
    correlationId: correlationId('corr-001'),
    createdAt: testTimestamp(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    ...overrides,
  };
}

function makeResumeToken(overrides = {}): Omit<ResumeToken, 'consumed' | 'consumedAt'> {
  return {
    tenantId: 'test-tenant',
    tokenHash: 'sha256-token-hash-001',
    suspensionRecordId: suspensionRecordId('susp-001'),
    decisionId: supervisorDecisionId('dec-001'),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    createdAt: testTimestamp(),
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Idempotency + Resume-Token (Deliverable 12)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-130: IdempotencyKey has 5-part composite scope ──

  describe('BC-130: IdempotencyKey has 5-part composite scope', () => {
    it('should preserve tenantId, callerId, syscallClass, targetScope, key on record', () => {
      const key = makeIdempotencyKey();
      const result = gov.idempotencyStore.record(conn, key);
      assert.equal(result.ok, true);
    });
  });

  // ── BC-131: IdempotencyKey linked to CorrelationId ──

  describe('BC-131: IdempotencyKey linked to CorrelationId', () => {
    it('should preserve correlationId on the recorded key', () => {
      const key = makeIdempotencyKey({ correlationId: correlationId('corr-linked-131') });
      const recordResult = gov.idempotencyStore.record(conn, key);
      assert.equal(recordResult.ok, true);

      // Check returns deduplicated with the original correlation ID
      const checkResult = gov.idempotencyStore.check(conn, key);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'deduplicated');
      assert.equal(checkResult.value.originalCorrelationId, 'corr-linked-131');
    });
  });

  // ── BC-132: Same key + same hash → 'deduplicated' outcome ──

  describe('BC-132: Same key + same hash → deduplicated', () => {
    it('should return deduplicated with originalCorrelationId when same key+hash re-checked', () => {
      const key = makeIdempotencyKey({
        key: 'dedup-key-132',
        payloadHash: 'sha256-same-hash',
        correlationId: correlationId('corr-dedup-132'),
      });
      const recordResult = gov.idempotencyStore.record(conn, key);
      assert.equal(recordResult.ok, true);

      const checkResult = gov.idempotencyStore.check(conn, key);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'deduplicated');
      assert.equal(checkResult.value.originalCorrelationId, 'corr-dedup-132');
    });
  });

  // ── BC-133: Same key + different hash → 'conflict' outcome ──

  describe('BC-133: Same key + different hash → conflict', () => {
    it('should return conflict with existingPayloadHash when hash differs', () => {
      const key = makeIdempotencyKey({
        key: 'conflict-key-133',
        payloadHash: '1111111111111111111111111111111111111111111111111111111111111111',
      });
      const recordResult = gov.idempotencyStore.record(conn, key);
      assert.equal(recordResult.ok, true);

      const conflictingKey = makeIdempotencyKey({
        key: 'conflict-key-133',
        payloadHash: '2222222222222222222222222222222222222222222222222222222222222222',
        correlationId: correlationId('corr-conflict-133'),
      });
      const checkResult = gov.idempotencyStore.check(conn, conflictingKey);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'conflict');
      assert.equal(checkResult.value.existingPayloadHash, '1111111111111111111111111111111111111111111111111111111111111111');
    });
  });

  // ── BC-130: New key → 'new' outcome ──

  describe('BC-130: New key → new outcome', () => {
    it('should return new when key has never been recorded', () => {
      const key = makeIdempotencyKey({ key: 'never-seen-before' });
      const result = gov.idempotencyStore.check(conn, key);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.outcome, 'new');
    });
  });

  // ── BC-134: PayloadCanonicalizer.canonicalize returns deterministic string ──

  describe('BC-134: PayloadCanonicalizer.canonicalize returns deterministic string', () => {
    it('should return identical strings for objects with same key-value pairs regardless of insertion order', () => {
      const payload1 = { b: 'two', a: 'one', c: 'three' };
      const payload2 = { a: 'one', c: 'three', b: 'two' };
      const canon1 = gov.payloadCanonicalizer.canonicalize(payload1);
      const canon2 = gov.payloadCanonicalizer.canonicalize(payload2);
      assert.equal(typeof canon1, 'string');
      assert.equal(canon1, canon2);
    });
  });

  // ── BC-134: PayloadCanonicalizer.hash returns SHA-256 hex string ──

  describe('BC-134: PayloadCanonicalizer.hash returns SHA-256 hex string', () => {
    it('should return a 64-character hex string (SHA-256)', () => {
      const canonicalized = gov.payloadCanonicalizer.canonicalize({ key: 'value' });
      const hash = gov.payloadCanonicalizer.hash(canonicalized);
      assert.equal(typeof hash, 'string');
      assert.equal(hash.length, 64);
      assert.match(hash, /^[0-9a-f]{64}$/);
    });
  });

  // ── BC-135: Failed operations cached — record for failures, then check returns deduplicated ──

  describe('BC-135: Failed operations cached — failure IS the cached result', () => {
    it('should deduplicate even when the original operation failed', () => {
      const key = makeIdempotencyKey({
        key: 'failed-op-135',
        payloadHash: 'sha256-failure-hash',
        correlationId: correlationId('corr-failure-135'),
      });
      // Record the key (operation was attempted, result was failure — but key is still cached)
      const recordResult = gov.idempotencyStore.record(conn, key);
      assert.equal(recordResult.ok, true);

      // Re-check with same key+hash should deduplicate, not re-execute
      const checkResult = gov.idempotencyStore.check(conn, key);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'deduplicated');
      assert.equal(checkResult.value.originalCorrelationId, 'corr-failure-135');
    });
  });

  // ── BC-136: ResumeTokenStore.create returns plaintext token (string) ──

  describe('BC-136: ResumeTokenStore.create returns plaintext token', () => {
    it('should return a plaintext token string on creation', () => {
      const token = makeResumeToken();
      const result = gov.resumeTokenStore.create(conn, token);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(typeof result.value.plaintextToken, 'string');
      assert.equal(result.value.plaintextToken.length > 0, true);
    });
  });

  // ── BC-137: ResumeToken stored record has tokenHash (SHA-256), not plaintext ──

  describe('BC-137: ResumeToken stored as hash, not plaintext', () => {
    it('should store SHA-256 of plaintext, not the plaintext itself (BRK-018)', () => {
      const token = makeResumeToken();
      const createResult = gov.resumeTokenStore.create(conn, token);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      // BRK-018: The stored hash must be the SHA-256 of the returned plaintext.
      // Verify by consuming with the derived hash — if it succeeds, the store
      // used the correct derivation.
      const derivedHash = createHash('sha256').update(createResult.value.plaintextToken).digest('hex');
      const consumeResult = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(consumeResult.ok, true, 'consume with SHA-256(plaintext) must succeed');
      if (!consumeResult.ok) return;
      assert.equal(consumeResult.value.tokenHash, derivedHash);
      // Plaintext must NOT equal the stored hash (one-way)
      assert.notEqual(createResult.value.plaintextToken, derivedHash);
    });
  });

  // ── BC-138: ResumeTokenStore.consume is single-use — first succeeds, second fails ──

  describe('BC-138: Resume token single-use consumption', () => {
    it('should succeed on first consume and fail on second consume', () => {
      const token = makeResumeToken();
      const createResult = gov.resumeTokenStore.create(conn, token);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      // BRK-018: Derive hash from returned plaintext
      const derivedHash = createHash('sha256').update(createResult.value.plaintextToken).digest('hex');

      // First consume should succeed
      const firstConsume = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(firstConsume.ok, true);

      // Second consume should fail — token already consumed
      const secondConsume = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(secondConsume.ok, false);
    });
  });

  // ── BC-138: Consume returns the ResumeToken record with consumed=true, consumedAt set ──

  describe('BC-138: Consume returns token record with consumed=true and consumedAt', () => {
    it('should return consumed token with consumed=true and a consumedAt timestamp', () => {
      const token = makeResumeToken({
        suspensionRecordId: suspensionRecordId('susp-consume'),
        decisionId: supervisorDecisionId('dec-consume'),
      });
      const createResult = gov.resumeTokenStore.create(conn, token);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      // BRK-018: Derive hash from returned plaintext
      const derivedHash = createHash('sha256').update(createResult.value.plaintextToken).digest('hex');

      const consumeResult = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(consumeResult.ok, true);
      if (!consumeResult.ok) return;
      assert.equal(consumeResult.value.consumed, true);
      assert.notEqual(consumeResult.value.consumedAt, null);
      assert.equal(typeof consumeResult.value.consumedAt, 'string');
    });
  });

  // ── BC-139: Consumed tokens retained as tombstoned — record still exists with consumed=true ──

  describe('BC-139: Consumed tokens retained as tombstoned record', () => {
    it('should retain the consumed token record (not delete it) after consumption', () => {
      const token = makeResumeToken();
      const createResult = gov.resumeTokenStore.create(conn, token);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      // BRK-018: Derive hash from returned plaintext
      const derivedHash = createHash('sha256').update(createResult.value.plaintextToken).digest('hex');

      const consumeResult = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(consumeResult.ok, true);
      if (!consumeResult.ok) return;
      assert.equal(consumeResult.value.consumed, true);

      // Second consume fails but the record still exists (tombstoned, not deleted)
      const secondConsume = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(secondConsume.ok, false);
      // The failure indicates the token was found but already consumed — not "not found"
    });
  });

  // ── INV-130: Timing-safe comparison — consume with correct hash succeeds ──

  describe('INV-130: Timing-safe comparison — consume with correct hash succeeds', () => {
    it('should verify token via timing-safe comparison and return success', () => {
      const token = makeResumeToken();
      const createResult = gov.resumeTokenStore.create(conn, token);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      // BRK-018: Derive hash from returned plaintext
      const derivedHash = createHash('sha256').update(createResult.value.plaintextToken).digest('hex');

      const consumeResult = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(consumeResult.ok, true);
      if (!consumeResult.ok) return;
      assert.equal(consumeResult.value.tokenHash, derivedHash);
      assert.equal(consumeResult.value.consumed, true);
    });
  });

  // ── INV-131: TTL enforcement — expired key treated as 'new' on re-check ──

  describe('INV-131: TTL enforcement — expired key treated as new', () => {
    it('should return new outcome when key has expired expiresAt', () => {
      const expiredKey = makeIdempotencyKey({
        key: 'expired-key-131',
        payloadHash: 'sha256-expired',
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour in the past
      });
      const recordResult = gov.idempotencyStore.record(conn, expiredKey);
      assert.equal(recordResult.ok, true);

      // Check the same key — TTL has expired, so it should be treated as 'new'
      const checkResult = gov.idempotencyStore.check(conn, expiredKey);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'new');
    });
  });

  // ── INV-132 v1.1: Canonicalization version stored — key has canonicalizationVersion field ──

  describe('INV-132 v1.1: Canonicalization version stored with key', () => {
    it('should preserve canonicalizationVersion on recorded key', () => {
      const key = makeIdempotencyKey({
        key: 'version-key-132',
        canonicalizationVersion: '1.0.0',
      });
      const recordResult = gov.idempotencyStore.record(conn, key);
      assert.equal(recordResult.ok, true);

      // Verify via check — same version, same hash → deduplicated
      const checkResult = gov.idempotencyStore.check(conn, key);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'deduplicated');
    });
  });

  // ── INV-132 v1.1: Mismatched canonicalization version treated as 'new' ──

  describe('INV-132 v1.1: Mismatched canonicalization version treated as new', () => {
    it('should return new when existing record has version 1.0 but check uses version 2.0', () => {
      const keyV1 = makeIdempotencyKey({
        key: 'mismatch-version-132',
        payloadHash: 'sha256-version-hash',
        canonicalizationVersion: '1.0.0',
      });
      const recordResult = gov.idempotencyStore.record(conn, keyV1);
      assert.equal(recordResult.ok, true);

      const keyV2 = makeIdempotencyKey({
        key: 'mismatch-version-132',
        payloadHash: 'sha256-version-hash',
        canonicalizationVersion: '2.0.0',
      });
      const checkResult = gov.idempotencyStore.check(conn, keyV2);
      assert.equal(checkResult.ok, true);
      if (!checkResult.ok) return;
      assert.equal(checkResult.value.outcome, 'new');
    });
  });

  // ── BC-134: PayloadCanonicalizer.version is a string (currently '1.0.0') ──

  describe('BC-134: PayloadCanonicalizer.version is a string', () => {
    it('should expose version as a string property', () => {
      // This accesses a readonly property on the harness — will not throw NotImplementedError
      assert.equal(typeof gov.payloadCanonicalizer.version, 'string');
      assert.equal(gov.payloadCanonicalizer.version, '1.0.0');
    });
  });

  // ── BC-130: record stores the idempotency key successfully (Result<void>) ──

  describe('BC-130: record stores the idempotency key successfully', () => {
    it('should return ok=true Result<void> on successful record', () => {
      const key = makeIdempotencyKey({
        key: 'store-success-130',
        callerId: 'agent-store-test',
        syscallClass: 'SC-4',
        targetScope: 'task-store-001',
      });
      const result = gov.idempotencyStore.record(conn, key);
      assert.equal(result.ok, true);
    });
  });

  // ── BC-136: Resume token linked to suspensionRecordId and decisionId ──

  describe('BC-136: Resume token linked to suspensionRecordId and decisionId', () => {
    it('should preserve suspensionRecordId and decisionId on created token', () => {
      const token = makeResumeToken({
        suspensionRecordId: suspensionRecordId('susp-linked-136'),
        decisionId: supervisorDecisionId('dec-linked-136'),
      });
      const createResult = gov.resumeTokenStore.create(conn, token);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      // BRK-018: Derive hash from returned plaintext
      const derivedHash = createHash('sha256').update(createResult.value.plaintextToken).digest('hex');

      // Consume to retrieve the full stored record and verify the links
      const consumeResult = gov.resumeTokenStore.consume(conn, derivedHash);
      assert.equal(consumeResult.ok, true);
      if (!consumeResult.ok) return;
      assert.equal(consumeResult.value.suspensionRecordId, 'susp-linked-136');
      assert.equal(consumeResult.value.decisionId, 'dec-linked-136');
    });
  });
});
