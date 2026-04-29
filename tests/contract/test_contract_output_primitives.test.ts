/**
 * FR-001: Output Primitives Contract Tests.
 *
 * Verifies the semantic output primitive system end-to-end through the
 * createLimen() API surface, testing schema validation, storage, recall,
 * relationships, and rejection paths.
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 *
 * Spec ref: v4.0.0 Phase 4 FR-001
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-output-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

function trackInstance(limen: Limen): Limen {
  instancesToShutdown.push(limen);
  return limen;
}

afterEach(async () => {
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* already shut down */ }
  }
  instancesToShutdown.length = 0;
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  dirsToClean.length = 0;
});

describe('FR-001: Output Primitives', () => {

  // DC-OUT-01 [SUCCESS]: assert output.judgment stores and recalls correctly
  it('DC-OUT-01 [SUCCESS]: assert output.judgment stores and recalls correctly', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const primitive = {
      subject: 'auth design',
      assessment: 'PKCE is correct',
      rationale: 'OAuth 2.1 requires PKCE for public clients',
      score: 0.95,
    };

    const result = limen.output.assert('output.judgment', primitive, {
      subject: 'entity:review:auth-001',
    });

    assert.equal(result.ok, true, 'assert must succeed');
    if (!result.ok) return;
    assert.ok(result.value.claimId, 'must return a claimId');
    assert.equal(result.value.predicate, 'output.judgment');

    // Recall and verify
    const recall = limen.recall('entity:review:auth-001', 'output.judgment');
    assert.equal(recall.ok, true, 'recall must succeed');
    if (!recall.ok) return;
    assert.ok(recall.value.length >= 1, 'must find the claim');

    const stored = recall.value[0]!;
    assert.equal(stored.predicate, 'output.judgment');
    const parsed = JSON.parse(stored.value);
    assert.equal(parsed.subject, 'auth design');
    assert.equal(parsed.assessment, 'PKCE is correct');
    assert.equal(parsed.rationale, 'OAuth 2.1 requires PKCE for public clients');
    assert.equal(parsed.score, 0.95);
  });

  // DC-OUT-02 [SUCCESS]: assert output.assertion with confidence cap applied
  it('DC-OUT-02 [SUCCESS]: assert output.assertion with confidence cap applied', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const primitive = {
      content: 'The system is operational',
      confidence: 0.95,
      verifiable: true,
    };

    // Request 0.95 confidence — should be capped at maxAutoConfidence (0.7)
    const result = limen.output.assert('output.assertion', primitive, {
      confidence: 0.95,
    });

    assert.equal(result.ok, true, 'assert must succeed');
    if (!result.ok) return;

    // Confidence should be capped at 0.7 (default maxAutoConfidence)
    assert.equal(result.value.confidence, 0.7, `confidence should be capped at exactly 0.7, got ${result.value.confidence}`);
  });

  // DC-OUT-03 [REJECTION]: malformed primitive rejected (missing required field)
  it('DC-OUT-03 [REJECTION]: malformed primitive rejected (missing required field)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Missing 'rationale' which is required for judgment
    const malformed = {
      subject: 'auth design',
      assessment: 'PKCE is correct',
      // rationale: MISSING
    };

    const result = limen.output.assert('output.judgment', malformed);

    assert.equal(result.ok, false, 'malformed primitive must be rejected');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_OUTPUT_PRIMITIVE');
    assert.ok(result.error.message.includes('rationale'), 'error must mention missing field');
  });

  // DC-OUT-04 [REJECTION]: unknown output.* predicate rejected
  it('DC-OUT-04 [REJECTION]: unknown output.* predicate rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const primitive = { content: 'test' };

    const result = limen.output.assert('output.unknown_type', primitive);

    assert.equal(result.ok, false, 'unknown output type must be rejected');
    if (result.ok) return;
    assert.equal(result.error.code, 'UNKNOWN_OUTPUT_PREDICATE');
  });

  // DC-OUT-05 [SUCCESS]: query by type returns only matching primitives
  it('DC-OUT-05 [SUCCESS]: query by type returns only matching primitives', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Assert a judgment
    const j1 = limen.output.assert('output.judgment', {
      subject: 'design A',
      assessment: 'good',
      rationale: 'clean architecture',
    });
    assert.equal(j1.ok, true, 'judgment assert must succeed');

    // Assert an alert
    const a1 = limen.output.assert('output.alert', {
      severity: 'warning',
      subject: 'memory',
      details: 'heap usage at 80%',
      action_required: false,
    });
    assert.equal(a1.ok, true, 'alert assert must succeed');

    // Query only judgments
    const judgments = limen.output.query('output.judgment');
    assert.equal(judgments.ok, true, 'query must succeed');
    if (!judgments.ok) return;

    // Should contain only the judgment, not the alert
    assert.ok(judgments.value.length >= 1, 'must find at least one judgment');
    for (const belief of judgments.value) {
      assert.equal(belief.predicate, 'output.judgment', 'all results must be judgments');
    }
  });

  // DC-OUT-06 [SUCCESS]: output primitives participate in relationships
  it('DC-OUT-06 [SUCCESS]: output primitives participate in relationships (evidence supports judgment)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a judgment
    const j = limen.output.assert('output.judgment', {
      subject: 'database design',
      assessment: 'normalized schema preferred',
      rationale: 'reduces data anomalies',
    });
    assert.equal(j.ok, true);
    if (!j.ok) return;

    // Create evidence
    const e = limen.output.assert('output.evidence', {
      supports: j.value.claimId,
      data: 'benchmark shows 30% fewer update anomalies',
      source: 'internal benchmark Q1',
      freshness: 'cached',
    });
    assert.equal(e.ok, true);
    if (!e.ok) return;

    // Connect: evidence supports judgment
    const conn = limen.connect(e.value.claimId, j.value.claimId, 'supports');
    assert.equal(conn.ok, true, 'connect must succeed');
  });

  // DC-OUT-07 [SUCCESS]: retraction works for output primitives
  it('DC-OUT-07 [SUCCESS]: retraction works for output primitives', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const r = limen.output.assert('output.alert', {
      severity: 'info',
      subject: 'test',
      details: 'ephemeral alert',
      action_required: false,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;

    // Retract
    const forget = limen.forget(r.value.claimId, 'manual');
    assert.equal(forget.ok, true, 'retraction must succeed');

    // Query should not return retracted
    const q = limen.output.query('output.alert');
    assert.equal(q.ok, true);
    if (!q.ok) return;

    // Retracted claims should not appear
    const found = q.value.find(b => b.claimId === r.value.claimId);
    assert.equal(found, undefined, 'retracted claim must not appear in query');
  });

  // DC-OUT-08 [REJECTION]: non-output.* predicate with output.assert rejected
  it('DC-OUT-08 [REJECTION]: non-output.* predicate with output.assert rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const result = limen.output.assert('decision.rationale', {
      content: 'trying to use output.assert for a non-output predicate',
    });

    assert.equal(result.ok, false, 'non-output predicate must be rejected');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_OUTPUT_PRIMITIVE');
    assert.ok(result.error.message.includes('output.*'), 'error must mention output.* namespace');
  });

  // ── Additional tests for all 7 primitive types ──

  it('All 7 primitive types validate and store correctly', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const primitives: Array<[string, object]> = [
      ['output.assertion', { content: 'the sky is blue', confidence: 0.99, verifiable: true }],
      ['output.judgment', { subject: 'code quality', assessment: 'excellent', rationale: 'clean, tested', score: 9.5 }],
      ['output.evidence', { supports: 'claim-123', data: 'test results', source: 'ci/cd', freshness: 'live' as const }],
      ['output.action', { description: 'deploy to prod', rationale: 'all tests green', urgency: 'immediate' as const, reversible: true, requires_approval: true }],
      ['output.question', { question: 'Should we migrate?', context: 'DB growth at 80%', blocking: true, options: ['yes', 'no', 'defer'], default: 'defer' }],
      ['output.alert', { severity: 'critical' as const, subject: 'disk', details: 'disk full at 95%', action_required: true }],
      ['output.narrative', { topic: 'sprint review', content: 'We delivered 5 features', audience: 'business' as const, depth: 'brief' as const }],
    ];

    for (const [predicate, primitive] of primitives) {
      const result = limen.output.assert(predicate, primitive);
      assert.equal(result.ok, true, `${predicate} assert must succeed: ${result.ok ? '' : JSON.stringify(result.error)}`);
    }
  });

  // ── Schema strictness: extra fields rejected ──

  it('Strict schema rejects extra fields', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const primitiveWithExtra = {
      content: 'test',
      confidence: 0.5,
      verifiable: true,
      extraField: 'should be rejected',
    };

    const result = limen.output.assert('output.assertion', primitiveWithExtra);
    assert.equal(result.ok, false, 'extra fields must be rejected by strict schema');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_OUTPUT_PRIMITIVE');
  });

  // ── Direct claim assertion with output.* predicate requires JSON type ──

  it('Direct claim.assertClaim with output.* predicate requires json type', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Try to assert an output.judgment with string type directly via claims API
    const result = limen.claims.assertClaim({
      subject: 'entity:test:direct',
      predicate: 'output.judgment',
      object: { type: 'string', value: 'not json' },
      confidence: 0.5,
      validAt: new Date().toISOString(),
      missionId: '' as any,
      taskId: null,
      groundingMode: 'runtime_witness',
      runtimeWitness: { witnessType: 'test', witnessedValues: {}, witnessTimestamp: new Date().toISOString() },
    });

    assert.equal(result.ok, false, 'output.* with non-json type must be rejected');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_OUTPUT_PRIMITIVE');
  });
});
