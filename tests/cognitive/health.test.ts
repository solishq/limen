/**
 * Phase 5: Cognitive Health Report Tests.
 *
 * Tests computeCognitiveHealth() directly with a real SQLite database.
 * Covers: totalClaims accuracy, freshness distribution, confidence stats,
 *         conflict counting, gap detection, stale domains, empty DB.
 *
 * DCs covered: DC-P5-104, DC-P5-105, DC-P5-106, DC-P5-107, DC-P5-801, DC-P5-802
 * Invariants: I-P5-03, I-P5-04, I-P5-05, I-P5-06, I-P5-08, I-P5-09
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ─── Test Helpers ───

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-health-'));
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

async function createTestLimen(): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  return trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
    }),
  );
}

// ============================================================================
// DC-P5-106 / I-P5-06: Empty knowledge base
// ============================================================================

describe('Phase 5: cognitive.health() on empty knowledge base (I-P5-06)', () => {
  it('DC-P5-106 success: returns all-zero values on empty DB', async () => {
    const limen = await createTestLimen();
    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const report = result.value;

    assert.equal(report.totalClaims, 0);
    assert.equal(report.freshness.fresh, 0);
    assert.equal(report.freshness.aging, 0);
    assert.equal(report.freshness.stale, 0);
    assert.equal(report.freshness.percentFresh, 0);
    assert.equal(report.conflicts.unresolved, 0);
    assert.deepStrictEqual(report.conflicts.critical, []);
    assert.equal(report.confidence.mean, 0);
    assert.equal(report.confidence.median, 0);
    assert.equal(report.confidence.below30, 0);
    assert.equal(report.confidence.above90, 0);
    assert.deepStrictEqual(report.gaps, []);
    assert.deepStrictEqual(report.staleDomains, []);

    // Verify no NaN or undefined
    assert.equal(Number.isNaN(report.confidence.mean), false);
    assert.equal(Number.isNaN(report.confidence.median), false);
    assert.equal(Number.isNaN(report.freshness.percentFresh), false);
  });
});

// ============================================================================
// DC-P5-104 / I-P5-03: totalClaims accuracy
// ============================================================================

describe('Phase 5: cognitive.health() totalClaims (I-P5-03)', () => {
  it('DC-P5-104 success: totalClaims matches number of active claims', async () => {
    const limen = await createTestLimen();

    // Create 5 claims
    for (let i = 0; i < 5; i++) {
      const r = limen.remember(`entity:test:${i}`, `test.prop${i}`, `value${i}`);
      assert.equal(r.ok, true);
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.totalClaims, 5);
  });

  it('DC-P5-104 rejection: totalClaims decreases after retraction', async () => {
    const limen = await createTestLimen();

    const r1 = limen.remember('entity:test:1', 'test.prop', 'value1');
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const r2 = limen.remember('entity:test:2', 'test.prop', 'value2');
    assert.equal(r2.ok, true);

    // Before retraction: 2 claims
    let health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.totalClaims, 2);

    // Retract one
    const retract = limen.forget(r1.value.claimId);
    assert.equal(retract.ok, true);

    // After retraction: 1 claim
    health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.totalClaims, 1);
  });
});

// ============================================================================
// DC-P5-105 / I-P5-04: Freshness distribution exhaustiveness
// ============================================================================

describe('Phase 5: cognitive.health() freshness distribution (I-P5-04)', () => {
  it('DC-P5-105 success: fresh + aging + stale === totalClaims', async () => {
    const limen = await createTestLimen();

    for (let i = 0; i < 10; i++) {
      const r = limen.remember(`entity:test:${i}`, `test.prop${i}`, `value${i}`);
      assert.equal(r.ok, true);
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const f = result.value.freshness;
    assert.equal(
      f.fresh + f.aging + f.stale,
      result.value.totalClaims,
      `Distribution (${f.fresh} + ${f.aging} + ${f.stale}) must equal totalClaims (${result.value.totalClaims})`,
    );
  });
});

// ============================================================================
// DC-P5-107 / I-P5-05: Conflicts count active-active only
// ============================================================================

describe('Phase 5: cognitive.health() conflicts (I-P5-05)', () => {
  it('DC-P5-107 success: counts unresolved contradicts between active claims', async () => {
    const limen = await createTestLimen();

    // Create two conflicting claims (same subject+predicate, different value)
    const r1 = limen.remember('entity:test:conflict', 'test.opinion', 'value-a');
    assert.equal(r1.ok, true);
    const r2 = limen.remember('entity:test:conflict', 'test.opinion', 'value-b');
    assert.equal(r2.ok, true);

    // Auto-conflict detection should create a contradicts relationship
    const health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.conflicts.unresolved >= 1, true,
      `Expected at least 1 unresolved conflict, got ${health.value.conflicts.unresolved}`);
  });

  it('DC-P5-107 rejection: retracted claim reduces unresolved count', async () => {
    const limen = await createTestLimen();

    const r1 = limen.remember('entity:test:conflict2', 'test.opinion2', 'value-a');
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const r2 = limen.remember('entity:test:conflict2', 'test.opinion2', 'value-b');
    assert.equal(r2.ok, true);

    // Before retraction: at least 1 conflict
    let health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    const conflictsBefore = health.value.conflicts.unresolved;

    // Retract one of the conflicting claims
    limen.forget(r1.value.claimId);

    // After retraction: conflict count decreases
    health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.conflicts.unresolved < conflictsBefore, true,
      `Expected fewer conflicts after retraction: before=${conflictsBefore}, after=${health.value.conflicts.unresolved}`);
  });
});

// ============================================================================
// DC-P5-801: Confidence statistics
// ============================================================================

describe('Phase 5: cognitive.health() confidence statistics (DC-P5-801)', () => {
  it('DC-P5-801 success: mean and median computed correctly', async () => {
    const limen = await createTestLimen();

    // Create claims with known confidences: 0.2, 0.5, 0.7 (default cap)
    limen.remember('entity:test:c1', 'test.conf1', 'v1', { confidence: 0.2 });
    limen.remember('entity:test:c2', 'test.conf2', 'v2', { confidence: 0.5 });
    limen.remember('entity:test:c3', 'test.conf3', 'v3'); // default 0.7

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Mean: (0.2 + 0.5 + 0.7) / 3 = 0.4667
    const expectedMean = (0.2 + 0.5 + 0.7) / 3;
    assert.ok(
      Math.abs(result.value.confidence.mean - expectedMean) < 0.01,
      `Expected mean ~${expectedMean}, got ${result.value.confidence.mean}`,
    );

    // Median of [0.2, 0.5, 0.7] = 0.5 (middle value)
    assert.ok(
      Math.abs(result.value.confidence.median - 0.5) < 0.01,
      `Expected median ~0.5, got ${result.value.confidence.median}`,
    );

    // below30: 1 (confidence 0.2 < 0.3)
    assert.equal(result.value.confidence.below30, 1);
    // above90: 0 (no confidence > 0.9)
    assert.equal(result.value.confidence.above90, 0);
  });
});

// ============================================================================
// DC-P5-802 / I-P5-08: Gap detection
// ============================================================================

describe('Phase 5: cognitive.health() gap detection (I-P5-08)', () => {
  it('DC-P5-802 success: domain with recent claim NOT in gaps', async () => {
    const limen = await createTestLimen();

    // Create a recent claim
    limen.remember('entity:test:recent', 'recent.topic', 'value');

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // The "recent" domain should NOT be in gaps (it has a recent valid_at)
    const recentGap = result.value.gaps.find(g => g.domain === 'recent');
    assert.equal(recentGap, undefined,
      'Domain with recent claim should not appear in gaps');
  });
});

// ============================================================================
// DC-P5-401: Tenant isolation
// ============================================================================

describe('Phase 5: cognitive.health() tenant isolation (DC-P5-401)', () => {
  it('DC-P5-401 success: single-tenant health report includes all claims', async () => {
    const limen = await createTestLimen();

    limen.remember('entity:test:t1', 'test.prop1', 'v1');
    limen.remember('entity:test:t2', 'test.prop2', 'v2');

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // Single-tenant mode: all claims counted
    assert.equal(result.value.totalClaims, 2);
  });
});
