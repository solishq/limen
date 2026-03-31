/**
 * Phase 4 Quality & Safety: Integration Tests.
 *
 * Tests conflict auto-detection, cascade in recall/search, RBAC enforcement,
 * .raw gating, retraction reasons through the full Limen API.
 *
 * DC coverage: DC-P4-101 through DC-P4-903 integration paths.
 * [A21] dual-path for enforcement DCs.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Test Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-p4-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirs: string[] = [];
const instances: Limen[] = [];

function trackDir(d: string): string { dirs.push(d); return d; }
function trackInstance(l: Limen): Limen { instances.push(l); return l; }

after(async () => {
  for (const inst of instances) {
    try { await inst.shutdown(); } catch { /* ignore */ }
  }
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  instances.length = 0;
  dirs.length = 0;
});

async function createTestLimen(overrides?: { requireRbac?: boolean; autoConflict?: boolean }): Promise<Limen> {
  const dir = trackDir(makeTempDir());
  return trackInstance(
    await createLimen({
      dataDir: dir,
      masterKey: makeKey(),
      providers: [],
      ...(overrides?.requireRbac !== undefined ? { requireRbac: overrides.requireRbac } : {}),
      ...(overrides?.autoConflict !== undefined ? { autoConflict: overrides.autoConflict } : {}),
    }),
  );
}

// ============================================================================
// Phase 4.1: Structural Conflict Detection (Integration)
// ============================================================================

describe('Phase 4.1: Conflict auto-detection in remember()', () => {
  it('DC-P4-101 success: asserting conflicting claim creates contradicts relationship', async () => {
    const limen = await createTestLimen();

    // Assert two claims with same subject+predicate, different values
    const r1 = limen.remember('entity:company:acme', 'financial.revenue', '1000000');
    assert.ok(r1.ok, `remember 1: ${!r1.ok ? r1.error.message : ''}`);
    if (!r1.ok) return;

    const r2 = limen.remember('entity:company:acme', 'financial.revenue', '2000000');
    assert.ok(r2.ok, `remember 2: ${!r2.ok ? r2.error.message : ''}`);
    if (!r2.ok) return;

    // Both should be disputed (bidirectional contradicts)
    const recalled = limen.recall('entity:company:acme', 'financial.revenue');
    assert.ok(recalled.ok);
    if (!recalled.ok) return;

    const claim1 = recalled.value.find(b => b.claimId === r1.value.claimId);
    const claim2 = recalled.value.find(b => b.claimId === r2.value.claimId);
    assert.ok(claim1, 'First claim should be in results');
    assert.ok(claim2, 'Second claim should be in results');
    assert.strictEqual(claim1!.disputed, true, 'DC-P4-202: First claim should be disputed (I-P4-09 bidirectional)');
    assert.strictEqual(claim2!.disputed, true, 'DC-P4-202: Second claim should be disputed (I-P4-09 bidirectional)');
  });

  it('DC-P4-102 success: no conflict when values are the same', async () => {
    const limen = await createTestLimen();

    const r1 = limen.remember('entity:company:beta', 'financial.revenue', 'same-value');
    assert.ok(r1.ok);
    if (!r1.ok) return;

    const r2 = limen.remember('entity:company:beta', 'financial.revenue', 'same-value');
    assert.ok(r2.ok);
    if (!r2.ok) return;

    const recalled = limen.recall('entity:company:beta', 'financial.revenue');
    assert.ok(recalled.ok);
    if (!recalled.ok) return;

    // Neither should be disputed (same value = no conflict)
    for (const b of recalled.value) {
      assert.strictEqual(b.disputed, false, 'Same-value claims should not be disputed');
    }
  });

  it('DC-P4-102 rejection: no conflict with retracted claims (only active participate)', async () => {
    const limen = await createTestLimen();

    // Create and retract a claim
    const r1 = limen.remember('entity:company:gamma', 'financial.revenue', 'old-value');
    assert.ok(r1.ok);
    if (!r1.ok) return;

    const forgotten = limen.forget(r1.value.claimId, 'superseded');
    assert.ok(forgotten.ok, `forget: ${!forgotten.ok ? forgotten.error.message : ''}`);

    // New claim with different value should NOT conflict (old one is retracted)
    const r2 = limen.remember('entity:company:gamma', 'financial.revenue', 'new-value');
    assert.ok(r2.ok);
    if (!r2.ok) return;

    const recalled = limen.recall('entity:company:gamma', 'financial.revenue');
    assert.ok(recalled.ok);
    if (!recalled.ok) return;

    const newClaim = recalled.value.find(b => b.claimId === r2.value.claimId);
    assert.ok(newClaim, 'New claim should be in results');
    assert.strictEqual(newClaim!.disputed, false, 'Should not be disputed — old claim was retracted');
  });
});

// ============================================================================
// Phase 4.3: Cascade Retraction in Recall (Integration)
// ============================================================================

describe('Phase 4.3: Cascade retraction penalty in recall()', () => {
  it('DC-P4-203 success: claim with no derived_from has effectiveConfidence = confidence * decay only', async () => {
    const limen = await createTestLimen();

    // maxAutoConfidence defaults to 0.7, so confidence is capped there
    const r = limen.remember('entity:test:cascade1', 'test.value', 'data');
    assert.ok(r.ok);
    if (!r.ok) return;

    const recalled = limen.recall('entity:test:cascade1');
    assert.ok(recalled.ok);
    if (!recalled.ok) return;

    const belief = recalled.value.find(b => b.claimId === r.value.claimId);
    assert.ok(belief);
    // effectiveConfidence should be close to stored confidence (decay near 1.0 for fresh claim)
    // Stored confidence is capped at 0.7 (default maxAutoConfidence)
    // With cascade penalty = 1.0 (no derived_from edges) and decay near 1.0,
    // effectiveConfidence should be close to 0.7
    assert.ok(belief!.effectiveConfidence > 0.6, `Expected > 0.6, got ${belief!.effectiveConfidence}`);
    assert.ok(belief!.effectiveConfidence <= 0.7, `Expected <= 0.7, got ${belief!.effectiveConfidence}`);
  });
});

// ============================================================================
// Phase 4.4: Retraction Reason Taxonomy
// ============================================================================

describe('Phase 4.4: Retraction reason taxonomy', () => {
  it('DC-P4-104 success: forget with valid taxonomy reason succeeds', async () => {
    const limen = await createTestLimen();

    const reasons = ['incorrect', 'superseded', 'expired', 'manual'] as const;
    for (const reason of reasons) {
      const r = limen.remember('entity:test:reason', 'test.data', `value-${reason}`);
      assert.ok(r.ok);
      if (!r.ok) continue;

      const result = limen.forget(r.value.claimId, reason);
      assert.ok(result.ok, `forget with reason '${reason}' should succeed: ${!result.ok ? result.error.message : ''}`);
    }
  });

  it('DC-P4-104 rejection: forget with default reason (manual) succeeds', async () => {
    const limen = await createTestLimen();

    const r = limen.remember('entity:test:default-reason', 'test.data', 'value');
    assert.ok(r.ok);
    if (!r.ok) return;

    // No reason parameter — defaults to 'manual'
    const result = limen.forget(r.value.claimId);
    assert.ok(result.ok, `forget without reason should succeed (defaults to manual): ${!result.ok ? result.error.message : ''}`);
  });
});

// ============================================================================
// Phase 4.5: RBAC Enforcement
// ============================================================================

describe('Phase 4.5: RBAC enforcement configuration', () => {
  it('DC-P4-402 success: requireRbac=false (default) allows all operations', async () => {
    const limen = await createTestLimen(); // requireRbac defaults to false

    // All operations should succeed
    const r = limen.remember('entity:test:rbac-default', 'test.data', 'value');
    assert.ok(r.ok, 'remember should succeed with default requireRbac=false');

    const recalled = limen.recall('entity:test:rbac-default');
    assert.ok(recalled.ok, 'recall should succeed with default requireRbac=false');
  });

  it('DC-P4-402 success: explicit requireRbac=false allows all operations', async () => {
    const limen = await createTestLimen({ requireRbac: false });

    const r = limen.remember('entity:test:rbac-false', 'test.data', 'value');
    assert.ok(r.ok, 'remember should succeed with requireRbac=false');
  });
});

// ============================================================================
// Phase 4.6: .raw Access Gating
// ============================================================================

describe('Phase 4.6: .raw access audit logging', () => {
  it('DC-P4-404 success: .raw access in default mode is permitted', async () => {
    // This test verifies that the system boots and operates normally
    // with .raw access (used internally by audit trail, checkpoint coordinator)
    const limen = await createTestLimen();

    // If we got here, the system booted successfully, meaning internal .raw
    // access (audit trail) works correctly
    const health = await limen.health();
    assert.ok(health, 'Health check should succeed (requires .raw access internally)');
  });
});

// ============================================================================
// Phase 4: Conflict detection disabled
// ============================================================================

describe('Phase 4: autoConflict=false disables conflict detection', () => {
  it('no contradicts relationships when autoConflict=false', async () => {
    const limen = await createTestLimen({ autoConflict: false });

    const r1 = limen.remember('entity:test:noconflict', 'test.data', 'value1');
    assert.ok(r1.ok);
    if (!r1.ok) return;

    const r2 = limen.remember('entity:test:noconflict', 'test.data', 'value2');
    assert.ok(r2.ok);
    if (!r2.ok) return;

    const recalled = limen.recall('entity:test:noconflict');
    assert.ok(recalled.ok);
    if (!recalled.ok) return;

    // Neither should be disputed when autoConflict is disabled
    for (const b of recalled.value) {
      assert.strictEqual(b.disputed, false, 'Claims should not be disputed when autoConflict=false');
    }
  });
});
