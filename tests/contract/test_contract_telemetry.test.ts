// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-004: Telemetry Schemas Contract Tests.
 *
 * Verifies the telemetry system end-to-end through the createLimen() API surface,
 * testing schema validation, storage, recall, and rejection paths.
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 *
 * Spec ref: v4.0.0 Phase 7 FR-004
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
  return mkdtempSync(join(tmpdir(), 'limen-telemetry-'));
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

describe('FR-004: Telemetry Schemas', () => {

  // DC-TEL-01 [SUCCESS]: record telemetry.cost stores and recalls
  it('DC-TEL-01 [SUCCESS]: record telemetry.cost stores and recalls', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const costData = {
      model: 'claude-opus-4',
      tokens: 1500,
      cost: 0.045,
      purpose: 'primary' as const,
    };

    const result = limen.telemetry.record('cost', costData, {
      subject: 'entity:telemetry:cost-001',
    });

    assert.equal(result.ok, true, 'record must succeed');
    if (!result.ok) return;
    assert.ok(result.value.claimId, 'must return a claimId');

    // Recall and verify
    const query = limen.telemetry.query('cost', {
      subject: 'entity:telemetry:cost-001',
    });
    assert.equal(query.ok, true, 'query must succeed');
    if (!query.ok) return;
    assert.ok(query.value.length >= 1, 'must find the claim');

    const stored = query.value[0]!;
    assert.equal(stored.predicate, 'telemetry.cost');
    const parsed = JSON.parse(stored.value);
    assert.equal(parsed.model, 'claude-opus-4');
    assert.equal(parsed.tokens, 1500);
    assert.equal(parsed.cost, 0.045);
    assert.equal(parsed.purpose, 'primary');
  });

  // DC-TEL-02 [SUCCESS]: record telemetry.vital stores correctly
  it('DC-TEL-02 [SUCCESS]: record telemetry.vital stores correctly', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const vitalData = {
      contextPct: 75.5,
      quality: 'OK' as const,
      costRate: 0.003,
    };

    const result = limen.telemetry.record('vital', vitalData);
    assert.equal(result.ok, true, 'record must succeed');
    if (!result.ok) return;
    assert.ok(result.value.claimId, 'must return a claimId');

    // Query all telemetry — vital should be present
    const query = limen.telemetry.query('vital');
    assert.equal(query.ok, true, 'query must succeed');
    if (!query.ok) return;
    assert.ok(query.value.length >= 1, 'must find at least one vital');

    const stored = query.value.find(b => b.predicate === 'telemetry.vital');
    assert.ok(stored, 'must find telemetry.vital claim');
    const parsed = JSON.parse(stored!.value);
    assert.equal(parsed.contextPct, 75.5);
    assert.equal(parsed.quality, 'OK');
    assert.equal(parsed.costRate, 0.003);
  });

  // DC-TEL-03 [REJECTION]: malformed telemetry rejected
  it('DC-TEL-03 [REJECTION]: malformed telemetry rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Missing required fields — tokens is missing
    const malformedData = {
      model: 'claude-opus-4',
      cost: 0.045,
      purpose: 'primary',
      // tokens: missing
    };

    const result = limen.telemetry.record('cost', malformedData);
    assert.equal(result.ok, false, 'must reject malformed data');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_TELEMETRY');
    assert.ok(result.error.message.includes('tokens'), 'error message must mention the missing field');

    // Verify state DID NOT CHANGE — no claims stored
    const query = limen.telemetry.query('cost');
    assert.equal(query.ok, true);
    if (!query.ok) return;
    assert.equal(query.value.length, 0, 'no claims should be stored after rejection');
  });

  // DC-TEL-04 [REJECTION]: unknown telemetry.* type rejected
  it('DC-TEL-04 [REJECTION]: unknown telemetry.* type rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Query with invalid type
    const result = limen.telemetry.query('nonexistent');
    assert.equal(result.ok, false, 'must reject unknown type');
    if (result.ok) return;
    assert.equal(result.error.code, 'UNKNOWN_TELEMETRY_PREDICATE');
  });

  // DC-TEL-05 [SUCCESS]: query with type filter returns matching only
  it('DC-TEL-05 [SUCCESS]: query with type filter returns matching only', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Record both cost and vital
    const costResult = limen.telemetry.record('cost', {
      model: 'gpt-4',
      tokens: 500,
      cost: 0.01,
      purpose: 'routing' as const,
    });
    assert.equal(costResult.ok, true);

    const vitalResult = limen.telemetry.record('vital', {
      contextPct: 50,
      quality: 'DEGRADED' as const,
      costRate: 0.005,
    });
    assert.equal(vitalResult.ok, true);

    // Query only cost
    const costQuery = limen.telemetry.query('cost');
    assert.equal(costQuery.ok, true);
    if (!costQuery.ok) return;
    assert.ok(costQuery.value.length >= 1, 'must find cost claims');
    assert.ok(costQuery.value.every(b => b.predicate === 'telemetry.cost'),
      'all results must be telemetry.cost');

    // Query only vital
    const vitalQuery = limen.telemetry.query('vital');
    assert.equal(vitalQuery.ok, true);
    if (!vitalQuery.ok) return;
    assert.ok(vitalQuery.value.length >= 1, 'must find vital claims');
    assert.ok(vitalQuery.value.every(b => b.predicate === 'telemetry.vital'),
      'all results must be telemetry.vital');
  });

  // DC-TEL-06 [SUCCESS]: query with since filter returns recent only
  it('DC-TEL-06 [SUCCESS]: query with since filter returns recent only', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Record a telemetry entry
    const result = limen.telemetry.record('audit', {
      action: 'login',
      target: 'user:admin',
      authorized: true,
    });
    assert.equal(result.ok, true);

    // Query with a future 'since' — should return nothing
    const futureDate = new Date(Date.now() + 60_000).toISOString(); // clock-exempt: test infrastructure
    const futureQuery = limen.telemetry.query('audit', { since: futureDate });
    assert.equal(futureQuery.ok, true);
    if (!futureQuery.ok) return;
    assert.equal(futureQuery.value.length, 0, 'future since filter should return nothing');

    // Query with a past 'since' — should return the entry
    const pastDate = new Date(Date.now() - 60_000).toISOString(); // clock-exempt: test infrastructure
    const pastQuery = limen.telemetry.query('audit', { since: pastDate });
    assert.equal(pastQuery.ok, true);
    if (!pastQuery.ok) return;
    assert.ok(pastQuery.value.length >= 1, 'past since filter should return the entry');
  });
});
