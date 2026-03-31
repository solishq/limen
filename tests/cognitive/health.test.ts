/**
 * Phase 5: Cognitive Health Report Tests.
 *
 * Tests computeCognitiveHealth() directly with a real SQLite database.
 * Covers: totalClaims accuracy, freshness distribution, confidence stats,
 *         conflict counting, gap detection, stale domains, empty DB.
 *
 * DCs covered: DC-P5-104, DC-P5-105, DC-P5-106, DC-P5-107, DC-P5-401, DC-P5-801, DC-P5-802
 * Invariants: I-P5-03, I-P5-04, I-P5-05, I-P5-06, I-P5-08, I-P5-09
 *
 * Breaker fix cycle:
 *   F-P5-001: Gap detection tests with old validAt dates (M-2 kill)
 *   F-P5-002: Stale domains tests with old last_accessed_at (M-3 kill)
 *   F-P5-004: Freshness bucket individual value assertions (M-7 kill)
 *   F-P5-009: Cross-tenant isolation test
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';

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

/** Create test Limen AND return the data directory (for direct DB access). */
async function createTestLimenWithDir(): Promise<{ limen: Limen; dir: string }> {
  const dir = trackDir(makeTempDir());
  const limen = trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
    }),
  );
  return { limen, dir };
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

  it('DC-P5-105 discriminative: newly created claims are classified as fresh or stale (not all-stale)', async () => {
    // F-P5-004 fix: M-7 survived because hardcoding all-stale still passed the sum invariant.
    // The access tracker is batched (flushes on a 5s timer), so recall() alone won't
    // update last_accessed_at in time. We use direct SQL to set last_accessed_at to now,
    // simulating what the access tracker does on flush.
    const { limen, dir } = await createTestLimenWithDir();

    // Create 5 claims
    const claimIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = limen.remember(`entity:test:fresh${i}`, `freshtest.prop${i}`, `value${i}`);
      assert.equal(r.ok, true);
      if (r.ok) claimIds.push(r.value.claimId);
    }

    // Set last_accessed_at to now via direct SQL (simulates access tracker flush)
    const nowISO = new Date().toISOString();
    const dbPath = join(dir, 'limen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      for (const id of claimIds) {
        db.prepare(
          `UPDATE claim_assertions SET last_accessed_at = ? WHERE id = ?`,
        ).run(nowISO, id);
      }
    } finally {
      db.close();
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const f = result.value.freshness;

    // All 5 claims were just accessed, so stale must be 0 and fresh must be > 0.
    // This kills M-7 (hardcoded all-stale: fresh=0, aging=0, stale=total).
    assert.equal(f.stale, 0,
      `Expected stale=0 for just-accessed claims, got stale=${f.stale}`);
    assert.equal(f.fresh, 5,
      `Expected fresh=5 for just-accessed claims, got fresh=${f.fresh}`);
    assert.equal(f.aging, 0,
      `Expected aging=0 for just-accessed claims, got aging=${f.aging}`);
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

  it('DC-P5-802 rejection: domain with only old claims appears in gaps with correct significance', async () => {
    // F-P5-001 fix: M-2 survived because zero tests exercised gap detection with old domains.
    // Create claims with validAt >30 days ago via the remember() API's validAt option.
    const limen = await createTestLimen();

    // 60 days ago — well past the default 30-day gap threshold
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();

    // Create claims in the "stale_domain" domain with old validAt dates
    for (let i = 0; i < 2; i++) {
      const r = limen.remember(
        `entity:test:old${i}`,
        `oldgap.topic${i}`,
        `old-value-${i}`,
        { validAt: sixtyDaysAgo },
      );
      assert.equal(r.ok, true, `Claim creation with old validAt should succeed`);
    }

    // Also create a recent claim in a DIFFERENT domain to ensure it doesn't appear
    limen.remember('entity:test:fresh', 'freshgap.topic', 'fresh-value');

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // "oldgap" domain should appear in gaps (all claims have validAt >30 days ago)
    const oldGap = result.value.gaps.find(g => g.domain === 'oldgap');
    assert.ok(oldGap, `Domain "oldgap" with only old claims must appear in gaps. Got gaps: ${JSON.stringify(result.value.gaps)}`);
    assert.ok(
      ['low', 'medium', 'high'].includes(oldGap!.significance),
      `Gap significance must be low/medium/high, got: ${oldGap!.significance}`,
    );

    // "freshgap" domain should NOT be in gaps
    const freshGap = result.value.gaps.find(g => g.domain === 'freshgap');
    assert.equal(freshGap, undefined,
      'Domain with recent claim should not appear in gaps');
  });

  it('DC-P5-802 significance: high significance for old domain with many claims', async () => {
    const limen = await createTestLimen();

    // 120 days ago — well past 90-day threshold for high significance
    const oneHundredTwentyDaysAgo = new Date(Date.now() - 120 * 86_400_000).toISOString();

    // Create >10 claims in the same domain (triggers high significance)
    for (let i = 0; i < 12; i++) {
      const r = limen.remember(
        `entity:test:highgap${i}`,
        `biggap.topic${i}`,
        `value-${i}`,
        { validAt: oneHundredTwentyDaysAgo },
      );
      assert.equal(r.ok, true);
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const gap = result.value.gaps.find(g => g.domain === 'biggap');
    assert.ok(gap, `Domain "biggap" must appear in gaps`);
    assert.equal(gap!.significance, 'high',
      `Expected high significance for >10 claims and >90 days old, got: ${gap!.significance}`);
  });
});

// ============================================================================
// DC-P5-802 / I-P5-09: Stale domains detection
// ============================================================================

describe('Phase 5: cognitive.health() stale domains (I-P5-09)', () => {
  it('DC-P5-802 stale: never-accessed claims appear in staleDomains', async () => {
    // F-P5-002 fix: M-3 survived because zero tests exercised staleDomains.
    // Claims that have never been recalled have last_accessed_at = NULL, which
    // the staleDomains computation should include as "never accessed".
    const limen = await createTestLimen();

    // Create claims WITHOUT recalling them (last_accessed_at stays NULL)
    for (let i = 0; i < 3; i++) {
      const r = limen.remember(
        `entity:test:neveraccessed${i}`,
        `staledom.topic`,
        `value-${i}`,
      );
      assert.equal(r.ok, true);
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // "staledom.topic" should appear in staleDomains as never accessed
    const staleDomain = result.value.staleDomains.find(s => s.predicate === 'staledom.topic');
    assert.ok(staleDomain,
      `Predicate "staledom.topic" with never-accessed claims must appear in staleDomains. Got: ${JSON.stringify(result.value.staleDomains)}`);
    assert.equal(staleDomain!.claimCount, 3,
      `Expected 3 never-accessed claims, got ${staleDomain!.claimCount}`);
    assert.equal(staleDomain!.newestClaimAge, 'never accessed',
      `Expected newestClaimAge to be "never accessed", got "${staleDomain!.newestClaimAge}"`);
  });

  it('DC-P5-802 stale: old last_accessed_at claims appear in staleDomains', async () => {
    // F-P5-002 fix: Test stale domains with claims that were accessed long ago.
    // Strategy: create claims, recall them (sets last_accessed_at), then use direct SQL
    // to backdate last_accessed_at to >30 days ago.
    const { limen, dir } = await createTestLimenWithDir();

    // Create and recall claims to set last_accessed_at
    for (let i = 0; i < 2; i++) {
      const r = limen.remember(
        `entity:test:staleclaim${i}`,
        `oldaccess.topic`,
        `value-${i}`,
      );
      assert.equal(r.ok, true);
    }
    // Recall to set last_accessed_at
    limen.recall(undefined, 'oldaccess.topic');

    // Use direct SQL to backdate last_accessed_at to 60 days ago
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const dbPath = join(dir, 'limen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      // last_accessed_at is NOT in the CCP-I1 immutable columns list, so UPDATE is allowed
      db.prepare(
        `UPDATE claim_assertions SET last_accessed_at = ? WHERE predicate = ?`,
      ).run(sixtyDaysAgo, 'oldaccess.topic');
    } finally {
      db.close();
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const staleDomain = result.value.staleDomains.find(s => s.predicate === 'oldaccess.topic');
    assert.ok(staleDomain,
      `Predicate "oldaccess.topic" with old last_accessed_at must appear in staleDomains. Got: ${JSON.stringify(result.value.staleDomains)}`);
    assert.equal(staleDomain!.claimCount, 2);
  });

  it('DC-P5-802 stale: recently accessed domains do NOT appear in staleDomains', async () => {
    // F-P5-002 fix: Ensure that freshly-accessed predicates are NOT in staleDomains.
    // Access tracker is batched, so we use direct SQL to set last_accessed_at to now.
    const { limen, dir } = await createTestLimenWithDir();

    const r1 = limen.remember('entity:test:fresh1', 'freshaccess.topic', 'value1');
    assert.equal(r1.ok, true);
    const r2 = limen.remember('entity:test:fresh2', 'freshaccess.topic', 'value2');
    assert.equal(r2.ok, true);

    // Set last_accessed_at to now via direct SQL (simulates access tracker flush)
    const nowISO = new Date().toISOString();
    const dbPath = join(dir, 'limen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      db.prepare(
        `UPDATE claim_assertions SET last_accessed_at = ? WHERE predicate = ?`,
      ).run(nowISO, 'freshaccess.topic');
    } finally {
      db.close();
    }

    const result = limen.cognitive.health();
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Recently accessed predicate should NOT be in staleDomains
    const staleDomain = result.value.staleDomains.find(s => s.predicate === 'freshaccess.topic');
    assert.equal(staleDomain, undefined,
      'Recently accessed predicate should not appear in staleDomains');
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

  it('DC-P5-401 rejection: health report excludes claims from other tenants', async () => {
    // F-P5-009 fix: No cross-tenant test existed. Insert a claim with a different
    // tenant_id via direct SQL and verify it is excluded from the health report.
    const { limen, dir } = await createTestLimenWithDir();

    // Create 2 claims in the default (null) tenant
    limen.remember('entity:test:def1', 'tenant.prop1', 'v1');
    limen.remember('entity:test:def2', 'tenant.prop2', 'v2');

    // Verify baseline: 2 claims
    let health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.totalClaims, 2);

    // Inject a claim with a different tenant_id via direct SQL
    const dbPath = join(dir, 'limen.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    try {
      const claimId = 'claim-other-tenant-' + randomBytes(8).toString('hex');
      db.prepare(`
        INSERT INTO claim_assertions
          (id, tenant_id, subject, predicate, object_type, object_value,
           confidence, valid_at, source_agent_id, grounding_mode,
           status, archived, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claimId,
        'other-tenant-id',
        'entity:test:other',
        'tenant.prop3',
        'string',
        '"other tenant value"',
        0.8,
        new Date().toISOString(),
        'test-agent',
        'runtime_witness',
        'active',
        0,
        new Date().toISOString(),
      );
    } finally {
      db.close();
    }

    // Health report for default (null) tenant should still show only 2 claims
    health = limen.cognitive.health();
    assert.equal(health.ok, true);
    if (!health.ok) return;
    assert.equal(health.value.totalClaims, 2,
      `Expected 2 claims for default tenant, got ${health.value.totalClaims} (other tenant claim leaked)`);
  });
});
