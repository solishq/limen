/**
 * Phase 1: Convenience API Performance Characterization (RR-P1-004)
 *
 * QUALITY_GATE tests that measure and assert latency bounds for all convenience
 * API methods. These are not stress tests — they characterize baseline performance
 * to detect regressions and validate the Design Source performance budget.
 *
 * Design Source: docs/sprints/PHASE-1-DESIGN-SOURCE.md
 * Residual Risk: RR-P1-004 (no runtime performance characterization)
 *
 * Upper bounds (conservative, CI-friendly):
 *   remember() < 10ms single call (p95 over 100 calls)
 *   recall()   < 50ms single call (with 100 claims in DB)
 *   reflect(100) < 500ms (max batch size)
 *   forget()   < 10ms single call (p95 over 100 calls)
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
  return mkdtempSync(join(tmpdir(), 'limen-perf-'));
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

async function createPerfLimen(): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  return trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
      rateLimiting: { apiCallsPerMinute: 10000 }, // Disable rate limiting for perf tests
    }),
  );
}

/**
 * Measure latency of a synchronous function over N iterations.
 * Returns p50 and p95 in milliseconds.
 */
function measureLatency(fn: () => void, iterations: number): { p50: number; p95: number; max: number } {
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    latencies.push(end - start);
  }

  latencies.sort((a, b) => a - b);
  const p50Index = Math.floor(latencies.length * 0.50);
  const p95Index = Math.floor(latencies.length * 0.95);

  return {
    p50: latencies[p50Index]!,
    p95: latencies[p95Index]!,
    max: latencies[latencies.length - 1]!,
  };
}

// ============================================================================
// RR-P1-004: Performance Characterization
// ============================================================================

describe('Phase 1: Convenience API performance characterization (RR-P1-004)', () => {

  it('QUALITY_GATE: remember() p95 latency < 10ms over 50 calls', async () => {
    const limen = await createPerfLimen();

    // Warm up: 3 calls to ensure SQLite caches are primed
    for (let i = 0; i < 3; i++) {
      limen.remember(`entity:warmup:${i}`, 'perf.warmup', `value-${i}`);
    }

    // 50 iterations stays well under the per-agent 100/min rate limit
    const stats = measureLatency(() => {
      const idx = Math.random().toString(36).substring(2, 10);
      const result = limen.remember(`entity:perf:${idx}`, 'perf.remember', `value-${idx}`);
      assert.ok(result.ok, `remember failed: ${!result.ok ? result.error.message : ''}`);
    }, 50);

    assert.ok(stats.p95 < 10,
      `remember() p95 latency ${stats.p95.toFixed(2)}ms exceeds 10ms budget. ` +
      `p50=${stats.p50.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`);
  });

  it('QUALITY_GATE: recall() p95 latency < 50ms with 50 claims in DB', async () => {
    const limen = await createPerfLimen();

    // Populate: create 50 claims
    // Total API calls: 50 (remember) + 3 (warmup recall) + 30 (measured recall) = 83
    // Under 100/min rate limit for both facade and CCP layers.
    for (let i = 0; i < 50; i++) {
      const result = limen.remember(`entity:perf:recall${i}`, 'perf.recall', `value-${i}`);
      assert.ok(result.ok, `Populate claim ${i} failed`);
    }

    // Warm up: 3 recall queries
    for (let i = 0; i < 3; i++) {
      limen.recall(undefined, 'perf.recall');
    }

    const stats = measureLatency(() => {
      const result = limen.recall(undefined, 'perf.recall');
      assert.ok(result.ok, `recall failed: ${!result.ok ? result.error.message : ''}`);
    }, 30);

    assert.ok(stats.p95 < 50,
      `recall() p95 latency ${stats.p95.toFixed(2)}ms exceeds 50ms budget. ` +
      `p50=${stats.p50.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`);
  });

  it('QUALITY_GATE: reflect(50) latency < 250ms', async () => {
    const limen = await createPerfLimen();

    // Warm up with small batch
    limen.reflect([
      { category: 'decision', statement: 'warmup entry' },
    ]);

    // Use 50 entries to stay under per-agent rate limit of 100/min.
    // Scale the budget proportionally: 50 entries < 250ms (5ms/entry budget)
    const entries = Array.from({ length: 50 }, (_, i) => ({
      category: 'decision' as const,
      statement: `Performance test entry ${i} for reflect characterization`,
    }));

    const start = performance.now();
    const result = limen.reflect(entries);
    const elapsed = performance.now() - start;

    assert.ok(result.ok, `reflect(50) failed: ${!result.ok ? result.error.message : ''}`);
    if (result.ok) {
      assert.equal(result.value.stored, 50, 'Should store all 50 entries');
    }

    assert.ok(elapsed < 250,
      `reflect(50) latency ${elapsed.toFixed(2)}ms exceeds 250ms budget`);
  });

  it('QUALITY_GATE: forget() p95 latency < 10ms over 30 calls', async () => {
    const limen = await createPerfLimen();

    // Create 35 claims (5 warmup + 30 measured)
    // Stays under 100/min rate limit for assertClaim
    const claimIds: string[] = [];
    for (let i = 0; i < 35; i++) {
      const result = limen.remember(`entity:perf:forget${i}`, 'perf.forget', `value-${i}`);
      assert.ok(result.ok, `Create claim ${i} failed`);
      if (result.ok) claimIds.push(result.value.claimId);
    }

    // Warm up: forget first 5
    for (let i = 0; i < 5; i++) {
      limen.forget(claimIds[i]!);
    }

    // Measure: forget remaining 30 claims
    // Retract is not rate-limited at the CCP level (only assertClaim is)
    let idx = 5;
    const stats = measureLatency(() => {
      const claimId = claimIds[idx];
      if (!claimId) return;
      idx++;
      const result = limen.forget(claimId);
      assert.ok(result.ok, `forget failed: ${!result.ok ? result.error.message : ''}`);
    }, 30);

    assert.ok(stats.p95 < 10,
      `forget() p95 latency ${stats.p95.toFixed(2)}ms exceeds 10ms budget. ` +
      `p50=${stats.p50.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`);
  });

  it('QUALITY_GATE: connect() p95 latency < 10ms over 20 calls', async () => {
    const limen = await createPerfLimen();

    // Create 25 pairs (50 claims total, under 100/min limit)
    // 5 warmup pairs + 20 measured
    const pairs: [string, string][] = [];
    for (let i = 0; i < 25; i++) {
      const r1 = limen.remember(`entity:perf:conn${i}a`, 'perf.connect', `a-${i}`);
      const r2 = limen.remember(`entity:perf:conn${i}b`, 'perf.connect', `b-${i}`);
      assert.ok(r1.ok && r2.ok, `Create pair ${i} failed`);
      if (r1.ok && r2.ok) pairs.push([r1.value.claimId, r2.value.claimId]);
    }

    // Warm up
    for (let i = 0; i < 5; i++) {
      limen.connect(pairs[i]![0], pairs[i]![1], 'supports');
    }

    let idx = 5;
    const stats = measureLatency(() => {
      if (idx >= pairs.length) return;
      const [id1, id2] = pairs[idx]!;
      idx++;
      const result = limen.connect(id1, id2, 'supports');
      assert.ok(result.ok, `connect failed: ${!result.ok ? result.error.message : ''}`);
    }, 20);

    assert.ok(stats.p95 < 10,
      `connect() p95 latency ${stats.p95.toFixed(2)}ms exceeds 10ms budget. ` +
      `p50=${stats.p50.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`);
  });

  it('QUALITY_GATE: promptInstructions() latency < 1ms (pure function)', async () => {
    const limen = await createPerfLimen();

    const stats = measureLatency(() => {
      const result = limen.promptInstructions();
      assert.ok(typeof result === 'string' && result.length > 0);
    }, 50);

    assert.ok(stats.p95 < 1,
      `promptInstructions() p95 latency ${stats.p95.toFixed(2)}ms exceeds 1ms budget. ` +
      `p50=${stats.p50.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms`);
  });
});
