// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Phase 2.6 Integration Test — Proves hooks intercept at API level.
 *
 * Creates a real Limen instance with hooks and verifies:
 * 1. beforeAssert hook can reject a claim (HOOK_REJECTED error)
 * 2. Decay hook replaces the default FSRS formula
 * 3. Recall hook transforms results before return
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { LimenHook } from '../../src/plugins/hook_types.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-hook-int-'));
}

function masterKey(): Buffer {
  return crypto.randomBytes(32);
}

describe('Hook System Integration', () => {
  it('beforeAssert hook rejects claim at API level (HOOK_REJECTED)', async () => {
    const rejectHook: LimenHook = {
      meta: { name: 'reject-low-conf', version: '1.0.0' },
      claimAssertion: {
        beforeAssert: (claim) => {
          if (claim.confidence < 0.5) return null;
          return claim;
        },
      },
    };

    const dataDir = tmpDir();
    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      hooks: [rejectHook],
    });

    try {
      // High confidence should pass
      const passResult = await limen.remember('entity:test:1', 'test.pass', 'hello', { confidence: 0.8 });
      assert.equal(passResult.ok, true);

      // Low confidence should be rejected by hook
      const failResult = await limen.remember('entity:test:2', 'test.fail', 'world', { confidence: 0.3 });
      assert.equal(failResult.ok, false);
      if (!failResult.ok) {
        assert.equal(failResult.error.code, 'HOOK_REJECTED');
      }
    } finally {
      await limen.shutdown();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('decay hook replaces FSRS formula at recall time', async () => {
    // Custom decay: always return 50% of confidence regardless of age
    const halfDecayHook: LimenHook = {
      meta: { name: 'half-decay', version: '1.0.0' },
      decay: {
        computeDecay: (confidence, _ageMs, _stabilityDays) => confidence * 0.5,
      },
    };

    const dataDir = tmpDir();
    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      hooks: [halfDecayHook],
    });

    try {
      // Assert a claim with confidence 0.9
      const assertResult = await limen.remember('entity:test:1', 'test.decay', 'value', { confidence: 0.9 });
      assert.equal(assertResult.ok, true);

      // Recall — decay hook should make effectiveConfidence = 0.9 * 0.5 = 0.45
      const recallResult = await limen.recall('entity:test:1', 'test.decay');
      assert.equal(recallResult.ok, true);
      if (recallResult.ok) {
        assert.ok(recallResult.value.length > 0, 'Expected at least 1 belief');
        const belief = recallResult.value[0]!;
        // With default FSRS at age ~0, effectiveConfidence ≈ 0.9 (no decay)
        // With our hook (0.5x multiplier), it should be significantly lower
        // Cascade penalty may further reduce, so test that hook applied
        assert.ok(
          belief.effectiveConfidence < 0.5,
          `Expected < 0.5 (hook applied 50% reduction) got ${belief.effectiveConfidence}`,
        );
        assert.ok(
          belief.effectiveConfidence > 0,
          `Expected > 0 got ${belief.effectiveConfidence}`,
        );
      }
    } finally {
      await limen.shutdown();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('recall hook transforms results before return', async () => {
    // Custom recall hook: adds a custom field to every belief
    const tagHook: LimenHook = {
      meta: { name: 'tagger', version: '1.0.0' },
      recall: {
        onRecall: (beliefs, _query) => {
          return beliefs.map(b => ({ ...b, tagged: true, source: 'hook-test' }));
        },
      },
    };

    const dataDir = tmpDir();
    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      hooks: [tagHook],
    });

    try {
      await limen.remember('entity:test:1', 'test.recall', 'data', { confidence: 0.8 });

      const recallResult = await limen.recall('entity:test:1', 'test.recall');
      assert.equal(recallResult.ok, true);
      if (recallResult.ok && recallResult.value.length > 0) {
        const belief = recallResult.value[0] as Record<string, unknown>;
        assert.equal(belief.tagged, true);
        assert.equal(belief.source, 'hook-test');
      }
    } finally {
      await limen.shutdown();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
