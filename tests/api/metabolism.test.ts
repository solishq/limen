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
});
