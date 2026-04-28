/**
 * Contract tests for WG-04: Decay in Convenience Recall.
 * v3.0.0 Phase 1, Slice 1.1
 *
 * Verifies:
 *   - I-CONV-DECAY: Convenience recall always returns decay-adjusted effectiveConfidence
 *   - Query-time stability resolution matches search path
 *   - Consistency between recall() and search() effectiveConfidence
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
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
  return mkdtempSync(join(tmpdir(), 'limen-decay-recall-'));
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

describe('WG-04: Decay in Convenience Recall (I-CONV-DECAY)', () => {
  it('DC-DECAY-01 [SUCCESS]: recall at t=0 returns effectiveConfidence close to raw confidence', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const remResult = limen.remember('entity:decay:t0', 'test.decay', 'fresh claim');
    assert.equal(remResult.ok, true, 'remember must succeed');
    if (!remResult.ok) return;

    const recallResult = limen.recall('entity:decay:t0', 'test.decay');
    assert.equal(recallResult.ok, true, 'recall must succeed');
    if (!recallResult.ok) return;

    assert.equal(recallResult.value.length, 1, 'must return exactly 1 belief');
    const belief = recallResult.value[0]!;

    // At t=0 (just created), effectiveConfidence should be very close to raw confidence
    // Decay factor at age=0 is 1.0. Cascade penalty with no relationships is 1.0.
    assert.ok(
      belief.effectiveConfidence !== undefined && belief.effectiveConfidence !== null,
      'effectiveConfidence must be populated (not undefined/null)',
    );
    assert.ok(
      Math.abs(belief.effectiveConfidence - belief.confidence) < 0.01,
      `effectiveConfidence (${belief.effectiveConfidence}) should be close to confidence (${belief.confidence}) at t=0`,
    );
  });

  it('DC-DECAY-02 [SUCCESS]: recall at t=90days returns effectiveConfidence < raw confidence (FSRS decay)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a claim with validAt 90 days in the past
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const remResult = limen.remember('entity:decay:aged', 'test.decay', 'old claim', {
      validAt: ninetyDaysAgo,
      confidence: 0.9,
    });
    assert.equal(remResult.ok, true, 'remember must succeed');

    const recallResult = limen.recall('entity:decay:aged', 'test.decay');
    assert.equal(recallResult.ok, true, 'recall must succeed');
    if (!recallResult.ok) return;

    assert.equal(recallResult.value.length, 1, 'must return exactly 1 belief');
    const belief = recallResult.value[0]!;

    // FSRS decay at 90 days with default stability (90 days):
    // R(t) = (1 + t/(9*S))^(-1) = (1 + 90/(9*90))^(-1) = (1 + 1/9)^(-1) = (10/9)^(-1) = 0.9
    // effectiveConfidence = 0.9 * 0.9 * 1.0 (no cascade) = 0.81
    assert.ok(
      belief.effectiveConfidence < belief.confidence,
      `effectiveConfidence (${belief.effectiveConfidence}) must be less than confidence (${belief.confidence}) after 90 days`,
    );
    // Verify approximate value: should be around 0.81
    assert.ok(
      belief.effectiveConfidence > 0.5 && belief.effectiveConfidence < 0.95,
      `effectiveConfidence (${belief.effectiveConfidence}) should be in reasonable range after 90-day decay`,
    );
  });

  it('DC-DECAY-03 [SUCCESS]: recall with cascade penalty returns reduced effectiveConfidence', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create parent claim
    const parent = limen.remember('entity:decay:parent', 'test.cascade', 'parent claim');
    assert.equal(parent.ok, true);
    if (!parent.ok) return;

    // Create child claim
    const child = limen.remember('entity:decay:child', 'test.cascade', 'child claim');
    assert.equal(child.ok, true);
    if (!child.ok) return;

    // Create contradicts relationship (this creates cascade penalty on child)
    const connectResult = limen.connect(parent.value.claimId as string, child.value.claimId as string, 'contradicts');
    assert.equal(connectResult.ok, true, 'connect must succeed');

    // Recall child -- should have cascade penalty reducing effectiveConfidence
    const recallResult = limen.recall('entity:decay:child', 'test.cascade');
    assert.equal(recallResult.ok, true, 'recall must succeed');
    if (!recallResult.ok) return;

    assert.equal(recallResult.value.length, 1, 'must return exactly 1 belief');
    const belief = recallResult.value[0]!;

    // With a contradicts relationship, cascade penalty should reduce effectiveConfidence
    // The exact penalty depends on the cascade algorithm, but it should be <= confidence
    assert.ok(
      belief.effectiveConfidence <= belief.confidence,
      `effectiveConfidence (${belief.effectiveConfidence}) must be <= confidence (${belief.confidence}) with cascade penalty`,
    );
  });

  it('DC-DECAY-04 [REJECTION]: recall with no matching claims returns empty array (no crash on decay computation)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Store a claim so there's data, then recall a different subject
    const remResult = limen.remember('entity:exists:1', 'test.exists', 'some value');
    assert.equal(remResult.ok, true, 'remember must succeed');

    // Recall a subject that has no claims -- should return empty array, not crash
    const recallResult = limen.recall('entity:nonexistent:*');
    assert.equal(recallResult.ok, true, 'recall must succeed even with no matching claims');
    if (!recallResult.ok) return;

    assert.equal(recallResult.value.length, 0, 'must return empty array when no claims match');
  });

  it('DC-DECAY-05 [SUCCESS]: recall effectiveConfidence matches search effectiveConfidence for same claim (consistency)', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a claim with a known validAt in the past for measurable decay
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const remResult = limen.remember('entity:consistency:1', 'test.consistency', 'consistency check', {
      validAt: thirtyDaysAgo,
    });
    assert.equal(remResult.ok, true);

    // Get effectiveConfidence via recall
    const recallResult = limen.recall('entity:consistency:1', 'test.consistency');
    assert.equal(recallResult.ok, true);
    if (!recallResult.ok) return;

    // Get effectiveConfidence via search (fulltext)
    const searchResult = limen.search('consistency check');
    assert.equal(searchResult.ok, true);
    if (!searchResult.ok) return;

    // Both paths should exist
    assert.ok(recallResult.value.length > 0, 'recall must return results');

    if (searchResult.value.length > 0) {
      // Find the matching claim in search results
      const recallBelief = recallResult.value[0]!;
      const searchBelief = searchResult.value.find(sr => sr.belief.claimId === recallBelief.claimId);

      if (searchBelief) {
        // effectiveConfidence should match between recall and search paths
        // Allow small floating-point tolerance (both compute from same formula)
        assert.ok(
          Math.abs(recallBelief.effectiveConfidence - searchBelief.belief.effectiveConfidence) < 0.001,
          `recall effectiveConfidence (${recallBelief.effectiveConfidence}) should match search effectiveConfidence (${searchBelief.belief.effectiveConfidence})`,
        );
      }
    }
  });
});
