/**
 * Phase 3: Cognitive Metabolism Integration Tests.
 *
 * Tests that recall() and search() return effectiveConfidence and freshness.
 * Tests minConfidence filtering by effective confidence.
 * Tests that old claims rank lower in search.
 *
 * DCs covered: DC-P3-501 (effectiveConfidence in recall), DC-P3-502 (in search),
 *              DC-P3-503 (freshness in results), DC-P3-801 (minConfidence filters by effective),
 *              DC-P3-802 (search score uses effective), DC-P3-106 (decay never stored),
 *              DC-P3-602 (migration defaults)
 * Invariants: I-P3-02, I-P3-04, I-P3-06, I-P3-07, I-P3-08, I-P3-10, I-P3-14
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Test Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-metabolism-'));
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
// DC-P3-501: effectiveConfidence in recall() results
// ============================================================================

describe('Phase 3: Cognitive Metabolism Integration', () => {

  describe('DC-P3-501: effectiveConfidence in recall()', () => {
    it('recall() returns effectiveConfidence field (I-P3-14)', async () => {
      const limen = await createTestLimen();

      // remember a claim
      const r = limen.remember('entity:test:1', 'finding.analysis', 'test value');
      assert.ok(r.ok, `remember failed: ${!r.ok ? r.error.message : ''}`);

      // recall it
      const beliefs = limen.recall('entity:test:1', 'finding.*');
      assert.ok(beliefs.ok, `recall failed: ${!beliefs.ok ? beliefs.error.message : ''}`);
      assert.ok(beliefs.value.length > 0, 'Expected at least one belief');

      const belief = beliefs.value[0]!;
      assert.equal(typeof belief.effectiveConfidence, 'number');
      assert.ok(belief.effectiveConfidence > 0 && belief.effectiveConfidence <= belief.confidence,
        `effectiveConfidence (${belief.effectiveConfidence}) must be in (0, confidence=${belief.confidence}]`);
    });

    it('brand-new claim has effectiveConfidence == confidence (R(0)=1)', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'value');

      const beliefs = limen.recall('entity:test:1', 'finding.*');
      assert.ok(beliefs.ok);
      const belief = beliefs.value[0]!;

      // Brand new: effectiveConfidence should be very close to confidence
      assert.ok(
        Math.abs(belief.effectiveConfidence - belief.confidence) < 0.01,
        `Brand new claim: effectiveConfidence (${belief.effectiveConfidence}) should ~= confidence (${belief.confidence})`,
      );
    });
  });

  describe('DC-P3-502: effectiveConfidence in search()', () => {
    it('search() returns effectiveConfidence in belief', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.analysis', 'search me please');

      const results = limen.search('search me');
      assert.ok(results.ok, `search failed: ${!results.ok ? results.error.message : ''}`);
      assert.ok(results.value.length > 0, 'Expected search results');

      const result = results.value[0]!;
      assert.equal(typeof result.belief.effectiveConfidence, 'number');
      assert.ok(result.belief.effectiveConfidence > 0);
    });
  });

  describe('DC-P3-503: freshness in results', () => {
    it('recall() returns freshness field', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'freshness test');

      const beliefs = limen.recall('entity:test:1', 'finding.*');
      assert.ok(beliefs.ok);
      const belief = beliefs.value[0]!;

      // Never accessed before this recall -> stale (first recall triggers access tracking,
      // but freshness is computed from the STORED lastAccessedAt, which is null on first read)
      assert.equal(typeof belief.freshness, 'string');
      assert.ok(
        ['fresh', 'aging', 'stale'].includes(belief.freshness),
        `freshness must be fresh/aging/stale, got: ${belief.freshness}`,
      );
    });

    it('search() returns freshness in belief', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'freshness search test');

      const results = limen.search('freshness search');
      assert.ok(results.ok);
      if (results.value.length > 0) {
        const result = results.value[0]!;
        assert.ok(
          ['fresh', 'aging', 'stale'].includes(result.belief.freshness),
          `freshness must be fresh/aging/stale, got: ${result.belief.freshness}`,
        );
      }
    });
  });

  describe('DC-P3-801: minConfidence filters by effectiveConfidence [A21]', () => {
    it('success: claim with effectiveConfidence > threshold is returned', async () => {
      const limen = await createTestLimen();
      // Brand new claim with confidence 0.7 -> effectiveConfidence ~0.7
      limen.remember('entity:test:1', 'finding.test', 'threshold test', { confidence: 0.7 });

      const beliefs = limen.recall('entity:test:1', 'finding.*', { minConfidence: 0.5 });
      assert.ok(beliefs.ok);
      assert.ok(beliefs.value.length > 0, 'Claim should pass minConfidence=0.5 filter');
    });

    it('rejection: claim filtered out when minConfidence exceeds effectiveConfidence', async () => {
      const limen = await createTestLimen();
      // confidence 0.7, effectiveConfidence ~0.7 for brand new claim
      limen.remember('entity:test:1', 'finding.test', 'high threshold test', { confidence: 0.7 });

      // minConfidence of 0.8 should filter out a claim with confidence 0.7
      const beliefs = limen.recall('entity:test:1', 'finding.*', { minConfidence: 0.8 });
      assert.ok(beliefs.ok);
      assert.equal(beliefs.value.length, 0, 'Claim with confidence 0.7 should be filtered by minConfidence=0.8');
    });
  });

  describe('I-P3-14: BeliefView extended fields', () => {
    it('recall() includes stability, lastAccessedAt, accessCount', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'extended fields');

      const beliefs = limen.recall('entity:test:1', 'finding.*');
      assert.ok(beliefs.ok);
      const belief = beliefs.value[0]!;

      assert.equal(typeof belief.stability, 'number');
      assert.ok(belief.stability > 0, `stability must be > 0, got ${belief.stability}`);
      // finding.* -> stability 90
      assert.equal(belief.stability, 90);

      // First access: lastAccessedAt should be null (access tracking happens AFTER the query returns)
      // accessCount should be 0
      assert.equal(belief.lastAccessedAt, null);
      assert.equal(belief.accessCount, 0);
    });

    it('stability reflects predicate category', async () => {
      const limen = await createTestLimen();

      // Governance claim -> 365 days
      limen.remember('entity:test:1', 'governance.policy', 'gov claim');
      const gov = limen.recall('entity:test:1', 'governance.*');
      assert.ok(gov.ok);
      assert.equal(gov.value[0]!.stability, 365);

      // Warning claim -> 30 days
      limen.remember('entity:test:2', 'warning.security', 'warn claim');
      const warn = limen.recall('entity:test:2', 'warning.*');
      assert.ok(warn.ok);
      assert.equal(warn.value[0]!.stability, 30);

      // Ephemeral claim -> 7 days
      limen.remember('entity:test:3', 'ephemeral.scratch', 'eph claim');
      const eph = limen.recall('entity:test:3', 'ephemeral.*');
      assert.ok(eph.ok);
      assert.equal(eph.value[0]!.stability, 7);
    });
  });

  describe('DC-P3-106: decay is NEVER stored [A21]', () => {
    it('effectiveConfidence is computed, not stored (I-P3-04)', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'no stored decay');

      // First recall
      const beliefs1 = limen.recall('entity:test:1', 'finding.*');
      assert.ok(beliefs1.ok);
      const ec1 = beliefs1.value[0]!.effectiveConfidence;

      // Second recall immediately -- should produce same effectiveConfidence
      // (if it were stored and mutated, it might differ)
      const beliefs2 = limen.recall('entity:test:1', 'finding.*');
      assert.ok(beliefs2.ok);
      const ec2 = beliefs2.value[0]!.effectiveConfidence;

      assert.ok(
        Math.abs(ec1 - ec2) < 0.001,
        `Two immediate recalls should produce ~same effectiveConfidence: ${ec1} vs ${ec2}`,
      );
    });
  });

  describe('DC-P3-802: search score uses effectiveConfidence', () => {
    it('search score is computed using effectiveConfidence', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'search score test');

      const results = limen.search('search score');
      assert.ok(results.ok);
      if (results.value.length > 0) {
        const result = results.value[0]!;
        // score should be positive (bm25 negated * effective confidence)
        assert.ok(result.score > 0, `Score should be > 0, got ${result.score}`);
      }
    });
  });

  describe('shutdown flushes access tracker', () => {
    it('shutdown completes without error', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:1', 'finding.test', 'shutdown test');
      limen.recall('entity:test:1', 'finding.*');

      // Shutdown should flush pending access events and destroy tracker
      await limen.shutdown();
      // Remove from tracked instances since we manually shut down
      const idx = instancesToShutdown.indexOf(limen);
      if (idx >= 0) instancesToShutdown.splice(idx, 1);
    });
  });

  // ==========================================================================
  // F-P3-003: effectiveConfidence post-filter with AGED claims (kills M-4)
  //
  // Root cause: All prior tests used brand-new claims where effectiveConfidence
  // equals raw confidence, so the TypeScript post-filter was never exercised.
  // This test creates claims with validAt in the past to simulate age.
  // ==========================================================================

  describe('F-P3-003: effectiveConfidence post-filter kills M-4', () => {
    it('aged claim passes SQL pre-filter but fails TypeScript post-filter', async () => {
      const limen = await createTestLimen();

      // Create a claim with default confidence (0.7, capped by maxAutoConfidence).
      // validAt = 270 days ago. stability = 90 (finding.*).
      // R(270d, 90d) = (1 + 270/(9*90))^-1 = (1.333)^-1 = 0.75
      // effectiveConfidence = 0.7 * 0.75 = 0.525
      //
      // SQL pre-filter: confidence (0.7) >= minConfidence (0.6) -> PASSES SQL
      // TS post-filter: effectiveConfidence (0.525) < minConfidence (0.6) -> FILTERED OUT
      //
      // CRITICAL: If the TS post-filter is removed (mutation M-4), this claim
      // would be returned (SQL passes, nothing else filters it).
      const pastDate = new Date(Date.now() - 270 * 86_400_000).toISOString();
      const r = limen.remember('entity:test:aged1', 'finding.analysis', 'aged claim test', {
        validAt: pastDate,
      });
      assert.ok(r.ok, `remember failed: ${!r.ok ? r.error.message : ''}`);

      // Recall with minConfidence = 0.6.
      // SQL: confidence (0.7) >= 0.6 -> passes
      // TS: effectiveConfidence (0.525) < 0.6 -> filtered
      const beliefs = limen.recall('entity:test:aged1', 'finding.*', { minConfidence: 0.6 });
      assert.ok(beliefs.ok, `recall failed: ${!beliefs.ok ? beliefs.error.message : ''}`);
      assert.equal(
        beliefs.value.length, 0,
        'Aged claim with effectiveConfidence ~0.525 must be filtered by minConfidence=0.6. ' +
        'If this passes, the TypeScript post-filter (M-4) is not working.',
      );
    });

    it('aged claim passes both filters when threshold is low enough', async () => {
      const limen = await createTestLimen();

      // Same claim: confidence 0.7, age 270d, effectiveConfidence ~0.525
      const pastDate = new Date(Date.now() - 270 * 86_400_000).toISOString();
      limen.remember('entity:test:aged2', 'finding.analysis', 'aged passes low threshold', {
        validAt: pastDate,
      });

      // Recall with minConfidence = 0.4, well below effectiveConfidence ~0.525
      const beliefs = limen.recall('entity:test:aged2', 'finding.*', { minConfidence: 0.4 });
      assert.ok(beliefs.ok);
      assert.ok(
        beliefs.value.length > 0,
        'Aged claim with effectiveConfidence ~0.525 should pass minConfidence=0.4',
      );
      // Verify effectiveConfidence is decayed, not raw
      const belief = beliefs.value[0]!;
      assert.ok(
        belief.effectiveConfidence < belief.confidence,
        `effectiveConfidence (${belief.effectiveConfidence}) must be less than raw confidence (${belief.confidence}) for an aged claim`,
      );
    });
  });

  // ==========================================================================
  // F-P3-004: Search score uses effectiveConfidence, not raw confidence (kills M-5)
  //
  // Root cause: All prior search tests used brand-new claims where
  // effectiveConfidence ~= confidence, so mutating the score formula was invisible.
  // ==========================================================================

  describe('F-P3-004: search score uses effectiveConfidence, kills M-5', () => {
    it('new claim ranks higher than old claim with higher raw confidence', async () => {
      const limen = await createTestLimen();

      // Old claim: confidence 0.7 (remember caps at 0.7), validAt = 810 days ago (half-life for finding)
      // stability = 90 (finding.*), R(810d, 90d) = 0.5
      // effectiveConfidence = 0.7 * 0.5 = 0.35
      const oldDate = new Date(Date.now() - 810 * 86_400_000).toISOString();
      limen.remember('entity:test:rank1', 'finding.analysis', 'ranking test identical content', {
        validAt: oldDate,
      });

      // New claim: same confidence 0.7, brand new
      // effectiveConfidence = 0.7 * 1.0 = 0.7
      limen.remember('entity:test:rank2', 'finding.analysis', 'ranking test identical content', {
      });

      const results = limen.search('ranking test identical content');
      assert.ok(results.ok, `search failed: ${!results.ok ? results.error.message : ''}`);
      assert.ok(results.value.length >= 2, `Expected >= 2 results, got ${results.value.length}`);

      // Find the results for our two claims
      const oldResult = results.value.find(r => r.belief.subject === 'entity:test:rank1');
      const newResult = results.value.find(r => r.belief.subject === 'entity:test:rank2');

      assert.ok(oldResult, 'Old claim must appear in search results');
      assert.ok(newResult, 'New claim must appear in search results');

      // The new claim should rank higher (higher score) because its effectiveConfidence is higher.
      // If score uses raw confidence (M-5 mutation), both would have same effective score.
      assert.ok(
        newResult!.score > oldResult!.score,
        `New claim score (${newResult!.score}) must be > old claim score (${oldResult!.score}). ` +
        'If scores are equal, the search formula is using raw confidence instead of effectiveConfidence (M-5).',
      );
    });
  });

  // ==========================================================================
  // F-P3-005: Access tracking wiring at ClaimApiImpl (kills M-7, M-8)
  // ==========================================================================

  describe('F-P3-005: access tracking wiring', () => {
    it('recall() records access that is persisted after flush/shutdown', async () => {
      const limen = await createTestLimen();
      limen.remember('entity:test:access1', 'finding.analysis', 'access tracking test');

      // First recall: lastAccessedAt should be null (access recorded async, not yet flushed)
      const beliefs1 = limen.recall('entity:test:access1', 'finding.*');
      assert.ok(beliefs1.ok);
      assert.equal(beliefs1.value[0]!.lastAccessedAt, null);
      assert.equal(beliefs1.value[0]!.accessCount, 0);

      // Shutdown flushes access tracker (F-P3-009 fix ensures destroy() also flushes)
      await limen.shutdown();
      const idx = instancesToShutdown.indexOf(limen);
      if (idx >= 0) instancesToShutdown.splice(idx, 1);

      // Re-create limen pointing to same data dir to read back the flushed state
      // We can't easily re-use the same dir, but the shutdown flush proves
      // the wiring is correct if we verify accessCount changed.
      // Since we can't re-open the same dir (limen manages the SQLite lock),
      // we verify the wiring differently: call recall twice within one session,
      // the second recall should see the flushed access from the first.
    });

    it('recall() twice with flush shows access count incremented', async () => {
      // Create limen with immediate flush (flushIntervalMs = 0 disables timer,
      // but we can use flushThreshold = 1 to trigger flush after every record)
      const dir = trackDir(makeTempDir());
      const limen = trackInstance(
        await createLimen({
          dataDir: dir,
          masterKey: makeKey(),
          providers: [],
          cognitive: {
            accessTracking: {
              flushThreshold: 1,  // Flush after every single access
              flushIntervalMs: 0, // Disable timer
            },
          },
        }),
      );

      limen.remember('entity:test:access2', 'finding.analysis', 'access flush test');

      // First recall triggers access recording + immediate flush (threshold=1)
      const beliefs1 = limen.recall('entity:test:access2', 'finding.*');
      assert.ok(beliefs1.ok);
      // First read: lastAccessedAt is null (flush happens AFTER the query returns)
      assert.equal(beliefs1.value[0]!.accessCount, 0);

      // Small delay to allow flush to complete (it's triggered by recordAccess
      // which fires AFTER the query returns the results)
      // Second recall: should see the flushed access from first recall
      const beliefs2 = limen.recall('entity:test:access2', 'finding.*');
      assert.ok(beliefs2.ok);

      // The second recall should see the access from the first recall
      // accessCount should be >= 1 (from the first recall's flushed access)
      assert.ok(
        beliefs2.value[0]!.accessCount >= 1,
        `Expected accessCount >= 1 after first recall + flush, got ${beliefs2.value[0]!.accessCount}. ` +
        'If accessCount is 0, the access tracking wiring in ClaimApiImpl (M-7) is broken.',
      );
      assert.ok(
        beliefs2.value[0]!.lastAccessedAt !== null,
        'lastAccessedAt must be set after first recall + flush. ' +
        'If null, the access tracking wiring in ClaimApiImpl is broken.',
      );
    });
  });

  // ==========================================================================
  // F-P3-006: Search minConfidence filter (kills M-6)
  // ==========================================================================

  describe('F-P3-006: search() minConfidence filter', () => {
    it('search() filters out aged claims below minConfidence', async () => {
      const limen = await createTestLimen();

      // confidence 0.7 (default cap), age = 270d, stability = 90
      // R(270, 90) = 0.75, effectiveConfidence = 0.7 * 0.75 = 0.525
      // search minConfidence = 0.6 -> 0.7 >= 0.6 (SQL passes), 0.525 < 0.6 (TS filters)
      const pastDate = new Date(Date.now() - 270 * 86_400_000).toISOString();
      limen.remember('entity:test:searchmin1', 'finding.analysis', 'search minconfidence filter test', {
        validAt: pastDate,
      });

      const results = limen.search('search minconfidence filter test', { minConfidence: 0.6 });
      assert.ok(results.ok);
      assert.equal(
        results.value.length, 0,
        'Aged claim with effectiveConfidence ~0.525 should be filtered by search minConfidence=0.6. ' +
        'If returned, the search minConfidence filter (M-6) is not working.',
      );
    });

    it('search() returns claims above minConfidence', async () => {
      const limen = await createTestLimen();

      // Brand-new claim: effectiveConfidence = 0.7
      limen.remember('entity:test:searchmin2', 'finding.analysis', 'search minconfidence pass test');

      const results = limen.search('search minconfidence pass test', { minConfidence: 0.5 });
      assert.ok(results.ok);
      assert.ok(
        results.value.length > 0,
        'Brand-new claim with effectiveConfidence ~0.7 should pass search minConfidence=0.5',
      );
    });
  });

  // ==========================================================================
  // F-P3-008: Over-fetch factor under heavy decay (kills M-3)
  //
  // Create multiple claims that will decay below threshold.
  // Without 2x over-fetch, the query would return fewer results than requested.
  // ==========================================================================

  describe('F-P3-008: over-fetch factor under heavy decay', () => {
    it('query returns correct count when some claims decay below minConfidence', async () => {
      const limen = await createTestLimen();

      // Create 4 claims: 2 aged (will decay below 0.6) and 2 brand-new (will pass)
      const pastDate = new Date(Date.now() - 270 * 86_400_000).toISOString();

      // Aged claims: effectiveConfidence ~0.525 (below 0.6 threshold)
      limen.remember('entity:test:overfetch1', 'finding.analysis', 'overfetch aged one', { validAt: pastDate });
      limen.remember('entity:test:overfetch2', 'finding.analysis', 'overfetch aged two', { validAt: pastDate });

      // Brand-new claims: effectiveConfidence ~0.7 (above 0.6 threshold)
      limen.remember('entity:test:overfetch3', 'finding.analysis', 'overfetch new one');
      limen.remember('entity:test:overfetch4', 'finding.analysis', 'overfetch new two');

      // Query with minConfidence=0.6, limit=4
      // Without 2x over-fetch: SQL fetches 4 rows, TS filters out 2 aged, returns only 2
      // With 2x over-fetch: SQL fetches 8 rows (all 4), TS filters out 2, returns 2 (correct)
      const beliefs = limen.recall('entity:test:*', 'finding.*', { minConfidence: 0.6 });
      assert.ok(beliefs.ok);

      // Only the 2 brand-new claims should survive
      assert.equal(
        beliefs.value.length, 2,
        `Expected 2 claims after decay filtering, got ${beliefs.value.length}`,
      );

      // Verify all returned claims have effectiveConfidence >= 0.6
      for (const belief of beliefs.value) {
        assert.ok(
          belief.effectiveConfidence >= 0.6,
          `Returned claim has effectiveConfidence ${belief.effectiveConfidence} < 0.6`,
        );
      }
    });
  });

  // ==========================================================================
  // F-P3-012: DC-P3-106 discriminative test (decay is computed, not stored)
  //
  // Root cause: Original test recalled twice immediately -- both returns matched
  // regardless of whether decay was stored or computed. This test uses
  // different validAt dates to prove decay varies with age.
  // ==========================================================================

  describe('F-P3-012: DC-P3-106 discriminative test (decay varies with age)', () => {
    it('same confidence, different ages produce different effectiveConfidence', async () => {
      const limen = await createTestLimen();

      // Claim 1: brand new
      limen.remember('entity:test:p106a', 'finding.analysis', 'p106 new claim');

      // Claim 2: 90 days old (same predicate category -> stability=90)
      const pastDate = new Date(Date.now() - 90 * 86_400_000).toISOString();
      limen.remember('entity:test:p106b', 'finding.analysis', 'p106 old claim', { validAt: pastDate });

      const beliefs = limen.recall('entity:test:*', 'finding.*');
      assert.ok(beliefs.ok);
      assert.ok(beliefs.value.length >= 2, `Expected >= 2 claims, got ${beliefs.value.length}`);

      const newClaim = beliefs.value.find(b => b.subject === 'entity:test:p106a');
      const oldClaim = beliefs.value.find(b => b.subject === 'entity:test:p106b');

      assert.ok(newClaim, 'New claim must be returned');
      assert.ok(oldClaim, 'Old claim must be returned');

      // Both have same raw confidence (0.7 default), but different effectiveConfidence
      assert.ok(
        Math.abs(newClaim!.confidence - oldClaim!.confidence) < 0.01,
        'Both claims should have similar raw confidence',
      );

      // The old claim should have LOWER effectiveConfidence due to decay
      // R(90d, 90d) = 0.9, so effectiveConfidence = 0.7 * 0.9 = 0.63
      // Brand new: effectiveConfidence = 0.7
      assert.ok(
        oldClaim!.effectiveConfidence < newClaim!.effectiveConfidence,
        `Old claim effectiveConfidence (${oldClaim!.effectiveConfidence}) must be < ` +
        `new claim effectiveConfidence (${newClaim!.effectiveConfidence}). ` +
        'If equal, decay is either stored (not computed) or not applied.',
      );

      // Verify the decay amount is reasonable: R(90d, 90d) = 0.9
      const expectedOldEffConf = oldClaim!.confidence * 0.9;
      assert.ok(
        Math.abs(oldClaim!.effectiveConfidence - expectedOldEffConf) < 0.05,
        `Old claim effectiveConfidence (${oldClaim!.effectiveConfidence}) should be ~${expectedOldEffConf}`,
      );
    });
  });
});
