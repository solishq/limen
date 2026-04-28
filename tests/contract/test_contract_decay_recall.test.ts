/**
 * Contract tests for WG-04: Decay in Convenience Recall.
 * v3.0.0 Phase 1, Slice 1.1
 *
 * Verifies:
 *   - I-CONV-DECAY: Convenience recall always returns decay-adjusted effectiveConfidence
 *   - Query-time stability resolution matches search path
 *   - Consistency between recall() and search() effectiveConfidence
 *   - F-V3P1-002: Cascade penalty via derived_from with retracted parent
 *   - F-V3P1-006: Consistency assertion is non-conditional (discriminative)
 *   - F-V3P1-007: resolveStability wiring with different predicate stability values
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

  it('DC-DECAY-03 [SUCCESS]: recall with cascade penalty via derived_from retracted parent returns reduced effectiveConfidence', async () => {
    // F-V3P1-002: Use derived_from relationship (what computeCascadePenalty traverses),
    // not contradicts (which computeCascadePenalty ignores).
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create parent claim
    const parent = limen.remember('entity:decay:parent', 'test.cascade', 'parent claim');
    assert.equal(parent.ok, true, 'parent remember must succeed');
    if (!parent.ok) return;
    const parentId = parent.value.claimId as string;

    // Create child claim
    const child = limen.remember('entity:decay:child', 'test.cascade', 'child claim');
    assert.equal(child.ok, true, 'child remember must succeed');
    if (!child.ok) return;
    const childId = child.value.claimId as string;

    // Create derived_from relationship: child derives from parent
    const connectResult = limen.connect(childId, parentId, 'derived_from');
    assert.equal(connectResult.ok, true, 'connect must succeed');

    // Recall child BEFORE retraction -- no cascade penalty yet
    const beforeRetract = limen.recall('entity:decay:child', 'test.cascade');
    assert.equal(beforeRetract.ok, true, 'recall before retraction must succeed');
    if (!beforeRetract.ok) return;
    assert.equal(beforeRetract.value.length, 1, 'must return exactly 1 belief before retraction');
    const beforeConf = beforeRetract.value[0]!.effectiveConfidence;

    // Retract the parent claim
    const forgetResult = limen.forget(parentId);
    assert.equal(forgetResult.ok, true, 'forget must succeed');

    // Recall child AFTER retraction -- cascade penalty should apply
    const afterRetract = limen.recall('entity:decay:child', 'test.cascade');
    assert.equal(afterRetract.ok, true, 'recall after retraction must succeed');
    if (!afterRetract.ok) return;
    assert.equal(afterRetract.value.length, 1, 'must return exactly 1 belief after retraction');
    const afterConf = afterRetract.value[0]!.effectiveConfidence;

    // F-V3P1-002: effectiveConfidence MUST be strictly less after parent retraction
    // First-degree cascade penalty = 0.5, so afterConf should be ~50% of beforeConf
    assert.ok(
      afterConf < beforeConf,
      `effectiveConfidence after retraction (${afterConf}) must be strictly less than before (${beforeConf})`,
    );
    // Verify the cascade multiplier is approximately 0.5 (first-degree penalty)
    const ratio = afterConf / beforeConf;
    assert.ok(
      ratio > 0.4 && ratio < 0.6,
      `cascade ratio (${ratio}) should be approximately 0.5 (first-degree penalty)`,
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
    // F-V3P1-006: Removed conditional guards. All assertions are unconditional.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create a claim with a known validAt in the past for measurable decay
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const remResult = limen.remember('entity:consistency:1', 'test.consistency', 'consistency check', {
      validAt: thirtyDaysAgo,
    });
    assert.equal(remResult.ok, true, 'remember must succeed');

    // Get effectiveConfidence via recall
    const recallResult = limen.recall('entity:consistency:1', 'test.consistency');
    assert.equal(recallResult.ok, true, 'recall must succeed');
    if (!recallResult.ok) return;

    // Get effectiveConfidence via search (fulltext)
    const searchResult = limen.search('consistency check');
    assert.equal(searchResult.ok, true, 'search must succeed');
    if (!searchResult.ok) return;

    // F-V3P1-006: Both paths MUST return results -- no conditional skipping
    assert.ok(recallResult.value.length > 0, 'recall must return results');
    assert.ok(searchResult.value.length > 0, 'search must return results');

    // Find the matching claim in search results
    const recallBelief = recallResult.value[0]!;
    const searchBelief = searchResult.value.find(sr => sr.belief.claimId === recallBelief.claimId);

    // F-V3P1-006: Matching claim MUST be found -- no conditional skip
    assert.ok(searchBelief, 'search must contain the same claim as recall');

    // effectiveConfidence should match between recall and search paths
    // Allow small floating-point tolerance (both compute from same formula)
    assert.ok(
      Math.abs(recallBelief.effectiveConfidence - searchBelief.belief.effectiveConfidence) < 0.001,
      `recall effectiveConfidence (${recallBelief.effectiveConfidence}) should match search effectiveConfidence (${searchBelief.belief.effectiveConfidence})`,
    );
  });

  it('DC-DECAY-06 [SUCCESS]: resolveStability wiring produces different effectiveConfidence for different predicate stability values (F-V3P1-007)', async () => {
    // F-V3P1-007: Verify that the resolveStability wiring in recall actually differentiates
    // predicates. governance.* has stability=365, warning.* has stability=30.
    // At the same age, the claim with lower stability decays faster.
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Create two claims with identical validAt (60 days ago) but different predicate domains
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const govResult = limen.remember('entity:stability:gov', 'governance.test', 'governance claim', {
      validAt: sixtyDaysAgo,
      confidence: 0.9,
    });
    assert.equal(govResult.ok, true, 'governance remember must succeed');

    const warnResult = limen.remember('entity:stability:warn', 'warning.test', 'warning claim', {
      validAt: sixtyDaysAgo,
      confidence: 0.9,
    });
    assert.equal(warnResult.ok, true, 'warning remember must succeed');

    // Recall both
    const govRecall = limen.recall('entity:stability:gov', 'governance.test');
    assert.equal(govRecall.ok, true, 'governance recall must succeed');
    if (!govRecall.ok) return;
    assert.equal(govRecall.value.length, 1, 'must return exactly 1 governance belief');

    const warnRecall = limen.recall('entity:stability:warn', 'warning.test');
    assert.equal(warnRecall.ok, true, 'warning recall must succeed');
    if (!warnRecall.ok) return;
    assert.equal(warnRecall.value.length, 1, 'must return exactly 1 warning belief');

    const govConf = govRecall.value[0]!.effectiveConfidence;
    const warnConf = warnRecall.value[0]!.effectiveConfidence;

    // governance.* stability = 365 days, warning.* stability = 30 days
    // At 60 days age: governance decay is mild (60/365 ratio), warning decay is severe (60/30 ratio)
    // FSRS: R(t) = (1 + t/(9*S))^(-1)
    // Gov: R(60) = (1 + 60/(9*365))^(-1) = (1 + 0.0183)^(-1) ~ 0.982
    // Warn: R(60) = (1 + 60/(9*30))^(-1) = (1 + 0.222)^(-1) ~ 0.818
    // So govConf should be significantly higher than warnConf
    assert.ok(
      govConf > warnConf,
      `governance effectiveConfidence (${govConf}) must be greater than warning effectiveConfidence (${warnConf}) due to higher stability`,
    );

    // Verify the difference is meaningful (not just floating point noise)
    assert.ok(
      govConf - warnConf > 0.05,
      `difference between governance (${govConf}) and warning (${warnConf}) effectiveConfidence must be > 0.05`,
    );
  });
});
